import type { RuntimeConfig } from "./config";
import type { EmbeddingCheckpointRow, EventRow, PolledPost, RawPostRow, SourceRow, SourceSeed, TelegramWebPollEnvelope } from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

export async function listDueSources(db: D1Database, now: string, limit: number): Promise<SourceRow[]> {
  const result = await db.prepare(
    `SELECT id, source_key, name, telegram_username, role, priority_tier, category, language, source_type, trust_score,
            is_wire_origin, public_url, is_active, health_status, next_poll_at, last_seen_message_id, last_error
       FROM sources
      WHERE is_active = 1 AND (next_poll_at IS NULL OR next_poll_at <= ?)
      ORDER BY COALESCE(next_poll_at, '1970-01-01T00:00:00.000Z'), id
      LIMIT ?`
  ).bind(now, limit).all<SourceRow>();
  return result.results;
}

export async function upsertSourceSeed(db: D1Database, seed: SourceSeed, active = false): Promise<void> {
  const timestamp = nowIso();
  await db.prepare(
    `INSERT INTO sources (
      source_key, name, source_type, telegram_username, public_url, language, category,
      priority_tier, role, trust_score, is_wire_origin, is_active, health_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      name = excluded.name,
      source_type = excluded.source_type,
      telegram_username = excluded.telegram_username,
      public_url = excluded.public_url,
      language = excluded.language,
      category = excluded.category,
      priority_tier = excluded.priority_tier,
      role = excluded.role,
      trust_score = excluded.trust_score,
      is_wire_origin = excluded.is_wire_origin,
      updated_at = excluded.updated_at`
  ).bind(
    seed.source_key,
    seed.name,
    seed.source_type,
    seed.telegram_username,
    `https://t.me/${seed.telegram_username}`,
    seed.language,
    seed.category,
    seed.priority_tier,
    seed.role,
    seed.trust_score,
    seed.is_wire_origin ? 1 : 0,
    active ? 1 : 0,
    active ? "healthy" : "pending_validation",
    timestamp,
    timestamp
  ).run();
}

export async function getRawPost(db: D1Database, sourceId: number, messageId: number): Promise<RawPostRow | null> {
  return db.prepare("SELECT * FROM raw_posts WHERE source_id = ? AND telegram_message_id = ?")
    .bind(sourceId, messageId).first<RawPostRow>();
}

export async function upsertRawPost(db: D1Database, envelope: TelegramWebPollEnvelope, language: string): Promise<RawPostRow> {
  const timestamp = nowIso();
  const normalized = envelope.post.text.trim();
  await db.prepare(
    `INSERT INTO raw_posts (
      source_id, telegram_message_id, canonical_url, update_type, published_at, edited_at, observed_at,
      language, original_text, normalized_text, content_hash, media_type, raw_html_snippet,
      raw_metadata_json, is_deleted, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, telegram_message_id) DO UPDATE SET
      canonical_url = excluded.canonical_url,
      update_type = excluded.update_type,
      published_at = COALESCE(raw_posts.published_at, excluded.published_at),
      edited_at = CASE WHEN excluded.update_type = 'edit' THEN excluded.observed_at ELSE raw_posts.edited_at END,
      observed_at = excluded.observed_at,
      language = excluded.language,
      original_text = CASE WHEN excluded.update_type = 'edit' THEN excluded.original_text ELSE raw_posts.original_text END,
      normalized_text = CASE WHEN excluded.update_type = 'edit' THEN excluded.normalized_text ELSE raw_posts.normalized_text END,
      content_hash = excluded.content_hash,
      media_type = COALESCE(excluded.media_type, raw_posts.media_type),
      raw_html_snippet = excluded.raw_html_snippet,
      raw_metadata_json = excluded.raw_metadata_json,
      is_deleted = CASE WHEN excluded.update_type = 'delete' THEN 1 ELSE raw_posts.is_deleted END,
      processing_status = CASE
        WHEN raw_posts.content_hash = excluded.content_hash
         AND raw_posts.is_deleted = 0
         AND excluded.update_type <> 'delete'
        THEN raw_posts.processing_status
        ELSE 'pending'
      END,
      analysis_content_hash = CASE
        WHEN raw_posts.content_hash = excluded.content_hash
         AND raw_posts.is_deleted = 0
         AND excluded.update_type <> 'delete'
        THEN raw_posts.analysis_content_hash
        ELSE NULL
      END,
      analysis_lease_at = CASE
        WHEN raw_posts.content_hash = excluded.content_hash
         AND raw_posts.is_deleted = 0
         AND excluded.update_type <> 'delete'
        THEN raw_posts.analysis_lease_at
        ELSE NULL
      END,
      analysis_attempts = CASE
        WHEN raw_posts.content_hash = excluded.content_hash
         AND raw_posts.is_deleted = 0
         AND excluded.update_type <> 'delete'
        THEN raw_posts.analysis_attempts
        ELSE 0
      END,
      updated_at = excluded.updated_at`
  ).bind(
    envelope.sourceId,
    envelope.externalMessageId,
    envelope.post.canonicalUrl,
    envelope.updateType,
    envelope.post.publishedAt,
    envelope.post.editedAt,
    envelope.observedAt,
    language,
    envelope.post.text,
    normalized,
    envelope.post.contentHash,
    envelope.post.mediaType,
    envelope.post.rawHtmlSnippet,
    json(envelope.post.metadata),
    envelope.updateType === "delete" ? 1 : 0,
    timestamp,
    timestamp
  ).run();
  const row = await getRawPost(db, envelope.sourceId, envelope.externalMessageId);
  if (!row) throw new Error(`raw_post_upsert_failed:${envelope.sourceId}:${envelope.externalMessageId}`);
  return row;
}

export async function updateSourcePollSuccess(db: D1Database, source: SourceRow, latestMessageId: number | null, config: RuntimeConfig): Promise<void> {
  const timestamp = nowIso();
  const nextPoll = new Date(Date.now() + config.pollIntervalSeconds * 1000).toISOString();
  await db.prepare(
    `UPDATE sources
        SET last_polled_at = ?, next_poll_at = ?, last_seen_message_id = COALESCE(?, last_seen_message_id),
            health_status = 'healthy', last_error = NULL, updated_at = ?
      WHERE id = ?`
  ).bind(timestamp, nextPoll, latestMessageId, timestamp, source.id).run();
}

export async function updateSourcePollFailure(db: D1Database, sourceId: number, error: string, config: RuntimeConfig): Promise<void> {
  const timestamp = nowIso();
  const nextPoll = new Date(Date.now() + Math.min(config.pollIntervalSeconds * 2, 3600) * 1000).toISOString();
  await db.prepare(
    `UPDATE sources SET next_poll_at = ?, health_status = 'degraded', last_error = ?, updated_at = ? WHERE id = ?`
  ).bind(nextPoll, error.slice(0, 500), timestamp, sourceId).run();
}

export async function listRecentRawPosts(db: D1Database, limit = 250): Promise<RawPostRow[]> {
  const result = await db.prepare(
    `SELECT * FROM raw_posts WHERE is_deleted = 0 AND is_noise = 0 ORDER BY COALESCE(published_at, observed_at) DESC LIMIT ?`
  ).bind(limit).all<RawPostRow>();
  return result.results;
}

export async function getEvent(db: D1Database, eventId: number): Promise<EventRow | null> {
  return db.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
}

export async function getSource(db: D1Database, sourceId: number): Promise<SourceRow | null> {
  return db.prepare(
    `SELECT id, source_key, name, telegram_username, role, priority_tier, category, language, source_type,
            trust_score, is_wire_origin, public_url, is_active, health_status, next_poll_at,
            last_seen_message_id, last_error FROM sources WHERE id = ?`
  ).bind(sourceId).first<SourceRow>();
}

export async function incrementCounter(db: D1Database, metric: string, amount = 1): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const timestamp = nowIso();
  await db.prepare(
    `INSERT INTO operational_counters(counter_date, metric, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(counter_date, metric) DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at`
  ).bind(date, metric, amount, timestamp).run();
}

export async function getRuntimeSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(
    "SELECT setting_value FROM runtime_settings WHERE setting_key = ?"
  ).bind(key).first<{ setting_value: string }>();
  return row?.setting_value ?? null;
}

export async function setRuntimeSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    `INSERT INTO runtime_settings(setting_key, setting_value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`
  ).bind(key, value, nowIso()).run();
}

export async function isPublishingEnabled(db: D1Database, fallback: boolean): Promise<boolean> {
  const value = await getRuntimeSetting(db, "publishing_enabled");
  return value == null ? fallback : value === "true";
}

export async function reserveAiCall(db: D1Database, stage: string, maxCalls: number, estimatedNeurons: number, dailyBudget: number): Promise<boolean> {
  if (estimatedNeurons <= 0 || estimatedNeurons > dailyBudget) return false;
  const date = new Date().toISOString().slice(0, 10);
  const stageUsage = await db.prepare("SELECT calls FROM ai_usage WHERE usage_date = ? AND stage = ?")
    .bind(date, stage).first<{ calls: number }>();
  if ((stageUsage?.calls ?? 0) >= maxCalls) return false;

  const timestamp = nowIso();
  const globalReservation = await db.prepare(
    `INSERT INTO ai_daily_budget(usage_date, estimated_neurons, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(usage_date) DO UPDATE SET
       estimated_neurons = ai_daily_budget.estimated_neurons + excluded.estimated_neurons,
       updated_at = excluded.updated_at
     WHERE ai_daily_budget.estimated_neurons + excluded.estimated_neurons <= ?`
  ).bind(date, estimatedNeurons, timestamp, dailyBudget).run();

  if (Number(globalReservation.meta.changes ?? 0) < 1) return false;

  // The global reservation happens first and is intentionally fail-closed. If the
  // stage accounting write fails afterward, the ledger may overcount slightly,
  // but it will never undercount and accidentally exceed the daily AI budget.
  await db.prepare(
    `INSERT INTO ai_usage(usage_date, stage, calls, estimated_neurons, updated_at) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(usage_date, stage) DO UPDATE SET calls = calls + 1, estimated_neurons = estimated_neurons + excluded.estimated_neurons, updated_at = excluded.updated_at`
  ).bind(date, stage, estimatedNeurons, timestamp).run();
  return true;
}

export async function countStoriesToday(db: D1Database): Promise<number> {
  const date = new Date().toISOString().slice(0, 10);
  const row = await db.prepare("SELECT COUNT(*) AS count FROM published_stories WHERE publication_state = 'published' AND substr(published_at, 1, 10) = ?")
    .bind(date).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getSourcePostFingerprints(db: D1Database, sourceId: number, minMessageId: number, maxMessageId: number): Promise<Map<number, string>> {
  const result = await db.prepare(
    `SELECT telegram_message_id, content_hash
       FROM raw_posts
      WHERE source_id = ? AND telegram_message_id BETWEEN ? AND ?`
  ).bind(sourceId, minMessageId, maxMessageId).all<{ telegram_message_id: number; content_hash: string }>();
  return new Map(result.results.map((row) => [row.telegram_message_id, row.content_hash]));
}

export async function recordSourcePostFingerprint(db: D1Database, post: PolledPost): Promise<boolean> {
  const row = await db.prepare("SELECT content_hash FROM raw_posts WHERE source_id = ? AND telegram_message_id = ?")
    .bind(post.sourceId, post.messageId).first<{ content_hash: string }>();
  return row?.content_hash === post.contentHash;
}

export async function getEmbeddingCheckpoint(
  db: D1Database,
  rawPostId: number,
  contentHash: string,
  embeddingModel: string
): Promise<EmbeddingCheckpointRow | null> {
  return db.prepare(
    `SELECT raw_post_id, content_hash, embedding_model, vector_json, embedding_state, embedded_at, updated_at
       FROM embedding_checkpoints
      WHERE raw_post_id = ? AND content_hash = ? AND embedding_model = ?`
  ).bind(rawPostId, contentHash, embeddingModel).first<EmbeddingCheckpointRow>();
}

export async function saveEmbeddingCheckpoint(
  db: D1Database,
  checkpoint: Omit<EmbeddingCheckpointRow, "updated_at"> & { updated_at?: string }
): Promise<void> {
  const updatedAt = checkpoint.updated_at ?? nowIso();
  await db.prepare(
    `INSERT INTO embedding_checkpoints(
       raw_post_id, content_hash, embedding_model, vector_json, embedding_state, embedded_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(raw_post_id) DO UPDATE SET
       content_hash = excluded.content_hash,
       embedding_model = excluded.embedding_model,
       vector_json = excluded.vector_json,
       embedding_state = excluded.embedding_state,
       embedded_at = excluded.embedded_at,
       updated_at = excluded.updated_at`
  ).bind(
    checkpoint.raw_post_id,
    checkpoint.content_hash,
    checkpoint.embedding_model,
    checkpoint.vector_json,
    checkpoint.embedding_state,
    checkpoint.embedded_at,
    updatedAt
  ).run();
}

export async function deleteEmbeddingCheckpoint(db: D1Database, rawPostId: number, contentHash?: string, embeddingModel?: string): Promise<void> {
  if (contentHash != null && embeddingModel != null) {
    await db.prepare(
      "DELETE FROM embedding_checkpoints WHERE raw_post_id = ? AND content_hash = ? AND embedding_model = ?"
    ).bind(rawPostId, contentHash, embeddingModel).run();
    return;
  }
  await db.prepare("DELETE FROM embedding_checkpoints WHERE raw_post_id = ?").bind(rawPostId).run();
}

export async function claimAnalysisPrepare(db: D1Database, rawPostId: number, staleBefore: string, claimedAt = nowIso()): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE raw_posts
        SET processing_status = 'embedding', analysis_lease_at = ?,
            analysis_attempts = COALESCE(analysis_attempts, 0) + 1, updated_at = ?
      WHERE id = ? AND is_deleted = 0
        AND (
          processing_status IN ('pending', 'queued')
          OR (processing_status = 'processing' AND (analysis_lease_at IS NULL OR analysis_lease_at < ?))
        )`
  ).bind(claimedAt, claimedAt, rawPostId, staleBefore).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function claimAnalysisFinalize(db: D1Database, rawPostId: number, staleBefore: string, claimedAt = nowIso()): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE raw_posts
        SET processing_status = 'analyzing', analysis_lease_at = ?,
            analysis_attempts = COALESCE(analysis_attempts, 0) + 1, updated_at = ?
      WHERE id = ? AND is_deleted = 0
        AND (
          processing_status = 'embedded'
          OR (processing_status = 'analyzing' AND (analysis_lease_at IS NULL OR analysis_lease_at < ?))
        )`
  ).bind(claimedAt, claimedAt, rawPostId, staleBefore).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function queueAnalysisPrepare(db: D1Database, rawPostId: number, queuedAt = nowIso()): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE raw_posts
        SET processing_status = 'queued', analysis_lease_at = ?, updated_at = ?
      WHERE id = ? AND is_deleted = 0 AND processing_status = 'pending'`
  ).bind(queuedAt, queuedAt, rawPostId).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function resetQueuedAnalysis(db: D1Database, rawPostId: number, queuedAt: string): Promise<void> {
  await db.prepare(
    `UPDATE raw_posts SET processing_status = 'pending', analysis_lease_at = NULL, updated_at = ?
      WHERE id = ? AND processing_status = 'queued' AND analysis_lease_at = ?`
  ).bind(nowIso(), rawPostId, queuedAt).run();
}

export async function markRawPostAnalyzed(
  db: D1Database,
  rawPostId: number,
  contentHash: string,
  embeddingModel: string,
  analyzedAt = nowIso()
): Promise<boolean> {
  const result = await db.batch([
    db.prepare(
      `UPDATE raw_posts
          SET processing_status = 'analyzed', analysis_content_hash = ?, analysis_lease_at = NULL, updated_at = ?
        WHERE id = ? AND processing_status = 'analyzing' AND analysis_content_hash = ?`
    ).bind(contentHash, analyzedAt, rawPostId, contentHash),
    db.prepare(
      "DELETE FROM embedding_checkpoints WHERE raw_post_id = ? AND content_hash = ? AND embedding_model = ?"
    ).bind(rawPostId, contentHash, embeddingModel)
  ]);
  return Number(result[0]?.meta.changes ?? 0) > 0;
}

export async function listStaleAnalysisRawPost(db: D1Database, staleBefore: string): Promise<{ id: number } | null> {
  return db.prepare(
    `SELECT id FROM raw_posts
      WHERE is_deleted = 0
        AND processing_status IN ('pending', 'queued', 'processing', 'embedding', 'embedded', 'analyzing')
        AND (analysis_lease_at IS NULL OR analysis_lease_at < ?)
      ORDER BY COALESCE(analysis_lease_at, updated_at, created_at) ASC, id ASC LIMIT 1`
  ).bind(staleBefore).first<{ id: number }>();
}

export async function requeueStaleAnalysis(db: D1Database, rawPostId: number, staleBefore: string, queuedAt = nowIso()): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE raw_posts SET processing_status = 'queued', analysis_lease_at = ?, updated_at = ?
      WHERE id = ? AND is_deleted = 0
        AND processing_status IN ('pending', 'queued', 'processing', 'embedding', 'embedded', 'analyzing')
        AND (analysis_lease_at IS NULL OR analysis_lease_at < ?)`
  ).bind(queuedAt, queuedAt, rawPostId, staleBefore).run();
  return Number(result.meta.changes ?? 0) > 0;
}
