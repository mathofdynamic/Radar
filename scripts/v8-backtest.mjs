import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import intelligenceBatchJsonSchema from "../src/intelligence/intelligence-json-schema.json" with { type: "json" };

const BASE_URL = (process.env.NEBULA_BASE_URL || "https://nebula-free-llm.nebula-ai-company.workers.dev/v1").replace(/\/+$/u, "");
const API_KEY = process.env.NEBULA_API_KEY?.trim();
const LIMIT = Math.max(500, Number(process.env.RADAR_BACKTEST_LIMIT || 500));
const SAMPLE = process.env.RADAR_BACKTEST_SAMPLE || "latest-v8-500";
const SAMPLE_LIMIT = SAMPLE === "baseline-v8-500" ? 500 : LIMIT;
const MAX_REPORT_CHARS = 1_800;
const MAX_REPORTS_PER_BATCH = 32;
const MAX_PAYLOAD_CHARS = 60_000;
const AMBIGUITY_THRESHOLD = 0.72;
const REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.RADAR_BACKTEST_REQUEST_TIMEOUT_MS || 95_000));
const MAX_CONCURRENT_BATCHES = Math.max(1, Math.min(8, Number(process.env.RADAR_BACKTEST_CONCURRENCY || 1)));
const EVENT_CAP = Math.max(1, Math.min(40, Number(process.env.RADAR_EVENT_CAP || 40)));
const BACKTEST_MODE = process.env.RADAR_BACKTEST_MODE || "baseline";
const QUEUE_REPLAY_ENABLED = process.env.RADAR_BACKTEST_QUEUE_REPLAY !== "0";
const BASELINE_MANIFEST_PATH = path.resolve(process.cwd(), "scripts", "fixtures", "v8-baseline-500.json");
const DIAGNOSTIC_ROOT = path.resolve(process.cwd(), "diagnostics", "v8");
const TOKEN_SWEEP_CEILINGS = [2_000, 4_000, 6_000, 8_000, 12_000];
const TOKEN_SWEEP_REQUESTS = Math.max(5, Math.min(10, Number(process.env.RADAR_TOKEN_SWEEP_REQUESTS || 5)));
const TOKEN_SWEEP_GROUP_INDEX = Math.max(0, Math.min(9, Number(process.env.RADAR_TOKEN_SWEEP_GROUP_INDEX || 5)));
const TOKEN_SWEEP_FIXTURE_PATH = path.join(DIAGNOSTIC_ROOT, "token-sweep-fixture-cap20.json");
const TOKEN_SWEEP_ARTIFACT_PATH = path.join(DIAGNOSTIC_ROOT, "token-sweep.json");
const REVIEW_TEXT_CHARS = 320;
const REVIEW_STOP_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "در", "از", "به", "با", "برای", "که", "این", "آن"]);
const CATEGORIES = new Set(["IRAN", "WORLD", "POLITICS", "WAR_SECURITY", "SOCIETY", "ECONOMY", "TECHNOLOGY"]);
const ACTIONS = new Set(["MATCH_EXISTING_EVENT", "NEW_EVENT", "DUPLICATE", "UPDATE_EXISTING_EVENT", "NOISE", "UNCERTAIN"]);
const INTELLIGENCE_SYSTEM_PROMPT = `You are Radar's Persian-news event intelligence layer.
Several reports may describe the same real-world event with very different wording.
Reason about meaning, not wording. Persian and English reports can describe the same event.
Distinguish different events involving the same person, organization, or place.
Do not merge reports merely because an entity matches. Respect timestamps and supplied evidence.
Never invent facts, post IDs, event IDs, source names, confirmation counts, or relationships.
Use only supplied post_ids and event_id values. Confidence must reflect uncertainty.
Radar, not you, calculates independent source confirmations and verification status.
Return exactly one JSON object with a decisions array and no Markdown.`;

const BASELINE_SAMPLE_START = "2026-08-13T20:37:52.000Z";
const BASELINE_SAMPLE_END = "2026-08-14T07:55:01.000Z";
const BASELINE_MANIFEST = SAMPLE === "baseline-v8-500" ? loadBaselineManifest() : null;
const SAMPLE_FILTER = BASELINE_MANIFEST
  ? `AND rp.id IN (${BASELINE_MANIFEST.post_ids.join(",")})`
  : SAMPLE === "baseline-v8-500"
    ? `AND COALESCE(rp.published_at, rp.observed_at) >= '${BASELINE_SAMPLE_START}'
        AND COALESCE(rp.published_at, rp.observed_at) <= '${BASELINE_SAMPLE_END}'`
    : "";

function scopeIntelligenceBatchJsonSchema(allowedPostIds, allowedEventIds, duplicateTargetPostIds = allowedPostIds) {
  const schema = JSON.parse(JSON.stringify(intelligenceBatchJsonSchema));
  const decision = schema.properties.decisions.items;
  const postIds = uniquePositiveIds(allowedPostIds);
  const eventIds = uniquePositiveIds(allowedEventIds);
  const duplicateTargetIds = uniquePositiveIds(duplicateTargetPostIds);
  decision.properties.post_ids.items = { type: "integer", enum: postIds };
  decision.properties.event_id = eventIds.length > 0
    ? { anyOf: [{ type: "integer", enum: eventIds }, { type: "null" }] }
    : { type: "null" };
  decision.properties.duplicate_of_post_id = duplicateTargetIds.length > 0
    ? { anyOf: [{ type: "integer", enum: duplicateTargetIds }, { type: "null" }] }
    : { type: "null" };
  return schema;
}

function uniquePositiveIds(values) {
  return [...new Set(values)].filter((value) => Number.isSafeInteger(value) && value > 0).sort((left, right) => left - right);
}

function loadBaselineManifest() {
  if (!fs.existsSync(BASELINE_MANIFEST_PATH)) return null;
  const parsed = JSON.parse(fs.readFileSync(BASELINE_MANIFEST_PATH, "utf8"));
  const postIds = Array.isArray(parsed?.post_ids) ? parsed.post_ids.map(Number) : [];
  const uniqueIds = uniquePositiveIds(postIds);
  if (uniqueIds.length !== 500 || postIds.length !== 500) {
    throw new Error(`baseline_manifest_invalid:expected_500_unique_post_ids:${uniqueIds.length}`);
  }
  return {
    version: Number(parsed.version || 1),
    post_ids: postIds,
    windows: Array.isArray(parsed.windows) ? parsed.windows : []
  };
}

if (!API_KEY) {
  console.error("BACKTEST_BLOCKED: NEBULA_API_KEY is not available in the process environment.");
  console.error("Production-derived D1 data is available, but the Worker secret cannot be read from D1 or inferred safely.");
  process.exit(2);
}

const reports = queryD1(`
  SELECT rp.id, rp.source_id, s.name AS source_name, s.role, s.source_type, s.is_wire_origin,
         rp.published_at, rp.observed_at, rp.raw_metadata_json,
         COALESCE(rp.normalized_text, rp.original_text) AS text,
         GROUP_CONCAT(DISTINCT es.event_id) AS event_ids,
         GROUP_CONCAT(DISTINCT es.origin_group) AS origin_groups
   FROM raw_posts rp
   JOIN sources s ON s.id = rp.source_id
   LEFT JOIN event_sources es ON es.raw_post_id = rp.id
   WHERE rp.is_deleted = 0 AND rp.is_noise = 0
     ${SAMPLE_FILTER}
   GROUP BY rp.id
   ORDER BY COALESCE(rp.published_at, rp.observed_at) DESC, rp.id DESC
   LIMIT ${SAMPLE_LIMIT}
 `).map((row) => ({
  id: Number(row.id),
  source_id: Number(row.source_id),
  source_name: String(row.source_name || ""),
  source_role: String(row.role || ""),
  source_type: String(row.source_type || ""),
  is_wire_origin: Number(row.is_wire_origin || 0) === 1,
  published_at: row.published_at ? String(row.published_at) : null,
  observed_at: String(row.observed_at || ""),
  raw_metadata_json: String(row.raw_metadata_json || "{}"),
  text: String(row.text || "").slice(0, MAX_REPORT_CHARS),
  event_ids: new Set(parseIntegerList(row.event_ids)),
   origin_groups: new Set(parseStringList(row.origin_groups))
 })).filter((row) => Number.isSafeInteger(row.id) && row.text.length > 0);

if (BASELINE_MANIFEST) {
  const reportIds = new Set(reports.map((report) => report.id));
  const missingIds = BASELINE_MANIFEST.post_ids.filter((postId) => !reportIds.has(postId));
  if (reports.length !== 500 || missingIds.length > 0 || reportIds.size !== 500) {
    throw new Error(`baseline_manifest_data_mismatch:rows=${reports.length}:missing=${missingIds.slice(0, 10).join(",")}`);
  }
}
if (reports.length < 500) {
  console.error(`BACKTEST_BLOCKED: only ${reports.length} usable non-noise reports were returned; at least 500 are required when available.`);
  process.exit(3);
}

const replayDates = reports.map((report) => Date.parse(report.published_at || report.observed_at)).filter(Number.isFinite);
const replayStart = new Date(Math.min(...replayDates));
const replayEnd = new Date(Math.max(...replayDates));
const replayStartIso = replayStart.toISOString();
const replayEndIso = replayEnd.toISOString();
const eventEligibilityStartIso = new Date(replayStart.getTime() - 48 * 60 * 60 * 1_000).toISOString();

const activeEvents = queryD1(`
  SELECT e.id AS event_id, e.core_fact, e.category, e.first_seen_at, e.last_updated_at,
         GROUP_CONCAT(DISTINCT s.name) AS source_names,
         e.source_count, e.independent_confirmation_count
    FROM events e
    LEFT JOIN event_sources es ON es.event_id = e.id
    LEFT JOIN sources s ON s.id = es.source_id
   WHERE e.first_seen_at <= '${replayEndIso}'
     AND e.last_updated_at >= '${eventEligibilityStartIso}'
   GROUP BY e.id
   ORDER BY e.last_updated_at DESC
   LIMIT 500
`).map((row) => ({
  event_id: Number(row.event_id),
  core_fact: String(row.core_fact || "").slice(0, 800),
  category: String(row.category || "IRAN"),
  first_seen_at: String(row.first_seen_at || ""),
  last_updated_at: String(row.last_updated_at || ""),
  source_names: String(row.source_names || ""),
  source_count: Number(row.source_count || 0),
  independent_confirmation_count: Number(row.independent_confirmation_count || 0)
})).filter((row) => Number.isSafeInteger(row.event_id));

const batches = BASELINE_MANIFEST?.windows?.length
  ? buildManifestBatches(reports, BASELINE_MANIFEST.windows)
  : buildBatches(reports);
const metrics = {
  reports_tested: reports.length,
  windows: new Set(batches.map((batch) => batch.window_end)).size,
  batches: batches.length,
  primary_calls: 0,
  second_pass_calls: 0,
  correction_calls: 0,
  logical_requests_total: 0,
  initial_logical_requests: 0,
  initial_successes: 0,
  initial_failures: 0,
  initial_http_502: 0,
  initial_transport_failures: 0,
  initial_timeouts: 0,
  transient_retry_calls: 0,
  transient_retry_successes: 0,
  transient_retry_failures: 0,
  contract_correction_calls: 0,
  contract_correction_successes: 0,
  contract_correction_failures: 0,
  final_logical_batches: batches.length,
  final_logical_batches_successful: 0,
  final_logical_batches_failed: 0,
  nebula_successful: 0,
  nebula_failed: 0,
  fallback_recoveries: 0,
  fallback_attempts: 0,
  fallback_wins: 0,
  http_429: 0,
  http_5xx: 0,
  timeouts: 0,
  malformed_json: 0,
  schema_failures: 0,
  unknown_post_ids: 0,
  unknown_event_ids: 0,
  contradictory_assignments: 0,
  missing_assignments: 0,
  duplicate_target_violations: 0,
  rejected_unsafe_responses: 0,
  prompt_tokens: 0,
  output_tokens: 0,
  token_samples: [],
  estimated_prompt_tokens: 0,
  estimated_output_tokens: 0,
  primary_uncertain: 0,
  resolved_second_pass: 0,
  still_uncertain: 0,
  existing_event_agreements: 0,
  new_event_agreements: 0,
  disagreements: 0,
  false_merge_candidates: 0,
  false_split_candidates: 0,
  failed_batches: 0,
  second_pass_failures: 0,
  copied_source_cases: 0,
  active_event_counts: [],
  failed_batch_artifacts: [],
  second_pass_cases: [],
  queue_replay: [],
  duplicate_forensics: [],
  provider_final_samples: [],
  initial_gateway_forensics: [],
  request_telemetry: [],
  initial_latency_samples: [],
  end_to_end_latency_samples: [],
  provider_distribution: new Map(),
  routed_model_distribution: new Map(),
  manual_review: {
    agreements: [],
    disagreements: [],
    false_merges: [],
    false_splits: [],
    uncertain: [],
    cross_language: [],
    same_entity_different_event: [],
    temporal: [],
    copied_source: []
  }
};

if (BACKTEST_MODE === "high-density") {
  const highDensity = await runHighDensityExperiment(reports, activeEvents, EVENT_CAP);
  fs.mkdirSync(DIAGNOSTIC_ROOT, { recursive: true });
  fs.writeFileSync(path.join(DIAGNOSTIC_ROOT, `high-density-cap-${EVENT_CAP}.json`), `${JSON.stringify(highDensity, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    mode: BACKTEST_MODE,
    event_cap: EVENT_CAP,
    reports_per_request: 28,
    ...highDensity,
    mutation: "none"
  }, null, 2));
  process.exit(0);
}

if (BACKTEST_MODE === "token-sweep") {
  const tokenSweep = await runTokenSweepExperiment(reports, activeEvents, EVENT_CAP);
  fs.mkdirSync(DIAGNOSTIC_ROOT, { recursive: true });
  fs.writeFileSync(TOKEN_SWEEP_ARTIFACT_PATH, `${JSON.stringify(tokenSweep, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    mode: BACKTEST_MODE,
    event_cap: EVENT_CAP,
    requests_per_ceiling: TOKEN_SWEEP_REQUESTS,
    ...tokenSweep,
    mutation: "none"
  }, null, 2));
  process.exit(0);
}

for (let batchStart = 0; batchStart < batches.length; batchStart += MAX_CONCURRENT_BATCHES) {
  const concurrentBatches = batches.slice(batchStart, batchStart + MAX_CONCURRENT_BATCHES);
  await Promise.all(concurrentBatches.map((batch, offset) => processBatch(batch, batchStart + offset)));
}

if (QUEUE_REPLAY_ENABLED) {
  metrics.queue_replay = await replayGatewayFailures(metrics.failed_batch_artifacts);
}

async function processBatch(batch, batchIndex) {
  const batchStartedAt = Date.now();
  const correctionState = { used: false };
  const batchEvents = selectEventsForBatch(activeEvents, batch, EVENT_CAP);
  const knownEventIds = new Set(batchEvents.map((event) => event.event_id));
  metrics.active_event_counts.push(batchEvents.length);
  const diagnostic = {
    batch: {
      window_start: batch.window_start,
      window_end: batch.window_end,
      report_ids: batch.reports.map((report) => report.id),
      report_count: batch.reports.length
    },
    active_event_ids: batchEvents.map((event) => event.event_id),
    attempts: [],
    validation_errors: []
  };
  let decisions;
  let primaryCallCompleted = false;
  try {
    metrics.primary_calls += 1;
    const primary = await callNebula(batch.reports, batchEvents, "primary");
    diagnostic.attempts.push(...primary.attempts);
    diagnostic.request_payload = primary.request_payload;
    diagnostic.primary_output = primary.output;
    recordInitialGatewayForensics(metrics, batch, batchEvents, primary, null);
    recordCallResult(metrics, primary, null, "primary");
    addTokenMetricsFromCall(metrics, primary, "primary");
    primaryCallCompleted = true;
    const primaryValidation = await validateWithCorrection(
      batch.reports,
      batchEvents,
      primary.output,
      batch.reports.map((report) => report.id),
      knownEventIds,
      new Set(batch.reports.map((report) => report.id)),
      correctionState,
      metrics
    );
    decisions = primaryValidation.decisions;
  } catch (error) {
    diagnostic.validation_errors.push(error instanceof Error ? error.message : String(error));
    if (error?.correctionOutput) diagnostic.correction_output = error.correctionOutput;
    if (error?.attempts) diagnostic.attempts.push(...error.attempts);
    if (error?.request_payload && !diagnostic.request_payload) diagnostic.request_payload = error.request_payload;
    recordInitialGatewayForensics(metrics, batch, batchEvents, null, error);
    if (!primaryCallCompleted) recordCallResult(metrics, null, error, "primary");
    metrics.failed_batches += 1;
    metrics.final_logical_batches_failed += 1;
    recordRejectedResponse(metrics, error);
    recordFailedBatchArtifact(diagnostic, error);
    console.warn(`BACKTEST_BATCH_FAILED window=${batch.window_end} reports=${batch.reports.length} error=${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const uncertainIds = [...new Set(decisions.filter((decision) => decision.action === "UNCERTAIN" || decision.confidence < AMBIGUITY_THRESHOLD).flatMap((decision) => decision.post_ids))];
  metrics.primary_uncertain += uncertainIds.length;

  if (uncertainIds.length > 0) {
    const focusedReports = batch.reports.filter((report) => uncertainIds.includes(report.id));
    const focusedEvents = batchEvents.filter((event) => decisions.some((decision) => decision.event_id === event.event_id && decision.post_ids.some((id) => uncertainIds.includes(id)))).slice(0, 5);
    let secondCallCompleted = false;
    try {
      metrics.second_pass_calls += 1;
      const second = await callNebula(focusedReports, focusedEvents, "ambiguity", {
        expectedPostIds: uncertainIds,
        duplicateTargetPostIds: batch.reports.map((report) => report.id)
      });
      diagnostic.attempts.push(...second.attempts);
      diagnostic.request_payload = diagnostic.request_payload || second.request_payload;
      diagnostic.second_pass = {
        uncertain_post_ids: uncertainIds,
        resolved_post_ids: [],
        output: second.output
      };
      recordCallResult(metrics, second, null, "ambiguity");
      addTokenMetricsFromCall(metrics, second, "ambiguity");
      secondCallCompleted = true;
      const secondValidation = await validateWithCorrection(
        focusedReports,
        focusedEvents,
        second.output,
        uncertainIds,
        new Set(focusedEvents.map((event) => event.event_id)),
        new Set(batch.reports.map((report) => report.id)),
        correctionState,
        metrics
      );
      const resolved = secondValidation.decisions;
      const resolvedIds = new Set(uncertainIds);
      decisions = [...decisions.filter((decision) => !decision.post_ids.some((id) => resolvedIds.has(id))), ...resolved];
      const finalUncertainIds = new Set(decisions.filter((decision) => decision.action === "UNCERTAIN" || decision.confidence < AMBIGUITY_THRESHOLD).flatMap((decision) => decision.post_ids));
      metrics.resolved_second_pass += [...resolvedIds].filter((id) => !finalUncertainIds.has(id)).length;
      diagnostic.second_pass.resolved_post_ids = [...resolvedIds].filter((id) => !finalUncertainIds.has(id));
      diagnostic.second_pass.final_decisions = resolved;
      metrics.second_pass_cases.push({
        window_end: batch.window_end,
        uncertain_post_ids: uncertainIds,
        resolved_post_ids: diagnostic.second_pass.resolved_post_ids,
        final_decisions: resolved.map((decision) => ({
          post_ids: decision.post_ids,
          action: decision.action,
          event_id: decision.event_id,
          confidence: decision.confidence
        }))
      });
    } catch (error) {
      diagnostic.validation_errors.push(error instanceof Error ? error.message : String(error));
      if (error?.correctionOutput) diagnostic.correction_output = error.correctionOutput;
      if (error?.attempts) diagnostic.attempts.push(...error.attempts);
      if (error?.request_payload && !diagnostic.request_payload) diagnostic.request_payload = error.request_payload;
      metrics.second_pass_failures += 1;
      if (!secondCallCompleted) recordCallResult(metrics, null, error, "ambiguity");
      metrics.failed_batches += 1;
      metrics.final_logical_batches_failed += 1;
      recordRejectedResponse(metrics, error);
      recordFailedBatchArtifact(diagnostic, error);
      console.warn(`AMBIGUITY_OUTPUT_REJECTED: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }

  try {
    const finalValidation = await validateWithCorrection(
      batch.reports,
      batchEvents,
      { decisions },
      batch.reports.map((report) => report.id),
      knownEventIds,
      new Set(batch.reports.map((report) => report.id)),
      correctionState,
      metrics
    );
    decisions = finalValidation.decisions;
  } catch (error) {
    diagnostic.validation_errors.push(error instanceof Error ? error.message : String(error));
    if (error?.correctionOutput) diagnostic.correction_output = error.correctionOutput;
    if (error?.attempts) diagnostic.attempts.push(...error.attempts);
    if (error?.request_payload && !diagnostic.request_payload) diagnostic.request_payload = error.request_payload;
    metrics.failed_batches += 1;
    metrics.final_logical_batches_failed += 1;
    recordRejectedResponse(metrics, error);
    recordFailedBatchArtifact(diagnostic, error);
    console.warn(`FINAL_OUTPUT_REJECTED: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  metrics.final_logical_batches_successful += 1;
  metrics.end_to_end_latency_samples.push(Date.now() - batchStartedAt);
  const finalUncertainIds = [...new Set(decisions.filter((decision) => decision.action === "UNCERTAIN" || decision.confidence < AMBIGUITY_THRESHOLD).flatMap((decision) => decision.post_ids))];
  metrics.still_uncertain += finalUncertainIds.length;
  for (const postId of finalUncertainIds) {
    const decision = decisions.find((candidate) => candidate.post_ids.includes(postId));
    const report = batch.reports.find((candidate) => candidate.id === postId);
    if (decision && report) addReview(metrics.manual_review.uncertain, { report: reviewReport(report), decision: reviewDecision(decision) }, 10);
  }
  compareWithProductionRelationships(batch.reports, decisions, metrics);
  collectCopiedSourceCases(batch.reports, metrics);
  if ((batchIndex + 1) % 10 === 0 || batchIndex === batches.length - 1) {
    console.error(`BACKTEST_PROGRESS ${batchIndex + 1}/${batches.length}`);
  }
}

async function validateWithCorrection(batchReports, events, output, expectedPostIds, knownEventIds, allowedPostIds, correctionState, metrics) {
  try {
    return { decisions: validateDecisions(output, batchReports, knownEventIds, allowedPostIds) };
  } catch (error) {
    if (!isCorrectableBacktestError(error) || correctionState.used) throw error;
    correctionState.used = true;
    metrics.correction_calls += 1;
    metrics.contract_correction_calls += 1;
    let correctionCallCompleted = false;
    let correction = null;
    try {
      correction = await callNebula(batchReports, events, "correction", {
        expectedPostIds,
        duplicateTargetPostIds: [...allowedPostIds],
        priorDecisions: output?.decisions || [],
        correctionError: error.message
      });
      recordCallResult(metrics, correction, null, "correction");
      addTokenMetricsFromCall(metrics, correction, "correction");
      correctionCallCompleted = true;
      const decisions = validateDecisions(correction.output, batchReports, knownEventIds, allowedPostIds);
      metrics.contract_correction_successes += 1;
      return { decisions };
    } catch (correctionError) {
      if (correction && correctionError && typeof correctionError === "object") {
        correctionError.correctionOutput = correction.output;
        correctionError.attempts = correction.attempts;
        correctionError.request_payload = correction.request_payload;
      }
      if (!correctionCallCompleted) recordCallResult(metrics, null, correctionError, "correction");
      metrics.contract_correction_failures += 1;
      throw correctionError;
    }
  }
}

const batchSizes = batches.map((batch) => batch.reports.length).sort((left, right) => left - right);
const sampleDates = reports.map((report) => new Date(report.published_at || report.observed_at)).filter((date) => !Number.isNaN(date.getTime()));
const sampleStart = sampleDates.length > 0 ? new Date(Math.min(...sampleDates.map((date) => date.getTime()))) : null;
const sampleEnd = sampleDates.length > 0 ? new Date(Math.max(...sampleDates.map((date) => date.getTime()))) : null;
const sampleDurationHours = sampleStart && sampleEnd ? Math.max((sampleEnd.getTime() - sampleStart.getTime()) / 3_600_000, 5 / 60) : null;
const totalCalls = metrics.logical_requests_total;
const totalPairComparisons = metrics.existing_event_agreements + metrics.disagreements;
const providerDistribution = [...metrics.provider_distribution.entries()].map(([provider, values]) => ({ provider, ...values }));
const latencies = metrics.request_telemetry.map((request) => request.latency_ms).filter((value) => Number.isFinite(value));
const initialLatencies = metrics.initial_latency_samples.filter((value) => Number.isFinite(value));
const endToEndLatencies = metrics.end_to_end_latency_samples.filter((value) => Number.isFinite(value));
const productionProjection = buildProductionProjection(reports, activeEvents, metrics, totalCalls);
const failedBatchForensics = metrics.failed_batch_artifacts.map((artifact) => ({
  window_end: artifact.window_end,
  report_ids: artifact.report_ids,
  report_count: artifact.report_count,
  active_event_count: artifact.active_event_count,
  active_event_ids: artifact.active_event_ids,
  prompt_chars: artifact.prompt_chars,
  system_prompt_chars: artifact.system_prompt_chars,
  schema_chars: artifact.schema_chars,
  request_ids: artifact.request_ids,
  attempts: artifact.attempts,
  failure_category: artifact.failure_category,
  validation_errors: artifact.validation_errors,
  duplicate_forensics: artifact.duplicate_forensics
}));
const duplicateForensics = failedBatchForensics.flatMap((artifact) => artifact.duplicate_forensics.map((item) => ({ window_end: artifact.window_end, ...item })));
console.log(JSON.stringify({
  sample_selection: SAMPLE,
  baseline_selection_exactness: BASELINE_MANIFEST ? "canonical_manifest" : SAMPLE === "baseline-v8-500" ? "deterministic_date_bounded_reconstruction" : "latest_ordered_sample",
  baseline_manifest_file: BASELINE_MANIFEST ? path.relative(process.cwd(), BASELINE_MANIFEST_PATH) : null,
  baseline_manifest_reports: BASELINE_MANIFEST?.post_ids.length ?? null,
  reports_tested: metrics.reports_tested,
  windows: metrics.windows,
  batches: metrics.batches,
  sample_date_range: { start: sampleStart?.toISOString() ?? null, end: sampleEnd?.toISOString() ?? null, duration_hours: sampleDurationHours },
  primary_calls: metrics.primary_calls,
  second_pass_calls: metrics.second_pass_calls,
  correction_calls: metrics.correction_calls,
  logical_requests_total: metrics.logical_requests_total,
  initial_logical_requests: metrics.initial_logical_requests,
  initial_successes: metrics.initial_successes,
  initial_failures: metrics.initial_failures,
  raw_initial_success_rate: metrics.initial_logical_requests === 0 ? null : Number((metrics.initial_successes / metrics.initial_logical_requests).toFixed(4)),
  initial_http_502: metrics.initial_http_502,
  initial_transport_failures: metrics.initial_transport_failures,
  initial_timeouts: metrics.initial_timeouts,
  transient_retry_calls: metrics.transient_retry_calls,
  transient_retry_successes: metrics.transient_retry_successes,
  transient_retry_failures: metrics.transient_retry_failures,
  contract_correction_calls: metrics.contract_correction_calls,
  contract_correction_successes: metrics.contract_correction_successes,
  contract_correction_failures: metrics.contract_correction_failures,
  final_logical_batches: metrics.final_logical_batches,
  final_logical_batches_successful: metrics.final_logical_batches_successful,
  final_logical_batches_failed: metrics.final_logical_batches_failed,
  final_logical_success_rate: metrics.final_logical_batches === 0 ? null : Number((metrics.final_logical_batches_successful / metrics.final_logical_batches).toFixed(4)),
  successful: metrics.nebula_successful,
  failed: metrics.nebula_failed,
  fallback_recoveries: metrics.fallback_recoveries,
  fallback_attempts: metrics.fallback_attempts,
  fallback_wins: metrics.fallback_wins,
  http_429: metrics.http_429,
  http_5xx: metrics.http_5xx,
  timeouts: metrics.timeouts,
  request_telemetry_records: metrics.request_telemetry.length,
  latency_ms: { average: average(latencies), median: median(latencies), p95: percentile(latencies, 0.95), maximum: latencies.length === 0 ? null : Math.max(...latencies), initial_median: median(initialLatencies), initial_p95: percentile(initialLatencies, 0.95), initial_maximum: initialLatencies.length === 0 ? null : Math.max(...initialLatencies), end_to_end_median: median(endToEndLatencies), end_to_end_p95: percentile(endToEndLatencies, 0.95), end_to_end_maximum: endToEndLatencies.length === 0 ? null : Math.max(...endToEndLatencies) },
  provider_distribution: providerDistribution,
  routed_model_distribution: [...metrics.routed_model_distribution.entries()].map(([model, calls]) => ({ model, calls })),
  average_reports_per_request: batches.length === 0 ? null : Number((reports.length / batches.length).toFixed(4)),
  median_reports_per_request: median(batchSizes),
  maximum_reports_per_request: batchSizes.length === 0 ? null : batchSizes[batchSizes.length - 1],
  total_input_tokens: metrics.prompt_tokens,
  total_output_tokens: metrics.output_tokens,
  average_input_tokens: metrics.nebula_successful === 0 ? null : Number((metrics.prompt_tokens / metrics.nebula_successful).toFixed(2)),
  average_output_tokens: metrics.nebula_successful === 0 ? null : Number((metrics.output_tokens / metrics.nebula_successful).toFixed(2)),
  token_estimates_used: metrics.estimated_prompt_tokens > 0 || metrics.estimated_output_tokens > 0,
  existing_event_agreements: metrics.existing_event_agreements,
  new_event_agreements: metrics.new_event_agreements,
  disagreements: metrics.disagreements,
  false_merge_candidates: metrics.false_merge_candidates,
  false_split_candidates: metrics.false_split_candidates,
  primary_uncertain: metrics.primary_uncertain,
  resolved_second_pass: metrics.resolved_second_pass,
  still_uncertain: metrics.still_uncertain,
  malformed_json: metrics.malformed_json,
  schema_failures: metrics.schema_failures,
  unknown_post_ids: metrics.unknown_post_ids,
  unknown_event_ids: metrics.unknown_event_ids,
  duplicate_target_violations: metrics.duplicate_target_violations,
  contradictory_assignments: metrics.contradictory_assignments,
  missing_assignments: metrics.missing_assignments,
  rejected_unsafe_responses: metrics.rejected_unsafe_responses,
  second_pass_failures: metrics.second_pass_failures,
  copied_source_cases: metrics.copied_source_cases,
  event_context: {
    cap: EVENT_CAP,
    shortlist_method: EVENT_CAP >= 40 ? "historical eligibility then last_updated_at descending" : "token overlap plus category compatibility plus recency",
    historical_filter: "first_seen_at <= batch.window_end AND last_updated_at >= batch.window_end - 48h",
    active_event_counts: { median: median(metrics.active_event_counts), maximum: Math.max(...metrics.active_event_counts, 0) },
    current_core_fact_limitation: "event rows are current snapshots; historical event-version changes are unavailable"
  },
  failed_batch_forensics: failedBatchForensics,
  initial_gateway_forensics: metrics.initial_gateway_forensics,
  duplicate_forensics: duplicateForensics,
  provider_behavior: summarizeProviderBehavior(metrics.request_telemetry),
  second_pass_cases: metrics.second_pass_cases,
  queue_equivalent_replay: metrics.queue_replay,
  manual_review: metrics.manual_review,
  production_projection_at_341_reports_per_hour: productionProjection,
  observed_calls_per_hour: sampleDurationHours === null ? null : Number((totalCalls / sampleDurationHours).toFixed(3)),
  agreement_rate: totalPairComparisons === 0 ? null : Number((metrics.existing_event_agreements / totalPairComparisons).toFixed(4)),
  nebula_base_url: BASE_URL,
  model_requested: "radar-fast",
  request_timeout_ms: REQUEST_TIMEOUT_MS,
  concurrency: MAX_CONCURRENT_BATCHES,
  mutation: "none"
}, null, 2));

function buildBatches(rows) {
  const windows = new Map();
  for (const report of rows) {
    const date = new Date(report.published_at || report.observed_at);
    if (Number.isNaN(date.getTime())) continue;
    date.setUTCSeconds(0, 0);
    date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 5) * 5);
    const windowEnd = date.toISOString();
    const windowStart = new Date(date.getTime() - 5 * 60 * 1_000).toISOString();
    const key = `${windowEnd}`;
    const current = windows.get(key) || { window_start: windowStart, window_end: windowEnd, reports: [] };
    current.reports.push(report);
    windows.set(key, current);
  }

  const batches = [];
  for (const window of [...windows.values()].sort((left, right) => left.window_end.localeCompare(right.window_end))) {
    let current = [];
    for (const report of window.reports) {
      const candidate = [...current, report];
      const size = JSON.stringify(candidate.map(compactReport)).length;
      if (current.length >= MAX_REPORTS_PER_BATCH || (current.length > 0 && size > MAX_PAYLOAD_CHARS - 10_000)) {
        batches.push({ window_start: window.window_start, window_end: window.window_end, reports: current });
        current = [report];
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) batches.push({ window_start: window.window_start, window_end: window.window_end, reports: current });
  }
  return batches;
}

function buildManifestBatches(rows, manifestWindows) {
  const byId = new Map(rows.map((report) => [report.id, report]));
  const batches = [...manifestWindows].sort((left, right) => String(left.window_end).localeCompare(String(right.window_end))).map((window) => {
    const windowReports = window.post_ids.map((postId) => byId.get(Number(postId))).filter(Boolean);
    if (windowReports.length !== window.post_ids.length) throw new Error(`baseline_manifest_window_missing:${window.window_end}`);
    const windowEnd = String(window.window_end);
    return {
      window_start: new Date(Date.parse(windowEnd) - 5 * 60 * 1_000).toISOString(),
      window_end: windowEnd,
      reports: windowReports
    };
  });
  if (batches.reduce((sum, batch) => sum + batch.reports.length, 0) !== rows.length) throw new Error("baseline_manifest_window_coverage_invalid");
  return batches;
}

function selectEventsForBatch(events, batch, cap) {
  const windowEndMs = Date.parse(batch.window_end);
  const historicalEligible = events.filter((event) => {
    const firstSeenMs = Date.parse(event.first_seen_at);
    const lastUpdatedMs = Date.parse(event.last_updated_at);
    return Number.isFinite(firstSeenMs)
      && Number.isFinite(lastUpdatedMs)
      && firstSeenMs <= windowEndMs
      && lastUpdatedMs >= windowEndMs - 48 * 60 * 60 * 1_000;
  });
  if (cap >= 40) return historicalEligible
    .sort((left, right) => right.last_updated_at.localeCompare(left.last_updated_at) || right.event_id - left.event_id)
    .slice(0, cap);

  const reportText = batch.reports.map((report) => report.text).join(" ");
  const reportTokens = tokenSet(reportText);
  const reportCategoryHints = categoryHints(reportText);
  return historicalEligible
    .map((event) => {
      const eventTokens = tokenSet(`${event.core_fact} ${event.source_names}`);
      const overlap = [...eventTokens].filter((token) => reportTokens.has(token)).length;
      const categoryBoost = reportCategoryHints.has(event.category) ? 4 : 0;
      const ageHours = Math.max(0, (windowEndMs - Date.parse(event.last_updated_at)) / 3_600_000);
      const recencyBoost = 1 / (1 + ageHours / 24);
      return { event, score: overlap * 10 + categoryBoost + recencyBoost };
    })
    .sort((left, right) => right.score - left.score || right.event.last_updated_at.localeCompare(left.event.last_updated_at) || right.event.event_id - left.event.event_id)
    .slice(0, cap)
    .map((item) => item.event);
}

function tokenSet(text) {
  return new Set(String(text || "").toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3 && !REVIEW_STOP_WORDS.has(token)));
}

function categoryHints(text) {
  const value = String(text || "");
  const hints = new Set();
  if (/جنگ|حمله|انفجار|موشک|ارتش|نظامی|war|attack|missile/iu.test(value)) hints.add("WAR_SECURITY");
  if (/دولت|رئیس|ترامپ|انتخابات|پارلمان|سیاست|government|president|election/iu.test(value)) hints.add("POLITICS");
  if (/اقتصاد|بازار|نفت|دلار|بانک|economy|market|oil/iu.test(value)) hints.add("ECONOMY");
  if (/فناوری|اینترنت|هوش مصنوعی|تکنولوژی|technology|software/iu.test(value)) hints.add("TECHNOLOGY");
  if (/ایران|تهران|خوزستان|هرمز|Iran|Tehran/iu.test(value)) hints.add("IRAN");
  return hints;
}

function recordFailedBatchArtifact(diagnostic, error) {
  const attempts = diagnostic.attempts.map((attempt) => ({
    request_id: attempt.telemetry?.request_id ?? null,
    status: attempt.telemetry?.status ?? null,
    provider: attempt.telemetry?.provider ?? null,
    routed_model: attempt.telemetry?.routed_model ?? null,
    fallback_attempts: attempt.telemetry?.fallback_attempts ?? 0,
    latency_ms: attempt.telemetry?.latency_ms ?? null,
    logical_attempt: attempt.telemetry?.logical_attempt ?? null,
    logical_retry: attempt.telemetry?.logical_retry ?? false,
    prompt_chars: attempt.telemetry?.prompt_chars ?? null,
    system_prompt_chars: attempt.telemetry?.system_prompt_chars ?? null,
    schema_chars: attempt.telemetry?.schema_chars ?? null,
    active_event_count: attempt.telemetry?.active_event_count ?? null,
    prompt_tokens: attempt.prompt_tokens ?? 0,
    output_tokens: attempt.output_tokens ?? 0,
    structured_json: attempt.structured_json ?? false
  }));
  const artifact = {
    ...diagnostic.batch,
    active_event_ids: diagnostic.active_event_ids,
    prompt_chars: attempts.find((attempt) => attempt.prompt_chars !== null)?.prompt_chars ?? null,
    system_prompt_chars: attempts.find((attempt) => attempt.system_prompt_chars !== null)?.system_prompt_chars ?? null,
    schema_chars: attempts.find((attempt) => attempt.schema_chars !== null)?.schema_chars ?? null,
    active_event_count: diagnostic.active_event_ids.length,
    request_ids: attempts.map((attempt) => attempt.request_id).filter(Boolean),
    attempts,
    request_payload: diagnostic.request_payload ?? null,
    failure_category: error?.backtestCode || error?.message || "unknown",
    validation_errors: diagnostic.validation_errors,
    primary_output: diagnostic.primary_output ?? null,
    correction_output: diagnostic.correction_output ?? null,
    second_pass: diagnostic.second_pass ?? null,
    duplicate_forensics: classifyDuplicateGraphs([diagnostic.primary_output, diagnostic.correction_output].filter(Boolean), diagnostic.batch.report_ids)
  };
  metrics.failed_batch_artifacts.push(artifact);
  fs.mkdirSync(DIAGNOSTIC_ROOT, { recursive: true });
  const safeName = `${diagnostic.batch.window_end.replace(/[^0-9A-Za-z-]+/gu, "_")}-${diagnostic.batch.report_ids[0] || "batch"}.json`;
  fs.writeFileSync(path.join(DIAGNOSTIC_ROOT, `failed-${safeName}`), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  diagnostic.duplicate_forensics = artifact.duplicate_forensics;
}

function classifyDuplicateGraphs(outputs, allowedPostIds) {
  const allowed = new Set(allowedPostIds);
  return outputs.flatMap((output) => {
    const decisions = Array.isArray(output?.decisions) ? output.decisions : [];
    const actionByPost = new Map();
    const targetByPost = new Map();
    for (const decision of decisions) {
      for (const postId of Array.isArray(decision?.post_ids) ? decision.post_ids : []) actionByPost.set(Number(postId), decision.action);
      if (decision?.action === "DUPLICATE" && Array.isArray(decision.post_ids)) {
        for (const postId of decision.post_ids) targetByPost.set(Number(postId), Number(decision.duplicate_of_post_id));
      }
    }
    return [...targetByPost.entries()].map(([postId, target]) => {
      let type = "F_other";
      if (!allowed.has(target) || !actionByPost.has(target)) type = "D_missing_target";
      else if (target === postId) type = "E_cycle";
      else if (actionByPost.get(target) === "NOISE") type = "B_duplicate_to_noise";
      else if (actionByPost.get(target) === "UNCERTAIN") type = "C_duplicate_to_uncertain";
      else if (actionByPost.get(target) === "DUPLICATE") type = "A_duplicate_chain";
      return { post_id: postId, target_post_id: target, target_action: actionByPost.get(target) || null, type };
    });
  });
}

function buildHighDensityGroups(rows, reportCount = 28, count = 10) {
  const chronological = [...rows].sort((left, right) => String(left.published_at || left.observed_at).localeCompare(String(right.published_at || right.observed_at)) || left.id - right.id);
  if (chronological.length < reportCount) throw new Error(`high_density_fixture_insufficient_reports:${chronological.length}:${reportCount}`);
  const groups = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(index * (chronological.length - reportCount) / Math.max(1, count - 1));
    groups.push(chronological.slice(start, start + reportCount));
  }
  return groups;
}

function buildHighDensityBatch(group) {
  const date = new Date(group[0].published_at || group[0].observed_at);
  date.setUTCSeconds(0, 0);
  date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 5) * 5);
  return {
    window_start: new Date(date.getTime() - 5 * 60 * 1_000).toISOString(),
    window_end: date.toISOString(),
    reports: group
  };
}

function buildIntelligenceRequest(batchReports, events, pass = "primary", options = {}, maxTokens = 2_000) {
  const expectedPostIds = options.expectedPostIds || batchReports.map((report) => report.id);
  const duplicateTargetPostIds = options.duplicateTargetPostIds || batchReports.map((report) => report.id);
  const userPrompt = buildUserPrompt(batchReports, events, pass, options);
  if (userPrompt.length + INTELLIGENCE_SYSTEM_PROMPT.length > MAX_PAYLOAD_CHARS) throw new Error("backtest_payload_too_large");
  const responseSchema = scopeIntelligenceBatchJsonSchema(expectedPostIds, events.map((event) => event.event_id), duplicateTargetPostIds);
  return {
    requestPayload: {
      model: "radar-fast",
      messages: [
        { role: "system", content: INTELLIGENCE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "radar_intelligence_batch",
          strict: true,
          schema: responseSchema
        }
      },
      temperature: 0.1,
      max_tokens: maxTokens
    },
    requestMetadata: {
      prompt_chars: userPrompt.length,
      system_prompt_chars: INTELLIGENCE_SYSTEM_PROMPT.length,
      schema_chars: JSON.stringify(responseSchema).length,
      active_event_count: events.length,
      active_event_ids: events.map((event) => event.event_id),
      report_count: batchReports.length,
      pass
    },
    responseSchema,
    userPrompt
  };
}

async function runTokenSweepExperiment(rows, events, cap) {
  if (cap !== 20) throw new Error("token_sweep_requires_event_cap_20");
  const groups = buildHighDensityGroups(rows, 28, 10);
  const groupIndex = Math.min(TOKEN_SWEEP_GROUP_INDEX, groups.length - 1);
  const group = groups[groupIndex];
  const batch = buildHighDensityBatch(group);
  const selectedEvents = selectEventsForBatch(events, batch, cap);
  const baseRequest = buildIntelligenceRequest(group, selectedEvents, "primary", {}, 2_000);
  const fixture = {
    version: 1,
    fixture: "v8-high-density-28-cap20",
    selection: {
      method: "chronological_evenly_spaced_high_density_group",
      group_index: groupIndex,
      group_count: groups.length,
      report_count: group.length,
      event_cap: cap
    },
    batch: {
      window_start: batch.window_start,
      window_end: batch.window_end,
      report_ids: group.map((report) => report.id),
      report_count: group.length
    },
    active_event_ids: selectedEvents.map((event) => event.event_id),
    request_metadata: baseRequest.requestMetadata,
    request_payload: baseRequest.requestPayload,
    note: "Local diagnostic fixture. Contains the exact prompt and schema but no Authorization header or API key."
  };
  fs.mkdirSync(DIAGNOSTIC_ROOT, { recursive: true });
  fs.writeFileSync(TOKEN_SWEEP_FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

  const ceilingResults = [];
  for (const maxTokens of TOKEN_SWEEP_CEILINGS) {
    const requests = await Promise.all(Array.from({ length: TOKEN_SWEEP_REQUESTS }, (_, requestIndex) => runSingleTokenDiagnosticRequest({
        requestPayload: { ...baseRequest.requestPayload, max_tokens: maxTokens },
        requestMetadata: baseRequest.requestMetadata,
        reportIds: group.map((report) => report.id),
        activeEventIds: selectedEvents.map((event) => event.event_id),
        maxTokens,
        phase: "token_sweep",
        requestIndex
      })));
    ceilingResults.push(summarizeTokenSweepCeiling(maxTokens, requests));
  }

  const reliable = ceilingResults.find((result) => result.http_success === result.requests && result.schema_valid === result.requests) || null;
  const thirtyTwoReport = reliable
    ? await runThirtyTwoReportValidation(rows, events, cap, reliable.max_tokens, groupIndex)
    : { skipped: true, reason: "no_token_ceiling_produced_100_percent_http_and_schema_success_for_fixed_28_report_fixture" };

  return {
    fixed_fixture: {
      path: path.relative(process.cwd(), TOKEN_SWEEP_FIXTURE_PATH),
      report_count: group.length,
      event_count: selectedEvents.length,
      report_ids: group.map((report) => report.id),
      active_event_ids: selectedEvents.map((event) => event.event_id),
      window_start: batch.window_start,
      window_end: batch.window_end,
      prompt_chars: baseRequest.requestMetadata.prompt_chars,
      system_prompt_chars: baseRequest.requestMetadata.system_prompt_chars,
      schema_chars: baseRequest.requestMetadata.schema_chars
    },
    token_sweep_requests_per_ceiling: TOKEN_SWEEP_REQUESTS,
    token_sweep: ceilingResults,
    smallest_reliable_token_ceiling: reliable?.max_tokens ?? null,
    thirty_two_report_validation: thirtyTwoReport,
    diagnostic_contract: {
      logical_retry: "disabled",
      request_contract: "same messages, schema, model, temperature, and report/event context; only max_tokens changes",
      response_contract: "unchanged radar_intelligence_batch JSON Schema"
    }
  };
}

async function runThirtyTwoReportValidation(rows, events, cap, maxTokens, groupIndex) {
  const groups = buildHighDensityGroups(rows, 32, 10);
  const group = groups[Math.min(groupIndex, groups.length - 1)];
  const batch = buildHighDensityBatch(group);
  const selectedEvents = selectEventsForBatch(events, batch, cap);
  const request = buildIntelligenceRequest(group, selectedEvents, "primary", {}, maxTokens);
  const requests = await Promise.all(Array.from({ length: TOKEN_SWEEP_REQUESTS }, (_, requestIndex) => runSingleTokenDiagnosticRequest({
      requestPayload: request.requestPayload,
      requestMetadata: request.requestMetadata,
      reportIds: group.map((report) => report.id),
      activeEventIds: selectedEvents.map((event) => event.event_id),
      maxTokens,
      phase: "thirty_two_report",
      requestIndex
    })));
  return {
    skipped: false,
    max_tokens: maxTokens,
    group_index: Math.min(groupIndex, groups.length - 1),
    report_count: group.length,
    active_event_count: selectedEvents.length,
    report_ids: group.map((report) => report.id),
    active_event_ids: selectedEvents.map((event) => event.event_id),
    prompt_chars: request.requestMetadata.prompt_chars,
    schema_chars: request.requestMetadata.schema_chars,
    ...summarizeTokenSweepCeiling(maxTokens, requests),
    requests_detail: requests
  };
}

async function runSingleTokenDiagnosticRequest({ requestPayload, requestMetadata, reportIds, activeEventIds, maxTokens, phase, requestIndex }) {
  const startedAt = Date.now();
  try {
    const { response, body, body_text: bodyText } = await fetchNebulaResponse(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(requestPayload)
    });
    const telemetry = { ...buildNebulaTelemetry(response, body, startedAt, "radar-fast"), ...requestMetadata };
    const output = parseOutput(body);
    let validationError = null;
    let schemaValid = false;
    if (response.ok && output) {
      try {
        schemaValid = validateQueueReplayOutput(output, { report_ids: reportIds, active_event_ids: activeEventIds });
        if (!schemaValid) validationError = "structured_schema_invalid";
      } catch (error) {
        validationError = error instanceof Error ? error.message : String(error);
      }
    }
    const usage = body?.usage && typeof body.usage === "object" ? body.usage : {};
    const promptTokens = Number(usage.prompt_tokens || 0);
    const completionTokens = Number(usage.completion_tokens || usage.output_tokens || 0);
    const content = body?.choices?.[0]?.message?.content;
    const serializedOutput = output ? JSON.stringify(output) : "";
    const errorInfo = extractNebulaErrorInfo(body);
    const failureCategory = classifyTokenDiagnosticFailure(response.status, errorInfo.error_code, output, schemaValid, validationError);
    const result = {
      phase,
      request_index: requestIndex,
      max_tokens: maxTokens,
      status: response.status,
      ok: response.ok,
      schema_valid: schemaValid,
      provider: telemetry.provider,
      routed_model: telemetry.routed_model,
      fallback_attempts: telemetry.fallback_attempts,
      request_id: telemetry.request_id,
      latency_ms: telemetry.latency_ms,
      prompt_chars: requestMetadata.prompt_chars,
      system_prompt_chars: requestMetadata.system_prompt_chars,
      schema_chars: requestMetadata.schema_chars,
      report_count: requestMetadata.report_count,
      active_event_count: requestMetadata.active_event_count,
      prompt_tokens: Number.isFinite(promptTokens) ? promptTokens : 0,
      completion_tokens: Number.isFinite(completionTokens) ? completionTokens : 0,
      finish_reason: extractFinishReasons(body),
      content_chars: typeof content === "string" ? content.length : null,
      serialized_output_chars: serializedOutput.length || null,
      decision_count: Array.isArray(output?.decisions) ? output.decisions.length : null,
      reports_represented: Array.isArray(output?.decisions) ? output.decisions.reduce((sum, decision) => sum + (Array.isArray(decision?.post_ids) ? decision.post_ids.length : 0), 0) : null,
      failure_category: failureCategory,
      validation_error: validationError,
      error_code: errorInfo.error_code,
      error_message: errorInfo.error_message,
      error_last_status: errorInfo.error_last_status,
      error_last_error: errorInfo.error_last_error,
      error_attempts: errorInfo.error_attempts,
      provider_attempts: normalizeGatewayAttempts(errorInfo.error_attempts),
      response_body_excerpt: failureCategory ? safeDiagnosticJson(body, bodyText) : null
    };
    return result;
  } catch (error) {
    const diagnostics = describeDiagnosticError(error);
    return {
      phase,
      request_index: requestIndex,
      max_tokens: maxTokens,
      status: null,
      ok: false,
      schema_valid: false,
      provider: null,
      routed_model: null,
      fallback_attempts: 0,
      request_id: null,
      latency_ms: Date.now() - startedAt,
      prompt_chars: requestMetadata.prompt_chars,
      system_prompt_chars: requestMetadata.system_prompt_chars,
      schema_chars: requestMetadata.schema_chars,
      report_count: requestMetadata.report_count,
      active_event_count: requestMetadata.active_event_count,
      prompt_tokens: 0,
      completion_tokens: 0,
      finish_reason: [],
      content_chars: null,
      serialized_output_chars: null,
      decision_count: null,
      reports_represented: null,
      failure_category: diagnostics.error_name === "TimeoutError" ? "upstream_timeout" : "transport_failure",
      validation_error: null,
      error_code: diagnostics.error_code,
      error_message: diagnostics.error_message,
      error_last_status: null,
      error_last_error: null,
      error_attempts: [],
      provider_attempts: [],
      transport: diagnostics
    };
  }
}

function summarizeTokenSweepCeiling(maxTokens, requests) {
  const latency = requests.map((request) => request.latency_ms).filter(Number.isFinite);
  const errorCounts = new Map();
  const providerWins = new Map();
  for (const request of requests) {
    if (request.failure_category) errorCounts.set(request.failure_category, (errorCounts.get(request.failure_category) || 0) + 1);
    if (request.status >= 200 && request.status < 300 && request.provider) {
      const key = `${request.provider}/${request.routed_model || "unknown"}`;
      providerWins.set(key, (providerWins.get(key) || 0) + 1);
    }
  }
  return {
    max_tokens: maxTokens,
    requests: requests.length,
    http_success: requests.filter((request) => request.status >= 200 && request.status < 300).length,
    schema_valid: requests.filter((request) => request.schema_valid).length,
    terminal_502: requests.filter((request) => request.status === 502).length,
    terminal_5xx: requests.filter((request) => request.status >= 500 && request.status <= 599).length,
    transport_failures: requests.filter((request) => request.status === null && request.failure_category === "transport_failure").length,
    error_counts: Object.fromEntries(errorCounts),
    provider_wins: Object.fromEntries(providerWins),
    fallback_attempts: requests.reduce((sum, request) => sum + (request.fallback_attempts || 0), 0),
    total_prompt_tokens: requests.reduce((sum, request) => sum + (request.prompt_tokens || 0), 0),
    total_completion_tokens: requests.reduce((sum, request) => sum + (request.completion_tokens || 0), 0),
    average_prompt_tokens: average(requests.map((request) => request.prompt_tokens).filter((value) => value > 0)),
    average_completion_tokens: average(requests.map((request) => request.completion_tokens).filter((value) => value > 0)),
    median_latency_ms: median(latency),
    p95_latency_ms: percentile(latency, 0.95),
    maximum_latency_ms: latency.length > 0 ? Math.max(...latency) : null,
    requests_detail: requests
  };
}

function extractFinishReasons(body) {
  const choices = Array.isArray(body?.choices) ? body.choices : [];
  return choices.map((choice) => typeof choice?.finish_reason === "string" ? choice.finish_reason : null);
}

function extractNebulaErrorInfo(body) {
  const error = body && typeof body.error === "object" && body.error !== null ? body.error : {};
  const code = firstNonEmpty([error.code, error.error_code]);
  const message = firstNonEmpty([error.message, error.error_message]);
  return {
    error_code: code,
    error_message: message,
    error_last_status: error.last_status ?? null,
    error_last_error: safeDiagnosticValue(error.last_error),
    error_attempts: Array.isArray(error.attempts) ? error.attempts.map((attempt) => safeDiagnosticValue(attempt)) : []
  };
}

function normalizeGatewayAttempts(attempts) {
  if (!Array.isArray(attempts)) return [];
  return attempts.map((attempt) => {
    const value = attempt && typeof attempt === "object" ? attempt : {};
    const nestedError = value.error && typeof value.error === "object" ? value.error : {};
    const route = parseRoutedVia(firstNonEmpty([value.routed_via, value.route, value.routedVia]));
    return {
      provider: firstNonEmpty([value.provider, value.provider_name]) || route.provider,
      model: firstNonEmpty([value.model, value.routed_model, value.model_name]) || route.model,
      status: Number.isFinite(Number(value.status)) ? Number(value.status) : null,
      error_code: firstNonEmpty([value.error_code, value.code, nestedError.code, nestedError.error_code]),
      error_message: firstNonEmpty([value.error_message, value.message, nestedError.message, nestedError.error_message])
    };
  });
}

function classifyTokenDiagnosticFailure(status, errorCode, output, schemaValid, validationError) {
  const code = String(errorCode || "").toLowerCase();
  if (code.includes("structured_json_invalid") || code.includes("json_invalid")) return "structured_json_invalid";
  if (code.includes("structured_schema_invalid") || code.includes("schema_invalid")) return "structured_schema_invalid";
  if (code.includes("timeout") || code.includes("upstream_timeout")) return "upstream_timeout";
  if (status === 429 || code === "429" || code.includes("rate_limit")) return "429";
  if (status === 401 || status === 403 || code.includes("auth")) return "auth";
  if (code.includes("model_unavailable") || code.includes("model-unavailable")) return "model_unavailable";
  if (code.includes("provider_error") || code.includes("provider-error")) return "provider_error";
  if (status >= 500 && status <= 599) return "provider_5xx";
  if (status >= 200 && status < 300 && !output) return "structured_json_invalid";
  if (status >= 200 && status < 300 && output && !schemaValid) return "structured_schema_invalid";
  if (validationError) return "structured_schema_invalid";
  if (status !== 200 && status !== null) return "other";
  return null;
}

function describeDiagnosticError(error) {
  const cause = error && typeof error === "object" && error.cause && typeof error.cause === "object" ? error.cause : null;
  return {
    error_name: error?.name || "Error",
    error_message: redactDiagnosticText(error?.message || String(error)),
    error_code: error?.code || null,
    cause_name: cause?.name || null,
    cause_message: redactDiagnosticText(cause?.message || ""),
    cause_code: cause?.code || null
  };
}

function safeDiagnosticValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return redactDiagnosticText(value).slice(0, 4_000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 64).map(safeDiagnosticValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, item]) => [key, safeDiagnosticValue(item)]));
  }
  return String(value);
}

function safeDiagnosticJson(body, bodyText) {
  const value = body !== null && body !== undefined ? JSON.stringify(safeDiagnosticValue(body)) : bodyText;
  return redactDiagnosticText(value || "").slice(0, 20_000);
}

function redactDiagnosticText(value) {
  let text = String(value || "");
  if (API_KEY) text = text.split(API_KEY).join("[REDACTED]");
  return text.replace(/Bearer\s+[^\s"']+/giu, "Bearer [REDACTED]");
}

async function runHighDensityExperiment(rows, events, cap) {
  const chronological = [...rows].sort((left, right) => String(left.published_at || left.observed_at).localeCompare(String(right.published_at || right.observed_at)) || left.id - right.id);
  const groups = [];
  for (let index = 0; index < 10; index += 1) {
    const start = Math.floor(index * (chronological.length - 28) / 9);
    groups.push(chronological.slice(start, start + 28));
  }
  const results = [];
  for (const group of groups) {
    const date = new Date(group[0].published_at || group[0].observed_at);
    date.setUTCSeconds(0, 0);
    date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 5) * 5);
    const batch = { window_start: new Date(date.getTime() - 5 * 60 * 1_000).toISOString(), window_end: date.toISOString(), reports: group };
    const selectedEvents = selectEventsForBatch(events, batch, cap);
    try {
      const result = await callNebula(group, selectedEvents, "primary");
      const valid = validateQueueReplayOutput(result.output, { report_ids: group.map((report) => report.id), active_event_ids: selectedEvents.map((event) => event.event_id) });
      results.push({
        window_end: batch.window_end,
        report_count: group.length,
        active_event_count: selectedEvents.length,
        valid,
        attempts: result.attempts.map((attempt) => ({
          status: attempt.telemetry.status,
          provider: attempt.telemetry.provider,
          routed_model: attempt.telemetry.routed_model,
          fallback_attempts: attempt.telemetry.fallback_attempts,
          request_id: attempt.telemetry.request_id,
          latency_ms: attempt.telemetry.latency_ms,
          prompt_chars: attempt.telemetry.prompt_chars,
          schema_chars: attempt.telemetry.schema_chars,
          prompt_tokens: attempt.prompt_tokens,
          output_tokens: attempt.output_tokens
        }))
      });
    } catch (error) {
      results.push({ window_end: batch.window_end, report_count: group.length, active_event_count: selectedEvents.length, valid: false, error: error instanceof Error ? error.message : String(error), attempts: (error?.attempts || []).map((attempt) => attempt.telemetry) });
    }
  }
  const attempts = results.flatMap((result) => result.attempts || []);
  const successful = results.filter((result) => result.valid).length;
  const finalResponses = attempts.filter((attempt) => attempt.status >= 200 && attempt.status < 300);
  const latency = finalResponses.map((attempt) => attempt.latency_ms).filter(Number.isFinite);
  const providers = new Map();
  for (const attempt of finalResponses) {
    const entry = providers.get(attempt.provider || "unknown") || { calls: 0, fallback_attempts: 0 };
    entry.calls += 1;
    entry.fallback_attempts += attempt.fallback_attempts || 0;
    providers.set(attempt.provider || "unknown", entry);
  }
  return {
    requests: groups.length,
    successful,
    failed: groups.length - successful,
    http_successes: finalResponses.length,
    fallback_attempts: attempts.reduce((sum, attempt) => sum + (attempt.fallback_attempts || 0), 0),
    median_latency_ms: median(latency),
    p95_latency_ms: percentile(latency, 0.95),
    total_input_tokens: attempts.reduce((sum, attempt) => sum + (attempt.prompt_tokens || 0), 0),
    total_output_tokens: attempts.reduce((sum, attempt) => sum + (attempt.output_tokens || 0), 0),
    average_input_tokens_per_success: successful === 0 ? null : Number((attempts.filter((attempt) => attempt.status >= 200 && attempt.status < 300).reduce((sum, attempt) => sum + (attempt.prompt_tokens || 0), 0) / successful).toFixed(2)),
    average_output_tokens_per_success: successful === 0 ? null : Number((attempts.filter((attempt) => attempt.status >= 200 && attempt.status < 300).reduce((sum, attempt) => sum + (attempt.output_tokens || 0), 0) / successful).toFixed(2)),
    provider_distribution: [...providers.entries()].map(([provider, value]) => ({ provider, ...value })),
    requests_detail: results
  };
}

async function callNebula(batchReports, events, pass, options = {}) {
  const expectedPostIds = options.expectedPostIds || batchReports.map((report) => report.id);
  const duplicateTargetPostIds = options.duplicateTargetPostIds || batchReports.map((report) => report.id);
  const userPrompt = buildUserPrompt(batchReports, events, pass, options);
  if (userPrompt.length + INTELLIGENCE_SYSTEM_PROMPT.length > MAX_PAYLOAD_CHARS) throw new Error("backtest_payload_too_large");
  const responseSchema = scopeIntelligenceBatchJsonSchema(expectedPostIds, events.map((event) => event.event_id), duplicateTargetPostIds);
  const requestPayload = {
    model: "radar-fast",
    messages: [
      { role: "system", content: INTELLIGENCE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "radar_intelligence_batch",
        strict: true,
        schema: responseSchema
      }
    },
    temperature: 0.1,
    max_tokens: 2_000
  };
  const requestMetadata = {
    prompt_chars: userPrompt.length,
    system_prompt_chars: INTELLIGENCE_SYSTEM_PROMPT.length,
    schema_chars: JSON.stringify(responseSchema).length,
    active_event_count: events.length,
    active_event_ids: events.map((event) => event.event_id),
    report_count: batchReports.length,
    pass
  };
  const attempts = [];

  for (let logicalAttempt = 1; logicalAttempt <= 2; logicalAttempt += 1) {
    const startedAt = Date.now();
    let response;
    let body = null;
    try {
      ({ response, body } = await fetchNebulaResponse(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(requestPayload),
      }));
    } catch (cause) {
      const telemetry = { ...buildNebulaTelemetry(null, null, startedAt, "radar-fast"), ...requestMetadata, logical_attempt: logicalAttempt, logical_retry: logicalAttempt > 1 };
      const error = new Error(cause?.name === "TimeoutError" ? `nebula_timeout_${REQUEST_TIMEOUT_MS}` : `nebula_request_failed:${cause instanceof Error ? cause.message : String(cause)}`);
      error.backtestCode = cause?.name === "TimeoutError" ? "timeout" : "transport_failure";
      telemetry.logical_error = error.backtestCode;
      error.telemetry = telemetry;
      attempts.push({ telemetry, structured_json: false, prompt_tokens: 0, output_tokens: 0 });
      error.attempts = attempts;
      error.request_payload = requestPayload;
      if (logicalAttempt === 1 && error.backtestCode === "transport_failure") {
        await waitForBacktestRetry();
        continue;
      }
      throw error;
    }

    const telemetry = { ...buildNebulaTelemetry(response, body, startedAt, "radar-fast"), ...requestMetadata, logical_attempt: logicalAttempt, logical_retry: logicalAttempt > 1 };
    const promptTokens = Number(body?.usage?.prompt_tokens || 0);
    const outputTokens = Number(body?.usage?.completion_tokens || body?.usage?.output_tokens || 0);
    telemetry.prompt_tokens = promptTokens;
    telemetry.output_tokens = outputTokens;
    const attempt = { telemetry, structured_json: false, prompt_tokens: promptTokens, output_tokens: outputTokens };
    attempts.push(attempt);
    if (!response.ok) {
      const error = new Error(`nebula_http_${response.status}`);
      error.backtestCode = `http_${response.status}`;
      error.telemetry = telemetry;
      error.attempts = attempts;
      error.request_payload = requestPayload;
      if (logicalAttempt === 1 && isTransientBacktestStatus(response.status)) {
        await waitForBacktestRetry();
        continue;
      }
      throw error;
    }
    const output = parseOutput(body);
    if (!output) {
      const error = new Error("nebula_backtest_invalid_json");
      error.backtestCode = "malformed_json";
      error.telemetry = { ...telemetry, structured_json: false };
      error.attempts = attempts;
      error.request_payload = requestPayload;
      throw error;
    }
    attempt.structured_json = true;
    const outputChars = JSON.stringify(output).length;
    return {
      output,
      prompt_tokens: promptTokens > 0 ? promptTokens : Math.ceil(userPrompt.length / 4),
      output_tokens: outputTokens > 0 ? outputTokens : Math.ceil(outputChars / 4),
      prompt_tokens_estimated: promptTokens <= 0,
      output_tokens_estimated: outputTokens <= 0,
      telemetry: { ...telemetry, structured_json: true },
      attempts,
      request_payload: requestPayload,
      request_metadata: requestMetadata,
      report_count: batchReports.length,
      end_to_end_latency_ms: Date.now() - startedAt
    };
  }
  throw new Error("nebula_logical_retry_exhausted");
}

async function fetchNebulaResponse(url, init) {
  const controller = new AbortController();
  const request = fetch(url, { ...init, signal: controller.signal }).then(async (response) => {
    const bodyText = await response.text();
    let body = null;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }
    return { response, body, body_text: bodyText.slice(0, 2_000_000) };
  });
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      const error = new Error(`nebula_timeout_${REQUEST_TIMEOUT_MS}`);
      error.name = "TimeoutError";
      reject(error);
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function replayGatewayFailures(artifacts) {
  const gatewayArtifacts = artifacts.filter((artifact) => {
    const last = artifact.attempts.at(-1);
    return last && (last.status === 502 || last.status === 503 || last.status === 504 || last.status === null);
  });
  const replayResults = [];
  for (const artifact of gatewayArtifacts) {
    const attempts = [];
    let recovered = false;
    for (let queueAttempt = 1; queueAttempt <= 3; queueAttempt += 1) {
      const startedAt = Date.now();
      let response = null;
      let body = null;
      let failure = null;
      try {
        ({ response, body } = await fetchNebulaResponse(`${BASE_URL}/chat/completions`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
          body: JSON.stringify(artifact.request_payload)
        }));
        const telemetry = { ...buildNebulaTelemetry(response, body, startedAt, "radar-fast"), queue_attempt: queueAttempt };
        const output = parseOutput(body);
        const structured = Boolean(response.ok && output);
        const valid = structured && validateQueueReplayOutput(output, artifact);
        attempts.push({ queue_attempt: queueAttempt, ...telemetry, structured_json: structured, valid, prompt_tokens: Number(body?.usage?.prompt_tokens || 0), output_tokens: Number(body?.usage?.completion_tokens || body?.usage?.output_tokens || 0) });
        if (response.ok && valid) {
          recovered = true;
          break;
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        attempts.push({ queue_attempt: queueAttempt, status: null, request_id: null, fallback_attempts: 0, latency_ms: Date.now() - startedAt, structured_json: false, valid: false, failure });
      }
    }
    replayResults.push({
      report_ids: artifact.report_ids,
      window_end: artifact.window_end,
      initial_request_ids: artifact.request_ids,
      attempts,
      recovered,
      final_request_id: attempts.at(-1)?.request_id ?? null
    });
  }
  fs.mkdirSync(DIAGNOSTIC_ROOT, { recursive: true });
  fs.writeFileSync(path.join(DIAGNOSTIC_ROOT, "queue-equivalent-replay.json"), `${JSON.stringify(replayResults, null, 2)}\n`, "utf8");
  return replayResults;
}

function validateQueueReplayOutput(output, artifact) {
  try {
    validateDecisions(output, artifact.report_ids.map((id) => ({ id })), new Set(artifact.active_event_ids), new Set(artifact.report_ids));
    return true;
  } catch {
    return false;
  }
}

function buildUserPrompt(batchReports, events, pass, options = {}) {
  return JSON.stringify({
    task: "Classify every supplied report exactly once. Group reports that describe the same real-world event.",
    pass,
    output_rules: {
      actions: [...ACTIONS],
      event_id: "Use only an active event_id supplied below; use null for NEW_EVENT, DUPLICATE, NOISE, or UNCERTAIN.",
      duplicate_of_post_id: "For DUPLICATE, use one supplied post_id as the canonical report.",
      independent_confirmations: "Never return or calculate this field. Radar computes it from origin groups.",
      coverage: "Every report id must appear in exactly one decision. Do not omit or repeat ids.",
      decision_schema: {
        post_ids: "array of supplied integer post IDs",
        action: [...ACTIONS],
        event_id: "positive supplied active event ID or null",
        duplicate_of_post_id: "positive supplied post ID or null; required only for DUPLICATE",
        confidence: "number from 0 to 1",
        canonical_fact: "non-empty fact summary, maximum 800 characters",
        category: [...CATEGORIES],
        reason: "non-empty explanation, maximum 1000 characters"
      }
    },
    reports: batchReports.map(compactReport),
    prior_decisions: options.priorDecisions?.length ? options.priorDecisions : undefined,
    correction: pass === "correction" ? {
      validation_error: options.correctionError,
      instruction: "Correct only the deterministic decision-graph error. Use only supplied report and event IDs. Do not invent facts, IDs, or relationships."
    } : undefined,
    active_events: events.map((event) => ({
      event_id: event.event_id,
      core_fact: event.core_fact,
      category: event.category,
      first_seen_at: event.first_seen_at,
      last_updated_at: event.last_updated_at,
      source_names: event.source_names,
      source_count: event.source_count,
      existing_confirmation_count_is_context_only: event.independent_confirmation_count
    }))
  });
}

function validateDecisions(output, batchReports, knownEventIds, allowedPostIds) {
  if (!output || !Array.isArray(output.decisions) || output.decisions.length === 0) throw validationError("missing_assignments", "decisions_missing");
  const expected = new Set(batchReports.map((report) => report.id));
  const assigned = new Set();
  for (const decision of output.decisions) {
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) throw validationError("schema_failure", "decision_shape_invalid");
    const allowedKeys = new Set(["post_ids", "action", "event_id", "duplicate_of_post_id", "confidence", "canonical_fact", "category", "reason"]);
    if (Object.keys(decision).some((key) => !allowedKeys.has(key))) throw validationError("schema_failure", "decision_unknown_field");
    if (!Object.hasOwn(decision, "duplicate_of_post_id")) throw validationError("schema_failure", "duplicate_target_missing");
    if (!ACTIONS.has(decision.action) || !Array.isArray(decision.post_ids) || decision.post_ids.length === 0 || decision.post_ids.length > 40) throw validationError("schema_failure", "decision_shape_invalid");
    if (new Set(decision.post_ids).size !== decision.post_ids.length || decision.post_ids.some((postId) => !Number.isInteger(postId) || postId <= 0)) throw validationError("schema_failure", "post_ids_invalid");
    if (decision.event_id !== null && (!Number.isInteger(decision.event_id) || !knownEventIds.has(decision.event_id))) throw validationError(decision.event_id == null ? "schema_failure" : "unknown_event_id", `unknown_event_id:${decision.event_id}`);
    if (typeof decision.confidence !== "number" || !Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) throw validationError("schema_failure", "confidence_invalid");
    if (typeof decision.canonical_fact !== "string" || decision.canonical_fact.length < 1 || decision.canonical_fact.length > 800 || typeof decision.reason !== "string" || decision.reason.length < 1 || decision.reason.length > 1_000 || !CATEGORIES.has(decision.category)) throw validationError("schema_failure", "decision_field_invalid");
    for (const postId of decision.post_ids) {
      if (!allowedPostIds.has(Number(postId))) throw validationError("unknown_post_id", `unknown_post_id:${postId}`);
      if (assigned.has(Number(postId))) throw validationError("contradictory_assignment", `duplicate_assignment:${postId}`);
      assigned.add(Number(postId));
    }
    const duplicateTarget = decision.duplicate_of_post_id ?? null;
    if (decision.action === "DUPLICATE" && (!Number.isInteger(duplicateTarget) || !allowedPostIds.has(duplicateTarget) || decision.post_ids.includes(duplicateTarget))) throw validationError("duplicate_target_violation", "duplicate_target_invalid");
    if (decision.action !== "DUPLICATE" && duplicateTarget !== null) throw validationError("duplicate_target_violation", "duplicate_target_action_invalid");
    if ((decision.action === "MATCH_EXISTING_EVENT" || decision.action === "UPDATE_EXISTING_EVENT") !== (decision.event_id !== null)) throw validationError("action_reference_mismatch", "event_id_action_invalid");
  }
  if (assigned.size !== expected.size || [...expected].some((id) => !assigned.has(id))) throw validationError("missing_assignments", "report_coverage_invalid");
  return output.decisions.map((decision) => ({ ...decision, duplicate_of_post_id: decision.duplicate_of_post_id ?? null }));
}

function validationError(code, message) {
  const error = new Error(message);
  error.backtestCode = code;
  return error;
}

function buildNebulaTelemetry(response, body, startedAt, requestedModel) {
  const headers = response?.headers;
  const route = parseRoutedVia(getHeader(headers, ["x-routed-via"]));
  const fallbackCount = firstNumber([getHeader(headers, ["x-fallback-attempts"])]) ?? 0;
  return {
    requested_model: requestedModel,
    provider: route.provider || "unknown",
    routed_model: route.model,
    fallback_attempts: fallbackCount,
    request_id: getHeader(headers, ["x-request-id"]),
    status: response?.status ?? null,
    latency_ms: Date.now() - startedAt,
    body_model: firstNonEmpty([body?.model]),
    structured_json: false
  };
}

function recordNebulaTelemetry(metrics, telemetry) {
  if (!telemetry) return;
  metrics.request_telemetry.push({
    requested_model: telemetry.requested_model,
    provider: telemetry.provider,
    routed_model: telemetry.routed_model,
    request_id: telemetry.request_id,
    status: telemetry.status,
    latency_ms: telemetry.latency_ms,
    fallback_attempts: telemetry.fallback_attempts,
    logical_attempt: telemetry.logical_attempt,
    logical_retry: telemetry.logical_retry,
    prompt_chars: telemetry.prompt_chars,
    system_prompt_chars: telemetry.system_prompt_chars,
    schema_chars: telemetry.schema_chars,
    active_event_count: telemetry.active_event_count,
    active_event_ids: telemetry.active_event_ids,
    report_count: telemetry.report_count,
    pass: telemetry.pass,
    logical_kind: telemetry.logical_kind,
    final_attempt: telemetry.final_attempt,
    prompt_tokens: telemetry.prompt_tokens ?? null,
    output_tokens: telemetry.output_tokens ?? null
  });
  const success = telemetry.status != null && telemetry.status >= 200 && telemetry.status < 300;
  if (success) metrics.nebula_successful += 1;
  else metrics.nebula_failed += 1;
  if (telemetry.status === 429) metrics.http_429 += 1;
  if (telemetry.status != null && telemetry.status >= 500) metrics.http_5xx += 1;
  metrics.fallback_attempts += telemetry.fallback_attempts || 0;
  if (success && telemetry.fallback_attempts > 0) metrics.fallback_wins += 1;
  metrics.fallback_recoveries += success && telemetry.fallback_attempts > 0 ? 1 : 0;
  const provider = telemetry.provider || "unknown";
  const entry = metrics.provider_distribution.get(provider) || { calls: 0, success: 0, failure: 0, fallback_wins: 0 };
  entry.calls += 1;
  if (success) entry.success += 1;
  else entry.failure += 1;
  if (success && telemetry.fallback_attempts > 0) entry.fallback_wins += 1;
  metrics.provider_distribution.set(provider, entry);
  if (telemetry.routed_model) metrics.routed_model_distribution.set(telemetry.routed_model, (metrics.routed_model_distribution.get(telemetry.routed_model) || 0) + 1);
}

function summarizeProviderBehavior(telemetryRecords) {
  const groups = new Map();
  for (const telemetry of telemetryRecords.filter((item) => item.status >= 200 && item.status < 300)) {
    const provider = telemetry.provider || "unknown";
    const values = groups.get(provider) || [];
    values.push(telemetry);
    groups.set(provider, values);
  }
  return [...groups.entries()].map(([provider, values]) => ({
    provider,
    requests: values.length,
    median_reports: median(values.map((value) => value.report_count).filter(Number.isFinite)),
    median_events: median(values.map((value) => value.active_event_count).filter(Number.isFinite)),
    median_prompt_chars: median(values.map((value) => value.prompt_chars).filter(Number.isFinite)),
    median_schema_chars: median(values.map((value) => value.schema_chars).filter(Number.isFinite)),
    median_input_tokens: median(values.map((value) => value.prompt_tokens).filter(Number.isFinite)),
    median_latency_ms: median(values.map((value) => value.latency_ms).filter(Number.isFinite)),
    fallback_attempts: values.reduce((sum, value) => sum + (value.fallback_attempts || 0), 0),
    routed_models: [...new Set(values.map((value) => value.routed_model).filter(Boolean))]
  }));
}

function recordCallResult(metrics, result, error, kind) {
  const attempts = result?.attempts || error?.attempts || [];
  metrics.logical_requests_total += 1;
  attempts.forEach((attempt, index) => {
    attempt.telemetry.logical_kind = kind;
    attempt.telemetry.final_attempt = index === attempts.length - 1;
    recordNebulaTelemetry(metrics, attempt.telemetry);
  });

  const first = attempts[0];
  const initialSucceeded = Boolean(first?.structured_json && first.telemetry?.status >= 200 && first.telemetry?.status < 300);
  if (kind === "primary") {
    metrics.initial_logical_requests += 1;
    if (initialSucceeded) metrics.initial_successes += 1;
    else metrics.initial_failures += 1;
    if (first?.telemetry?.status === 502) metrics.initial_http_502 += 1;
    if (first?.telemetry?.status == null && first && first.telemetry.logical_error !== "timeout") metrics.initial_transport_failures += 1;
    if (first?.telemetry?.status == null && first?.telemetry?.logical_error === "timeout") metrics.initial_timeouts += 1;
    if (first?.telemetry?.status === 408) metrics.initial_timeouts += 1;
    if (first?.telemetry?.latency_ms != null) metrics.initial_latency_samples.push(first.telemetry.latency_ms);
  }
  if (attempts.length > 1) {
    metrics.transient_retry_calls += attempts.length - 1;
    const last = attempts[attempts.length - 1];
    const retrySucceeded = Boolean(last?.structured_json && last.telemetry?.status >= 200 && last.telemetry?.status < 300);
    if (retrySucceeded) metrics.transient_retry_successes += 1;
    else metrics.transient_retry_failures += 1;
  }
}

function recordInitialGatewayForensics(metrics, batch, events, result, error) {
  const attempts = result?.attempts || error?.attempts || [];
  const first = attempts[0];
  if (!first || first.telemetry?.status !== 502) return;
  const last = attempts.at(-1);
  metrics.initial_gateway_forensics.push({
    window_end: batch.window_end,
    report_ids: batch.reports.map((report) => report.id),
    report_count: batch.reports.length,
    active_event_count: events.length,
    active_event_ids: events.map((event) => event.event_id),
    prompt_chars: first.telemetry.prompt_chars,
    system_prompt_chars: first.telemetry.system_prompt_chars,
    schema_chars: first.telemetry.schema_chars,
    input_tokens: first.prompt_tokens || first.telemetry.prompt_tokens || 0,
    first_request_id: first.telemetry.request_id,
    retry_request_id: attempts[1]?.telemetry?.request_id ?? null,
    first_fallbacks: first.telemetry.fallback_attempts,
    retry_fallbacks: attempts[1]?.telemetry?.fallback_attempts ?? null,
    retry_status: last?.telemetry?.status ?? null,
    retry_result: last?.structured_json && last.telemetry?.status >= 200 && last.telemetry?.status < 300 ? "success" : "failed"
  });
}

function addTokenMetricsFromCall(metrics, result, kind = "primary") {
  for (const attempt of result?.attempts || []) {
    if (!attempt.structured_json) continue;
    addTokenMetrics(metrics, {
      prompt_tokens: attempt.prompt_tokens > 0 ? attempt.prompt_tokens : Math.ceil((result.prompt_tokens || 0)),
      output_tokens: attempt.output_tokens > 0 ? attempt.output_tokens : Math.ceil((result.output_tokens || 0)),
      prompt_tokens_estimated: attempt.prompt_tokens <= 0,
      output_tokens_estimated: attempt.output_tokens <= 0
    }, result.report_count || 0, kind);
}
}

function isTransientBacktestStatus(status) {
  return status === 502 || status === 503 || status === 504;
}

function isCorrectableBacktestError(error) {
  return error?.backtestCode === "duplicate_target_violation"
    || error?.backtestCode === "contradictory_assignment"
    || error?.backtestCode === "missing_assignments"
    || error?.backtestCode === "action_reference_mismatch";
}

async function waitForBacktestRetry() {
  await new Promise((resolve) => setTimeout(resolve, 250));
}

function addTokenMetrics(metrics, result, reportCount, kind = "primary") {
  metrics.prompt_tokens += result.prompt_tokens;
  metrics.output_tokens += result.output_tokens;
  metrics.token_samples.push({ kind, reports: reportCount, input_tokens: result.prompt_tokens, output_tokens: result.output_tokens });
  if (result.prompt_tokens_estimated) metrics.estimated_prompt_tokens += result.prompt_tokens;
  if (result.output_tokens_estimated) metrics.estimated_output_tokens += result.output_tokens;
}

function recordRejectedResponse(metrics, error) {
  metrics.rejected_unsafe_responses += 1;
  const code = String(error?.backtestCode || error?.message || "unknown");
  if (code === "timeout") metrics.timeouts += 1;
  else if (code === "malformed_json") metrics.malformed_json += 1;
  else if (code === "schema_failure") metrics.schema_failures += 1;
  else if (code === "unknown_post_id") metrics.unknown_post_ids += 1;
  else if (code === "unknown_event_id") metrics.unknown_event_ids += 1;
  else if (code === "duplicate_target_violation") metrics.duplicate_target_violations += 1;
  else if (code === "contradictory_assignment") metrics.contradictory_assignments += 1;
  else if (code === "missing_assignments") metrics.missing_assignments += 1;
}

function getHeader(headers, names) {
  for (const name of names) {
    const value = headers?.get(name);
    if (value) return value;
  }
  return null;
}

function firstNonEmpty(values) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() || null;
}

function firstNumber(values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function parseRoutedVia(value) {
  const route = String(value || "").trim();
  if (!route) return { provider: null, model: null };
  const slash = route.indexOf("/");
  if (slash < 0) return { provider: route, model: null };
  return { provider: route.slice(0, slash) || null, model: route.slice(slash + 1) || null };
}

function compareWithProductionRelationships(batch, decisions, metrics) {
  const predictedGroup = new Map();
  const reportsById = new Map(batch.map((report) => [report.id, report]));
  decisions.forEach((decision, index) => decision.post_ids.forEach((postId) => predictedGroup.set(postId, `${decision.action}:${decision.event_id ?? `new:${index}`}`)));
  const actualEventReports = new Map();
  for (const report of batch) {
    for (const eventId of report.event_ids) {
      const entry = actualEventReports.get(eventId) || [];
      entry.push(report);
      actualEventReports.set(eventId, entry);
    }
  }

  decisions.forEach((decision) => {
    const decisionReports = decision.post_ids.map((postId) => reportsById.get(postId)).filter(Boolean);
    const actualEvents = new Set(decisionReports.flatMap((report) => [...report.event_ids]));
    const uncertain = decision.action === "UNCERTAIN" || decision.confidence < AMBIGUITY_THRESHOLD;
    const existingAgreement = (decision.action === "MATCH_EXISTING_EVENT" || decision.action === "UPDATE_EXISTING_EVENT")
      && actualEvents.size === 1 && actualEvents.has(Number(decision.event_id));
    const duplicateAgreement = decision.action === "DUPLICATE" && actualEvents.size === 1;
    const newAgreement = decision.action === "NEW_EVENT" && actualEvents.size <= 1;
    const agreement = existingAgreement || duplicateAgreement || newAgreement;

    if (!uncertain && agreement) {
      if (newAgreement) metrics.new_event_agreements += 1;
      else metrics.existing_event_agreements += 1;
      addReview(metrics.manual_review.agreements, {
        reports: decisionReports.map(reviewReport),
        decision: reviewDecision(decision),
        historical_event_ids: [...actualEvents]
      }, 10);
    } else if (!uncertain && (decision.action === "MATCH_EXISTING_EVENT" || decision.action === "UPDATE_EXISTING_EVENT" || decision.action === "DUPLICATE" || decision.action === "NOISE")) {
      metrics.disagreements += 1;
      addReview(metrics.manual_review.disagreements, {
        reports: decisionReports.map(reviewReport),
        decision: reviewDecision(decision),
        historical_event_ids: [...actualEvents]
      }, 10);
    }

    if (!uncertain && actualEvents.size > 1) {
      metrics.false_merge_candidates += 1;
      metrics.disagreements += 1;
      const review = {
        reports: decisionReports.map(reviewReport),
        decision: reviewDecision(decision),
        historical_event_ids: [...actualEvents],
        time_span_hours: timeSpanHours(decisionReports),
        shared_terms: sharedTerms(decisionReports.map((report) => report.text))
      };
      addReview(metrics.manual_review.false_merges, review, 20);
      if (review.shared_terms.length > 0) addReview(metrics.manual_review.same_entity_different_event, review, 20);
      if ((review.time_span_hours || 0) >= 24) addReview(metrics.manual_review.temporal, review, 20);
    }
  });

  for (const [eventId, eventReports] of actualEventReports) {
    const groups = new Set(eventReports.map((report) => predictedGroup.get(report.id)));
    if (groups.size <= 1) continue;
    metrics.false_split_candidates += 1;
    metrics.disagreements += 1;
    const review = {
      historical_event_id: eventId,
      reports: eventReports.map((report) => ({ ...reviewReport(report), predicted_group: predictedGroup.get(report.id) })),
      predicted_groups: [...groups]
    };
    addReview(metrics.manual_review.false_splits, review, 10);
  }

  for (let leftIndex = 0; leftIndex < batch.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < batch.length; rightIndex += 1) {
      const left = batch[leftIndex];
      const right = batch[rightIndex];
      const actualShared = [...left.event_ids].some((eventId) => right.event_ids.has(eventId));
      if (!actualShared || !isCrossLanguagePair(left.text, right.text)) continue;
      const predictedShared = predictedGroup.get(left.id) === predictedGroup.get(right.id);
      addReview(metrics.manual_review.cross_language, {
        result: predictedShared ? "grouped" : "separated",
        reports: [reviewReport(left), reviewReport(right)],
        predicted_groups: [predictedGroup.get(left.id), predictedGroup.get(right.id)]
      }, 10);
    }
  }
}

function collectCopiedSourceCases(batch, metrics) {
  const byEvent = new Map();
  for (const report of batch) {
    for (const eventId of report.event_ids) {
      const entry = byEvent.get(eventId) || [];
      entry.push(report);
      byEvent.set(eventId, entry);
    }
  }
  for (const [eventId, eventReports] of byEvent) {
    const sourceIds = new Set(eventReports.map((report) => report.source_id));
    const originGroups = new Set(eventReports.flatMap((report) => [...report.origin_groups]));
    if (sourceIds.size < 2 || originGroups.size === 0 || originGroups.size >= sourceIds.size) continue;
    metrics.copied_source_cases += 1;
    addReview(metrics.manual_review.copied_source, {
      historical_event_id: eventId,
      source_ids: [...sourceIds],
      origin_groups: [...originGroups],
      reports: eventReports.map(reviewReport)
    }, 10);
  }
}

function reviewReport(report) {
  return {
    post_id: report.id,
    source_id: report.source_id,
    source_name: report.source_name,
    published_at: report.published_at,
    observed_at: report.observed_at,
    historical_event_ids: [...report.event_ids],
    text: report.text.replace(/\s+/gu, " ").slice(0, REVIEW_TEXT_CHARS)
  };
}

function reviewDecision(decision) {
  return {
    action: decision.action,
    event_id: decision.event_id,
    confidence: decision.confidence,
    category: decision.category,
    reason: String(decision.reason || "").replace(/\s+/gu, " ").slice(0, REVIEW_TEXT_CHARS)
  };
}

function addReview(collection, value, limit) {
  if (collection.length < limit) collection.push(value);
}

function timeSpanHours(reports) {
  const dates = reports.map((report) => new Date(report.published_at || report.observed_at)).filter((date) => !Number.isNaN(date.getTime()));
  if (dates.length < 2) return 0;
  return Number(((Math.max(...dates.map((date) => date.getTime())) - Math.min(...dates.map((date) => date.getTime()))) / 3_600_000).toFixed(3));
}

function sharedTerms(texts) {
  if (texts.length < 2) return [];
  const tokenSets = texts.map((text) => new Set(String(text || "").toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3 && !REVIEW_STOP_WORDS.has(token))));
  return [...tokenSets.slice(1).reduce((common, tokens) => new Set([...common].filter((token) => tokens.has(token))), tokenSets[0] || new Set())].slice(0, 12);
}

function isCrossLanguagePair(left, right) {
  const leftProfile = languageProfile(left);
  const rightProfile = languageProfile(right);
  return (leftProfile.persian && rightProfile.latin) || (leftProfile.latin && rightProfile.persian);
}

function languageProfile(text) {
  return {
    persian: /[\u0600-\u06ff]/u.test(text),
    latin: /[A-Za-z]/u.test(text)
  };
}

function compactReport(report) {
  return {
    post_id: report.id,
    source_id: report.source_id,
    source_name: report.source_name,
    published_at: report.published_at,
    observed_at: report.observed_at,
    text: report.text
  };
}

function parseIntegerList(value) {
  return parseStringList(value).map(Number).filter((number) => Number.isSafeInteger(number) && number > 0);
}

function parseStringList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function average(values) {
  return values.length === 0 ? null : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2)) : Number(sorted[middle].toFixed(2));
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return Number(sorted[index].toFixed(2));
}

function buildProductionProjection(rows, events, metrics, observedTotalCalls) {
  const reportsPerHour = 341;
  const windowsPerHour = 12;
  const reportsPerWindow = reportsPerHour / windowsPerHour;
  const projectionCap = Math.max(1, Math.min(40, Number(process.env.RADAR_PROJECTION_CAP || 20)));
  const highDensityEvidence = loadHighDensityEvidence(projectionCap);
  const secondPassRate = metrics.primary_calls === 0 ? 0 : metrics.second_pass_calls / metrics.primary_calls;
  const correctionRate = metrics.primary_calls === 0 ? 0 : metrics.contract_correction_calls / metrics.primary_calls;
  const effectiveReportsPerBatch = Math.min(MAX_REPORTS_PER_BATCH, reportsPerWindow);
  const batchesPerWindow = Math.max(1, Math.ceil(reportsPerWindow / effectiveReportsPerBatch));
  const primaryCallsPerHour = windowsPerHour * batchesPerWindow;
  const secondPassCallsPerHour = primaryCallsPerHour * secondPassRate;
  const correctionCallsPerHour = primaryCallsPerHour * correctionRate;
  const logicalCallsPerHour = primaryCallsPerHour + secondPassCallsPerHour + correctionCallsPerHour;
  if (!highDensityEvidence) {
    return {
      reports_per_hour: reportsPerHour,
      windows_per_hour: windowsPerHour,
      reports_per_window: Number(reportsPerWindow.toFixed(3)),
      max_reports_per_batch: MAX_REPORTS_PER_BATCH,
      effective_reports_per_batch: Number(effectiveReportsPerBatch.toFixed(3)),
      batches_per_window: batchesPerWindow,
      primary_calls_per_hour: Number(primaryCallsPerHour.toFixed(3)),
      second_pass_calls_per_hour: Number(secondPassCallsPerHour.toFixed(3)),
      contract_corrections_per_hour: Number(correctionCallsPerHour.toFixed(3)),
      input_tokens_per_hour: null,
      output_tokens_per_hour: null,
      token_projection_status: `pending_high_density_cap_${projectionCap}`,
      token_projection_basis: "not extrapolated from low-density historical batches"
    };
  }
  const successfulHttpAttempts = Math.max(1, highDensityEvidence.http_successes || highDensityEvidence.successful || 1);
  const physicalAttemptsPerLogicalRequest = Math.max(1, highDensityEvidence.requests_detail.reduce((sum, request) => sum + (request.attempts?.length || 0), 0) / Math.max(1, highDensityEvidence.requests));
  const inputTokensPerPhysicalRequest = highDensityEvidence.total_input_tokens / successfulHttpAttempts;
  const outputTokensPerPhysicalRequest = highDensityEvidence.total_output_tokens / successfulHttpAttempts;
  const physicalNebulaCallsPerHour = logicalCallsPerHour * physicalAttemptsPerLogicalRequest;
  const inputTokensPerHour = physicalNebulaCallsPerHour * inputTokensPerPhysicalRequest;
  const outputTokensPerHour = physicalNebulaCallsPerHour * outputTokensPerPhysicalRequest;
  return {
    reports_per_hour: reportsPerHour,
    windows_per_hour: windowsPerHour,
    reports_per_window: Number(reportsPerWindow.toFixed(3)),
    max_reports_per_batch: MAX_REPORTS_PER_BATCH,
    effective_reports_per_batch: Number(effectiveReportsPerBatch.toFixed(3)),
    batches_per_window: batchesPerWindow,
    candidate_event_cap: projectionCap,
    target_high_density_requests: highDensityEvidence.requests,
    target_high_density_successes: highDensityEvidence.successful,
    average_target_input_tokens_per_success: Number(inputTokensPerPhysicalRequest.toFixed(2)),
    average_target_output_tokens_per_success: Number(outputTokensPerPhysicalRequest.toFixed(2)),
    physical_attempts_per_logical_request: Number(physicalAttemptsPerLogicalRequest.toFixed(3)),
    primary_calls_per_hour: Number(primaryCallsPerHour.toFixed(3)),
    second_pass_calls_per_hour: Number(secondPassCallsPerHour.toFixed(3)),
    contract_corrections_per_hour: Number(correctionCallsPerHour.toFixed(3)),
    physical_nebula_calls_per_hour: Number(physicalNebulaCallsPerHour.toFixed(3)),
    input_tokens_per_hour: Number(inputTokensPerHour.toFixed(3)),
    output_tokens_per_hour: Number(outputTokensPerHour.toFixed(3)),
    total_calls_per_day: Number((physicalNebulaCallsPerHour * 24).toFixed(3)),
    input_tokens_per_day: Number((inputTokensPerHour * 24).toFixed(3)),
    output_tokens_per_day: Number((outputTokensPerHour * 24).toFixed(3)),
    request_reduction_vs_341_individual_calls: Number((1 - physicalNebulaCallsPerHour / reportsPerHour).toFixed(4)),
    token_projection_status: "measured_high_density_payload",
    token_projection_basis: "10 real historical 28-report payloads at the selected candidate cap"
  };
}

function loadHighDensityEvidence(cap) {
  const file = path.join(DIAGNOSTIC_ROOT, `high-density-cap-${cap}.json`);
  if (!fs.existsSync(file)) return null;
  const evidence = JSON.parse(fs.readFileSync(file, "utf8"));
  return evidence && Array.isArray(evidence.requests_detail) ? evidence : null;
}

function parseOutput(body) {
  const content = body?.choices?.[0]?.message?.content ?? body?.response ?? body?.result?.response ?? body?.result;
  if (content && typeof content === "object" && !Array.isArray(content)) return content;
  if (typeof content !== "string") return null;
  const cleaned = content.replace(/^\s*```(?:json)?\s*/iu, "").replace(/\s*```\s*$/u, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function queryD1(command) {
  const binary = path.resolve(process.cwd(), "node_modules/.bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
  const normalizedCommand = process.platform === "win32" ? command.replace(/\r?\n/gu, " ").trim() : command;
  const commandArgument = process.platform === "win32" ? `\"${normalizedCommand.replaceAll('"', '\\\"')}\"` : normalizedCommand;
  let lastFailure = "unknown";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = spawnSync(binary, ["d1", "execute", "radar-db", "--remote", "--json", "--command", commandArgument], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : false,
      maxBuffer: 20 * 1024 * 1024
    });
    if (result.status !== 0) {
      lastFailure = String(result.stderr || result.stdout).slice(0, 500);
      continue;
    }
    const parsed = JSON.parse(result.stdout);
    const response = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!response?.success) {
      lastFailure = "d1_read_unsuccessful";
      continue;
    }
    return response.results || [];
  }
  throw new Error(`d1_read_failed:${lastFailure}`);
}
