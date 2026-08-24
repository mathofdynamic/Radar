import fs from "node:fs";
import { z } from "zod";

const API_KEY = process.env.NEBULA_API_KEY?.trim();
const BASE_URL = (process.env.NEBULA_BASE_URL || "https://nebula-free-llm.nebula-ai-company.workers.dev/v1").replace(/\/+$/u, "");
const FIXTURE_PATH = "diagnostics/v8/token-sweep-fixture-cap20.json";
const ARTIFACT_PATH = "diagnostics/v8/glm-gemma-benchmark.json";
const MAX_TOKENS = 6_000;
const MODELS = [
  "@cf/zai-org/glm-4.7-flash",
  "@cf/google/gemma-4-26b-a4b-it",
];
const EXPECTED_KEYS = [
  "post_ids",
  "action",
  "event_id",
  "duplicate_of_post_id",
  "confidence",
  "canonical_fact",
  "category",
  "reason",
];
const EXPECTED_KEY_SET = new Set(EXPECTED_KEYS);
const ACTIONS = [
  "MATCH_EXISTING_EVENT",
  "NEW_EVENT",
  "DUPLICATE",
  "UPDATE_EXISTING_EVENT",
  "NOISE",
  "UNCERTAIN",
];
const CATEGORIES = ["IRAN", "WORLD", "POLITICS", "WAR_SECURITY", "SOCIETY", "ECONOMY", "TECHNOLOGY"];
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
const reportIds = fixture.batch.report_ids.map(Number);
const eventIds = fixture.active_event_ids.map(Number);
const reportSet = new Set(reportIds);
const eventSet = new Set(eventIds);

if (!API_KEY) throw new Error("NEBULA_API_KEY_ABSENT");

function redact(value) {
  let text = String(value ?? "");
  if (API_KEY) text = text.split(API_KEY).join("[REDACTED]");
  return text.replace(/Bearer\s+[^\s"']+/giu, "Bearer [REDACTED]");
}

function safe(value, depth = 0) {
  if (depth > 4) return "[DEPTH_LIMIT]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return redact(value).slice(0, 2_000_000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => safe(item, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safe(item, depth + 1)]));
  return String(value);
}

function persist(artifact) {
  fs.mkdirSync("diagnostics/v8", { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function outputFromBody(body) {
  const content = body?.choices?.[0]?.message?.content ?? body?.response ?? body?.result?.response ?? body?.result ?? null;
  if (content && typeof content === "object" && !Array.isArray(content)) return content;
  if (typeof content !== "string") return null;
  const cleaned = content.replace(/^\s*```(?:json)?\s*/iu, "").replace(/\s*```\s*$/u, "").trim();
  const parsed = parseJson(cleaned);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function rawContent(body) {
  return body?.choices?.[0]?.message?.content ?? body?.response ?? body?.result?.response ?? body?.result ?? null;
}

function finishReasons(body) {
  return Array.isArray(body?.choices)
    ? body.choices.map((choice) => choice?.finish_reason).filter((value) => value != null)
    : [];
}

function typeName(value) {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

function structural(output) {
  const result = {
    total_decisions: Array.isArray(output?.decisions) ? output.decisions.length : 0,
    complete_8_key_decisions: 0,
    missing_key_decisions: 0,
    extra_key_decisions: 0,
    missing_fields: Object.fromEntries(EXPECTED_KEYS.map((key) => [key, 0])),
    extra_fields: {},
    wrong_types: {},
    action_counts: Object.fromEntries(ACTIONS.map((action) => [action, 0])),
  };
  if (!Array.isArray(output?.decisions)) return result;
  for (const decision of output.decisions) {
    const actualKeys = decision && typeof decision === "object" && !Array.isArray(decision) ? Object.keys(decision) : [];
    const missing = EXPECTED_KEYS.filter((key) => !actualKeys.includes(key));
    const extra = actualKeys.filter((key) => !EXPECTED_KEY_SET.has(key));
    if (missing.length === 0 && extra.length === 0) result.complete_8_key_decisions += 1;
    if (missing.length > 0) result.missing_key_decisions += 1;
    if (extra.length > 0) result.extra_key_decisions += 1;
    for (const key of missing) result.missing_fields[key] += 1;
    for (const key of extra) result.extra_fields[key] = (result.extra_fields[key] || 0) + 1;
    for (const key of EXPECTED_KEYS) {
      if (Object.hasOwn(decision || {}, key)) {
        const actualType = typeName(decision[key]);
        const expectedType = key === "post_ids" ? "array" : key === "event_id" || key === "duplicate_of_post_id" ? "number|null" : key === "confidence" ? "number" : "string";
        const typeIsValid = expectedType === "number|null"
          ? actualType === "number" || actualType === "null"
          : actualType === expectedType;
        if (!typeIsValid) result.wrong_types[`${key}:${actualType}`] = (result.wrong_types[`${key}:${actualType}`] || 0) + 1;
      }
    }
    const action = typeof decision?.action === "string" ? decision.action : "[invalid/missing]";
    if (!Object.hasOwn(result.action_counts, action)) result.action_counts[action] = 0;
    result.action_counts[action] += 1;
  }
  return result;
}

function providerSchemaValidate(output) {
  if (!output || typeof output !== "object" || Array.isArray(output)) return { valid: false, error: "root_object" };
  if (Object.keys(output).length !== 1 || !Object.hasOwn(output, "decisions")) return { valid: false, error: "root_keys" };
  if (!Array.isArray(output.decisions) || output.decisions.length < 1 || output.decisions.length > 64) return { valid: false, error: "decisions_array" };
  for (const [index, decision] of output.decisions.entries()) {
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) return { valid: false, error: `decision_object:${index}` };
    const keys = Object.keys(decision);
    if (keys.length !== EXPECTED_KEYS.length || keys.some((key) => !EXPECTED_KEY_SET.has(key))) return { valid: false, error: `decision_keys:${index}` };
    if (!Array.isArray(decision.post_ids) || decision.post_ids.length < 1 || decision.post_ids.length > 40 || decision.post_ids.some((id) => !Number.isInteger(id) || !reportSet.has(id))) return { valid: false, error: `post_ids:${index}` };
    if (new Set(decision.post_ids).size !== decision.post_ids.length) return { valid: false, error: `post_ids_unique:${index}` };
    if (!ACTIONS.includes(decision.action)) return { valid: false, error: `action:${index}` };
    if (!(decision.event_id === null || (Number.isInteger(decision.event_id) && eventSet.has(decision.event_id)))) return { valid: false, error: `event_id:${index}` };
    if (!(decision.duplicate_of_post_id === null || (Number.isInteger(decision.duplicate_of_post_id) && reportSet.has(decision.duplicate_of_post_id)))) return { valid: false, error: `duplicate_target:${index}` };
    if (typeof decision.confidence !== "number" || !Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) return { valid: false, error: `confidence:${index}` };
    if (typeof decision.canonical_fact !== "string" || decision.canonical_fact.length < 1 || decision.canonical_fact.length > 800) return { valid: false, error: `canonical_fact:${index}` };
    if (!CATEGORIES.includes(decision.category)) return { valid: false, error: `category:${index}` };
    if (typeof decision.reason !== "string" || decision.reason.length < 1 || decision.reason.length > 1_000) return { valid: false, error: `reason:${index}` };
  }
  return { valid: true, error: null };
}

function zodValidate(output) {
  const decisionSchema = z.object({
    post_ids: z.array(z.number().int().positive()).min(1).max(40),
    action: z.enum(ACTIONS),
    event_id: z.number().int().positive().nullable(),
    duplicate_of_post_id: z.number().int().positive().nullable(),
    confidence: z.number().min(0).max(1),
    canonical_fact: z.string().min(1).max(800),
    category: z.enum(CATEGORIES),
    reason: z.string().min(1).max(1_000),
  }).strict().superRefine((decision, context) => {
    const requiresEvent = decision.action === "MATCH_EXISTING_EVENT" || decision.action === "UPDATE_EXISTING_EVENT";
    if (requiresEvent !== (decision.event_id !== null)) context.addIssue({ code: "custom", path: ["event_id"], message: "event_id does not match action" });
    if (decision.action === "DUPLICATE" && decision.duplicate_of_post_id === null) context.addIssue({ code: "custom", path: ["duplicate_of_post_id"], message: "duplicate target required" });
    if (decision.action !== "DUPLICATE" && decision.duplicate_of_post_id !== null) context.addIssue({ code: "custom", path: ["duplicate_of_post_id"], message: "duplicate target only allowed for DUPLICATE" });
    if (new Set(decision.post_ids).size !== decision.post_ids.length) context.addIssue({ code: "custom", path: ["post_ids"], message: "post_ids must be unique" });
    if (decision.duplicate_of_post_id !== null && decision.post_ids.includes(decision.duplicate_of_post_id)) context.addIssue({ code: "custom", path: ["duplicate_of_post_id"], message: "duplicate target cannot be in the duplicate group" });
  });
  const parsed = z.object({ decisions: z.array(decisionSchema).min(1).max(64) }).strict().safeParse(output);
  return { valid: parsed.success, error: parsed.success ? null : parsed.error.issues[0]?.message || "zod_invalid" };
}

function deterministicValidate(output) {
  const codes = new Set();
  if (!output || !Array.isArray(output.decisions) || output.decisions.length === 0) return { valid: false, codes: ["missing_post_coverage"], coverage: { expected: reportIds.length, covered: 0, missing: reportIds, duplicate_assignments: [] } };
  const assigned = new Map();
  const actionByPost = new Map();
  for (const decision of output.decisions) {
    if (!Array.isArray(decision.post_ids)) {
      codes.add("missing_post_coverage");
      continue;
    }
    for (const postId of decision.post_ids) {
      if (!reportSet.has(postId)) codes.add("unknown_post_id");
      if (assigned.has(postId)) codes.add("duplicate_post_assignment");
      assigned.set(postId, (assigned.get(postId) || 0) + 1);
      actionByPost.set(postId, decision.action);
    }
    if (decision.event_id !== null && (!Number.isInteger(decision.event_id) || !eventSet.has(decision.event_id))) codes.add("invalid_event_reference");
    if (decision.duplicate_of_post_id !== null && (!Number.isInteger(decision.duplicate_of_post_id) || !reportSet.has(decision.duplicate_of_post_id))) codes.add("invalid_duplicate_reference");
    const requiresEvent = decision.action === "MATCH_EXISTING_EVENT" || decision.action === "UPDATE_EXISTING_EVENT";
    if (requiresEvent !== (decision.event_id !== null)) codes.add("action_reference_mismatch");
    if (decision.action === "DUPLICATE" && decision.duplicate_of_post_id === null) codes.add("invalid_duplicate_reference");
    if (decision.action !== "DUPLICATE" && decision.duplicate_of_post_id !== null) codes.add("invalid_duplicate_reference");
  }
  const missing = reportIds.filter((id) => !assigned.has(id));
  const duplicateAssignments = [...assigned.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (missing.length > 0) codes.add("missing_post_coverage");
  if (duplicateAssignments.length > 0) codes.add("duplicate_post_assignment");
  for (const decision of output.decisions) {
    if (decision.duplicate_of_post_id === null) continue;
    const targetAction = actionByPost.get(decision.duplicate_of_post_id);
    if (!targetAction || targetAction === "NOISE" || targetAction === "DUPLICATE" || targetAction === "UNCERTAIN") codes.add("invalid_duplicate_reference");
  }
  return {
    valid: codes.size === 0 && assigned.size === reportIds.length,
    codes: [...codes],
    coverage: { expected: reportIds.length, covered: [...assigned.keys()].filter((id) => reportSet.has(id)).length, missing, duplicate_assignments: duplicateAssignments },
  };
}

function classifyFailure(response, body, output, validation, transport) {
  if (transport || !response) return "HTTP_FAILURE";
  if (!response.ok) {
    const errorText = JSON.stringify(body?.error || "");
    return response.status === 408 || response.status === 504 || errorText.includes("upstream_timeout") ? "TIMEOUT" : "HTTP_FAILURE";
  }
  if (finishReasons(body).includes("length")) return "TRUNCATED";
  if (!output) return body ? "INVALID_JSON" : "INVALID_JSON";
  if (!validation.provider.valid) return "SCHEMA_INVALID";
  if (!validation.zod.valid) return "ZOD_INVALID";
  if (!validation.deterministic.valid) {
    const codes = validation.deterministic.codes;
    if (codes.includes("missing_post_coverage")) return "MISSING_POST_COVERAGE";
    if (codes.includes("duplicate_post_assignment")) return "DUPLICATE_POST_ASSIGNMENT";
    if (codes.includes("invalid_event_reference")) return "INVALID_EVENT_REFERENCE";
    if (codes.includes("invalid_duplicate_reference")) return "INVALID_DUPLICATE_REFERENCE";
    if (codes.includes("action_reference_mismatch")) return "ACTION_REFERENCE_MISMATCH";
    return "OTHER";
  }
  return null;
}

function parseRoutedVia(value) {
  const route = value?.trim();
  if (!route) return { provider: null, routed_model: null };
  const slash = route.indexOf("/");
  return slash < 0
    ? { provider: route, routed_model: null }
    : { provider: route.slice(0, slash) || null, routed_model: route.slice(slash + 1) || null };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(samples) {
  const latencies = samples.map((sample) => sample.latency_ms).filter(Number.isFinite);
  const completionTokens = samples.map((sample) => sample.completion_tokens).filter(Number.isFinite);
  const successful = samples.filter((sample) => sample.validation?.deterministic?.valid);
  return {
    requests: samples.length,
    http: samples.filter((sample) => sample.http_status === 200).length,
    json: samples.filter((sample) => sample.json_valid).length,
    schema: samples.filter((sample) => sample.validation?.provider?.valid).length,
    zod: samples.filter((sample) => sample.validation?.zod?.valid).length,
    radar_valid: successful.length,
    full_coverage: samples.filter((sample) => sample.validation?.deterministic?.coverage?.missing?.length === 0 && sample.validation?.deterministic?.valid).length,
    median_latency_ms: percentile(latencies, 0.5),
    p95_latency_ms: percentile(latencies, 0.95),
    max_latency_ms: latencies.length ? Math.max(...latencies) : null,
    average_completion_tokens: completionTokens.length ? Number((completionTokens.reduce((sum, value) => sum + value, 0) / completionTokens.length).toFixed(2)) : null,
    dangerous_merges: null,
    false_splits: null,
    failure_types: Object.fromEntries(samples.filter((sample) => sample.failure_type).reduce((map, sample) => map.set(sample.failure_type, (map.get(sample.failure_type) || 0) + 1), new Map())),
    action_counts: Object.fromEntries(samples.flatMap((sample) => Object.entries(sample.structural?.action_counts || {})).reduce((map, [action, count]) => map.set(action, (map.get(action) || 0) + count), new Map())),
  };
}

const artifact = {
  version: 1,
  fixture: {
    path: FIXTURE_PATH,
    reports: reportIds.length,
    events: eventIds.length,
    window_start: fixture.batch.window_start,
    window_end: fixture.batch.window_end,
    max_tokens: MAX_TOKENS,
  },
  models: Object.fromEntries(MODELS.map((model) => [model, { samples: [], summary: null }])),
};
persist(artifact);

async function request(model, sampleNumber) {
  const payload = JSON.parse(JSON.stringify(fixture.request_payload));
  payload.model = model;
  payload.max_tokens = MAX_TOKENS;
  const startedAt = Date.now();
  let response = null;
  let body = null;
  let bodyText = "";
  let transport = null;
  try {
    response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(95_000),
    });
    bodyText = await response.text();
    body = parseJson(bodyText);
  } catch (error) {
    const cause = error?.cause;
    transport = {
      name: error?.name || "Error",
      message: redact(error?.message || String(error)),
      code: error?.code || cause?.code || null,
      cause_name: cause?.name || null,
      cause_code: cause?.code || null,
      cause_message: redact(cause?.message || ""),
    };
  }
  const output = outputFromBody(body);
  const sample = {
    sample: sampleNumber,
    model,
    http_status: response?.status ?? null,
    latency_ms: Date.now() - startedAt,
    request_id: response?.headers.get("x-request-id") ?? null,
    routed_via: response?.headers.get("x-routed-via") ?? null,
    ...parseRoutedVia(response?.headers.get("x-routed-via")),
    fallback_attempts: Number(response?.headers.get("x-fallback-attempts") || 0) || 0,
    finish_reasons: finishReasons(body),
    prompt_tokens: Number(body?.usage?.prompt_tokens || 0) || 0,
    completion_tokens: Number(body?.usage?.completion_tokens || body?.usage?.output_tokens || 0) || 0,
    response_chars: typeof rawContent(body) === "string" ? rawContent(body).length : bodyText.length,
    json_valid: output !== null,
    assistant_content_raw: typeof rawContent(body) === "string" ? redact(rawContent(body)).slice(0, 2_000_000) : safe(rawContent(body)),
    assistant_content_parsed: output ? safe(output) : null,
    response_error: body?.error ? safe(body.error) : null,
    transport,
    structural: structural(output),
    validation: null,
    failure_type: null,
  };
  const modelArtifact = artifact.models[model];
  modelArtifact.samples.push(sample);
  persist(artifact);
  const validation = output
    ? { provider: providerSchemaValidate(output), zod: zodValidate(output), deterministic: deterministicValidate(output) }
    : { provider: { valid: false, error: "no_parsed_output" }, zod: { valid: false, error: "no_parsed_output" }, deterministic: deterministicValidate(output) };
  sample.validation = validation;
  sample.failure_type = classifyFailure(response, body, output, validation, transport);
  persist(artifact);
  return sample;
}

for (const model of MODELS) {
  for (let sample = 1; sample <= 3; sample += 1) await request(model, sample);
  const firstThree = artifact.models[model].samples;
  const qualified = firstThree.length === 3 && firstThree.every((sample) => sample.http_status === 200 && sample.json_valid && sample.validation.provider.valid && sample.validation.zod.valid && sample.validation.deterministic.valid);
  if (qualified) {
    await request(model, 4);
    await request(model, 5);
  }
  artifact.models[model].summary = summarize(artifact.models[model].samples);
  persist(artifact);
}

console.log(JSON.stringify({ artifact: ARTIFACT_PATH, fixture_reports: reportIds.length, fixture_events: eventIds.length, models: Object.fromEntries(MODELS.map((model) => [model, artifact.models[model].summary])) }, null, 2));
