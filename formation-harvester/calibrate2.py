#!/usr/bin/env python3
"""
Calibration Round 2: Test extraction on 1002A PDFs of different eras.
Specifically searches for wells with effective dates across different decades.
"""

import io
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pdfplumber
from occ_session import search_well_records, download_document, get_session_cookies
from phase2_extract import extract_all

import requests

API_BASE = "https://portal.mymineralwatch.com"
API_KEY = "mmw-proc-2024-secure-key"


def get_sample_wells(count=100):
    """Get wells spread across the API number range."""
    resp = requests.get(
        f"{API_BASE}/api/admin/wells-missing-formation",
        params={"limit": count, "offset": 0},
        headers={"Authorization": f"Bearer {API_KEY}"},
    )
    resp.raise_for_status()
    return resp.json()["wells"]


def main():
    print("=" * 60)
    print("Calibration Round 2: Date-stratified sampling")
    print("=" * 60)

    # Get a batch of wells and search OCC, looking for ones with
    # effective dates from different eras
    print("Fetching wells...")
    wells = get_sample_wells(200)  # Get 200 wells
    print(f"Got {len(wells)} wells")

    print("\nAcquiring OCC session...")
    cookies = get_session_cookies()
    print("Session established.\n")

    # Search each well, record effective date, then pick samples from different decades
    search_results = []
    for i, well in enumerate(wells):
        api = well["api_number"]
        try:
            forms = search_well_records(api, form_filter="1002A", cookies=cookies)
            if forms:
                best = max(forms, key=lambda f: f.get("effectiveDate", ""))
                date = best.get("effectiveDate", "")
                search_results.append({
                    "api_number": api,
                    "entry_id": best["entryId"],
                    "effective_date": date,
                    "well_name": well.get("well_name", ""),
                })
        except Exception as e:
            print(f"  Search error for {api}: {e}")
            cookies = get_session_cookies(force_refresh=True)

        if (i + 1) % 20 == 0:
            print(f"  Searched {i+1}/{len(wells)} — found {len(search_results)} 1002A forms")
        time.sleep(0.2)

    print(f"\nFound {len(search_results)} wells with 1002A forms")

    # Group by decade
    by_decade = {}
    for r in search_results:
        date = r["effective_date"]
        # Try to extract year
        year = None
        for part in date.replace("/", "-").split("-"):
            if len(part) == 4 and part.isdigit():
                year = int(part)
                break
            if len(part) == 2 and part.isdigit():
                y = int(part)
                year = 2000 + y if y < 50 else 1900 + y
                break
        if year:
            decade = (year // 10) * 10
            by_decade.setdefault(decade, []).append(r)

    print("\nBy decade:")
    for decade in sorted(by_decade.keys()):
        print(f"  {decade}s: {len(by_decade[decade])} wells")

    # Pick 2-3 from each decade for extraction testing
    test_wells = []
    for decade in sorted(by_decade.keys()):
        wells_in_decade = by_decade[decade]
        test_wells.extend(wells_in_decade[:3])

    print(f"\nTesting extraction on {len(test_wells)} wells across decades")
    print()

    os.makedirs("samples2", exist_ok=True)

    for entry in test_wells:
        api = entry["api_number"]
        eid = entry["entry_id"]
        date = entry["effective_date"]

        print(f"--- {api} (date: {date}) ---")

        pdf_bytes = download_document(eid, cookies=cookies)
        if pdf_bytes is None:
            print(f"  Download failed")
            time.sleep(0.3)
            continue

        # Save PDF + page text
        with open(f"samples2/{api}.pdf", "wb") as f:
            f.write(pdf_bytes)

        try:
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                for pi, page in enumerate(pdf.pages[:3]):
                    text = page.extract_text() or ""
                    with open(f"samples2/{api}_page{pi+1}.txt", "w") as f:
                        f.write(text)
                    if pi <= 1:
                        preview = text[:200].replace('\n', ' | ')
                        print(f"  Page {pi+1} ({len(text)} chars): {preview}")
        except Exception as e:
            print(f"  PDF read error: {e}")

        data = extract_all(pdf_bytes)
        print(f"  Extraction: {json.dumps(data)}")
        print()
        time.sleep(0.3)

    print("\nDone. Check samples2/ for raw PDF text.")


if __name__ == "__main__":
    main()
