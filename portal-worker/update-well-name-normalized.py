#!/usr/bin/env python3
"""
Update well_name_normalized in statewide wells table to combine well_name + well_number.

Before: well_name_normalized = normalize(well_name)  →  "JOHNNY"
After:  well_name_normalized = normalize(well_name + " " + well_number)  →  "JOHNNY110"

This is a one-time fix. The normalization strips all non-alphanumeric and uppercases.
"""

import subprocess
import json
import sys
import re

DB_NAME = "oklahoma-wells"

def run_d1(sql):
    """Execute SQL on remote D1 and return results."""
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DB_NAME, "--remote", "--command", sql],
        capture_output=True, text=True, timeout=120
    )
    if result.returncode != 0:
        print(f"ERROR: {result.stderr}")
        return None
    try:
        # Parse JSON from output - find the first [
        output = result.stdout
        start = output.index('[')
        data = json.loads(output[start:])
        return data[0].get('results', [])
    except (ValueError, json.JSONDecodeError, IndexError) as e:
        print(f"Parse error: {e}")
        print(f"Output: {result.stdout[:500]}")
        return None

def normalize_name(name):
    """Same normalization as generate-name-links.py"""
    if not name:
        return ''
    name = name.upper().strip()
    name = re.sub(r'[^A-Z0-9]', '', name)
    return name

# Step 1: Count how many need updating
print("Checking how many wells need well_name_normalized update...")
results = run_d1(
    "SELECT COUNT(*) as cnt FROM wells "
    "WHERE well_number IS NOT NULL AND length(well_number) > 0;"
)
if results:
    total = results[0]['cnt']
    print(f"  {total:,} wells have well_number — will update their normalized names")

# Step 2: Sample before/after
print("\nSample before update:")
samples = run_d1(
    "SELECT api_number, well_name, well_number, well_name_normalized "
    "FROM wells WHERE well_number IS NOT NULL AND length(well_number) > 0 LIMIT 5;"
)
if samples:
    for s in samples:
        old_norm = s['well_name_normalized']
        new_norm = normalize_name((s['well_name'] or '') + ' ' + (s['well_number'] or ''))
        print(f"  {s['api_number']}: '{s['well_name']}' + '{s['well_number']}' → old='{old_norm}' new='{new_norm}'")

# Step 3: Run the UPDATE using SQLite string functions
# We can't use regex in SQLite, but we CAN use REPLACE to strip common non-alpha chars.
# Actually, we need proper normalization. Let's use a chunked approach with Python.
#
# D1 UPDATE with SQLite: We can use UPPER() and multiple REPLACE() calls, but that's
# fragile. Better approach: use a single UPDATE with SQLite's built-in functions.
#
# SQLite doesn't have regex replace, but we can do:
#   UPPER(well_name || ' ' || well_number) then strip non-alphanumeric
#
# Actually, the safest approach: do it in batches from Python.

BATCH_SIZE = 500  # D1 batch limit is 500 statements

print("\nFetching all wells with well_number for re-normalization...")
print("(This will be done in batches of", BATCH_SIZE, ")")

offset = 0
total_updated = 0
batch_num = 0

while True:
    batch_num += 1
    # Fetch a batch of wells
    rows = run_d1(
        f"SELECT api_number, well_name, well_number FROM wells "
        f"WHERE well_number IS NOT NULL AND length(well_number) > 0 "
        f"ORDER BY api_number LIMIT {BATCH_SIZE} OFFSET {offset};"
    )

    if not rows:
        break

    if len(rows) == 0:
        break

    # Build UPDATE statements
    # We'll use a single UPDATE with CASE WHEN for the batch
    # Actually, D1 batch limit is 500 statements, so let's just
    # build individual UPDATEs and run them as a batch via --file

    # Build SQL for this batch
    updates = []
    for row in rows:
        combined = (row['well_name'] or '') + ' ' + (row['well_number'] or '')
        new_norm = normalize_name(combined)
        api = row['api_number']
        # Escape single quotes
        new_norm_escaped = new_norm.replace("'", "''")
        updates.append(
            f"UPDATE wells SET well_name_normalized = '{new_norm_escaped}' "
            f"WHERE api_number = '{api}';"
        )

    # Write batch to temp file and execute
    batch_sql = "\n".join(updates)
    batch_file = f"/tmp/well_norm_batch_{batch_num}.sql"
    with open(batch_file, 'w') as f:
        f.write(batch_sql)

    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DB_NAME, "--remote", "--file", batch_file],
        capture_output=True, text=True, timeout=120
    )

    if result.returncode != 0:
        print(f"  Batch {batch_num} FAILED: {result.stderr[:200]}")
        # Try to continue
    else:
        total_updated += len(rows)
        if batch_num % 20 == 0 or len(rows) < BATCH_SIZE:
            print(f"  Batch {batch_num}: {total_updated:,} updated so far...")

    offset += BATCH_SIZE

    if len(rows) < BATCH_SIZE:
        break

print(f"\nDone! Updated {total_updated:,} well_name_normalized values.")

# Step 4: Verify with samples
print("\nSample after update:")
samples = run_d1(
    "SELECT api_number, well_name, well_number, well_name_normalized "
    "FROM wells WHERE api_number IN ('3509121488','3509121508','3515122783');"
)
if samples:
    for s in samples:
        print(f"  {s['api_number']}: '{s['well_name']}' + '{s['well_number']}' → '{s['well_name_normalized']}'")
