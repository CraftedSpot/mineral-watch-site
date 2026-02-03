#!/usr/bin/env python3
"""
Generate well_pun_links for unlinked wells using name matching against otc_leases.

Two matching passes:

Pass 1 - Full normalized name:
  Strategy 1a (otc_name_county): Exact normalized name match, unique in county.
  Strategy 1b (otc_name_county_trs): Exact match + TRS tiebreaker.

Pass 2 - Alpha-only name (digits stripped):
  Well names include well numbers ("JONES 2-10" → "JONES210") while OTC lease
  names are just the lease/surface owner ("JONES"). Stripping digits aligns them.
  Multiple wells on the same lease correctly link to the same PUN.

  Strategy 2a (otc_name_alpha_county): Alpha name unique in county. Medium.
  Strategy 2b (otc_name_alpha_trs): Alpha name + TRS tiebreaker. High.

Name normalization: uppercase, remove all non-alphanumeric (same as
wells.well_name_normalized). Alpha-only: additionally remove digits.

Noise filters:
  - Normalized names < 4 chars (alpha-only < 5 chars)
  - TRACT*, UNKNOWN*, purely numeric
"""

import os
import subprocess
import json
import re


OUTPUT_DIR = "/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-name-link-batches"

NOISE_NAMES = {
    'UNKNOWN', 'UNKNOWNSOURCE', 'NONAME', 'NONE', 'NA',
    'TEST', 'TESTING', 'TESTWELL',
}

NOISE_ALPHA_NAMES = {
    'UNKNOWN', 'UNKNOWNSOURCE', 'NONAME', 'NONE', 'NA',
    'TEST', 'TESTING', 'TESTWELL', 'FEE', 'STATE', 'UNIT',
}


def escape_sql(s):
    if s is None:
        return ''
    return str(s).replace("'", "''")


def normalize_name(name):
    """Normalize a name for matching: uppercase, remove non-alphanumeric."""
    if not name:
        return ''
    name = name.upper().strip()
    name = re.sub(r'[^A-Z0-9]', '', name)
    return name


def alpha_only(name):
    """Strip digits from a normalized name, leaving only letters."""
    return re.sub(r'[0-9]', '', name)


def is_noise_name(normalized):
    """Check if a normalized name is too generic for matching."""
    if len(normalized) < 4:
        return True
    if normalized in NOISE_NAMES:
        return True
    if normalized.startswith('TRACT'):
        return True
    if normalized.startswith('UNKNOWN'):
        return True
    if normalized.isdigit():
        return True
    return False


def is_noise_alpha(alpha_name):
    """Check if an alpha-only name is too generic."""
    if len(alpha_name) < 5:
        return True
    if alpha_name in NOISE_ALPHA_NAMES:
        return True
    if alpha_name.startswith('TRACT'):
        return True
    if alpha_name.startswith('UNKNOWN'):
        return True
    return False


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
    # ── Step 1: Get unlinked wells with names ──
    print("Step 1: Loading unlinked wells with names...")

    wells = query_d1(
        'SELECT w.api_number, w.well_name, w.well_name_normalized, '
        'w.county, w.section, w.township, w.range '
        'FROM wells w '
        'WHERE w.well_name IS NOT NULL AND w.well_name <> "" '
        'AND w.api_number NOT IN (SELECT api_number FROM well_pun_links)'
    )
    print(f"  Found {len(wells):,} unlinked wells with names")

    # ── Step 2: Get unlinked PUNs with names from otc_leases ──
    print("\nStep 2: Loading unlinked PUNs with lease names from otc_leases...")

    lease_puns = query_d1(
        'SELECT l.pun, l.base_pun, l.lease_name, '
        'l.county, l.section, l.township, l.range '
        'FROM otc_leases l '
        'WHERE l.base_pun NOT IN '
        '(SELECT base_pun FROM well_pun_links WHERE base_pun IS NOT NULL) '
        'AND l.lease_name IS NOT NULL AND l.lease_name <> ""'
    )
    print(f"  Found {len(lease_puns):,} unlinked lease PUN records")

    # ── Step 3: Build lookup structures ──
    print("\nStep 3: Building lookup structures...")

    # Process wells
    well_data = []
    skipped_noise_wells = 0
    for w in wells:
        norm = w.get('well_name_normalized') or normalize_name(w['well_name'])
        if is_noise_name(norm):
            skipped_noise_wells += 1
            continue
        well_data.append({
            'api_number': w['api_number'],
            'well_name': w['well_name'],
            'name_norm': norm,
            'county': (w.get('county') or '').upper().strip(),
            'section': str(w['section']) if w.get('section') is not None else '',
            'township': str(w.get('township') or '').strip(),
            'range': str(w.get('range') or '').strip(),
        })
    print(f"  Wells after noise filtering: {len(well_data):,} (skipped {skipped_noise_wells:,})")

    # Process PUNs - deduplicate by base_pun, preferring merge=0000 rows
    pun_by_bp = {}
    skipped_noise_puns = 0
    for p in lease_puns:
        norm = normalize_name(p['lease_name'])
        if is_noise_name(norm):
            skipped_noise_puns += 1
            continue

        bp = p['base_pun']
        pun_str = p['pun'] or ''
        is_primary = len(pun_str) == 17 and pun_str[13:] == '0000'

        if bp not in pun_by_bp or is_primary:
            pun_by_bp[bp] = {
                'pun': p['pun'],
                'base_pun': bp,
                'lease_name': p['lease_name'],
                'name_norm': norm,
                'county': (p.get('county') or '').upper().strip(),
                'section': str(p['section']) if p.get('section') is not None else '',
                'township': str(p.get('township') or '').strip(),
                'range': str(p.get('range') or '').strip(),
            }

    pun_data = list(pun_by_bp.values())
    print(f"  PUNs after noise/dedup filtering: {len(pun_data):,} (skipped {skipped_noise_puns:,} noise)")

    # Build PUN lookup: (county, name_norm) → list of PUNs
    pun_by_county_name = {}
    for p in pun_data:
        key = (p['county'], p['name_norm'])
        if key not in pun_by_county_name:
            pun_by_county_name[key] = []
        pun_by_county_name[key].append(p)

    print(f"  Unique county+name keys: {len(pun_by_county_name):,}")

    # Build alpha-only PUN lookup: (county, alpha_name) → list of PUNs
    pun_by_county_alpha = {}
    for p in pun_data:
        a = alpha_only(p['name_norm'])
        if is_noise_alpha(a):
            continue
        key = (p['county'], a)
        if key not in pun_by_county_alpha:
            pun_by_county_alpha[key] = []
        pun_by_county_alpha[key].append(p)

    print(f"  Unique county+alpha keys: {len(pun_by_county_alpha):,}")

    # ── Step 4: Match wells to PUNs ──
    print("\nStep 4: Matching wells to PUNs...")

    new_links = []
    matched_apis = set()
    stats = {
        'no_match': 0,
        'exact_county': 0,
        'exact_trs': 0,
        'exact_ambiguous': 0,
        'alpha_county': 0,
        'alpha_trs': 0,
        'alpha_ambiguous': 0,
        'alpha_noise': 0,
        'too_many': 0,
    }

    # ── Pass 1: Full normalized name matching ──
    print("  Pass 1: Full normalized name match...")
    for well in well_data:
        key = (well['county'], well['name_norm'])
        candidates = pun_by_county_name.get(key)
        if not candidates:
            continue

        if len(candidates) == 1:
            stats['exact_county'] += 1
            match = candidates[0]
            new_links.append({
                'api_number': well['api_number'],
                'pun': match['pun'],
                'base_pun': match['base_pun'],
                'lease_name': match['lease_name'],
                'match_method': 'otc_name_county',
                'confidence': 'medium',
                'confidence_score': 0.70,
            })
            matched_apis.add(well['api_number'])

        elif len(candidates) <= 10:
            if well['section'] == '' or well['township'] == '':
                stats['exact_ambiguous'] += 1
                continue

            trs_matches = [
                c for c in candidates
                if c['section'] == well['section']
                and c['township'] == well['township']
                and c['range'] == well['range']
            ]
            if len(trs_matches) == 1:
                stats['exact_trs'] += 1
                match = trs_matches[0]
                new_links.append({
                    'api_number': well['api_number'],
                    'pun': match['pun'],
                    'base_pun': match['base_pun'],
                    'lease_name': match['lease_name'],
                    'match_method': 'otc_name_county_trs',
                    'confidence': 'high',
                    'confidence_score': 0.85,
                })
                matched_apis.add(well['api_number'])
            else:
                stats['exact_ambiguous'] += 1
        else:
            stats['too_many'] += 1

    print(f"    Exact county match: {stats['exact_county']:,}")
    print(f"    Exact TRS tiebreaker: {stats['exact_trs']:,}")
    print(f"    Exact ambiguous: {stats['exact_ambiguous']:,}")

    # ── Pass 2: Alpha-only name matching (digits stripped) ──
    print("  Pass 2: Alpha-only name match (well numbers stripped)...")
    for well in well_data:
        if well['api_number'] in matched_apis:
            continue

        well_alpha = alpha_only(well['name_norm'])
        if is_noise_alpha(well_alpha):
            stats['alpha_noise'] += 1
            continue

        key = (well['county'], well_alpha)
        candidates = pun_by_county_alpha.get(key)
        if not candidates:
            stats['no_match'] += 1
            continue

        if len(candidates) == 1:
            stats['alpha_county'] += 1
            match = candidates[0]
            new_links.append({
                'api_number': well['api_number'],
                'pun': match['pun'],
                'base_pun': match['base_pun'],
                'lease_name': match['lease_name'],
                'match_method': 'otc_name_alpha_county',
                'confidence': 'medium',
                'confidence_score': 0.65,
            })
            matched_apis.add(well['api_number'])

        elif len(candidates) <= 10:
            if well['section'] == '' or well['township'] == '':
                stats['alpha_ambiguous'] += 1
                continue

            trs_matches = [
                c for c in candidates
                if c['section'] == well['section']
                and c['township'] == well['township']
                and c['range'] == well['range']
            ]
            if len(trs_matches) == 1:
                stats['alpha_trs'] += 1
                match = trs_matches[0]
                new_links.append({
                    'api_number': well['api_number'],
                    'pun': match['pun'],
                    'base_pun': match['base_pun'],
                    'lease_name': match['lease_name'],
                    'match_method': 'otc_name_alpha_trs',
                    'confidence': 'high',
                    'confidence_score': 0.80,
                })
                matched_apis.add(well['api_number'])
            else:
                stats['alpha_ambiguous'] += 1
        else:
            stats['too_many'] += 1

    unmatched = len(well_data) - len(matched_apis)
    print(f"    Alpha county match: {stats['alpha_county']:,}")
    print(f"    Alpha TRS tiebreaker: {stats['alpha_trs']:,}")
    print(f"    Alpha ambiguous: {stats['alpha_ambiguous']:,}")
    print(f"    Alpha noise name skipped: {stats['alpha_noise']:,}")
    print(f"    No match (either pass): {stats['no_match']:,}")
    print(f"  Total new links: {len(new_links):,}")
    print(f"  Still unmatched: {unmatched:,}")

    if not new_links:
        print("\nNo new links to create.")
        return

    # ── Step 5: Generate batch files ──
    print(f"\nStep 5: Generating SQL batch files...")

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
    for link in new_links[:15]:
        print(f"  API {link['api_number']} → {link['pun']} ({link['lease_name']}) [{link['match_method']}]")

    print(f"\nTo execute:")
    print(f"  ./load-remaining.sh otc-name-link-batches 0")


if __name__ == '__main__':
    main()
