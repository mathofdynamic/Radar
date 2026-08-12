import type { EmbeddingCheckpointRow } from "../types";

export const ANALYSIS_STALE_AFTER_MS = 10 * 60 * 1_000;

export function isReusableEmbeddingCheckpoint(
  checkpoint: EmbeddingCheckpointRow | null,
  contentHash: string,
  embeddingModel: string
): checkpoint is EmbeddingCheckpointRow {
  return checkpoint != null
    && checkpoint.content_hash === contentHash
    && checkpoint.embedding_model === embeddingModel
    && checkpoint.embedding_state === "ready"
    && parseEmbedding(checkpoint.vector_json) != null;
}

/**
 * A deferred checkpoint must not reserve another embedding in the same UTC
 * day. It remains eligible after the UTC date changes, or can continue through
 * lexical analysis without another AI call during the current day.
 */
export function isDeferredCheckpointForCurrentUtcDate(
  checkpoint: EmbeddingCheckpointRow | null,
  contentHash: string,
  embeddingModel: string,
  now: string
): boolean {
  if (checkpoint == null
    || checkpoint.content_hash !== contentHash
    || checkpoint.embedding_model !== embeddingModel
    || checkpoint.embedding_state !== "deferred") return false;

  const checkpointDate = utcDate(checkpoint.updated_at);
  const currentDate = utcDate(now);
  return checkpointDate != null && checkpointDate === currentDate;
}

export function parseEmbedding(value: string | null): number[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every((item) => typeof item === "number" && Number.isFinite(item))
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function utcDate(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

export function isStaleAnalysisLease(leaseAt: string | null | undefined, now: string, staleAfterMs = ANALYSIS_STALE_AFTER_MS): boolean {
  if (!leaseAt) return true;
  const leaseTime = Date.parse(leaseAt);
  const nowTime = Date.parse(now);
  return !Number.isFinite(leaseTime) || !Number.isFinite(nowTime) || leaseTime <= nowTime - staleAfterMs;
}

export function shouldSkipAnalyzedPost(processingStatus: string): boolean {
  return processingStatus === "analyzed";
}

export function shouldApplyEventVersion(marker: number | null | undefined): boolean {
  return (marker ?? 0) === 0;
}
