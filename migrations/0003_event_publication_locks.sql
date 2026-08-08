CREATE TABLE IF NOT EXISTS event_publication_locks (
  event_id INTEGER PRIMARY KEY REFERENCES events(id),
  publish_key TEXT NOT NULL UNIQUE,
  event_version INTEGER NOT NULL,
  telegram_message_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('processing', 'published', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_publication_locks_status ON event_publication_locks(status);
