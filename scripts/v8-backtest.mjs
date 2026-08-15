import { spawnSync } from "node:child_process";
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
const SAMPLE_FILTER = SAMPLE === "baseline-v8-500"
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

if (reports.length < 500) {
  console.error(`BACKTEST_BLOCKED: only ${reports.length} usable non-noise reports were returned; at least 500 are required when available.`);
  process.exit(3);
}

const activeEvents = queryD1(`
  SELECT e.id AS event_id, e.core_fact, e.category, e.first_seen_at, e.last_updated_at,
         GROUP_CONCAT(DISTINCT s.name) AS source_names,
         e.source_count, e.independent_confirmation_count
    FROM events e
    LEFT JOIN event_sources es ON es.event_id = e.id
    LEFT JOIN sources s ON s.id = es.source_id
   WHERE e.event_state = 'active'
     AND e.last_updated_at >= datetime('now', '-48 hours')
   GROUP BY e.id
   ORDER BY e.last_updated_at DESC
   LIMIT 40
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

const batches = buildBatches(reports);
const knownEventIds = new Set(activeEvents.map((event) => event.event_id));
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

for (let batchStart = 0; batchStart < batches.length; batchStart += MAX_CONCURRENT_BATCHES) {
  const concurrentBatches = batches.slice(batchStart, batchStart + MAX_CONCURRENT_BATCHES);
  await Promise.all(concurrentBatches.map((batch, offset) => processBatch(batch, batchStart + offset)));
}

async function processBatch(batch, batchIndex) {
  const batchStartedAt = Date.now();
  const correctionState = { used: false };
  let decisions;
  let primaryCallCompleted = false;
  try {
    metrics.primary_calls += 1;
    const primary = await callNebula(batch.reports, activeEvents, "primary");
    recordCallResult(metrics, primary, null, "primary");
    addTokenMetricsFromCall(metrics, primary, "primary");
    primaryCallCompleted = true;
    const primaryValidation = await validateWithCorrection(
      batch.reports,
      activeEvents,
      primary.output,
      batch.reports.map((report) => report.id),
      knownEventIds,
      new Set(batch.reports.map((report) => report.id)),
      correctionState,
      metrics
    );
    decisions = primaryValidation.decisions;
  } catch (error) {
    if (!primaryCallCompleted) recordCallResult(metrics, null, error, "primary");
    metrics.failed_batches += 1;
    metrics.final_logical_batches_failed += 1;
    recordRejectedResponse(metrics, error);
    console.warn(`BACKTEST_BATCH_FAILED window=${batch.window_end} reports=${batch.reports.length} error=${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const uncertainIds = [...new Set(decisions.filter((decision) => decision.action === "UNCERTAIN" || decision.confidence < AMBIGUITY_THRESHOLD).flatMap((decision) => decision.post_ids))];
  metrics.primary_uncertain += uncertainIds.length;

  if (uncertainIds.length > 0) {
    const focusedReports = batch.reports.filter((report) => uncertainIds.includes(report.id));
    const focusedEvents = activeEvents.filter((event) => decisions.some((decision) => decision.event_id === event.event_id && decision.post_ids.some((id) => uncertainIds.includes(id)))).slice(0, 5);
    let secondCallCompleted = false;
    try {
      metrics.second_pass_calls += 1;
      const second = await callNebula(focusedReports, focusedEvents, "ambiguity", {
        expectedPostIds: uncertainIds,
        duplicateTargetPostIds: batch.reports.map((report) => report.id)
      });
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
    } catch (error) {
      metrics.second_pass_failures += 1;
      if (!secondCallCompleted) recordCallResult(metrics, null, error, "ambiguity");
      metrics.failed_batches += 1;
      metrics.final_logical_batches_failed += 1;
      recordRejectedResponse(metrics, error);
      console.warn(`AMBIGUITY_OUTPUT_REJECTED: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }

  try {
    const finalValidation = await validateWithCorrection(
      batch.reports,
      activeEvents,
      { decisions },
      batch.reports.map((report) => report.id),
      knownEventIds,
      new Set(batch.reports.map((report) => report.id)),
      correctionState,
      metrics
    );
    decisions = finalValidation.decisions;
  } catch (error) {
    metrics.failed_batches += 1;
    metrics.final_logical_batches_failed += 1;
    recordRejectedResponse(metrics, error);
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
    try {
      const correction = await callNebula(batchReports, events, "correction", {
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
console.log(JSON.stringify({
  sample_selection: SAMPLE,
  baseline_selection_exactness: SAMPLE === "baseline-v8-500" ? "deterministic_date_bounded_reconstruction" : "latest_ordered_sample",
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

async function callNebula(batchReports, events, pass, options = {}) {
  const expectedPostIds = options.expectedPostIds || batchReports.map((report) => report.id);
  const duplicateTargetPostIds = options.duplicateTargetPostIds || batchReports.map((report) => report.id);
  const userPrompt = buildUserPrompt(batchReports, events, pass, options);
  if (userPrompt.length + INTELLIGENCE_SYSTEM_PROMPT.length > MAX_PAYLOAD_CHARS) throw new Error("backtest_payload_too_large");
  const responseSchema = scopeIntelligenceBatchJsonSchema(expectedPostIds, events.map((event) => event.event_id), duplicateTargetPostIds);
  const attempts = [];

  for (let logicalAttempt = 1; logicalAttempt <= 2; logicalAttempt += 1) {
    const startedAt = Date.now();
    let response;
    let body = null;
    try {
      ({ response, body } = await fetchNebulaResponse(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
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
        }),
      }));
    } catch (cause) {
      const telemetry = { ...buildNebulaTelemetry(null, null, startedAt, "radar-fast"), logical_attempt: logicalAttempt, logical_retry: logicalAttempt > 1 };
      const error = new Error(cause?.name === "TimeoutError" ? `nebula_timeout_${REQUEST_TIMEOUT_MS}` : `nebula_request_failed:${cause instanceof Error ? cause.message : String(cause)}`);
      error.backtestCode = cause?.name === "TimeoutError" ? "timeout" : "transport_failure";
      telemetry.logical_error = error.backtestCode;
      error.telemetry = telemetry;
      attempts.push({ telemetry, structured_json: false, prompt_tokens: 0, output_tokens: 0 });
      error.attempts = attempts;
      if (logicalAttempt === 1 && error.backtestCode === "transport_failure") {
        await waitForBacktestRetry();
        continue;
      }
      throw error;
    }

    const telemetry = { ...buildNebulaTelemetry(response, body, startedAt, "radar-fast"), logical_attempt: logicalAttempt, logical_retry: logicalAttempt > 1 };
    const promptTokens = Number(body?.usage?.prompt_tokens || 0);
    const outputTokens = Number(body?.usage?.completion_tokens || body?.usage?.output_tokens || 0);
    const attempt = { telemetry, structured_json: false, prompt_tokens: promptTokens, output_tokens: outputTokens };
    attempts.push(attempt);
    if (!response.ok) {
      const error = new Error(`nebula_http_${response.status}`);
      error.backtestCode = `http_${response.status}`;
      error.telemetry = telemetry;
      error.attempts = attempts;
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
      report_count: batchReports.length,
      end_to_end_latency_ms: Date.now() - startedAt
    };
  }
  throw new Error("nebula_logical_retry_exhausted");
}

async function fetchNebulaResponse(url, init) {
  const controller = new AbortController();
  const request = fetch(url, { ...init, signal: controller.signal }).then(async (response) => ({
    response,
    body: await response.json().catch(() => null)
  }));
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
    fallback_attempts: telemetry.fallback_attempts
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

function recordCallResult(metrics, result, error, kind) {
  const attempts = result?.attempts || error?.attempts || [];
  metrics.logical_requests_total += 1;
  for (const attempt of attempts) recordNebulaTelemetry(metrics, attempt.telemetry);

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
  const reportPayloadSizes = rows.map((report) => JSON.stringify(compactReport(report)).length);
  const averageReportPayloadChars = average(reportPayloadSizes) || 0;
  const activeEventPromptChars = buildUserPrompt([], events, "primary").length;
  const fixedPromptChars = INTELLIGENCE_SYSTEM_PROMPT.length + activeEventPromptChars;
  const availableReportChars = Math.max(0, MAX_PAYLOAD_CHARS - fixedPromptChars);
  const payloadReportCapacity = averageReportPayloadChars > 0
    ? Math.max(1, Math.floor(availableReportChars / averageReportPayloadChars))
    : MAX_REPORTS_PER_BATCH;
  const effectiveReportsPerBatch = Math.max(1, Math.min(MAX_REPORTS_PER_BATCH, payloadReportCapacity, reportsPerWindow));
  const batchesPerWindow = Math.max(1, Math.ceil(reportsPerWindow / effectiveReportsPerBatch));
  const primaryCallsPerHour = windowsPerHour * batchesPerWindow;
  const secondPassRate = metrics.primary_calls === 0 ? 0 : metrics.second_pass_calls / metrics.primary_calls;
  const secondPassCallsPerHour = primaryCallsPerHour * secondPassRate;
  const correctionRate = metrics.primary_calls === 0 ? 0 : metrics.contract_correction_calls / metrics.primary_calls;
  const correctionCallsPerHour = primaryCallsPerHour * correctionRate;
  const logicalCallsPerHour = primaryCallsPerHour + secondPassCallsPerHour + correctionCallsPerHour;
  const retryRate = metrics.logical_requests_total === 0 ? 0 : metrics.transient_retry_calls / metrics.logical_requests_total;
  const transientRetriesPerHour = logicalCallsPerHour * retryRate;
  const observedPhysicalCalls = metrics.request_telemetry.length;
  const averageFallbackAttemptsPerPhysicalCall = observedPhysicalCalls === 0 ? 0 : metrics.fallback_attempts / observedPhysicalCalls;
  const providerFallbackAttemptsPerHour = logicalCallsPerHour * averageFallbackAttemptsPerPhysicalCall;
  const physicalNebulaCallsPerHour = logicalCallsPerHour + transientRetriesPerHour;
  const averageReportsPerKind = (kind) => {
    const samples = metrics.token_samples.filter((sample) => sample.kind === kind && sample.reports > 0);
    return samples.length === 0 ? effectiveReportsPerBatch : samples.reduce((sum, sample) => sum + sample.reports, 0) / samples.length;
  };
  const averageInputTokensPerReport = (kind) => {
    const samples = metrics.token_samples.filter((sample) => sample.kind === kind && sample.reports > 0);
    return samples.length === 0 ? 0 : samples.reduce((sum, sample) => sum + sample.input_tokens / sample.reports, 0) / samples.length;
  };
  const averageOutputTokensPerCall = (kind) => {
    const samples = metrics.token_samples.filter((sample) => sample.kind === kind);
    return samples.length === 0 ? 0 : samples.reduce((sum, sample) => sum + sample.output_tokens, 0) / samples.length;
  };
  const primaryInputTokensPerCall = effectiveReportsPerBatch * averageInputTokensPerReport("primary");
  const secondInputTokensPerCall = averageInputTokensPerReport("ambiguity") * averageReportsPerKind("ambiguity");
  const correctionInputTokensPerCall = averageInputTokensPerReport("correction") * averageReportsPerKind("correction");
  const primaryOutputTokensPerCall = averageOutputTokensPerCall("primary");
  const secondOutputTokensPerCall = averageOutputTokensPerCall("ambiguity");
  const correctionOutputTokensPerCall = averageOutputTokensPerCall("correction");
  const inputTokensPerLogicalHour = primaryCallsPerHour * primaryInputTokensPerCall
    + secondPassCallsPerHour * secondInputTokensPerCall
    + correctionCallsPerHour * correctionInputTokensPerCall;
  const outputTokensPerLogicalHour = primaryCallsPerHour * primaryOutputTokensPerCall
    + secondPassCallsPerHour * secondOutputTokensPerCall
    + correctionCallsPerHour * correctionOutputTokensPerCall;
  const successfulLogicalCalls = Math.max(1, metrics.token_samples.length);
  const averageInputTokensPerPhysicalCall = metrics.prompt_tokens / successfulLogicalCalls;
  const averageOutputTokensPerPhysicalCall = metrics.output_tokens / successfulLogicalCalls;
  const inputTokensPerHour = inputTokensPerLogicalHour + transientRetriesPerHour * averageInputTokensPerPhysicalCall;
  const outputTokensPerHour = outputTokensPerLogicalHour + transientRetriesPerHour * averageOutputTokensPerPhysicalCall;

  return {
    reports_per_hour: reportsPerHour,
    windows_per_hour: windowsPerHour,
    reports_per_window: Number(reportsPerWindow.toFixed(3)),
    max_reports_per_batch: MAX_REPORTS_PER_BATCH,
    average_report_payload_chars: averageReportPayloadChars,
    active_event_prompt_chars: activeEventPromptChars,
    fixed_prompt_chars: fixedPromptChars,
    payload_report_capacity: payloadReportCapacity,
    effective_reports_per_batch: Number(effectiveReportsPerBatch.toFixed(3)),
    batches_per_window: batchesPerWindow,
    primary_calls_per_hour: Number(primaryCallsPerHour.toFixed(3)),
    second_pass_calls_per_hour: Number(secondPassCallsPerHour.toFixed(3)),
    contract_corrections_per_hour: Number(correctionCallsPerHour.toFixed(3)),
    transient_retries_per_hour: Number(transientRetriesPerHour.toFixed(3)),
    provider_fallback_attempts_per_hour: Number(providerFallbackAttemptsPerHour.toFixed(3)),
    logical_radar_requests_per_hour: Number(logicalCallsPerHour.toFixed(3)),
    physical_nebula_calls_per_hour: Number(physicalNebulaCallsPerHour.toFixed(3)),
    total_nebula_calls_per_hour: Number(physicalNebulaCallsPerHour.toFixed(3)),
    input_tokens_per_hour: Number(inputTokensPerHour.toFixed(3)),
    output_tokens_per_hour: Number(outputTokensPerHour.toFixed(3)),
    primary_calls_per_day: Number((primaryCallsPerHour * 24).toFixed(3)),
    total_calls_per_day: Number((physicalNebulaCallsPerHour * 24).toFixed(3)),
    input_tokens_per_day: Number((inputTokensPerHour * 24).toFixed(3)),
    output_tokens_per_day: Number((outputTokensPerHour * 24).toFixed(3)),
    request_reduction_vs_341_individual_calls: Number((1 - physicalNebulaCallsPerHour / reportsPerHour).toFixed(4)),
    radar_logical_request_reduction_vs_341: Number((1 - logicalCallsPerHour / reportsPerHour).toFixed(4)),
    token_projection_basis: "successful backtest token telemetry by request kind, scaled to 12 five-minute windows and observed retry rates",
    workload: physicalNebulaCallsPerHour <= 100 && metrics.transient_retry_failures === 0 ? "SUSTAINABLE" : "BORDERLINE"
  };
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
