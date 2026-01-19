#!/usr/bin/env python3
"""
GTR36 Production Data Parser for PUN-level Import

Parses exp_gph_reports_gtr36*.dat files (fixed-width format) and imports
to otc_production table for well-level production summary.

Field Positions (0-indexed):
- Position 275-276: Reporting Month (2 chars, MM)
- Position 277-280: Reporting Year (4 chars, YYYY)
- Position 283-284: Product Code (2 chars: 01=Oil, 05=Gas, 03=CasingheadGas, 06=Condensate)
- Position 287-289: PUN County (3 chars)
- Position 290-294: PUN Lease (5 chars)
- Position 295: PUN Sub (1 char)
- Position 296-300: PUN Merge (5 chars)
- Position 577-596: Gross Volume (20 chars with decimal)

PUN Format: XXX-XXXXX-X-XXXXX (County-Lease-Sub-Merge)
"""

import os
import sys
import subprocess
from collections import defaultdict
from datetime import datetime

# Configuration
INPUT_DIR = os.environ.get("INPUT_DIR", "/Users/jamesprice/mymineralwatch/OTC Bulk/extracted_otc/Gross-Production-Extracts")
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/Users/jamesprice/mymineralwatch/mineral-watch-site/portal-worker/otc-production-batches")
BATCH_SIZE = 500

# Product code mapping - combine into oil/gas
PRODUCT_OIL_CODES = {'01', '06'}  # Oil + Condensate
PRODUCT_GAS_CODES = {'03', '05'}  # Casinghead Gas + Gas


def format_pun(county, lease, sub, merge):
    """Format PUN components into standard format: XXX-XXXXX-X-XXXXX"""
    return f"{county}-{lease}-{sub}-{merge}"


def parse_gtr36_file(filepath):
    """
    Parse GTR36 gross production .dat file (fixed-width format).

    Returns dict: {(pun, year_month, product_type): gross_volume}
    where product_type is 'OIL' or 'GAS'
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

                # PUN components
                pun_county = line[287:290]
                pun_lease = line[290:295]
                pun_sub = line[295:296]
                pun_merge = line[296:301]

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

                # Format year_month as YYYY-MM for consistency with otc_production
                year_month = f"{year}-{month}"

                # Validate PUN components
                if not pun_county.isdigit() or not pun_lease.isdigit():
                    skipped_invalid += 1
                    continue
                if not pun_sub.isdigit() or not pun_merge.isdigit():
                    skipped_invalid += 1
                    continue

                # Format PUN
                pun = format_pun(pun_county, pun_lease, pun_sub, pun_merge)

                # Determine product type (OIL or GAS)
                if product_code in PRODUCT_OIL_CODES:
                    product_type = 'OIL'
                elif product_code in PRODUCT_GAS_CODES:
                    product_type = 'GAS'
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
                key = (pun, year_month, product_type)
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


def generate_sql_batches(production, output_dir, source_file):
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
        sql = f"""-- Source: {source_file}
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
            # Read the SQL file
            with open(filepath, 'r') as f:
                sql = f.read()

            # Execute via wrangler d1 execute
            result = subprocess.run(
                ['npx', 'wrangler', 'd1', 'execute', 'oklahoma-wells', '--remote', '--command', sql],
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
    print("GTR36 PUN-Level Production Data Parser")
    print(f"Started: {datetime.now()}")
    print("=" * 60)
    print(f"Input directory: {INPUT_DIR}")
    print(f"Output directory: {OUTPUT_DIR}")
    print()

    # Find files to process
    if not os.path.exists(INPUT_DIR):
        print(f"Input directory not found: {INPUT_DIR}")
        return 1

    # Find gtr36 files
    dat_files = []
    for filename in os.listdir(INPUT_DIR):
        if filename.startswith('exp_gph_reports_gtr36') and filename.endswith('.dat'):
            dat_files.append(filename)

    dat_files = sorted(dat_files)

    if not dat_files:
        print("No GTR36 production data files found.")
        print("Expected files matching: exp_gph_reports_gtr36*.dat")
        return 0

    print(f"Found {len(dat_files)} GTR36 file(s):")
    for f in dat_files:
        filepath = os.path.join(INPUT_DIR, f)
        size_mb = os.path.getsize(filepath) / (1024 * 1024)
        print(f"  - {f} ({size_mb:.1f} MB)")
    print()

    # Process files - use the most recent (largest) file which is cumulative
    # For gtr36, we only need the latest file as it contains all historical data
    target_file = dat_files[-1]  # Most recent by filename
    filepath = os.path.join(INPUT_DIR, target_file)

    print(f"Processing: {target_file}")
    print("-" * 50)

    # Parse the file
    production = parse_gtr36_file(filepath)

    if not production:
        print("No valid data found.")
        return 1

    # Create output directory with timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    batch_dir = os.path.join(OUTPUT_DIR, timestamp)

    # Generate SQL batches
    num_batches = generate_sql_batches(production, batch_dir, target_file)

    # Print summary statistics
    print("\n" + "=" * 60)
    print("Summary Statistics")
    print("=" * 60)

    # Calculate totals by product type
    oil_volume = sum(v for (p, m, t), v in production.items() if t == 'OIL')
    gas_volume = sum(v for (p, m, t), v in production.items() if t == 'GAS')

    # Get date range
    months = set(m for (p, m, t) in production.keys())
    min_month = min(months) if months else "N/A"
    max_month = max(months) if months else "N/A"

    # Count unique PUNs
    puns = set(p for (p, m, t) in production.keys())

    print(f"Date range: {min_month} to {max_month}")
    print(f"Unique PUNs: {len(puns):,}")
    print(f"Total Oil Volume: {oil_volume:,.0f} BBL")
    print(f"Total Gas Volume: {gas_volume:,.0f} MCF")
    print(f"Total records: {len(production):,}")

    # Check for NEWLEY PUN
    newley_pun = "043-22659-7-00000"
    newley_records = [(k, v) for k, v in production.items() if k[0] == newley_pun]
    if newley_records:
        print(f"\nNEWLEY PUN ({newley_pun}) found: {len(newley_records)} records")
        for (pun, month, product), volume in sorted(newley_records)[:5]:
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
