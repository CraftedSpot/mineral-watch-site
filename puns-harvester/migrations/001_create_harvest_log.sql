-- PUN Harvester: Tracking table for 1002A form processing
-- Prevents re-checking wells and tracks extraction success rates

CREATE TABLE IF NOT EXISTS puns_harvest_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_number TEXT NOT NULL UNIQUE,
  checked_at TEXT DEFAULT CURRENT_TIMESTAMP,
  has_1002a INTEGER,              -- 0/1: whether 1002A form exists
  entry_id INTEGER,               -- OCC Laserfiche entry ID if found
  extraction_method TEXT,         -- 'ocr_regex', 'claude', 'skipped', 'failed', 'no_form'
  extracted_pun TEXT,             -- The PUN extracted (if successful)
  confidence TEXT,                -- 'high', 'medium', 'low' based on extraction quality
  success INTEGER,                -- 0/1: overall success
  error_message TEXT,             -- Error details if failed
  processing_ms INTEGER,          -- Time taken to process
  retry_count INTEGER DEFAULT 0,  -- Number of retry attempts
  last_retry_at TEXT              -- Timestamp of last retry
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_harvest_checked ON puns_harvest_log(checked_at);
CREATE INDEX IF NOT EXISTS idx_harvest_success ON puns_harvest_log(success);
CREATE INDEX IF NOT EXISTS idx_harvest_method ON puns_harvest_log(extraction_method);
CREATE INDEX IF NOT EXISTS idx_harvest_has_form ON puns_harvest_log(has_1002a);

-- Daily stats table for monitoring
CREATE TABLE IF NOT EXISTS puns_harvest_daily_stats (
  date TEXT PRIMARY KEY,
  wells_checked INTEGER DEFAULT 0,
  forms_found INTEGER DEFAULT 0,
  puns_extracted INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  avg_processing_ms INTEGER,
  run_count INTEGER DEFAULT 0
);
