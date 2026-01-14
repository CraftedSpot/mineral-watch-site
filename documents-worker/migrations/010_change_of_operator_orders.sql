-- Migration: 010_change_of_operator_orders
-- Creates tables for change of operator orders extracted from documents
-- These orders transfer operational responsibility from one company to another

-- Main change of operator orders table
CREATE TABLE IF NOT EXISTS change_of_operator_orders (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,

    -- Case identification
    case_number TEXT,
    order_number TEXT,
    order_date TEXT,
    effective_date TEXT,
    hearing_date TEXT,

    -- Operator transfer
    current_operator TEXT,
    new_operator TEXT,
    transfer_type TEXT,  -- 'Full Transfer', 'Partial Transfer', etc.

    -- Location (TRSM) - may cover multiple sections
    sections TEXT,  -- JSON array of section numbers
    township TEXT,
    range TEXT,
    county TEXT,
    meridian TEXT DEFAULT 'IM',

    -- Transfer summary
    total_wells_transferred INTEGER,
    bonding_requirements TEXT,

    -- Extraction confidence
    confidence TEXT,
    field_scores TEXT,  -- JSON

    -- Metadata
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (document_id) REFERENCES documents(id)
);

-- Affected wells table - each operator change can involve multiple wells
CREATE TABLE IF NOT EXISTS change_of_operator_wells (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operator_change_id TEXT NOT NULL,

    -- Well identification
    well_name TEXT,
    api_number TEXT,
    otc_lease_number TEXT,
    well_type TEXT,  -- 'Oil', 'Gas', 'Injection', etc.

    -- Additional well info if available
    section TEXT,
    township TEXT,
    range TEXT,

    -- Metadata
    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (operator_change_id) REFERENCES change_of_operator_orders(id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_operator_change_document ON change_of_operator_orders(document_id);
CREATE INDEX IF NOT EXISTS idx_operator_change_case ON change_of_operator_orders(case_number);
CREATE INDEX IF NOT EXISTS idx_operator_change_order ON change_of_operator_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_operator_change_current_op ON change_of_operator_orders(current_operator);
CREATE INDEX IF NOT EXISTS idx_operator_change_new_op ON change_of_operator_orders(new_operator);
CREATE INDEX IF NOT EXISTS idx_operator_change_county ON change_of_operator_orders(county);
CREATE INDEX IF NOT EXISTS idx_operator_change_location ON change_of_operator_orders(township, range);

CREATE INDEX IF NOT EXISTS idx_operator_wells_change ON change_of_operator_wells(operator_change_id);
CREATE INDEX IF NOT EXISTS idx_operator_wells_api ON change_of_operator_wells(api_number);
CREATE INDEX IF NOT EXISTS idx_operator_wells_name ON change_of_operator_wells(well_name);
CREATE INDEX IF NOT EXISTS idx_operator_wells_otc ON change_of_operator_wells(otc_lease_number);
