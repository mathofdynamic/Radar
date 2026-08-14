# Phase 01 — Foundation and Contracts

V8 foundation requirements for the Cloudflare-only Radar Worker.

## Boundaries

- public Telegram polling runs in Worker Queue consumers;
- D1 is the system of record for raw posts, events, evidence, leases, and audit;
- Queues provide at-least-once delivery;
- Nebula is the text-LLM gateway for batch intelligence and editorial work;
- Workers AI is retained only for optional image covers;
- Radar does not use embeddings, Vectorize, vector similarity, or semantic-neighbor retrieval;
- publishing is independently gated and disabled during review.

## Required bindings

Configure D1, the raw-ingest/event-analysis/editorial/publish queues, the dead-letter queue, and the Workers AI `AI` binding. Do not configure an `EVENT_INDEX` binding. Do not add provider credentials to the Worker.

Required configuration:

```text
NEBULA_BASE_URL=https://nebula-free-llm.nebula-ai-company.workers.dev/v1
NEBULA_MODEL=auto
NEBULA_API_KEY=Worker secret
PUBLISH_ENABLED=false
```

## Shared contracts

Keep typed contracts for polling envelopes, raw posts, queue jobs, intelligence actions, editorial decisions, stories, source metadata, and verification state. Boundary input must be validated before D1 mutation. Intelligence actions are limited to `MATCH_EXISTING_EVENT`, `NEW_EVENT`, `DUPLICATE`, `UPDATE_EXISTING_EVENT`, `NOISE`, and `UNCERTAIN`.

## Schema principles

Keep raw evidence and generic analysis/idempotency columns. Use migrations for schema changes. `intelligence_batches` and `intelligence_batch_items` are durable audit tables. `event_sources(event_id, raw_post_id)` and `originating_raw_post_id` remain conflict-safe. Do not delete historical news/events/evidence as part of architecture replacement.
