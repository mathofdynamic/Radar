CREATE TABLE IF NOT EXISTS runtime_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO runtime_settings(setting_key, setting_value, updated_at)
VALUES ('publishing_enabled', 'false', datetime('now'))
ON CONFLICT(setting_key) DO NOTHING;
