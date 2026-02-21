#!/usr/bin/env python3
"""
Phase 0: Calibration — Test extraction on sample 1002A PDFs

Downloads a few sample 1002A PDFs from OCC and tests the pdfplumber extraction
to validate patterns before committing to the full 66K-well run.
"""

import io
import json
import os
import sys
import time

# Add parent dir for imports when running from formation-harvester/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pdfplumber
from occ_session import search_well_records, download_document, get_session_cookies
from phase2_extract import extract_all

# Sample API numbers to test — mix of different formations and eras
# These are from the first page of wells-missing-formation
SAMPLE_APIS = [
    "3500300025",  # ALFALFA - HAGUE
    "3500300060",  # ALFALFA - N E CHEROKEE (GINDER 1)
    "3500300068",  # ALFALFA - ADAMS A
    "3500300071",  # ALFALFA - NEWLIN
    "3500300073",  # ALFALFA - WOODWARD (VOSS)
    "3501500133",  # CADDO county area
    "3501700002",  # CANADIAN county area
    "3501700010",  # CANADIAN county area
    "3502300001",  # CHOCTAW/COAL area
    "3502700001",  # CLEVELAND county area
    "3504900001",  # GARVIN county area
    "3506100001",  # HASKELL county area
    "3507300001",  # KINGFISHER county area
    "3508300001",  # LOGAN county area
    "3509300001",  # MAJOR county area
    "3510100001",  # MUSKOGEE county area
    "3511500001",  # OTTAWA county area
    "3512300001",  # PONTOTOC county area
    "3513700001",  # STEPHENS county area
    "3514900001",  # WASHITA county area
]


def main():
    print("=" * 60)
    print("Phase 0: Calibration")
    print("=" * 60)

    print(f"\nTesting {len(SAMPLE_APIS)} API numbers")
    print("Acquiring OCC session...")
    cookies = get_session_cookies()
    print("Session established.\n")

    results = []
    searched = 0
    found_1002a = 0
    downloaded = 0
    extracted_ok = 0

    for api in SAMPLE_APIS:
        print(f"--- {api} ---")
        searched += 1

        # Search for 1002A
        try:
            forms = search_well_records(api, form_filter="1002A", cookies=cookies)
        except Exception as e:
            print(f"  Search error: {e}")
            time.sleep(0.5)
            continue

        if not forms:
            print(f"  No 1002A found")
            time.sleep(0.2)
            continue

        found_1002a += 1
        best = max(forms, key=lambda f: f.get("effectiveDate", ""))
        print(f"  Found 1002A: entryId={best['entryId']}, date={best.get('effectiveDate','?')}")

        # Download PDF
        try:
            pdf_bytes = download_document(best["entryId"], cookies=cookies)
        except Exception as e:
            print(f"  Download error: {e}")
            time.sleep(0.5)
            continue

        if pdf_bytes is None:
            print(f"  Download failed (no PDF)")
            time.sleep(0.2)
            continue

        downloaded += 1
        print(f"  Downloaded: {len(pdf_bytes)} bytes")

        # Save PDF for manual inspection
        os.makedirs("samples", exist_ok=True)
        pdf_path = f"samples/{api}.pdf"
        with open(pdf_path, "wb") as f:
            f.write(pdf_bytes)

        # Extract text for debugging
        try:
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                for pi, page in enumerate(pdf.pages[:3]):
                    text = page.extract_text() or ""
                    txt_path = f"samples/{api}_page{pi+1}.txt"
                    with open(txt_path, "w") as f:
                        f.write(text)
                    if pi == 1:  # Page 2 - the key page
                        print(f"  Page 2 text length: {len(text)} chars")
                        # Show first 300 chars of page 2
                        preview = text[:300].replace('\n', ' | ')
                        print(f"  Preview: {preview[:200]}")
        except Exception as e:
            print(f"  PDF read error: {e}")

        # Run extraction
        data = extract_all(pdf_bytes)
        print(f"  Extraction: {json.dumps(data)}")

        has_data = data.get("formation_name") or any(
            data.get(k) is not None for k in ("ip_oil_bbl", "ip_gas_mcf", "ip_water_bbl")
        )
        if has_data:
            extracted_ok += 1

        results.append({
            "api_number": api,
            "entry_id": best["entryId"],
            "effective_date": best.get("effectiveDate", ""),
            **data,
        })

        time.sleep(0.3)
        print()

    # Summary
    print("=" * 60)
    print("Calibration Summary")
    print("=" * 60)
    print(f"  Searched:       {searched}")
    print(f"  1002A found:    {found_1002a} ({100*found_1002a/searched:.0f}%)")
    print(f"  Downloaded:     {downloaded}")
    print(f"  Data extracted: {extracted_ok} ({100*extracted_ok/max(downloaded,1):.0f}% of downloads)")
    print()
    print("Results:")
    for r in results:
        fm = r.get("formation_name", "-")
        oil = r.get("ip_oil_bbl", "-")
        gas = r.get("ip_gas_mcf", "-")
        water = r.get("ip_water_bbl", "-")
        print(f"  {r['api_number']}: formation={fm}, oil={oil}, gas={gas}, water={water}")

    print()
    print(f"Sample PDFs saved to: samples/")
    print(f"Page text saved to: samples/*_page*.txt")
    print("Review page text files to tune extraction patterns if needed.")

    # Save results
    with open("calibration_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print(f"Results saved to: calibration_results.json")


if __name__ == "__main__":
    main()
