import { assertCurrentWindowConfiguration, runtimeConfig, V8_CURRENT_WINDOW_MODEL } from "../config";
import { sha256Hex } from "../crypto";
import {
  claimIntelligenceReport,
  getEvent,
  getEventByOriginatingRawPostId,
  getSource,
  incrementCounter,
  markRawPostAnalyzed,
  upsertRawPost
} from "../db";
import { normalizePersianText, lexicalOverlap } from "../normalization";
import type { EditorialBatchJob, IntelligenceBatchJob } from "../queue";
import { generateNebulaJson, NebulaError, type NebulaJsonResult, type NebulaUsage } from "./ai";
import { ANALYSIS_STALE_AFTER_MS, floorFiveMinuteWindow, normalizeLegacyAnalysisStatus } from "./analysis-state";
import { validateIntelligenceDecisions } from "./decision";
import {
  acceptsCurrentWindowPair,
  buildFailClosedSingletonProposal,
  currentWindowPairJsonSchema,
  currentWindowPairOutputSchema,
  currentWindowProposalJsonSchema,
  currentWindowProposalOutputSchema,
  reconstructCurrentWindowClusters,
  validateCurrentWindowPair,
  validateCurrentWindowProposal,
  type CurrentWindowContractFailureClass,
  CurrentWindowValidationError,
  type CurrentWindowPair,
  type CurrentWindowPairCheck,
  type CurrentWindowProposal,
  type ReconstructedCurrentWindowCluster
} from "./current-window";
import { extractEntityKeys, inferCategory } from "./similarity";
import { findCurrentWindowHardContradictions } from "./hard-contradictions";
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

export interface CurrentWindowReportInput {
  id: number;
  source_id: number;
  source_name: string;
  source_key: string;
  published_at: string | null;
  observed_at: string;
  original_text: string;
  normalized_text: string;
}

interface BatchApplyResult {
  affectedEventIds: number[];
  newEvents: number;
  existingMatches: number;
  duplicates: number;
  uncertain: number;
}

export interface CurrentWindowProposalRequestResult extends NebulaJsonResult<CurrentWindowProposal> {}

interface CurrentPairRequestResult extends NebulaJsonResult<CurrentWindowPair> {}

export type CurrentWindowProcessingMode = "AI_CLUSTERING" | "FAIL_CLOSED_SINGLETON_FALLBACK";

export interface CurrentWindowProposalDiagnostic {
  failure_class: CurrentWindowContractFailureClass;
  offending_post_ids: number[];
  detail: string;
  parsed_proposal: string | null;
}

export interface CurrentWindowTelemetry {
  batch_id: number | null;
  batch_attempt: number | null;
  reports_considered: number;
  reports_sent_to_proposal: number;
  proposal_clusters: number;
  proposal_singletons: number;
  proposal_retries: number;
  pair_verification_calls: number;
  pair_verification_retries: number;
  pair_verification_failures: number;
  pair_budget_failures: number;
  budget_failures: number;
  raw_same_event_edges: number;
  accepted_same_event_edges: number;
  hard_contradiction_vetoes: number;
  rejected_edges: number;
  final_multi_report_clusters: number;
  final_singletons: number;
  proposal_latency_ms: number;
  ai_latency_ms: number;
  request_latencies_ms: number[];
  prompt_tokens: number;
  completion_tokens: number;
  physical_attempts: number;
  http_200: number;
  http_429: number;
  http_502: number;
  http_503: number;
  http_504: number;
  other_5xx: number;
  transport_failures: number;
  retry_recoveries: number;
  contract_failures: number;
  model_failures: number;
  processing_mode: CurrentWindowProcessingMode;
  contract_failure_class: CurrentWindowContractFailureClass | null;
  contract_failure_post_ids: number[];
  contract_failure_detail: string | null;
  recovery_attempted: boolean;
  correction_attempts: number;
  correction_recovered: boolean;
  fallback_reason: string | null;
  invalid_proposal_diagnostics: CurrentWindowProposalDiagnostic[];
  historical_semantic_links_attempted: 0;
}

export interface CurrentWindowShadowResult {
  proposal: CurrentWindowProposal;
  pairChecks: CurrentWindowPairCheck[];
  finalClusters: ReconstructedCurrentWindowCluster[];
  telemetry: CurrentWindowTelemetry;
}

export interface CurrentWindowProposalResolution {
  proposal: CurrentWindowProposal;
  usedSingletonFallback: boolean;
}

const CURRENT_WINDOW_PROPOSAL_SYSTEM_PROMPT = `You are Radar's current-window event clustering layer.
Group only reports supplied in this request when they describe the same concrete real-world occurrence.
This request contains no historical events. Do not perform historical event matching.
Do not merge reports merely because they share a person, organization, country, city, conflict, sport, topic, or category.
Different wording, language, source, detail level, or slight publication-time differences can still describe one occurrence.
First identify clusters, then classify each cluster as EVENT, NOISE, or UNCERTAIN.
Every supplied post_id must occur exactly once. Return JSON only and never invent IDs or facts.`;

const CURRENT_WINDOW_PAIR_SYSTEM_PROMPT = `You are Radar's conservative current-window pair verifier.
Determine whether exactly these two supplied reports describe the SAME concrete real-world occurrence.
SAME_EVENT requires the same specific occurrence, announcement, incident, decision, attack, accident, restriction, forecast, publication, match, transaction, or other concrete event.
Shared people, organizations, countries, cities, conflicts, companies, sports, political themes, categories, or keywords are insufficient.
If the reports contain incompatible specific locations for one occurrence, return DIFFERENT_EVENT. Parent and child locations can be compatible when one is inside the other.
When uncertain, return UNCERTAIN. False SAME_EVENT is more harmful than false DIFFERENT_EVENT.
Return JSON only with relationship and confidence.`;

const CURRENT_WINDOW_CHAT_TEMPLATE_KWARGS = { enable_thinking: false };
const CURRENT_WINDOW_PAIR_CONCURRENCY = 2;

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
  if (!batch || isTerminalIntelligenceBatchStatus(batch.status)) return;
  const claimed = await claimBatch(env.DB, batch.id);
  if (!claimed) return;

  const config = runtimeConfig(env);
  const reports = await claimBatchReports(env.DB, batch.id, config);
  const telemetry = createCurrentWindowTelemetry(reports.length);
  telemetry.batch_id = batch.id;
  telemetry.batch_attempt = batch.attempts + 1;
  if (reports.length === 0) {
    await completeBatch(env.DB, batch.id, summarizeCurrentWindowTelemetry(telemetry), 0, 0);
    await enqueueIntelligenceBatch(env, new Date().toISOString(), true);
    return;
  }
  await env.DB.prepare("UPDATE intelligence_batches SET report_count = ?, updated_at = ? WHERE id = ?")
    .bind(reports.length, new Date().toISOString(), batch.id).run();

  try {
    const allReportIds = reports.map((report) => report.id);
    const shadow = await runCurrentWindowShadow(env, reports, telemetry);
    const decisions = buildCurrentWindowDecisions(shadow.finalClusters, reports);
    const validatedDecisions = validateIntelligenceDecisions(
      { decisions },
      allReportIds,
      new Set(),
      new Set(allReportIds)
    );
    const outcome = await applyBatchDecisions(env, batch.id, reports, validatedDecisions);
    await completeBatch(env.DB, batch.id, summarizeCurrentWindowTelemetry(telemetry), telemetry.prompt_tokens, telemetry.completion_tokens);
    await safeIncrementCounter(env.DB, "intelligence_batches");
    await safeIncrementCounter(env.DB, "intelligence_reports_processed", reports.length);
    if (outcome.newEvents > 0) await safeIncrementCounter(env.DB, "intelligence_new_events", outcome.newEvents);
    if (outcome.existingMatches > 0) await safeIncrementCounter(env.DB, "intelligence_existing_matches", outcome.existingMatches);
    if (outcome.duplicates > 0) await safeIncrementCounter(env.DB, "intelligence_duplicates", outcome.duplicates);
    if (outcome.uncertain > 0) await safeIncrementCounter(env.DB, "intelligence_uncertain", outcome.uncertain);
  } catch (error) {
    if (error instanceof CurrentWindowValidationError || (error instanceof NebulaError && (error.message.includes("schema") || error.message.includes("response_not_json")))) telemetry.contract_failures += 1;
    else if (error instanceof NebulaError && error.message !== "historical_semantic_linking_unsupported") telemetry.model_failures += 1;
    if (error instanceof NebulaError && error.message === "historical_semantic_linking_unsupported") {
      console.error(JSON.stringify({ event: "v8_historical_semantic_linking_unsupported", historical_semantic_links_attempted: 0 }));
    }
    await persistCurrentWindowTelemetry(env.DB, batch.id, telemetry);
    await releaseBatchReports(env.DB, batch.id, error instanceof Error ? error.message : "intelligence_batch_failed");
    throw error;
  }
  await enqueueIntelligenceBatch(env, new Date().toISOString(), true);
}

export function isTerminalIntelligenceBatchStatus(status: IntelligenceBatchRow["status"]): boolean {
  return status === "completed" || status === "failed";
}

export async function runCurrentWindowShadow(
  env: Env,
  reports: readonly CurrentWindowReportInput[],
  telemetry = createCurrentWindowTelemetry(reports.length)
): Promise<CurrentWindowShadowResult> {
  const config = runtimeConfig(env);
  try {
    assertCurrentWindowConfiguration(config);
  } catch (error) {
    throw new NebulaError(error instanceof Error ? error.message : "v8_current_window_configuration_invalid");
  }

  const proposalResolution = await resolveCurrentWindowProposal(
    reports.map((report) => report.id),
    telemetry,
    () => requestCurrentWindowProposal(env, reports),
    (invalidProposal, validationError) => requestCurrentWindowProposalCorrection(env, reports, invalidProposal, validationError)
  );
  const proposal = proposalResolution.proposal;
  telemetry.proposal_clusters = proposalResolution.usedSingletonFallback ? 0 : proposal.clusters.length;
  telemetry.proposal_singletons = proposalResolution.usedSingletonFallback
    ? 0
    : proposal.clusters.filter((cluster) => cluster.post_ids.length === 1).length;

  const pairWork: Array<{ leftPostId: number; rightPostId: number }> = [];
  for (const cluster of proposal.clusters) {
    if (cluster.classification !== "EVENT" || cluster.post_ids.length < 2) continue;
    for (const [leftPostId, rightPostId] of allPairs(cluster.post_ids)) {
      pairWork.push({ leftPostId, rightPostId });
    }
  }

  telemetry.pair_verification_calls += pairWork.length;
  const reportById = new Map(reports.map((report) => [report.id, report]));
  const pairChecks = await mapWithConcurrency(pairWork, CURRENT_WINDOW_PAIR_CONCURRENCY, async ({ leftPostId, rightPostId }) => {
    const pairResult = await requestCurrentWindowPair(env, reports, leftPostId, rightPostId, telemetry);
    const modelPair = pairResult?.data ?? null;
    const modelAccepted = acceptsCurrentWindowPair(modelPair);
    if (modelAccepted) telemetry.raw_same_event_edges += 1;
    const left = reportById.get(leftPostId);
    const right = reportById.get(rightPostId);
    const hardContradictions = modelAccepted && left && right
      ? findCurrentWindowHardContradictions(left, right)
      : [];
    return { leftPostId, rightPostId, result: modelPair, hardContradictions } satisfies CurrentWindowPairCheck;
  });

  for (const { leftPostId, rightPostId, result: modelPair, hardContradictions } of pairChecks) {
    if (hardContradictions.length > 0) {
      telemetry.hard_contradiction_vetoes += 1;
      telemetry.rejected_edges += 1;
      console.warn(JSON.stringify({
        event: "v8_current_window_pair_hard_contradiction_veto",
        left_post_id: leftPostId,
        right_post_id: rightPostId,
        reasons: hardContradictions,
        historical_semantic_links_attempted: 0
      }));
    } else if (acceptsCurrentWindowPair(modelPair)) telemetry.accepted_same_event_edges += 1;
    else telemetry.rejected_edges += 1;
  }

  const finalClusters = reconstructCurrentWindowClusters(proposal, pairChecks);
  telemetry.final_multi_report_clusters = finalClusters.filter((cluster) => cluster.postIds.length > 1).length;
  telemetry.final_singletons = finalClusters.filter((cluster) => cluster.postIds.length === 1).length;
  return { proposal, pairChecks, finalClusters, telemetry };
}

export async function resolveCurrentWindowProposal(
  expectedPostIds: readonly number[],
  telemetry: CurrentWindowTelemetry,
  requestProposal: () => Promise<CurrentWindowProposalRequestResult | null>,
  requestCorrection: (
    invalidProposal: CurrentWindowProposal,
    validationError: CurrentWindowValidationError
  ) => Promise<CurrentWindowProposalRequestResult | null>
): Promise<CurrentWindowProposalResolution> {
  let initialResult: CurrentWindowProposalRequestResult | null;
  try {
    initialResult = await requestProposal();
    if (!initialResult) throw new NebulaError("v8_current_window_proposal_unavailable");
    recordNebulaUsage(telemetry, initialResult.usage, false);
    telemetry.proposal_latency_ms += initialResult.usage.latencyMs;
  } catch (error) {
    recordNebulaFailureTelemetry(telemetry, error, false);
    if (isCurrentWindowProposalContractFailure(error)) {
      recordCurrentWindowContractFailure(telemetry, error, null);
      return singletonFallback(expectedPostIds, telemetry, error instanceof Error ? error.message : "proposal_contract_failure");
    }
    if (error instanceof NebulaError && error.message === "nebula_daily_budget_exhausted") telemetry.budget_failures += 1;
    throw error;
  }

  if (!initialResult) throw new NebulaError("v8_current_window_proposal_unavailable");

  try {
    return {
      proposal: validateCurrentWindowProposal(initialResult.data, expectedPostIds),
      usedSingletonFallback: false
    };
  } catch (error) {
    if (!(error instanceof CurrentWindowValidationError)) throw error;

    recordCurrentWindowContractFailure(telemetry, error, initialResult.data);
    telemetry.recovery_attempted = true;
    telemetry.correction_attempts += 1;

    let correctionResult: CurrentWindowProposalRequestResult | null = null;
    try {
      correctionResult = await requestCorrection(initialResult.data, error);
      if (!correctionResult) throw new NebulaError("v8_current_window_correction_unavailable");
      recordNebulaUsage(telemetry, correctionResult.usage, false);
      telemetry.proposal_latency_ms += correctionResult.usage.latencyMs;
      const correctedProposal = validateCurrentWindowProposal(correctionResult.data, expectedPostIds);
      telemetry.correction_recovered = true;
      return { proposal: correctedProposal, usedSingletonFallback: false };
    } catch (correctionError) {
      if (correctionError instanceof CurrentWindowValidationError || isCurrentWindowProposalContractFailure(correctionError)) {
        recordCurrentWindowContractFailure(telemetry, correctionError, correctionResult?.data ?? null);
      } else {
        recordNebulaFailureTelemetry(telemetry, correctionError, false);
        if (correctionError instanceof NebulaError && correctionError.message === "nebula_daily_budget_exhausted") telemetry.budget_failures += 1;
        if (!(correctionError instanceof NebulaError) || correctionError.message !== "historical_semantic_linking_unsupported") telemetry.model_failures += 1;
      }
      return singletonFallback(expectedPostIds, telemetry, correctionError instanceof Error ? correctionError.message : "correction_failed");
    }
  }
}

async function requestCurrentWindowProposal(env: Env, reports: readonly CurrentWindowReportInput[]): Promise<CurrentWindowProposalRequestResult | null> {
  const config = runtimeConfig(env);
  const reportPayload = reports.map((report) => ({
    post_id: report.id,
    source_id: report.source_id,
    source_name: report.source_name,
    published_at: report.published_at,
    observed_at: report.observed_at,
    text: (report.normalized_text || report.original_text).slice(0, config.intelligenceMaxReportChars)
  }));
  const prompt = JSON.stringify({
    task: "Cluster every supplied current report exactly once.",
    reports: reportPayload,
    rules: [
      "Group reports only when they describe the same concrete current occurrence.",
      "Do not group reports merely because they share a topic, person, country, organization, category, or geopolitical theme.",
      "First identify clusters, then assign one classification per cluster.",
      "Use EVENT for a concrete event, NOISE for deterministic noise, and UNCERTAIN when safe grouping is not established.",
      "Every supplied post_id must occur exactly once.",
      "No historical events or historical IDs are provided or allowed."
    ],
    output_schema: { clusters: "[{post_ids, classification, confidence}]" }
  });
  if (prompt.length + CURRENT_WINDOW_PROPOSAL_SYSTEM_PROMPT.length > config.intelligenceMaxPayloadChars) throw new NebulaError("v8_current_window_payload_too_large");
  const result = await generateNebulaJson(
    env,
    "intelligence_proposal",
    CURRENT_WINDOW_PROPOSAL_SYSTEM_PROMPT,
    prompt,
    currentWindowProposalOutputSchema,
    2_000,
    {
      responseSchema: currentWindowProposalJsonSchema(reports.map((report) => report.id)),
      responseSchemaName: "radar_current_window_clusters",
      chatTemplateKwargs: CURRENT_WINDOW_CHAT_TEMPLATE_KWARGS,
      completionParameter: "max_completion_tokens"
    }
  );
  return result;
}

async function requestCurrentWindowProposalCorrection(
  env: Env,
  reports: readonly CurrentWindowReportInput[],
  invalidProposal: CurrentWindowProposal,
  validationError: CurrentWindowValidationError
): Promise<CurrentWindowProposalRequestResult | null> {
  const config = runtimeConfig(env);
  const allowedPostIds = reports.map((report) => report.id);
  const prompt = JSON.stringify({
    task: "Correct only the invalid current-window partition.",
    input_post_ids: allowedPostIds,
    invalid_partition: invalidProposal,
    validator_error: {
      failure_class: validationError.failureClass,
      detail: validationError.message,
      offending_post_ids: validationError.offendingPostIds
    },
    rules: [
      "Return only a corrected partition.",
      "Every supplied post_id must occur exactly once.",
      "Do not invent, omit, or duplicate post_ids.",
      "Do not change report contents or add facts.",
      "No historical events or historical IDs are allowed."
    ],
    output_schema: { clusters: "[{post_ids, classification, confidence}]" }
  });
  const systemPrompt = `You are Radar's strict current-window partition correction layer.
The previous partition was rejected by a deterministic validator.
Repair the partition contract only. Do not reinterpret the reports or add semantic merges.
Every supplied post_id must occur exactly once. Return JSON only.`;
  if (prompt.length + systemPrompt.length > config.intelligenceMaxPayloadChars) throw new NebulaError("v8_current_window_correction_payload_too_large");
  return generateNebulaJson(
    env,
    "intelligence_proposal",
    systemPrompt,
    prompt,
    currentWindowProposalOutputSchema,
    2_000,
    {
      responseSchema: currentWindowProposalJsonSchema(allowedPostIds),
      responseSchemaName: "radar_current_window_clusters_correction",
      chatTemplateKwargs: CURRENT_WINDOW_CHAT_TEMPLATE_KWARGS,
      completionParameter: "max_completion_tokens"
    }
  );
}

async function requestCurrentWindowPair(
  env: Env,
  reports: readonly CurrentWindowReportInput[],
  leftPostId: number,
  rightPostId: number,
  telemetry: CurrentWindowTelemetry
): Promise<CurrentPairRequestResult | null> {
  const config = runtimeConfig(env);
  const reportById = new Map(reports.map((report) => [report.id, report]));
  const left = reportById.get(leftPostId);
  const right = reportById.get(rightPostId);
  if (!left || !right) {
    telemetry.pair_verification_failures += 1;
    telemetry.rejected_edges += 1;
    return null;
  }
  const prompt = JSON.stringify({
    task: "Verify exactly this proposed pair and no other reports.",
    reports: [left, right].map((report) => ({
      post_id: report.id,
      source_id: report.source_id,
      source_name: report.source_name,
      published_at: report.published_at,
      observed_at: report.observed_at,
      text: (report.normalized_text || report.original_text).slice(0, config.intelligenceMaxReportChars)
    })),
    rules: [
      "Return SAME_EVENT only for the same concrete real-world occurrence.",
      "Shared topics, entities, organizations, places, or categories are insufficient.",
      "Incompatible specific locations reject SAME_EVENT; parent and child locations can be compatible when one is inside the other.",
      "Return DIFFERENT_EVENT for distinct occurrences and UNCERTAIN when evidence is insufficient.",
      "Return exactly relationship and confidence."
    ]
  });
  try {
    const result = await generateNebulaJson(
      env,
      "intelligence_pair",
      CURRENT_WINDOW_PAIR_SYSTEM_PROMPT,
      prompt,
      currentWindowPairOutputSchema,
      150,
      {
        responseSchema: currentWindowPairJsonSchema,
        responseSchemaName: "radar_current_window_pair",
        chatTemplateKwargs: CURRENT_WINDOW_CHAT_TEMPLATE_KWARGS,
        completionParameter: "max_completion_tokens"
      }
    );
    if (!result) {
      telemetry.pair_verification_failures += 1;
      telemetry.model_failures += 1;
      return null;
    }
    recordNebulaUsage(telemetry, result.usage, true);
    return { ...result, data: validateCurrentWindowPair(result.data) };
  } catch (error) {
    telemetry.pair_verification_failures += 1;
    recordNebulaFailureTelemetry(telemetry, error, true);
    if (error instanceof CurrentWindowValidationError || (error instanceof NebulaError && (error.message.includes("schema") || error.message.includes("response_not_json")))) telemetry.contract_failures += 1;
    else telemetry.model_failures += 1;
    if (error instanceof NebulaError && error.message === "nebula_daily_budget_exhausted") {
      telemetry.pair_budget_failures += 1;
      telemetry.budget_failures += 1;
    }
    console.warn(JSON.stringify({
      event: "v8_current_window_pair_failed_closed",
      left_post_id: leftPostId,
      right_post_id: rightPostId,
      error: error instanceof Error ? error.message.slice(0, 240) : "unknown",
      historical_semantic_links_attempted: 0
    }));
    return null;
  }
}

function allPairs(postIds: readonly number[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let left = 0; left < postIds.length; left += 1) {
    for (let right = left + 1; right < postIds.length; right += 1) pairs.push([postIds[left], postIds[right]]);
  }
  return pairs;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function buildCurrentWindowDecisions(clusters: readonly ReconstructedCurrentWindowCluster[], reports: readonly BatchReportRow[]): IntelligenceDecision[] {
  const reportById = new Map(reports.map((report) => [report.id, report]));
  return clusters.map((cluster) => {
    const firstReport = reportById.get(cluster.postIds[0]);
    const text = firstReport?.normalized_text || firstReport?.original_text || "Current-window report";
    const category = inferCategory(text) as IntelligenceDecision["category"];
    const action: IntelligenceDecision["action"] = cluster.classification === "NOISE"
      ? "NOISE"
      : cluster.classification === "UNCERTAIN" ? "UNCERTAIN" : "NEW_EVENT";
    return {
      post_ids: cluster.postIds,
      action,
      event_id: null,
      duplicate_of_post_id: null,
      confidence: cluster.confidence,
      canonical_fact: text.slice(0, 800) || "Current-window event",
      category,
      reason: cluster.classification === "EVENT"
        ? `v8_current_window_anchor_cluster:${cluster.anchorPostId ?? "singleton"}`
        : `v8_current_window_${cluster.classification.toLowerCase()}`
    };
  });
}

export function createCurrentWindowTelemetry(reportsConsidered: number): CurrentWindowTelemetry {
  return {
    batch_id: null,
    batch_attempt: null,
    reports_considered: reportsConsidered,
    reports_sent_to_proposal: reportsConsidered,
    proposal_clusters: 0,
    proposal_singletons: 0,
    proposal_retries: 0,
    pair_verification_calls: 0,
    pair_verification_retries: 0,
    pair_verification_failures: 0,
    pair_budget_failures: 0,
    budget_failures: 0,
    raw_same_event_edges: 0,
    accepted_same_event_edges: 0,
    hard_contradiction_vetoes: 0,
    rejected_edges: 0,
    final_multi_report_clusters: 0,
    final_singletons: 0,
    proposal_latency_ms: 0,
    ai_latency_ms: 0,
    request_latencies_ms: [],
    prompt_tokens: 0,
    completion_tokens: 0,
    physical_attempts: 0,
    http_200: 0,
    http_429: 0,
    http_502: 0,
    http_503: 0,
    http_504: 0,
    other_5xx: 0,
    transport_failures: 0,
    retry_recoveries: 0,
    contract_failures: 0,
    model_failures: 0,
    processing_mode: "AI_CLUSTERING",
    contract_failure_class: null,
    contract_failure_post_ids: [],
    contract_failure_detail: null,
    recovery_attempted: false,
    correction_attempts: 0,
    correction_recovered: false,
    fallback_reason: null,
    invalid_proposal_diagnostics: [],
    historical_semantic_links_attempted: 0
  };
}

function singletonFallback(
  expectedPostIds: readonly number[],
  telemetry: CurrentWindowTelemetry,
  reason: string
): CurrentWindowProposalResolution {
  telemetry.processing_mode = "FAIL_CLOSED_SINGLETON_FALLBACK";
  telemetry.fallback_reason = reason.slice(0, 240);
  telemetry.final_multi_report_clusters = 0;
  telemetry.final_singletons = expectedPostIds.length;
  return {
    proposal: buildFailClosedSingletonProposal(expectedPostIds),
    usedSingletonFallback: true
  };
}

function isCurrentWindowProposalContractFailure(error: unknown): boolean {
  return error instanceof CurrentWindowValidationError
    || (error instanceof NebulaError && (error.message.includes("schema") || error.message.includes("response_not_json")));
}

function recordCurrentWindowContractFailure(
  telemetry: CurrentWindowTelemetry,
  error: unknown,
  proposal: CurrentWindowProposal | null
): void {
  telemetry.contract_failures += 1;
  const failureClass: CurrentWindowContractFailureClass = error instanceof CurrentWindowValidationError
    ? error.failureClass
    : "CURRENT_WINDOW_SCHEMA_FAILURE";
  const offendingPostIds = error instanceof CurrentWindowValidationError ? error.offendingPostIds : [];
  const detail = error instanceof Error ? error.message.slice(0, 500) : "current_window_contract_failure";
  if (!telemetry.contract_failure_class) telemetry.contract_failure_class = failureClass;
  telemetry.contract_failure_post_ids = [...new Set([...telemetry.contract_failure_post_ids, ...offendingPostIds])].sort((left, right) => left - right);
  telemetry.contract_failure_detail ??= detail;
  telemetry.invalid_proposal_diagnostics = [
    ...telemetry.invalid_proposal_diagnostics,
    {
      failure_class: failureClass,
      offending_post_ids: [...offendingPostIds],
      detail,
      parsed_proposal: proposal ? boundedProposal(proposal) : null
    }
  ].slice(-2);
}

function boundedProposal(proposal: CurrentWindowProposal): string | null {
  try {
    return JSON.stringify(proposal).slice(0, 4_000);
  } catch {
    return null;
  }
}

function recordNebulaUsage(telemetry: CurrentWindowTelemetry, usage: NebulaUsage, isPairVerification: boolean): void {
  telemetry.ai_latency_ms += usage.latencyMs;
  telemetry.request_latencies_ms.push(usage.latencyMs);
  telemetry.prompt_tokens += usage.promptTokens;
  telemetry.completion_tokens += usage.completionTokens;
  recordNebulaStatuses(telemetry, usage.attemptStatuses);
  if (usage.logicalRetry) {
    if (isPairVerification) telemetry.pair_verification_retries += 1;
    else telemetry.proposal_retries += 1;
    telemetry.retry_recoveries += 1;
  }
}

function recordNebulaFailureTelemetry(telemetry: CurrentWindowTelemetry, error: unknown, isPairVerification: boolean): void {
  if (!(error instanceof NebulaError) || !error.telemetry) return;
  telemetry.ai_latency_ms += error.telemetry.latencyMs;
  telemetry.request_latencies_ms.push(error.telemetry.latencyMs);
  recordNebulaStatuses(telemetry, error.telemetry.attemptStatuses);
  const retries = Math.max(0, error.telemetry.logicalAttempt - 1);
  if (isPairVerification) telemetry.pair_verification_retries += retries;
  else telemetry.proposal_retries += retries;
}

function recordNebulaStatuses(telemetry: CurrentWindowTelemetry, statuses: readonly (number | null)[]): void {
  telemetry.physical_attempts += statuses.length > 0 ? statuses.length : 1;
  for (const status of statuses) {
    if (status === 200) telemetry.http_200 += 1;
    else if (status === 429) telemetry.http_429 += 1;
    else if (status === 502) telemetry.http_502 += 1;
    else if (status === 503) telemetry.http_503 += 1;
    else if (status === 504) telemetry.http_504 += 1;
    else if (status !== null && status >= 500 && status < 600) telemetry.other_5xx += 1;
    else if (status === null) telemetry.transport_failures += 1;
  }
}

function summarizeCurrentWindowTelemetry(telemetry: CurrentWindowTelemetry): string {
  return JSON.stringify({
    v8_current_window: telemetry,
    diagnostic_captured_at: new Date().toISOString(),
    model: V8_CURRENT_WINDOW_MODEL,
    thinking: "disabled",
    historical_semantic_linking: "disabled"
  });
}

async function persistCurrentWindowTelemetry(db: D1Database, batchId: number, telemetry: CurrentWindowTelemetry): Promise<void> {
  try {
    await db.prepare("UPDATE intelligence_batches SET provider_used = ?, prompt_tokens = ?, completion_tokens = ?, updated_at = ? WHERE id = ?")
      .bind(summarizeCurrentWindowTelemetry(telemetry), telemetry.prompt_tokens, telemetry.completion_tokens, new Date().toISOString(), batchId).run();
  } catch (error) {
    console.warn(JSON.stringify({ event: "v8_current_window_telemetry_persist_failed", error: error instanceof Error ? error.message : "unknown" }));
  }
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
  const reportBudget = Math.max(4_000, config.intelligenceMaxPayloadChars - CURRENT_WINDOW_PROPOSAL_SYSTEM_PROMPT.length - 1_000);
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

  if (decisions.some((decision) => ["MATCH_EXISTING_EVENT", "UPDATE_EXISTING_EVENT", "DUPLICATE"].includes(decision.action))) {
    throw new Error("historical_semantic_linking_unsupported");
  }

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

    const targetResult = await createEventForDecision(env, decision, reports);
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
  const orphanedEvent = await getEventByOriginatingRawPostId(env.DB, firstReport.id);
  if (orphanedEvent) return { event: orphanedEvent, created: false };
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
  const eventId = Number(result.meta.last_row_id ?? 0)
    || (await attachedEventId(env.DB, firstReport.id))
    || (await getEventByOriginatingRawPostId(env.DB, firstReport.id))?.id;
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

function requireReport(reports: Map<number, BatchReportRow>, postId: number): BatchReportRow {
  const report = reports.get(postId);
  if (!report) throw new Error(`unknown_batch_post_id:${postId}`);
  return report;
}

async function requireEvent(db: D1Database, eventId: number | null): Promise<EventRow> {
  if (eventId === null) throw new Error("event_id_required");
  const event = await getEvent(db, eventId);
  if (!event) throw new Error(`unknown_event_id:${eventId}`);
  return event;
}

async function safeIncrementCounter(db: D1Database, metric: string, amount = 1): Promise<void> {
  try {
    await incrementCounter(db, metric, amount);
  } catch (error) {
    console.warn(JSON.stringify({ event: "counter_increment_skipped", metric, error: error instanceof Error ? error.message : "unknown" }));
  }
}
