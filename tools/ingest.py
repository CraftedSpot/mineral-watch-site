#!/usr/bin/env python3
"""
Mineral Watch Bulk Document Ingestion CLI

Uploads PDFs from a local folder structure to R2 and registers them with
the documents-worker processing pipeline. The server parses TRS data from
folder/file naming conventions and pre-links documents to properties and wells.

All normalization (county abbreviations, TRS regex, well name extraction)
lives server-side in documents-worker — this CLI is a thin client.

Usage:
    python ingest.py ROOT_PATH --user-id recXXX [--org-id recYYY]           # dry run
    python ingest.py ROOT_PATH --user-id recXXX [--org-id recYYY] --execute # upload
    python ingest.py --resume                                                # resume
    python ingest.py --status                                                # progress
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Optional dependencies (graceful import)
# ---------------------------------------------------------------------------

try:
    import boto3
    from botocore.config import Config as BotoConfig
except ImportError:
    boto3 = None  # checked at upload time

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    PdfReader = PdfWriter = None  # checked at split time

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass  # env vars must be set manually

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DOCUMENTS_WORKER_URL = os.getenv(
    "DOCUMENTS_WORKER_URL",
    "https://documents-worker.mymineralwatch.workers.dev",
)
PROCESSING_API_KEY = os.getenv("PROCESSING_API_KEY", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
R2_BUCKET = "mineral-watch-uploads"
R2_ENDPOINT = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com" if R2_ACCOUNT_ID else ""

STATE_DB_PATH = Path(__file__).parent / ".ingest-state.db"
PARSE_BATCH = 50  # items per /ingest-parse call (lightweight, no DB)
DEDUP_BATCH = 25
MATCH_BATCH = 20  # items per /ingest-match call (each item can generate several bind params)
QUEUE_POLL_INTERVAL = 30  # seconds


# ---------------------------------------------------------------------------
# Folder scanner (thin — just collects paths and folder names)
# ---------------------------------------------------------------------------


def scan_folder(root_path: str, filter_county: str | None = None) -> list[dict]:
    """
    Walk directory tree, find PDFs, collect filenames and ancestor folder names.

    Returns list of dicts: {path, filename, file_size, folders, needs_split}
    Parsing (county, TRS, API, well name) is deferred to the server.
    """
    root = Path(root_path)
    if not root.is_dir():
        print(f"Error: {root_path} is not a directory", file=sys.stderr)
        sys.exit(1)

    files = []

    for pdf_path in sorted(root.rglob("*.pdf")):
        if pdf_path.name.startswith("."):
            continue

        # Collect ancestor folder names (closest first) for server-side county resolution
        rel = pdf_path.relative_to(root)
        folders = [p.name for p in rel.parents if p.name]

        file_size = pdf_path.stat().st_size

        files.append({
            "path": str(pdf_path),
            "filename": pdf_path.name,
            "file_size": file_size,
            "folders": folders,
            "needs_split": file_size > 100 * 1024 * 1024,  # default 100MB
        })

    # If filter_county specified, we need to parse first to filter.
    # Do a quick server parse of all files, then filter by county.
    if filter_county and files:
        print(f"Parsing filenames to filter by county '{filter_county}'...")
        parsed = parse_filenames(files)
        apply_parsed(files, parsed)
        fc_upper = filter_county.upper()
        files = [f for f in files if f.get("county") and f["county"].upper() == fc_upper]

    return files


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib only — no requests dependency)
# ---------------------------------------------------------------------------


def api_post(endpoint: str, body: dict, timeout: int = 30) -> dict:
    """POST JSON to documents-worker with API key auth."""
    url = f"{DOCUMENTS_WORKER_URL}{endpoint}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-API-Key": PROCESSING_API_KEY,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        print(f"  API error {e.code} on {endpoint}: {body_text}", file=sys.stderr)
        raise
    except urllib.error.URLError as e:
        print(f"  Connection error on {endpoint}: {e.reason}", file=sys.stderr)
        raise


def api_get(endpoint: str, timeout: int = 15) -> dict:
    """GET from documents-worker with API key auth."""
    url = f"{DOCUMENTS_WORKER_URL}{endpoint}"
    req = urllib.request.Request(
        url,
        headers={"X-API-Key": PROCESSING_API_KEY},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


# ---------------------------------------------------------------------------
# Server-side parsing, dedup, and matching
# ---------------------------------------------------------------------------


def parse_filenames(files: list[dict]) -> list[dict]:
    """
    POST batches to /ingest-parse. Server parses county, TRS, API, well name
    from filenames and folder names. Returns list of parsed dicts (same order).
    """
    all_parsed = [None] * len(files)
    for i in range(0, len(files), PARSE_BATCH):
        batch = files[i : i + PARSE_BATCH]
        items = [{"filename": f["filename"], "folders": f["folders"]} for f in batch]
        resp = api_post("/api/documents/ingest-parse", {"items": items})
        for j, p in enumerate(resp.get("parsed", [])):
            all_parsed[i + j] = p
    return all_parsed


def apply_parsed(files: list[dict], parsed: list[dict]) -> None:
    """Merge server-parsed data into file dicts."""
    for f, p in zip(files, parsed):
        if not p:
            continue
        f["county"] = p.get("county")
        f["section"] = p.get("section")
        f["township"] = p.get("township")
        f["range"] = p.get("range")
        f["api_number"] = p.get("apiNumber")
        f["well_name"] = p.get("wellName")


def check_duplicates(files: list[dict], user_id: str, org_id: str | None) -> dict:
    """
    POST batches to /ingest-dedup. Returns {filename: existingDocId} for dupes.
    """
    dupes = {}
    for i in range(0, len(files), DEDUP_BATCH):
        batch = files[i : i + DEDUP_BATCH]
        payload = {
            "userId": user_id,
            "organizationId": org_id,
            "files": [{"filename": f["filename"], "fileSize": f["file_size"]} for f in batch],
        }
        resp = api_post("/api/documents/ingest-dedup", payload)
        for d in resp.get("duplicates", []):
            dupes[d["filename"]] = d["existingDocId"]
    return dupes


def match_entities(files: list[dict], user_id: str, org_id: str | None) -> dict:
    """
    POST batches to /ingest-match. Returns {index_in_files: match_result}.
    match_result = {propertyId?, wellId?, wellApiNumber?, matchType}
    """
    results = {}
    for i in range(0, len(files), MATCH_BATCH):
        batch = files[i : i + MATCH_BATCH]
        items = []
        for f in batch:
            item = {}
            if f.get("section"):
                item["section"] = f["section"]
            if f.get("township"):
                item["township"] = f["township"]
            if f.get("range"):
                item["range"] = f["range"]
            if f.get("county"):
                item["county"] = f["county"]
            if f.get("api_number"):
                item["apiNumber"] = f["api_number"]
            if f.get("well_name"):
                item["wellName"] = f["well_name"]
            items.append(item)

        payload = {"userId": user_id, "organizationId": org_id, "items": items}
        resp = api_post("/api/documents/ingest-match", payload, timeout=60)
        for m in resp.get("matches", []):
            global_idx = i + m["index"]
            results[global_idx] = m
    return results


# ---------------------------------------------------------------------------
# R2 upload
# ---------------------------------------------------------------------------


def get_r2_client():
    """Create boto3 S3 client for R2."""
    if boto3 is None:
        print("Error: boto3 is required for uploads. Run: pip install boto3", file=sys.stderr)
        sys.exit(1)
    if not R2_ACCESS_KEY_ID or not R2_SECRET_ACCESS_KEY or not R2_ACCOUNT_ID:
        print("Error: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ACCOUNT_ID required", file=sys.stderr)
        sys.exit(1)
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=BotoConfig(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "adaptive"},
        ),
        region_name="auto",
    )


def generate_r2_key(user_id: str, filename: str) -> str:
    """Generate R2 object key: uploads/{user_id}/{timestamp}-{sanitized_filename}"""
    sanitized = re.sub(r'[^\w.\-]', '_', filename)
    ts = int(time.time() * 1000)
    return f"uploads/{user_id}/{ts}-{sanitized}"


def upload_to_r2(client, local_path: str, r2_key: str) -> None:
    """Upload file to R2 via S3 multipart API."""
    client.upload_file(local_path, R2_BUCKET, r2_key)


# ---------------------------------------------------------------------------
# Document registration
# ---------------------------------------------------------------------------


def register_document(
    r2_key: str,
    user_id: str,
    org_id: str | None,
    filename: str,
    file_size: int,
    match: dict | None,
    source_meta: dict | None = None,
) -> dict:
    """Register document with documents-worker via /register-external."""
    metadata = {
        "sourceType": "bulk_onboarding",
        "uploadedVia": "ingest-cli",
        **(source_meta or {}),
    }
    if match:
        if match.get("propertyId"):
            metadata["property_id"] = match["propertyId"]
        if match.get("wellId"):
            metadata["well_id"] = match["wellId"]
        metadata["matchType"] = match.get("matchType", "none")

    payload = {
        "r2Key": r2_key,
        "userId": user_id,
        "organizationId": org_id,
        "filename": filename,
        "fileSize": file_size,
        "contentType": "application/pdf",
        "sourceType": "bulk_onboarding",
        "metadata": metadata,
    }
    return api_post("/api/documents/register-external", payload, timeout=30)


# ---------------------------------------------------------------------------
# PDF splitting
# ---------------------------------------------------------------------------


def check_and_split_pdf(filepath: str, max_mb: int = 100) -> list[str]:
    """
    If file > threshold, split into chunks. Returns list of file paths
    (original if no split, or temp split files).
    """
    size_mb = os.path.getsize(filepath) / (1024 * 1024)
    if size_mb <= max_mb:
        return [filepath]

    if PdfReader is None or PdfWriter is None:
        print(f"  Warning: pypdf not installed, cannot split {filepath} ({size_mb:.0f}MB). Skipping.", file=sys.stderr)
        return []

    try:
        reader = PdfReader(filepath)
        num_pages = len(reader.pages)
        if num_pages == 0:
            return [filepath]

        avg_page_mb = size_mb / num_pages
        pages_per_chunk = max(1, int(max_mb * 0.8 / avg_page_mb))  # 80% of limit for safety

        parts = []
        stem = Path(filepath).stem
        parent = Path(filepath).parent
        suffix = Path(filepath).suffix

        for chunk_start in range(0, num_pages, pages_per_chunk):
            chunk_end = min(chunk_start + pages_per_chunk, num_pages)
            writer = PdfWriter()
            for p in range(chunk_start, chunk_end):
                writer.add_page(reader.pages[p])

            part_path = str(parent / f"{stem}_part{chunk_start + 1}-{chunk_end}{suffix}")
            with open(part_path, "wb") as f:
                writer.write(f)
            parts.append(part_path)

        print(f"  Split {Path(filepath).name} ({size_mb:.0f}MB) into {len(parts)} parts")
        return parts

    except Exception as e:
        print(f"  Warning: Failed to split {filepath}: {e}", file=sys.stderr)
        return [filepath]


# ---------------------------------------------------------------------------
# Queue monitoring
# ---------------------------------------------------------------------------


def check_queue_depth(user_id: str) -> int:
    """Get count of pending + processing documents for this user."""
    try:
        resp = api_get(f"/api/processing/user/{user_id}/queue-status")
        return (resp.get("queued") or 0) + (resp.get("processing") or 0)
    except Exception:
        return 0  # assume ok if endpoint unreachable


def wait_for_queue_space(user_id: str, max_depth: int, verbose: bool = False) -> None:
    """Block until queue depth drops below max_depth."""
    while True:
        depth = check_queue_depth(user_id)
        if depth < max_depth:
            return
        if verbose:
            print(f"  Queue depth {depth} >= {max_depth}, waiting {QUEUE_POLL_INTERVAL}s...")
        time.sleep(QUEUE_POLL_INTERVAL)


# ---------------------------------------------------------------------------
# State tracking (local SQLite)
# ---------------------------------------------------------------------------


def init_state_db() -> sqlite3.Connection:
    """Initialize or open the local state database."""
    conn = sqlite3.connect(str(STATE_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            root_path TEXT NOT NULL,
            user_id TEXT NOT NULL,
            org_id TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            completed_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            path TEXT NOT NULL,
            filename TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            county TEXT,
            section TEXT,
            township TEXT,
            range_val TEXT,
            api_number TEXT,
            well_name TEXT,
            is_duplicate INTEGER DEFAULT 0,
            match_type TEXT,
            match_property_id TEXT,
            match_well_id TEXT,
            match_well_api TEXT,
            r2_key TEXT,
            doc_id TEXT,
            status TEXT DEFAULT 'pending',
            error TEXT,
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_files_session_status
        ON files (session_id, status)
    """)
    conn.commit()
    return conn


def create_session(conn: sqlite3.Connection, root_path: str, user_id: str, org_id: str | None) -> int:
    """Create a new ingestion session."""
    cur = conn.execute(
        "INSERT INTO sessions (root_path, user_id, org_id) VALUES (?, ?, ?)",
        (root_path, user_id, org_id),
    )
    conn.commit()
    return cur.lastrowid


def save_scan_results(
    conn: sqlite3.Connection, session_id: int, files: list[dict],
    dupes: dict, matches: dict,
) -> None:
    """Save scan + dedup + match results into state DB."""
    for i, f in enumerate(files):
        m = matches.get(i, {})
        conn.execute(
            """INSERT INTO files (
                session_id, path, filename, file_size, county, section, township,
                range_val, api_number, well_name, is_duplicate, match_type,
                match_property_id, match_well_id, match_well_api, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                session_id, f["path"], f["filename"], f["file_size"],
                f.get("county"), f.get("section"), f.get("township"),
                f.get("range"), f.get("api_number"), f.get("well_name"),
                1 if f["filename"] in dupes else 0,
                m.get("matchType", "none"),
                m.get("propertyId"),
                m.get("wellId"),
                m.get("wellApiNumber"),
                "skipped" if f["filename"] in dupes else "pending",
            ),
        )
    conn.commit()


def update_file_status(conn: sqlite3.Connection, file_id: int, status: str, **kwargs) -> None:
    """Update a file's status in the state DB."""
    sets = ["status = ?", "updated_at = datetime('now')"]
    params: list = [status]
    for k, v in kwargs.items():
        sets.append(f"{k} = ?")
        params.append(v)
    params.append(file_id)
    conn.execute(f"UPDATE files SET {', '.join(sets)} WHERE id = ?", params)
    conn.commit()


def get_latest_session(conn: sqlite3.Connection) -> dict | None:
    """Get the most recent incomplete session."""
    row = conn.execute(
        "SELECT * FROM sessions WHERE completed_at IS NULL ORDER BY id DESC LIMIT 1"
    ).fetchone()
    return dict(row) if row else None


def get_pending_files(conn: sqlite3.Connection, session_id: int) -> list[dict]:
    """Get files that still need uploading."""
    rows = conn.execute(
        "SELECT * FROM files WHERE session_id = ? AND status = 'pending' ORDER BY id",
        (session_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_session_stats(conn: sqlite3.Connection, session_id: int) -> dict:
    """Get session progress stats."""
    rows = conn.execute(
        "SELECT status, COUNT(*) as cnt FROM files WHERE session_id = ? GROUP BY status",
        (session_id,),
    ).fetchall()
    stats = {r["status"]: r["cnt"] for r in rows}
    total = sum(stats.values())
    return {"total": total, **stats}


# ---------------------------------------------------------------------------
# Dry-run report
# ---------------------------------------------------------------------------


def print_dry_run(
    root_path: str, user_id: str, org_id: str | None,
    files: list[dict], dupes: dict, matches: dict,
    split_count: int,
) -> None:
    """Print formatted dry-run report."""
    total_size = sum(f["file_size"] for f in files)
    size_gb = total_size / (1024 ** 3)

    parsed_trs = sum(1 for f in files if f.get("section"))
    county_only = sum(1 for f in files if f.get("county") and not f.get("section"))
    no_trs = len(files) - parsed_trs - county_only

    match_counts = {"api_exact": 0, "name_trs": 0, "name_only": 0, "trs": 0, "none": 0}
    name_only_files = []
    for i, f in enumerate(files):
        if f["filename"] in dupes:
            continue
        m = matches.get(i, {})
        mt = m.get("matchType", "none")
        match_counts[mt] = match_counts.get(mt, 0) + 1
        if mt == "name_only":
            name_only_files.append((f["filename"], m.get("wellApiNumber", "?")))

    upload_count = len(files) - len(dupes)

    print()
    print("=" * 55)
    print("  MINERAL WATCH BULK INGESTION — DRY RUN")
    print("=" * 55)
    print()
    print(f"  Root:  {root_path}")
    print(f"  User:  {user_id}", end="")
    if org_id:
        print(f"   Org: {org_id}", end="")
    print()
    print()

    print("  SCAN")
    print(f"    Total PDFs:        {len(files):>6,}     ({size_gb:.1f} GB)")
    if split_count:
        print(f"    Oversized (split): {split_count} files")
    print()

    print("  TRS PARSING")
    if files:
        print(f"    Parsed:            {parsed_trs:>6,}     ({parsed_trs / len(files) * 100:.1f}%)")
    print(f"    County only:       {county_only:>6,}")
    print(f"    No TRS info:       {no_trs:>6,}")
    print()

    print("  DEDUPLICATION")
    print(f"    Already uploaded:  {len(dupes):>6,}     (skipping)")
    print()

    print("  MATCHING")
    print(f"    API number match:  {match_counts['api_exact']:>6,}     (exact well link)")
    print(f"    Well name + TRS:   {match_counts['name_trs']:>6,}     (high confidence well link)")
    if match_counts["name_only"]:
        print(f"    Well name only:    {match_counts['name_only']:>6,}     (review recommended)")
    print(f"    TRS -> property:   {match_counts['trs']:>6,}     (property link)")
    print(f"    No match:          {match_counts['none']:>6,}     (uploaded without pre-linking)")

    if name_only_files:
        print()
        print("    ! WELL NAME-ONLY MATCHES (review these):")
        for fname, api in name_only_files[:10]:
            print(f"      {fname:<40s} (API {api})")
        if len(name_only_files) > 10:
            print(f"      ... and {len(name_only_files) - 10} more")

    print()
    print(f"  READY TO UPLOAD:     {upload_count:,} files")
    print()

    # Build the execute command
    cmd_parts = [f'python ingest.py "{root_path}" --user-id {user_id}']
    if org_id:
        cmd_parts.append(f"--org-id {org_id}")
    cmd_parts.append("--execute")
    print(f"  {' '.join(cmd_parts)}")
    print("=" * 55)
    print()


# ---------------------------------------------------------------------------
# Status report
# ---------------------------------------------------------------------------


def print_status() -> None:
    """Show progress of the most recent session."""
    if not STATE_DB_PATH.exists():
        print("No ingestion sessions found.")
        return

    conn = init_state_db()
    session = get_latest_session(conn)
    if not session:
        # Check completed sessions
        row = conn.execute("SELECT * FROM sessions ORDER BY id DESC LIMIT 1").fetchone()
        if row:
            session = dict(row)
            stats = get_session_stats(conn, session["id"])
            print(f"Last session (completed {session['completed_at']}):")
            print(f"  Root: {session['root_path']}")
            for status, cnt in sorted(stats.items()):
                if status != "total":
                    print(f"  {status}: {cnt}")
            print(f"  Total: {stats['total']}")
        else:
            print("No ingestion sessions found.")
        return

    stats = get_session_stats(conn, session["id"])
    print(f"Active session #{session['id']} (started {session['created_at']}):")
    print(f"  Root: {session['root_path']}")
    print(f"  User: {session['user_id']}")
    for status, cnt in sorted(stats.items()):
        if status != "total":
            print(f"  {status}: {cnt}")
    print(f"  Total: {stats['total']}")

    pending = stats.get("pending", 0)
    registered = stats.get("registered", 0)
    total = stats["total"]
    if total > 0:
        pct = (total - pending) / total * 100
        print(f"  Progress: {pct:.1f}% ({registered} registered, {pending} remaining)")
    conn.close()


# ---------------------------------------------------------------------------
# Execute upload
# ---------------------------------------------------------------------------


def execute_upload(
    conn: sqlite3.Connection,
    session_id: int,
    user_id: str,
    org_id: str | None,
    max_queue: int,
    split_threshold: int,
    verbose: bool,
) -> None:
    """Upload all pending files, register with documents-worker."""
    r2 = get_r2_client()
    pending = get_pending_files(conn, session_id)

    if not pending:
        print("No pending files to upload.")
        return

    total = len(pending)
    print(f"\nUploading {total} files...\n")

    success = 0
    failed = 0

    for i, f in enumerate(pending, 1):
        filepath = f["path"]
        filename = f["filename"]

        # Check file still exists
        if not os.path.exists(filepath):
            update_file_status(conn, f["id"], "failed", error="File not found")
            print(f"  [{i}/{total}] {filename} — FILE NOT FOUND, skipping")
            failed += 1
            continue

        # Queue monitoring
        if max_queue > 0:
            wait_for_queue_space(user_id, max_queue, verbose)

        # Split if needed
        parts = check_and_split_pdf(filepath, split_threshold)
        if not parts:
            update_file_status(conn, f["id"], "failed", error="Split failed")
            failed += 1
            continue

        try:
            for part_idx, part_path in enumerate(parts):
                part_filename = Path(part_path).name
                part_size = os.path.getsize(part_path)

                # Upload to R2
                r2_key = generate_r2_key(user_id, part_filename)
                update_file_status(conn, f["id"], "uploading", r2_key=r2_key)
                upload_to_r2(r2, part_path, r2_key)

                # Build match dict from stored match data
                match = None
                if f.get("match_type") and f["match_type"] != "none":
                    match = {
                        "matchType": f["match_type"],
                        "propertyId": f.get("match_property_id"),
                        "wellId": f.get("match_well_id"),
                        "wellApiNumber": f.get("match_well_api"),
                    }

                # Source metadata
                source_meta = {}
                if f.get("county"):
                    source_meta["county"] = f["county"]
                if f.get("section"):
                    source_meta["section"] = f["section"]
                if f.get("township"):
                    source_meta["township"] = f["township"]
                if f.get("range_val"):
                    source_meta["range"] = f["range_val"]
                if f.get("api_number"):
                    source_meta["apiNumber"] = f["api_number"]
                if f.get("well_name"):
                    source_meta["wellName"] = f["well_name"]
                if len(parts) > 1:
                    source_meta["partIndex"] = part_idx + 1
                    source_meta["totalParts"] = len(parts)
                    source_meta["parentFilename"] = filename

                # Register
                resp = register_document(
                    r2_key, user_id, org_id, part_filename, part_size,
                    match, source_meta,
                )
                doc_id = resp.get("document", {}).get("id", "?")
                update_file_status(conn, f["id"], "registered", doc_id=doc_id)

            # Describe match type for output
            mt = f.get("match_type", "none")
            mt_label = {
                "api_exact": f"well {f.get('match_well_api', '?')} (api_exact)",
                "name_trs": "well (name_trs)",
                "name_only": "well (name_only)",
                "trs": "property (trs)",
                "none": "no pre-link",
            }.get(mt, mt)

            county_trs = ""
            if f.get("county") and f.get("section"):
                county_trs = f"{f['county']} {f['section']}-{f.get('township', '?')}-{f.get('range_val', '?')}"
            elif f.get("county"):
                county_trs = f["county"]

            parts_label = f" ({len(parts)} parts)" if len(parts) > 1 else ""
            print(f"  [{i}/{total}] {filename}{parts_label} -> {county_trs} {mt_label}")

            success += 1

            # Clean up temp split files
            if len(parts) > 1:
                for p in parts:
                    if p != filepath and os.path.exists(p):
                        os.remove(p)

        except Exception as e:
            update_file_status(conn, f["id"], "failed", error=str(e)[:500])
            print(f"  [{i}/{total}] {filename} — FAILED: {e}")
            failed += 1

            # Clean up temp split files on error too
            if len(parts) > 1:
                for p in parts:
                    if p != filepath and os.path.exists(p):
                        try:
                            os.remove(p)
                        except OSError:
                            pass

    print(f"\nDone: {success} uploaded, {failed} failed, {total - success - failed} other")

    # Mark session complete if no pending remain
    remaining = get_pending_files(conn, session_id)
    if not remaining:
        conn.execute(
            "UPDATE sessions SET completed_at = datetime('now') WHERE id = ?",
            (session_id,),
        )
        conn.commit()
        print("Session complete.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Mineral Watch Bulk Document Ingestion",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Dry run (preview only)
  python ingest.py "/Volumes/Docs/ALFALFA-DEWEY_02" --user-id rec2sIzJeeK7E9tuo --org-id rec9fYy8Xwl3jNAbf

  # Execute upload
  python ingest.py "/Volumes/Docs/ALFALFA-DEWEY_02" --user-id rec2sIzJeeK7E9tuo --execute

  # Resume interrupted upload
  python ingest.py --resume

  # Check progress
  python ingest.py --status
        """,
    )
    parser.add_argument("root_path", nargs="?", help="Root folder containing PDFs")
    parser.add_argument("--user-id", help="Airtable user record ID (recXXX)")
    parser.add_argument("--org-id", help="Airtable organization record ID (recXXX)")
    parser.add_argument("--execute", action="store_true", help="Actually upload (default is dry-run)")
    parser.add_argument("--resume", action="store_true", help="Resume interrupted upload")
    parser.add_argument("--status", action="store_true", help="Show session progress")
    parser.add_argument("--filter-county", help="Only process one county folder")
    parser.add_argument("--max-queue", type=int, default=200, help="Pause if queue exceeds this depth")
    parser.add_argument("--split-threshold", type=int, default=100, help="PDF split threshold in MB")
    parser.add_argument("--verbose", action="store_true", help="Per-file detail output")

    args = parser.parse_args()

    # Status mode
    if args.status:
        print_status()
        return

    # Resume mode
    if args.resume:
        conn = init_state_db()
        session = get_latest_session(conn)
        if not session:
            print("No incomplete session to resume.")
            conn.close()
            return
        print(f"Resuming session #{session['id']} ({session['root_path']})")
        execute_upload(
            conn, session["id"], session["user_id"], session.get("org_id"),
            args.max_queue, args.split_threshold, args.verbose,
        )
        conn.close()
        return

    # Normal mode — requires root_path and user-id
    if not args.root_path:
        parser.error("root_path is required (or use --resume / --status)")
    if not args.user_id:
        parser.error("--user-id is required")
    if not PROCESSING_API_KEY:
        print("Error: PROCESSING_API_KEY not set. Create tools/.env or set env var.", file=sys.stderr)
        sys.exit(1)

    # Phase 1: Scan folders (just collects paths + folder names)
    print(f"\nScanning {args.root_path}...")
    files = scan_folder(args.root_path, args.filter_county)

    if not files:
        print("No PDF files found.")
        return

    print(f"Found {len(files)} PDFs")

    # Phase 2: Server-side parsing (county, TRS, API, well name)
    if not any(f.get("county") for f in files):
        # Only parse if not already done (filter_county triggers early parse)
        print("Parsing filenames (server-side)...")
        parsed = parse_filenames(files)
        apply_parsed(files, parsed)

    # Count files needing split
    split_count = sum(1 for f in files if f["needs_split"])

    # Phase 3: Dedup check
    print("Checking for duplicates...")
    dupes = check_duplicates(files, args.user_id, args.org_id)
    if dupes:
        print(f"  {len(dupes)} duplicates found")

    # Phase 4: Match entities
    non_dupe_files = [f for f in files if f["filename"] not in dupes]
    print(f"Matching {len(non_dupe_files)} files to properties and wells...")
    matches = match_entities(files, args.user_id, args.org_id)

    if not args.execute:
        # Dry run — print report
        print_dry_run(
            args.root_path, args.user_id, args.org_id,
            files, dupes, matches, split_count,
        )
        return

    # Phase 5: Execute — save state and upload
    conn = init_state_db()
    session_id = create_session(conn, args.root_path, args.user_id, args.org_id)
    save_scan_results(conn, session_id, files, dupes, matches)

    execute_upload(
        conn, session_id, args.user_id, args.org_id,
        args.max_queue, args.split_threshold, args.verbose,
    )
    conn.close()


if __name__ == "__main__":
    main()
