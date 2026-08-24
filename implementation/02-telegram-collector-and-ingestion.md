# Phase 02 — Public Telegram Polling and Ingestion

V8 uses public Telegram pages from the Worker. It does not use Telethon, a Telegram user session, a VPS, or a persistent collector process.

## Flow

```text
Cron every minute
  -> poll_cycle Queue message
  -> bounded due-source selection
  -> https://t.me/s/{username}
  -> validated polling envelope
  -> radar-raw-ingest
  -> idempotent raw_posts D1 upsert
```

The Cron handler only enqueues the tick. The poll consumer handles at most `POLL_BATCH_SIZE=5` due sources and uses `POLL_INTERVAL_SECONDS=300` for source scheduling.

## Envelope and idempotency

Capture source ID/key, external message ID, canonical URL, update type, observed/published/edited timestamps, text/caption, media hints, bounded HTML, metadata, and content hash. The D1 idempotency key is `(source_id, telegram_message_id)`. Same-hash repeats remain no-ops; changed edits re-enter generic pending analysis. Raw text and metadata are retained before normalization.

## Failure handling

Validate every envelope at the Queue boundary. A parse/fetch failure marks the source degraded and records an error. It does not produce an empty successful poll. Raw-ingest retries preserve the envelope and never put full reports into later intelligence Queue payloads.

## Scope

This phase owns collection and raw persistence only. Deterministic normalization follows in Phase 03. Semantic event understanding is implemented by the V8 Nebula batch phase; it is never a per-report embedding or vector-search operation.
