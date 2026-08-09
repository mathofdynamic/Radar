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
import { judgeEvent } from "./editorial/judge";
import { scoreEvent, scoreWithAdjustment, shouldPublish } from "./editorial/scoring";
import { pollDueSources } from "./polling/poller";
import { createCover } from "./publisher/covers";
import { editPublishedStory, publishStory, verifyTelegramDestination } from "./publisher/telegram";
import { isAdminRequest, isOperatorRequest, healthResponse, opsSummary } from "./ops";
import type { PublishJob, SourceSeed, TelegramWebPollEnvelope, VerificationStatus } from "./types";
import type { EditorialJob, PollCycleJob, PublishQueueJob, QueueJob, RawIngestJob, RawPostJob } from "./queue";

interface PublishedEventState {
  publish_key: string;
  event_version: number;
  telegram_message_id: number | null;
  verification_status: VerificationStatus;
  independent_confirmations: number;
}

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

  // Free-plan Cron invocations have only 10 ms CPU. Keep this handler intentionally
  // tiny: one Queue write and no D1 queries, Telegram fetches, parsing, hashing or recovery.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await env.POLL_QUEUE.send({
      kind: "poll_cycle",
      scheduledAt: new Date(controller.scheduledTime).toISOString()
    } satisfies PollCycleJob);
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
            if (message.body.job.mode === "edit") {
              await recordUpdateFailure(env.DB, message.body.job.eventId, message.body.job.eventVersion, message.body.job.publishKey, errorMessage);
            } else {
              await recordPublishFailure(env.DB, message.body.job.eventId, message.body.job.eventVersion, message.body.job.publishKey, errorMessage);
            }
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
  if (queue === "radar-poll" && body.kind === "poll_cycle") return processPollCycle(env, body);
  if (queue === "radar-raw-ingest" && body.kind === "raw_ingest") return processRawIngest(env, body);
  if (queue === "radar-event-analysis" && body.kind === "raw_post") return processAnalysis(env, body);
  if (queue === "radar-editorial" && body.kind === "editorial_candidate") return processEditorial(env, body);
  if (queue === "radar-publish" && body.kind === "publish") return processPublish(env, body);
  throw new Error(`queue_job_mismatch:${queue}:${body.kind}`);
}

async function processPollCycle(env: Env, job: PollCycleJob): Promise<void> {
  await seedSourcesIfEmpty(env);

  const scheduledAt = new Date(job.scheduledAt);
  if (!Number.isNaN(scheduledAt.getTime()) && scheduledAt.getUTCMinutes() % 15 === 0) {
    await recoverStalePublishJobs(env);
  }

  const envelopes = await pollDueSources(env);
  await incrementCounter(env.DB, "poll_cycles");
  if (envelopes.length > 0) await incrementCounter(env.DB, "poll_envelopes_observed", envelopes.length);

  // Happy path stays in this Queue consumer. This avoids paying three Queue
  // deliveries for every raw post on the Free plan. The old stage queues remain
  // available as narrow fallbacks if a synchronous stage fails after persistence.
  for (const envelope of envelopes) {
    let rawPostId: number;
    try {
      rawPostId = await ingestEnvelope(env, envelope, { enqueueAnalysis: false });
    } catch (error) {
      const errorMessage = normalizeErrorMessage(error);
      console.error(JSON.stringify({ event: "poll_sync_ingest_failed", source_id: envelope.sourceId, message_id: envelope.externalMessageId, error: errorMessage }));
      await incrementCounter(env.DB, "poll_sync_ingest_failures");
      await env.RAW_INGEST_QUEUE.send({ kind: "raw_ingest", envelope } satisfies RawIngestJob);
      continue;
    }

    let candidate;
    try {
      candidate = await analyzeRawPost(env, rawPostId);
    } catch (error) {
      const errorMessage = normalizeErrorMessage(error);
      console.error(JSON.stringify({ event: "poll_sync_analysis_failed", raw_post_id: rawPostId, error: errorMessage }));
      await incrementCounter(env.DB, "poll_sync_analysis_failures");
      await env.EVENT_ANALYSIS_QUEUE.send({ kind: "raw_post", rawPostId } satisfies RawPostJob);
      continue;
    }

    if (!candidate) continue;
    try {
      await processEditorial(env, { kind: "editorial_candidate", candidate });
    } catch (error) {
      const errorMessage = normalizeErrorMessage(error);
      console.error(JSON.stringify({ event: "poll_sync_editorial_failed", event_id: candidate.eventId, event_version: candidate.eventVersion, error: errorMessage }));
      await incrementCounter(env.DB, "poll_sync_editorial_failures");
      await env.EDITORIAL_QUEUE.send({ kind: "editorial_candidate", candidate } satisfies EditorialJob);
    }
  }
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
  const deterministicScore = scoreEvent(event);
  const judgment = await judgeEvent(env, event, deterministicScore);
  const score = scoreWithAdjustment(deterministicScore, judgment.adjustedScore - deterministicScore.finalScore);
  const publishedToday = await countStoriesToday(env.DB);
  const existingPublished = await env.DB.prepare(
    `SELECT publish_key, event_version, telegram_message_id, verification_status, independent_confirmations
       FROM published_stories
      WHERE event_id = ? AND publication_state = 'published'
      ORDER BY id ASC LIMIT 1`
  ).bind(event.id).first<PublishedEventState>();

  const aiAllowsNewPublication = !judgment.usedAi
    || judgment.recommendation === "PUBLISH"
    || (judgment.recommendation === "MONITOR" && judgment.isBreakingCandidate && score.finalScore >= config.breakingScore);
  const publish = !existingPublished
    && aiAllowsNewPublication
    && shouldPublish(event, score, (source?.high_priority ?? 0) === 1, publishedToday, config);
  const materialUpdate = existingPublished ? shouldEditPublishedStory(event, score.finalScore, existingPublished, config.breakingScore) : false;
  const reasons = [
    ...score.reasons,
    `ai_editor:${judgment.usedAi ? judgment.recommendation : "fallback"}`,
    `ai_editor_reason:${judgment.reason}`,
    `effective_score:${score.finalScore}`
  ];
  const decision = publish ? "PUBLISH" : score.finalScore >= 60 ? "MONITOR" : "IGNORE";
  const candidateStatus = materialUpdate
    ? String(env.PUBLISH_ENABLED) === "true" ? "update_queued" : "update_pending"
    : publish && String(env.PUBLISH_ENABLED) === "true" ? "queued" : "pending";

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO editorial_candidates(event_id, event_version, decision, score, reason_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, event_version) DO UPDATE SET decision = excluded.decision, score = excluded.score, reason_json = excluded.reason_json, status = excluded.status, updated_at = excluded.updated_at`
    ).bind(event.id, event.event_version, decision, score.finalScore, JSON.stringify(reasons), candidateStatus, new Date().toISOString(), new Date().toISOString()),
    env.DB.prepare("UPDATE events SET importance_score = ?, subscores_json = ?, updated_at = ? WHERE id = ?")
      .bind(score.finalScore, JSON.stringify({ ...score, ai_editor: judgment }), new Date().toISOString(), event.id)
  ]);

  if (materialUpdate && existingPublished?.telegram_message_id) {
    if (String(env.PUBLISH_ENABLED) !== "true") return;
    const story = await buildStoryDraft(env, event.id, event.event_version, reasons);
    const editJob: PublishJob = {
      eventId: event.id,
      eventVersion: event.event_version,
      publishKey: existingPublished.publish_key,
      story,
      mode: "edit",
      telegramMessageId: existingPublished.telegram_message_id
    };
    await env.PUBLISH_QUEUE.send({ kind: "publish", job: editJob } satisfies PublishQueueJob);
    return;
  }

  if (!publish) return;
  const story = await buildStoryDraft(env, event.id, event.event_version, reasons);
  const publishJob: PublishJob = {
    eventId: event.id,
    eventVersion: event.event_version,
    publishKey: `event:${event.id}:version:${event.event_version}`,
    story,
    mode: "publish"
  };
  if (String(env.PUBLISH_ENABLED) === "true") await env.PUBLISH_QUEUE.send({ kind: "publish", job: publishJob } satisfies PublishQueueJob);
}

async function processPublish(env: Env, job: PublishQueueJob): Promise<void> {
  if (String(env.PUBLISH_ENABLED) !== "true") return;

  if (job.job.mode === "edit") {
    if (!job.job.telegramMessageId) throw new Error("telegram_edit_message_id_missing");
    const previous = await env.DB.prepare(
      "SELECT event_version, title, description, verification_status, independent_confirmations FROM published_stories WHERE publish_key = ?"
    ).bind(job.job.publishKey).first<{ event_version: number; title: string; description: string; verification_status: string; independent_confirmations: number }>();
    if (!previous) throw new Error(`published_story_missing_for_edit:${job.job.publishKey}`);
    if (previous.event_version >= job.job.eventVersion) return;

    await editPublishedStory(env, job.job.story, job.job.telegramMessageId);
    const timestamp = new Date().toISOString();
    const updateType = classifyPublishedUpdate(previous.verification_status, job.job.story.verificationStatus);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE published_stories SET event_version = ?, title = ?, description = ?, verification_status = ?, independent_confirmations = ?,
          primary_sources_json = ?, category = ?, entity_tags_json = ?, links_json = ?, story_model = ?, last_error = NULL, updated_at = ?
          WHERE publish_key = ?`
      ).bind(
        job.job.story.eventVersion,
        job.job.story.title,
        job.job.story.description,
        job.job.story.verificationStatus,
        job.job.story.independentConfirmations,
        JSON.stringify(job.job.story.primarySources),
        job.job.story.category,
        JSON.stringify(job.job.story.tags),
        JSON.stringify(job.job.story.links),
        env.AI_TEXT_MODEL,
        timestamp,
        job.job.publishKey
      ),
      env.DB.prepare(
        `INSERT INTO event_updates(event_id, event_version, update_type, previous_snapshot_json, new_snapshot_json, editorial_action, reason, created_at)
         VALUES (?, ?, ?, ?, ?, 'EDIT_TELEGRAM', ?, ?)`
      ).bind(
        job.job.eventId,
        job.job.eventVersion,
        updateType,
        JSON.stringify(previous),
        JSON.stringify({ verification_status: job.job.story.verificationStatus, independent_confirmations: job.job.story.independentConfirmations, title: job.job.story.title, description: job.job.story.description }),
        "material published-story update",
        timestamp
      ),
      env.DB.prepare("UPDATE editorial_candidates SET status = 'updated', updated_at = ? WHERE event_id = ? AND event_version = ?")
        .bind(timestamp, job.job.eventId, job.job.eventVersion)
    ]);
    await incrementCounter(env.DB, "stories_edited");
    return;
  }

  const existing = await env.DB.prepare("SELECT publication_state FROM published_stories WHERE publish_key = ?")
    .bind(job.job.publishKey).first<{ publication_state: string }>();
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

function shouldEditPublishedStory(event: Awaited<ReturnType<typeof getEvent>> & {}, score: number, published: PublishedEventState, breakingScore: number): boolean {
  if (!published.telegram_message_id || event.event_version <= published.event_version) return false;
  if (event.verification_status !== published.verification_status) return true;
  if (event.verification_status === "CONFIRMED" && event.independent_confirmation_count >= published.independent_confirmations + 2) return true;
  return score >= breakingScore && event.independent_confirmation_count > published.independent_confirmations;
}

function classifyPublishedUpdate(previous: string, next: string): string {
  if (previous === "CONFIRMED" && next === "DISPUTED") return "CONTRADICTION";
  if (previous !== "CONFIRMED" && next === "CONFIRMED") return "MAJOR_UPDATE";
  if (previous !== next) return "MAJOR_UPDATE";
  return "MINOR_UPDATE";
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

async function recordUpdateFailure(db: D1Database, eventId: number, eventVersion: number, publishKey: string, error: string): Promise<void> {
  const timestamp = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE published_stories SET last_error = ?, updated_at = ? WHERE publish_key = ?")
      .bind(error.slice(0, 1_000), timestamp, publishKey),
    db.prepare("UPDATE editorial_candidates SET status = 'update_failed', updated_at = ? WHERE event_id = ? AND event_version = ?")
      .bind(timestamp, eventId, eventVersion)
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
        job: { eventId: row.event_id, eventVersion: row.event_version, publishKey: row.publish_key, story, mode: "publish" }
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
      const response = await fetch(`https://t.me/s/${encodeURIComponent(source.telegram_username)}`, { headers: { accept: "text/html", "user-agent": "Radar/0.2 source-validator" } });
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
    await env.PUBLISH_QUEUE.send({ kind: "publish", job: { eventId: row.event_id, eventVersion: row.event_version, publishKey: row.publish_key, story, mode: "publish" } } satisfies PublishQueueJob);
    const timestamp = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE published_stories SET publication_state = 'queued', last_error = NULL, updated_at = ? WHERE publish_key = ? AND publication_state <> 'published'").bind(timestamp, row.publish_key),
      env.DB.prepare("UPDATE editorial_candidates SET status = 'queued', updated_at = ? WHERE event_id = ? AND event_version = ?").bind(timestamp, row.event_id, row.event_version)
    ]);
    queued += 1;
  }
  return { queued };
}
