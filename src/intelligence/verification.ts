import { incrementCounter } from "../db";
import type { EventRow, RawPostRow, SourceRow, VerificationStatus } from "../types";

interface EvidenceGroup {
  originGroup: string;
  sourceIds: Set<number>;
  credible: boolean;
  supports: boolean;
}

export function originGroupFor(source: SourceRow, rawPost: RawPostRow, existingGroup?: string): string {
  const metadata = safeJson(rawPost.raw_metadata_json);
  const forwardedFrom = typeof metadata.forwarded_from === "string" ? canonicalOrigin(metadata.forwarded_from) : null;
  const citedSource = typeof metadata.cited_source === "string" ? canonicalOrigin(metadata.cited_source) : null;
  if (forwardedFrom) return `origin:${forwardedFrom}`;
  if (citedSource) return `origin:${citedSource}`;
  if (existingGroup) return existingGroup;
  return source.is_wire_origin ? `origin:${source.source_key}` : `source:${source.id}`;
}

export function classifyOrigin(source: SourceRow, rawPost: RawPostRow): string {
  const metadata = safeJson(rawPost.raw_metadata_json);
  if (metadata.forwarded_from) return "forward_repost";
  if (typeof metadata.cited_source === "string") return "wire_republish";
  if (source.is_wire_origin || source.role === "primary_source") return "original_reporting";
  if (source.role === "aggregator" || source.role === "breaking_radar") return "aggregation";
  return "unknown";
}

export function calculateVerification(
  event: EventRow,
  evidence: Array<{ source: SourceRow; rawPost: RawPostRow; originGroup: string; originType: string }>
): { status: VerificationStatus; independentConfirmations: number; totalSources: number; groups: EvidenceGroup[] } {
  const groups = new Map<string, EvidenceGroup>();
  for (const item of evidence) {
    const group = groups.get(item.originGroup) ?? {
      originGroup: item.originGroup,
      sourceIds: new Set<number>(),
      credible: false,
      supports: true
    };
    group.sourceIds.add(item.source.id);
    const sourceCredible = item.source.trust_score >= 0.55 || item.source.priority_tier === "TIER_1";
    const evidenceCanConfirm = item.originType !== "aggregation" || item.source.priority_tier === "TIER_1";
    group.credible = group.credible || (sourceCredible && evidenceCanConfirm);
    group.supports = group.supports && !/تکذیب|رد\s+شد|جعلی|نادرست|denied|false|fake|not\s+true/iu.test(item.rawPost.normalized_text);
    groups.set(item.originGroup, group);
  }
  const groupList = Array.from(groups.values());
  const independentConfirmations = groupList.filter((group) => group.credible && group.supports).length;
  const hasConflict = groupList.some((group) => !group.supports) && independentConfirmations > 0;
  const status: VerificationStatus = hasConflict
    ? "DISPUTED"
    : independentConfirmations >= 2
      ? "CONFIRMED"
      : independentConfirmations === 1
        ? "DEVELOPING"
        : "UNVERIFIED";
  return { status, independentConfirmations, totalSources: evidence.length, groups: groupList };
}

export async function persistVerification(db: D1Database, eventId: number, result: ReturnType<typeof calculateVerification>): Promise<void> {
  await db.prepare(
    `UPDATE events SET verification_status = ?, source_count = ?, independent_confirmation_count = ?, confidence_score = ?, updated_at = ? WHERE id = ?`
  ).bind(
    result.status,
    result.totalSources,
    result.independentConfirmations,
    Math.min(100, result.independentConfirmations * 45),
    new Date().toISOString(),
    eventId
  ).run();
  await incrementCounter(db, `verification_${result.status.toLowerCase()}`);
}

function canonicalOrigin(value: string): string {
  const normalized = value.trim().toLocaleLowerCase().replace(/^@/u, "").replace(/[\s_-]+/gu, "_");
  const aliases: Record<string, string> = {
    "رویترز": "reuters",
    "reuters": "reuters",
    "آسوشیتد_پرس": "ap",
    "associated_press": "ap",
    "ap": "ap",
    "فرانس_پرس": "afp",
    "afp": "afp",
    "ایرنا": "irna",
    "irna": "irna",
    "irna_1313": "irna",
    "تسنیم": "tasnim",
    "tasnim": "tasnim",
    "tasnimnews": "tasnim",
    "فارس": "fars",
    "fars": "fars",
    "farsna": "fars",
    "bbc_persian": "bbc_persian",
    "bbcpersian": "bbc_persian",
    "iran_international": "iran_international",
    "iranintltv": "iran_international"
  };
  return aliases[normalized] ?? normalized.slice(0, 80);
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
