-- V6: durable embedding checkpoints and retry-safe analysis state.
-- The checkpoint stores only the currently valid vector for a raw post. It is
-- deleted after finalization; an analyzed raw post is the durable no-op marker.
ALTER TABLE raw_posts ADD COLUMN analysis_content_hash TEXT;
ALTER TABLE raw_posts ADD COLUMN analysis_lease_at TEXT;
ALTER TABLE raw_posts ADD COLUMN analysis_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE event_sources ADD COLUMN event_version_applied INTEGER NOT NULL DEFAULT 0;

-- A newly-created event is tied to its first raw post so a crash between the
-- event insert and evidence insert can find and resume the same event.
ALTER TABLE events ADD COLUMN originating_raw_post_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_originating_raw_post
  ON events(originating_raw_post_id)
  WHERE originating_raw_post_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS embedding_checkpoints (
  raw_post_id INTEGER PRIMARY KEY REFERENCES raw_posts(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  vector_json TEXT,
  embedding_state TEXT NOT NULL CHECK (embedding_state IN ('ready', 'deferred')),
  embedded_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embedding_checkpoints_lookup
  ON embedding_checkpoints(raw_post_id, content_hash, embedding_model);
