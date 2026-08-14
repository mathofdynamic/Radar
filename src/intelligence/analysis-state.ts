export const ANALYSIS_STALE_AFTER_MS = 10 * 60 * 1_000;

// These legacy values are accepted only while an already-applied V8 migration
// drains old rows. They are not valid active V8 processing states.

export function isStaleAnalysisLease(leaseAt: string | null | undefined, now: string, staleAfterMs = ANALYSIS_STALE_AFTER_MS): boolean {
  if (!leaseAt) return true;
  const leaseTime = Date.parse(leaseAt);
  const nowTime = Date.parse(now);
  return !Number.isFinite(leaseTime) || !Number.isFinite(nowTime) || leaseTime <= nowTime - staleAfterMs;
}

export function shouldSkipAnalyzedPost(processingStatus: string): boolean {
  return processingStatus === "analyzed" || processingStatus === "noise";
}

export function normalizeLegacyAnalysisStatus(processingStatus: string): "pending" | "queued" | "analyzing" | "analyzed" | "noise" {
  if (processingStatus === "embedding" || processingStatus === "embedded" || processingStatus === "processing") return "pending";
  if (processingStatus === "queued" || processingStatus === "analyzing" || processingStatus === "analyzed" || processingStatus === "noise") {
    return processingStatus;
  }
  return "pending";
}

export function floorFiveMinuteWindow(timestamp: string): { start: string; end: string } {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) throw new Error("invalid_window_timestamp");
  const end = new Date(value);
  end.setUTCSeconds(0, 0);
  end.setUTCMinutes(Math.floor(end.getUTCMinutes() / 5) * 5);
  const start = new Date(end.getTime() - 5 * 60 * 1_000);
  return { start: start.toISOString(), end: end.toISOString() };
}
