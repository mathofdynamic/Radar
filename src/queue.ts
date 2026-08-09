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

export interface EditorialJob {
  kind: "editorial_candidate";
  candidate: EditorialCandidate;
}

export interface PublishQueueJob {
  kind: "publish";
  job: PublishJob;
}

export type QueueJob = PollCycleJob | RawIngestJob | RawPostJob | EditorialJob | PublishQueueJob;

export function isQueueJob(value: unknown): value is QueueJob {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "poll_cycle" || kind === "raw_ingest" || kind === "raw_post" || kind === "editorial_candidate" || kind === "publish";
}
