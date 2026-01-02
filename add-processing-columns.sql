-- Add missing columns for document processing
ALTER TABLE documents ADD COLUMN display_name TEXT;
ALTER TABLE documents ADD COLUMN category TEXT;
ALTER TABLE documents ADD COLUMN needs_review INTEGER DEFAULT 0;
ALTER TABLE documents ADD COLUMN field_scores TEXT;
ALTER TABLE documents ADD COLUMN fields_needing_review TEXT;
ALTER TABLE documents ADD COLUMN queued_at TEXT;
ALTER TABLE documents ADD COLUMN processing_attempts INTEGER DEFAULT 0;