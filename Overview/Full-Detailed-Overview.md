# Radar V8 Product and System Overview

Radar is a low-noise Persian news-monitoring service. It collects public Telegram reports, groups reports into real-world events, verifies source independence, scores importance, and prepares tightly controlled editorial output. Publishing is a separate safety-gated capability.

## Product principles

- preserve raw evidence and source provenance;
- prefer a temporary false split over an unsafe false merge;
- never treat repetition or copied reports as independent confirmation;
- keep verification and publication decisions deterministic and auditable;
- fail closed when external AI or Telegram is unavailable;
- keep publishing disabled during architecture review.

## Current Cloudflare topology

```text
Cron every minute
  -> radar-poll
  -> public Telegram polling, source health, raw persistence
  -> radar-raw-ingest
  -> deterministic normalization/noise filtering
  -> five-minute intelligence_batches in D1
  -> radar-event-analysis
  -> Nebula batched event intelligence
  -> deterministic event/source/origin/verification/scoring
  -> radar-editorial
  -> Nebula Stage-1 editorial judgment
  -> gated Stage-2 story and optional Workers AI cover
  -> radar-publish (disabled in V8 review)
```

The repository does not use Telethon, a VPS, R2, embeddings, vector similarity, semantic-neighbor retrieval, or a Vectorize binding. The existing `radar-events` resource is not removed automatically.

## Ingestion

The scheduled handler only sends a `poll_cycle` Queue message. The consumer selects at most five due sources, polls `https://t.me/s/{username}`, parses bounded HTML, and persists reports into `raw_posts`. `(source_id, telegram_message_id)` is the idempotency key. Edits use content hashes to re-enter generic analysis; original raw text and metadata remain available for audit.

## Deterministic normalization

Radar normalizes Persian/Arabic text, strips known boilerplate, detects obvious low-signal/noise content, and computes a stable normalized content hash. It does not ask an LLM to rediscover deterministic fields. Reports needing semantic judgment remain pending.

## Batched event intelligence

Reports accumulate into approximately five-minute windows. Each `intelligence_batches` row records its window, sequence, status, report count, model requested, provider, attempts, token usage, lease, completion, and error. `intelligence_batch_items` records each report's decision and application state. Queue messages contain only the batch ID.

The default request limits are 32 reports, 40 active-event summaries, 1,800 characters per report, and 60,000 serialized characters. Active event candidates are recent and bounded. If the safe limit is exceeded, continuation batches are queued. Fresh pending reports are prioritized over historical recovery.

Nebula receives compact report metadata and candidate events. Its strict JSON action set is:

```text
MATCH_EXISTING_EVENT
NEW_EVENT
DUPLICATE
UPDATE_EXISTING_EVENT
NOISE
UNCERTAIN
```

The model reasons about meaning across Persian and English, time, context, and supplied evidence. It cannot invent post IDs, event IDs, facts, or confirmation counts. Several reports may appear in one `NEW_EVENT` decision, so Radar creates one event and attaches all reports without a merge-after-the-fact phase. One focused ambiguity pass is allowed; persistent uncertainty stays separate/monitorable.

## Verification authority

Radar remains authoritative for:

- source identity and source metadata;
- raw post/event relationships;
- copied-source and origin-group logic;
- independent confirmation count;
- `CONFIRMED`, `DEVELOPING`, `DISPUTED`, and `UNVERIFIED` state;
- deterministic importance score;
- editorial and publishing gates.

`event_sources(event_id, raw_post_id)` is conflict-safe. `event_version_applied` prevents a retry from advancing an event version twice. `originating_raw_post_id` plus the normal unique index makes new-event creation recoverable after a crash.

## Editorial and publishing

Events at or above the current Stage-1 threshold enter editorial processing. Stage-1 judgment uses Nebula and may recommend `PUBLISH`, `MONITOR`, or `IGNORE`; Radar still applies deterministic score, source, verification, budget, and publishing gates. Stage-2 uses a separate Nebula Persian-story prompt only when publishing is eventually enabled. Optional cover generation remains Workers AI image work. Batch event intelligence cannot publish directly.

Required V8 review state:

```text
PUBLISH_ENABLED=false
D1 publishing_enabled=false
```

## Recovery and observability

Nebula HTTP failures, 429s, 5xx responses, timeouts, invalid JSON, and schema failures release report leases and leave raw posts pending. Queue retries are bounded and dead-lettered by Wrangler configuration. New telemetry records intelligence batches, reports processed, primary/second-pass calls, failures, uncertainty, new events, existing matches, duplicates, provider/model, and token usage. Historical `ai_usage` rows remain for audit; no new embedding stage or embedding counter is created.

Migration `0008_remove_embedding_pipeline.sql` drops `embedding_checkpoints` and normalizes unfinished legacy `processing`, `embedding`, and `embedded` rows to `pending`. It does not delete historical raw posts, events, evidence, or generic V6 lease/hash columns.
