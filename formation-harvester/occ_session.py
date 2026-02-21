"""
OCC Well Records Session Management

Python port of getWellRecordsSessionCookies() from occ-fetcher/src/index.ts.
Handles session cookie acquisition, caching, and automatic refresh on expiry.
"""

import time
import requests

# OCC Well Records endpoints
WELCOME_URL = "https://public.occ.ok.gov/OGCDWellRecords/Welcome.aspx?dbid=0&repo=OCC"
SEARCH_URL = "https://public.occ.ok.gov/OGCDWellRecords/SearchService.aspx/GetSearchListing"
DOWNLOAD_URL = "https://public.occ.ok.gov/OGCDWellRecords/ElectronicFile.aspx"

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# Session cache
_cached_cookies = None
_cookie_timestamp = 0
COOKIE_TTL = 600  # 10 minutes


def get_session_cookies(force_refresh=False):
    """
    Acquire OCC Well Records session cookies.
    Follows the redirect chain from Welcome.aspx, accumulating Set-Cookie headers.
    Caches cookies for 10 minutes.
    """
    global _cached_cookies, _cookie_timestamp

    if not force_refresh and _cached_cookies and (time.time() - _cookie_timestamp) < COOKIE_TTL:
        return _cached_cookies

    session = requests.Session()
    session.headers.update(BROWSER_HEADERS)

    # Step 1: Hit Welcome.aspx without following redirects
    resp = session.get(WELCOME_URL, allow_redirects=False)

    # Step 2: Follow up to 5 redirects, accumulating cookies
    max_redirects = 5
    while resp.is_redirect and max_redirects > 0:
        location = resp.headers.get("Location", "")
        if not location.startswith("http"):
            location = "https://public.occ.ok.gov" + location
        resp = session.get(location, allow_redirects=False)
        max_redirects -= 1

    # Build cookie string from session
    cookies = "; ".join(f"{c.name}={c.value}" for c in session.cookies)

    _cached_cookies = cookies
    _cookie_timestamp = time.time()

    return cookies


def _is_session_expired(response):
    """Check if OCC response indicates an expired session."""
    if response.status_code == 401:
        return True
    if response.status_code == 302:
        location = response.headers.get("Location", "")
        if "Welcome" in location or "Login" in location:
            return True
    # HTML response when expecting JSON
    content_type = response.headers.get("Content-Type", "")
    if "text/html" in content_type and "application/json" not in content_type:
        return True
    return False


def search_well_records(api_number, form_filter=None, cookies=None):
    """
    Search OCC Well Records for documents matching an API number.
    Optionally filter by form number (e.g., '1002A').

    Returns list of dicts: [{entryId, formNumber, apiNumber, wellName, county, effectiveDate, downloadUrl}]
    """
    if cookies is None:
        cookies = get_session_cookies()

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Cookie": cookies,
        "User-Agent": BROWSER_HEADERS["User-Agent"],
        "Origin": "https://public.occ.ok.gov",
        "Referer": "https://public.occ.ok.gov/OGCDWellRecords/Search.aspx",
    }

    payload = {
        "repoName": "OCC",
        "searchSyn": f'{{[OG Well Records]:[API Number]="{api_number}*"}}',
        "searchUuid": "",
        "sortColumn": "",
        "startIdx": 0,
        "endIdx": 100,
        "getNewListing": True,
        "sortOrder": 2,
        "displayInGridView": False,
    }

    resp = requests.post(SEARCH_URL, json=payload, headers=headers, allow_redirects=False)

    # Check for session expiry and retry once
    if _is_session_expired(resp):
        cookies = get_session_cookies(force_refresh=True)
        headers["Cookie"] = cookies
        resp = requests.post(SEARCH_URL, json=payload, headers=headers, allow_redirects=False)

    if resp.status_code != 200:
        raise Exception(f"OCC search failed: {resp.status_code}")

    data = resp.json()
    results = data.get("data", {}).get("results", [])
    forms = []

    for result in results:
        metadata = {}
        for item in result.get("metadata", []):
            if item.get("name") and item.get("values"):
                metadata[item["name"]] = item["values"][0]

        form_number = metadata.get("Form Number", "")

        if form_filter and form_number != form_filter:
            continue

        entry_id = result.get("entryId")
        forms.append({
            "entryId": entry_id,
            "formNumber": form_number,
            "apiNumber": metadata.get("API Number", ""),
            "wellName": metadata.get("Well Name", ""),
            "county": metadata.get("County", ""),
            "effectiveDate": metadata.get("Effective Date", ""),
            "downloadUrl": f"{DOWNLOAD_URL}?docid={entry_id}&dbid=0&repo=OCC",
        })

    return forms


def download_document(entry_id, cookies=None):
    """
    Download a document from OCC by entry ID.
    Returns bytes content of the PDF, or None if download failed.
    Validates PDF magic bytes.
    """
    if cookies is None:
        cookies = get_session_cookies()

    url = f"{DOWNLOAD_URL}?docid={entry_id}&dbid=0&repo=OCC"
    headers = {
        "Cookie": cookies,
        "User-Agent": BROWSER_HEADERS["User-Agent"],
        "Accept": "application/pdf,*/*",
        "Referer": "https://public.occ.ok.gov/OGCDWellRecords/Search.aspx",
    }

    resp = requests.get(url, headers=headers, allow_redirects=False)

    # Check for session expiry and retry once
    if _is_session_expired(resp):
        cookies = get_session_cookies(force_refresh=True)
        headers["Cookie"] = cookies
        resp = requests.get(url, headers=headers, allow_redirects=False)

    if resp.status_code != 200:
        return None

    content = resp.content
    # Validate PDF magic bytes
    if not content[:5] == b"%PDF-":
        return None

    return content
