#!/usr/bin/env python3
"""
Import OTC exemption data (exp_gpexempt) into D1 database.

Shows government/tribal/institutional interests per PUN:
Indian land, State School Land Commission, Federal, etc.

Field positions (from Layout_for_Outside_Entities.xlsx):
  0-2    pun_county_num (3 chars)
  3-8    pun_lease_num (6 chars)
  9      pun_sub_num (1 char)
  10-13  pun_merge_num (4 chars)
  14-63  exemption_type (50 chars)
  64-68  code (5 chars)
  69-92  exemption_percentage (24 chars, decimal)

Usage:
    python3 import-otc-exempt.py [input_file]
"""

import os
import sys


INPUT_FILE = "/Users/jamesprice/mymineralwatch/OTC Bulk/files (4)/exp_gpexempt20260112.dat"
OUTPUT_DIR = "/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-exempt-batches"


def escape_sql(s):
    if s is None:
        return ''
    return str(s).replace("'", "''")


def sql_val(val):
    if val is None:
        return 'NULL'
    if isinstance(val, (int, float)):
        return str(val)
    return f"'{escape_sql(val)}'"


def main():
    input_file = sys.argv[1] if len(sys.argv) > 1 else INPUT_FILE

    print(f"Parsing gpexempt file: {input_file}")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for f in os.listdir(OUTPUT_DIR):
        if f.endswith('.sql'):
            os.remove(os.path.join(OUTPUT_DIR, f))

    records = []

    with open(input_file, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            if len(line.rstrip()) < 69:
                continue

            pun = f"{line[0:3]}-{line[3:9]}-{line[9:10]}-{line[10:14]}"
            exempt_type = line[14:64].strip()
            code = line[64:69].strip()
            pct_raw = line[69:93].strip() if len(line) > 69 else ''

            try:
                pct = float(pct_raw) if pct_raw else None
            except ValueError:
                pct = None

            if exempt_type == 'None' or not exempt_type:
                continue

            records.append({
                'pun': pun,
                'base_pun': pun[:10],
                'exemption_type': exempt_type,
                'code': code or None,
                'exemption_percentage': pct,
            })

    print(f"Total records: {len(records):,}")

    BATCH_SIZE = 500
    batch_num = 0

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i+BATCH_SIZE]
        batch_num += 1

        sql_lines = []
        for r in batch:
            sql = (
                f"INSERT OR REPLACE INTO otc_exemptions "
                f"(pun, base_pun, exemption_type, code, exemption_percentage) VALUES ("
                f"{sql_val(r['pun'])}, {sql_val(r['base_pun'])}, "
                f"{sql_val(r['exemption_type'])}, {sql_val(r['code'])}, "
                f"{sql_val(r['exemption_percentage'])});"
            )
            sql_lines.append(sql)

        with open(f"{OUTPUT_DIR}/batch_{batch_num:04d}.sql", 'w') as f:
            f.write('\n'.join(sql_lines))

    print(f"Created {batch_num} batch files in {OUTPUT_DIR}/")


if __name__ == '__main__':
    main()
