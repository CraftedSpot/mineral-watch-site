-- Migration 014: Document parties table + summary column
-- Adds structured party extraction for chain-of-title, chatbot, and cross-document search.

CREATE TABLE IF NOT EXISTS document_parties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    party_name TEXT NOT NULL,
    party_name_normalized TEXT NOT NULL,
    party_role TEXT NOT NULL,
    party_type TEXT DEFAULT 'unknown',
    address TEXT,
    document_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dp_document_id ON document_parties(document_id);
CREATE INDEX IF NOT EXISTS idx_dp_name_normalized ON document_parties(party_name_normalized);
CREATE INDEX IF NOT EXISTS idx_dp_name_role ON document_parties(party_name_normalized, party_role);

-- Promote key_takeaway from extracted_data JSON to top-level column for efficient cross-doc queries
ALTER TABLE documents ADD COLUMN summary TEXT;
