-- Manual chain roots: user-designated root documents that should appear
-- in the tree as roots rather than orphans.

CREATE TABLE IF NOT EXISTS chain_manual_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(property_id, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_chain_manual_roots_property ON chain_manual_roots(property_id);
