#!/usr/bin/env python3
"""
Enhanced PUN crosswalk matching — 4 tiers of matching for wells missing PUN links.

Tier 1: Parenthetical name extraction — "RMU (GRIFFITH #1)" → extract "GRIFFITH"
Tier 2: Operator + TRS with alias resolution — resolve operator names → numbers
Tier 3: Enhanced name normalization — strip ##, unit prefixes, number containment
Tier 4: Reverse PUN lookup — start from producing PUNs, find unlinked wells at same TRS

Each tier produces SQL batch files in separate directories for selective execution.
Cascading exclusion: each tier marks matched APIs so lower tiers skip them.
"""

import os
import subprocess
import json
import re
import sys
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

NOISE_NAMES = {
    'UNKNOWN', 'UNKNOWNSOURCE', 'NONAME', 'NONE', 'NA',
    'TEST', 'TESTING', 'TESTWELL', 'FEE', 'STATE', 'UNIT',
    'COMM', 'COMMUNITY', 'FEDERAL', 'GOVERNMENT',
}


def escape_sql(s):
    if s is None:
        return ''
    return str(s).replace("'", "''")


def normalize_name(name):
    if not name:
        return ''
    return re.sub(r'[^A-Z0-9]', '', name.upper().strip())


def alpha_only(name):
    return re.sub(r'[0-9]', '', name)


def is_noise(alpha_name):
    if len(alpha_name) < 3:
        return True
    if alpha_name in NOISE_NAMES:
        return True
    if alpha_name.startswith('TRACT') or alpha_name.startswith('UNKNOWN'):
        return True
    return False


def enhanced_normalize(name):
    """Enhanced normalization: extract base alpha + numbers, strip unit prefixes."""
    name = name.upper().strip()
    # Strip ## as a unit
    name = name.replace('##', '')
    # Strip unit prefixes (RMU, SCMU, etc.)
    name = re.sub(r'^[A-Z]{2,5}MU\b\s*', '', name)
    # Strip common suffixes
    name = re.sub(r'\b(UNIT|UT|UN|FEDERAL|FED|LEASE|LSE|ESTATE|EST)\b', '', name)
    # Extract base (alpha only) and numbers
    base = re.sub(r'[^A-Z]', '', name)
    numbers = re.findall(r'\d+', name)
    return base, numbers


def extract_paren_name(well_name):
    """Extract the name inside parentheses, if present."""
    match = re.search(r'\(([^)]+)\)', well_name)
    if not match:
        return None
    inner = match.group(1)
    # Only use if contains a name (at least 3 alpha chars)
    alpha = re.sub(r'[^A-Z]', '', inner.upper())
    if len(alpha) >= 3 and not is_noise(alpha):
        return alpha
    return None


def normalize_township(twn):
    """Normalize township: '21N' stays '21N', extract from various formats."""
    if not twn:
        return ''
    twn = str(twn).upper().strip()
    m = re.match(r'(\d+)\s*([NS])', twn)
    if m:
        return f"{int(m.group(1))}{m.group(2)}"
    return twn


def normalize_range(rng):
    """Normalize range: '15W' stays '15W'."""
    if not rng:
        return ''
    rng = str(rng).upper().strip()
    m = re.match(r'(\d+)\s*([EW])', rng)
    if m:
        return f"{int(m.group(1))}{m.group(2)}"
    return rng


def normalize_section(sec):
    """Normalize section to integer string."""
    if sec is None:
        return ''
    try:
        return str(int(sec))
    except (ValueError, TypeError):
        return str(sec).strip()


def trs_key(county, section, township, rng):
    return (county.upper() if county else '', normalize_section(section),
            normalize_township(township), normalize_range(rng))


def query_d1(sql, label=""):
    """Run a D1 query and return results."""
    if label:
        print(f"  Querying: {label}...")
    result = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', 'oklahoma-wells', '--remote', '--command', sql, '--json'],
        capture_output=True, text=True, cwd=BASE_DIR
    )
    if result.returncode != 0:
        print(f"  Error: {result.stderr[:500]}")
        return []
    try:
        data = json.loads(result.stdout)
        results = data[0].get('results', [])
        if label:
            print(f"    → {len(results):,} records")
        return results
    except (json.JSONDecodeError, IndexError, KeyError):
        print(f"  Parse error: {result.stdout[:200]}")
        return []


def write_batch(links, batch_dir, batch_size=500):
    """Write INSERT OR IGNORE SQL batch files."""
    os.makedirs(batch_dir, exist_ok=True)
    batch_num = 0
    for i in range(0, len(links), batch_size):
        batch_num += 1
        batch = links[i:i + batch_size]
        filename = os.path.join(batch_dir, f"batch_{batch_num:04d}.sql")
        with open(filename, 'w') as f:
            for link in batch:
                f.write(
                    f"INSERT OR IGNORE INTO well_pun_links "
                    f"(api_number, pun, base_pun, match_method, confidence, "
                    f"confidence_score, lease_name, match_source, link_status, created_at) "
                    f"VALUES ('{escape_sql(link['api'])}', '{escape_sql(link['pun'])}', "
                    f"'{escape_sql(link['base_pun'])}', '{escape_sql(link['method'])}', "
                    f"'{escape_sql(link['confidence'])}', {link['score']}, "
                    f"'{escape_sql(link['lease_name'])}', '{escape_sql(link['source'])}', "
                    f"'proposed', datetime('now'));\n"
                )
    print(f"  Written {batch_num} batch files to {batch_dir}/ ({len(links)} links)")
    return batch_num


def main():
    print("=" * 70)
    print("Enhanced PUN Crosswalk Matching")
    print("=" * 70)

    # ── Load data ──
    print("\n--- Loading Data ---")

    wells = query_d1(
        "SELECT w.api_number, w.well_name, w.county, w.section, w.township, w.range, "
        "w.operator, w.well_type, w.formation_canonical "
        "FROM wells w "
        "WHERE w.well_name IS NOT NULL AND w.well_name <> '' "
        "AND w.api_number NOT IN (SELECT api_number FROM well_pun_links) "
        "AND w.well_status NOT IN ('PA', 'PLUGGED')",
        "Unlinked wells"
    )

    leases = query_d1(
        "SELECT pun, base_pun, lease_name, county, section, township, range, "
        "operator_number, well_classification FROM otc_leases "
        "WHERE lease_name IS NOT NULL AND lease_name <> ''",
        "OTC leases"
    )

    aliases = query_d1(
        "SELECT alias_name, canonical_operator_number FROM operator_aliases",
        "Operator aliases"
    )

    companies = query_d1(
        "SELECT company_id, company_name FROM otc_companies",
        "OTC companies"
    )

    # ── Build indexes ──
    print("\n--- Building Indexes ---")

    leases_by_trs = defaultdict(list)
    leases_by_county_name = defaultdict(list)
    for l in leases:
        k = trs_key(l['county'], l['section'], l['township'], l['range'])
        leases_by_trs[k].append(l)
        name_norm = alpha_only(normalize_name(l['lease_name']))
        if name_norm and len(name_norm) >= 3:
            leases_by_county_name[(l['county'].upper() if l['county'] else '', name_norm)].append(l)

    alias_map = {}
    for a in aliases:
        key = re.sub(r'[^A-Z0-9]', '', (a['alias_name'] or '').upper())
        alias_map[key] = a['canonical_operator_number']

    company_map = {}
    for c in companies:
        key = re.sub(r'[^A-Z0-9]', '', (c['company_name'] or '').upper())
        company_map[key] = c['company_id']

    print(f"  Lease TRS index: {len(leases_by_trs):,} keys")
    print(f"  Lease name index: {len(leases_by_county_name):,} keys")
    print(f"  Alias map: {len(alias_map):,} entries")
    print(f"  Company map: {len(company_map):,} entries")

    matched_apis = set()
    all_links = {1: [], 2: [], 3: [], 4: []}

    WELL_TYPE_MAP = {
        'OIL': '107', 'GAS': '108', 'INJ': '109', 'SWD': '109', 'WSW': '109',
    }

    # ══════════════════════════════════════════════════════════════════════
    # TIER 1: Parenthetical Name Extraction
    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 70)
    print("TIER 1: Parenthetical Name Extraction")
    print("=" * 70)

    for w in wells:
        if w['api_number'] in matched_apis:
            continue
        paren_name = extract_paren_name(w['well_name'])
        if not paren_name:
            continue

        k = trs_key(w['county'], w['section'], w['township'], w['range'])
        candidates = leases_by_trs.get(k, [])
        if not candidates:
            continue

        # Match paren name against lease names at same TRS
        best = None
        for lease in candidates:
            lease_alpha = re.sub(r'[^A-Z]', '', lease['lease_name'].upper())
            if paren_name == lease_alpha or (len(paren_name) >= 4 and paren_name in lease_alpha):
                if best is None or len(lease_alpha) < len(best['lease_alpha']):
                    best = {'lease': lease, 'lease_alpha': lease_alpha}

        if best:
            lease = best['lease']
            # Deduplicate: skip if this base_pun already linked for this API
            all_links[1].append({
                'api': w['api_number'], 'pun': lease['pun'], 'base_pun': lease['base_pun'],
                'method': 'paren_extract_trs', 'confidence': 'high', 'score': 0.90,
                'lease_name': lease['lease_name'], 'source': 'enhanced_crosswalk_t1',
            })
            matched_apis.add(w['api_number'])
            print(f"  ✓ {w['api_number']} {w['well_name'][:40]} → {lease['lease_name']} ({lease['base_pun']}) [0.90]")

    print(f"\nTier 1 total: {len(all_links[1])} new links")

    # ══════════════════════════════════════════════════════════════════════
    # TIER 2: Operator + TRS with Alias Resolution
    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 70)
    print("TIER 2: Operator + TRS with Alias Resolution")
    print("=" * 70)

    for w in wells:
        if w['api_number'] in matched_apis:
            continue
        if not w.get('operator'):
            continue

        # Resolve operator name → number
        op_norm = re.sub(r'[^A-Z0-9]', '', w['operator'].upper())
        op_number = alias_map.get(op_norm)
        if not op_number:
            # Try company map
            op_number = company_map.get(op_norm)
        if not op_number:
            # Try first-word prefix match
            words = re.findall(r'[A-Z]{3,}', op_norm)
            if words:
                for ckey, cid in company_map.items():
                    if ckey.startswith(words[0]) and len(words[0]) >= 4:
                        op_number = cid
                        break
        if not op_number:
            continue

        k = trs_key(w['county'], w['section'], w['township'], w['range'])
        candidates = [l for l in leases_by_trs.get(k, []) if l.get('operator_number') == op_number]
        if not candidates:
            continue

        # Deduplicate by base_pun
        seen_puns = {}
        for c in candidates:
            bp = c['base_pun']
            if bp not in seen_puns:
                seen_puns[bp] = c

        unique_puns = list(seen_puns.values())

        if len(unique_puns) == 1:
            lease = unique_puns[0]
            all_links[2].append({
                'api': w['api_number'], 'pun': lease['pun'], 'base_pun': lease['base_pun'],
                'method': 'operator_alias_trs', 'confidence': 'high', 'score': 0.85,
                'lease_name': lease['lease_name'], 'source': 'enhanced_crosswalk_t2',
            })
            matched_apis.add(w['api_number'])
            print(f"  ✓ {w['api_number']} {w['well_name'][:35]} → {lease['lease_name']} ({lease['base_pun']}) [op+trs 0.85]")
        elif len(unique_puns) == 2:
            # Try well_classification tiebreaker
            well_class = WELL_TYPE_MAP.get((w.get('well_type') or '').upper())
            if well_class:
                filtered = [p for p in unique_puns if p.get('well_classification') == well_class]
                if len(filtered) == 1:
                    lease = filtered[0]
                    all_links[2].append({
                        'api': w['api_number'], 'pun': lease['pun'], 'base_pun': lease['base_pun'],
                        'method': 'operator_alias_trs_welltype', 'confidence': 'high', 'score': 0.80,
                        'lease_name': lease['lease_name'], 'source': 'enhanced_crosswalk_t2',
                    })
                    matched_apis.add(w['api_number'])
                    print(f"  ✓ {w['api_number']} {w['well_name'][:35]} → {lease['lease_name']} ({lease['base_pun']}) [op+trs+type 0.80]")

    print(f"\nTier 2 total: {len(all_links[2])} new links")

    # ══════════════════════════════════════════════════════════════════════
    # TIER 3: Enhanced Name Normalization
    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 70)
    print("TIER 3: Enhanced Name Normalization")
    print("=" * 70)

    for w in wells:
        if w['api_number'] in matched_apis:
            continue

        base, numbers = enhanced_normalize(w['well_name'])
        if is_noise(base):
            continue

        k = trs_key(w['county'], w['section'], w['township'], w['range'])
        candidates = leases_by_trs.get(k, [])
        if not candidates:
            continue

        best = None
        for lease in candidates:
            lease_base, lease_numbers = enhanced_normalize(lease['lease_name'])
            if not lease_base or is_noise(lease_base):
                continue

            # Exact base match
            if base == lease_base:
                score = 0.75
                method = 'enhanced_name_trs'
                if best is None or score > best['score']:
                    best = {'lease': lease, 'score': score, 'method': method}
                continue

            # Letter suffix tolerance: "DAVIDSONA" matches "DAVIDSON"
            # BUT only if no other lettered variants exist
            if (base.startswith(lease_base) and len(base) - len(lease_base) == 1
                    and base[-1].isalpha()):
                # Check for other lettered variants at same TRS
                other_variants = [c for c in candidates
                                  if re.sub(r'[^A-Z]', '', c['lease_name'].upper()).startswith(lease_base)
                                  and re.sub(r'[^A-Z]', '', c['lease_name'].upper()) != lease_base
                                  and c['base_pun'] != lease['base_pun']]
                if not other_variants:
                    score = 0.65
                    method = 'enhanced_name_suffix'
                    if best is None or score > best['score']:
                        best = {'lease': lease, 'score': score, 'method': method}

        if best:
            lease = best['lease']
            all_links[3].append({
                'api': w['api_number'], 'pun': lease['pun'], 'base_pun': lease['base_pun'],
                'method': best['method'], 'confidence': 'medium' if best['score'] < 0.75 else 'high',
                'score': best['score'],
                'lease_name': lease['lease_name'], 'source': 'enhanced_crosswalk_t3',
            })
            matched_apis.add(w['api_number'])
            print(f"  ✓ {w['api_number']} {w['well_name'][:35]} → {lease['lease_name']} ({lease['base_pun']}) [{best['method']} {best['score']}]")

    print(f"\nTier 3 total: {len(all_links[3])} new links")

    # ══════════════════════════════════════════════════════════════════════
    # TIER 4: Reverse PUN Lookup
    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 70)
    print("TIER 4: Reverse PUN Lookup")
    print("=" * 70)

    # Build unlinked wells index by TRS for reverse lookup
    unlinked_by_trs = defaultdict(list)
    for w in wells:
        if w['api_number'] in matched_apis:
            continue
        k = trs_key(w['county'], w['section'], w['township'], w['range'])
        unlinked_by_trs[k].append(w)

    # Find PUNs with no well link
    orphan_puns = query_d1(
        "SELECT DISTINCT ol.base_pun, ol.pun, ol.lease_name, ol.county, "
        "ol.section, ol.township, ol.range "
        "FROM otc_leases ol "
        "WHERE ol.base_pun NOT IN (SELECT base_pun FROM well_pun_links WHERE base_pun IS NOT NULL) "
        "AND EXISTS (SELECT 1 FROM otc_production op WHERE op.base_pun = ol.base_pun AND op.year_month >= '202401')",
        "Orphan PUNs with recent production"
    )

    for pun_rec in orphan_puns:
        k = trs_key(pun_rec['county'], pun_rec['section'], pun_rec['township'], pun_rec['range'])
        matching_wells = unlinked_by_trs.get(k, [])

        if len(matching_wells) == 1:
            w = matching_wells[0]
            if w['api_number'] not in matched_apis:
                all_links[4].append({
                    'api': w['api_number'], 'pun': pun_rec['pun'], 'base_pun': pun_rec['base_pun'],
                    'method': 'reverse_trs_unique', 'confidence': 'medium', 'score': 0.80,
                    'lease_name': pun_rec['lease_name'], 'source': 'enhanced_crosswalk_t4',
                })
                matched_apis.add(w['api_number'])
                print(f"  ✓ {w['api_number']} {w['well_name'][:35]} ← {pun_rec['lease_name']} ({pun_rec['base_pun']}) [reverse 0.80]")

    print(f"\nTier 4 total: {len(all_links[4])} new links")

    # ══════════════════════════════════════════════════════════════════════
    # Write batch files
    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 70)
    print("Writing Batch Files")
    print("=" * 70)

    total = 0
    for tier in [1, 2, 3, 4]:
        links = all_links[tier]
        if links:
            batch_dir = os.path.join(BASE_DIR, f"enhanced-links-tier{tier}")
            write_batch(links, batch_dir)
            total += len(links)

    print(f"\n{'=' * 70}")
    print(f"TOTAL: {total} new links across {sum(1 for t in all_links.values() if t)} tiers")
    print(f"  Tier 1 (parenthetical): {len(all_links[1])}")
    print(f"  Tier 2 (operator+TRS):  {len(all_links[2])}")
    print(f"  Tier 3 (enhanced name): {len(all_links[3])}")
    print(f"  Tier 4 (reverse PUN):   {len(all_links[4])}")
    print(f"\nRun: ./load-remaining.sh enhanced-links-tierN 0")
    print(f"{'=' * 70}")


if __name__ == '__main__':
    main()
