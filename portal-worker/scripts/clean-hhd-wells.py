#!/usr/bin/env python3
"""
HHD Wells CSV Cleanup Script
Cross-references well names against HHD property data to infer missing TRS locations.

Input:  Mineral Watch well upload - Current.csv (488 wells, many missing API/Location)
Output: Cleaned CSV with inferred Location fields where possible
"""

import csv
import re
import sys
from collections import defaultdict

# ============================================================================
# County abbreviation normalization
# ============================================================================
ABBREV = {
    'ALFA': 'Alfalfa', 'ATOKA': 'Atoka', 'ATOK': 'Atoka', 'BEAV': 'Beaver', 'BECK': 'Beckham',
    'BLAI': 'Blaine', 'BRYA': 'Bryan', 'CADD': 'Caddo', 'CANA': 'Canadian', 'CART': 'Carter',
    'CLEV': 'Cleveland', 'CLEVELND': 'Cleveland', 'COAL': 'Coal', 'CREE': 'Creek',
    'CUST': 'Custer', 'DEWE': 'Dewey', 'ELLI': 'Ellis', 'GARF': 'Garfield', 'GARV': 'Garvin',
    'GRAD': 'Grady', 'HARP': 'Harper', 'HUGH': 'Hughes', 'HUGHES': 'Hughes',
    'JACK': 'Jackson', 'KING': 'Kingfisher', 'KINGFISHER': 'Kingfisher', 'KINGFISHR': 'Kingfisher',
    'LATI': 'Latimer', 'LATIMER': 'Latimer', 'LEFL': 'LeFlore', 'LEFLORE': 'LeFlore',
    'LINC': 'Lincoln', 'LINCOLN': 'Lincoln', 'MAJO': 'Major', 'MAJOR': 'Major',
    'MCCL': 'McClain', 'MCCLAIN': 'McClain', 'MCIN': 'McIntosh', 'MCINTOSH': 'McIntosh',
    'MCKE': 'McKenzie', 'MURR': 'Murray', 'MURRAY': 'Murray',
    'OKFU': 'Okfuskee', 'OKFUSKEE': 'Okfuskee', 'OKLA': 'Oklahoma', 'OKLAHOMA': 'Oklahoma',
    'OKMU': 'Okmulgee', 'OKMULGEE': 'Okmulgee', 'PAYN': 'Payne', 'PAYNE': 'Payne',
    'PITT': 'Pittsburg', 'PITTSBURG': 'Pittsburg', 'PONT': 'Pontotoc', 'PONTOTOC': 'Pontotoc',
    'POTT': 'Pottawatomie', 'ROGM': 'Roger Mills', 'R. MILLS': 'Roger Mills',
    'ROGE': 'Rogers', 'SEMI': 'Seminole', 'SEMINOLE': 'Seminole', 'STEP': 'Stephens',
    'STEPHENS': 'Stephens', 'TEXA': 'Texas', 'TEXAS': 'Texas', 'TILL': 'Tillman',
    'TILLMAN': 'Tillman', 'WASH': 'Washita', 'WASHITA': 'Washita', 'WAST': 'Washita',
    'WASHI': 'Washington', 'WOOD': 'Woodward', 'WOODWRD': 'Woodward', 'WODW': 'Woodward',
    'WOOW': 'Woodward', 'WOODS': 'Woods', 'ALFALFA': 'Alfalfa', 'BECKHAM': 'Beckham',
    'BLAINE': 'Blaine', 'BRYAN': 'Bryan', 'CADDO': 'Caddo', 'CANADIAN': 'Canadian',
    'CARTER': 'Carter', 'CREEK': 'Creek', 'CUSTER': 'Custer', 'DEWEY': 'Dewey',
    'ELLIS': 'Ellis', 'GARFIELD': 'Garfield', 'GARVIN': 'Garvin', 'GRADY': 'Grady',
    'HARPER': 'Harper', 'JACKSON': 'Jackson', 'REEV': 'Reeves',
}

# Out-of-state counties (not in Oklahoma OCC database)
OUT_OF_STATE = {'McKenzie', 'Reeves'}

def norm_county(raw):
    raw = raw.strip().upper()
    if '/' in raw:
        raw = raw.split('/')[0].strip()
    raw = raw.rstrip('.')
    return ABBREV.get(raw, raw.title())


# ============================================================================
# Load HHD property data
# ============================================================================
def load_properties(path):
    """Load properties into: county -> list of {sec, twn_num, twn_dir, rng_num, rng_dir, twn, rng}"""
    props = defaultdict(list)
    with open(path) as f:
        for row in csv.DictReader(f):
            county = norm_county(row.get("County", ""))
            sec = row.get("Section", "").strip()
            twn = row.get("Township", "").strip().upper()
            rng = row.get("Range", "").strip().upper()
            if not (county and sec and twn and rng):
                continue
            sec_m = re.match(r'(\d+)', sec)
            twn_m = re.match(r'(\d+)([NS])', twn)
            rng_m = re.match(r'(\d+)([EW])', rng)
            if sec_m and twn_m and rng_m:
                props[county].append({
                    'sec': int(sec_m.group(1)),
                    'twn_num': int(twn_m.group(1)), 'twn_dir': twn_m.group(2),
                    'rng_num': int(rng_m.group(1)), 'rng_dir': rng_m.group(2),
                    'twn': twn, 'rng': rng
                })
    return props


# ============================================================================
# Well name analysis & TRS extraction
# ============================================================================

def extract_sections_from_name(name):
    """
    Extract candidate section numbers from a well name.
    Handles: standalone numbers, numbers before H/HX/XH/WH/MXH/CH suffixes,
    and slash-separated multi-section patterns like 24/25H.
    """
    candidates = []

    # Pattern: numbers followed by well-type suffix (9H, 27H, 5H, 12XH, etc.)
    # The number before H/HX/XH/WH/MXH/CH is often the section
    for m in re.finditer(r'\b(\d{1,2})(?=[A-Z]*H[A-Z]*\b)', name):
        n = int(m.group(1))
        if 1 <= n <= 36:
            candidates.append(n)

    # Pattern: multi-section like 24/25H or 8/17
    for m in re.finditer(r'\b(\d{1,2})/(\d{1,2})', name):
        for g in [m.group(1), m.group(2)]:
            n = int(g)
            if 1 <= n <= 36:
                candidates.append(n)

    # Pattern: standalone numbers (not part of larger tokens)
    # Be careful: well numbers (1, 2, 3) and unit numbers are also standalone
    for m in re.finditer(r'(?<![#\d])(\b\d{1,2}\b)(?!\d)', name):
        n = int(m.group(1))
        if 1 <= n <= 36:
            candidates.append(n)

    return list(dict.fromkeys(candidates))  # deduplicate, preserve order


def try_4digit_trs(name, county_props):
    """
    Try to decode a 4-digit code as TTRR (township-range).
    Only succeeds if a property exists with matching TWN/RNG numbers.
    Returns (twn, rng) or None.
    """
    m = re.search(r'\b(\d{4})\b', name)
    if not m:
        return None

    code = m.group(1)
    twn_guess = int(code[:2])
    rng_guess = int(code[2:])

    # Check if any property matches this TWN+RNG number
    matches = [p for p in county_props if p['twn_num'] == twn_guess and p['rng_num'] == rng_guess]
    if matches:
        return matches[0]['twn'], matches[0]['rng'], matches
    return None


def try_explicit_trs(name):
    """
    Check for explicit TRS in the name like 'MURPHY 6N 2W 16 1HX' or 'HOWARD 22 17N 21W 1CH'
    Section usually appears BEFORE the TRS, well number AFTER.
    """
    m = re.search(r'(\d+[NS])\s+(\d+[EW])', name)
    if m:
        twn = m.group(1)
        rng = m.group(2)
        # Section is usually the number immediately BEFORE the TRS pattern
        # Well designation/number is usually AFTER the TRS
        before_trs = name[:m.start()].strip()
        after_trs = name[m.end():].strip()

        # Extract sections from text BEFORE the TRS first (higher priority)
        sections_before = extract_sections_from_name(before_trs)
        sections_after = extract_sections_from_name(after_trs)

        # Before TRS: LAST number is closest to TRS, most likely section
        # e.g., "HOWARD 22 17N 21W 1CH" → before="HOWARD 22", section = 22
        # After TRS: FIRST standalone number is section, H-suffix = well designation
        # e.g., "MURPHY 6N 2W 16 1HX" → after="16 1HX", section = 16
        if sections_before:
            return twn, rng, [sections_before[-1]]  # last number before TRS = section
        elif sections_after:
            # In after-TRS text, prefer first STANDALONE number over H-suffix
            # "16 1HX" → section is 16, not 1 (which is part of 1HX well designation)
            standalone_after = []
            for m_num in re.finditer(r'(?<![#\d])(\b\d{1,2}\b)(?![A-Z]*H)', after_trs):
                n = int(m_num.group(1))
                if 1 <= n <= 36:
                    standalone_after.append(n)
            if standalone_after:
                return twn, rng, [standalone_after[0]]
            return twn, rng, [sections_after[0]]  # fallback
        return twn, rng, []
    return None


def infer_location(name, county, county_props):
    """
    Try to infer TRS location from well name + property data.
    Returns (location_string, confidence, method) or (None, None, None).

    Confidence levels:
    - HIGH: Explicit TRS in name, or 4-digit code + section match
    - MEDIUM: Section from name matches exactly one property TRS
    - LOW: Section from name matches multiple property TRS locations
    """

    # Method 1: Explicit TRS in the name
    explicit = try_explicit_trs(name)
    if explicit:
        twn, rng, sections = explicit
        if sections:
            sec = sections[0]
            return f"{sec} {twn} {rng}", "HIGH", "explicit_trs_in_name"
        # TRS but no section — still useful
        return f"0 {twn} {rng}", "MEDIUM", "explicit_trs_no_section"

    if not county_props:
        return None, None, None

    # Method 2: 4-digit TRS code
    trs_4d = try_4digit_trs(name, county_props)
    if trs_4d:
        twn, rng, matching_props = trs_4d
        # Extract section from remaining name
        code_m = re.search(r'\b\d{4}\b', name)
        remaining = name[:code_m.start()] + name[code_m.end():]
        sections = extract_sections_from_name(remaining)

        # Filter sections to those that exist in matching properties
        prop_secs = set(p['sec'] for p in matching_props)
        valid_sections = [s for s in sections if s in prop_secs]

        if valid_sections:
            return f"{valid_sections[0]} {twn} {rng}", "HIGH", "4digit_code+section"
        elif len(prop_secs) == 1:
            # Only one section in this T/R — use it
            sec = list(prop_secs)[0]
            return f"{sec} {twn} {rng}", "HIGH", "4digit_code+only_section"
        else:
            # Have T/R but can't determine section — use first property section as hint
            return f"0 {twn} {rng}", "MEDIUM", "4digit_code_no_section"

    # Method 3: Section number from name + property cross-reference
    # Well name pattern is typically: NAME WELL# SECTION [SUFFIX]
    # So the LAST number in the name is most likely the section.
    # H-suffix numbers (27H, 9H) are strong section indicators.
    sections = extract_sections_from_name(name)
    if sections:
        prop_secs = set(p['sec'] for p in county_props)
        valid_sections = [s for s in sections if s in prop_secs]

        if len(valid_sections) == 1:
            sec = valid_sections[0]
            matching = [p for p in county_props if p['sec'] == sec]
            if len(matching) == 1:
                p = matching[0]
                return f"{sec} {p['twn']} {p['rng']}", "MEDIUM", "section_unique_match"
            elif matching:
                tr_counts = defaultdict(int)
                for p in county_props:
                    tr_counts[(p['twn'], p['rng'])] += 1
                best_tr = max(matching, key=lambda p: tr_counts[(p['twn'], p['rng'])])
                return f"{sec} {best_tr['twn']} {best_tr['rng']}", "LOW", "section_multi_tr"

        elif len(valid_sections) > 1:
            # Multiple sections match property data.
            # Heuristic: In "NAME WELL# SECTION", section is the LAST number.
            # Also: numbers extracted from H-suffix patterns (27H, 9H) are strong
            # section indicators — they appear first in our candidates list.
            # Strategy: prefer the FIRST candidate (H-suffix) if it exists,
            # otherwise use the LAST candidate (last number in name).
            # Check if the first candidate came from an H-suffix pattern
            h_suffix_nums = set()
            for m in re.finditer(r'\b(\d{1,2})(?=[A-Z]*H[A-Z]*\b)', name):
                n = int(m.group(1))
                if 1 <= n <= 36:
                    h_suffix_nums.add(n)

            # Prefer H-suffix section if it's in valid_sections
            h_valid = [s for s in valid_sections if s in h_suffix_nums]
            if h_valid:
                sec = h_valid[0]  # H-suffix number = strong section signal
            else:
                sec = valid_sections[-1]  # last number = section in NAME WELL# SEC pattern

            matching = [p for p in county_props if p['sec'] == sec]
            if matching:
                tr_counts = defaultdict(int)
                for p in county_props:
                    tr_counts[(p['twn'], p['rng'])] += 1
                best_tr = max(matching, key=lambda p: tr_counts[(p['twn'], p['rng'])])
                return f"{sec} {best_tr['twn']} {best_tr['rng']}", "LOW", "section_inferred"

    return None, None, None


def strip_well_suffixes(name):
    """Strip well-type designators that interfere with OCC matching."""
    # Strip trailing SWD (Salt Water Disposal)
    cleaned = re.sub(r'\s+SWD\s*$', '', name, flags=re.IGNORECASE)
    # Strip trailing INJ (Injection)
    cleaned = re.sub(r'\s+INJ\s*$', '', cleaned, flags=re.IGNORECASE)
    # Strip trailing WD (Water Disposal)
    cleaned = re.sub(r'\s+WD\s*$', '', cleaned, flags=re.IGNORECASE)
    # Strip trailing WDW (Water Disposal Well)
    cleaned = re.sub(r'\s+WDW\s*$', '', cleaned, flags=re.IGNORECASE)
    return cleaned


# ============================================================================
# Main
# ============================================================================

PROPS_FILE = "/Volumes/Media Drives/Downloads 2026/HHD Mineral Watch mineral tract upload - Producing Minerals.csv"
WELLS_FILE = "/Volumes/Media Drives/Downloads 2026/Mineral Watch well upload - Current.csv"
OUTPUT_FILE = "/Volumes/Media Drives/Downloads 2026/HHD-wells-CLEANED.csv"

def main():
    props = load_properties(PROPS_FILE)

    stats = {
        'total': 0,
        'has_api': 0,
        'has_location': 0,
        'inferred_high': 0,
        'inferred_medium': 0,
        'inferred_low': 0,
        'name_cleaned': 0,
        'out_of_state': 0,
        'unchanged': 0,
    }

    rows_out = []
    log = []

    with open(WELLS_FILE) as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames

        for row in reader:
            stats['total'] += 1
            api = row.get("API #", "").strip()
            loc = row.get("Location", "").strip()
            county_raw = row.get("County", "").strip()
            name = row.get("Well Name", "").strip()
            county = norm_county(county_raw)

            # Track changes
            changes = []

            # Flag out-of-state
            if county in OUT_OF_STATE:
                stats['out_of_state'] += 1
                changes.append(f"OUT-OF-STATE ({county})")

            # Clean API (remove spaces)
            clean_api = api.replace(" ", "")
            if clean_api and len(clean_api) >= 10 and clean_api.startswith('35'):
                stats['has_api'] += 1
                row['API #'] = clean_api
            elif clean_api and len(clean_api) >= 10:
                # Non-Oklahoma API
                row['API #'] = clean_api
                stats['has_api'] += 1
            else:
                row['API #'] = ''  # Clear whitespace-only APIs

            # Strip well-type suffixes from name for better matching
            cleaned_name = strip_well_suffixes(name)
            if cleaned_name != name:
                stats['name_cleaned'] += 1
                changes.append(f"name: '{name}' -> '{cleaned_name}'")
                row['Well Name'] = cleaned_name

            # Try to infer Location if missing
            if loc:
                stats['has_location'] += 1
            elif county not in OUT_OF_STATE:
                county_props = props.get(county, [])
                location, confidence, method = infer_location(name, county, county_props)

                if location and confidence:
                    # Format: "SEC TWN RNG COUNTY_ABBREV OK"
                    loc_string = f"{location} {county_raw} OK"
                    row['Location'] = loc_string
                    changes.append(f"location INFERRED ({confidence}, {method}): {loc_string}")

                    if confidence == 'HIGH':
                        stats['inferred_high'] += 1
                    elif confidence == 'MEDIUM':
                        stats['inferred_medium'] += 1
                    else:
                        stats['inferred_low'] += 1
                else:
                    stats['unchanged'] += 1

            if not changes:
                stats['unchanged'] += 1
            else:
                log.append(f"Row {stats['total']:3d}: {name:40s} | {' | '.join(changes)}")

            rows_out.append(row)

    # Write cleaned CSV
    with open(OUTPUT_FILE, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows_out)

    # Print report
    print("=" * 70)
    print("HHD WELLS CSV CLEANUP REPORT")
    print("=" * 70)
    print(f"Total wells:         {stats['total']}")
    print(f"Already have API:    {stats['has_api']}")
    print(f"Already have Location: {stats['has_location']}")
    print(f"Out-of-state:        {stats['out_of_state']} (won't match in OK OCC database)")
    print()
    print(f"LOCATIONS INFERRED:")
    print(f"  HIGH confidence:   {stats['inferred_high']} (explicit TRS or 4-digit code + section)")
    print(f"  MEDIUM confidence: {stats['inferred_medium']} (section matches unique property)")
    print(f"  LOW confidence:    {stats['inferred_low']} (section matches multiple properties)")
    total_inferred = stats['inferred_high'] + stats['inferred_medium'] + stats['inferred_low']
    print(f"  TOTAL inferred:    {total_inferred}")
    print()
    print(f"Names cleaned:       {stats['name_cleaned']} (stripped SWD/INJ/WD suffixes)")
    print(f"Unchanged:           {stats['unchanged']} (no improvements possible)")
    print()
    print(f"Output: {OUTPUT_FILE}")
    print()

    # Expected improvement
    matchable_before = stats['has_api'] + stats['has_location']
    matchable_after = matchable_before + total_inferred
    print(f"MATCHABLE WELLS: {matchable_before} -> {matchable_after} (+{total_inferred})")
    print(f"STILL HARD:      {stats['total'] - matchable_after - stats['out_of_state']} (name+county only, no TRS)")
    print()

    # Print change log
    print("=" * 70)
    print("CHANGE LOG")
    print("=" * 70)
    for entry in log:
        print(entry)


if __name__ == '__main__':
    main()
