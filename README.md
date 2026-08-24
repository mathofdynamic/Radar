# Radar

Radar is a Cloudflare-only Persian news-intelligence pipeline. It polls public Telegram channel pages, persists raw reports in D1, forms events with bounded batched LLM reasoning through Nebula, verifies source independence deterministically, scores importance, and keeps editorial/publishing controls separate.

Radar does not use embeddings or vector search. Semantic event understanding is performed by batched LLM reasoning through Nebula.

## Architecture

```text
Cloudflare Cron every minute
  -> radar-poll Queue
  -> bounded due-source polling
  -> radar-raw-ingest Queue
  -> raw_posts in D1
  -> deterministic normalization/noise filtering
  -> durable five-minute intelligence_batch job
  -> Nebula /v1/chat/completions, intelligence model=@cf/zai-org/glm-4.7-flash
  -> validated event grouping decisions
  -> deterministic event/source relationships and origin groups
  -> deterministic verification and importance scoring
  -> radar-editorial Queue
  -> Nebula Stage-1 editorial judgment
  -> publishing gate (disabled in this branch)
  -> Nebula Stage-2 story generation when publishing is enabled later
  -> Workers AI image generation for optional covers only
```

The Cron handler only enqueues a poll tick. Polling, D1 work, recovery, and AI calls run in Queue consumers. The existing one-minute polling cadence, `POLL_BATCH_SIZE=5`, and `POLL_INTERVAL_SECONDS=300` remain unchanged.

## V8 intelligence batches

New or recovered reports remain in generic `pending`, `queued`, `analyzing`, `analyzed`, or `noise` states. A durable batch claims a bounded set using D1 leases. The default limit is 32 reports and a 60,000-character payload, with an 1,800-character report-text limit and up to 40 recent active-event summaries. If work remains, continuation Queue jobs process it in bounded steps; raw report text is never placed in Queue payloads.

Nebula receives compact report metadata and recent candidate events. It may return `MATCH_EXISTING_EVENT`, `NEW_EVENT`, `DUPLICATE`, `UPDATE_EXISTING_EVENT`, `NOISE`, or `UNCERTAIN`. Strict validation rejects unknown IDs, invalid categories/confidence, missing coverage, duplicate assignments, contradictory assignments, and fabricated event IDs. A low-confidence or uncertain decision receives one focused ambiguity pass. If it remains uncertain, Radar keeps a separate monitorable event rather than forcing a merge.

Nebula never supplies authoritative confirmation counts. Radar calculates independent source/origin groups from `event_sources`, retained source relationships, and deterministic copied-source detection. D1 remains authoritative for raw posts, events, evidence, verification, scoring, and idempotency.

## Retry and backlog safety

`intelligence_batches` and `intelligence_batch_items` record batch status, leases, attempts, provider/model telemetry, token usage, decisions, and application state. Queue retries may repeat an API request, but conflict-safe event creation, `event_sources(event_id, raw_post_id)`, `originating_raw_post_id`, and `event_version_applied` prevent duplicate event/evidence/version application.

Migration `0008_remove_embedding_pipeline.sql` drops the obsolete `embedding_checkpoints` table and requeues unfinished legacy `processing`, `embedding`, and `embedded` rows. It does not delete historical raw posts, events, or evidence and does not drop generic V6 lease/hash columns. Recovery is bounded and prioritizes fresh pending reports before historical backlog.

The old `radar-events` Vectorize resource is not referenced or destroyed by this repository. It is an orphaned infrastructure resource that can be deleted manually after review.

## Nebula configuration

The Worker uses:

```text
NEBULA_BASE_URL=https://nebula-free-llm.nebula-ai-company.workers.dev/v1
NEBULA_API_KEY=<Worker secret>
NEBULA_INTELLIGENCE_MODEL=@cf/zai-org/glm-4.7-flash
NEBULA_EDITORIAL_MODEL=auto
NEBULA_INTELLIGENCE_TIMEOUT_MS=95000
NEBULA_EDITORIAL_TIMEOUT_MS=25000
```

`NEBULA_MODEL` and `NEBULA_TIMEOUT_MS` remain legacy compatibility fallbacks for editorial work. The API key is never committed. Nebula owns provider routing and fallback. Radar does not store provider credentials or rotate provider keys. Workers AI remains only for optional image cover generation.

## Local setup

Requirements: Node.js 20+, npm, and authenticated Wrangler v4.

```powershell
npm install
npm run types
npm run typecheck
npm test
npm run deploy:dry
git diff --check
```

Copy `.dev.vars.example` to `.dev.vars` for local secrets, then add `NEBULA_API_KEY` locally. Never commit the value. Live D1, Queue, Telegram, and Nebula smoke tests require credentials and are not part of the deterministic unit suite.

## Cloudflare resources

The Worker uses:

- D1: `radar-db`;
- Queues: `radar-poll`, `radar-raw-ingest`, `radar-event-analysis`, `radar-editorial`, `radar-publish`, `radar-dead-letter`;
- Workers AI binding `AI` for covers only.

There is no `EVENT_INDEX` binding and no Radar Vectorize dependency. Do not destroy the existing `radar-events` index automatically.

Publishing remains disabled by both `PUBLISH_ENABLED=false` and the D1 `publishing_enabled=false` setting during V8 review.

## Source registry and polling

The initial source seed is `seeds/sources.json`. Sources are polled through `https://t.me/s/{username}`. The idempotency key is `(source_id, telegram_message_id)`, and original text/raw metadata are retained before normalization. Source identity, polling health, origin relationships, and confirmation grouping are deterministic configuration/runtime concerns, not LLM-authoritative facts.

## Validation

The unit suite covers parsing, normalization, generic lease recovery, event-origin idempotency, structured Nebula output validation, batch grouping, existing-event matching, duplicate handling, ambiguity resolution, editorial gates, story language constraints, cover format handling, and publication safety. A production-derived Nebula backtest is required before deployment; it must remain read-only and must report agreements, disagreements, false-merge candidates, false-split candidates, and uncertainty.

Run it only with a locally supplied `NEBULA_API_KEY`:

```powershell
npm run backtest
```

The script uses SELECT-only remote D1 queries and exits blocked rather than fabricating results when the Worker secret is unavailable.

The public health endpoint is `GET /health`. The authenticated operations endpoint is `GET /ops/summary`.
