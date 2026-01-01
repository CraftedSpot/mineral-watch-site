-- Add new columns to documents table
ALTER TABLE documents ADD COLUMN user_id TEXT;
ALTER TABLE documents ADD COLUMN organization_id TEXT;
ALTER TABLE documents ADD COLUMN status TEXT DEFAULT 'pending';
ALTER TABLE documents ADD COLUMN file_size INTEGER;
ALTER TABLE documents ADD COLUMN page_count INTEGER;
ALTER TABLE documents ADD COLUMN deleted_at TEXT;
ALTER TABLE documents ADD COLUMN manually_verified INTEGER DEFAULT 0;
ALTER TABLE documents ADD COLUMN extraction_started_at TEXT;
ALTER TABLE documents ADD COLUMN extraction_completed_at TEXT;
ALTER TABLE documents ADD COLUMN extraction_error TEXT;

-- Update existing documents to James's account
UPDATE documents 
SET user_id = 'recEpgbS88AbuzAH8', 
    organization_id = 'recXvUmWkcgOC04nN',
    status = 'complete' 
WHERE user_id IS NULL;