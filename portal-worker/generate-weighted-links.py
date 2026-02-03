#!/usr/bin/env python3
"""
Generate well_pun_links using weighted scoring with Oklahoma-specific normalization.

Cascading Match Strategy:
  Step 1: Direct PUN match (skip - already linked)
  Step 2: Normalized Name + TRS match (high confidence)
  Step 3: Section anchor fallback (if TRS matches + same numbers)

Name Normalization (Scrub List):
  - Punctuation: . , # - _ ( ) and spaces
  - Unit suffixes: UNIT, UT, UN, U, WT
  - Legal status: FEDERAL, FED, STATE, ST, COMM
  - Property types: LEASE, LSE, ESTATE, EST

Scoring:
  - Name Match: 50%
  - TRS Match: 40%
  - County Match: 10%

Thresholds:
  - >90%: Auto-link (high confidence)
  - 70-89%: Flag for manual verification
  - <70%: No match
"""

import os
import subprocess
import json
import re
from collections import defaultdict


OUTPUT_DIR = "/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/weighted-link-batches"

# Patterns to strip from names (order matters - longer patterns first)
SCRUB_PATTERNS = [
    # Unit suffixes
    r'\bUNIT\b', r'\bUT\b', r'\bUN\b', r'\bWT\b',
    # Legal status
    r'\bFEDERAL\b', r'\bFED\b', r'\bSTATE\b', r'\bCOMM\b',
    # Property types
    r'\bLEASE\b', r'\bLSE\b', r'\bESTATE\b', r'\bEST\b',
]

# Names too generic to match
SKIP_NAMES = {'UNKNOWN', 'NONAME', 'NONE', 'NA', 'TEST'}


def escape_sql(s):
    if s is None:
        return ''
    return str(s).replace("'", "''")


def extract_section_numbers(name):
    """
    Extract section/well numbers from a name.
    "MEEK #3-21" → "321"
    "SMITH 1-19" → "119"
    "WHEELER #2" → "2"
    """
    if not name:
        return ""

    # Find all number sequences
    numbers = re.findall(r'\d+', name)
    return ''.join(numbers)


def create_match_key(name):
    """
    Create normalized match key:
    1. Uppercase
    2. Strip scrub patterns (UNIT, FEDERAL, etc.)
    3. Remove punctuation and spaces
    4. Result: letters + numbers combined

    "L.O. WHEELER UT 1,2,3" → "LOWHEELER123"
    "MEEK FEDERAL 3-21" → "MEEK321"
    "MABLE SMITH 1-19" → "MABLESMITH119"
    """
    if not name:
        return ""

    name = name.upper()

    # Apply scrub patterns
    for pattern in SCRUB_PATTERNS:
        name = re.sub(pattern, ' ', name)

    # Remove all non-alphanumeric
    name = re.sub(r'[^A-Z0-9]', '', name)

    return name


def get_base_name(match_key):
    """Extract just the letter portion of a match key."""
    return re.sub(r'\d+', '', match_key)


def normalize_township(twp):
    if not twp:
        return ""
    twp = str(twp).upper().strip()
    match = re.search(r'(\d+)\s*([NS])', twp)
    if match:
        return f"{match.group(1)}{match.group(2)}"
    match = re.search(r'(\d+)', twp)
    if match:
        return f"{match.group(1)}N"
    return twp


def normalize_range(rng):
    if not rng:
        return ""
    rng = str(rng).upper().strip()
    match = re.search(r'(\d+)\s*([EW])', rng)
    if match:
        return f"{match.group(1)}{match.group(2)}"
    match = re.search(r'(\d+)', rng)
    if match:
        return f"{match.group(1)}W"
    return rng


def normalize_county(county):
    if not county:
        return ""
    county = str(county).upper().strip()
    county = re.sub(r'\s*COUNTY\s*$', '', county)
    county = re.sub(r'^\d{3}-', '', county)
    return county


def trs_matches(well, lease):
    """Check if TRS (Section, Township, Range) matches."""
    w_sec = str(well.get('section', ''))
    l_sec = str(lease.get('section', ''))
    w_twp = normalize_township(well.get('township'))
    l_twp = normalize_township(lease.get('township'))
    w_rng = normalize_range(well.get('range'))
    l_rng = normalize_range(lease.get('range'))

    return (w_sec == l_sec and w_twp == l_twp and w_rng == l_rng)


def calculate_name_score(well_key, lease_key):
    """
    Calculate name similarity (0-50 points).
    """
    if not well_key or not lease_key:
        return 0

    # Exact match
    if well_key == lease_key:
        return 50

    well_base = get_base_name(well_key)
    lease_base = get_base_name(lease_key)
    well_nums = re.sub(r'[A-Z]', '', well_key)
    lease_nums = re.sub(r'[A-Z]', '', lease_key)

    # Base name exact match
    base_exact = (well_base == lease_base)

    # Base name contains
    base_contains = (well_base in lease_base or lease_base in well_base)

    # Numbers match
    nums_exact = (well_nums == lease_nums) if (well_nums and lease_nums) else False
    nums_overlap = False
    if well_nums and lease_nums:
        # Check if one is contained in the other (e.g., "1" in "119")
        nums_overlap = (well_nums in lease_nums or lease_nums in well_nums)

    # Scoring
    if base_exact and nums_exact:
        return 50
    elif base_exact and nums_overlap:
        return 45
    elif base_exact:
        return 40  # Same name, different/no numbers
    elif base_contains and nums_exact:
        return 40
    elif base_contains and nums_overlap:
        return 35
    elif base_contains:
        return 25

    return 0


def calculate_trs_score(well, lease):
    """Calculate TRS match (0-40 points)."""
    w_sec = str(well.get('section', ''))
    l_sec = str(lease.get('section', ''))
    w_twp = normalize_township(well.get('township'))
    l_twp = normalize_township(lease.get('township'))
    w_rng = normalize_range(well.get('range'))
    l_rng = normalize_range(lease.get('range'))

    matches = sum([
        w_sec == l_sec if w_sec and l_sec else False,
        w_twp == l_twp if w_twp and l_twp else False,
        w_rng == l_rng if w_rng and l_rng else False,
    ])

    if matches == 3:
        return 40
    elif matches == 2:
        return 25
    elif matches == 1:
        return 10
    return 0


def calculate_county_score(well_county, lease_county):
    wc = normalize_county(well_county)
    lc = normalize_county(lease_county)
    return 10 if (wc and lc and wc == lc) else 0


def query_d1(sql):
    """Run a D1 query and return results."""
    result = subprocess.run(
        ['wrangler', 'd1', 'execute', 'oklahoma-wells', '--remote', '--command', sql, '--json'],
        capture_output=True, text=True, timeout=120
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
    print("=" * 70)
    print("WEIGHTED PUN MATCHING (Portfolio Focus)")
    print("=" * 70)

    # ── Step 1: Get YOUR portfolio's unlinked wells ──
    print("\nStep 1: Loading your portfolio's unlinked wells...")

    # Get unlinked wells from client_wells that exist in global wells table
    wells = query_d1('''
        SELECT w.api_number, w.well_name, w.county, w.section, w.township, w.range
        FROM client_wells cw
        JOIN wells w ON cw.api_number = w.api_number
        LEFT JOIN well_pun_links wpl ON cw.api_number = wpl.api_number
        WHERE cw.organization_id IS NOT NULL
          AND wpl.api_number IS NULL
          AND w.well_name IS NOT NULL
    ''')

    print(f"  Found {len(wells)} unlinked portfolio wells")

    if not wells:
        print("\nNo unlinked wells in your portfolio. Nothing to do.")
        return

    # ── Step 2: For each well, find candidate PUNs in same county ──
    print("\nStep 2: Finding candidate PUNs for each well...")

    # Get unique counties from unlinked wells
    counties = set()
    for w in wells:
        c = normalize_county(w.get('county', ''))
        if c:
            counties.add(c)

    print(f"  Counties to search: {', '.join(sorted(counties))}")

    # Load PUNs for those counties
    all_puns = []
    for county in counties:
        puns = query_d1(f'''
            SELECT DISTINCT pun, base_pun, lease_name, county, section, township, range
            FROM otc_leases
            WHERE county = '{county}'
              AND lease_name IS NOT NULL AND lease_name <> ''
        ''')
        all_puns.extend(puns)
        print(f"    {county}: {len(puns)} PUNs")

    print(f"  Total candidate PUNs: {len(all_puns)}")

    # Index PUNs by county
    pun_by_county = defaultdict(list)
    for p in all_puns:
        county = normalize_county(p.get('county', ''))
        match_key = create_match_key(p.get('lease_name', ''))
        if len(get_base_name(match_key)) >= 3:
            pun_by_county[county].append({
                'pun': p['pun'],
                'base_pun': p['base_pun'],
                'lease_name': p['lease_name'],
                'match_key': match_key,
                'county': county,
                'section': p.get('section'),
                'township': p.get('township', ''),
                'range': p.get('range', ''),
            })

    # ── Step 3: Score and match ──
    print("\nStep 3: Scoring matches...")

    auto_links = []
    manual_review = []
    no_match = []

    for well in wells:
        well_name = well.get('well_name', '')
        well_key = create_match_key(well_name)
        well_base = get_base_name(well_key)
        well_county = normalize_county(well.get('county', ''))

        if len(well_base) < 3 or well_base in SKIP_NAMES:
            no_match.append({'well': well, 'reason': 'name too short/generic'})
            continue

        candidates = pun_by_county.get(well_county, [])
        if not candidates:
            no_match.append({'well': well, 'reason': 'no PUNs in county'})
            continue

        best_match = None
        best_score = 0

        for lease in candidates:
            name_score = calculate_name_score(well_key, lease['match_key'])
            trs_score = calculate_trs_score(well, lease)
            county_score = calculate_county_score(well['county'], lease['county'])

            total = name_score + trs_score + county_score

            if total > best_score:
                best_score = total
                best_match = {
                    'lease': lease,
                    'score': total,
                    'name_score': name_score,
                    'trs_score': trs_score,
                    'county_score': county_score,
                }

        result = {
            'well': well,
            'well_key': well_key,
            'match': best_match,
        }

        if best_score > 90:
            auto_links.append(result)
        elif best_score >= 70:
            manual_review.append(result)
        else:
            no_match.append({'well': well, 'reason': f'best score {best_score}', 'match': best_match})

    # ── Results ──
    print("\n" + "=" * 70)
    print("RESULTS")
    print("=" * 70)
    print(f"  Auto-link (>90%):       {len(auto_links)}")
    print(f"  Manual review (70-89%): {len(manual_review)}")
    print(f"  No match (<70%):        {len(no_match)}")

    # Show auto-links
    if auto_links:
        print("\n── AUTO-LINKS (>90%) ──")
        for r in auto_links:
            w = r['well']
            m = r['match']
            l = m['lease']
            print(f"\n  Well: {w['well_name']}")
            print(f"    API: {w['api_number']}")
            print(f"    TRS: S{w['section']} T{w['township']} R{w['range']}")
            print(f"    Key: {r['well_key']}")
            print(f"  → Lease: {l['lease_name']}")
            print(f"    PUN: {l['pun']}")
            print(f"    TRS: S{l['section']} T{l['township']} R{l['range']}")
            print(f"    Key: {l['match_key']}")
            print(f"    Score: {m['score']} (name:{m['name_score']} trs:{m['trs_score']} county:{m['county_score']})")

    # Show manual reviews
    if manual_review:
        print("\n── MANUAL REVIEW (70-89%) ──")
        for r in manual_review:
            w = r['well']
            m = r['match']
            l = m['lease']
            print(f"\n  Well: {w['well_name']}")
            print(f"    API: {w['api_number']}")
            print(f"    TRS: S{w['section']} T{w['township']} R{w['range']}")
            print(f"    Key: {r['well_key']}")
            print(f"  → Lease: {l['lease_name']}")
            print(f"    PUN: {l['pun']}")
            print(f"    TRS: S{l['section']} T{l['township']} R{l['range']}")
            print(f"    Key: {l['match_key']}")
            print(f"    Score: {m['score']} (name:{m['name_score']} trs:{m['trs_score']} county:{m['county_score']})")

    # Show no-matches
    if no_match:
        print("\n── NO MATCH (<70%) ──")
        for r in no_match[:10]:
            w = r['well']
            reason = r.get('reason', 'unknown')
            print(f"\n  Well: {w['well_name']}")
            print(f"    API: {w['api_number']}")
            print(f"    TRS: S{w.get('section')} T{w.get('township')} R{w.get('range')}")
            print(f"    Reason: {reason}")
            if r.get('match'):
                m = r['match']
                l = m['lease']
                print(f"    Best candidate: {l['lease_name']} (score: {m['score']})")

    # ── Generate SQL ──
    if not auto_links and not manual_review:
        print("\nNo links to create.")
        return

    print(f"\n── GENERATING SQL ──")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for f in os.listdir(OUTPUT_DIR):
        if f.endswith('.sql') or f.endswith('.txt'):
            os.remove(os.path.join(OUTPUT_DIR, f))

    sql_lines = []

    for r in auto_links:
        w = r['well']
        m = r['match']
        l = m['lease']
        sql = (
            f"INSERT OR IGNORE INTO well_pun_links "
            f"(api_number, pun, base_pun, match_method, confidence, "
            f"confidence_score, lease_name, match_source, link_status, needs_review) VALUES ("
            f"'{escape_sql(w['api_number'])}', "
            f"'{escape_sql(l['pun'])}', "
            f"'{escape_sql(l['base_pun'])}', "
            f"'weighted_auto', 'high', "
            f"{m['score'] / 100.0:.2f}, "
            f"'{escape_sql(l['lease_name'])}', "
            f"'otc_leases_weighted', 'proposed', 0);"
        )
        sql_lines.append(sql)

    for r in manual_review:
        w = r['well']
        m = r['match']
        l = m['lease']
        sql = (
            f"INSERT OR IGNORE INTO well_pun_links "
            f"(api_number, pun, base_pun, match_method, confidence, "
            f"confidence_score, lease_name, match_source, link_status, needs_review) VALUES ("
            f"'{escape_sql(w['api_number'])}', "
            f"'{escape_sql(l['pun'])}', "
            f"'{escape_sql(l['base_pun'])}', "
            f"'weighted_review', 'medium', "
            f"{m['score'] / 100.0:.2f}, "
            f"'{escape_sql(l['lease_name'])}', "
            f"'otc_leases_weighted', 'proposed', 1);"
        )
        sql_lines.append(sql)

    # Write SQL file
    sql_file = f"{OUTPUT_DIR}/batch_0001.sql"
    with open(sql_file, 'w') as f:
        f.write('\n'.join(sql_lines))

    print(f"  Created: {sql_file}")
    print(f"  Total statements: {len(sql_lines)}")

    # Write review report
    if manual_review:
        report_file = f"{OUTPUT_DIR}/manual_review.txt"
        with open(report_file, 'w') as f:
            f.write("WELLS REQUIRING MANUAL REVIEW\n")
            f.write("=" * 60 + "\n\n")
            for r in manual_review:
                w = r['well']
                m = r['match']
                l = m['lease']
                f.write(f"Well: {w['well_name']}\n")
                f.write(f"  API: {w['api_number']}\n")
                f.write(f"  TRS: S{w['section']} T{w['township']} R{w['range']}\n")
                f.write(f"\n")
                f.write(f"  Proposed: {l['lease_name']}\n")
                f.write(f"  PUN: {l['pun']}\n")
                f.write(f"  TRS: S{l['section']} T{l['township']} R{l['range']}\n")
                f.write(f"  Score: {m['score']}%\n")
                f.write(f"\n" + "-" * 40 + "\n\n")
        print(f"  Created: {report_file}")

    print(f"\nTo execute:")
    print(f"  ./load-remaining.sh weighted-link-batches 0")


if __name__ == '__main__':
    main()
