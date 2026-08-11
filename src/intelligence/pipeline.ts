import { runtimeConfig } from "../config";
import { sha256Hex } from "../crypto";
import {
  claimAnalysisFinalize,
  claimAnalysisPrepare,
  deleteEmbeddingCheckpoint,
  getEmbeddingCheckpoint,
  getEvent,
  getSource,
  incrementCounter,
  listRecentRawPosts,
  listStaleAnalysisRawPost,
  markRawPostAnalyzed,
  queueAnalysisPrepare as markAnalysisQueued,
  requeueStaleAnalysis,
  resetQueuedAnalysis,
  saveEmbeddingCheckpoint,
  upsertRawPost
} from "../db";
import { lexicalOverlap, normalizePersianText } from "../normalization";
import type { AnalysisFinalizeJob, AnalysisPrepareJob, EditorialBatchJob } from "../queue";
import { combinedSimilarity, extractEntityKeys, inferCategory, semanticEventScore, temporalProximity } from "./similarity";
import { generateEmbedding } from "./ai";
import { calculateVerification, classifyOrigin, originGroupFor, persistVerification } from "./verification";
import { scoreEvent } from "../editorial/scoring";
import type { EditorialCandidate, EventRow, RawPostRow, SourceRow, TelegramWebPollEnvelope } from "../types";
import { ANALYSIS_STALE_AFTER_MS, isReusableEmbeddingCheckpoint, isStaleAnalysisLease, parseEmbedding, shouldSkipAnalyzedPost } from "./analysis-state";

interface SemanticNeighbor {
  rawPostId: number;
  score: number;
}

interface IngestOptions {
  enqueueAnalysis?: boolean;
}

interface EventSourceAttachment {
  inserted: boolean;
}

export async function ingestEnvelope(env: Env, envelope: TelegramWebPollEnvelope, options: IngestOptions = {}): Promise<number> {
  const source = await getSource(env.DB, envelope.sourceId);
  if (!source) throw new Error(`unknown_source:${envelope.sourceId}`);
  const rawPost = await upsertRawPost(env.DB, envelope, source.language);
  if (options.enqueueAnalysis !== false) await enqueueAnalysisPrepare(env, rawPost.id);
  await incrementCounter(env.DB, "raw_posts_persisted");
  return rawPost.id;
}

/**
 * Schedule one raw post for Stage A. The queued state is a short lease so a
 * duplicate delivery cannot create an unbounded number of prepare jobs.
 */
export async function enqueueAnalysisPrepare(env: Env, rawPostId: number): Promise<boolean> {
  const queuedAt = new Date().toISOString();
  const queued = await markAnalysisQueued(env.DB, rawPostId, queuedAt);
  if (!queued) return false;
  try {
    await env.EVENT_ANALYSIS_QUEUE.send({ kind: "analysis_prepare", rawPostId } satisfies AnalysisPrepareJob);
    await incrementCounter(env.DB, "analysis_jobs_queued");
    return true;
  } catch (error) {
    await resetQueuedAnalysis(env.DB, rawPostId, queuedAt);
    throw error;
  }
}

/** Requeue at most one stale analysis row per poll cycle. */
export async function recoverStaleAnalysis(env: Env): Promise<boolean> {
  const staleBefore = new Date(Date.now() - ANALYSIS_STALE_AFTER_MS).toISOString();
  const row = await listStaleAnalysisRawPost(env.DB, staleBefore);
  if (!row) return false;

  const queuedAt = new Date().toISOString();
  if (!(await requeueStaleAnalysis(env.DB, row.id, staleBefore, queuedAt))) return false;
  try {
    await env.EVENT_ANALYSIS_QUEUE.send({ kind: "analysis_prepare", rawPostId: row.id } satisfies AnalysisPrepareJob);
    await incrementCounter(env.DB, "analysis_recovery_jobs_queued");
    return true;
  } catch (error) {
    await resetQueuedAnalysis(env.DB, row.id, queuedAt);
    throw error;
  }
}

/**
 * Stage A: normalize once, reuse a durable checkpoint when possible, and
 * persist the result before any Vectorize or event-clustering work begins.
 */
export async function prepareRawPost(env: Env, rawPostId: number): Promise<void> {
  const rawPost = await getRawPostById(env.DB, rawPostId);
  if (!rawPost) throw new Error(`missing_raw_post:${rawPostId}`);

  const normalized = normalizePersianText(rawPost.original_text);
  const contentHash = await sha256Hex(normalized.normalizedText);
  const config = runtimeConfig(env);
  const embeddingModel = config.embeddingModel;

  if (shouldSkipAnalyzedPost(rawPost.processing_status)) return;

  if (normalized.isNoise || rawPost.is_deleted === 1) {
    const wasAlreadyNoise = rawPost.processing_status === "noise";
    await env.DB.prepare(
      `UPDATE raw_posts SET normalized_text = ?, is_noise = ?, noise_reason = ?, processing_status = 'noise',
        analysis_content_hash = ?, analysis_lease_at = NULL, updated_at = ? WHERE id = ?`
    ).bind(
      normalized.normalizedText,
      normalized.isNoise ? 1 : 0,
      normalized.noiseReason,
      contentHash,
      new Date().toISOString(),
      rawPost.id
    ).run();
    await deleteEmbeddingCheckpoint(env.DB, rawPost.id);
    if (!wasAlreadyNoise) await incrementCounter(env.DB, "posts_filtered");
    return;
  }

  await env.DB.prepare(
    `UPDATE raw_posts SET normalized_text = ?, is_noise = 0, noise_reason = NULL, updated_at = ? WHERE id = ?`
  ).bind(normalized.normalizedText, new Date().toISOString(), rawPost.id).run();

  const existing = await getEmbeddingCheckpoint(env.DB, rawPost.id, contentHash, embeddingModel);
  if (isReusableEmbeddingCheckpoint(existing, contentHash, embeddingModel)) {
    if (rawPost.processing_status === "analyzing") return;
    await markEmbedded(env, rawPost.id, contentHash);
    await queueAnalysisFinalize(env, rawPost.id);
    return;
  }

  if (rawPost.processing_status === "embedded"
    || (rawPost.processing_status === "analyzing" && isStaleAnalysisLease(rawPost.analysis_lease_at, new Date().toISOString()))) {
    await env.DB.prepare(
      "UPDATE raw_posts SET processing_status = 'pending', analysis_lease_at = NULL, updated_at = ? WHERE id = ? AND processing_status <> 'analyzed'"
    ).bind(new Date().toISOString(), rawPost.id).run();
  }

  const claimed = await claimAnalysisPrepare(
    env.DB,
    rawPost.id,
    new Date(Date.now() - ANALYSIS_STALE_AFTER_MS).toISOString()
  );
  if (!claimed) return;

  // Another delivery may have completed the checkpoint between the first
  // lookup and the lease update. Check again before reserving AI budget.
  const checkpointAfterClaim = await getEmbeddingCheckpoint(env.DB, rawPost.id, contentHash, embeddingModel);
  if (isReusableEmbeddingCheckpoint(checkpointAfterClaim, contentHash, embeddingModel)) {
    await markEmbedded(env, rawPost.id, contentHash);
    await queueAnalysisFinalize(env, rawPost.id);
    return;
  }

  const embedding = await generateEmbedding(env, normalized.normalizedText);
  const embeddedAt = embedding ? new Date().toISOString() : null;
  await saveEmbeddingCheckpoint(env.DB, {
    raw_post_id: rawPost.id,
    content_hash: contentHash,
    embedding_model: embeddingModel,
    vector_json: embedding ? JSON.stringify(embedding) : null,
    embedding_state: embedding ? "ready" : "deferred",
    embedded_at: embeddedAt
  });

  // This write is intentionally after the checkpoint write. If the Worker is
  // killed after this point, a retry can skip Workers AI and continue safely.
  await markEmbedded(env, rawPost.id, contentHash);
  if (embedding) await incrementCounter(env.DB, "embeddings_generated");
  else await incrementCounter(env.DB, "embeddings_deferred");
  await queueAnalysisFinalize(env, rawPost.id);
}

async function queueAnalysisFinalize(env: Env, rawPostId: number): Promise<void> {
  await env.EVENT_ANALYSIS_QUEUE.send({ kind: "analysis_finalize", rawPostId } satisfies AnalysisFinalizeJob);
}

async function markEmbedded(env: Env, rawPostId: number, contentHash: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE raw_posts SET processing_status = 'embedded', analysis_content_hash = ?, analysis_lease_at = ?, updated_at = ?
      WHERE id = ? AND processing_status <> 'analyzed'`
  ).bind(contentHash, new Date().toISOString(), new Date().toISOString(), rawPostId).run();
}

/**
 * Stage B: reuse the Stage A checkpoint for Vectorize and event formation.
 * All relationship writes are conflict-safe and event-version application is
 * marked durably so a retry cannot advance the same event repeatedly.
 */
export async function finalizeRawPost(env: Env, rawPostId: number): Promise<EditorialCandidate | null> {
  const rawPost = await getRawPostById(env.DB, rawPostId);
  if (!rawPost || rawPost.processing_status === "analyzed") return null;
  const source = await getSource(env.DB, rawPost.source_id);
  if (!source) throw new Error(`missing_source:${rawPost.source_id}`);

  const normalized = normalizePersianText(rawPost.original_text);
  if (normalized.isNoise || rawPost.is_deleted === 1) return null;
  const contentHash = await sha256Hex(normalized.normalizedText);
  const embeddingModel = runtimeConfig(env).embeddingModel;
  const checkpoint = await getEmbeddingCheckpoint(env.DB, rawPost.id, contentHash, embeddingModel);
  if (!checkpoint) {
    await env.DB.prepare(
      "UPDATE raw_posts SET processing_status = 'pending', analysis_lease_at = NULL, updated_at = ? WHERE id = ? AND processing_status IN ('embedded', 'analyzing')"
    ).bind(new Date().toISOString(), rawPost.id).run();
    await enqueueAnalysisPrepare(env, rawPost.id);
    return null;
  }

  const claimed = await claimAnalysisFinalize(
    env.DB,
    rawPost.id,
    new Date(Date.now() - ANALYSIS_STALE_AFTER_MS).toISOString()
  );
  if (!claimed) return null;

  const embedding = checkpoint.embedding_state === "ready" ? parseEmbedding(checkpoint.vector_json) : null;
  let semanticNeighbors: SemanticNeighbor[] = [];
  if (embedding) {
    try {
      await env.EVENT_INDEX.upsert([{
        id: `raw:${rawPost.id}`,
        values: embedding,
        metadata: { raw_post_id: rawPost.id, source_id: source.id, published_at: rawPost.published_at ?? "" }
      }]);
      semanticNeighbors = await querySemanticNeighbors(env, rawPost.id, embedding);
    } catch (error) {
      console.error(JSON.stringify({ event: "vectorize_operation_failed", raw_post_id: rawPost.id, error: error instanceof Error ? error.message : "unknown" }));
    }
  }

  const duplicate = await findNearDuplicate(env.DB, rawPost, normalized.normalizedText, semanticNeighbors);
  if (duplicate) {
    const result = await env.DB.prepare(
      `INSERT INTO raw_post_duplicates(raw_post_id, duplicate_of_raw_post_id, similarity_score, reason_json, created_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(raw_post_id, duplicate_of_raw_post_id) DO NOTHING`
    ).bind(rawPost.id, duplicate.id, duplicate.score, JSON.stringify({ method: duplicate.method }), new Date().toISOString()).run();
    if (Number(result.meta.changes ?? 0) > 0) await incrementCounter(env.DB, "duplicates_detected");
  }

  const event = await findOrCreateEvent(env, rawPost, source, normalized.normalizedText, semanticNeighbors);
  await recalculateEvent(env, event.id);
  const refreshed = await getEvent(env.DB, event.id);
  if (!refreshed) throw new Error(`event_missing_after_recalculate:${event.id}`);
  const score = scoreEvent(refreshed);
  const scoredAt = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE events SET importance_score = ?, impact_score = ?, iran_relevance_score = ?, urgency_score = ?, confidence_score = ?,
      novelty_score = ?, geopolitical_score = ?, subscores_json = ?, last_scored_at = ?, updated_at = ? WHERE id = ?`
  ).bind(
    score.finalScore,
    score.impact,
    score.iranRelevance,
    score.urgency,
    score.confidence,
    score.novelty,
    score.geopoliticalSignificance,
    JSON.stringify(score),
    scoredAt,
    scoredAt,
    event.id
  ).run();

  const candidate = score.finalScore < 60 ? null : {
    eventId: event.id,
    eventVersion: refreshed.event_version,
    decision: "MONITOR" as const,
    score: score.finalScore,
    reasons: score.reasons
  } satisfies EditorialCandidate;

  // Queue before deleting the checkpoint. If sending fails, the raw post stays
  // retryable and the paid embedding remains available for the next attempt.
  if (candidate) {
    await env.EDITORIAL_QUEUE.send({ kind: "editorial_batch", candidates: [candidate] } satisfies EditorialBatchJob);
  }

  const finalized = await markRawPostAnalyzed(env.DB, rawPost.id, contentHash, embeddingModel);
  if (finalized) await incrementCounter(env.DB, "events_scored");
  return candidate;
}

async function getRawPostById(db: D1Database, rawPostId: number): Promise<RawPostRow | null> {
  return db.prepare("SELECT * FROM raw_posts WHERE id = ?").bind(rawPostId).first<RawPostRow>();
}

async function querySemanticNeighbors(env: Env, rawPostId: number, embedding: number[]): Promise<SemanticNeighbor[]> {
  const result = await env.EVENT_INDEX.query(embedding, { topK: 12, returnMetadata: "all" });
  const neighbors: SemanticNeighbor[] = [];
  for (const match of result.matches) {
    const candidateRawPostId = Number(match.metadata?.raw_post_id);
    if (!Number.isSafeInteger(candidateRawPostId) || candidateRawPostId <= 0 || candidateRawPostId === rawPostId) continue;
    neighbors.push({ rawPostId: candidateRawPostId, score: match.score });
  }
  return neighbors;
}

async function findNearDuplicate(
  db: D1Database,
  rawPost: RawPostRow,
  text: string,
  semanticNeighbors: SemanticNeighbor[]
): Promise<{ id: number; score: number; method: string } | null> {
  const recent = await listRecentRawPosts(db, 100);
  const semanticById = new Map(semanticNeighbors.map((neighbor) => [neighbor.rawPostId, neighbor.score]));
  let best: { id: number; score: number; method: string } | null = null;
  for (const candidate of recent) {
    if (candidate.id === rawPost.id || candidate.source_id === rawPost.source_id) continue;
    const candidateText = candidate.normalized_text || candidate.original_text;
    const temporal = temporalProximity(rawPost.published_at, candidate.published_at);
    const lexical = combinedSimilarity(text, candidateText, temporal);
    const semantic = semanticById.get(candidate.id) ?? 0;
    const score = Math.max(lexical, semanticEventScore(semantic, text, candidateText, temporal));
    if (score >= 0.84 && (!best || score > best.score)) {
      best = { id: candidate.id, score, method: semantic > lexical ? "semantic_lexical_temporal" : "lexical_temporal" };
    }
  }
  return best;
}

async function findOrCreateEvent(
  env: Env,
  rawPost: RawPostRow,
  source: SourceRow,
  text: string,
  semanticNeighbors: SemanticNeighbor[]
): Promise<EventRow> {
  // A raw post can only be evidence for one event. This fast path is the main
  // protection against duplicate finalization after a Queue retry.
  const attached = await env.DB.prepare(
    "SELECT event_id FROM event_sources WHERE raw_post_id = ? ORDER BY id DESC LIMIT 1"
  ).bind(rawPost.id).first<{ event_id: number }>();
  if (attached) {
    const existing = await getEvent(env.DB, attached.event_id);
    if (!existing) throw new Error(`event_missing_for_raw_post:${rawPost.id}`);
    await persistEntities(env, existing.id, text);
    return existing;
  }

  // Recover a crash after INSERT events but before event_sources INSERT.
  const originating = await env.DB.prepare("SELECT * FROM events WHERE originating_raw_post_id = ?")
    .bind(rawPost.id).first<EventRow>();
  if (originating) {
    await attachEventSource(env, originating.id, rawPost, source, text, false);
    await persistEntities(env, originating.id, text);
    const recovered = await getEvent(env.DB, originating.id);
    if (!recovered) throw new Error(`event_recovery_missing:${originating.id}`);
    return recovered;
  }

  const candidates = await env.DB.prepare(
    `SELECT * FROM events WHERE event_state = 'active' AND last_updated_at >= ? ORDER BY last_updated_at DESC LIMIT 100`
  ).bind(new Date(Date.now() - 48 * 3_600_000).toISOString()).all<EventRow>();
  const semanticEventScores = await semanticScoresByEvent(env.DB, semanticNeighbors);
  let best: { event: EventRow; score: number } | null = null;
  for (const candidate of candidates.results) {
    const temporal = temporalProximity(rawPost.published_at, candidate.first_seen_at);
    const lexical = combinedSimilarity(text, candidate.core_fact, temporal);
    const semantic = semanticEventScores.get(candidate.id) ?? 0;
    const score = Math.max(lexical, semanticEventScore(semantic, text, candidate.core_fact, temporal));
    if (inferCategory(text) !== candidate.category && score < 0.72) continue;
    if (score >= 0.62 && (!best || score > best.score)) best = { event: candidate, score };
  }
  const timestamp = new Date().toISOString();
  if (best) {
    const attachment = await attachEventSource(env, best.event.id, rawPost, source, text, true);
    if (attachment.inserted) await incrementCounter(env.DB, "posts_attached_to_events");
    const updated = await getEvent(env.DB, best.event.id);
    if (!updated) throw new Error(`event_update_missing:${best.event.id}`);
    return updated;
  }

  const category = inferCategory(text, source.category);
  const result = await env.DB.prepare(
    `INSERT INTO events(core_fact, category, first_seen_at, last_updated_at, originating_raw_post_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(originating_raw_post_id) DO NOTHING`
  ).bind(text.slice(0, 800), category, rawPost.published_at ?? timestamp, timestamp, rawPost.id, timestamp, timestamp).run();
  let eventId = Number(result.meta.last_row_id ?? 0);
  if (!eventId) {
    const existing = await env.DB.prepare("SELECT * FROM events WHERE originating_raw_post_id = ?")
      .bind(rawPost.id).first<EventRow>();
    if (!existing) throw new Error(`event_create_missing:${rawPost.id}`);
    eventId = existing.id;
  } else {
    await incrementCounter(env.DB, "events_created");
  }
  await attachEventSource(env, eventId, rawPost, source, text, false);
  const created = await getEvent(env.DB, eventId);
  if (!created) throw new Error(`event_create_missing:${eventId}`);
  return created;
}

async function semanticScoresByEvent(db: D1Database, neighbors: SemanticNeighbor[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  for (const neighbor of neighbors) {
    const row = await db.prepare("SELECT event_id FROM event_sources WHERE raw_post_id = ? ORDER BY id DESC LIMIT 1")
      .bind(neighbor.rawPostId).first<{ event_id: number }>();
    if (!row) continue;
    const current = result.get(row.event_id) ?? 0;
    if (neighbor.score > current) result.set(row.event_id, neighbor.score);
  }
  return result;
}

async function attachEventSource(
  env: Env,
  eventId: number,
  rawPost: RawPostRow,
  source: SourceRow,
  text: string,
  incrementEventVersion: boolean
): Promise<EventSourceAttachment> {
  const related = await env.DB.prepare(
    `SELECT es.origin_group, rp.normalized_text FROM event_sources es JOIN raw_posts rp ON rp.id = es.raw_post_id
      WHERE es.event_id = ? ORDER BY es.id DESC LIMIT 30`
  ).bind(eventId).all<{ origin_group: string; normalized_text: string }>();
  const copiedFrom = related.results.find((candidate) => lexicalOverlap(text, candidate.normalized_text) >= 0.86);
  const originType = classifyOrigin(source, rawPost);
  const originGroup = originGroupFor(source, rawPost, copiedFrom?.origin_group);
  const timestamp = new Date().toISOString();
  const insert = env.DB.prepare(
    `INSERT INTO event_sources(event_id, raw_post_id, source_id, origin_type, origin_group, supports_core_fact, relationship_confidence, dependency_reason, event_version_applied, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0, ?) ON CONFLICT(event_id, raw_post_id) DO NOTHING`
  ).bind(
    eventId,
    rawPost.id,
    source.id,
    originType,
    originGroup,
    copiedFrom ? 0.9 : originType === "unknown" ? 0.55 : 0.8,
    copiedFrom ? "strong_lexical_copy_relationship" : null,
    timestamp
  );
  const results = incrementEventVersion
    ? await env.DB.batch([
      insert,
      env.DB.prepare("UPDATE event_sources SET event_version_applied = 1 WHERE event_id = ? AND raw_post_id = ? AND event_version_applied = 0").bind(eventId, rawPost.id),
      env.DB.prepare(
        `UPDATE events SET last_updated_at = ?, event_version = event_version + 1, updated_at = ?
          WHERE id = ? AND EXISTS (SELECT 1 FROM event_sources WHERE event_id = ? AND raw_post_id = ? AND event_version_applied = 1)`
      ).bind(timestamp, timestamp, eventId, eventId, rawPost.id),
      env.DB.prepare("UPDATE event_sources SET event_version_applied = 2 WHERE event_id = ? AND raw_post_id = ? AND event_version_applied = 1").bind(eventId, rawPost.id)
    ])
    : await env.DB.batch([
      insert,
      env.DB.prepare("UPDATE event_sources SET event_version_applied = 2 WHERE event_id = ? AND raw_post_id = ? AND event_version_applied = 0").bind(eventId, rawPost.id)
    ]);
  await persistEntities(env, eventId, text);
  return { inserted: Number(results[0]?.meta.changes ?? 0) > 0 };
}

async function persistEntities(env: Env, eventId: number, text: string): Promise<void> {
  for (const entityKey of extractEntityKeys(text)) {
    const timestamp = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO entities(entity_key, display_name, entity_type, created_at, updated_at) VALUES (?, ?, 'keyword', ?, ?)
       ON CONFLICT(entity_key) DO UPDATE SET updated_at = excluded.updated_at`
    ).bind(entityKey, entityKey, timestamp, timestamp).run();
    const entity = await env.DB.prepare("SELECT id FROM entities WHERE entity_key = ?").bind(entityKey).first<{ id: number }>();
    if (entity) await env.DB.prepare("INSERT INTO event_entities(event_id, entity_id) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(eventId, entity.id).run();
  }
}

async function recalculateEvent(env: Env, eventId: number): Promise<void> {
  const evidence = await env.DB.prepare(
    `SELECT s.*, rp.*, es.origin_group, es.origin_type FROM event_sources es
      JOIN sources s ON s.id = es.source_id JOIN raw_posts rp ON rp.id = es.raw_post_id WHERE es.event_id = ?`
  ).bind(eventId).all<SourceRow & RawPostRow & { origin_group: string; origin_type: string }>();
  const event = await getEvent(env.DB, eventId);
  if (!event) throw new Error(`event_not_found:${eventId}`);
  const verification = calculateVerification(event, evidence.results.map((row) => ({ source: row, rawPost: row, originGroup: row.origin_group, originType: row.origin_type })));
  await persistVerification(env.DB, eventId, verification);
}
