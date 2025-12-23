-- Migration to add meridian field and update indexes
-- This drops and recreates the wells table with the proper TRSM structure

-- Drop the existing table and indexes
DROP TABLE IF EXISTS wells;

-- Recreate with meridian field
CREATE TABLE IF NOT EXISTS wells (
    -- Primary key
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Well identification
    api_number TEXT NOT NULL UNIQUE,
    well_name TEXT,
    well_number TEXT,
    
    -- Location data (TRSM)
    section INTEGER NOT NULL,
    township TEXT NOT NULL,      -- e.g. "09N"
    range TEXT NOT NULL,         -- e.g. "05W"
    meridian TEXT NOT NULL,      -- "IM" (Indian Meridian) or "CM" (Cimarron Meridian)
    
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

-- Create composite index for TRSM queries
-- This will significantly speed up queries filtering by Section, Township, Range, and Meridian
CREATE INDEX IF NOT EXISTS idx_wells_trsm ON wells(section, township, range, meridian);

-- Create index for API number lookups
CREATE INDEX IF NOT EXISTS idx_wells_api ON wells(api_number);

-- Create index for county queries
CREATE INDEX IF NOT EXISTS idx_wells_county ON wells(county);

-- Create index for operator queries
CREATE INDEX IF NOT EXISTS idx_wells_operator ON wells(operator);

-- Create index for well status queries
CREATE INDEX IF NOT EXISTS idx_wells_status ON wells(well_status);