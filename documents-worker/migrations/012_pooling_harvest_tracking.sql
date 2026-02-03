-- Migration: 012_pooling_harvest_tracking
-- Tracks automated harvesting of OCC pooling orders for lease_comps database.
-- The pooling-harvester worker discovers HEARD/RECOMMENDED pooling cases from
-- occ_docket_entries and fetches orders via occ-fetcher for Claude extraction.

CREATE TABLE IF NOT EXISTS pooling_harvest_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_number TEXT NOT NULL UNIQUE,

    -- Snapshot from docket entry
    docket_status TEXT,
    applicant TEXT,
    county TEXT,
    section TEXT,
    township TEXT,
    range TEXT,
    hearing_date TEXT,

    -- Harvest lifecycle
    -- pending    : discovered, not yet attempted
    -- fetching   : /fetch-order call in progress
    -- fetched    : PDF downloaded, doc registered, awaiting extraction
    -- processed  : extraction complete, lease_comps populated
    -- no_order   : Laserfiche returned 0 results (order not filed yet)
    -- skipped    : permanently skipped (duplicate, dismissed)
    -- error      : non-retryable error
    harvest_status TEXT NOT NULL DEFAULT 'pending',

    -- Document tracking
    document_id TEXT,
    order_number TEXT,

    -- Retry tracking
    attempt_count INTEGER DEFAULT 0,
    last_attempt_at TEXT,
    next_retry_at TEXT,
    error_message TEXT,

    -- Timestamps
    fetched_at TEXT,
    processed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pht_status ON pooling_harvest_tracking(harvest_status);
CREATE INDEX IF NOT EXISTS idx_pht_next_retry ON pooling_harvest_tracking(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_pht_county ON pooling_harvest_tracking(county);
CREATE INDEX IF NOT EXISTS idx_pht_document ON pooling_harvest_tracking(document_id);

-- Daily statistics for monitoring harvest progress
CREATE TABLE IF NOT EXISTS pooling_harvest_daily_stats (
    date TEXT PRIMARY KEY,
    cases_checked INTEGER DEFAULT 0,
    orders_found INTEGER DEFAULT 0,
    no_order_count INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    retries_attempted INTEGER DEFAULT 0,
    run_count INTEGER DEFAULT 0
);
