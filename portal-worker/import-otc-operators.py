#!/usr/bin/env python3
"""
Import OTC operator data from exp_gpoper file.

This script does two things:
1. Populates otc_companies table with operator_number → company_name mapping
2. Updates otc_leases with operator_number based on PUN match

Field positions in exp_gpoper:
  0-13   PUN raw (14 digits): county(3) + lease(6) + sub(1) + merge(4)
  14-20  Operator/company number (7 chars)
  21+    Company name (remaining chars)

Usage:
    python3 import-otc-operators.py [input_file]
"""

import os
import sys


INPUT_FILE = "/Users/jamesprice/mymineralwatch/OTC Bulk/files (4)/exp_gpoper20260112.dat"
OUTPUT_DIR = "/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-operator-batches"


def format_pun_with_dashes(raw_pun):
    """Format raw PUN (14 chars) to dashed format: XXX-XXXXXX-X-XXXX (3-6-1-4)"""
    if len(raw_pun) < 14:
        raw_pun = raw_pun.ljust(14, '0')
    return f"{raw_pun[0:3]}-{raw_pun[3:9]}-{raw_pun[9:10]}-{raw_pun[10:14]}"


def escape_sql(s):
    """Escape single quotes for SQL"""
    if s is None:
        return ''
    return s.replace("'", "''")


def parse_operator_file(input_file):
    """Parse OTC operator file and extract PUN -> operator_number + company name mappings."""
    pun_to_operator = {}
    companies = {}  # operator_number -> company_name

    with open(input_file, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            if len(line) < 21:
                continue

            raw_pun = line[0:14].strip()
            operator_number = line[14:21].strip()
            company_name = line[21:].strip().rstrip('\r\n')

            if raw_pun and operator_number:
                formatted_pun = format_pun_with_dashes(raw_pun)
                # Remove leading zeros from operator number for consistency
                op_num = operator_number.lstrip('0') or '0'
                pun_to_operator[formatted_pun] = op_num

                # Track company names (keep the most recent)
                if op_num and company_name:
                    companies[op_num] = company_name

    return pun_to_operator, companies


def generate_batches(pun_to_operator, companies, batch_size=500):
    """Generate SQL batch files for both otc_companies and otc_leases updates."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Clear old batch files
    for f in os.listdir(OUTPUT_DIR):
        if f.endswith('.sql'):
            os.remove(os.path.join(OUTPUT_DIR, f))

    batch_num = 0

    # 1. Generate otc_companies INSERT batches
    company_items = list(companies.items())
    for i in range(0, len(company_items), batch_size):
        batch = company_items[i:i+batch_size]
        batch_num += 1

        sql_lines = []
        for op_num, name in batch:
            sql_lines.append(
                f"INSERT OR REPLACE INTO otc_companies (company_id, company_name, updated_at) "
                f"VALUES ('{escape_sql(op_num)}', '{escape_sql(name)}', datetime('now'));"
            )

        with open(f"{OUTPUT_DIR}/batch_{batch_num:03d}.sql", 'w') as f:
            f.write('\n'.join(sql_lines))

    companies_batches = batch_num
    print(f"  Generated {companies_batches} company batches ({len(companies)} companies)")

    # 2. Generate otc_leases UPDATE batches
    lease_items = list(pun_to_operator.items())
    for i in range(0, len(lease_items), batch_size):
        batch = lease_items[i:i+batch_size]
        batch_num += 1

        sql_lines = []
        for pun, operator_number in batch:
            pun_escaped = escape_sql(pun)
            operator_escaped = escape_sql(operator_number)
            sql_lines.append(
                f"UPDATE otc_leases SET operator_number = '{operator_escaped}' WHERE pun = '{pun_escaped}';"
            )

        with open(f"{OUTPUT_DIR}/batch_{batch_num:03d}.sql", 'w') as f:
            f.write('\n'.join(sql_lines))

    lease_batches = batch_num - companies_batches
    print(f"  Generated {lease_batches} lease update batches ({len(pun_to_operator)} PUNs)")

    return batch_num


if __name__ == "__main__":
    input_file = sys.argv[1] if len(sys.argv) > 1 else INPUT_FILE

    print(f"Parsing OTC operator file: {input_file}")
    pun_to_operator, companies = parse_operator_file(input_file)
    print(f"Found {len(pun_to_operator)} PUN → operator mappings")
    print(f"Found {len(companies)} unique companies")

    print(f"\nGenerating SQL batches in {OUTPUT_DIR}/...")
    num_batches = generate_batches(pun_to_operator, companies)
    print(f"\nTotal: {num_batches} batch files")

    print("\nSample PUN → operator mappings:")
    for i, (pun, op) in enumerate(list(pun_to_operator.items())[:5]):
        name = companies.get(op, '?')
        print(f"  {pun} → operator {op} ({name})")

    print(f"\nTo execute:")
    print(f"  for f in {OUTPUT_DIR}/batch_*.sql; do")
    print(f"    wrangler d1 execute oklahoma-wells --remote --file=\"$f\"")
    print(f"    sleep 0.2")
    print(f"  done")
