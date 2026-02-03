#!/usr/bin/env python3
"""
Generate well_pun_links INSERT statements for horizontal tract allocations.

Logic: If API X is linked to PUN CCC-LLLLLL-S-0000 (primary well),
and otc_leases shows CCC-LLLLLL-S-MMMM (same county+lease+sub, merge != 0000),
then the tract allocation PUN belongs to the same well.

Matches on first 12 chars of PUN (CCC-LLLLLL-S) to ensure sub code matches.
Only links non-zero merge codes (tract allocations).
"""

import os
import subprocess
import json


OUTPUT_DIR = "/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-merge-link-batches"


def escape_sql(s):
    if s is None:
        return ''
    return str(s).replace("'", "''")


def query_d1(sql):
    """Run a D1 query and return results."""
    result = subprocess.run(
        ['wrangler', 'd1', 'execute', 'oklahoma-wells', '--remote', '--command', sql, '--json'],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"Error: {result.stderr[:200]}")
        return []
    try:
        data = json.loads(result.stdout)
        return data[0].get('results', [])
    except (json.JSONDecodeError, IndexError, KeyError):
        print(f"Parse error: {result.stdout[:200]}")
        return []


def main():
    print("Step 1: Loading existing well_pun_links (api_number -> pun_prefix mapping)...")

    # Get all existing links with 17-char PUNs, grouped by 12-char prefix (county+lease+sub)
    # This is the "parent" mapping: which APIs are linked to which PUN prefixes
    existing = query_d1(
        'SELECT api_number, pun, SUBSTR(pun, 1, 12) as pun_prefix '
        'FROM well_pun_links WHERE LENGTH(pun) = 17'
    )
    print(f"  Found {len(existing):,} existing 17-char PUN links")

    # Build prefix -> set of api_numbers
    prefix_to_apis = {}
    existing_pairs = set()  # (api_number, pun) pairs already linked
    for row in existing:
        prefix = row['pun_prefix']
        api = row['api_number']
        if prefix not in prefix_to_apis:
            prefix_to_apis[prefix] = set()
        prefix_to_apis[prefix].add(api)
        existing_pairs.add((api, row['pun']))

    print(f"  Unique 12-char prefixes with links: {len(prefix_to_apis):,}")

    print("\nStep 2: Loading otc_leases tract allocation PUNs (merge != 0000)...")

    # Get all non-zero merge PUNs from otc_leases
    tracts = query_d1(
        'SELECT DISTINCT pun, base_pun, SUBSTR(pun, 1, 12) as pun_prefix, lease_name '
        'FROM otc_leases WHERE SUBSTR(pun, 14, 4) <> "0000" AND LENGTH(pun) = 17'
    )
    print(f"  Found {len(tracts):,} tract allocation PUNs")

    print("\nStep 3: Matching tracts to parent APIs...")

    new_links = []
    matched_tracts = 0
    skipped_existing = 0

    for tract in tracts:
        prefix = tract['pun_prefix']
        if prefix not in prefix_to_apis:
            continue  # No parent well linked for this prefix

        matched_tracts += 1
        for api in prefix_to_apis[prefix]:
            if (api, tract['pun']) in existing_pairs:
                skipped_existing += 1
                continue
            new_links.append({
                'api_number': api,
                'pun': tract['pun'],
                'base_pun': tract['base_pun'],
                'lease_name': tract['lease_name'],
            })

    print(f"  Tracts with matching parent: {matched_tracts:,}")
    print(f"  Already linked (skipped): {skipped_existing:,}")
    print(f"  New links to create: {len(new_links):,}")

    if not new_links:
        print("\nNo new links to create.")
        return

    print(f"\nStep 4: Generating SQL batch files...")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for f in os.listdir(OUTPUT_DIR):
        if f.endswith('.sql'):
            os.remove(os.path.join(OUTPUT_DIR, f))

    BATCH_SIZE = 500
    batch_num = 0

    for i in range(0, len(new_links), BATCH_SIZE):
        batch = new_links[i:i+BATCH_SIZE]
        batch_num += 1

        sql_lines = []
        for link in batch:
            sql = (
                f"INSERT OR IGNORE INTO well_pun_links "
                f"(api_number, pun, base_pun, match_method, confidence, "
                f"confidence_score, lease_name, match_source, link_status) VALUES ("
                f"'{escape_sql(link['api_number'])}', "
                f"'{escape_sql(link['pun'])}', "
                f"'{escape_sql(link['base_pun'])}', "
                f"'otc_merge_allocation', 'high', 0.90, "
                f"'{escape_sql(link['lease_name'])}', "
                f"'otc_leases', 'proposed');"
            )
            sql_lines.append(sql)

        with open(f"{OUTPUT_DIR}/batch_{batch_num:04d}.sql", 'w') as f:
            f.write('\n'.join(sql_lines))

    print(f"  Created {batch_num} batch files in {OUTPUT_DIR}/")

    # Show sample links
    print(f"\nSample new links:")
    for link in new_links[:10]:
        print(f"  API {link['api_number']} -> {link['pun']} ({link['lease_name']})")

    print(f"\nTo execute:")
    print(f"  ./load-remaining.sh otc-merge-link-batches 0")


if __name__ == '__main__':
    main()
