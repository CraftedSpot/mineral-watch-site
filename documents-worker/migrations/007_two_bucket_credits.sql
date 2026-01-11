-- Migration: 007_two_bucket_credits
-- Implements two-bucket credit system:
-- 1. Monthly credits: Use-or-lose, tracked per billing period
-- 2. Permanent credits: Bonus + packs, never expire, stored separately

-- User credit balance table (permanent credits, independent of billing period)
CREATE TABLE IF NOT EXISTS user_credit_balance (
    user_id TEXT PRIMARY KEY,
    permanent_credits INTEGER DEFAULT 0,  -- bonus + token packs, never expires
    lifetime_credits_granted INTEGER DEFAULT 0,  -- total lifetime credits ever granted (for Free tier = 10)
    lifetime_credits_used INTEGER DEFAULT 0,  -- total lifetime credits used (for Free tier tracking)
    current_plan TEXT DEFAULT 'Free',  -- cache of user's current plan for quick lookups
    created_at DATETIME DEFAULT (datetime('now', '-6 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '-6 hours'))
);

-- Add monthly_credits_used to document_usage for clearer tracking
-- This tracks credits used against the monthly allowance specifically
ALTER TABLE document_usage ADD COLUMN monthly_credits_used INTEGER DEFAULT 0;

-- Add user_plan to documents table (stores plan at time of upload for credit checks)
ALTER TABLE documents ADD COLUMN user_plan TEXT DEFAULT 'Free';

-- Index for quick credit balance lookups
CREATE INDEX IF NOT EXISTS idx_user_credit_balance_user ON user_credit_balance(user_id);
