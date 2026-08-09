import { runtimeConfig } from "../config";
import { getEvent, getSource, incrementCounter, listRecentRawPosts, upsertRawPost } from "../db";
import { lexicalOverlap, normalizePersianText } from "../normalization";
import type { RawPostJob } from "../queue";
import { combinedSimilarity, extractEntityKeys, inferCategory, semanticEventScore, temporalProximity } from "./similarity";
import { generateEmbedding } from "./ai";
import { calculateVerification, classifyOrigin, originGroupFor, persistVerification } from "./verification";
import { scoreEvent } from "../editorial/scoring";
import type { EditorialCandidate, EventRow, RawPostRow, SourceRow, TelegramWebPollEnvelope } from "../types";

interface SemanticNeighbor {
  rawPostId: number;
  score: number;
}

interface IngestOptions {
  enqueueAnalysis?: boolean;
}

export async function ingestEnvelope(env: Env, envelope: TelegramWebPollEnvelope, options: IngestOptions = {}): Promise<number> {
  const source = await getSource(env.DB, envelope.sourceId);
  if (!source) throw new Error(`unknown_source:${envelope.sourceId}`);
  const rawPost = await upsertRawPost(env.DB, envelope, source.language);
  if (options.enqueueAnalysis !== false) {
    await env.EVENT_ANALYSIS_QUEUE.send({ kind: "raw_post", rawPostId: rawPost.id } satisfies RawPostJob);
  }
  await incrementCounter(env.DB, "raw_posts_persisted");
  return rawPost.id;
}

export async function analyzeRawPost(env: Env, rawPostId: number): Promise<EditorialCandidate | null> {
  const rawPost = await env.DB.prepare("SELECT * FROM raw_posts WHERE id = ?").bind(rawPostId).first<RawPostRow>();
  if (!rawPost) throw new Error(`missing_raw_post:${rawPostId}`);
  const source = await getSource(env.DB, rawPost.source_id);
  if (!source) throw new Error(`missing_source:${rawPost.source_id}`);

  const normalized = normalizePersianText(rawPost.original_text);
  await env.DB.prepare(
    `UPDATE raw_posts SET normalized_text = ?, is_noise = ?, noise_reason = ?, processing_status = ?, updated_at = ? WHERE id = ?`
  ).bind(normalized.normalizedText, normalized.isNoise ? 1 : 0, normalized.noiseReason, normalized.isNoise ? "noise" : "processing", new Date().toISOString(), rawPost.id).run();
  if (normalized.isNoise || rawPost.is_deleted === 1) {
    await incrementCounter(env.DB, "posts_filtered");
    return null;
  }

  const embedding = await generateEmbedding(env, normalized.normalizedText);
  let semanticNeighbors: SemanticNeighbor[] = [];
  if (embedding) {
    try {
      await env.EVENT_INDEX.upsert([{
        id: `raw:${rawPost.id}`,
        values: embedding,
        metadata: { raw_post_id: rawPost.id, source_id: source.id, published_at: rawPost.published_at ?? "" }
      }]);
      semanticNeighbors = await querySemanticNeighbors(env, rawPost.id, embedding);
      await incrementCounter(env.DB, "embeddings_generated");
    } catch (error) {
      console.error(JSON.stringify({ event: "vectorize_operation_failed", raw_post_id: rawPost.id, error: error instanceof Error ? error.message : "unknown" }));
    }
  } else {
    await incrementCounter(env.DB, "embeddings_deferred");
  }

  // Duplicate content remains evidence. Record the relationship, but never return early:
  // an independently published duplicate may be the confirmation that makes an event trustworthy.
  const duplicate = await findNearDuplicate(env.DB, rawPost, normalized.normalizedText, semanticNeighbors);
  if (duplicate) {
    await env.DB.prepare(
      `INSERT INTO raw_post_duplicates(raw_post_id, duplicate_of_raw_post_id, similarity_score, reason_json, created_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(raw_post_id, duplicate_of_raw_post_id) DO NOTHING`
    ).bind(rawPost.id, duplicate.id, duplicate.score, JSON.stringify({ method: duplicate.method }), new Date().toISOString()).run();
    await incrementCounter(env.DB, "duplicates_detected");
  }

  const event = await findOrCreateEvent(env, rawPost, source, normalized.normalizedText, semanticNeighbors);
  await recalculateEvent(env, event.id);
  const refreshed = await getEvent(env.DB, event.id);
  if (!refreshed) throw new Error(`event_missing_after_recalculate:${event.id}`);
  const score = scoreEvent(refreshed);
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
    new Date().toISOString(),
    new Date().toISOString(),
    event.id
  ).run();
  await env.DB.prepare("UPDATE raw_posts SET processing_status = 'analyzed', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), rawPost.id).run();
  await incrementCounter(env.DB, "events_scored");

  if (score.finalScore < 60) return null;
  return {
    eventId: event.id,
    eventVersion: refreshed.event_version,
    decision: "MONITOR",
    score: score.finalScore,
    reasons: score.reasons
  };
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
    const lexical = combinedSimilarity(text, candidate.normalized_text || candidate.original_text, temporalProximity(rawPost.published_at, candidate.published_at));
    const semantic = semanticById.get(candidate.id) ?? 0;
    const score = Math.max(lexical, semanticEventScore(semantic, lexicalOverlap(text, candidate.normalized_text || candidate.original_text), temporalProximity(rawPost.published_at, candidate.published_at)));
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
  const candidates = await env.DB.prepare(
    `SELECT * FROM events WHERE event_state = 'active' AND last_updated_at >= ? ORDER BY last_updated_at DESC LIMIT 100`
  ).bind(new Date(Date.now() - 48 * 3_600_000).toISOString()).all<EventRow>();
  const semanticEventScores = await semanticScoresByEvent(env.DB, semanticNeighbors);
  let best: { event: EventRow; score: number } | null = null;
  for (const candidate of candidates.results) {
    const lexical = combinedSimilarity(text, candidate.core_fact, temporalProximity(rawPost.published_at, candidate.first_seen_at));
    const semantic = semanticEventScores.get(candidate.id) ?? 0;
    const score = Math.max(lexical, semanticEventScore(semantic, lexicalOverlap(text, candidate.core_fact), temporalProximity(rawPost.published_at, candidate.first_seen_at)));
    if (inferCategory(text) !== candidate.category && score < 0.72) continue;
    if (score >= 0.62 && (!best || score > best.score)) best = { event: candidate, score };
  }
  const timestamp = new Date().toISOString();
  if (best) {
    await env.DB.prepare(
      `UPDATE events SET last_updated_at = ?, event_version = event_version + 1, updated_at = ? WHERE id = ?`
    ).bind(timestamp, timestamp, best.event.id).run();
    await attachEventSource(env, best.event.id, rawPost, source, text);
    await incrementCounter(env.DB, "posts_attached_to_events");
    const updated = await getEvent(env.DB, best.event.id);
    if (!updated) throw new Error(`event_update_missing:${best.event.id}`);
    return updated;
  }

  const category = inferCategory(text, source.category);
  const result = await env.DB.prepare(
    `INSERT INTO events(core_fact, category, first_seen_at, last_updated_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(text.slice(0, 800), category, rawPost.published_at ?? timestamp, timestamp, timestamp, timestamp).run();
  const eventId = Number(result.meta.last_row_id);
  await attachEventSource(env, eventId, rawPost, source, text);
  await incrementCounter(env.DB, "events_created");
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

async function attachEventSource(env: Env, eventId: number, rawPost: RawPostRow, source: SourceRow, text: string): Promise<void> {
  const related = await env.DB.prepare(
    `SELECT es.origin_group, rp.normalized_text FROM event_sources es JOIN raw_posts rp ON rp.id = es.raw_post_id
      WHERE es.event_id = ? ORDER BY es.id DESC LIMIT 30`
  ).bind(eventId).all<{ origin_group: string; normalized_text: string }>();
  const copiedFrom = related.results.find((candidate) => lexicalOverlap(text, candidate.normalized_text) >= 0.86);
  const originType = classifyOrigin(source, rawPost);
  const originGroup = originGroupFor(source, rawPost, copiedFrom?.origin_group);
  await env.DB.prepare(
    `INSERT INTO event_sources(event_id, raw_post_id, source_id, origin_type, origin_group, supports_core_fact, relationship_confidence, dependency_reason, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(event_id, raw_post_id) DO NOTHING`
  ).bind(
    eventId,
    rawPost.id,
    source.id,
    originType,
    originGroup,
    copiedFrom ? 0.9 : originType === "unknown" ? 0.55 : 0.8,
    copiedFrom ? "strong_lexical_copy_relationship" : null,
    new Date().toISOString()
  ).run();
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
