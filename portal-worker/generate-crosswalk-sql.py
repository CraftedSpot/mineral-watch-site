#!/usr/bin/env python3
"""
Generate SQL queries to match extracted crosswalk data to wells.
Outputs individual SELECT queries that can be used to find matches.
"""

import json
import re

def normalize_township(twp):
    """Normalize township to format like '16N'."""
    if not twp:
        return None
    twp = str(twp).upper()
    # Remove leading zeros and dashes
    twp = re.sub(r'^0+', '', twp)
    twp = re.sub(r'-', '', twp)
    match = re.search(r'(\d+)\s*([NS])', twp)
    if match:
        return f"{match.group(1)}{match.group(2)}"
    match = re.search(r'(\d+)', twp)
    if match:
        return f"{match.group(1)}N"
    return None

def normalize_range(rng):
    """Normalize range to format like '13W'."""
    if not rng:
        return None
    rng = str(rng).upper()
    # Remove leading zeros and dashes
    rng = re.sub(r'^0+', '', rng)
    rng = re.sub(r'-', '', rng)
    match = re.search(r'(\d+)\s*([EW])', rng)
    if match:
        return f"{match.group(1)}{match.group(2)}"
    match = re.search(r'(\d+)', rng)
    if match:
        return f"{match.group(1)}W"
    return None

def normalize_section(sec):
    """Normalize section to integer."""
    if not sec:
        return None
    # Handle written numbers
    written = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
        'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14,
        'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18,
        'nineteen': 19, 'twenty': 20
    }
    sec_lower = str(sec).lower()
    for word, num in written.items():
        if word in sec_lower:
            return num
    match = re.search(r'(\d+)', str(sec))
    if match:
        return int(match.group(1))
    return None

def normalize_county(county):
    """Normalize county name."""
    if not county:
        return None
    county = str(county).upper()
    county = re.sub(r'\s*COUNTY\s*$', '', county)
    return county.strip()

def extract_base_name(well_name):
    """Extract base well name for LIKE matching."""
    if not well_name:
        return None
    # Remove numbers and special chars to get base name
    name = well_name.upper()
    # Extract the main word(s) before numbers
    match = re.match(r'^([A-Z]+(?:\s+[A-Z]+)?)', name)
    if match:
        return match.group(1).strip()
    return name[:10] if len(name) > 10 else name

def main():
    # Read dry-run results
    with open('/tmp/crosswalk_dryrun_results.json', 'r') as f:
        mappings = json.load(f)

    print(f"-- Processing {len(mappings)} crosswalk mappings")
    print(f"-- Looking for mappings with well names or API numbers\n")

    candidates = []

    for m in mappings:
        well_name = m.get('well_name')
        api = m.get('api_number')

        if not (well_name or api):
            continue

        # Normalize TRS
        section = normalize_section(m.get('section'))
        township = normalize_township(m.get('township'))
        range_val = normalize_range(m.get('range'))
        county = normalize_county(m.get('county'))

        # Dedupe by unique combination
        key = (well_name, api, county, section, township, range_val)
        if key not in [c['key'] for c in candidates]:
            candidates.append({
                'key': key,
                'mapping': m,
                'well_name': well_name,
                'api': api,
                'section': section,
                'township': township,
                'range': range_val,
                'county': county
            })

    print(f"-- Found {len(candidates)} unique candidates to match\n")

    # Generate queries for each candidate
    for i, c in enumerate(candidates):
        print(f"-- Candidate {i+1}: {c['well_name'] or 'N/A'} ({c['mapping'].get('source_type')})")

        base_name = extract_base_name(c['well_name'])

        conditions = []
        if c['county']:
            conditions.append(f"county = '{c['county']}'")
        if c['section']:
            conditions.append(f"section = {c['section']}")
        if c['township']:
            conditions.append(f"township = '{c['township']}'")
        if c['range']:
            conditions.append(f"range = '{c['range']}'")
        if base_name:
            conditions.append(f"well_name LIKE '%{base_name}%'")

        if conditions:
            where = " AND ".join(conditions)
            print(f"SELECT api_number, well_name, operator, county, section, township, range FROM wells WHERE {where} LIMIT 5;")
        print()

if __name__ == "__main__":
    main()
