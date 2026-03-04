-- Duplicate document detection columns
ALTER TABLE documents ADD COLUMN duplicate_of_doc_id TEXT;
ALTER TABLE documents ADD COLUMN duplicate_status TEXT;
ALTER TABLE documents ADD COLUMN duplicate_match_type TEXT;
ALTER TABLE documents ADD COLUMN duplicate_detected_at TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_dup_status
  ON documents(duplicate_status) WHERE duplicate_status = 'pending_review';
CREATE INDEX IF NOT EXISTS idx_documents_dup_of
  ON documents(duplicate_of_doc_id) WHERE duplicate_of_doc_id IS NOT NULL;
