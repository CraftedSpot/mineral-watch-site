-- Add enhanced_extraction flag to documents table
-- When set to 1, document will be processed with Opus model (2 credits instead of 1)
ALTER TABLE documents ADD COLUMN enhanced_extraction INTEGER DEFAULT 0;
