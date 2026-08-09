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

function forwardedFrom(segment: string): string | null {
  return capture(segment, /class="[^"]*tgme_widget_message_forwarded_from[^"]*"[^>]*href="https:\/\/t\.me\/([^\/?"#]+)[^"]*"/iu)
    ?? capture(segment, /tgme_widget_message_forwarded_from[\s\S]{0,800}?href="https:\/\/t\.me\/([^\/?"#]+)[^"]*"/iu);
}

function citedSource(text: string): string | null {
  const patterns: Array<[string, RegExp]> = [
    ["reuters", /(?:رویترز|reuters)/iu],
    ["ap", /(?:آسوشیتد\s*پرس|associated press|\bAP\b)/iu],
    ["afp", /(?:فرانس\s*پرس|agence france-presse|\bAFP\b)/iu],
    ["irna", /(?:خبرگزاری جمهوری اسلامی|\bایرنا\b|\bIRNA\b)/iu],
    ["tasnim", /(?:خبرگزاری تسنیم|\bتسنیم\b|\bTasnim\b)/iu],
    ["fars", /(?:خبرگزاری فارس|\bفارس\b|Fars News)/iu],
    ["bbc_persian", /(?:بی[‌\s-]*بی[‌\s-]*سی فارسی|BBC Persian)/iu],
    ["iran_international", /(?:ایران اینترنشنال|Iran International)/iu],
    ["euronews", /(?:یورونیوز|Euronews)/iu],
    ["alarabiya", /(?:العربیه|Al Arabiya)/iu]
  ];
  const attribution = /به\s+(?:نقل|گزارش)\s+از|منبع\s*[:：]|according to|reports?\s+(?:from|by)|via/iu.test(text);
  if (!attribution) return null;
  return patterns.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
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
    const isEdited = /\bedited\b|ویرایش/iu.test(segment);
    const mediaType = segment.includes("tgme_widget_message_photo_wrap")
      ? "photo"
      : segment.includes("tgme_widget_message_video")
        ? "video"
        : segment.includes("tgme_widget_message_document")
          ? "document"
          : null;
    const canonicalUrl = `https://t.me/${postKey}`;
    const forwarded = forwardedFrom(segment);
    const cited = citedSource(text);
    const metadata = {
      transport: "telegram_public_web",
      source_key: sourceKey,
      page_segment_length: segment.length,
      has_media: mediaType !== null,
      is_edited: isEdited,
      ...(forwarded ? { forwarded_from: forwarded } : {}),
      ...(cited ? { cited_source: cited } : {})
    };
    posts.push({
      sourceId,
      sourceKey,
      username,
      messageId,
      canonicalUrl,
      publishedAt: time ? new Date(time).toISOString() : null,
      editedAt: isEdited ? new Date().toISOString() : null,
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
