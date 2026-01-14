#!/usr/bin/env python3
"""
Import OTC lease data (PUN → TRS crosswalk) into D1 database.

Usage:
    python3 import-otc-leases.py <lease_file.dat>

This script:
1. Parses the fixed-width OTC lease file
2. Generates SQL INSERT statements in batch files
3. Creates an execution script to run them via wrangler

After running, execute: ./execute-otc-leases-import.sh
"""

import sys
import os

def parse_pun(pun_raw):
    """Convert '00300046400000' to '003-00464-0-0000' format"""
    if len(pun_raw) < 14:
        return pun_raw
    county = pun_raw[0:3]
    lease = pun_raw[3:8]
    sub = pun_raw[8:9]
    merge = pun_raw[9:14]
    return f"{county}-{lease}-{sub}-{merge}"

def parse_legal(code):
    """Parse legal code like 'SW0223N10W' into components"""
    if len(code) < 10:
        return None

    quarter = code[0:2].strip()
    section_str = code[2:4]
    township = code[4:7].strip()
    range_val = code[7:10].strip()

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

    with open(lease_file, 'r') as f:
        line_num = 0
        for line in f:
            line_num += 1

            # Parse fields from fixed-width format
            county = line[0:50].strip()
            pun_raw = line[50:64].strip()
            legal_code = line[110:120].strip()
            lease_name = line[132:350].strip()  # Extended to catch long names

            # Parse legal description
            parsed = parse_legal(legal_code)
            if not parsed:
                continue

            # Format PUN
            pun = parse_pun(pun_raw)

            # Create unique key
            key = f"{pun}_{parsed['section']}_{parsed['township']}_{parsed['range']}_{parsed['quarter']}"
            if key in seen:
                continue
            seen.add(key)

            records.append({
                'pun': pun,
                'county': county,
                'quarter': parsed['quarter'],
                'section': parsed['section'],
                'township': parsed['township'],
                'range': parsed['range'],
                'lease_name': lease_name
            })

            if line_num % 50000 == 0:
                print(f"  Processed {line_num:,} lines...")

    print(f"\nTotal unique records: {len(records):,}")

    # Generate SQL INSERT statements
    BATCH_SIZE = 500
    batch_num = 0

    print(f"\nGenerating batch files ({BATCH_SIZE} records per batch)...")

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i+BATCH_SIZE]
        batch_num += 1

        sql_lines = []
        for r in batch:
            sql = f"INSERT OR IGNORE INTO otc_leases (pun, county, quarter, section, township, range, lease_name) VALUES ('{escape_sql(r['pun'])}', '{escape_sql(r['county'])}', '{escape_sql(r['quarter'])}', {r['section']}, '{escape_sql(r['township'])}', '{escape_sql(r['range'])}', '{escape_sql(r['lease_name'])}');"
            sql_lines.append(sql)

        batch_file = f"otc-leases-batch-{batch_num:04d}.sql"
        with open(batch_file, 'w') as f:
            f.write('\n'.join(sql_lines))

    print(f"Created {batch_num} batch files")

    # Create execution script
    script = '''#!/bin/bash
# Execute OTC leases import
echo "Importing OTC lease data ({} records in {} batches)..."
echo ""

for file in otc-leases-batch-*.sql; do
    echo -n "Processing $file... "
    wrangler d1 execute oklahoma-wells --remote --file="$file" 2>&1 | grep -o '"success": true' || echo "FAILED"
done

echo ""
echo "Import complete! Cleaning up batch files..."
rm -f otc-leases-batch-*.sql

echo "Done!"
'''.format(len(records), batch_num)

    with open('execute-otc-leases-import.sh', 'w') as f:
        f.write(script)
    os.chmod('execute-otc-leases-import.sh', 0o755)

    print(f"\nCreated execution script: execute-otc-leases-import.sh")
    print("\nNext steps:")
    print("1. Run the migration: wrangler d1 execute oklahoma-wells --remote --file=create-otc-leases-migration.sql")
    print("2. Run the import: ./execute-otc-leases-import.sh")

if __name__ == '__main__':
    main()
