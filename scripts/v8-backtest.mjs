import { spawnSync } from "node:child_process";
import path from "node:path";

const BASE_URL = (process.env.NEBULA_BASE_URL || "https://nebula-free-llm.nebula-ai-company.workers.dev/v1").replace(/\/+$/u, "");
const API_KEY = process.env.NEBULA_API_KEY?.trim();
const LIMIT = Math.max(500, Number(process.env.RADAR_BACKTEST_LIMIT || 500));
const MAX_REPORT_CHARS = 1_800;
const MAX_REPORTS_PER_BATCH = 32;
const MAX_PAYLOAD_CHARS = 60_000;
const AMBIGUITY_THRESHOLD = 0.72;
const CATEGORIES = new Set(["IRAN", "WORLD", "POLITICS", "WAR_SECURITY", "SOCIETY", "ECONOMY", "TECHNOLOGY"]);
const ACTIONS = new Set(["MATCH_EXISTING_EVENT", "NEW_EVENT", "DUPLICATE", "UPDATE_EXISTING_EVENT", "NOISE", "UNCERTAIN"]);

if (!API_KEY) {
  console.error("BACKTEST_BLOCKED: NEBULA_API_KEY is not available in the process environment.");
  console.error("Production-derived D1 data is available, but the Worker secret cannot be read from D1 or inferred safely.");
  process.exit(2);
}

const reports = queryD1(`
  SELECT rp.id, rp.source_id, s.name AS source_name, rp.published_at, rp.observed_at,
         COALESCE(rp.normalized_text, rp.original_text) AS text,
         GROUP_CONCAT(es.event_id) AS event_ids
    FROM raw_posts rp
    JOIN sources s ON s.id = rp.source_id
    LEFT JOIN event_sources es ON es.raw_post_id = rp.id
   WHERE rp.is_deleted = 0 AND rp.is_noise = 0
   GROUP BY rp.id
   ORDER BY COALESCE(rp.published_at, rp.observed_at) DESC, rp.id DESC
   LIMIT ${LIMIT}
`).map((row) => ({
  id: Number(row.id),
  source_id: Number(row.source_id),
  source_name: String(row.source_name || ""),
  published_at: row.published_at ? String(row.published_at) : null,
  observed_at: String(row.observed_at || ""),
  text: String(row.text || "").slice(0, MAX_REPORT_CHARS),
  event_ids: new Set(String(row.event_ids || "").split(",").filter(Boolean).map(Number))
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
  prompt_tokens: 0,
  output_tokens: 0,
  uncertain: 0,
  same_event_agreements: 0,
  disagreements: 0,
  new_event_disagreements: 0,
  false_merge_candidates: 0,
  false_split_candidates: 0,
  invalid_outputs: 0,
  failed_batches: 0
};

for (const batch of batches) {
  let decisions;
  try {
    metrics.primary_calls += 1;
    const primary = await callNebula(batch.reports, activeEvents, "primary");
    metrics.prompt_tokens += primary.prompt_tokens;
    metrics.output_tokens += primary.output_tokens;
    decisions = validateDecisions(primary.output, batch.reports, knownEventIds, new Set(batch.reports.map((report) => report.id)));
  } catch (error) {
    metrics.failed_batches += 1;
    metrics.invalid_outputs += 1;
    console.warn(`BACKTEST_BATCH_FAILED window=${batch.window_end} reports=${batch.reports.length} error=${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  const uncertainIds = [...new Set(decisions.filter((decision) => decision.action === "UNCERTAIN" || decision.confidence < AMBIGUITY_THRESHOLD).flatMap((decision) => decision.post_ids))];
  metrics.uncertain += uncertainIds.length;

  if (uncertainIds.length > 0) {
    const focusedReports = batch.reports.filter((report) => uncertainIds.includes(report.id));
    const focusedEvents = activeEvents.filter((event) => decisions.some((decision) => decision.event_id === event.event_id && decision.post_ids.some((id) => uncertainIds.includes(id)))).slice(0, 5);
    try {
      metrics.second_pass_calls += 1;
      const second = await callNebula(focusedReports, focusedEvents, "ambiguity");
      metrics.prompt_tokens += second.prompt_tokens;
      metrics.output_tokens += second.output_tokens;
      const resolved = validateDecisions(second.output, focusedReports, knownEventIds, new Set(batch.reports.map((report) => report.id)));
      const resolvedIds = new Set(uncertainIds);
      decisions = [...decisions.filter((decision) => !decision.post_ids.some((id) => resolvedIds.has(id))), ...resolved];
    } catch (error) {
      console.warn(`AMBIGUITY_OUTPUT_REJECTED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  compareWithProductionRelationships(batch.reports, decisions, metrics);
}

const totalPairComparisons = metrics.same_event_agreements + metrics.disagreements;
console.log(JSON.stringify({
  ...metrics,
  agreement_rate: totalPairComparisons === 0 ? null : Number((metrics.same_event_agreements / totalPairComparisons).toFixed(4)),
  estimated_primary_calls_per_hour: batches.length,
  reduction_vs_one_call_per_report: reports.length === 0 ? null : Number((1 - batches.length / reports.length).toFixed(4)),
  nebula_base_url: BASE_URL,
  model_requested: "auto",
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

async function callNebula(batchReports, events, pass) {
  const userPrompt = JSON.stringify({
    task: "Classify every supplied report exactly once. Group reports describing the same real-world event.",
    pass,
    output_rules: {
      actions: [...ACTIONS],
      use_only_supplied_ids: true,
      every_report_exactly_once: true,
      never_return_confirmation_counts: true,
      event_id: "Use an active supplied event ID only for MATCH_EXISTING_EVENT or UPDATE_EXISTING_EVENT; otherwise null."
    },
    reports: batchReports.map(compactReport),
    active_events: events.map((event) => ({
      event_id: event.event_id,
      core_fact: event.core_fact,
      category: event.category,
      first_seen_at: event.first_seen_at,
      last_updated_at: event.last_updated_at,
      source_names: event.source_names
    }))
  });
  if (userPrompt.length > MAX_PAYLOAD_CHARS) throw new Error("backtest_payload_too_large");

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: "auto",
      messages: [
        { role: "system", content: "You are Radar's Persian-news event intelligence layer. Reason about meaning across Persian and English. Distinguish same-entity/different-event reports and respect timestamps. Never invent facts, IDs, source relationships, or confirmation counts. Return one strict JSON object with a decisions array and no Markdown." },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 2_000
    })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`nebula_http_${response.status}`);
  const output = parseOutput(body);
  if (!output) throw new Error("nebula_backtest_invalid_json");
  return {
    output,
    prompt_tokens: Number(body?.usage?.prompt_tokens || 0),
    output_tokens: Number(body?.usage?.completion_tokens || 0)
  };
}

function validateDecisions(output, batchReports, knownEventIds, allowedPostIds) {
  if (!output || !Array.isArray(output.decisions) || output.decisions.length === 0) throw new Error("decisions_missing");
  const expected = new Set(batchReports.map((report) => report.id));
  const assigned = new Set();
  for (const decision of output.decisions) {
    if (!ACTIONS.has(decision.action) || !Array.isArray(decision.post_ids) || decision.post_ids.length === 0) throw new Error("decision_shape_invalid");
    if (!CATEGORIES.has(decision.category) || typeof decision.confidence !== "number" || decision.confidence < 0 || decision.confidence > 1) throw new Error("decision_field_invalid");
    if (decision.event_id !== null && !knownEventIds.has(Number(decision.event_id))) throw new Error(`unknown_event_id:${decision.event_id}`);
    for (const postId of decision.post_ids) {
      if (!allowedPostIds.has(Number(postId))) throw new Error(`unknown_post_id:${postId}`);
      if (assigned.has(Number(postId))) throw new Error(`duplicate_assignment:${postId}`);
      assigned.add(Number(postId));
    }
    if (decision.action === "DUPLICATE" && (!Number.isInteger(decision.duplicate_of_post_id) || !allowedPostIds.has(decision.duplicate_of_post_id))) throw new Error("duplicate_target_invalid");
    if ((decision.action === "MATCH_EXISTING_EVENT" || decision.action === "UPDATE_EXISTING_EVENT") !== (decision.event_id !== null)) throw new Error("event_id_action_invalid");
    if (decision.action !== "DUPLICATE" && decision.duplicate_of_post_id != null) throw new Error("duplicate_target_action_invalid");
  }
  if (assigned.size !== expected.size || [...expected].some((id) => !assigned.has(id))) throw new Error("report_coverage_invalid");
  return output.decisions;
}

function compareWithProductionRelationships(batch, decisions, metrics) {
  const predictedGroup = new Map();
  decisions.forEach((decision, index) => decision.post_ids.forEach((postId) => predictedGroup.set(postId, `${decision.action}:${decision.event_id ?? `new:${index}`}`)));
  for (let leftIndex = 0; leftIndex < batch.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < batch.length; rightIndex += 1) {
      const left = batch[leftIndex];
      const right = batch[rightIndex];
      const actualShared = [...left.event_ids].some((eventId) => right.event_ids.has(eventId));
      if (!actualShared) continue;
      const predictedShared = predictedGroup.get(left.id) === predictedGroup.get(right.id);
      if (predictedShared) metrics.same_event_agreements += 1;
      else metrics.false_split_candidates += 1;
      if (!predictedShared) metrics.disagreements += 1;
    }
  }
  for (const decision of decisions) {
    if (decision.action === "UNCERTAIN") continue;
    const actualEvents = new Set(batch.filter((report) => decision.post_ids.includes(report.id)).flatMap((report) => [...report.event_ids]));
    if (actualEvents.size > 1) {
      metrics.false_merge_candidates += 1;
      metrics.disagreements += 1;
    }
    if (decision.action === "NEW_EVENT" && actualEvents.size > 0) metrics.new_event_disagreements += 1;
  }
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
  const result = spawnSync(binary, ["d1", "execute", "radar-db", "--remote", "--json", "--command", command], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`d1_read_failed:${String(result.stderr || result.stdout).slice(0, 500)}`);
  const parsed = JSON.parse(result.stdout);
  const response = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!response?.success) throw new Error("d1_read_unsuccessful");
  return response.results || [];
}
