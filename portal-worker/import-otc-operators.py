#!/usr/bin/env python3
"""
Import OTC operator numbers to otc_leases table.
Parses exp_gpoper file and updates otc_leases with operator_number based on PUN match.
"""

import os

INPUT_FILE = "/Users/jamesprice/mymineralwatch/OTC Bulk/files (4)/exp_gpoper20260112.dat"
OUTPUT_DIR = "/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-operator-batches"

def format_pun_with_dashes(raw_pun):
    """Format raw PUN (14 chars) to dashed format: XXX-XXXXX-X-XXXXX"""
    if len(raw_pun) < 14:
        raw_pun = raw_pun.ljust(14, '0')
    return f"{raw_pun[0:3]}-{raw_pun[3:8]}-{raw_pun[8]}-{raw_pun[9:14]}"

def parse_operator_file():
    """Parse OTC operator file and extract PUN -> operator_number mapping."""
    pun_to_operator = {}

    with open(INPUT_FILE, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            if len(line) < 21:
                continue

            # Fixed-width format:
            # 0-14: PUN (14 chars)
            # 14-21: Operator Number (7 chars)
            raw_pun = line[0:14].strip()
            operator_number = line[14:21].strip()

            if raw_pun and operator_number:
                # Format PUN with dashes to match otc_leases table format
                formatted_pun = format_pun_with_dashes(raw_pun)
                # Remove leading zeros from operator number for consistency
                operator_number = operator_number.lstrip('0') or '0'
                pun_to_operator[formatted_pun] = operator_number

    return pun_to_operator

def generate_update_batches(pun_to_operator, batch_size=500):
    """Generate SQL UPDATE batches."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    items = list(pun_to_operator.items())
    batch_num = 0

    for i in range(0, len(items), batch_size):
        batch = items[i:i+batch_size]
        batch_num += 1

        sql_lines = []
        for pun, operator_number in batch:
            # Escape single quotes in PUN if any
            pun_escaped = pun.replace("'", "''")
            operator_escaped = operator_number.replace("'", "''")
            sql_lines.append(f"UPDATE otc_leases SET operator_number = '{operator_escaped}' WHERE pun = '{pun_escaped}';")

        sql = "\n".join(sql_lines)

        with open(f"{OUTPUT_DIR}/batch_{batch_num:03d}.sql", 'w') as f:
            f.write(sql)

    return batch_num

if __name__ == "__main__":
    print("Parsing OTC operator file...")
    pun_to_operator = parse_operator_file()
    print(f"Found {len(pun_to_operator)} unique PUN -> operator mappings")

    print("\nGenerating SQL update batches...")
    num_batches = generate_update_batches(pun_to_operator)
    print(f"Generated {num_batches} batch files in {OUTPUT_DIR}")

    print("\nSample mappings:")
    for i, (pun, op) in enumerate(list(pun_to_operator.items())[:5]):
        print(f"  PUN {pun} -> Operator {op}")
