import { readBoundedText } from "../crypto";
import { runtimeConfig } from "../config";
import { getSourcePostFingerprints, incrementCounter, listDueSources, updateSourcePollFailure, updateSourcePollSuccess } from "../db";
import { parseTelegramPublicPage } from "./parser";
import type { TelegramWebPollEnvelope, SourceRow } from "../types";

export const POLL_SOURCE_TIMEOUT_MS = 15_000;

export async function pollDueSources(env: Env): Promise<TelegramWebPollEnvelope[]> {
  const config = runtimeConfig(env);
  const now = new Date().toISOString();
  const sources = await listDueSources(env.DB, now, config.pollBatchSize);
  const envelopes: TelegramWebPollEnvelope[] = [];
  let sourcesPolled = 0;
  let postsObserved = 0;
  let sourceFailures = 0;

  for (const source of sources) {
    try {
      const result = await pollSource(env, source);
      envelopes.push(...result.envelopes);
      await updateSourcePollSuccess(env.DB, source, result.latestMessageId, config);
      sourcesPolled += 1;
      postsObserved += result.envelopes.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_poll_error";
      await updateSourcePollFailure(env.DB, source.id, message, config);
      sourceFailures += 1;
      console.error(JSON.stringify({ event: "source_poll_failed", source_id: source.id, source_key: source.source_key, error: message }));
    }
  }

  if (sourcesPolled > 0) await incrementCounter(env.DB, "sources_polled", sourcesPolled);
  if (postsObserved > 0) await incrementCounter(env.DB, "posts_observed", postsObserved);
  if (sourceFailures > 0) await incrementCounter(env.DB, "source_poll_failures", sourceFailures);
  return envelopes;
}

export async function pollSource(env: Env, source: SourceRow): Promise<{ envelopes: TelegramWebPollEnvelope[]; latestMessageId: number | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POLL_SOURCE_TIMEOUT_MS);

  try {
    const response = await fetch(`https://t.me/s/${encodeURIComponent(source.telegram_username)}`, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Radar/0.3 public-news-poller"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`telegram_http_${response.status}`);
    const html = await readBoundedText(response, runtimeConfig(env).maxHtmlBytes);
    if (!html) throw new Error("telegram_empty_response");
    const parsed = await parseTelegramPublicPage(html, source.id, source.source_key, source.telegram_username);
    if (parsed.warnings.length > 0) throw new Error(`telegram_parser_${parsed.warnings.join(",")}`);

    const earliestMessageId = parsed.posts.at(0)?.messageId ?? null;
    const latestMessageId = parsed.posts.at(-1)?.messageId ?? source.last_seen_message_id;
    if (source.last_seen_message_id !== null && earliestMessageId !== null && earliestMessageId > source.last_seen_message_id + 1) {
      await incrementCounter(env.DB, "poll_gap_suspected");
      console.warn(JSON.stringify({
        event: "telegram_poll_gap_suspected",
        source_id: source.id,
        source_key: source.source_key,
        previous_message_id: source.last_seen_message_id,
        earliest_visible_message_id: earliestMessageId
      }));
    }

    const fingerprints = earliestMessageId !== null && latestMessageId !== null
      ? await getSourcePostFingerprints(env.DB, source.id, earliestMessageId, latestMessageId)
      : new Map<number, string>();

    const envelopes: TelegramWebPollEnvelope[] = [];
    for (const post of parsed.posts) {
      if (fingerprints.get(post.messageId) === post.contentHash) continue;
      envelopes.push({
        schemaVersion: 1,
        transport: "telegram_public_web",
        sourceId: source.id,
        sourceKey: source.source_key,
        externalMessageId: post.messageId,
        updateType: source.last_seen_message_id !== null && post.messageId <= source.last_seen_message_id ? "edit" : "create",
        observedAt: new Date().toISOString(),
        post
      });
    }
    return { envelopes, latestMessageId };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("telegram_fetch_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
