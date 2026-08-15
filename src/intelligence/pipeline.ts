import { runtimeConfig } from "../config";
import { sha256Hex } from "../crypto";
import {
  claimIntelligenceReport,
  getEvent,
  getSource,
  incrementCounter,
  markRawPostAnalyzed,
  upsertRawPost
} from "../db";
import { normalizePersianText, lexicalOverlap } from "../normalization";
import type { EditorialBatchJob, IntelligenceBatchJob } from "../queue";
import { generateNebulaJson, NebulaError, type NebulaJsonResult, type NebulaUsage } from "./ai";
import { ANALYSIS_STALE_AFTER_MS, floorFiveMinuteWindow, normalizeLegacyAnalysisStatus } from "./analysis-state";
import {
  ambiguousPostIds,
  isCorrectableIntelligenceValidationError,
  replaceAmbiguousDecisions,
  validateIntelligenceDecisions
} from "./decision";
import { extractEntityKeys, inferCategory } from "./similarity";
import { calculateVerification, classifyOrigin, originGroupFor, persistVerification } from "./verification";
import { scoreEvent } from "../editorial/scoring";
import { intelligenceBatchOutputSchema, scopeIntelligenceBatchJsonSchema } from "../contracts";
import type {
  EditorialCandidate,
  EventRow,
  IntelligenceBatchRow,
  IntelligenceDecision,
  RawPostRow,
  SourceRow,
  TelegramWebPollEnvelope
} from "../types";

interface IngestOptions {
  enqueueAnalysis?: boolean;
}

interface BatchReportRow extends RawPostRow {
  source_name: string;
  source_key: string;
}

interface ActiveEventSummary {
  event_id: number;
  core_fact: string;
  category: string;
  first_seen_at: string;
  last_updated_at: string;
  source_names: string;
  source_count: number;
  independent_confirmation_count: number;
}

interface BatchApplyResult {
  affectedEventIds: number[];
  newEvents: number;
  existingMatches: number;
  duplicates: number;
  uncertain: number;
}

interface DecisionRequestOptions {
  kind?: "primary" | "second_pass" | "correction";
  expectedPostIds?: readonly number[];
  duplicateTargetPostIds?: readonly number[];
  priorDecisions?: IntelligenceDecision[];
  correctionError?: string;
}

interface DecisionRequestResult extends NebulaJsonResult<{ decisions: IntelligenceDecision[] }> {
  suppliedEventIds: number[];
}

interface CorrectionState {
  used: boolean;
}

const INTELLIGENCE_SYSTEM_PROMPT = `You are Radar's Persian-news event intelligence layer.
Several reports may describe the same real-world event with very different wording.
Reason about meaning, not wording. Persian and English reports can describe the same event.
Distinguish different events involving the same person, organization, or place.
Do not merge reports merely because an entity matches. Respect timestamps and supplied evidence.
Never invent facts, post IDs, event IDs, source names, confirmation counts, or relationships.
Use only supplied post_ids and event_id values. Confidence must reflect uncertainty.
Radar, not you, calculates independent source confirmations and verification status.
Return exactly one JSON object with a decisions array and no Markdown.`;

export async function ingestEnvelope(env: Env, envelope: TelegramWebPollEnvelope, options: IngestOptions = {}): Promise<number> {
  const source = await getSource(env.DB, envelope.sourceId);
  if (!source) throw new Error(`unknown_source:${envelope.sourceId}`);
  const rawPost = await upsertRawPost(env.DB, envelope, source.language);
  await normalizeRawPost(env.DB, rawPost);
  await incrementCounter(env.DB, "raw_posts_persisted");
  if (options.enqueueAnalysis === true) await enqueueIntelligenceBatch(env, new Date().toISOString());
  return rawPost.id;
}

/** Queue one durable, bounded batch at a five-minute boundary or when work is overdue. */
export async function enqueueIntelligenceBatch(env: Env, scheduledAt: string, force = false): Promise<number | null> {
  const config = runtimeConfig(env);
  const timestamp = new Date(scheduledAt);
  if (Number.isNaN(timestamp.getTime())) return null;
  const now = timestamp.toISOString();
  const staleWindow = new Date(timestamp.getTime() - 5 * 60 * 1_000).toISOString();
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM raw_posts
      WHERE is_deleted = 0 AND is_noise = 0 AND processing_status = 'pending'`
  ).first<{ count: number }>();
  if ((pending?.count ?? 0) === 0) return null;

  const overdue = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM raw_posts
      WHERE is_deleted = 0 AND is_noise = 0 AND processing_status = 'pending'
        AND COALESCE(created_at, observed_at) <= ?`
  ).bind(staleWindow).first<{ count: number }>();
  const dueByClock = timestamp.getUTCMinutes() % 5 === 0 && timestamp.getUTCSeconds() < 30;
  if (!force && !dueByClock && (overdue?.count ?? 0) === 0) return null;

  const active = await env.DB.prepare(
    "SELECT id FROM intelligence_batches WHERE status IN ('queued', 'processing') ORDER BY id ASC LIMIT 1"
  ).first<{ id: number }>();
  if (active) return active.id;

  const window = floorFiveMinuteWindow(now);
  const sequenceRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(batch_sequence), -1) + 1 AS next_sequence FROM intelligence_batches WHERE window_end = ?"
  ).bind(window.end).first<{ next_sequence: number }>();
  const sequence = sequenceRow?.next_sequence ?? 0;
  const batchKey = `${window.end}:${sequence}`;
  const createdAt = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO intelligence_batches(
       batch_key, window_start, window_end, batch_sequence, status, report_count,
       model_requested, attempts, prompt_tokens, completion_tokens, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'queued', 0, ?, 0, 0, 0, ?, ?)
     ON CONFLICT(batch_key) DO NOTHING`
  ).bind(batchKey, window.start, window.end, sequence, config.nebulaIntelligenceModel, createdAt, createdAt).run();
  const batchId = Number(result.meta.last_row_id ?? 0) || (await env.DB.prepare(
    "SELECT id FROM intelligence_batches WHERE batch_key = ?"
  ).bind(batchKey).first<{ id: number }>())?.id;
  if (!batchId) throw new Error("intelligence_batch_create_failed");

  try {
    await env.EVENT_ANALYSIS_QUEUE.send({ kind: "intelligence_batch", batchId } satisfies IntelligenceBatchJob);
    await safeIncrementCounter(env.DB, "intelligence_batches_queued");
    return batchId;
  } catch (error) {
    await env.DB.prepare(
      "UPDATE intelligence_batches SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'queued'"
    ).bind(error instanceof Error ? error.message.slice(0, 1_000) : "queue_send_failed", new Date().toISOString(), batchId).run();
    throw error;
  }
}

/** Recover stale batch leases and orphaned report leases without deleting evidence. */
export async function recoverStaleIntelligence(env: Env): Promise<boolean> {
  const staleBefore = new Date(Date.now() - ANALYSIS_STALE_AFTER_MS).toISOString();
  const batch = await env.DB.prepare(
    `SELECT * FROM intelligence_batches
      WHERE status = 'processing' AND (lease_at IS NULL OR lease_at < ?)
      ORDER BY COALESCE(lease_at, created_at) ASC, id ASC LIMIT 1`
  ).bind(staleBefore).first<IntelligenceBatchRow>();
  if (batch) {
    const items = await env.DB.prepare(
      "SELECT raw_post_id FROM intelligence_batch_items WHERE batch_id = ? AND item_status = 'claimed'"
    ).bind(batch.id).all<{ raw_post_id: number }>();
    const timestamp = new Date().toISOString();
    const statements = items.results.map((item) => env.DB.prepare(
      `UPDATE raw_posts SET processing_status = 'pending', analysis_lease_at = NULL, updated_at = ?
        WHERE id = ? AND processing_status = 'analyzing'`
    ).bind(timestamp, item.raw_post_id));
    statements.push(env.DB.prepare(
      `UPDATE intelligence_batches SET status = 'queued', lease_at = NULL,
         error = 'stale_batch_lease_released', updated_at = ? WHERE id = ?`
    ).bind(timestamp, batch.id));
    await env.DB.batch(statements);
    await env.EVENT_ANALYSIS_QUEUE.send({ kind: "intelligence_batch", batchId: batch.id } satisfies IntelligenceBatchJob);
    await safeIncrementCounter(env.DB, "intelligence_recovery_jobs_queued");
    return true;
  }

  const queued = await env.DB.prepare(
    `SELECT id FROM intelligence_batches
      WHERE status = 'queued' AND updated_at < ?
      ORDER BY updated_at ASC, id ASC LIMIT 1`
  ).bind(staleBefore).first<{ id: number }>();
  if (queued) {
    await env.EVENT_ANALYSIS_QUEUE.send({ kind: "intelligence_batch", batchId: queued.id } satisfies IntelligenceBatchJob);
    await env.DB.prepare(
      "UPDATE intelligence_batches SET updated_at = ?, error = 'stale_queued_batch_reenqueued' WHERE id = ? AND status = 'queued'"
    ).bind(new Date().toISOString(), queued.id).run();
    await safeIncrementCounter(env.DB, "intelligence_recovery_jobs_queued");
    return true;
  }

  const orphan = await env.DB.prepare(
    `SELECT id FROM raw_posts
      WHERE is_deleted = 0 AND processing_status = 'analyzing'
        AND (analysis_lease_at IS NULL OR analysis_lease_at < ?)
        AND NOT EXISTS (
          SELECT 1 FROM intelligence_batch_items bi
          JOIN intelligence_batches ib ON ib.id = bi.batch_id
          WHERE bi.raw_post_id = raw_posts.id AND ib.status IN ('queued', 'processing')
        )
      ORDER BY COALESCE(analysis_lease_at, updated_at, created_at) ASC, id ASC LIMIT 1`
  ).bind(staleBefore).first<{ id: number }>();
  if (!orphan) return false;
  await env.DB.prepare(
    "UPDATE raw_posts SET processing_status = 'pending', analysis_lease_at = NULL, updated_at = ? WHERE id = ? AND processing_status = 'analyzing'"
  ).bind(new Date().toISOString(), orphan.id).run();
  await safeIncrementCounter(env.DB, "intelligence_recovery_jobs_queued");
  return true;
}

export async function processIntelligenceBatch(env: Env, job: IntelligenceBatchJob): Promise<void> {
  const batch = await getBatch(env.DB, job.batchId);
  if (!batch || batch.status === "completed") return;
  const claimed = await claimBatch(env.DB, batch.id);
  if (!claimed) return;

  const config = runtimeConfig(env);
  const reports = await claimBatchReports(env.DB, batch.id, config);
  if (reports.length === 0) {
    await completeBatch(env.DB, batch.id, null, 0, 0);
    await enqueueIntelligenceBatch(env, new Date().toISOString(), true);
    return;
  }
  await env.DB.prepare("UPDATE intelligence_batches SET report_count = ?, updated_at = ? WHERE id = ?")
    .bind(reports.length, new Date().toISOString(), batch.id).run();

  try {
    const activeEvents = await listActiveEvents(env.DB, config.intelligenceMaxActiveEvents);
    const primary = await requestBatchDecisions(env, reports, activeEvents, "intelligence");
    if (!primary) throw new NebulaError("intelligence_primary_unavailable");
    const correctionState: CorrectionState = { used: false };
    const allReportIds = reports.map((report) => report.id);
    const primaryValidation = await validateDecisionSetWithCorrection(
      env,
      reports,
      activeEvents,
      "intelligence",
      primary.data,
      allReportIds,
      new Set(primary.suppliedEventIds),
      new Set(allReportIds),
      correctionState
    );
    let decisions = primaryValidation.decisions;
    const uncertainIds = ambiguousPostIds(decisions, config.intelligenceAmbiguityThreshold);
    const nebulaUsages: NebulaUsage[] = [primary.usage, ...(primaryValidation.correctionUsage ? [primaryValidation.correctionUsage] : [])];
    let promptTokens = nebulaUsages.reduce((sum, usage) => sum + usage.promptTokens, 0);
    let completionTokens = nebulaUsages.reduce((sum, usage) => sum + usage.completionTokens, 0);

    if (uncertainIds.length > 0) {
      const focusedEvents = activeEvents.filter((event) => decisions.some((decision) => decision.event_id === event.event_id && uncertainIds.some((id) => decision.post_ids.includes(id)))).slice(0, 5);
      const focusedReports = reports.filter((report) => uncertainIds.includes(report.id));
      const second = await requestBatchDecisions(env, focusedReports, focusedEvents, "intelligence_second_pass", {
        kind: "second_pass",
        expectedPostIds: uncertainIds,
        duplicateTargetPostIds: allReportIds,
        priorDecisions: decisions.filter((decision) => decision.post_ids.some((id) => uncertainIds.includes(id)))
      });
      if (!second) throw new NebulaError("intelligence_second_pass_unavailable");
      const secondValidation = await validateDecisionSetWithCorrection(
        env,
        focusedReports,
        focusedEvents,
        "intelligence_second_pass",
        second.data,
        uncertainIds,
        new Set(second.suppliedEventIds),
        new Set(allReportIds),
        correctionState
      );
      decisions = replaceAmbiguousDecisions(decisions, secondValidation.decisions, new Set(uncertainIds));
      nebulaUsages.push(second.usage);
      if (secondValidation.correctionUsage) nebulaUsages.push(secondValidation.correctionUsage);
      promptTokens = nebulaUsages.reduce((sum, usage) => sum + usage.promptTokens, 0);
      completionTokens = nebulaUsages.reduce((sum, usage) => sum + usage.completionTokens, 0);
    }

    const finalValidation = await validateDecisionSetWithCorrection(
      env,
      reports,
      activeEvents,
      "intelligence",
      { decisions },
      allReportIds,
      new Set(activeEvents.map((event) => event.event_id)),
      new Set(allReportIds),
      correctionState
    );
    decisions = finalValidation.decisions;
    if (finalValidation.correctionUsage) {
      nebulaUsages.push(finalValidation.correctionUsage);
      promptTokens += finalValidation.correctionUsage.promptTokens;
      completionTokens += finalValidation.correctionUsage.completionTokens;
    }
    const outcome = await applyBatchDecisions(env, batch.id, reports, decisions);
    await completeBatch(env.DB, batch.id, summarizeNebulaUsage(nebulaUsages), promptTokens, completionTokens);
    await safeIncrementCounter(env.DB, "intelligence_batches");
    await safeIncrementCounter(env.DB, "intelligence_reports_processed", reports.length);
    if (outcome.newEvents > 0) await safeIncrementCounter(env.DB, "intelligence_new_events", outcome.newEvents);
    if (outcome.existingMatches > 0) await safeIncrementCounter(env.DB, "intelligence_existing_matches", outcome.existingMatches);
    if (outcome.duplicates > 0) await safeIncrementCounter(env.DB, "intelligence_duplicates", outcome.duplicates);
    if (outcome.uncertain > 0) await safeIncrementCounter(env.DB, "intelligence_uncertain", outcome.uncertain);
  } catch (error) {
    await releaseBatchReports(env.DB, batch.id, error instanceof Error ? error.message : "intelligence_batch_failed");
    throw error;
  }
  await enqueueIntelligenceBatch(env, new Date().toISOString(), true);
}

async function requestBatchDecisions(
  env: Env,
  reports: BatchReportRow[],
  activeEvents: ActiveEventSummary[],
  stage: "intelligence" | "intelligence_second_pass",
  options: DecisionRequestOptions = {}
): Promise<DecisionRequestResult | null> {
  const config = runtimeConfig(env);
  const expectedPostIds = [...(options.expectedPostIds ?? reports.map((report) => report.id))];
  const duplicateTargetPostIds = [...(options.duplicateTargetPostIds ?? reports.map((report) => report.id))];
  const promptBase = {
    task: "Classify every supplied report exactly once. Group reports that describe the same real-world event.",
    output_rules: {
      actions: ["MATCH_EXISTING_EVENT", "NEW_EVENT", "DUPLICATE", "UPDATE_EXISTING_EVENT", "NOISE", "UNCERTAIN"],
      event_id: "Use only an active event_id supplied below; use null for NEW_EVENT, DUPLICATE, NOISE, or UNCERTAIN.",
      duplicate_of_post_id: "For DUPLICATE, use one supplied post_id as the canonical report.",
      independent_confirmations: "Never return or calculate this field. Radar computes it from origin groups.",
      coverage: "Every report id must appear in exactly one decision. Do not omit or repeat ids."
    },
    prior_decisions: options.priorDecisions && options.priorDecisions.length > 0 ? options.priorDecisions : undefined,
    correction: options.kind === "correction" ? {
      validation_error: options.correctionError,
      instruction: "Correct only the deterministic decision-graph error. Use only supplied report and event IDs. Do not invent facts, IDs, or relationships."
    } : undefined,
    reports: reports.map((report) => ({
      post_id: report.id,
      source_id: report.source_id,
      source_name: report.source_name,
      published_at: report.published_at,
      observed_at: report.observed_at,
      text: (report.normalized_text || report.original_text).slice(0, config.intelligenceMaxReportChars)
    })),
  };
  const eventPayload = activeEvents.slice(0, config.intelligenceMaxActiveEvents).map((event) => ({
    event_id: event.event_id,
    core_fact: event.core_fact.slice(0, 600),
    category: event.category,
    first_seen_at: event.first_seen_at,
    last_updated_at: event.last_updated_at,
    source_names: event.source_names.slice(0, 300),
    source_count: event.source_count,
    existing_confirmation_count_is_context_only: event.independent_confirmation_count
  }));
  let eventLimit = eventPayload.length;
  let prompt = JSON.stringify({ ...promptBase, active_events: eventPayload.slice(0, eventLimit) });
  while (prompt.length + INTELLIGENCE_SYSTEM_PROMPT.length > config.intelligenceMaxPayloadChars && eventLimit > 5) {
    eventLimit = Math.max(5, Math.floor(eventLimit / 2));
    prompt = JSON.stringify({ ...promptBase, active_events: eventPayload.slice(0, eventLimit) });
  }
  if (prompt.length + INTELLIGENCE_SYSTEM_PROMPT.length > config.intelligenceMaxPayloadChars) throw new NebulaError("intelligence_payload_too_large");
  const suppliedEventIds = eventPayload.slice(0, eventLimit).map((event) => event.event_id);
  const result = await generateNebulaJson(
    env,
    stage,
    INTELLIGENCE_SYSTEM_PROMPT,
    prompt,
    intelligenceBatchOutputSchema,
    2_000,
    { responseSchema: scopeIntelligenceBatchJsonSchema(expectedPostIds, suppliedEventIds, duplicateTargetPostIds) }
  );
  if (!result) return null;
  return {
    ...result,
    suppliedEventIds,
    data: {
      decisions: result.data.decisions.map((decision) => ({
        ...decision,
        duplicate_of_post_id: decision.duplicate_of_post_id ?? null
      }))
    }
  };
}

async function validateDecisionSetWithCorrection(
  env: Env,
  reports: BatchReportRow[],
  activeEvents: ActiveEventSummary[],
  stage: "intelligence" | "intelligence_second_pass",
  value: unknown,
  expectedPostIds: number[],
  knownEventIds: ReadonlySet<number>,
  allowedPostIds: ReadonlySet<number>,
  correctionState: CorrectionState
): Promise<{ decisions: IntelligenceDecision[]; correctionUsage?: NebulaUsage }> {
  try {
    return { decisions: validateIntelligenceDecisions(value, expectedPostIds, knownEventIds, allowedPostIds) };
  } catch (error) {
    if (!isCorrectableIntelligenceValidationError(error) || correctionState.used) throw error;
    correctionState.used = true;
    await safeIncrementCounter(env.DB, "nebula_contract_correction_calls");
    let correction: DecisionRequestResult | null = null;
    try {
      correction = await requestBatchDecisions(env, reports, activeEvents, stage, {
        kind: "correction",
        expectedPostIds,
        duplicateTargetPostIds: [...allowedPostIds],
        priorDecisions: isDecisionOutput(value) ? value.decisions : [],
        correctionError: error.message
      });
      if (!correction) throw new NebulaError("intelligence_contract_correction_unavailable");
      const decisions = validateIntelligenceDecisions(correction.data, expectedPostIds, knownEventIds, allowedPostIds);
      await safeIncrementCounter(env.DB, "nebula_contract_correction_successes");
      return { decisions, correctionUsage: correction.usage };
    } catch (correctionError) {
      await safeIncrementCounter(env.DB, "nebula_contract_correction_failures");
      throw correctionError;
    }
  }
}

function isDecisionOutput(value: unknown): value is { decisions: IntelligenceDecision[] } {
  return typeof value === "object" && value !== null && "decisions" in value && Array.isArray(value.decisions);
}

async function claimBatch(db: D1Database, batchId: number): Promise<boolean> {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - ANALYSIS_STALE_AFTER_MS).toISOString();
  const result = await db.prepare(
    `UPDATE intelligence_batches SET status = 'processing', lease_at = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND (status = 'queued' OR (status = 'processing' AND (lease_at IS NULL OR lease_at < ?)))`
  ).bind(now, now, batchId, staleBefore).run();
  return Number(result.meta.changes ?? 0) > 0;
}

async function claimBatchReports(db: D1Database, batchId: number, config: ReturnType<typeof runtimeConfig>): Promise<BatchReportRow[]> {
  const existing = await db.prepare(
    `SELECT raw_post_id FROM intelligence_batch_items WHERE batch_id = ? AND item_status IN ('claimed', 'applied') ORDER BY raw_post_id`
  ).bind(batchId).all<{ raw_post_id: number }>();
  const existingIds = existing.results.map((row) => row.raw_post_id);
  if (existingIds.length > 0) {
    const reports = await loadBatchReports(db, existingIds);
    for (const report of reports) await claimIntelligenceReport(db, report.id, await sha256Hex(report.normalized_text || report.original_text), new Date(Date.now() - ANALYSIS_STALE_AFTER_MS).toISOString());
    return reports;
  }

  const freshBefore = new Date(Date.now() - 15 * 60 * 1_000).toISOString();
  const candidates = await db.prepare(
    `SELECT rp.*, s.name AS source_name, s.source_key
       FROM raw_posts rp JOIN sources s ON s.id = rp.source_id
      WHERE rp.is_deleted = 0 AND rp.is_noise = 0 AND rp.processing_status = 'pending'
      ORDER BY CASE WHEN COALESCE(rp.created_at, rp.observed_at) >= ? THEN 0 ELSE 1 END,
               COALESCE(rp.created_at, rp.observed_at) ASC, rp.id ASC
      LIMIT ?`
  ).bind(freshBefore, Math.max(config.intelligenceMaxReportsPerBatch * 4, 40)).all<BatchReportRow>();
  const reportBudget = Math.max(4_000, config.intelligenceMaxPayloadChars - Math.min(15_000, config.intelligenceMaxActiveEvents * 250));
  const selected: BatchReportRow[] = [];
  let estimated = 0;
  for (const candidate of candidates.results) {
    const reportSize = JSON.stringify({
      post_id: candidate.id,
      source_id: candidate.source_id,
      source_name: candidate.source_name,
      published_at: candidate.published_at,
      observed_at: candidate.observed_at,
      text: (candidate.normalized_text || candidate.original_text).slice(0, config.intelligenceMaxReportChars)
    }).length + 32;
    if (selected.length >= config.intelligenceMaxReportsPerBatch) break;
    if (selected.length > 0 && estimated + reportSize > reportBudget) break;
    selected.push(candidate);
    estimated += reportSize;
  }

  const claimed: BatchReportRow[] = [];
  const staleBefore = new Date(Date.now() - ANALYSIS_STALE_AFTER_MS).toISOString();
  for (const report of selected) {
    const analysisHash = await sha256Hex(report.normalized_text || report.original_text);
    if (!(await claimIntelligenceReport(db, report.id, analysisHash, staleBefore))) continue;
    claimed.push({ ...report, processing_status: "analyzing", analysis_content_hash: analysisHash });
    await db.prepare(
      `INSERT INTO intelligence_batch_items(batch_id, raw_post_id, action, event_id, confidence, item_status, decision_json, created_at)
       VALUES (?, ?, 'UNCERTAIN', NULL, 0, 'claimed', '{}', ?)
       ON CONFLICT(batch_id, raw_post_id) DO NOTHING`
    ).bind(batchId, report.id, new Date().toISOString()).run();
  }
  return claimed;
}

async function loadBatchReports(db: D1Database, ids: number[]): Promise<BatchReportRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const result = await db.prepare(
    `SELECT rp.*, s.name AS source_name, s.source_key
       FROM raw_posts rp JOIN sources s ON s.id = rp.source_id
      WHERE rp.id IN (${placeholders}) ORDER BY rp.id`
  ).bind(...ids).all<BatchReportRow>();
  return result.results;
}

async function listActiveEvents(db: D1Database, limit: number): Promise<ActiveEventSummary[]> {
  const activeSince = new Date(Date.now() - 48 * 60 * 60 * 1_000).toISOString();
  const result = await db.prepare(
    `SELECT e.id AS event_id, e.core_fact, e.category, e.first_seen_at, e.last_updated_at,
            e.source_count, e.independent_confirmation_count, GROUP_CONCAT(DISTINCT s.name) AS source_names
       FROM events e
       LEFT JOIN event_sources es ON es.event_id = e.id
       LEFT JOIN sources s ON s.id = es.source_id
      WHERE e.event_state = 'active' AND e.last_updated_at >= ?
      GROUP BY e.id
      ORDER BY e.last_updated_at DESC LIMIT ?`
  ).bind(activeSince, limit).all<ActiveEventSummary>();
  return result.results;
}

async function getBatch(db: D1Database, batchId: number): Promise<IntelligenceBatchRow | null> {
  return db.prepare("SELECT * FROM intelligence_batches WHERE id = ?").bind(batchId).first<IntelligenceBatchRow>();
}

async function completeBatch(db: D1Database, batchId: number, telemetry: string | null, promptTokens: number, completionTokens: number): Promise<void> {
  const timestamp = new Date().toISOString();
  await db.prepare(
    `UPDATE intelligence_batches SET status = 'completed', provider_used = ?, prompt_tokens = ?, completion_tokens = ?,
       lease_at = NULL, error = NULL, completed_at = ?, updated_at = ? WHERE id = ?`
  ).bind(telemetry, promptTokens, completionTokens, timestamp, timestamp, batchId).run();
}

function summarizeNebulaUsage(usages: NebulaUsage[]): string | null {
  if (usages.length === 0) return null;
  return JSON.stringify({
    requests: usages.map((usage) => ({
      requested_model: usage.requestedModel,
      model: usage.model,
      provider: usage.provider,
      routed_model: usage.routedModel,
      fallback_attempts: usage.fallbackAttempts,
      request_id: usage.requestId,
      status: usage.status,
      latency_ms: usage.latencyMs,
      logical_attempt: usage.logicalAttempt,
      logical_retry: usage.logicalRetry
    }))
  });
}

async function releaseBatchReports(db: D1Database, batchId: number, error: string): Promise<void> {
  const timestamp = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE raw_posts SET processing_status = 'pending', analysis_lease_at = NULL, updated_at = ?
        WHERE id IN (SELECT raw_post_id FROM intelligence_batch_items WHERE batch_id = ?)
          AND processing_status = 'analyzing'`
    ).bind(timestamp, batchId),
    db.prepare(
      "UPDATE intelligence_batches SET status = 'queued', lease_at = NULL, error = ?, updated_at = ? WHERE id = ?"
    ).bind(error.slice(0, 1_000), timestamp, batchId)
  ]);
}

async function applyBatchDecisions(env: Env, batchId: number, reports: BatchReportRow[], decisions: IntelligenceDecision[]): Promise<BatchApplyResult> {
  const reportMap = new Map(reports.map((report) => [report.id, report]));
  const appliedRows = await env.DB.prepare(
    "SELECT raw_post_id FROM intelligence_batch_items WHERE batch_id = ? AND item_status = 'applied'"
  ).bind(batchId).all<{ raw_post_id: number }>();
  const alreadyApplied = new Set(appliedRows.results.map((row) => row.raw_post_id));
  const eventForPost = new Map<number, number>();
  const affectedEventIds = new Set<number>();
  let newEvents = 0;
  let existingMatches = 0;
  let duplicates = 0;
  let uncertain = 0;

  for (const decision of decisions.filter((item) => item.action !== "DUPLICATE")) {
    if (decision.action === "NOISE") {
      for (const postId of decision.post_ids) {
        if (alreadyApplied.has(postId)) continue;
        const report = requireReport(reportMap, postId);
        await markNoise(env.DB, report);
        await recordBatchItem(env.DB, batchId, report.id, decision, null);
      }
      continue;
    }

    const targetResult = decision.action === "MATCH_EXISTING_EVENT" || decision.action === "UPDATE_EXISTING_EVENT"
      ? { event: await requireEvent(env.DB, decision.event_id), created: false }
      : await createEventForDecision(env, decision, reports);
    const target = targetResult.event;
    if (decision.action === "NEW_EVENT") newEvents += targetResult.created ? 1 : 0;
    if (decision.action === "UNCERTAIN") uncertain += 1;
    if (decision.action === "MATCH_EXISTING_EVENT" || decision.action === "UPDATE_EXISTING_EVENT") existingMatches += 1;

    for (const postId of decision.post_ids) {
      if (alreadyApplied.has(postId)) {
        eventForPost.set(postId, target.id);
        affectedEventIds.add(target.id);
        continue;
      }
      const report = requireReport(reportMap, postId);
      const source = await getSource(env.DB, report.source_id);
      if (!source) throw new Error(`missing_source:${report.source_id}`);
      await attachEventSource(env, target.id, report, source, decision.action !== "NEW_EVENT" && decision.action !== "UNCERTAIN");
      await markRawPostAnalyzed(env.DB, report.id, report.analysis_content_hash ?? await sha256Hex(report.normalized_text || report.original_text));
      eventForPost.set(report.id, target.id);
      affectedEventIds.add(target.id);
      await recordBatchItem(env.DB, batchId, report.id, decision, target.id);
    }
    if (decision.action === "UPDATE_EXISTING_EVENT") {
      await updateEventFact(env.DB, target.id, decision.canonical_fact, decision.category);
    }
  }

  for (const decision of decisions.filter((item) => item.action === "DUPLICATE")) {
    const canonical = decision.duplicate_of_post_id;
    if (canonical === null) throw new Error("duplicate_target_missing");
    const eventId = eventForPost.get(canonical) ?? await attachedEventId(env.DB, canonical);
    if (!eventId) throw new Error(`duplicate_target_has_no_event:${canonical}`);
    for (const postId of decision.post_ids) {
      if (alreadyApplied.has(postId)) {
        eventForPost.set(postId, eventId);
        affectedEventIds.add(eventId);
        continue;
      }
      const report = requireReport(reportMap, postId);
      const duplicateInsert = await env.DB.prepare(
        `INSERT INTO raw_post_duplicates(raw_post_id, duplicate_of_raw_post_id, similarity_score, reason_json, created_at)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(raw_post_id, duplicate_of_raw_post_id) DO NOTHING`
      ).bind(report.id, canonical, decision.confidence, JSON.stringify({ method: "nebula_batch" }), new Date().toISOString()).run();
      if (Number(duplicateInsert.meta.changes ?? 0) > 0) duplicates += 1;
      const source = await getSource(env.DB, report.source_id);
      if (!source) throw new Error(`missing_source:${report.source_id}`);
      await attachEventSource(env, eventId, report, source, true);
      await markRawPostAnalyzed(env.DB, report.id, report.analysis_content_hash ?? await sha256Hex(report.normalized_text || report.original_text));
      eventForPost.set(report.id, eventId);
      affectedEventIds.add(eventId);
      await recordBatchItem(env.DB, batchId, report.id, decision, eventId);
    }
  }

  const candidates: EditorialCandidate[] = [];
  for (const eventId of affectedEventIds) {
    await recalculateEvent(env, eventId);
    const refreshed = await getEvent(env.DB, eventId);
    if (!refreshed) throw new Error(`event_missing_after_batch:${eventId}`);
    const score = scoreEvent(refreshed);
    const timestamp = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE events SET importance_score = ?, impact_score = ?, iran_relevance_score = ?, urgency_score = ?, confidence_score = ?,
        novelty_score = ?, geopolitical_score = ?, subscores_json = ?, last_scored_at = ?, updated_at = ? WHERE id = ?`
    ).bind(score.finalScore, score.impact, score.iranRelevance, score.urgency, score.confidence, score.novelty, score.geopoliticalSignificance, JSON.stringify(score), timestamp, timestamp, eventId).run();
    if (score.finalScore >= 60) {
      candidates.push({ eventId, eventVersion: refreshed.event_version, decision: "MONITOR", score: score.finalScore, reasons: score.reasons });
    }
  }
  if (candidates.length > 0) await env.EDITORIAL_QUEUE.send({ kind: "editorial_batch", candidates } satisfies EditorialBatchJob);
  return { affectedEventIds: [...affectedEventIds], newEvents, existingMatches, duplicates, uncertain };
}

async function createEventForDecision(env: Env, decision: IntelligenceDecision, reports: BatchReportRow[]): Promise<{ event: EventRow; created: boolean }> {
  const reportMap = new Map(reports.map((report) => [report.id, report]));
  const firstReport = requireReport(reportMap, decision.post_ids[0]);
  for (const postId of decision.post_ids) {
    const attached = await attachedEventId(env.DB, postId);
    if (attached) {
      const event = await requireEvent(env.DB, attached);
      return { event, created: false };
    }
  }
  const timestamp = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO events(core_fact, category, first_seen_at, last_updated_at, originating_raw_post_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(originating_raw_post_id) DO NOTHING`
  ).bind(
    decision.canonical_fact,
    decision.category || inferCategory(firstReport.normalized_text || firstReport.original_text),
    firstReport.published_at ?? timestamp,
    timestamp,
    firstReport.id,
    timestamp,
    timestamp
  ).run();
  const eventId = Number(result.meta.last_row_id ?? 0) || (await attachedEventId(env.DB, firstReport.id));
  if (!eventId) throw new Error(`event_create_missing:${firstReport.id}`);
  const event = await requireEvent(env.DB, eventId);
  return { event, created: Number(result.meta.changes ?? 0) > 0 };
}

async function attachEventSource(env: Env, eventId: number, rawPost: RawPostRow, source: SourceRow, incrementEventVersion: boolean): Promise<void> {
  const text = rawPost.normalized_text || rawPost.original_text;
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
  ).bind(eventId, rawPost.id, source.id, originType, originGroup, copiedFrom ? 0.9 : originType === "unknown" ? 0.55 : 0.8, copiedFrom ? "strong_lexical_copy_relationship" : null, timestamp);
  if (incrementEventVersion) {
    await env.DB.batch([
      insert,
      env.DB.prepare("UPDATE event_sources SET event_version_applied = 1 WHERE event_id = ? AND raw_post_id = ? AND event_version_applied = 0").bind(eventId, rawPost.id),
      env.DB.prepare(
        `UPDATE events SET last_updated_at = ?, event_version = event_version + 1, updated_at = ?
          WHERE id = ? AND EXISTS (SELECT 1 FROM event_sources WHERE event_id = ? AND raw_post_id = ? AND event_version_applied = 1)`
      ).bind(timestamp, timestamp, eventId, eventId, rawPost.id),
      env.DB.prepare("UPDATE event_sources SET event_version_applied = 2 WHERE event_id = ? AND raw_post_id = ? AND event_version_applied = 1").bind(eventId, rawPost.id)
    ]);
  } else {
    await env.DB.batch([
      insert,
      env.DB.prepare("UPDATE event_sources SET event_version_applied = 2 WHERE event_id = ? AND raw_post_id = ? AND event_version_applied = 0").bind(eventId, rawPost.id)
    ]);
  }
  await persistEntities(env, eventId, text);
}

async function recalculateEvent(env: Env, eventId: number): Promise<void> {
  const evidence = await env.DB.prepare(
    `SELECT s.*, rp.*, es.origin_group, es.origin_type FROM event_sources es
      JOIN sources s ON s.id = es.source_id JOIN raw_posts rp ON rp.id = es.raw_post_id WHERE es.event_id = ?`
  ).bind(eventId).all<SourceRow & RawPostRow & { origin_group: string; origin_type: string }>();
  const event = await requireEvent(env.DB, eventId);
  const verification = calculateVerification(event, evidence.results.map((row) => ({ source: row, rawPost: row, originGroup: row.origin_group, originType: row.origin_type })));
  await persistVerification(env.DB, eventId, verification);
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

async function normalizeRawPost(db: D1Database, rawPost: RawPostRow): Promise<void> {
  const normalized = normalizePersianText(rawPost.original_text);
  const analysisHash = await sha256Hex(normalized.normalizedText);
  const timestamp = new Date().toISOString();
  const alreadyNoise = rawPost.processing_status === "noise" && rawPost.analysis_content_hash === analysisHash;
  const alreadyAnalyzed = rawPost.processing_status === "analyzed" && rawPost.analysis_content_hash === analysisHash;
  const legacyStatus = normalizeLegacyAnalysisStatus(rawPost.processing_status);
  const nextStatus = normalized.isNoise || rawPost.is_deleted === 1
    ? "noise"
    : alreadyNoise ? "noise" : alreadyAnalyzed ? "analyzed" : legacyStatus;
  await db.prepare(
    `UPDATE raw_posts SET normalized_text = ?, is_noise = ?, noise_reason = ?, processing_status = ?,
       analysis_content_hash = CASE WHEN ? IN ('noise', 'analyzed') THEN ? ELSE analysis_content_hash END,
       analysis_lease_at = CASE WHEN ? IN ('noise', 'analyzed') THEN NULL ELSE analysis_lease_at END,
       updated_at = ? WHERE id = ?`
  ).bind(normalized.normalizedText, normalized.isNoise || rawPost.is_deleted === 1 ? 1 : 0, normalized.noiseReason, nextStatus, nextStatus, analysisHash, nextStatus, timestamp, rawPost.id).run();
  if ((normalized.isNoise || rawPost.is_deleted === 1) && rawPost.processing_status !== "noise") await safeIncrementCounter(db, "posts_filtered");
}

async function markNoise(db: D1Database, report: BatchReportRow): Promise<void> {
  await db.prepare(
    `UPDATE raw_posts SET processing_status = 'noise', is_noise = 1, noise_reason = 'llm_noise',
       analysis_content_hash = ?, analysis_lease_at = NULL, updated_at = ? WHERE id = ?`
  ).bind(report.analysis_content_hash ?? await sha256Hex(report.normalized_text || report.original_text), new Date().toISOString(), report.id).run();
}

async function updateEventFact(db: D1Database, eventId: number, canonicalFact: string, category: string): Promise<void> {
  await db.prepare("UPDATE events SET core_fact = ?, category = ?, updated_at = ? WHERE id = ?")
    .bind(canonicalFact, category, new Date().toISOString(), eventId).run();
}

async function recordBatchItem(db: D1Database, batchId: number, rawPostId: number, decision: IntelligenceDecision, eventId: number | null): Promise<void> {
  await db.prepare(
    `INSERT INTO intelligence_batch_items(batch_id, raw_post_id, action, event_id, duplicate_of_post_id, confidence, item_status, decision_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'applied', ?, ?)
     ON CONFLICT(batch_id, raw_post_id) DO UPDATE SET action = excluded.action, event_id = excluded.event_id,
       duplicate_of_post_id = excluded.duplicate_of_post_id, confidence = excluded.confidence,
       item_status = 'applied', decision_json = excluded.decision_json`
  ).bind(batchId, rawPostId, decision.action, eventId, decision.duplicate_of_post_id, decision.confidence, JSON.stringify(decision), new Date().toISOString()).run();
}

async function attachedEventId(db: D1Database, rawPostId: number): Promise<number | null> {
  const row = await db.prepare("SELECT event_id FROM event_sources WHERE raw_post_id = ? ORDER BY id DESC LIMIT 1")
    .bind(rawPostId).first<{ event_id: number }>();
  return row?.event_id ?? null;
}

async function requireEvent(db: D1Database, eventId: number | null): Promise<EventRow> {
  if (eventId === null) throw new Error("event_id_required");
  const event = await getEvent(db, eventId);
  if (!event) throw new Error(`unknown_event_id:${eventId}`);
  return event;
}

function requireReport(reports: Map<number, BatchReportRow>, postId: number): BatchReportRow {
  const report = reports.get(postId);
  if (!report) throw new Error(`unknown_batch_post_id:${postId}`);
  return report;
}

async function safeIncrementCounter(db: D1Database, metric: string, amount = 1): Promise<void> {
  try {
    await incrementCounter(db, metric, amount);
  } catch (error) {
    console.warn(JSON.stringify({ event: "counter_increment_skipped", metric, error: error instanceof Error ? error.message : "unknown" }));
  }
}
