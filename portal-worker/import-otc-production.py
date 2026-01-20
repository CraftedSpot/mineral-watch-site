#!/usr/bin/env python3
"""
Import OTC production data from CSV to otc_production table.
Aggregates by PUN + year_month + product_code.
"""

import csv
import os

INPUT_FILE = "/Users/jamesprice/mymineralwatch/OTC Bulk/files (4)/exp_gpland20260112.csv"
OUTPUT_DIR = "/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-production-batches"

def format_pun(county, lease, sub, merge):
    """Format PUN components into standard format: XXX-XXXXXX-X-XXXX
    OTC uses 6-digit lease numbers (matching 1002A forms).
    """
    county = county.zfill(3)
    lease = lease.zfill(6)  # Preserve full 6-digit lease number
    sub = sub.zfill(1)
    merge = merge.zfill(4)  # OTC uses 4-digit merge
    return f"{county}-{lease}-{sub}-{merge}"

def parse_production_csv():
    """Parse production CSV and aggregate by PUN + year_month + product."""
    production = {}

    with open(INPUT_FILE, 'r') as f:
        reader = csv.DictReader(f)

        for row in reader:
            pun = format_pun(
                row['PUN County Number'],
                row['PUN Lease Number'],
                row['PUN Sub Number'],
                row['PUN Merge Number']
            )
            year_month = row['Production YearMonth']
            product = row['Product Code']

            key = (pun, year_month, product)

            if key not in production:
                production[key] = {
                    'gross_volume': 0,
                    'gross_value': 0,
                    'net_volume': 0,
                    'net_value': 0
                }

            try:
                production[key]['gross_volume'] += float(row['Gross Volume'] or 0)
                production[key]['gross_value'] += float(row['Gross Value'] or 0)
                production[key]['net_volume'] += float(row['Net Volume'] or 0)
                production[key]['net_value'] += float(row['Net Value'] or 0)
            except ValueError:
                pass

    return production

def generate_insert_batches(production, batch_size=500):
    """Generate SQL INSERT batches."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    items = list(production.items())
    batch_num = 0

    for i in range(0, len(items), batch_size):
        batch = items[i:i+batch_size]
        batch_num += 1

        values_list = []
        for (pun, year_month, product), data in batch:
            pun_escaped = pun.replace("'", "''")
            values_list.append(
                f"('{pun_escaped}', '{year_month}', '{product}', "
                f"{data['gross_volume']}, {data['gross_value']}, "
                f"{data['net_volume']}, {data['net_value']})"
            )

        sql = f"""INSERT OR REPLACE INTO otc_production
(pun, year_month, product_code, gross_volume, gross_value, net_volume, net_value)
VALUES {', '.join(values_list)};"""

        with open(f"{OUTPUT_DIR}/batch_{batch_num:03d}.sql", 'w') as f:
            f.write(sql)

    return batch_num

if __name__ == "__main__":
    print("Parsing OTC production CSV...")
    production = parse_production_csv()
    print(f"Found {len(production)} unique PUN/month/product combinations")

    # Get stats
    puns = set(k[0] for k in production.keys())
    months = set(k[1] for k in production.keys())
    products = set(k[2] for k in production.keys())

    print(f"  Unique PUNs: {len(puns)}")
    print(f"  Months: {sorted(months)}")
    print(f"  Products: {products}")

    print("\nGenerating SQL insert batches...")
    num_batches = generate_insert_batches(production)
    print(f"Generated {num_batches} batch files in {OUTPUT_DIR}")
