-- Migration: 005_pooling_orders
-- Creates tables for structured pooling order data extracted from documents
-- Enables efficient querying by deadline, formation, response status, etc.

-- Main pooling orders table - references the source document
CREATE TABLE IF NOT EXISTS pooling_orders (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,

    -- Case identification
    case_number TEXT,
    order_number TEXT,
    order_date TEXT,
    effective_date TEXT,

    -- Parties
    applicant TEXT,
    operator TEXT,
    proposed_well_name TEXT,

    -- Location (TRSM)
    section TEXT,
    township TEXT,
    range TEXT,
    county TEXT,
    meridian TEXT DEFAULT 'IM',
    unit_description TEXT,
    unit_size_acres REAL,

    -- Well details
    well_type TEXT,  -- 'horizontal', 'vertical'
    formations TEXT, -- JSON array of formations [{name, depth_from, depth_to}]

    -- Response tracking
    response_deadline TEXT,
    response_deadline_days INTEGER,
    default_election_option INTEGER,
    default_election_description TEXT,

    -- Extraction confidence
    confidence TEXT,
    field_scores TEXT, -- JSON

    -- Metadata
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (document_id) REFERENCES documents(id)
);

-- Election options table - each pooling order can have multiple options
CREATE TABLE IF NOT EXISTS pooling_election_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pooling_order_id TEXT NOT NULL,

    -- Option details
    option_number INTEGER NOT NULL,
    option_type TEXT,  -- 'participate', 'cash_bonus', 'overburdened', 'royalty_conversion', 'non_consent', or custom
    description TEXT,

    -- Financial terms
    bonus_per_acre REAL,
    royalty_fraction TEXT,  -- e.g., '3/16', '1/8'
    royalty_decimal REAL,   -- e.g., 0.1875 for 3/16
    working_interest_retained INTEGER DEFAULT 0,  -- boolean
    cost_per_nma REAL,      -- estimated cost per net mineral acre for participation
    penalty_percentage REAL, -- for non-consent, e.g., 200 for 200%

    -- Additional notes
    notes TEXT,

    -- Metadata
    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (pooling_order_id) REFERENCES pooling_orders(id)
);

-- Owner responses to pooling orders (for tracking which option was selected)
CREATE TABLE IF NOT EXISTS pooling_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pooling_order_id TEXT NOT NULL,
    property_id TEXT,  -- Links to user's property if applicable
    user_id TEXT,

    -- Response details
    selected_option INTEGER,
    response_date TEXT,
    response_method TEXT,  -- 'mail', 'email', 'online', etc.
    notes TEXT,

    -- Metadata
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (pooling_order_id) REFERENCES pooling_orders(id),
    FOREIGN KEY (property_id) REFERENCES properties(airtable_record_id),
    FOREIGN KEY (user_id) REFERENCES users(airtable_record_id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_pooling_orders_document ON pooling_orders(document_id);
CREATE INDEX IF NOT EXISTS idx_pooling_orders_deadline ON pooling_orders(response_deadline);
CREATE INDEX IF NOT EXISTS idx_pooling_orders_case ON pooling_orders(case_number);
CREATE INDEX IF NOT EXISTS idx_pooling_orders_location ON pooling_orders(section, township, range, county);
CREATE INDEX IF NOT EXISTS idx_pooling_orders_operator ON pooling_orders(operator);

CREATE INDEX IF NOT EXISTS idx_election_options_order ON pooling_election_options(pooling_order_id);
CREATE INDEX IF NOT EXISTS idx_election_options_type ON pooling_election_options(option_type);

CREATE INDEX IF NOT EXISTS idx_pooling_responses_order ON pooling_responses(pooling_order_id);
CREATE INDEX IF NOT EXISTS idx_pooling_responses_user ON pooling_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_pooling_responses_property ON pooling_responses(property_id);
