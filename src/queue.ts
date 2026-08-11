import type { EditorialCandidate, PublishJob, TelegramWebPollEnvelope } from "./types";

export interface PollCycleJob {
  kind: "poll_cycle";
  scheduledAt: string;
}

export interface RawIngestJob {
  kind: "raw_ingest";
  envelope: TelegramWebPollEnvelope;
}

export interface RawPostJob {
  kind: "raw_post";
  rawPostId: number;
}

export interface AnalysisPrepareJob {
  kind: "analysis_prepare";
  rawPostId: number;
}

export interface AnalysisFinalizeJob {
  kind: "analysis_finalize";
  rawPostId: number;
}

export interface AnalysisBatchJob {
  kind: "analysis_batch";
  rawPostIds: number[];
}

export interface EditorialJob {
  kind: "editorial_candidate";
  candidate: EditorialCandidate;
}

export interface EditorialBatchJob {
  kind: "editorial_batch";
  candidates: EditorialCandidate[];
}

export interface PublishQueueJob {
  kind: "publish";
  job: PublishJob;
}

export interface ResumePublishingJob {
  kind: "resume_publishing";
  reason: "publishing_enabled" | "manual_requeue" | "continuation";
}

export type QueueJob =
  | PollCycleJob
  | RawIngestJob
  | RawPostJob
  | AnalysisPrepareJob
  | AnalysisFinalizeJob
  | AnalysisBatchJob
  | EditorialJob
  | EditorialBatchJob
  | PublishQueueJob
  | ResumePublishingJob;

export function isQueueJob(value: unknown): value is QueueJob {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "poll_cycle"
    || kind === "raw_ingest"
    || kind === "raw_post"
    || kind === "analysis_prepare"
    || kind === "analysis_finalize"
    || kind === "analysis_batch"
    || kind === "editorial_candidate"
    || kind === "editorial_batch"
    || kind === "publish"
    || kind === "resume_publishing";
}
