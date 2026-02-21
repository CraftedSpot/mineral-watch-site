#!/usr/bin/env python3
"""
Phase 2: Download 1002A PDFs + Extract Formation & IP Rates

Downloads 1002A PDFs from OCC and extracts formation name + initial production
rates using Tesseract OCR on Page 1 images (not embedded PDF text).

Page 1 layout (1002A completion report):
  - Upper-right: "COMPLETION & TEST DATA BY PRODUCING FORMATION" section
    with FORMATION field, CLASSIFICATION, PERFORATED INTERVALS
  - Left side: "OIL OR GAS ZONES" / "OIL OR GAS SANDS" table with
    formation name(s) + depth intervals (From/To)
  - Right side: "INITIAL TEST DATA" section with Oil-bbl/day, Gas-Cu Ft/day,
    Water-bbl/day

Page 2 is ignored — it's the "FORMATION RECORD" stratigraphic log (every
formation drilled through), which is NOT the producing formation.

Usage:
    python phase2_extract.py

Requires: phase1_results.json from Phase 1
Resumable: saves progress to phase2_progress.json every 50 wells.
"""

import io
import json
import os
import re
import sys
import time

import pdfplumber
import pytesseract
import requests
from pdf2image import convert_from_path

from occ_session import download_document, get_session_cookies

# Configuration
API_BASE = os.environ.get("API_BASE", "https://portal.mymineralwatch.com")
API_KEY = os.environ.get("PROCESSING_API_KEY", "mmw-proc-2024-secure-key")
THROTTLE_MS = 200  # ms between OCC downloads
BATCH_SIZE = 200  # results per POST to portal-worker (max 250)
PHASE1_FILE = "phase1_results.json"
PROGRESS_FILE = "phase2_progress.json"
EXTRACTED_FILE = "phase2_extracted.json"
ERRORS_FILE = "phase2_errors.json"
OCR_DPI = 300  # DPI for PDF-to-image conversion

# Common Oklahoma formation names for fuzzy matching.
# These are the canonical names from formation_normalization table.
KNOWN_FORMATIONS = [
    "ARBUCKLE", "ATOKA", "BARTLESVILLE", "BOOCH", "BROMIDE", "BROWN DOLOMITE",
    "BURGESS", "CANEY", "CHESTER", "CHEROKEE", "CLEVELAND", "COTTAGE GROVE",
    "CROMWELL", "DANIEL", "DEESE", "DESMOINESIAN", "DEVON", "DUTCHER",
    "GILCREASE", "GODDARD", "GRANITE WASH", "HART", "HASKELL", "HENNESSEY",
    "HEALDTON", "HOXBAR", "HUNTON", "JONES", "LAYTON", "MANNING", "MARCHAND",
    "MERAMEC", "MINGO", "MISSISSIPPIAN", "MORROW", "MUSSELLEM", "NOVI",
    "ORDOVICIAN", "OSAGE", "OSWEGO", "PAWNEE",
    "PENNSYLVANIAN", "PERMIAN", "PRUE", "RED FORK", "REDFORK",
    "SECOND WILCOX", "SEMINOLE", "SENORA", "SIMPSON", "SKINNER",
    "SPAVINAW", "SPIRO", "SPRINGER", "SYCAMORE", "TONKAWA",
    "TUCKER", "VIOLA", "VIRGILIAN", "WAPANUCKA", "WILCOX", "WOODFORD",
    "BASAL PENN", "BIG LIME", "CLEVELAND SAND", "FIRST WILCOX",
    "HUNTON LIME", "MISSISSIPPI LIME", "MISSISSIPPI CHAT", "MISENER",
    "MCLISH", "OIL CREEK", "PONTOTOC", "PURDY", "PICHER",
    "TULIP CREEK", "TYNER", "ARBUCKLE LIME", "ARBUCKLE GROUP",
    "SYLVAN", "FERNVALE", "KINDERHOOK", "MAYES", "REEDS SPRING",
    "PINK LIME", "SPAVINAW DOLOMITE",
    # Note: "OKLAHOMA CITY" excluded — appears in OCC address on every form
]

# Build a set of normalized known formations for matching
_KNOWN_SET = {f.upper() for f in KNOWN_FORMATIONS}
# Also match partial/prefix (e.g., "MISSISSI" → "MISSISSIPPIAN")
_KNOWN_PREFIXES = [(f.upper()[:6], f.upper()) for f in KNOWN_FORMATIONS if len(f) >= 6]


def clean_formation(raw):
    """Clean extracted formation name: trim, uppercase, remove trailing junk."""
    if not raw:
        return None
    s = raw.strip().upper()
    # Remove leading/trailing punctuation and numbers
    s = re.sub(r'^[\d.,;:*|\-\s]+', '', s)
    s = re.sub(r'[\d.,;:*|\-\s]+$', '', s)
    # Remove common non-formation words
    s = re.sub(r'\b(SAND|SD|SS|FM|FORM|FORMATION|LSE?|LS|RECORD|REPORT|WELL|PAGE)\b', '', s, flags=re.IGNORECASE)
    # Collapse whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    if len(s) < 3 or len(s) > 60:
        return None
    # Reject common header/label words that aren't formation names
    reject = {"RECORD", "RECOAD", "RECCAD", "REPORT", "WELL", "THE", "AND", "FOR",
              "FROM", "FROM TO", "COMPLETION", "TEST", "DATA", "PRODUCING",
              "CONSERVATION", "COMMISSION", "OKLAHOMA", "CORPORATION", "OIL", "GAS",
              "DIVISION", "DEPARTMENT", "COUNTY", "SPACING", "ORDER", "NUMBER",
              "CLASSIFICATION", "TYPE", "INITIAL", "PERFORATED", "INTERVALS",
              "CASING", "CEMENT", "TOTAL", "DEPTH", "PLEASE", "BLACK", "INK", "ONLY",
              "RULE", "AMENDED", "ORIGINAL", "BOTTOM", "TOP", "TOP BOTTOM",
              "NO OF SHOTS", "SIZE OF SHOT", "SIZE OF SHOT SHALE", "SHALE",
              "LIME", "RED BED", "EARTH", "SALT", "ANHY", "SALT ANHY",
              "BOTTOM BOTTOM", "TOP J BOTTOM", "AECORD"}
    if s in reject:
        return None
    return s


def match_known_formation(text):
    """Try to find a known Oklahoma formation name in the text."""
    upper = text.upper()
    # Exact match first
    for name in sorted(_KNOWN_SET, key=len, reverse=True):
        if name in upper:
            return name
    # Fuzzy prefix match (for OCR garbling like "MISSISSI" → "MISSISSIPPIAN")
    for prefix, full in _KNOWN_PREFIXES:
        if prefix in upper:
            return full
    return None


def ocr_page1(pdf_bytes):
    """Convert PDF page 1 to image and run Tesseract OCR. Returns text string."""
    # Write to temp file (pdf2image needs a file path)
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = tmp.name
    try:
        pages = convert_from_path(tmp_path, first_page=1, last_page=1, dpi=OCR_DPI)
        if not pages:
            return ""
        text = pytesseract.image_to_string(pages[0])
        return text
    finally:
        os.unlink(tmp_path)


def pdfplumber_page1(pdf_bytes):
    """Fallback: extract embedded text from page 1 via pdfplumber."""
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            if pdf.pages:
                return pdf.pages[0].extract_text() or ""
    except Exception:
        pass
    return ""


def parse_number(s):
    """Parse number string, handling commas, spaces, and OCR artifacts."""
    if not s:
        return None
    # Remove common OCR artifacts
    s = s.strip().replace(',', '').replace(' ', '').replace('O', '0').replace('o', '0')
    s = re.sub(r'[^0-9.]', '', s)
    try:
        val = float(s)
        if val < 0 or val > 999999:
            return None
        return val
    except ValueError:
        return None


def extract_formation_from_text(text):
    """
    Extract producing formation name from OCR'd Page 1 text.

    Only returns known Oklahoma formation names to avoid OCR artifacts.
    Strategy (in priority order):
    1. Known formation near "FORMATION" label (the form field)
    2. Known formation near "ZONES" or "SANDS" section
    3. Known formation in the upper form section (first 60 lines — above
       the signatures/address block where "Oklahoma City" lives)
    """
    if not text:
        return None

    lines = text.split('\n')

    # Strategy 1: Find "FORMATION" label and check nearby lines for known formations
    for i, line in enumerate(lines):
        if re.search(r'\bFORMATION\b', line, re.IGNORECASE) and \
           not re.search(r'FORMATION\s*(RECORD|LOG)', line, re.IGNORECASE) and \
           not re.search(r'PRODUCING\s+FORMATION', line, re.IGNORECASE):
            context = ' '.join(lines[max(0, i-2):min(len(lines), i+3)])
            match = match_known_formation(context)
            if match:
                return match

    # Strategy 2: Find "OIL OR GAS ZONES" / "OIL OR GAS SANDS" section
    for i, line in enumerate(lines):
        if re.search(r'(OIL\s+OR\s+GAS\s+(ZONES?|SANDS?))', line, re.IGNORECASE):
            context = ' '.join(lines[i:min(len(lines), i+8)])
            match = match_known_formation(context)
            if match:
                return match

    # Strategy 3: Known formation in upper form section (first 60 lines)
    # This catches formations mentioned in completion type, zone names, etc.
    # Excludes the lower section where OCC address/signatures live.
    upper_text = '\n'.join(lines[:60])
    match = match_known_formation(upper_text)
    if match:
        return match

    return None


def extract_ip_from_text(text):
    """
    Extract initial production rates from OCR'd Page 1 text.
    Looks in the "INITIAL TEST DATA" section for Oil-bbl/day, Gas-Cu Ft/day, Water-bbl/day.
    """
    result = {}
    if not text:
        return result

    # Find the INITIAL TEST DATA section
    test_section = ""
    lines = text.split('\n')
    in_test = False
    for line in lines:
        if re.search(r'INITIAL\s+TEST', line, re.IGNORECASE):
            in_test = True
        if in_test:
            test_section += line + "\n"
            # Stop after ~20 lines or when we hit another section
            if len(test_section.split('\n')) > 25:
                break

    # If no INITIAL TEST section found, search entire page 1
    search_text = test_section if test_section else text

    # Oil: "Oil-bbl/day" or "Oil-BBL/Day" or "Oil bbl day" followed by number
    m = re.search(r'[O0][il1][l1][\s\-]*[Bb][Bb][Ll1][\s/\-]*[Dd]ay\s*[:\s]*(\d[\d,.]*)', search_text, re.IGNORECASE)
    if m:
        val = parse_number(m.group(1))
        if val is not None:
            result["ip_oil_bbl"] = val

    # Gas: "Gas-Cu Ft/day" or "Gas-MCF/day" followed by number
    m = re.search(r'[Gg]as[\s\-]*(?:[Cc]u\.?\s*[Ff]t|MCF)[\s/\-]*[Dd]ay\s*[:\s]*(\d[\d,.]*)', search_text, re.IGNORECASE)
    if m:
        val = parse_number(m.group(1))
        if val is not None:
            result["ip_gas_mcf"] = val

    # Water: "Water-bbl/day" or "Water-BBL/Day" followed by number
    m = re.search(r'[Ww]ater[\s\-]*[Bb][Bb][Ll1][\s/\-]*[Dd]ay\s*[:\s]*(\d[\d,.]*)', search_text, re.IGNORECASE)
    if m:
        val = parse_number(m.group(1))
        if val is not None:
            result["ip_water_bbl"] = val

    return result


def extract_all(pdf_bytes):
    """Combined extraction: Tesseract OCR on Page 1, then extract formation + IP."""
    # Try Tesseract OCR first (much better quality on scanned docs)
    try:
        text = ocr_page1(pdf_bytes)
    except Exception:
        text = ""

    # Fallback to pdfplumber embedded text if OCR fails
    if not text or len(text) < 50:
        text = pdfplumber_page1(pdf_bytes)

    formation = extract_formation_from_text(text)
    ip_rates = extract_ip_from_text(text)

    return {
        "formation_name": formation,
        **ip_rates,
    }


def post_results(batch):
    """POST batch of results to portal-worker write-back endpoint."""
    resp = requests.post(
        f"{API_BASE}/api/admin/formation-harvest-results",
        json={"results": batch},
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
    )
    resp.raise_for_status()
    return resp.json()


def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"extracted": 0, "success": 0, "no_data": 0, "download_fail": 0, "errors": 0}


def save_progress(progress):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f, indent=2)


def load_extracted():
    if os.path.exists(EXTRACTED_FILE):
        with open(EXTRACTED_FILE) as f:
            return json.load(f)
    return []


def save_extracted(extracted):
    with open(EXTRACTED_FILE, "w") as f:
        json.dump(extracted, f, indent=2)


def load_errors():
    if os.path.exists(ERRORS_FILE):
        with open(ERRORS_FILE) as f:
            return json.load(f)
    return []


def save_errors(errors):
    with open(ERRORS_FILE, "w") as f:
        json.dump(errors, f, indent=2)


def main():
    print("=" * 60)
    print("Phase 2: 1002A PDF Download + OCR Extraction")
    print("=" * 60)

    if not os.path.exists(PHASE1_FILE):
        print(f"Error: {PHASE1_FILE} not found. Run phase1_search.py first.")
        sys.exit(1)

    with open(PHASE1_FILE) as f:
        phase1_results = json.load(f)

    total = len(phase1_results)
    print(f"Phase 1 results: {total} wells with 1002A forms")

    progress = load_progress()
    all_extracted = load_extracted()
    errors = load_errors()
    start_idx = progress["extracted"]

    if start_idx > 0:
        print(f"Resuming from entry #{start_idx} (success: {progress['success']}, errors: {progress['errors']})")

    if start_idx >= total:
        print("All entries already processed!")
        return

    entries_to_process = phase1_results[start_idx:]
    print(f"Processing entries {start_idx + 1} to {total}")
    print()

    # Get initial session cookies
    print("Acquiring OCC session cookies...")
    cookies = get_session_cookies()
    print("Session established.")
    print()

    extracted_count = progress["extracted"]
    success_count = progress["success"]
    no_data_count = progress["no_data"]
    download_fail_count = progress["download_fail"]
    error_count = progress["errors"]
    start_time = time.time()

    pending_batch = []  # Results waiting to be POSTed

    for i, entry in enumerate(entries_to_process):
        api_number = entry["api_number"]
        entry_id = entry["entry_id"]

        try:
            # Download PDF
            pdf_bytes = download_document(entry_id, cookies=cookies)

            if pdf_bytes is None:
                download_fail_count += 1
                extracted_count += 1
                time.sleep(THROTTLE_MS / 1000)
                continue

            # Extract formation + IP via OCR
            data = extract_all(pdf_bytes)

            has_data = data.get("formation_name") or any(
                data.get(k) is not None for k in ("ip_oil_bbl", "ip_gas_mcf", "ip_water_bbl")
            )

            if has_data:
                result = {
                    "api_number": api_number,
                    "formation_name": data.get("formation_name"),
                    "ip_oil_bbl": data.get("ip_oil_bbl"),
                    "ip_gas_mcf": data.get("ip_gas_mcf"),
                    "ip_water_bbl": data.get("ip_water_bbl"),
                    "source": "1002A-ocr",
                }
                pending_batch.append(result)
                all_extracted.append(result)
                success_count += 1
            else:
                no_data_count += 1

        except Exception as e:
            error_count += 1
            errors.append({
                "api_number": api_number,
                "entry_id": entry_id,
                "error": str(e),
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            })
            # Refresh session on errors
            try:
                cookies = get_session_cookies(force_refresh=True)
            except Exception:
                pass

        extracted_count += 1

        # POST batch to portal-worker every BATCH_SIZE results
        if len(pending_batch) >= BATCH_SIZE:
            try:
                resp_data = post_results(pending_batch)
                print(f"    -> POSTed {len(pending_batch)} results: {resp_data}")
                pending_batch = []
            except Exception as e:
                print(f"    -> POST failed: {e} (will retry in next batch)")

        # Progress logging every 50 entries
        if extracted_count % 50 == 0:
            elapsed = time.time() - start_time
            rate = (extracted_count - start_idx) / elapsed if elapsed > 0 else 0
            remaining = (total - extracted_count) / rate if rate > 0 else 0
            print(
                f"  [{extracted_count}/{total}] success={success_count} no_data={no_data_count} "
                f"dl_fail={download_fail_count} errors={error_count} "
                f"({rate:.1f}/s, ~{remaining/60:.0f}min remaining)"
            )
            progress = {
                "extracted": extracted_count,
                "success": success_count,
                "no_data": no_data_count,
                "download_fail": download_fail_count,
                "errors": error_count,
            }
            save_progress(progress)
            save_extracted(all_extracted)
            if errors:
                save_errors(errors)

        # Throttle
        time.sleep(THROTTLE_MS / 1000)

    # Flush remaining batch
    if pending_batch:
        try:
            resp_data = post_results(pending_batch)
            print(f"    -> Final POST {len(pending_batch)} results: {resp_data}")
        except Exception as e:
            print(f"    -> Final POST failed: {e}")
            print(f"       {len(pending_batch)} results NOT written back. Check {EXTRACTED_FILE}")

    # Final save
    progress = {
        "extracted": extracted_count,
        "success": success_count,
        "no_data": no_data_count,
        "download_fail": download_fail_count,
        "errors": error_count,
    }
    save_progress(progress)
    save_extracted(all_extracted)
    if errors:
        save_errors(errors)

    elapsed = time.time() - start_time
    print()
    print("=" * 60)
    print("Phase 2 Complete!")
    print(f"  Total processed:  {extracted_count}")
    if extracted_count:
        print(f"  Success:          {success_count} ({100*success_count/extracted_count:.1f}%)")
    print(f"  No data found:    {no_data_count}")
    print(f"  Download failed:  {download_fail_count}")
    print(f"  Errors:           {error_count}")
    print(f"  Time:             {elapsed/3600:.1f} hours")
    print(f"  Extracted saved:  {EXTRACTED_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    main()
