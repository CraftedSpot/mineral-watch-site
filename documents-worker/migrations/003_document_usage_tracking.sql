-- Document usage tracking table
-- Tracks document processing usage per user per billing period
-- Note: Not enforcing limits yet, just tracking

CREATE TABLE IF NOT EXISTS document_usage (
    user_id TEXT NOT NULL,
    billing_period_start DATE NOT NULL,
    docs_processed INTEGER DEFAULT 0,
    bonus_pool_remaining INTEGER DEFAULT 0,
    topoff_credits INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', '-6 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '-6 hours')),
    PRIMARY KEY (user_id, billing_period_start)
);

-- Index for quick lookups by user
CREATE INDEX IF NOT EXISTS idx_document_usage_user ON document_usage(user_id);

-- Track individual document processing for analytics
CREATE TABLE IF NOT EXISTS document_processing_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    processed_at DATETIME DEFAULT (datetime('now', '-6 hours')),
    doc_type TEXT,
    page_count INTEGER,
    was_multi_doc BOOLEAN DEFAULT 0,
    child_count INTEGER DEFAULT 0,
    skip_extraction BOOLEAN DEFAULT 0,
    billing_period DATE,
    FOREIGN KEY (user_id, billing_period) REFERENCES document_usage(user_id, billing_period_start)
);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_processing_log_user_date ON document_processing_log(user_id, processed_at);
CREATE INDEX IF NOT EXISTS idx_processing_log_type ON document_processing_log(doc_type);