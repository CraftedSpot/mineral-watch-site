#!/usr/bin/env python3
"""
Import OTC qualifying tax rate data (exp_gpqtrat) into D1 database.

This provides production period dates per PUN — the earliest period_start_date
gives a floor for when the lease must have been signed (production can't start
before the lease exists). NOT actual lease effective dates.

Field positions (from Layout_for_Outside_Entities.xlsx):
  0-2    pun_county_num (3 chars)
  3-8    pun_lease_num (6 chars)
  9      pun_sub_num (1 char)
  10-13  pun_merge_num (4 chars)
  14-73  lease_name (60 chars)
  74-133 well_name (60 chars)
  134-144 period_start_date (11 chars, YYYY-MM-DD)
  145-155 period_end_date (11 chars, YYYY-MM-DD or 9999-12-31 for active)
  156-165 rate (10 chars, decimal 0000000.00)

Usage:
    python3 import-otc-qtrat.py [input_file]
"""

import os
import sys


INPUT_FILE = "/Users/jamesprice/mymineralwatch/OTC Bulk/files (4)/exp_gpqtrat20260112.dat"
OUTPUT_DIR = "/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-qtrat-batches"


def format_pun(county, lease, sub, merge):
    """Format PUN components to dashed format: XXX-XXXXXX-X-XXXX (3-6-1-4)"""
    return f"{county}-{lease}-{sub}-{merge}"


def escape_sql(s):
    """Escape single quotes for SQL"""
    if s is None:
        return ''
    return str(s).replace("'", "''")


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

    print(f"Parsing gpqtrat file: {input_file}")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for f in os.listdir(OUTPUT_DIR):
        if f.endswith('.sql'):
            os.remove(os.path.join(OUTPUT_DIR, f))

    records = []
    skipped = 0
    active_count = 0
    earliest_starts = {}  # pun -> earliest period_start_date

    with open(input_file, 'r', encoding='utf-8', errors='replace') as f:
        for line_num, line in enumerate(f, 1):
            if len(line.rstrip()) < 156:
                skipped += 1
                continue

            county = line[0:3]
            lease = line[3:9]
            sub = line[9:10]
            merge = line[10:14]
            lease_name = line[14:74].strip()
            well_name = line[74:134].strip()
            period_start = line[134:145].strip()
            period_end = line[145:156].strip()
            rate_raw = line[156:166].strip() if len(line) > 156 else ''

            pun = format_pun(county, lease, sub, merge)

            # Parse rate
            try:
                rate = float(rate_raw) if rate_raw else None
            except ValueError:
                rate = None

            is_active = period_end == '9999-12-31'
            if is_active:
                active_count += 1

            # Track earliest start per PUN
            if pun not in earliest_starts or (period_start and period_start < earliest_starts[pun]):
                earliest_starts[pun] = period_start

            records.append({
                'pun': pun,
                'base_pun': pun[:10] if len(pun) >= 10 else pun,
                'lease_name': lease_name if lease_name and lease_name != '[No Name]' else None,
                'well_name': well_name if well_name and well_name != '[No Name]' and well_name != 'UNKNOWN SOURCE' else None,
                'period_start_date': period_start or None,
                'period_end_date': period_end if period_end != '9999-12-31' else None,
                'is_active': 1 if is_active else 0,
                'tax_rate': rate,
            })

            if line_num % 100000 == 0:
                print(f"  Processed {line_num:,} lines...")

    print(f"\nTotal records: {len(records):,} (skipped {skipped})")
    print(f"Active PUN periods (end=9999-12-31): {active_count:,}")
    print(f"Unique PUNs: {len(earliest_starts):,}")

    # Show earliest starts distribution
    decade_counts = {}
    for pun, start in earliest_starts.items():
        if start:
            decade = start[:3] + '0s'
            decade_counts[decade] = decade_counts.get(decade, 0) + 1
    print(f"\nEarliest production period by decade:")
    for decade, count in sorted(decade_counts.items()):
        print(f"  {decade}: {count:,}")

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
                f"INSERT OR REPLACE INTO otc_pun_tax_periods "
                f"(pun, base_pun, lease_name, well_name, period_start_date, "
                f"period_end_date, is_active, tax_rate) VALUES ("
                f"{sql_val(r['pun'])}, {sql_val(r['base_pun'])}, "
                f"{sql_val(r['lease_name'])}, {sql_val(r['well_name'])}, "
                f"{sql_val(r['period_start_date'])}, {sql_val(r['period_end_date'])}, "
                f"{r['is_active']}, {sql_val(r['tax_rate'])});"
            )
            sql_lines.append(sql)

        with open(f"{OUTPUT_DIR}/batch_{batch_num:04d}.sql", 'w') as f:
            f.write('\n'.join(sql_lines))

    print(f"Created {batch_num} batch files in {OUTPUT_DIR}/")

    # Sample data
    print(f"\nSample records:")
    for r in records[:5]:
        status = "ACTIVE" if r['is_active'] else f"ended {r['period_end_date']}"
        print(f"  {r['pun']} | {r['lease_name'] or '?':30s} | start={r['period_start_date']} | {status} | rate={r['tax_rate']}")

    print(f"\nTo execute:")
    print(f"  for f in {OUTPUT_DIR}/batch_*.sql; do")
    print(f"    wrangler d1 execute oklahoma-wells --remote --file=\"$f\"")
    print(f"    sleep 0.15")
    print(f"  done")


if __name__ == '__main__':
    main()
