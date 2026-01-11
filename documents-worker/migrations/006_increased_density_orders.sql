-- Migration: 006_increased_density_orders
-- Creates table for structured increased density order data extracted from documents
-- These orders authorize additional wells in existing units - informational only, no owner action required

CREATE TABLE IF NOT EXISTS increased_density_orders (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,

    -- Case identification
    case_number TEXT,
    order_number TEXT,
    order_date TEXT,
    effective_date TEXT,
    hearing_date TEXT,

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

    -- Formation & Authorization
    formations TEXT,  -- JSON array [{name, depth_from, depth_to}]
    well_type TEXT,   -- 'oil' or 'gas'
    additional_wells_authorized INTEGER,
    amends_order TEXT,

    -- Existing wells in unit (JSON array)
    existing_wells TEXT,  -- [{well_name, api_number, classification}]

    -- Engineering data (JSON object)
    engineering_data TEXT,  -- {recoverable_oil_stb, recoverable_gas_mmcf, remaining_oil_stb, remaining_gas_mmcf}

    -- Allowable information
    allowable_type TEXT,
    allowable_notes TEXT,

    -- Expiration
    expiration_period TEXT,
    expiration_date TEXT,

    -- Related cases (JSON arrays)
    companion_cases TEXT,
    previous_orders TEXT,

    -- Extraction confidence
    confidence TEXT,
    field_scores TEXT,  -- JSON

    -- Metadata
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (document_id) REFERENCES documents(id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_density_orders_document ON increased_density_orders(document_id);
CREATE INDEX IF NOT EXISTS idx_density_orders_case ON increased_density_orders(case_number);
CREATE INDEX IF NOT EXISTS idx_density_orders_location ON increased_density_orders(section, township, range, county);
CREATE INDEX IF NOT EXISTS idx_density_orders_operator ON increased_density_orders(operator);
CREATE INDEX IF NOT EXISTS idx_density_orders_expiration ON increased_density_orders(expiration_date);
CREATE INDEX IF NOT EXISTS idx_density_orders_formation ON increased_density_orders(formations);
