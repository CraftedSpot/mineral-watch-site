-- Auto-retry tracking for transient extraction failures
-- is_retryable: 1=transient error (will retry), 0=permanent error (give up), NULL=unclassified
-- auto_retry_count: how many times the cron has automatically retried this document
ALTER TABLE documents ADD COLUMN is_retryable INTEGER DEFAULT NULL;
ALTER TABLE documents ADD COLUMN auto_retry_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_documents_retryable
  ON documents(is_retryable, status)
  WHERE is_retryable = 1 AND status = 'failed';
