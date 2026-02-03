#!/usr/bin/env python3
"""
Import OTC lease data (PUN → TRS crosswalk) into D1 database.

Usage:
    python3 import-otc-leases.py <lease_file.dat>

This script:
1. Parses the fixed-width OTC lease file (exp_gplease)
2. Generates SQL INSERT statements in batch files
3. Creates an execution script to run them via wrangler

After running, execute: ./execute-otc-leases-import.sh

Field positions in exp_gplease (447 chars/line, from Layout_for_Outside_Entities.xlsx):
  0-49    name (county name, 50 chars)
  50-52   pun_county_num (3 chars)
  53-58   pun_lease_num (6 chars)
  59      pun_sub_num (1 char)
  60-63   pun_merge_num (4 chars)
  64-103  legal_description_type (40 chars): "Legal", "Bottom", "Surface" + sub-quarter
  104-105 quarter2p5 (2 chars)
  106-107 quarter10 (2 chars)
  108-109 quarter40 (2 chars)
  110-111 quarter160 (2 chars)
  112-113 section (2 chars)
  114-116 township (3 chars)
  117-121 range (5 chars)
  122-131 well_classification (10 chars): 107=Oil, 108=Gas, 109=Injection, 110=Vertical/Simple
  132-191 well_name (60 chars)
  192-446 formation_names (255 chars): mostly empty, well-name overflow
"""

import sys
import os


def parse_pun(pun_raw):
    """Convert '00300046400000' to '003-000464-0-0000' format.

    OTC PUN format: 3 (county) + 6 (lease) + 1 (sub) + 4 (merge) = 14 digits
    """
    if len(pun_raw) < 14:
        return pun_raw
    county = pun_raw[0:3]      # positions 0-2 (3 chars)
    lease = pun_raw[3:9]       # positions 3-8 (6 chars)
    sub = pun_raw[9:10]        # position 9 (1 char)
    merge = pun_raw[10:14]     # positions 10-13 (4 chars)
    return f"{county}-{lease}-{sub}-{merge}"


def parse_legal(quarter160, section_raw, township_raw, range_raw):
    """Parse legal components from individual fields (per data dictionary)."""
    quarter = quarter160.strip()
    section_str = section_raw.strip()
    township = township_raw.strip()
    range_val = range_raw.strip()

    # Validate section
    try:
        section = int(section_str)
        if section < 1 or section > 36:
            return None
    except ValueError:
        return None

    return {
        'quarter': quarter,
        'section': section,
        'township': township,
        'range': range_val
    }


def escape_sql(s):
    """Escape single quotes for SQL"""
    if s is None:
        return ''
    return s.replace("'", "''")


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 import-otc-leases.py <lease_file.dat>")
        sys.exit(1)

    lease_file = sys.argv[1]

    if not os.path.exists(lease_file):
        print(f"Error: File not found: {lease_file}")
        sys.exit(1)

    print(f"Parsing lease file: {lease_file}")

    # Track unique combinations to avoid duplicates
    seen = set()
    records = []
    formation_counts = {}

    with open(lease_file, 'r', encoding='utf-8', errors='replace') as f:
        line_num = 0
        for line in f:
            line_num += 1

            if len(line) < 132:
                continue

            # Parse fields from fixed-width format (per data dictionary)
            county = line[0:50].strip()
            pun_raw = line[50:64].strip()
            legal_desc_type = line[64:104].strip()   # Legal/Bottom/Surface + sub-quarter
            quarter160 = line[110:112]                # Quarter at 160-acre level
            section_raw = line[112:114]               # Section (2 chars)
            township_raw = line[114:117]              # Township (3 chars)
            range_raw = line[117:122]                 # Range (5 chars, was reading only 3)
            well_classification = line[122:132].strip() if len(line) > 132 else ''
            lease_name = line[132:192].strip() if len(line) > 132 else ''

            # Track formation values
            formation_counts[legal_desc_type] = formation_counts.get(legal_desc_type, 0) + 1

            # Parse legal description
            parsed = parse_legal(quarter160, section_raw, township_raw, range_raw)
            if not parsed:
                continue

            # Format PUN (3-6-1-4 dashed format)
            pun = parse_pun(pun_raw)
            base_pun = pun[:10] if len(pun) >= 10 else pun

            # Create unique key
            key = f"{pun}_{parsed['section']}_{parsed['township']}_{parsed['range']}_{parsed['quarter']}"
            if key in seen:
                continue
            seen.add(key)

            # Normalize well_classification to short code
            wc_short = well_classification.lstrip('0') or '0' if well_classification else None

            records.append({
                'pun': pun,
                'base_pun': base_pun,
                'county': county,
                'quarter': parsed['quarter'],
                'section': parsed['section'],
                'township': parsed['township'],
                'range': parsed['range'],
                'lease_name': lease_name,
                'formation': legal_desc_type if legal_desc_type else None,
                'well_classification': wc_short,
            })

            if line_num % 50000 == 0:
                print(f"  Processed {line_num:,} lines...")

    print(f"\nTotal unique records: {len(records):,}")
    print(f"\nLegal description type distribution:")
    for form, count in sorted(formation_counts.items(), key=lambda x: -x[1])[:15]:
        print(f"  {form or '(empty)'}: {count:,}")

    # Well classification distribution
    wc_counts = {}
    for r in records:
        wc = r.get('well_classification') or '(none)'
        wc_counts[wc] = wc_counts.get(wc, 0) + 1
    print(f"\nWell classification distribution:")
    wc_labels = {'107': 'Oil', '108': 'Gas', '109': 'Injection/Other', '110': 'Vertical/Simple'}
    for wc, count in sorted(wc_counts.items(), key=lambda x: -x[1]):
        label = wc_labels.get(wc, '')
        print(f"  {wc:>5s} {f'({label})' if label else '':>22s}: {count:>8,}")

    # Generate SQL INSERT statements
    BATCH_SIZE = 500
    batch_num = 0
    batch_dir = "otc-leases-batches"
    os.makedirs(batch_dir, exist_ok=True)

    print(f"\nGenerating batch files ({BATCH_SIZE} records per batch) in {batch_dir}/...")

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i+BATCH_SIZE]
        batch_num += 1

        sql_lines = []
        for r in batch:
            formation_val = f"'{escape_sql(r['formation'])}'" if r['formation'] else 'NULL'
            wc_val = f"'{escape_sql(r['well_classification'])}'" if r['well_classification'] else 'NULL'
            sql = (
                f"INSERT OR IGNORE INTO otc_leases "
                f"(pun, base_pun, county, quarter, section, township, range, lease_name, formation, well_classification) VALUES ("
                f"'{escape_sql(r['pun'])}', '{escape_sql(r['base_pun'])}', '{escape_sql(r['county'])}', "
                f"'{escape_sql(r['quarter'])}', {r['section']}, '{escape_sql(r['township'])}', "
                f"'{escape_sql(r['range'])}', '{escape_sql(r['lease_name'])}', {formation_val}, {wc_val});"
            )
            sql_lines.append(sql)

        batch_file = f"{batch_dir}/batch_{batch_num:04d}.sql"
        with open(batch_file, 'w') as f:
            f.write('\n'.join(sql_lines))

    print(f"Created {batch_num} batch files in {batch_dir}/")

    # Create execution script
    script = f'''#!/bin/bash
# Execute OTC leases import
# Generated by import-otc-leases.py
echo "Importing OTC lease data ({len(records)} records in {batch_num} batches)..."
echo ""

FAILED=0
SUCCESS=0

for file in {batch_dir}/batch_*.sql; do
    echo -n "Processing $file... "
    result=$(wrangler d1 execute oklahoma-wells --remote --file="$file" 2>&1)
    if echo "$result" | grep -q '"success": true'; then
        echo "OK"
        ((SUCCESS++))
    else
        echo "FAILED"
        ((FAILED++))
    fi
    sleep 0.2  # Rate limit
done

echo ""
echo "Import complete: $SUCCESS succeeded, $FAILED failed"
'''

    with open('execute-otc-leases-import.sh', 'w') as f:
        f.write(script)
    os.chmod('execute-otc-leases-import.sh', 0o755)

    print(f"\nCreated execution script: execute-otc-leases-import.sh")
    print("\nNext steps:")
    print("1. Ensure table exists: wrangler d1 execute oklahoma-wells --remote --file=create-otc-leases-migration.sql")
    print("2. Run the import: ./execute-otc-leases-import.sh")


if __name__ == '__main__':
    main()
