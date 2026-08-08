import type { StoryDraft } from "../types";
import { createDeterministicCover } from "./covers";
import type { CoverArtifact } from "./covers";

interface TelegramResponse {
  ok: boolean;
  result?: { message_id?: number };
  description?: string;
}

export async function publishStory(env: Env, story: StoryDraft, cover: CoverArtifact): Promise<number> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("telegram_bot_token_missing");
  try {
    return await sendPhoto(env, story, cover);
  } catch (error) {
    if (error instanceof Error && error.message.includes("IMAGE_PROCESS_FAILED") && !cover.reference.startsWith("deterministic-png:")) {
      console.error(JSON.stringify({ event: "telegram_cover_fallback", reason: "image_process_failed", event_id: story.eventId, event_version: story.eventVersion }));
      return await sendPhoto(env, story, createDeterministicCover(story));
    }
    throw error;
  }
}

async function sendPhoto(env: Env, story: StoryDraft, cover: CoverArtifact): Promise<number> {
  const caption = formatCaption(story);
  const form = new FormData();
  form.append("chat_id", env.RADAR_DESTINATION_CHAT_ID);
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  form.append("reply_markup", JSON.stringify(buildReplyMarkup(story)));
  form.append("photo", new Blob([cover.bytes], { type: cover.mimeType }), `radar-${story.eventId}-${story.eventVersion}.png`);
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: "POST", body: form });
  const payload = await response.json() as TelegramResponse;
  if (!response.ok || !payload.ok || !payload.result?.message_id) throw new Error(`telegram_publish_failed:${payload.description ?? response.status}`);
  return payload.result.message_id;
}

export async function verifyTelegramDestination(env: Env): Promise<{ ok: boolean; description?: string }> {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, description: "telegram_bot_token_missing" };
  const meResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
  const me = await meResponse.json() as { ok: boolean; result?: { id?: number }; description?: string };
  if (!meResponse.ok || !me.ok || !me.result?.id) return { ok: false, description: me.description ?? `telegram_get_me_http_${meResponse.status}` };
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(env.RADAR_DESTINATION_CHAT_ID)}&user_id=${me.result.id}`);
  if (!response.ok) return { ok: false, description: `telegram_permission_http_${response.status}` };
  const payload = await response.json() as { ok: boolean; result?: { status?: string; can_post_messages?: boolean }; description?: string };
  const canPost = payload.result?.status === "administrator" && payload.result.can_post_messages !== false;
  return payload.ok && canPost ? { ok: true } : { ok: false, description: payload.description ?? "telegram_bot_is_not_channel_publisher" };
}

export function formatCaption(story: StoryDraft): string {
  const title = cleanEditorialText(story.title);
  const description = cleanDescription(story.title, story.description);
  const status = verificationLabel(story.verificationStatus);
  const tags = story.tags.map((tag) => `#${tag.replace(/\s+/gu, "_")}`).join(" ");
  const sections = [
    `<b>${escapeHtml(title)}</b>`,
    description ? escapeHtml(description) : null,
    `وضعیت: ${status}`,
    `تأیید مستقل: ${toPersianDigits(story.independentConfirmations)}`,
    tags ? escapeHtml(tags) : null
  ].filter((section): section is string => section !== null);
  return `\u200f${sections.join("\n\n")}`;
}

export function buildReplyMarkup(story: StoryDraft): { inline_keyboard: Array<Array<{ text: string; url: string }>> } {
  const seen = new Set<string>();
  const links = story.links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
  const rows: Array<Array<{ text: string; url: string }>> = [];
  for (let index = 0; index < links.length; index += 2) {
    rows.push(links.slice(index, index + 2).map((link) => ({ text: link.label.slice(0, 32), url: link.url })));
  }
  return { inline_keyboard: rows };
}

function cleanEditorialText(value: string): string {
  return value
    .replace(/^🎥\s*/u, "")
    .replace(/(^|\s)@[A-Za-z0-9_]{3,}/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

function cleanDescription(title: string, value: string): string {
  let description = value.replace(/\r\n?/gu, "\n").trim();
  const sourceTitle = title.replace(/\r\n?/gu, "").trim();
  const rawTitle = cleanEditorialText(title);
  const normalizedDescription = description.replace(/\s+/gu, " ");
  const normalizedTitle = rawTitle.replace(/\s+/gu, " ").trim();
  if (description.startsWith(sourceTitle)) description = description.slice(sourceTitle.length).trim();
  else if (normalizedDescription.startsWith(normalizedTitle)) description = description.slice(rawTitle.length).trim();
  description = description
    .split("\n")
    .filter((line) => !/^وضعیت\s*[:：]/u.test(line.trim()) && !/^تأیید مستقل\s*[:：]/u.test(line.trim()))
    .join("\n")
    .trim();
  return cleanEditorialText(description);
}

function verificationLabel(status: StoryDraft["verificationStatus"]): string {
  return ({ CONFIRMED: "تأییدشده", DEVELOPING: "در حال تکمیل", DISPUTED: "مورد اختلاف", UNVERIFIED: "تأییدنشده" })[status];
}

function toPersianDigits(value: number): string {
  return String(value).replace(/[0-9]/gu, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
