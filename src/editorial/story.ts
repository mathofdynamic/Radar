import { runtimeConfig } from "../config";
import { getEvent } from "../db";
import { storyDraftSchema } from "../contracts";
import { generateStructuredText } from "../intelligence/ai";
import type { EventRow, RawPostRow, SourceRow, StoryDraft } from "../types";

export async function buildStoryDraft(env: Env, eventId: number, eventVersion: number, reasons: string[]): Promise<StoryDraft> {
  const event = await getEvent(env.DB, eventId);
  if (!event) throw new Error(`story_event_not_found:${eventId}`);
  const sources = await env.DB.prepare(
    `SELECT s.name, s.public_url, s.telegram_username, rp.canonical_url, rp.normalized_text
       FROM event_sources es JOIN sources s ON s.id = es.source_id JOIN raw_posts rp ON rp.id = es.raw_post_id
      WHERE es.event_id = ? ORDER BY s.priority_tier, s.trust_score DESC LIMIT 5`
  ).bind(eventId).all<{ name: string; public_url: string; telegram_username: string; canonical_url: string; normalized_text: string }>();
  const sourceRows = sources.results;
  const links = sourceRows.map((source) => ({ label: source.name, url: source.canonical_url }));
  const primarySources = sourceRows.slice(0, 3).map((source) => ({ name: source.name, url: source.canonical_url }));
  const tags = await loadTags(env.DB, eventId);
  const prompt = JSON.stringify({
    task: "Write a concise Persian news story from evidence. Return JSON only. The title must be one line, concise, and must not include source handles or media emojis. The description must add context without repeating the title and must not include status or confirmation labels.",
    core_fact: event.core_fact,
    verification_status: event.verification_status,
    independent_confirmations: event.independent_confirmation_count,
    sources: sourceRows.map((source) => ({ name: source.name, report: source.normalized_text.slice(0, 600) })),
    category: event.category,
    tags,
    reasons
  });
  const aiResult = await generateStructuredText(env, prompt, "stage2");
  if (aiResult) {
    const candidate = storyDraftSchema.safeParse({
      eventId,
      eventVersion,
      title: typeof aiResult.title === "string" ? aiResult.title : fallbackTitle(event),
      description: typeof aiResult.description === "string" ? aiResult.description : fallbackDescription(event),
      verificationStatus: event.verification_status,
      independentConfirmations: event.independent_confirmation_count,
      primarySources,
      category: typeof aiResult.category === "string" ? aiResult.category : event.category,
      tags: Array.isArray(aiResult.tags) ? aiResult.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 8) : tags,
      links,
      coverConcept: typeof aiResult.cover_concept === "string" ? aiResult.cover_concept : `${event.category} editorial illustration`
    });
    if (candidate.success) return candidate.data;
    console.error(JSON.stringify({ event: "story_schema_invalid", event_id: eventId, issues: candidate.error.issues }));
  }
  return storyDraftSchema.parse({
    eventId,
    eventVersion,
    title: fallbackTitle(event),
    description: fallbackDescription(event),
    verificationStatus: event.verification_status,
    independentConfirmations: event.independent_confirmation_count,
    primarySources,
    category: event.category,
    tags,
    links,
    coverConcept: `${event.category} symbolic editorial illustration for Radar`
  });
}

async function loadTags(db: D1Database, eventId: number): Promise<string[]> {
  const result = await db.prepare(
    `SELECT e.display_name FROM event_entities ee JOIN entities e ON e.id = ee.entity_id WHERE ee.event_id = ? LIMIT 8`
  ).bind(eventId).all<{ display_name: string }>();
  return result.results.map((row) => row.display_name);
}

function fallbackTitle(event: EventRow): string {
  const fact = event.core_fact.replace(/\s+/gu, " ").trim();
  return fact.length <= 140 ? fact : `${fact.slice(0, 137)}…`;
}

function fallbackDescription(event: EventRow): string {
  const status = event.verification_status === "CONFIRMED" ? "تأییدشده" : event.verification_status === "DEVELOPING" ? "در حال تکمیل" : event.verification_status === "DISPUTED" ? "مورد اختلاف" : "تأییدنشده";
  const text = `${event.core_fact}\nوضعیت: ${status} | تأیید مستقل: ${event.independent_confirmation_count}`;
  return text.slice(0, 1_000);
}
