# Phase 08 — Updates, Observability, and Production Hardening

## Durable event updates

Preserve event versioning, source evidence, verification recalculation, editorial reconsideration, publication locks, and update history. `event_sources(event_id, raw_post_id)` and `event_version_applied` make at-least-once Queue delivery safe.

## V8 intelligence telemetry

Track:

- intelligence batches created/completed/failed;
- reports claimed/applied;
- primary and ambiguity-pass calls;
- Nebula failures and invalid outputs;
- prompt/completion token counts and routed provider/model when exposed;
- uncertain decisions;
- new events, existing matches, duplicates, and recovered leases;
- event verification distribution and editorial candidates.

Historical `ai_usage` rows remain for audit. No new embedding stage, embedding counter, vector operation, or semantic-neighbor metric is created.

## Failure recovery

Nebula 429s, 5xx responses, timeouts, malformed JSON, and schema failures release report leases and retain raw evidence. Queue retries are bounded and dead-lettered. A primary ambiguity pass is followed by at most one focused second pass; persistent uncertainty stays separate/monitorable. No incomplete AI output mutates events.

## Polling and database health

Monitor source last-poll age, overdue sources, poll failures, raw backlog, stale intelligence leases, batch latency, queue failures, D1 errors, and dead letters. Keep fresh reports ahead of historical recovery. Do not tune polling cadence as part of V8.

## Security and publishing

Keep `NEBULA_API_KEY` as a Worker secret. Never store API keys or giant prompts in D1/logs. Confirm no publishing flag is enabled. During review, D1 `publishing_enabled=false`, Wrangler `PUBLISH_ENABLED=false`, Stage-2 is inactive, cover generation is inactive, and Telegram sends are zero.

## Deployment review

Before any later deployment, run the read-only production-derived Nebula backtest with at least 500 reports when available, inspect false-merge candidates manually, run the full local test/type/deploy-dry suite, review migration `0008`, and verify the orphaned Vectorize resource is not bound. Do not apply the migration or deploy automatically.
