-- Oklahoma Wells Database Schema
-- This table stores well information with optimized indexing for TRS (Township-Range-Section) queries

CREATE TABLE IF NOT EXISTS wells (
    -- Primary key
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Well identification
    api_number TEXT NOT NULL UNIQUE,
    well_name TEXT,
    well_number TEXT,
    
    -- Location data (TRS)
    township TEXT NOT NULL,
    range TEXT NOT NULL,
    section TEXT NOT NULL,
    
    -- Additional location info
    county TEXT,
    latitude REAL,
    longitude REAL,
    
    -- Well details
    operator TEXT,
    well_type TEXT,
    well_status TEXT,
    spud_date TEXT,
    completion_date TEXT,
    
    -- Metadata
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    
    -- Data source tracking
    source TEXT DEFAULT 'OCC',
    last_sync TEXT
);

-- Create composite index for TRS queries
-- This will significantly speed up queries filtering by Township, Range, and Section
CREATE INDEX IF NOT EXISTS idx_wells_trs ON wells(township, range, section);

-- Create index for API number lookups
CREATE INDEX IF NOT EXISTS idx_wells_api ON wells(api_number);

-- Create index for county queries
CREATE INDEX IF NOT EXISTS idx_wells_county ON wells(county);

-- Create index for operator queries
CREATE INDEX IF NOT EXISTS idx_wells_operator ON wells(operator);

-- Create index for well status queries
CREATE INDEX IF NOT EXISTS idx_wells_status ON wells(well_status);