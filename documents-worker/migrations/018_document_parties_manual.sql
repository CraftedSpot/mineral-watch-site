-- Add is_manual and is_deleted columns to document_parties
-- is_manual = 1: user-added party, preserved during re-extraction
-- is_deleted = 1: user-deleted extracted party, soft-deleted to survive re-extraction

ALTER TABLE document_parties ADD COLUMN is_manual INTEGER DEFAULT 0;
ALTER TABLE document_parties ADD COLUMN is_deleted INTEGER DEFAULT 0;
