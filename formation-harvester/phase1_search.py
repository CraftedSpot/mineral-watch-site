#!/usr/bin/env python3
"""
Phase 1: Search OCC for 1002A Form Availability

For each well missing formation_name, checks if OCC has a 1002A completion report.
Saves results to phase1_results.json for Phase 2 extraction.

Usage:
    python phase1_search.py

Resumable: saves progress to phase1_progress.json every 100 wells.
Estimated runtime: 66K wells x 200ms = ~3.7 hours
"""

import json
import os
import sys
import time

import requests

from occ_session import search_well_records, get_session_cookies

# Configuration
API_BASE = os.environ.get("API_BASE", "https://portal.mymineralwatch.com")
API_KEY = os.environ.get("PROCESSING_API_KEY", "mmw-proc-2024-secure-key")
PAGE_SIZE = 5000
THROTTLE_MS = 200  # ms between OCC requests
PROGRESS_FILE = "phase1_progress.json"
RESULTS_FILE = "phase1_results.json"
ERRORS_FILE = "phase1_errors.json"


def fetch_wells_missing_formation(offset=0):
    """Fetch a page of wells missing formation from portal-worker."""
    resp = requests.get(
        f"{API_BASE}/api/admin/wells-missing-formation",
        params={"limit": PAGE_SIZE, "offset": offset},
        headers={"Authorization": f"Bearer {API_KEY}"},
    )
    resp.raise_for_status()
    data = resp.json()
    return data["wells"], data["count"]


def load_progress():
    """Load progress from previous run."""
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"checked": 0, "found": 0, "not_found": 0, "errors": 0}


def save_progress(progress):
    """Save progress for resume."""
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f, indent=2)


def load_results():
    """Load existing results for append."""
    if os.path.exists(RESULTS_FILE):
        with open(RESULTS_FILE) as f:
            return json.load(f)
    return []


def save_results(results):
    """Save results."""
    with open(RESULTS_FILE, "w") as f:
        json.dump(results, f, indent=2)


def load_errors():
    """Load existing errors for append."""
    if os.path.exists(ERRORS_FILE):
        with open(ERRORS_FILE) as f:
            return json.load(f)
    return []


def save_errors(errors):
    """Save errors."""
    with open(ERRORS_FILE, "w") as f:
        json.dump(errors, f, indent=2)


def main():
    print("=" * 60)
    print("Phase 1: OCC 1002A Search")
    print("=" * 60)

    progress = load_progress()
    results = load_results()
    errors = load_errors()
    start_offset = progress["checked"]

    if start_offset > 0:
        print(f"Resuming from well #{start_offset} (found: {progress['found']}, errors: {progress['errors']})")

    # Fetch all wells, paginated
    all_wells = []
    offset = 0
    print("Fetching wells missing formation...")
    while True:
        wells, count = fetch_wells_missing_formation(offset)
        all_wells.extend(wells)
        print(f"  Fetched {len(all_wells)} wells (page offset {offset}, got {count})")
        if count < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    total = len(all_wells)
    print(f"Total wells to check: {total}")

    if start_offset >= total:
        print("All wells already checked!")
        return

    # Skip already-checked wells
    wells_to_check = all_wells[start_offset:]
    print(f"Starting from well #{start_offset + 1}")
    print()

    # Get initial session cookies
    print("Acquiring OCC session cookies...")
    cookies = get_session_cookies()
    print("Session established.")
    print()

    checked = progress["checked"]
    found = progress["found"]
    not_found = progress["not_found"]
    error_count = progress["errors"]
    start_time = time.time()

    for i, well in enumerate(wells_to_check):
        api_number = well["api_number"]

        try:
            forms = search_well_records(api_number, form_filter="1002A", cookies=cookies)

            if forms:
                # Take the most recent 1002A (by effective date)
                best = max(forms, key=lambda f: f.get("effectiveDate", ""))
                results.append({
                    "api_number": api_number,
                    "entry_id": best["entryId"],
                    "effective_date": best.get("effectiveDate", ""),
                    "well_name": best.get("wellName", ""),
                    "county": best.get("county", ""),
                })
                found += 1
            else:
                not_found += 1

        except Exception as e:
            error_count += 1
            errors.append({
                "api_number": api_number,
                "error": str(e),
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            })
            # Refresh session on errors (might be session expiry)
            try:
                cookies = get_session_cookies(force_refresh=True)
            except Exception:
                pass

        checked += 1

        # Progress logging every 100 wells
        if checked % 100 == 0:
            elapsed = time.time() - start_time
            rate = (checked - start_offset) / elapsed if elapsed > 0 else 0
            remaining = (total - checked) / rate if rate > 0 else 0
            print(
                f"  [{checked}/{total}] found={found} not_found={not_found} errors={error_count} "
                f"({rate:.1f}/s, ~{remaining/60:.0f}min remaining)"
            )
            # Save progress
            progress = {"checked": checked, "found": found, "not_found": not_found, "errors": error_count}
            save_progress(progress)
            save_results(results)
            if errors:
                save_errors(errors)

        # Throttle
        time.sleep(THROTTLE_MS / 1000)

    # Final save
    progress = {"checked": checked, "found": found, "not_found": not_found, "errors": error_count}
    save_progress(progress)
    save_results(results)
    if errors:
        save_errors(errors)

    elapsed = time.time() - start_time
    print()
    print("=" * 60)
    print(f"Phase 1 Complete!")
    print(f"  Total checked: {checked}")
    print(f"  1002A found:   {found} ({100*found/checked:.1f}%)")
    print(f"  Not found:     {not_found}")
    print(f"  Errors:        {error_count}")
    print(f"  Time:          {elapsed/3600:.1f} hours")
    print(f"  Results saved: {RESULTS_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    main()
