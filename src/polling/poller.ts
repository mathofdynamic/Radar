import { readBoundedText } from "../crypto";
import { runtimeConfig } from "../config";
import { incrementCounter, listDueSources, recordSourcePostFingerprint, updateSourcePollFailure, updateSourcePollSuccess } from "../db";
import { parseTelegramPublicPage } from "./parser";
import type { TelegramWebPollEnvelope, SourceRow } from "../types";

export async function pollDueSources(env: Env): Promise<TelegramWebPollEnvelope[]> {
  const config = runtimeConfig(env);
  const now = new Date().toISOString();
  const sources = await listDueSources(env.DB, now, config.pollBatchSize);
  const envelopes: TelegramWebPollEnvelope[] = [];
  for (const source of sources) {
    try {
      const result = await pollSource(env, source);
      envelopes.push(...result.envelopes);
      await updateSourcePollSuccess(env.DB, source, result.latestMessageId, config);
      await incrementCounter(env.DB, "sources_polled");
      await incrementCounter(env.DB, "posts_observed", result.envelopes.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_poll_error";
      await updateSourcePollFailure(env.DB, source.id, message, config);
      await incrementCounter(env.DB, "source_poll_failures");
      console.error(JSON.stringify({ event: "source_poll_failed", source_id: source.id, source_key: source.source_key, error: message }));
    }
  }
  return envelopes;
}

async function pollSource(env: Env, source: SourceRow): Promise<{ envelopes: TelegramWebPollEnvelope[]; latestMessageId: number | null }> {
  const response = await fetch(`https://t.me/s/${encodeURIComponent(source.telegram_username)}`, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Radar/0.2 public-news-poller"
    }
  });
  if (!response.ok) throw new Error(`telegram_http_${response.status}`);
  const html = await readBoundedText(response, runtimeConfig(env).maxHtmlBytes);
  if (!html) throw new Error("telegram_empty_response");
  const parsed = await parseTelegramPublicPage(html, source.id, source.source_key, source.telegram_username);
  if (parsed.warnings.length > 0) {
    throw new Error(`telegram_parser_${parsed.warnings.join(",")}`);
  }

  const earliestMessageId = parsed.posts.at(0)?.messageId ?? null;
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

  const envelopes: TelegramWebPollEnvelope[] = [];
  for (const post of parsed.posts) {
    const unchanged = await recordSourcePostFingerprint(env.DB, post);
    if (unchanged) continue;
    const envelope: TelegramWebPollEnvelope = {
      schemaVersion: 1,
      transport: "telegram_public_web",
      sourceId: source.id,
      sourceKey: source.source_key,
      externalMessageId: post.messageId,
      updateType: source.last_seen_message_id !== null && post.messageId <= source.last_seen_message_id ? "edit" : "create",
      observedAt: new Date().toISOString(),
      post
    };
    envelopes.push(envelope);
  }
  return { envelopes, latestMessageId: parsed.posts.at(-1)?.messageId ?? source.last_seen_message_id };
}
