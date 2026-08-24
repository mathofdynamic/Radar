-- V8: replace the embedding pipeline with durable Nebula intelligence batches.
-- Historical analysis/idempotency columns remain intentionally. They are useful
-- for generic leases and content-change protection even though embeddings are
-- gone. No historical raw posts, events, or evidence are deleted here.

-- Legacy V6 work that never reached a durable analyzed state must re-enter the
-- generic pending queue. Already analyzed rows are not changed.
UPDATE raw_posts
   SET processing_status = 'pending',
       analysis_lease_at = NULL
 WHERE processing_status IN ('processing', 'embedding', 'embedded');

DROP TABLE IF EXISTS embedding_checkpoints;

CREATE TABLE IF NOT EXISTS intelligence_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_key TEXT NOT NULL UNIQUE,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  batch_sequence INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  report_count INTEGER NOT NULL DEFAULT 0,
  model_requested TEXT NOT NULL,
  provider_used TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  lease_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (window_end, batch_sequence)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_batches_status
  ON intelligence_batches(status, COALESCE(lease_at, created_at), id);

CREATE TABLE IF NOT EXISTS intelligence_batch_items (
  batch_id INTEGER NOT NULL REFERENCES intelligence_batches(id) ON DELETE CASCADE,
  raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'MATCH_EXISTING_EVENT', 'NEW_EVENT', 'DUPLICATE',
    'UPDATE_EXISTING_EVENT', 'NOISE', 'UNCERTAIN'
  )),
  event_id INTEGER REFERENCES events(id),
  duplicate_of_post_id INTEGER REFERENCES raw_posts(id),
  confidence REAL NOT NULL,
  item_status TEXT NOT NULL CHECK (item_status IN ('claimed', 'applied', 'released')),
  decision_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, raw_post_id)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_batch_items_raw_post
  ON intelligence_batch_items(raw_post_id, item_status);

CREATE INDEX IF NOT EXISTS idx_intelligence_batch_items_batch_status
  ON intelligence_batch_items(batch_id, item_status);
