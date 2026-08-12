-- V6.1: make the event-origin conflict target compatible with SQLite/D1.
-- A normal UNIQUE index still permits multiple NULL values, while allowing
-- ON CONFLICT(originating_raw_post_id) to target the index directly.
DROP INDEX IF EXISTS idx_events_originating_raw_post;

CREATE UNIQUE INDEX idx_events_originating_raw_post
  ON events(originating_raw_post_id);
