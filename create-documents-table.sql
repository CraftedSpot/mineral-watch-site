-- Create documents table with all required fields
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    r2_key TEXT NOT NULL,
    filename TEXT NOT NULL,
    user_id TEXT,
    organization_id TEXT,
    status TEXT DEFAULT 'pending',
    doc_type TEXT,
    county TEXT,
    section TEXT,
    township TEXT,
    range TEXT,
    confidence TEXT,
    upload_date TEXT DEFAULT (datetime('now')),
    file_size INTEGER,
    page_count INTEGER,
    deleted_at TEXT,
    manually_verified INTEGER DEFAULT 0,
    extraction_started_at TEXT,
    extraction_completed_at TEXT,
    extraction_error TEXT,
    extracted_data TEXT
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_organization_id ON documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at);