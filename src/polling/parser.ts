import { sha256Hex } from "../crypto";
import type { PolledPost } from "../types";

export interface ParseResult {
  posts: PolledPost[];
  warnings: string[];
}

function decodeHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&#x27;/giu, "'")
    .replace(/&#x2F;/giu, "/")
    .replace(/&#(\d+);/gu, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .trim();
}

function capture(source: string, pattern: RegExp): string | null {
  const match = pattern.exec(source);
  return match?.[1] ?? null;
}

export async function parseTelegramPublicPage(html: string, sourceId: number, sourceKey: string, username: string): Promise<ParseResult> {
  const marker = /data-post="([^"]+\/\d+)"/gu;
  const markers = Array.from(html.matchAll(marker));
  const warnings: string[] = [];
  if (markers.length === 0) {
    warnings.push(html.includes("tgme_page_widget") ? "page_has_no_message_markers" : "not_a_telegram_public_page");
    return { posts: [], warnings };
  }

  const posts: PolledPost[] = [];
  for (let index = 0; index < markers.length; index += 1) {
    const markerMatch = markers[index];
    const postKey = markerMatch[1];
    const start = markerMatch.index ?? 0;
    const end = markers[index + 1]?.index ?? html.length;
    const segment = html.slice(start, end);
    const parts = postKey.split("/");
    const messageId = Number(parts.at(-1));
    if (!Number.isSafeInteger(messageId) || messageId <= 0) continue;
    const textHtml = capture(segment, /class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/iu) ?? "";
    const text = decodeHtml(textHtml);
    const time = capture(segment, /<time[^>]*datetime="([^"]+)"/iu);
    const editedAt = capture(segment, /<time[^>]*datetime="[^"]+"[^>]*>[^<]*<\/time>[\s\S]*?edited/iu) ? new Date().toISOString() : null;
    const mediaType = segment.includes("tgme_widget_message_photo_wrap")
      ? "photo"
      : segment.includes("tgme_widget_message_video")
        ? "video"
        : segment.includes("tgme_widget_message_document")
          ? "document"
          : null;
    const canonicalUrl = `https://t.me/${postKey}`;
    const metadata = {
      transport: "telegram_public_web",
      source_key: sourceKey,
      page_segment_length: segment.length,
      has_media: mediaType !== null
    };
    posts.push({
      sourceId,
      sourceKey,
      username,
      messageId,
      canonicalUrl,
      publishedAt: time ? new Date(time).toISOString() : null,
      editedAt,
      text,
      mediaType,
      contentHash: await sha256Hex(`${canonicalUrl}\n${text}\n${mediaType ?? ""}`),
      rawHtmlSnippet: segment.slice(0, 12_000),
      metadata
    });
  }
  posts.sort((left, right) => left.messageId - right.messageId);
  return { posts, warnings };
}
