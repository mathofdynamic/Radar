import { timingSafeStringEqual } from "./crypto";
import { isDashboardSession } from "./auth";
import { isPublishingEnabled } from "./db";

export async function isAdminRequest(request: Request, env: Env): Promise<boolean> {
  const expected = env.RADAR_ADMIN_KEY;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") ?? "";
  if (!expected || !provided) return false;
  return timingSafeStringEqual(provided, expected);
}

export async function isOperatorRequest(request: Request, env: Env): Promise<boolean> {
  return (await isAdminRequest(request, env)) || await isDashboardSession(request, env);
}

export async function healthResponse(env: Env): Promise<Response> {
  const sources = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(is_active) AS active FROM sources").first<{ total: number; active: number | null }>();
  const metrics = await env.DB.prepare(
    "SELECT metric, value FROM operational_counters WHERE counter_date = ? ORDER BY metric"
  ).bind(new Date().toISOString().slice(0, 10)).all<{ metric: string; value: number }>();
  return Response.json({
    ok: true,
    service: "radar-pipeline",
    environment: env.ENVIRONMENT,
    publishing_enabled: await isPublishingEnabled(env.DB, String(env.PUBLISH_ENABLED) === "true"),
    destination: env.RADAR_DESTINATION_URL,
    sources: { total: sources?.total ?? 0, active: sources?.active ?? 0 },
    metrics: Object.fromEntries(metrics.results.map((row) => [row.metric, row.value])),
    timestamp: new Date().toISOString()
  });
}

export async function opsSummary(env: Env): Promise<Response> {
  const [sources, queues, ai] = await Promise.all([
    env.DB.prepare("SELECT source_key, health_status, last_polled_at, next_poll_at, last_error FROM sources ORDER BY id").all(),
    env.DB.prepare("SELECT metric, value FROM operational_counters WHERE counter_date = ? ORDER BY metric").bind(new Date().toISOString().slice(0, 10)).all(),
    env.DB.prepare("SELECT usage_date, stage, calls, estimated_neurons FROM ai_usage WHERE usage_date = ? ORDER BY stage").bind(new Date().toISOString().slice(0, 10)).all()
  ]);
  return Response.json({ sources: sources.results, counters: queues.results, ai_usage: ai.results, timestamp: new Date().toISOString() });
}
