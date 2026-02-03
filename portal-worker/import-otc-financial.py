#!/usr/bin/env python3
"""
Import OTC financial data from exp_gpland CSV into D1 database.

This script parses the gpland CSV and generates SQL batch files for
the otc_production_financial table.

CSV columns (23):
  Company Number, Product Code, Production YearMonth,
  PUN County Number, PUN Lease Number, PUN Sub Number, PUN Merge Number,
  Producer Purchaser, Exempt Code, Report Type Code,
  Gross Volume, Gross Value, Decimal Equivalent,
  Exempt Volume, Exempt Value, Market Deduction,
  Frac Oil Exempt Volume, Frac Oil Exempt Value,
  Net Volume, Net Value, GP Tax Due, PE Tax Due, Reporting Date

Usage:
    python3 import-otc-financial.py [input_file]
"""

import csv
import os
import sys


INPUT_FILE = "/Users/jamesprice/mymineralwatch/OTC Bulk/files (4)/exp_gpland20260112.csv"
OUTPUT_DIR = "/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-financial-batches"


def format_pun(county, lease, sub, merge):
    """Format PUN components to dashed format: XXX-XXXXXX-X-XXXX (3-6-1-4)"""
    county = county.strip().zfill(3)
    lease = lease.strip().zfill(6)
    sub = sub.strip().zfill(1)
    merge = merge.strip().zfill(4)
    return f"{county}-{lease}-{sub}-{merge}"


def escape_sql(s):
    """Escape single quotes for SQL"""
    if s is None:
        return ''
    return str(s).replace("'", "''")


def parse_float(val, default=None):
    """Parse a float value, return default if empty/invalid"""
    if val is None or val == '':
        return default
    try:
        return float(val)
    except ValueError:
        return default


def parse_int(val, default=None):
    """Parse an int value, return default if empty/invalid"""
    if val is None or val == '':
        return default
    try:
        return int(val)
    except ValueError:
        return default


def convert_date(date_str):
    """Convert MM/DD/YYYY to YYYY-MM-DD"""
    if not date_str or date_str.strip() == '':
        return None
    parts = date_str.strip().split('/')
    if len(parts) == 3:
        return f"{parts[2]}-{parts[0].zfill(2)}-{parts[1].zfill(2)}"
    return date_str


def sql_val(val):
    """Format a value for SQL: NULL if None, quoted string, or number"""
    if val is None:
        return 'NULL'
    if isinstance(val, (int, float)):
        return str(val)
    return f"'{escape_sql(val)}'"


def main():
    input_file = sys.argv[1] if len(sys.argv) > 1 else INPUT_FILE

    if not os.path.exists(input_file):
        print(f"Error: File not found: {input_file}")
        sys.exit(1)

    print(f"Parsing financial data: {input_file}")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Clear old batch files
    for f in os.listdir(OUTPUT_DIR):
        if f.endswith('.sql'):
            os.remove(os.path.join(OUTPUT_DIR, f))

    records = []
    skipped = 0

    with open(input_file, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.reader(f)
        header = next(reader)  # Skip header row
        print(f"  CSV columns ({len(header)}): {', '.join(header[:5])}...")

        for row_num, row in enumerate(reader, start=2):
            if len(row) < 23:
                skipped += 1
                continue

            # Parse PUN components
            pun = format_pun(row[3], row[4], row[5], row[6])

            # Parse all fields
            record = {
                'pun': pun,
                'year_month': row[2].strip(),
                'product_code': row[1].strip(),
                'reporting_company_id': row[0].strip().lstrip('0') or '0',
                'purchaser_id': row[7].strip().lstrip('0') or None if row[7].strip() else None,
                'gross_volume': parse_float(row[10]),
                'gross_value': parse_float(row[11]),
                'decimal_equivalent': parse_float(row[12]),
                'exempt_volume': parse_float(row[13]),
                'exempt_value': parse_float(row[14]),
                'market_deduction': parse_float(row[15]),
                'net_volume': parse_float(row[18]),
                'net_value': parse_float(row[19]),
                'gp_tax': parse_float(row[20]),
                'pe_tax': parse_float(row[21]),
                'exempt_code': row[8].strip() or None,
                'report_type': parse_int(row[9]),
                'reported_at': convert_date(row[22]),
            }

            records.append(record)

            if row_num % 20000 == 0:
                print(f"  Processed {row_num:,} rows...")

    print(f"\nTotal records: {len(records):,} (skipped {skipped})")

    # Show some stats
    products = {}
    has_decimal = 0
    for r in records:
        pc = r['product_code']
        products[pc] = products.get(pc, 0) + 1
        if r['decimal_equivalent'] and r['decimal_equivalent'] > 0:
            has_decimal += 1

    print(f"\nProduct code distribution:")
    for pc, count in sorted(products.items()):
        label = {'1': 'Oil', '3': 'Condensate', '5': 'CasingheadGas', '6': 'NaturalGas'}.get(pc, f'Unknown({pc})')
        print(f"  {pc} ({label}): {count:,}")
    print(f"\nRecords with decimal_equivalent > 0: {has_decimal:,}")

    # Generate SQL batch files
    BATCH_SIZE = 500
    batch_num = 0

    print(f"\nGenerating batch files ({BATCH_SIZE} records per batch) in {OUTPUT_DIR}/...")

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i+BATCH_SIZE]
        batch_num += 1

        sql_lines = []
        for r in batch:
            sql = (
                f"INSERT OR REPLACE INTO otc_production_financial "
                f"(pun, year_month, product_code, reporting_company_id, purchaser_id, "
                f"gross_volume, gross_value, net_volume, net_value, market_deduction, "
                f"decimal_equivalent, exempt_volume, exempt_value, gp_tax, pe_tax, "
                f"exempt_code, report_type, reported_at) VALUES ("
                f"{sql_val(r['pun'])}, {sql_val(r['year_month'])}, {sql_val(r['product_code'])}, "
                f"{sql_val(r['reporting_company_id'])}, {sql_val(r['purchaser_id'])}, "
                f"{sql_val(r['gross_volume'])}, {sql_val(r['gross_value'])}, "
                f"{sql_val(r['net_volume'])}, {sql_val(r['net_value'])}, "
                f"{sql_val(r['market_deduction'])}, {sql_val(r['decimal_equivalent'])}, "
                f"{sql_val(r['exempt_volume'])}, {sql_val(r['exempt_value'])}, "
                f"{sql_val(r['gp_tax'])}, {sql_val(r['pe_tax'])}, "
                f"{sql_val(r['exempt_code'])}, {sql_val(r['report_type'])}, "
                f"{sql_val(r['reported_at'])});"
            )
            sql_lines.append(sql)

        with open(f"{OUTPUT_DIR}/batch_{batch_num:04d}.sql", 'w') as f:
            f.write('\n'.join(sql_lines))

    print(f"Created {batch_num} batch files in {OUTPUT_DIR}/")

    # Show sample data
    print(f"\nSample records:")
    for r in records[:3]:
        print(f"  PUN {r['pun']} | {r['year_month']} | product {r['product_code']} | "
              f"gross_vol={r['gross_volume']} gross_val={r['gross_value']} | "
              f"decimal={r['decimal_equivalent']} | company={r['reporting_company_id']}")

    print(f"\nTo execute:")
    print(f"  for f in {OUTPUT_DIR}/batch_*.sql; do")
    print(f"    wrangler d1 execute oklahoma-wells --remote --file=\"$f\"")
    print(f"    sleep 0.2")
    print(f"  done")


if __name__ == '__main__':
    main()
