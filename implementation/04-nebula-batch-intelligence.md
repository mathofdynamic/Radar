# Phase 04 — Nebula Batch Intelligence

## Architecture decision

Radar does not use embeddings or vector search. Semantic event understanding is performed by batched LLM reasoning through Nebula's OpenAI-compatible API. Workers AI remains available only for optional image covers.

## Batch lifecycle

1. Deterministically normalize each raw post and mark obvious noise without an LLM.
2. Leave useful reports in generic `pending` state.
3. At approximately five-minute boundaries, create a durable `intelligence_batches` row.
4. Claim a bounded set of reports with a ten-minute lease and persist `intelligence_batch_items`.
5. Send only the batch ID through Queue. Read report text and active-event summaries from D1.
6. Call Nebula once for the primary batch. Split with continuation jobs when count or payload limits are reached.
7. Validate every decision before applying any D1 event mutation.
8. Send at most one focused ambiguity pass for low-confidence or `UNCERTAIN` assignments.
9. Apply event/source relationships idempotently, recalculate verification and importance, and queue editorial candidates.

## Request limits

The default limits are:

```text
reports/request: 32
active event summaries/request: 40
report text/request: 1,800 characters
serialized payload/request: 60,000 characters
active event horizon: 48 hours
```

The report count and total payload limit are both enforced. D1 is the source of truth; full reports are never placed in Queue payloads.

## Decision contract

Supported actions:

```text
MATCH_EXISTING_EVENT
NEW_EVENT
DUPLICATE
UPDATE_EXISTING_EVENT
NOISE
UNCERTAIN
```

Every supplied report ID must appear in exactly one decision. Existing event IDs must be supplied by Radar. A `NEW_EVENT` decision may contain several report IDs, allowing Radar to create one event and attach all reports in one idempotent application. Duplicate decisions reference a supplied canonical post.

The system prompt instructs Nebula to reason across Persian and English wording, respect time, distinguish same-entity/different-event cases, and avoid fabricated facts or identifiers. The output schema rejects unknown IDs, invalid categories/confidence, contradictory assignments, missing coverage, and unsupported fields.

## Deterministic authority

Nebula supplies semantic grouping only. Radar calculates:

- source identity;
- event/source relationships;
- copied-source relationships using lexical support logic;
- origin groups;
- independent confirmation counts;
- `CONFIRMED`, `DEVELOPING`, `DISPUTED`, and `UNVERIFIED` states;
- importance score;
- editorial and publishing eligibility.

The LLM must never return an authoritative confirmation count or directly publish.

## Retry and failure behavior

Nebula errors, invalid JSON, HTTP 429, HTTP 5xx, and timeouts release report leases and leave reports recoverable for bounded Queue retries. API call reservations are telemetry, not a reason to mark reports analyzed. `originating_raw_post_id`, the normal `event_sources` unique key, and `event_version_applied` make event/evidence/version application retry-safe.

If a primary decision is uncertain, Radar makes one focused request containing only the uncertain reports and two-to-five plausible events. If the second pass is still uncertain, Radar maintains a separate monitorable event rather than forcing a merge.

## Backlog migration

Migration `0008_remove_embedding_pipeline.sql` drops `embedding_checkpoints` and normalizes unfinished legacy `processing`, `embedding`, and `embedded` rows to `pending`. It preserves raw posts, events, evidence, content hashes, leases, attempts, and all historical AI usage rows. Recovery is bounded and selects fresh pending reports before historical backlog.
