PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  telegram_channel_id TEXT,
  telegram_username TEXT NOT NULL,
  website_url TEXT,
  public_url TEXT NOT NULL,
  language TEXT NOT NULL,
  category TEXT NOT NULL,
  affiliation TEXT,
  priority_tier TEXT NOT NULL DEFAULT 'TIER_3',
  role TEXT NOT NULL,
  trust_score REAL NOT NULL DEFAULT 0.5,
  is_wire_origin INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  health_status TEXT NOT NULL DEFAULT 'pending_validation',
  last_polled_at TEXT,
  next_poll_at TEXT,
  last_seen_message_id INTEGER,
  last_error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  telegram_channel_id TEXT,
  telegram_message_id INTEGER NOT NULL,
  canonical_url TEXT NOT NULL,
  update_type TEXT NOT NULL CHECK (update_type IN ('create','edit','delete')),
  published_at TEXT,
  edited_at TEXT,
  observed_at TEXT NOT NULL,
  language TEXT,
  original_text TEXT NOT NULL DEFAULT '',
  normalized_text TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  media_type TEXT,
  media_group_id TEXT,
  views INTEGER,
  forwards INTEGER,
  forward_origin_json TEXT,
  reply_to_message_id INTEGER,
  entities_json TEXT NOT NULL DEFAULT '[]',
  raw_html_snippet TEXT,
  raw_metadata_json TEXT NOT NULL DEFAULT '{}',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  is_noise INTEGER NOT NULL DEFAULT 0,
  noise_reason TEXT,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_id, telegram_message_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_posts_source_time ON raw_posts(source_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_posts_hash ON raw_posts(content_hash);

CREATE TABLE IF NOT EXISTS raw_post_duplicates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id),
  duplicate_of_raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id),
  similarity_score REAL NOT NULL,
  reason_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(raw_post_id, duplicate_of_raw_post_id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_title TEXT,
  core_fact TEXT NOT NULL,
  claims_json TEXT NOT NULL DEFAULT '{}',
  category TEXT NOT NULL DEFAULT 'IRAN',
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  importance_score REAL NOT NULL DEFAULT 0,
  confidence_score REAL NOT NULL DEFAULT 0,
  novelty_score REAL NOT NULL DEFAULT 0,
  iran_relevance_score REAL NOT NULL DEFAULT 0,
  impact_score REAL NOT NULL DEFAULT 0,
  urgency_score REAL NOT NULL DEFAULT 0,
  geopolitical_score REAL NOT NULL DEFAULT 0,
  subscores_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_updated_at TEXT NOT NULL,
  event_state TEXT NOT NULL DEFAULT 'active',
  event_version INTEGER NOT NULL DEFAULT 1,
  event_embedding_ref TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  independent_confirmation_count INTEGER NOT NULL DEFAULT 0,
  last_scored_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_active_time ON events(event_state, last_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_score ON events(importance_score DESC);

CREATE TABLE IF NOT EXISTS event_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id),
  source_id INTEGER NOT NULL REFERENCES sources(id),
  origin_type TEXT NOT NULL DEFAULT 'unknown',
  origin_group TEXT NOT NULL,
  supports_core_fact INTEGER NOT NULL DEFAULT 1,
  relationship_confidence REAL NOT NULL DEFAULT 0.5,
  dependency_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, raw_post_id)
);

CREATE TABLE IF NOT EXISTS source_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_source_id INTEGER NOT NULL REFERENCES sources(id),
  to_source_id INTEGER NOT NULL REFERENCES sources(id),
  relationship_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  is_manual_override INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(from_source_id, to_source_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_entities (
  event_id INTEGER NOT NULL REFERENCES events(id),
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  confidence REAL NOT NULL DEFAULT 0.5,
  PRIMARY KEY(event_id, entity_id)
);

CREATE TABLE IF NOT EXISTS event_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  event_version INTEGER NOT NULL,
  update_type TEXT NOT NULL,
  previous_snapshot_json TEXT NOT NULL,
  new_snapshot_json TEXT NOT NULL,
  editorial_action TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS editorial_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  event_version INTEGER NOT NULL,
  decision TEXT NOT NULL,
  score REAL NOT NULL,
  reason_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, event_version)
);

CREATE TABLE IF NOT EXISTS published_stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  event_version INTEGER NOT NULL,
  publish_key TEXT NOT NULL UNIQUE,
  published_at TEXT,
  telegram_message_id INTEGER,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  independent_confirmations INTEGER NOT NULL DEFAULT 0,
  primary_sources_json TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL,
  entity_tags_json TEXT NOT NULL DEFAULT '[]',
  links_json TEXT NOT NULL DEFAULT '[]',
  cover_r2_key TEXT,
  cover_mime_type TEXT,
  story_model TEXT,
  publication_state TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_usage (
  usage_date TEXT NOT NULL,
  stage TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  estimated_neurons INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(usage_date, stage)
);

CREATE TABLE IF NOT EXISTS operational_counters (
  counter_date TEXT NOT NULL,
  metric TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(counter_date, metric)
);
