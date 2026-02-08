#!/usr/bin/env python3
"""
Current Production Data Parser (12-month and 36-month files)

Parses exp_gph_reports_12*.dat and exp_gph_reports_36*.dat files (fixed-width format)
and imports to otc_production table for well-level production summary.

These files contain CURRENT production data, unlike gtr36 which has historical data.

Field Positions (0-indexed Python slices per OTC data dictionary):
- [275:277] Reporting Month (2 chars, MM)
- [277:281] Reporting Year (4 chars, YYYY)
- [283:285] Product Code (2 chars: 01=Oil, 03=Condensate, 05=CasingheadGas, 06=NaturalGas)
- [287:290] PUN County (3 chars)
- [290:296] PUN Lease (6 chars)
- [296:297] PUN Sub (1 char)
- [297:301] PUN Merge (4 chars)
- [577:597] Gross Volume (20 chars with decimal)

PUN Format: XXX-XXXXXX-X-XXXX (County-Lease-Sub-Merge) = 3-6-1-4 digits
D1 year_month format: YYYYMM (no dash)
D1 product_code format: '1', '3', '5', '6' (single digit strings)
"""

import os
import sys
import subprocess
from collections import defaultdict
from datetime import datetime

# Configuration
INPUT_DIR = os.environ.get("INPUT_DIR", "/Users/jamesprice/mymineralwatch/OTC Bulk/extracted_otc/Gross-Production-Extracts")
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-current-batches")
BATCH_SIZE = 500

# Product code mapping - raw 2-char field to single digit for D1
PRODUCT_CODE_MAP = {
    '01': '1',   # Crude Oil
    ' 1': '1',
    '03': '3',   # Condensate
    ' 3': '3',
    '05': '5',   # Casinghead Gas
    ' 5': '5',
    '06': '6',   # Natural Gas
    ' 6': '6',
}


def format_pun(county, lease, sub, merge):
    """Format PUN components into standard format: XXX-XXXXXX-X-XXXX (3-6-1-4)"""
    return f"{county}-{lease.strip().zfill(6)}-{sub}-{merge.strip().zfill(4)}"


def parse_production_file(filepath):
    """
    Parse 12/36 month production .dat file (fixed-width format).

    Returns dict: {(pun, year_month, product_code): gross_volume}
    where product_code is '1', '3', '5', or '6'
    """
    production = defaultdict(float)

    print(f"  Parsing {os.path.basename(filepath)}...")
    row_count = 0
    valid_count = 0
    skipped_short = 0
    skipped_invalid = 0

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            row_count += 1

            if len(line) < 600:
                skipped_short += 1
                continue

            try:
                # Extract fields from fixed positions
                month = line[275:277]
                year = line[277:281]
                product_code = line[283:285]

                # PUN components (3-6-1-4 per OTC data dictionary)
                pun_county = line[287:290]
                pun_lease = line[290:296]
                pun_sub = line[296:297]
                pun_merge = line[297:301]

                gross_vol_str = line[577:597].strip()

                # Validate month/year
                if not month.isdigit() or not year.isdigit():
                    skipped_invalid += 1
                    continue
                if not (1 <= int(month) <= 12):
                    skipped_invalid += 1
                    continue
                if not (2000 <= int(year) <= 2030):
                    skipped_invalid += 1
                    continue

                # Format year_month as YYYYMM (matches D1 format, no dash)
                year_month = f"{year}{month}"

                # Validate PUN components
                if not pun_county.isdigit() or not pun_lease.strip().isdigit():
                    skipped_invalid += 1
                    continue
                if not pun_sub.isdigit() or not pun_merge.strip().isdigit():
                    skipped_invalid += 1
                    continue

                # Format PUN (3-6-1-4)
                pun = format_pun(pun_county, pun_lease, pun_sub, pun_merge)

                # Map product code (2-char raw → single digit for D1)
                mapped_code = PRODUCT_CODE_MAP.get(product_code)
                if not mapped_code:
                    stripped = product_code.strip()
                    if stripped in ('1', '3', '5', '6'):
                        mapped_code = stripped
                    else:
                        skipped_invalid += 1
                        continue

                # Parse gross volume
                try:
                    # Remove any + signs that appear in the data
                    gross_vol_str = gross_vol_str.replace('+', '')
                    gross_volume = float(gross_vol_str)
                except ValueError:
                    skipped_invalid += 1
                    continue

                # Aggregate by PUN + year_month + product
                key = (pun, year_month, mapped_code)
                production[key] += gross_volume
                valid_count += 1

            except (ValueError, IndexError) as e:
                skipped_invalid += 1
                continue

            if row_count % 1000000 == 0:
                print(f"    Processed {row_count:,} rows, {valid_count:,} valid...")

    print(f"  Total rows: {row_count:,}")
    print(f"  Valid records: {valid_count:,}")
    print(f"  Skipped (short lines): {skipped_short:,}")
    print(f"  Skipped (invalid data): {skipped_invalid:,}")
    print(f"  Unique PUN/month/product combinations: {len(production):,}")

    return production


def generate_sql_batches(production, output_dir, source_files):
    """Generate SQL INSERT statements in batches for D1."""
    os.makedirs(output_dir, exist_ok=True)

    # Convert to list and sort for consistent output
    items = sorted(production.items())
    batch_num = 0
    total_batches = (len(items) + BATCH_SIZE - 1) // BATCH_SIZE

    print(f"  Generating {total_batches} SQL batch files...")

    for i in range(0, len(items), BATCH_SIZE):
        batch = items[i:i + BATCH_SIZE]
        batch_num += 1

        values_list = []
        for (pun, year_month, product_type), gross_volume in batch:
            pun_escaped = pun.replace("'", "''")
            values_list.append(
                f"('{pun_escaped}', '{year_month}', '{product_type}', {gross_volume:.2f}, 0, 0, 0)"
            )

        values_sql = ',\n'.join(values_list)
        sql = f"""-- Source: {', '.join(source_files)}
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

    print(f"  Generated {batch_num} batch files in {output_dir}")
    return batch_num


def execute_sql_batches(output_dir):
    """Execute SQL batch files against D1 database."""
    batch_files = sorted([f for f in os.listdir(output_dir) if f.endswith('.sql')])

    if not batch_files:
        print("No batch files to execute.")
        return

    print(f"\nExecuting {len(batch_files)} SQL batch files...")

    success_count = 0
    error_count = 0

    for i, batch_file in enumerate(batch_files):
        filepath = os.path.join(output_dir, batch_file)

        try:
            # Execute via wrangler d1 execute using --file
            result = subprocess.run(
                ['npx', 'wrangler', 'd1', 'execute', 'oklahoma-wells', '--remote', '--file', filepath],
                capture_output=True,
                text=True,
                timeout=120
            )

            if result.returncode == 0:
                success_count += 1
                if (i + 1) % 10 == 0:
                    print(f"    Executed {i + 1}/{len(batch_files)} batches...")
            else:
                error_count += 1
                print(f"    ERROR in {batch_file}: {result.stderr[:200]}")

        except subprocess.TimeoutExpired:
            error_count += 1
            print(f"    TIMEOUT in {batch_file}")
        except Exception as e:
            error_count += 1
            print(f"    EXCEPTION in {batch_file}: {str(e)}")

    print(f"\n  Execution complete: {success_count} succeeded, {error_count} failed")


def main():
    print("=" * 60)
    print("Current Production Data Parser (12/36 month files)")
    print(f"Started: {datetime.now()}")
    print("=" * 60)
    print(f"Input directory: {INPUT_DIR}")
    print(f"Output directory: {OUTPUT_DIR}")
    print()

    # Find files to process
    if not os.path.exists(INPUT_DIR):
        print(f"Input directory not found: {INPUT_DIR}")
        return 1

    # Find _12 and _36 files (exclude gtr36)
    dat_files = []
    for filename in os.listdir(INPUT_DIR):
        if filename.endswith('.dat') and not filename.endswith('.dat.zip'):
            if 'exp_gph_reports_12' in filename or 'exp_gph_reports_36' in filename:
                if 'gtr36' not in filename:
                    dat_files.append(filename)

    dat_files = sorted(dat_files)

    if not dat_files:
        print("No 12/36 month production files found.")
        print("Expected files matching: exp_gph_reports_12*.dat or exp_gph_reports_36*.dat")
        return 0

    print(f"Found {len(dat_files)} file(s):")
    for f in dat_files:
        filepath = os.path.join(INPUT_DIR, f)
        size_mb = os.path.getsize(filepath) / (1024 * 1024)
        print(f"  - {f} ({size_mb:.1f} MB)")
    print()

    # Combine production from all files
    all_production = defaultdict(float)

    for filename in dat_files:
        filepath = os.path.join(INPUT_DIR, filename)
        print(f"Processing: {filename}")
        print("-" * 50)

        production = parse_production_file(filepath)

        # Merge into combined dict
        for key, value in production.items():
            all_production[key] += value

        print()

    if not all_production:
        print("No valid data found.")
        return 1

    # Create output directory with timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    batch_dir = os.path.join(OUTPUT_DIR, timestamp)

    # Generate SQL batches
    num_batches = generate_sql_batches(all_production, batch_dir, dat_files)

    # Print summary statistics
    print("\n" + "=" * 60)
    print("Summary Statistics")
    print("=" * 60)

    # Calculate totals by product type
    oil_volume = sum(v for (p, m, t), v in all_production.items() if t in ('1', '3'))
    gas_volume = sum(v for (p, m, t), v in all_production.items() if t in ('5', '6'))

    # Get date range
    months = set(m for (p, m, t) in all_production.keys())
    min_month = min(months) if months else "N/A"
    max_month = max(months) if months else "N/A"

    # Count unique PUNs
    puns = set(p for (p, m, t) in all_production.keys())

    print(f"Date range: {min_month} to {max_month}")
    print(f"Unique PUNs: {len(puns):,}")
    print(f"Total Oil Volume: {oil_volume:,.0f} BBL")
    print(f"Total Gas Volume: {gas_volume:,.0f} MCF")
    print(f"Total records: {len(all_production):,}")

    # Check for NEWLEY PUN
    newley_pun = "043-22659-7-00000"
    newley_records = [(k, v) for k, v in all_production.items() if k[0] == newley_pun]
    if newley_records:
        print(f"\nNEWLEY PUN ({newley_pun}) found: {len(newley_records)} records")
        for (pun, month, product), volume in sorted(newley_records, reverse=True)[:10]:
            print(f"  {month} {product}: {volume:,.2f}")
    else:
        print(f"\nNEWLEY PUN ({newley_pun}) NOT FOUND in data!")

    print("\n" + "=" * 60)
    print(f"SQL batches saved to: {batch_dir}")
    print("=" * 60)

    # Ask if user wants to execute
    if len(sys.argv) > 1 and sys.argv[1] == '--execute':
        execute_sql_batches(batch_dir)
    else:
        print("\nTo import to D1, run with --execute flag:")
        print(f"  python3 {sys.argv[0]} --execute")
        print("\nOr manually run the SQL files with:")
        print(f"  for f in {batch_dir}/*.sql; do")
        print(f"    npx wrangler d1 execute oklahoma-wells --remote --file \"$f\"")
        print(f"  done")

    return 0


if __name__ == "__main__":
    sys.exit(main())
