# Radar V8 Cloudflare Architecture Decision

This repository runs entirely on Cloudflare Workers, D1, Queues, and Workers AI for optional image covers. It does not use a VPS, Telethon, a Telegram user session, embeddings, vector search, or Vectorize.

## Collection

The Worker Cron trigger runs every minute and only enqueues `poll_cycle`. The Queue consumer selects at most five due sources from D1, fetches public Telegram pages at `https://t.me/s/{username}`, parses bounded HTML, and persists raw posts. `POLL_BATCH_SIZE=5` and `POLL_INTERVAL_SECONDS=300` remain the production cadence.

The `(source_id, telegram_message_id)` key and content hash make ingestion idempotent. Raw evidence is retained before normalization. A failed source fetch is recorded as degraded; it is never converted into an empty successful poll.

## Processing

Normalization and obvious noise filtering are deterministic. Useful reports remain in generic analysis states and accumulate into approximately five-minute `intelligence_batches`. A batch claims a bounded set by D1 lease, sends only its ID through Queue, loads report text and recent active-event summaries from D1, and calls Nebula's OpenAI-compatible API.

Nebula's configured endpoint is:

```text
https://nebula-free-llm.nebula-ai-company.workers.dev/v1
```

Radar supplies only `NEBULA_API_KEY`, `NEBULA_BASE_URL`, and `model=auto`. Provider routing and fallback belong to Nebula. The batch output is strict JSON and can group multiple reports into one new event, match/update an existing supplied event, record duplicates, mark noise, or remain uncertain.

Radar validates identifiers, categories, confidence, assignment coverage, and contradictions before mutation. It calculates event/source relationships, copied-source support, origin groups, independent confirmations, verification state, importance score, and publication eligibility. The LLM is never authoritative for confirmation counts or publication.

## Why no Vectorize

V8 intentionally removes semantic vector infrastructure. There is no `EVENT_INDEX` binding, no vector upsert/query, and no embedding generation. The pre-existing `radar-events` Vectorize index is not destroyed automatically; it is an orphaned resource for later manual cleanup after review.

## Runtime constraints

The Cron handler does no D1 reads, polling, parsing, hashing, recovery, or AI work. Queue consumers perform those operations with bounded limits. Batch requests are capped by report count, report text length, active-event count, and total serialized payload. Fresh pending reports are prioritized over historical recovery.

Nebula failures release leases and preserve reports for bounded retry. `intelligence_batches`, `intelligence_batch_items`, `originating_raw_post_id`, `event_sources(event_id, raw_post_id)`, and `event_version_applied` provide durable audit and retry safety.

## Publishing and covers

Stage-1 editorial judgment and eventual Stage-2 story generation use Nebula. Covers remain separate Workers AI image work. During V8 review, both `PUBLISH_ENABLED=false` and D1 `publishing_enabled=false` are required. No Telegram publishing occurs.

## Migration

Migration `0008_remove_embedding_pipeline.sql` removes the obsolete checkpoint table and normalizes unfinished legacy analysis rows to `pending`. It does not delete historical raw posts, events, evidence, or generic analysis/idempotency columns. It is not applied remotely as part of the V8 implementation task.
