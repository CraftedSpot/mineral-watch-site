-- Chain-of-title tree: edges, cache, and current owners
-- Parent→child edges between chain-of-title documents

CREATE TABLE IF NOT EXISTS document_chain_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id TEXT NOT NULL,
  parent_doc_id TEXT NOT NULL,
  child_doc_id TEXT NOT NULL,
  match_type TEXT NOT NULL,
  match_confidence REAL DEFAULT 1.0,
  matched_from_name TEXT,
  matched_to_name TEXT,
  edge_type TEXT,
  is_manual INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(parent_doc_id, child_doc_id)
);

CREATE INDEX IF NOT EXISTS idx_chain_edges_property ON document_chain_edges(property_id);
CREATE INDEX IF NOT EXISTS idx_chain_edges_parent ON document_chain_edges(parent_doc_id);
CREATE INDEX IF NOT EXISTS idx_chain_edges_child ON document_chain_edges(child_doc_id);

-- Cached computed tree JSON per property
CREATE TABLE IF NOT EXISTS chain_tree_cache (
  property_id TEXT PRIMARY KEY,
  tree_json TEXT NOT NULL,
  doc_count INTEGER,
  built_at TEXT DEFAULT (datetime('now')),
  invalidated_at TEXT
);

-- Terminal current-owner nodes
CREATE TABLE IF NOT EXISTS chain_current_owners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_name_normalized TEXT NOT NULL,
  acquired_via_doc_id TEXT,
  acquired_date TEXT,
  interest_text TEXT,
  interest_decimal REAL,
  interest_type TEXT,
  is_manual INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(property_id, owner_name_normalized)
);

CREATE INDEX IF NOT EXISTS idx_chain_owners_property ON chain_current_owners(property_id);
