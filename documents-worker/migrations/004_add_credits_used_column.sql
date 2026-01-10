-- Add credits_used column to document_processing_log
ALTER TABLE document_processing_log ADD COLUMN credits_used INTEGER NOT NULL DEFAULT 1;

-- Update document_usage to track credits instead of documents
ALTER TABLE document_usage ADD COLUMN credits_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE document_usage ADD COLUMN docs_processed_backup INTEGER;
UPDATE document_usage SET docs_processed_backup = docs_processed;
UPDATE document_usage SET credits_used = docs_processed;  -- Initialize with 1:1 assumption

-- Create index for credit analytics
CREATE INDEX idx_document_processing_log_credits ON document_processing_log(user_id, billing_period, credits_used);