#!/usr/bin/env python3
"""
Generate well_pun_links for unlinked wells using operator_number + TRS matching.

Strategy 1 (high confidence): Well matches exactly 1 base_pun by operator + TRS.
Strategy 2 (medium confidence): Well matches 2 base_puns by operator + TRS,
    but well_type tiebreaker resolves to 1 (e.g., OIL well matches PUN with
    well_classification=107 but not 108).

Well type mapping:
    wells.well_type  →  otc_leases.well_classification
    OIL              →  107
    GAS              →  108
    INJ, SWD, WSW    →  109
"""

import os
import subprocess
import json


OUTPUT_DIR = "/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-operator-trs-link-batches"

WELL_TYPE_TO_CLASS = {
    'OIL': '107',
    'GAS': '108',
    'INJ': '109',
    'SWD': '109',
    'WSW': '109',
}


def escape_sql(s):
    if s is None:
        return ''
    return str(s).replace("'", "''")


def sql_val(val):
    if val is None:
        return 'NULL'
    if isinstance(val, (int, float)):
        return str(val)
    return f"'{escape_sql(val)}'"


def query_d1(sql):
    """Run a D1 query and return results."""
    result = subprocess.run(
        ['wrangler', 'd1', 'execute', 'oklahoma-wells', '--remote', '--command', sql, '--json'],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  Error: {result.stderr[:300]}")
        return []
    try:
        data = json.loads(result.stdout)
        return data[0].get('results', [])
    except (json.JSONDecodeError, IndexError, KeyError):
        print(f"  Parse error: {result.stdout[:200]}")
        return []


def main():
    # ── Step 1: Get unlinked wells with operator_number ──
    print("Step 1: Loading unlinked wells with operator_number + TRS...")

    wells = query_d1(
        'SELECT w.api_number, w.operator_number, w.section, w.township, w.range, '
        'w.well_type, w.well_name, w.county '
        'FROM wells w '
        'WHERE w.operator_number IS NOT NULL AND w.operator_number <> "" '
        'AND w.api_number NOT IN (SELECT api_number FROM well_pun_links)'
    )
    print(f"  Found {len(wells):,} unlinked wells with operator_number")

    # ── Step 2: Get otc_leases with operator_number + TRS ──
    print("\nStep 2: Loading otc_leases with operator_number for matching...")

    leases = query_d1(
        'SELECT DISTINCT l.pun, l.base_pun, l.operator_number, l.section, '
        'l.township, l.range, l.lease_name, l.well_classification, l.county '
        'FROM otc_leases l '
        'WHERE l.operator_number IS NOT NULL'
    )
    print(f"  Found {len(leases):,} lease records with operator_number")

    # Build lookup: (operator, section, township, range) → list of lease records
    lease_lookup = {}
    for lease in leases:
        key = (
            str(lease['operator_number']),
            str(lease['section']) if lease['section'] is not None else '',
            str(lease['township']).strip() if lease['township'] else '',
            str(lease['range']).strip() if lease['range'] else '',
        )
        if key not in lease_lookup:
            lease_lookup[key] = []
        lease_lookup[key].append(lease)

    print(f"  Unique operator+TRS keys: {len(lease_lookup):,}")

    # ── Step 3: Match wells to PUNs ──
    print("\nStep 3: Matching wells to PUNs...")

    new_links = []
    stats = {
        'no_match': 0,
        'unique_match': 0,
        'tiebreaker_resolved': 0,
        'tiebreaker_failed': 0,
        'too_many': 0,
    }

    for well in wells:
        key = (
            str(well['operator_number']),
            str(well['section']) if well['section'] is not None else '',
            str(well['township']).strip() if well['township'] else '',
            str(well['range']).strip() if well['range'] else '',
        )

        candidates = lease_lookup.get(key)
        if not candidates:
            stats['no_match'] += 1
            continue

        # Deduplicate by base_pun (a PUN can have multiple TRS rows)
        by_base_pun = {}
        for c in candidates:
            bp = c['base_pun']
            if bp not in by_base_pun:
                by_base_pun[bp] = c

        unique_puns = list(by_base_pun.values())

        if len(unique_puns) == 1:
            # Strategy 1: Unique match
            stats['unique_match'] += 1
            match = unique_puns[0]
            new_links.append({
                'api_number': well['api_number'],
                'pun': match['pun'],
                'base_pun': match['base_pun'],
                'lease_name': match['lease_name'],
                'match_method': 'operator_trs',
                'confidence': 'high',
                'confidence_score': 0.90,
            })

        elif len(unique_puns) == 2:
            # Strategy 2: Try well_type tiebreaker
            well_type = (well.get('well_type') or '').upper()
            expected_class = WELL_TYPE_TO_CLASS.get(well_type)

            if expected_class:
                matching = [p for p in unique_puns if p.get('well_classification') == expected_class]
                non_matching = [p for p in unique_puns if p.get('well_classification') != expected_class]

                if len(matching) == 1 and len(non_matching) == 1:
                    # Tiebreaker resolved
                    stats['tiebreaker_resolved'] += 1
                    match = matching[0]
                    new_links.append({
                        'api_number': well['api_number'],
                        'pun': match['pun'],
                        'base_pun': match['base_pun'],
                        'lease_name': match['lease_name'],
                        'match_method': 'operator_trs_welltype',
                        'confidence': 'medium',
                        'confidence_score': 0.80,
                    })
                    continue

            # Tiebreaker didn't help — link to all candidates at lower confidence
            stats['tiebreaker_failed'] += 1
            for match in unique_puns:
                new_links.append({
                    'api_number': well['api_number'],
                    'pun': match['pun'],
                    'base_pun': match['base_pun'],
                    'lease_name': match['lease_name'],
                    'match_method': 'operator_trs_multi',
                    'confidence': 'medium',
                    'confidence_score': 0.65,
                })

        else:
            # 3+ candidates — too ambiguous without more signals, skip
            stats['too_many'] += 1

    print(f"  No match: {stats['no_match']:,}")
    print(f"  Unique match (1 PUN): {stats['unique_match']:,}")
    print(f"  Tiebreaker resolved (2→1): {stats['tiebreaker_resolved']:,}")
    print(f"  Tiebreaker failed (linked both): {stats['tiebreaker_failed']:,}")
    print(f"  Too many candidates (3+, skipped): {stats['too_many']:,}")
    print(f"  Total new links: {len(new_links):,}")

    if not new_links:
        print("\nNo new links to create.")
        return

    # ── Step 4: Generate batch files ──
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
                f"'{escape_sql(link['match_method'])}', "
                f"'{escape_sql(link['confidence'])}', "
                f"{link['confidence_score']}, "
                f"'{escape_sql(link['lease_name'])}', "
                f"'otc_leases', 'proposed');"
            )
            sql_lines.append(sql)

        with open(f"{OUTPUT_DIR}/batch_{batch_num:04d}.sql", 'w') as f:
            f.write('\n'.join(sql_lines))

    print(f"  Created {batch_num} batch files in {OUTPUT_DIR}/")

    # ── Summary ──
    method_counts = {}
    for link in new_links:
        m = link['match_method']
        method_counts[m] = method_counts.get(m, 0) + 1

    print(f"\nLinks by method:")
    for method, count in sorted(method_counts.items(), key=lambda x: -x[1]):
        print(f"  {method}: {count:,}")

    print(f"\nSample links:")
    for link in new_links[:10]:
        print(f"  API {link['api_number']} → {link['pun']} ({link['lease_name']}) [{link['match_method']}]")

    print(f"\nTo execute:")
    print(f"  ./load-remaining.sh otc-operator-trs-link-batches 0")


if __name__ == '__main__':
    main()
