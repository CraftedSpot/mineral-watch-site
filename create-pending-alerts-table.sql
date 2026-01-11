-- Pending Alerts Table for Digest Email System
-- Queues alerts for users who prefer daily/weekly digest instead of instant notifications
-- Created: 2026-01-10

CREATE TABLE IF NOT EXISTS pending_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- User identification
    user_id TEXT NOT NULL,                    -- Airtable user record ID
    user_email TEXT NOT NULL,                 -- Cached for quick lookup
    organization_id TEXT,                     -- Airtable org record ID (if part of org)

    -- Activity reference
    activity_log_id TEXT NOT NULL,            -- Airtable Activity Log record ID

    -- Core alert data (cached for digest email generation)
    activity_type TEXT NOT NULL,              -- New Permit, Well Completed, Status Change, etc.
    well_name TEXT,
    api_number TEXT,
    operator TEXT,
    county TEXT,
    section_township_range TEXT,              -- e.g., "S19 T19N R11W"
    alert_level TEXT,                         -- YOUR PROPERTY, ADJACENT SECTION, TRACKED WELL

    -- Expiration-specific fields
    days_until_expiration INTEGER,            -- For Permit Expiring alerts
    expire_date TEXT,                         -- For Permit Expiring alerts

    -- Status change specific fields
    previous_status TEXT,                     -- For Status Change alerts
    new_status TEXT,                          -- For Status Change alerts

    -- Transfer specific fields
    previous_operator TEXT,                   -- For Operator Transfer alerts

    -- Digest scheduling
    digest_frequency TEXT NOT NULL DEFAULT 'weekly',  -- 'daily' or 'weekly'

    -- Tracking
    created_at TEXT DEFAULT (datetime('now')),
    processed_at TEXT,                        -- When included in a digest
    digest_sent_at TEXT                       -- When the digest email was sent
);

-- Index for finding pending alerts by user
CREATE INDEX IF NOT EXISTS idx_pending_alerts_user ON pending_alerts(user_id, processed_at);

-- Index for finding unprocessed alerts for digest generation
CREATE INDEX IF NOT EXISTS idx_pending_alerts_pending ON pending_alerts(processed_at, digest_frequency);

-- Index for organization-level queries
CREATE INDEX IF NOT EXISTS idx_pending_alerts_org ON pending_alerts(organization_id, processed_at);

-- Index for activity type grouping (for digest email sections)
CREATE INDEX IF NOT EXISTS idx_pending_alerts_type ON pending_alerts(activity_type);
