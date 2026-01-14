-- Migration: 008_purchased_credits
-- Adds purchased_credits column to track one-time credit pack purchases
-- These are separate from permanent_credits (bonus) and never expire
-- Consumption order: Monthly -> Purchased -> Bonus

-- Add purchased_credits column (defaults to 0)
ALTER TABLE user_credit_balance ADD COLUMN purchased_credits INTEGER DEFAULT 0;

-- Create index for quick lookups (optional, user_id is already primary key)
-- CREATE INDEX IF NOT EXISTS idx_user_credit_purchased ON user_credit_balance(user_id, purchased_credits);

-- Credit purchase history table for audit trail
CREATE TABLE IF NOT EXISTS credit_purchase_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    credits INTEGER NOT NULL,
    price_id TEXT,
    pack_name TEXT,
    amount_paid INTEGER,  -- in cents
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    purchased_at DATETIME DEFAULT (datetime('now', '-6 hours')),
    FOREIGN KEY (user_id) REFERENCES user_credit_balance(user_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_purchase_user ON credit_purchase_history(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_purchase_session ON credit_purchase_history(stripe_session_id);
