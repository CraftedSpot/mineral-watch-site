-- Migration: 011_lease_comps
-- Stores comparable lease data extracted from pooling order exhibits.
-- Enables market intelligence queries: "what are leases going for near T3N R4W?"

CREATE TABLE IF NOT EXISTS lease_comps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_document_id TEXT NOT NULL,

    -- Location (TRS)
    section TEXT,
    township TEXT,
    range TEXT,
    county TEXT,
    state TEXT DEFAULT 'Oklahoma',
    quarters TEXT,

    -- Lease terms
    lessor TEXT,
    lessee TEXT,
    bonus_per_nma REAL,
    royalty TEXT,
    royalty_decimal REAL,
    lease_date TEXT,
    term_years INTEGER,
    acres REAL,

    -- Source tracking
    source_case_number TEXT,
    source_order_number TEXT,
    extracted_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (source_document_id) REFERENCES documents(id)
);

-- TRS index for proximity queries (township+range narrows to 36 sections)
CREATE INDEX IF NOT EXISTS idx_lease_comps_trs
    ON lease_comps(township, range, section);

CREATE INDEX IF NOT EXISTS idx_lease_comps_county
    ON lease_comps(county);

CREATE INDEX IF NOT EXISTS idx_lease_comps_document
    ON lease_comps(source_document_id);
