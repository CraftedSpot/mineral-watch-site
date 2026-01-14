-- Migration: 009_multi_unit_horizontal_orders
-- Creates tables for multi-unit horizontal well orders extracted from documents
-- These orders authorize horizontal wells crossing unit boundaries with allocation percentages

-- Main multi-unit horizontal orders table
CREATE TABLE IF NOT EXISTS multi_unit_horizontal_orders (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,

    -- Case identification
    case_number TEXT,
    order_number TEXT,
    order_sub_type TEXT,  -- 'location_exception', 'horizontal_well', etc.
    order_date TEXT,
    effective_date TEXT,
    hearing_date TEXT,
    reopen_date TEXT,
    reopen_purpose TEXT,

    -- Parties
    applicant TEXT,
    operator TEXT,
    proposed_well_name TEXT,

    -- Location (primary - for quick queries)
    county TEXT,
    meridian TEXT DEFAULT 'IM',
    unit_description TEXT,
    unit_size_acres REAL,
    total_unit_acres REAL,

    -- Well details
    well_type TEXT DEFAULT 'horizontal',
    relief_granted TEXT,
    target_reservoir TEXT,
    adjacent_common_source TEXT,
    allocation_method TEXT,  -- 'Surface Acres', 'Tract Participation', etc.

    -- Formations (JSON array)
    formations TEXT,  -- [{name, common_source_of_supply, depth_from, depth_to}]

    -- Completion interval
    completion_interval_top_depth INTEGER,
    completion_interval_bottom_depth INTEGER,
    completion_interval_length INTEGER,
    total_completion_interval_feet INTEGER,

    -- References to other orders (JSON arrays)
    referenced_spacing_orders TEXT,
    referenced_pooling_orders TEXT,
    companion_cases TEXT,

    -- Protest information
    protestant TEXT,
    protest_status TEXT,  -- 'resolved', 'pending', 'withdrawn', etc.
    special_provisions TEXT,
    cost_savings TEXT,

    -- Hearing details
    administrative_law_judge TEXT,
    applicant_attorney TEXT,
    protestant_attorney TEXT,
    hearing_location TEXT,

    -- Expiration
    expiration_period TEXT,
    expiration_date TEXT,

    -- Extraction confidence
    confidence TEXT,
    field_scores TEXT,  -- JSON

    -- Metadata
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (document_id) REFERENCES documents(id)
);

-- Unit sections table - each horizontal order can span multiple sections
CREATE TABLE IF NOT EXISTS multi_unit_horizontal_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    horizontal_order_id TEXT NOT NULL,

    -- Section location
    section TEXT NOT NULL,
    township TEXT,
    range TEXT,

    -- Allocation details
    allocation_percentage REAL,
    acres REAL,
    spacing_order TEXT,

    -- Completion interval for this section
    completion_interval_length_feet INTEGER,

    -- Location within section (distance from lines)
    south_line_feet INTEGER,
    north_line_feet INTEGER,
    east_line_feet INTEGER,
    west_line_feet INTEGER,

    -- Exceptions from standard setbacks (JSON array of strings)
    exceptions TEXT,

    -- Metadata
    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (horizontal_order_id) REFERENCES multi_unit_horizontal_orders(id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_horizontal_orders_document ON multi_unit_horizontal_orders(document_id);
CREATE INDEX IF NOT EXISTS idx_horizontal_orders_case ON multi_unit_horizontal_orders(case_number);
CREATE INDEX IF NOT EXISTS idx_horizontal_orders_order ON multi_unit_horizontal_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_horizontal_orders_county ON multi_unit_horizontal_orders(county);
CREATE INDEX IF NOT EXISTS idx_horizontal_orders_operator ON multi_unit_horizontal_orders(operator);
CREATE INDEX IF NOT EXISTS idx_horizontal_orders_well_name ON multi_unit_horizontal_orders(proposed_well_name);
CREATE INDEX IF NOT EXISTS idx_horizontal_orders_expiration ON multi_unit_horizontal_orders(expiration_date);

CREATE INDEX IF NOT EXISTS idx_horizontal_sections_order ON multi_unit_horizontal_sections(horizontal_order_id);
CREATE INDEX IF NOT EXISTS idx_horizontal_sections_location ON multi_unit_horizontal_sections(section, township, range);
