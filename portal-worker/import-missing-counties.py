#!/usr/bin/env python3
"""
Import missing county production data from the 36-month current file.

Counties missing 2023+ data: 001, 003, 005, 007, 009, 011, 013, 015
(Also 021 and 115 which have very old max dates)

Parses exp_gph_reports_36*.dat and generates SQL batch files for loading
into otc_production via wrangler d1 execute.

Field positions per OTC data dictionary (0-indexed Python slices):
- [275:277] Reporting Month (MM)
- [277:281] Reporting Year (YYYY)
- [283:285] Product Code (01=Oil, 03=Condensate, 05=CasingheadGas, 06=NaturalGas)
- [287:290] PUN County (3 digits)
- [290:296] PUN Lease (6 digits)
- [296:297] PUN Sub (1 digit)
- [297:301] PUN Merge (4 digits)
- [577:597] Gross Volume (20 chars decimal)
"""

import os
import sys
from collections import defaultdict
from datetime import datetime

# Configuration
INPUT_FILE = "/Users/jamesprice/mymineralwatch/OTC Bulk/extracted_otc/Gross-Production-Extracts/exp_gph_reports_3620260112.dat"
OUTPUT_DIR = "/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-missing-county-batches"
BATCH_SIZE = 500

# Counties missing 2023+ data
MISSING_COUNTIES = {'001', '003', '005', '007', '009', '011', '013', '015', '021', '115'}

# Product code mapping (raw 2-char → single digit for D1)
PRODUCT_CODE_MAP = {
    '01': '1',   # Crude Oil
    ' 1': '1',
    '1 ': '1',
    '03': '3',   # Condensate
    ' 3': '3',
    '3 ': '3',
    '05': '5',   # Casinghead Gas
    ' 5': '5',
    '5 ': '5',
    '06': '6',   # Natural Gas
    ' 6': '6',
    '6 ': '6',
}


def parse_production_file(filepath):
    """
    Parse 36-month production file, filtering to only missing counties.
    Returns dict: {(pun, year_month, product_code): gross_volume}
    """
    production = defaultdict(float)

    print(f"Parsing {os.path.basename(filepath)}...")
    print(f"Filtering to counties: {sorted(MISSING_COUNTIES)}")
    row_count = 0
    valid_count = 0
    county_counts = defaultdict(int)
    skipped_short = 0
    skipped_county = 0
    skipped_invalid = 0

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            row_count += 1

            if len(line) < 600:
                skipped_short += 1
                continue

            try:
                # PUN county first — skip early if not in our set
                pun_county = line[287:290]
                if pun_county not in MISSING_COUNTIES:
                    skipped_county += 1
                    continue

                # Extract remaining fields
                month = line[275:277]
                year = line[277:281]
                product_code_raw = line[283:285]

                pun_lease = line[290:296]
                pun_sub = line[296:297]
                pun_merge = line[297:301]

                gross_vol_str = line[577:597].strip()

                # Validate month/year
                if not month.isdigit() or not year.isdigit():
                    skipped_invalid += 1
                    continue
                month_int = int(month)
                year_int = int(year)
                if not (1 <= month_int <= 12) or not (2000 <= year_int <= 2030):
                    skipped_invalid += 1
                    continue

                # Format year_month as YYYYMM (matches D1 format)
                year_month = f"{year}{month}"

                # Validate PUN components
                if not pun_county.isdigit() or not pun_lease.strip().isdigit():
                    skipped_invalid += 1
                    continue
                if not pun_sub.isdigit() or not pun_merge.strip().isdigit():
                    skipped_invalid += 1
                    continue

                # Zero-pad lease and merge
                pun_lease = pun_lease.strip().zfill(6)
                pun_merge = pun_merge.strip().zfill(4)

                # Format PUN: XXX-XXXXXX-X-XXXX
                pun = f"{pun_county}-{pun_lease}-{pun_sub}-{pun_merge}"

                # Map product code
                product_code = PRODUCT_CODE_MAP.get(product_code_raw)
                if not product_code:
                    # Try stripping
                    stripped = product_code_raw.strip()
                    if stripped in ('1', '3', '5', '6'):
                        product_code = stripped
                    else:
                        skipped_invalid += 1
                        continue

                # Parse gross volume
                gross_vol_str = gross_vol_str.replace('+', '')
                try:
                    gross_volume = float(gross_vol_str)
                except ValueError:
                    skipped_invalid += 1
                    continue

                # Aggregate
                key = (pun, year_month, product_code)
                production[key] += gross_volume
                valid_count += 1
                county_counts[pun_county] += 1

            except (ValueError, IndexError):
                skipped_invalid += 1
                continue

            if row_count % 1000000 == 0:
                print(f"  Processed {row_count:,} rows, {valid_count:,} valid for missing counties...")

    print(f"\nParsing complete:")
    print(f"  Total rows scanned: {row_count:,}")
    print(f"  Valid records (missing counties): {valid_count:,}")
    print(f"  Skipped (other counties): {skipped_county:,}")
    print(f"  Skipped (short lines): {skipped_short:,}")
    print(f"  Skipped (invalid data): {skipped_invalid:,}")
    print(f"  Unique PUN/month/product combos: {len(production):,}")
    print(f"\n  Records by county:")
    for county in sorted(county_counts.keys()):
        print(f"    {county}: {county_counts[county]:,} raw records")

    return production


def generate_sql_batches(production, output_dir):
    """Generate SQL INSERT OR REPLACE batch files."""
    os.makedirs(output_dir, exist_ok=True)

    items = sorted(production.items())
    batch_num = 0
    total_batches = (len(items) + BATCH_SIZE - 1) // BATCH_SIZE

    print(f"\nGenerating {total_batches} SQL batch files in {output_dir}...")

    for i in range(0, len(items), BATCH_SIZE):
        batch = items[i:i + BATCH_SIZE]
        batch_num += 1

        values_list = []
        for (pun, year_month, product_code), gross_volume in batch:
            pun_escaped = pun.replace("'", "''")
            values_list.append(
                f"('{pun_escaped}', '{year_month}', '{product_code}', {gross_volume:.2f}, 0, 0, 0)"
            )

        values_sql = ',\n'.join(values_list)
        sql = f"""-- Missing county backfill from exp_gph_reports_3620260112.dat
-- Batch {batch_num} of {total_batches}
-- Generated: {datetime.now().isoformat()}

INSERT OR REPLACE INTO otc_production
(pun, year_month, product_code, gross_volume, gross_value, net_volume, net_value)
VALUES
{values_sql};
"""

        output_file = os.path.join(output_dir, f"batch_{batch_num:04d}.sql")
        with open(output_file, 'w') as f:
            f.write(sql)

    print(f"Generated {batch_num} batch files")
    return batch_num


def main():
    print("=" * 60)
    print("Missing County Production Data Import")
    print(f"Started: {datetime.now()}")
    print("=" * 60)

    if not os.path.exists(INPUT_FILE):
        print(f"ERROR: Input file not found: {INPUT_FILE}")
        return 1

    size_gb = os.path.getsize(INPUT_FILE) / (1024 ** 3)
    print(f"Input: {INPUT_FILE} ({size_gb:.1f} GB)")
    print()

    # Parse
    production = parse_production_file(INPUT_FILE)

    if not production:
        print("No valid data found for missing counties.")
        return 1

    # Stats
    months = set(m for (p, m, t) in production.keys())
    puns = set(p for (p, m, t) in production.keys())
    counties = set(p.split('-')[0] for p in puns)

    print(f"\nData summary:")
    print(f"  Date range: {min(months)} to {max(months)}")
    print(f"  Unique PUNs: {len(puns):,}")
    print(f"  Counties: {sorted(counties)}")
    print(f"  Total records: {len(production):,}")

    # Generate batches
    generate_sql_batches(production, OUTPUT_DIR)

    print(f"\nTo load into D1, run:")
    print(f"  cd /Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker")
    print(f"  ./load-remaining.sh otc-missing-county-batches 0")

    return 0


if __name__ == "__main__":
    sys.exit(main())
