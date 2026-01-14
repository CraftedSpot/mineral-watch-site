#!/usr/bin/env python3
"""
Dry-run script to extract crosswalk data from documents.
Outputs a report of what would be extracted without inserting anything.
"""

import json
import re
import sys

# Confidence tiers
CONFIDENCE_HIGH = 0.9    # Structured fields
CONFIDENCE_MEDIUM = 0.7  # Parsed legal description
CONFIDENCE_LOW = 0.5     # From notes/inferred

def extract_api_from_text(text):
    """Extract API numbers from free text. Oklahoma APIs are 35-XXX-XXXXX"""
    if not text:
        return []
    # Pattern: 35-NNN-NNNNN or 35NNNNNNN or variations
    patterns = [
        r'35[-\s]?(\d{3})[-\s]?(\d{5})',  # 35-123-45678 or 35 123 45678
        r'API[:\s#]*35[-\s]?(\d{3})[-\s]?(\d{5})',  # API: 35-123-45678
        r'(?<!\d)35(\d{8})(?!\d)',  # 35123456789 (no dashes)
    ]
    apis = []
    for pattern in patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        for match in matches:
            if isinstance(match, tuple):
                api = f"35-{match[0]}-{match[1]}"
            else:
                api = f"35-{match[:3]}-{match[3:]}"
            apis.append(api)
    return list(set(apis))

def extract_well_number_from_notes(notes):
    """Extract well numbers like '350016-079' from notes"""
    if not notes:
        return []
    # Pattern for well numbers in notes
    pattern = r'well\s+(\d{6}-\d{3})'
    matches = re.findall(pattern, notes, re.IGNORECASE)
    return matches

def extract_crosswalk_from_document(doc):
    """Extract crosswalk data from a single document."""
    doc_id = doc.get('id', 'unknown')
    doc_type = doc.get('doc_type', 'unknown')
    filename = doc.get('filename', 'unknown')

    extracted_data = doc.get('extracted_data')
    if not extracted_data:
        return None

    try:
        data = json.loads(extracted_data) if isinstance(extracted_data, str) else extracted_data
    except json.JSONDecodeError:
        return None

    mappings = []

    # Extract well name (high confidence if direct field)
    well_name = data.get('well_name')
    well_name_confidence = data.get('well_name_confidence', CONFIDENCE_HIGH) if well_name else None

    # Extract API number (high confidence if direct field)
    api_number = data.get('api_number')
    api_confidence = data.get('api_number_confidence', CONFIDENCE_HIGH) if api_number else None

    # Extract operator
    operator = data.get('operator')
    operator_confidence = data.get('operator_confidence', CONFIDENCE_HIGH) if operator else None

    # Extract legal description
    legal = data.get('legal_description', {})
    section = legal.get('section')
    township = legal.get('township')
    range_val = legal.get('range')
    county = legal.get('county')

    # Calculate TRS confidence (average of components)
    trs_confidences = [
        legal.get('section_confidence'),
        legal.get('township_confidence'),
        legal.get('range_confidence'),
        legal.get('county_confidence')
    ]
    trs_confidences = [c for c in trs_confidences if c is not None]
    trs_confidence = sum(trs_confidences) / len(trs_confidences) if trs_confidences else CONFIDENCE_MEDIUM

    # Check notes for additional data (low confidence)
    notes = data.get('notes', '')

    # Extract APIs from notes
    apis_from_notes = extract_api_from_text(notes)
    well_numbers_from_notes = extract_well_number_from_notes(notes)

    # Build the primary mapping
    if well_name or api_number or operator:
        mapping = {
            'source_id': doc_id,
            'source_type': doc_type,
            'filename': filename,
            'well_name': well_name,
            'well_name_confidence': well_name_confidence,
            'api_number': api_number,
            'api_confidence': api_confidence,
            'operator': operator,
            'operator_confidence': operator_confidence,
            'section': section,
            'township': township,
            'range': range_val,
            'county': county,
            'trs_confidence': trs_confidence,
            'from_notes': False
        }
        mappings.append(mapping)

    # Add mappings from notes (lower confidence)
    for api in apis_from_notes:
        if api != api_number:  # Don't duplicate
            mapping = {
                'source_id': doc_id,
                'source_type': doc_type,
                'filename': filename,
                'well_name': None,
                'well_name_confidence': None,
                'api_number': api,
                'api_confidence': CONFIDENCE_LOW,
                'operator': operator,
                'operator_confidence': operator_confidence,
                'section': section,
                'township': township,
                'range': range_val,
                'county': county,
                'trs_confidence': trs_confidence,
                'from_notes': True
            }
            mappings.append(mapping)

    for well_num in well_numbers_from_notes:
        mapping = {
            'source_id': doc_id,
            'source_type': doc_type,
            'filename': filename,
            'well_name': None,
            'well_name_confidence': None,
            'api_number': None,
            'api_confidence': None,
            'well_number_ref': well_num,
            'operator': operator,
            'operator_confidence': operator_confidence,
            'section': section,
            'township': township,
            'range': range_val,
            'county': county,
            'trs_confidence': trs_confidence,
            'from_notes': True
        }
        mappings.append(mapping)

    # If we have TRS but nothing else, still capture it for context
    if not mappings and (section and township and range_val):
        mapping = {
            'source_id': doc_id,
            'source_type': doc_type,
            'filename': filename,
            'well_name': None,
            'well_name_confidence': None,
            'api_number': None,
            'api_confidence': None,
            'operator': operator,
            'operator_confidence': operator_confidence,
            'section': section,
            'township': township,
            'range': range_val,
            'county': county,
            'trs_confidence': trs_confidence,
            'from_notes': False,
            'trs_only': True
        }
        mappings.append(mapping)

    return mappings

def main():
    # Read JSON input from stdin or file
    if len(sys.argv) > 1:
        with open(sys.argv[1], 'r') as f:
            raw = f.read()
    else:
        raw = sys.stdin.read()

    # Parse the wrangler output format
    try:
        # Find the JSON array in the output
        start = raw.find('[')
        if start == -1:
            print("No JSON found in input")
            return

        # Parse outer structure
        data = json.loads(raw[start:])
        if isinstance(data, list) and len(data) > 0:
            results = data[0].get('results', [])
        else:
            results = []
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}")
        return

    print(f"Processing {len(results)} documents...\n")

    all_mappings = []
    docs_with_data = 0
    docs_without_data = 0

    for doc in results:
        mappings = extract_crosswalk_from_document(doc)
        if mappings:
            all_mappings.extend(mappings)
            docs_with_data += 1
        else:
            docs_without_data += 1

    # Summary
    print("=" * 70)
    print("EXTRACTION SUMMARY")
    print("=" * 70)
    print(f"Documents processed: {len(results)}")
    print(f"Documents with extractable data: {docs_with_data}")
    print(f"Documents without crosswalk data: {docs_without_data}")
    print(f"Total mappings found: {len(all_mappings)}")
    print()

    # Breakdown by type
    by_type = {}
    for m in all_mappings:
        t = m.get('source_type', 'unknown')
        by_type[t] = by_type.get(t, 0) + 1

    print("Mappings by document type:")
    for t, count in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {t}: {count}")
    print()

    # Breakdown by data quality
    has_well_name = sum(1 for m in all_mappings if m.get('well_name'))
    has_api = sum(1 for m in all_mappings if m.get('api_number'))
    has_operator = sum(1 for m in all_mappings if m.get('operator'))
    has_trs = sum(1 for m in all_mappings if m.get('section') and m.get('township') and m.get('range'))
    from_notes = sum(1 for m in all_mappings if m.get('from_notes'))

    print("Data quality breakdown:")
    print(f"  With well name: {has_well_name}")
    print(f"  With API number: {has_api}")
    print(f"  With operator: {has_operator}")
    print(f"  With full TRS: {has_trs}")
    print(f"  Extracted from notes (lower confidence): {from_notes}")
    print()

    # Show sample mappings
    print("=" * 70)
    print("SAMPLE MAPPINGS (first 20)")
    print("=" * 70)

    for i, m in enumerate(all_mappings[:20]):
        print(f"\n--- Mapping {i+1} ---")
        print(f"Source: {m.get('source_type')} - {m.get('filename')}")
        if m.get('well_name'):
            print(f"  Well Name: {m.get('well_name')} (conf: {m.get('well_name_confidence')})")
        if m.get('api_number'):
            print(f"  API: {m.get('api_number')} (conf: {m.get('api_confidence')})")
        if m.get('well_number_ref'):
            print(f"  Well # Ref: {m.get('well_number_ref')} (from notes)")
        if m.get('operator'):
            print(f"  Operator: {m.get('operator')} (conf: {m.get('operator_confidence')})")
        if m.get('section'):
            print(f"  TRS: Sec {m.get('section')}, {m.get('township')}, {m.get('range')}, {m.get('county')} (conf: {m.get('trs_confidence'):.2f})")
        if m.get('from_notes'):
            print(f"  [Extracted from notes - lower confidence]")

    # Write full results to file
    output_file = '/tmp/crosswalk_dryrun_results.json'
    with open(output_file, 'w') as f:
        json.dump(all_mappings, f, indent=2)
    print(f"\n\nFull results written to: {output_file}")

if __name__ == "__main__":
    main()
