#!/usr/bin/env python3
"""
Match extracted crosswalk data to wells in the database.
Outputs SQL INSERT statements for curated_mappings table.
"""

import json
import re
import sys

# Confidence tiers
CONFIDENCE_HIGH = 0.9
CONFIDENCE_MEDIUM = 0.7
CONFIDENCE_LOW = 0.5

def normalize_well_name(name):
    """Normalize well name for comparison."""
    if not name:
        return ""
    # Remove common variations
    name = name.upper()
    name = re.sub(r'[#\s-]+', '', name)  # Remove #, spaces, dashes
    name = re.sub(r'(\d)H$', r'\1H', name)  # Normalize horizontal designator
    return name

def normalize_api(api):
    """Normalize API to 10-digit format without dashes."""
    if not api:
        return None
    # Remove all non-digits
    api = re.sub(r'\D', '', str(api))
    # Oklahoma APIs start with 35, should be 10 digits
    if api.startswith('35') and len(api) >= 10:
        return api[:10]
    return None

def normalize_township(twp):
    """Normalize township to format like '16N'."""
    if not twp:
        return None
    twp = str(twp).upper()
    # Extract number and direction
    match = re.search(r'(\d+)\s*([NS])', twp)
    if match:
        return f"{match.group(1)}{match.group(2)}"
    # Just a number - assume North
    match = re.search(r'(\d+)', twp)
    if match:
        return f"{match.group(1)}N"
    return None

def normalize_range(rng):
    """Normalize range to format like '13W'."""
    if not rng:
        return None
    rng = str(rng).upper()
    # Extract number and direction
    match = re.search(r'(\d+)\s*([EW])', rng)
    if match:
        return f"{match.group(1)}{match.group(2)}"
    # Just a number - assume West
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
    # Extract first number
    match = re.search(r'(\d+)', str(sec))
    if match:
        return int(match.group(1))
    return None

def normalize_county(county):
    """Normalize county name."""
    if not county:
        return None
    county = str(county).upper()
    # Remove "COUNTY" suffix
    county = re.sub(r'\s*COUNTY\s*$', '', county)
    return county.strip()

def main():
    # Read dry-run results
    with open('/tmp/crosswalk_dryrun_results.json', 'r') as f:
        mappings = json.load(f)

    # Read wells data
    if len(sys.argv) > 1:
        with open(sys.argv[1], 'r') as f:
            raw = f.read()
    else:
        print("Usage: python3 match-crosswalk-to-wells.py wells_export.json")
        return

    # Parse wells JSON
    start = raw.find('[')
    data = json.loads(raw[start:])
    if isinstance(data, list) and len(data) > 0:
        wells = data[0].get('results', [])
    else:
        wells = []

    print(f"Loaded {len(mappings)} crosswalk mappings")
    print(f"Loaded {len(wells)} wells")
    print()

    # Build wells index by TRS
    wells_by_trs = {}
    for well in wells:
        twp = normalize_township(well.get('township'))
        rng = normalize_range(well.get('range'))
        sec = well.get('section')
        county = normalize_county(well.get('county'))

        if twp and rng and sec:
            key = (county, sec, twp, rng)
            if key not in wells_by_trs:
                wells_by_trs[key] = []
            wells_by_trs[key].append(well)

    print(f"Built TRS index with {len(wells_by_trs)} unique locations")
    print()

    # Try to match each mapping
    matches = []
    no_match = []

    for mapping in mappings:
        # Skip if no useful data
        well_name = mapping.get('well_name')
        api = mapping.get('api_number')
        section = normalize_section(mapping.get('section'))
        township = normalize_township(mapping.get('township'))
        range_val = normalize_range(mapping.get('range'))
        county = normalize_county(mapping.get('county'))

        if not (well_name or api):
            continue

        # Try to find matching wells
        trs_key = (county, section, township, range_val)
        candidates = wells_by_trs.get(trs_key, [])

        best_match = None
        match_confidence = 0
        match_method = None

        # Try API match first (highest confidence)
        if api:
            norm_api = normalize_api(api)
            if norm_api:
                for well in wells:  # Search all wells for API match
                    if normalize_api(well.get('api_number')) == norm_api:
                        best_match = well
                        match_confidence = CONFIDENCE_HIGH
                        match_method = 'api_exact'
                        break

        # Try well name + TRS match
        if not best_match and well_name and candidates:
            norm_name = normalize_well_name(well_name)
            for well in candidates:
                well_norm = normalize_well_name(well.get('well_name', ''))
                # Check for substring match
                if norm_name and well_norm:
                    # Extract base name (without numbers)
                    base_extracted = re.sub(r'\d+.*$', '', norm_name)
                    base_well = re.sub(r'\d+.*$', '', well_norm)
                    if base_extracted and base_well:
                        if base_extracted in well_norm or base_well in norm_name:
                            best_match = well
                            match_confidence = CONFIDENCE_MEDIUM
                            match_method = 'name_trs'
                            break

        if best_match:
            matches.append({
                'mapping': mapping,
                'well': best_match,
                'confidence': match_confidence,
                'method': match_method
            })
        else:
            no_match.append(mapping)

    # Output results
    print("=" * 70)
    print("MATCHING RESULTS")
    print("=" * 70)
    print(f"Total mappings with well name or API: {len(matches) + len(no_match)}")
    print(f"Successfully matched: {len(matches)}")
    print(f"No match found: {len(no_match)}")
    print()

    # Show matches
    print("=== SUCCESSFUL MATCHES ===")
    for i, m in enumerate(matches[:30]):
        mapping = m['mapping']
        well = m['well']
        print(f"\n--- Match {i+1} (method: {m['method']}, conf: {m['confidence']}) ---")
        print(f"Document: {mapping.get('source_type')} - {mapping.get('filename')}")
        print(f"  Extracted: {mapping.get('well_name') or 'N/A'} | API: {mapping.get('api_number') or 'N/A'}")
        print(f"  Matched:   {well.get('well_name')} | API: {well.get('api_number')}")
        print(f"  Operator:  {well.get('operator')}")

    if len(matches) > 30:
        print(f"\n... {len(matches) - 30} more matches")

    # Generate SQL for curated_mappings
    print("\n\n=== SQL INSERT STATEMENTS ===")
    print("-- Paste these into wrangler d1 execute to insert mappings\n")

    for m in matches:
        mapping = m['mapping']
        well = m['well']

        sql = f"""INSERT INTO curated_mappings (
    api_number, well_name, pun, operator,
    section, township, range, county,
    source_type, source_id, confidence, source_quality, review_status
) VALUES (
    '{well.get('api_number')}',
    '{(mapping.get('well_name') or '').replace("'", "''")}',
    NULL,
    '{(well.get('operator') or '').replace("'", "''")}',
    {mapping.get('section') or 'NULL'},
    '{mapping.get('township') or ''}',
    '{mapping.get('range') or ''}',
    '{(mapping.get('county') or '').replace("'", "''")}',
    '{mapping.get('source_type')}',
    '{mapping.get('source_id')}',
    {m['confidence']},
    1,
    'pending'
);"""
        print(sql)
        print()

    # Save full results
    output = {
        'matches': matches,
        'no_match': no_match
    }
    with open('/tmp/crosswalk_matches.json', 'w') as f:
        json.dump(output, f, indent=2, default=str)
    print(f"\nFull results saved to /tmp/crosswalk_matches.json")

if __name__ == "__main__":
    main()
