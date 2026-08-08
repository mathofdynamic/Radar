import sourceSeeds from "../seeds/sources.json";
import { runtimeConfig } from "./config";
import { telegramWebPollEnvelopeSchema } from "./contracts";
import { readBoundedText } from "./crypto";
import { getEvent, countStoriesToday, incrementCounter, upsertSourceSeed } from "./db";
import { authenticateDashboardLogin, isDashboardSession, logoutDashboard } from "./auth";
import { dashboardSnapshot } from "./dashboard-data";
import { dashboardResponse } from "./dashboard";
import { analyzeRawPost, ingestEnvelope } from "./intelligence/pipeline";
import { buildStoryDraft } from "./editorial/story";
import { scoreEvent, shouldPublish } from "./editorial/scoring";
import { pollDueSources } from "./polling/poller";
import { createCover } from "./publisher/covers";
import { publishStory } from "./publisher/telegram";
import { verifyTelegramDestination } from "./publisher/telegram";
import { isAdminRequest, isOperatorRequest, healthResponse, opsSummary } from "./ops";
import type { EditorialCandidate, EventRow, PublishJob, SourceSeed, StoryDraft, TelegramWebPollEnvelope } from "./types";
import type { EditorialJob, PublishQueueJob, QueueJob, RawIngestJob, RawPostJob } from "./queue";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") return await healthResponse(env);
      if (request.method === "GET" && url.pathname === "/admin") return dashboardResponse();
      if (request.method === "POST" && url.pathname === "/admin/api/login") return await authenticateDashboardLogin(request, env);
      if (request.method === "POST" && url.pathname === "/admin/api/logout") return logoutDashboard();
      if (url.pathname.startsWith("/admin/api/")) {
        if (!(await isDashboardSession(request, env))) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
        if (request.method === "GET" && url.pathname === "/admin/api/overview") return Response.json(await dashboardSnapshot(env), { headers: { "Cache-Control": "no-store" } });
        if (request.method === "POST" && url.pathname === "/admin/api/actions/bootstrap-sources") {
          await seedSources(env);
          return Response.json({ ok: true, seeded: sourceSeeds.length });
        }
        if (request.method === "POST" && url.pathname === "/admin/api/actions/validate-sources") return Response.json(await validateSources(env));
        if (request.method === "POST" && url.pathname === "/admin/api/actions/requeue-pending") return Response.json(await requeuePending(env));
        if (request.method === "GET" && url.pathname === "/admin/api/actions/verify-telegram") return Response.json(await verifyTelegramDestination(env));
        return Response.json({ error: "not_found" }, { status: 404 });
      }
      if (request.method === "GET" && url.pathname === "/ops/summary") {
        if (!(await isAdminRequest(request, env))) return Response.json({ error: "unauthorized" }, { status: 401 });
        return await opsSummary(env);
      }
      if (request.method === "POST" && url.pathname === "/admin/bootstrap-sources") {
        if (!(await isOperatorRequest(request, env))) return Response.json({ error: "unauthorized" }, { status: 401 });
        await seedSources(env);
        return Response.json({ ok: true, seeded: sourceSeeds.length });
      }
      if (request.method === "POST" && url.pathname === "/admin/validate-sources") {
        if (!(await isOperatorRequest(request, env))) return Response.json({ error: "unauthorized" }, { status: 401 });
        return Response.json(await validateSources(env));
      }
      if (request.method === "POST" && url.pathname === "/admin/requeue-pending") {
        if (!(await isOperatorRequest(request, env))) return Response.json({ error: "unauthorized" }, { status: 401 });
        return Response.json(await requeuePending(env));
      }
      if (request.method === "GET" && url.pathname === "/admin/verify-telegram") {
        if (!(await isOperatorRequest(request, env))) return Response.json({ error: "unauthorized" }, { status: 401 });
        return Response.json(await verifyTelegramDestination(env));
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    } catch (error) {
      console.error(JSON.stringify({ event: "http_handler_failed", error: error instanceof Error ? error.message : "unknown" }));
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await seedSourcesIfEmpty(env);
    await recoverStalePublishJobs(env);
    const envelopes = await pollDueSources(env);
    for (const envelope of envelopes) {
      await env.RAW_INGEST_QUEUE.send({ kind: "raw_ingest", envelope } satisfies RawIngestJob);
    }
    if (envelopes.length > 0) await incrementCounter(env.DB, "poll_envelopes_queued", envelopes.length);
  },

  async queue(batch: MessageBatch<QueueJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await dispatchQueueJob(batch.queue, message.body, env);
        message.ack();
      } catch (error) {
        const errorMessage = normalizeErrorMessage(error);
        console.error(JSON.stringify({ event: "queue_job_failed", queue: batch.queue, error: errorMessage }));
        if (batch.queue === "radar-publish" && message.body.kind === "publish") {
          try {
            await recordPublishFailure(env.DB, message.body.job.eventId, message.body.job.eventVersion, message.body.job.publishKey, errorMessage);
          } catch (recordError) {
            console.error(JSON.stringify({ event: "publish_failure_record_failed", error: normalizeErrorMessage(recordError) }));
          }
        }
        await incrementCounter(env.DB, "queue_failures");
        message.retry();
      }
    }
  }
};

async function dispatchQueueJob(queue: string, body: QueueJob, env: Env): Promise<void> {
  if (queue === "radar-raw-ingest" && body.kind === "raw_ingest") return processRawIngest(env, body);
  if (queue === "radar-event-analysis" && body.kind === "raw_post") return processAnalysis(env, body);
  if (queue === "radar-editorial" && body.kind === "editorial_candidate") return processEditorial(env, body);
  if (queue === "radar-publish" && body.kind === "publish") return processPublish(env, body);
  throw new Error(`queue_job_mismatch:${queue}:${body.kind}`);
}

async function processRawIngest(env: Env, job: RawIngestJob): Promise<void> {
  const envelope = telegramWebPollEnvelopeSchema.parse(job.envelope) as TelegramWebPollEnvelope;
  await ingestEnvelope(env, envelope);
}

async function processAnalysis(env: Env, job: RawPostJob): Promise<void> {
  const candidate = await analyzeRawPost(env, job.rawPostId);
  if (candidate) await env.EDITORIAL_QUEUE.send({ kind: "editorial_candidate", candidate } satisfies EditorialJob);
}

async function processEditorial(env: Env, job: EditorialJob): Promise<void> {
  const candidate = job.candidate;
  const event = await getEvent(env.DB, candidate.eventId);
  if (!event || event.event_version !== candidate.eventVersion) return;
  const source = await env.DB.prepare(
    `SELECT MAX(CASE WHEN s.priority_tier = 'TIER_1' THEN 1 ELSE 0 END) AS high_priority
       FROM event_sources es JOIN sources s ON s.id = es.source_id WHERE es.event_id = ?`
  ).bind(event.id).first<{ high_priority: number | null }>();
  const config = runtimeConfig(env);
  const score = scoreEvent(event);
  const publishedToday = await countStoriesToday(env.DB);
  const alreadyPublished = await env.DB.prepare(
    "SELECT 1 AS found FROM published_stories WHERE event_id = ? AND publication_state = 'published' LIMIT 1"
  ).bind(event.id).first<{ found: number }>();
  const publish = !alreadyPublished && shouldPublish(event, score, (source?.high_priority ?? 0) === 1, publishedToday, config);
  const decision = publish ? "PUBLISH" : alreadyPublished ? "MONITOR" : score.finalScore >= 60 ? "MONITOR" : "IGNORE";
  const reasons = alreadyPublished ? [...score.reasons, "already_published_event"] : score.reasons;
  const candidateStatus = alreadyPublished ? "suppressed_duplicate" : publish && String(env.PUBLISH_ENABLED) === "true" ? "queued" : "pending";
  await env.DB.prepare(
    `INSERT INTO editorial_candidates(event_id, event_version, decision, score, reason_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id, event_version) DO UPDATE SET decision = excluded.decision, score = excluded.score, reason_json = excluded.reason_json, updated_at = excluded.updated_at`
  ).bind(event.id, event.event_version, decision, score.finalScore, JSON.stringify(reasons), candidateStatus, new Date().toISOString(), new Date().toISOString()).run();
  if (!publish) return;
  const story = await buildStoryDraft(env, event.id, event.event_version, score.reasons);
  const publishJob: PublishJob = { eventId: event.id, eventVersion: event.event_version, publishKey: `event:${event.id}:version:${event.event_version}`, story };
  if (String(env.PUBLISH_ENABLED) === "true") await env.PUBLISH_QUEUE.send({ kind: "publish", job: publishJob } satisfies PublishQueueJob);
}

async function processPublish(env: Env, job: PublishQueueJob): Promise<void> {
  if (String(env.PUBLISH_ENABLED) !== "true") return;
  const existing = await env.DB.prepare("SELECT publication_state FROM published_stories WHERE publish_key = ?").bind(job.job.publishKey).first<{ publication_state: string }>();
  if (existing?.publication_state === "published") return;
  if (!(await claimEventPublication(env, job.job))) {
    await suppressDuplicatePublication(env, job.job.eventId, job.job.eventVersion, job.job.publishKey);
    return;
  }
  const timestamp = new Date().toISOString();
  await persistPendingStory(env, job.job, timestamp);
  const cover = await createCover(env, job.job.story);
  const telegramMessageId = await publishStory(env, job.job.story, cover);
  await env.DB.prepare(
    `UPDATE published_stories SET published_at = ?, telegram_message_id = ?, cover_reference = ?, cover_mime_type = ?, publication_state = 'published', updated_at = ? WHERE publish_key = ?`
  ).bind(timestamp, telegramMessageId, cover.reference, cover.mimeType, new Date().toISOString(), job.job.publishKey).run();
  await env.DB.prepare(
    "UPDATE event_publication_locks SET telegram_message_id = ?, status = 'published', updated_at = ? WHERE event_id = ? AND publish_key = ?"
  ).bind(telegramMessageId, new Date().toISOString(), job.job.eventId, job.job.publishKey).run();
  await env.DB.prepare("UPDATE editorial_candidates SET status = 'published', updated_at = ? WHERE event_id = ? AND event_version = ?")
    .bind(new Date().toISOString(), job.job.eventId, job.job.eventVersion)
    .run();
  await incrementCounter(env.DB, "stories_published");
}

async function claimEventPublication(env: Env, job: PublishJob): Promise<boolean> {
  const existingPublished = await env.DB.prepare(
    "SELECT publish_key FROM published_stories WHERE event_id = ? AND publication_state = 'published' AND publish_key <> ? LIMIT 1"
  ).bind(job.eventId, job.publishKey).first<{ publish_key: string }>();
  if (existingPublished) return false;

  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO event_publication_locks(event_id, publish_key, event_version, status, created_at, updated_at)
     VALUES (?, ?, ?, 'processing', ?, ?)
     ON CONFLICT(event_id) DO NOTHING`
  ).bind(job.eventId, job.publishKey, job.eventVersion, timestamp, timestamp).run();
  const lock = await env.DB.prepare("SELECT publish_key FROM event_publication_locks WHERE event_id = ?")
    .bind(job.eventId).first<{ publish_key: string }>();
  return lock?.publish_key === job.publishKey;
}

async function suppressDuplicatePublication(env: Env, eventId: number, eventVersion: number, publishKey: string): Promise<void> {
  const timestamp = new Date().toISOString();
  await env.DB.prepare("UPDATE editorial_candidates SET status = 'suppressed_duplicate', updated_at = ? WHERE event_id = ? AND event_version = ?")
    .bind(timestamp, eventId, eventVersion).run();
  await incrementCounter(env.DB, "duplicate_publications_suppressed");
  console.info(JSON.stringify({ event: "duplicate_publication_suppressed", event_id: eventId, event_version: eventVersion, publish_key: publishKey }));
}

async function persistPendingStory(env: Env, job: PublishJob, timestamp: string): Promise<void> {
  const story = job.story;
  await env.DB.prepare(
    `INSERT INTO published_stories(event_id, event_version, publish_key, title, description, verification_status, independent_confirmations, primary_sources_json, category, entity_tags_json, links_json, story_model, publication_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?)
     ON CONFLICT(publish_key) DO UPDATE SET publication_state = 'processing', last_error = NULL, updated_at = excluded.updated_at`
  ).bind(story.eventId, story.eventVersion, job.publishKey, story.title, story.description, story.verificationStatus, story.independentConfirmations, JSON.stringify(story.primarySources), story.category, JSON.stringify(story.tags), JSON.stringify(story.links), env.AI_TEXT_MODEL, timestamp, timestamp).run();
}

async function recordPublishFailure(db: D1Database, eventId: number, eventVersion: number, publishKey: string, error: string): Promise<void> {
  const timestamp = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE published_stories SET publication_state = 'failed', last_error = ?, updated_at = ? WHERE publish_key = ?")
      .bind(error.slice(0, 1_000), timestamp, publishKey),
    db.prepare("UPDATE editorial_candidates SET status = 'failed', updated_at = ? WHERE event_id = ? AND event_version = ?")
      .bind(timestamp, eventId, eventVersion),
    db.prepare("UPDATE event_publication_locks SET status = 'failed', updated_at = ? WHERE event_id = ? AND publish_key = ?")
      .bind(timestamp, eventId, publishKey)
  ]);
}

async function recoverStalePublishJobs(env: Env): Promise<void> {
  if (String(env.PUBLISH_ENABLED) !== "true") return;
  const cutoff = new Date(Date.now() - 10 * 60 * 1_000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT ps.event_id, ps.event_version, ps.publish_key
       FROM published_stories ps
       JOIN editorial_candidates ec ON ec.event_id = ps.event_id AND ec.event_version = ps.event_version
      WHERE ec.decision = 'PUBLISH'
        AND ps.publication_state IN ('pending', 'failed', 'processing')
        AND ps.updated_at < ?
      ORDER BY ps.updated_at ASC LIMIT 5`
  ).bind(cutoff).all<{ event_id: number; event_version: number; publish_key: string }>();

  for (const row of rows.results) {
    try {
      const story = await buildStoryDraft(env, row.event_id, row.event_version, ["automatic_publish_recovery"]);
      await env.PUBLISH_QUEUE.send({
        kind: "publish",
        job: { eventId: row.event_id, eventVersion: row.event_version, publishKey: row.publish_key, story }
      } satisfies PublishQueueJob);
      const timestamp = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare("UPDATE published_stories SET publication_state = 'queued', last_error = NULL, updated_at = ? WHERE publish_key = ? AND publication_state <> 'published'").bind(timestamp, row.publish_key),
        env.DB.prepare("UPDATE editorial_candidates SET status = 'queued', updated_at = ? WHERE event_id = ? AND event_version = ?").bind(timestamp, row.event_id, row.event_version)
      ]);
    } catch (error) {
      const errorMessage = normalizeErrorMessage(error);
      console.error(JSON.stringify({ event: "publish_recovery_failed", publish_key: row.publish_key, error: errorMessage }));
      await recordPublishFailure(env.DB, row.event_id, row.event_version, row.publish_key, errorMessage);
    }
  }
}

function normalizeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || "unknown_error")).slice(0, 1_000);
}

async function seedSourcesIfEmpty(env: Env): Promise<void> {
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM sources").first<{ count: number }>();
  if ((count?.count ?? 0) === 0) await seedSources(env);
}

async function seedSources(env: Env): Promise<void> {
  for (const seed of sourceSeeds as SourceSeed[]) await upsertSourceSeed(env.DB, seed, false);
}

async function validateSources(env: Env): Promise<{ activated: string[]; inactive: Array<{ source: string; reason: string }> }> {
  const rows = await env.DB.prepare("SELECT * FROM sources ORDER BY id").all<SourceSeed & { id: number; telegram_username: string }>();
  const activated: string[] = [];
  const inactive: Array<{ source: string; reason: string }> = [];
  for (const source of rows.results) {
    try {
      const response = await fetch(`https://t.me/s/${encodeURIComponent(source.telegram_username)}`, { headers: { accept: "text/html", "user-agent": "Radar/0.1 source-validator" } });
      if (!response.ok) throw new Error(`http_${response.status}`);
      const html = await readBoundedText(response, runtimeConfig(env).maxHtmlBytes);
      if (!html.includes("data-post=")) throw new Error("no_public_posts");
      await env.DB.prepare("UPDATE sources SET is_active = 1, health_status = 'healthy', last_error = NULL, next_poll_at = ?, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), new Date().toISOString(), source.id).run();
      activated.push(source.telegram_username);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "validation_failed";
      await env.DB.prepare("UPDATE sources SET is_active = 0, health_status = 'invalid', last_error = ?, updated_at = ? WHERE id = ?").bind(reason.slice(0, 500), new Date().toISOString(), source.id).run();
      inactive.push({ source: source.telegram_username, reason });
    }
  }
  return { activated, inactive };
}

async function requeuePending(env: Env): Promise<{ queued: number }> {
  const rows = await env.DB.prepare(
    `SELECT ec.event_id, ec.event_version, e.importance_score,
            COALESCE(ps.publish_key, 'event:' || ec.event_id || ':version:' || ec.event_version) AS publish_key
       FROM editorial_candidates ec
       JOIN events e ON e.id = ec.event_id
       LEFT JOIN published_stories ps ON ps.event_id = ec.event_id AND ps.event_version = ec.event_version
      WHERE ec.decision = 'PUBLISH'
        AND (ps.id IS NULL OR ps.publication_state IN ('pending', 'failed'))
      ORDER BY e.importance_score DESC LIMIT 25`
  ).all<{ event_id: number; event_version: number; importance_score: number; publish_key: string }>();
  let queued = 0;
  for (const row of rows.results) {
    const story = await buildStoryDraft(env, row.event_id, row.event_version, ["requeued_after_publishing_enable"]);
    await env.PUBLISH_QUEUE.send({ kind: "publish", job: { eventId: row.event_id, eventVersion: row.event_version, publishKey: row.publish_key, story } } satisfies PublishQueueJob);
    const timestamp = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE published_stories SET publication_state = 'queued', last_error = NULL, updated_at = ? WHERE publish_key = ? AND publication_state <> 'published'").bind(timestamp, row.publish_key),
      env.DB.prepare("UPDATE editorial_candidates SET status = 'queued', updated_at = ? WHERE event_id = ? AND event_version = ?").bind(timestamp, row.event_id, row.event_version)
    ]);
    queued += 1;
  }
  return { queued };
}
