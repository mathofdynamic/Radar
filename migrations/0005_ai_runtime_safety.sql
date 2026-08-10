CREATE TABLE IF NOT EXISTS ai_daily_budget (
  usage_date TEXT PRIMARY KEY,
  estimated_neurons INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Backfill the global ledger from the existing per-stage accounting so a deploy
-- in the middle of a UTC day does not forget AI already consumed today.
INSERT INTO ai_daily_budget(usage_date, estimated_neurons, updated_at)
SELECT usage_date, COALESCE(SUM(estimated_neurons), 0), COALESCE(MAX(updated_at), datetime('now'))
FROM ai_usage
GROUP BY usage_date
ON CONFLICT(usage_date) DO UPDATE SET
  estimated_neurons = MAX(ai_daily_budget.estimated_neurons, excluded.estimated_neurons),
  updated_at = excluded.updated_at;

-- V4 intentionally fails closed on deployment. Operators can explicitly turn
-- publishing back on from the authenticated admin console after validation.
UPDATE runtime_settings
SET setting_value = 'false', updated_at = datetime('now')
WHERE setting_key = 'publishing_enabled';
