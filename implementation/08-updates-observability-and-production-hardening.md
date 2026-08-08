# Phase 08 — Updates, Observability, and Production Hardening

## Coding-Agent Prompt

Implement Phase 08 of Radar.

Read first:

- `Overview/Full-Detailed-Overview.md`
- all previous implementation phase files

Assume the full vertical slice now works: collection, ingestion, event clustering, verification, importance scoring, story generation, cover generation and Telegram publishing.

## Goal

Make Radar reliable enough for continuous real-world use. Add material event-update handling, correction behavior, operational visibility, failure recovery, production security, deployment procedures and launch checks.

## Event Update Classification

Whenever new evidence joins an already published event, classify the change into a controlled enum:

- `NO_CHANGE`
- `MINOR_UPDATE`
- `MAJOR_UPDATE`
- `CORRECTION`
- `CONTRADICTION`

Use deterministic comparison first and a structured AI judgment only when necessary.

### NO_CHANGE

No meaningful new information. Do not touch the public Telegram post.

### MINOR_UPDATE

Small detail that does not materially change the user's understanding. Update internal event state; normally do not notify publicly.

### MAJOR_UPDATE

Material new information that changes the event's significance or understanding. Update the existing Telegram story or publish an explicit update depending on age/context.

### CORRECTION

Previously published factual detail is now shown to be wrong. Correct the public post visibly and preserve the internal history of what changed.

### CONTRADICTION

New credible evidence materially conflicts with the current story. Recalculate verification and make the uncertainty visible if the contradiction matters to the reader.

## Edit vs New Update Policy

Create centralized rules for choosing between:

- no public action;
- edit existing Telegram message;
- publish a new clearly labelled update;
- publish/mark correction.

Suggested factors:

- time since original publication;
- materiality of new information;
- whether users need a fresh notification;
- whether changing the old message alone could hide an important correction;
- Telegram editing constraints.

Do not create a new post for every source addition.

## Versioning and Audit Trail

Preserve enough history to answer:

- what Radar originally published;
- which event evidence existed at that time;
- what changed later;
- why verification changed;
- whether the Telegram message was edited;
- whether a correction/update was published.

Do not overwrite history without a trace.

## Re-Scoring After Updates

A meaningful event update must be able to trigger:

- verification recalculation;
- independent confirmation recalculation;
- importance recalculation;
- editorial reconsideration;
- story regeneration only when required.

Avoid expensive full-pipeline recomputation for trivial source additions when cached/structured state makes it unnecessary.

## Operational Observability

Create a practical operations view through structured logs, metrics and lightweight admin/debug tooling. A large user-facing dashboard is not required.

At minimum expose/track:

### Collector

- Telegram connection state;
- last received update;
- monitored source count;
- pending local delivery buffer;
- flood waits/reconnects;
- backfill/reconciliation status.

### Cloudflare ingestion

- accepted/rejected requests;
- authentication failures;
- Queue enqueue failures;
- payload validation errors.

### Queue processing

- queue depth/backlog where available;
- retries;
- dead-letter count;
- processing latency;
- failed raw post/event jobs.

### Intelligence pipeline

- posts ingested/day;
- posts filtered;
- embeddings generated;
- duplicates detected;
- new events/day;
- average sources/event;
- verification distribution;
- Stage-1/Stage-2 call counts;
- editorial candidate count;
- published stories/day;
- update/correction count.

### Publisher

- Telegram send/edit failures;
- duplicate-prevention hits;
- cover generation failures;
- R2 failures;
- last successful publication.

## Alerts

Define actionable alerts for conditions such as:

- collector disconnected for too long;
- no Telegram messages received despite active sources;
- local collector buffer growing continuously;
- Queue/dead-letter backlog above threshold;
- D1 write error spike;
- AI error/invalid-output spike;
- Telegram publisher failures;
- no successful editorial cycle for an abnormal duration.

Avoid alerting on harmless individual retries.

## Failure Recovery

Document and test recovery for:

### VPS restart

- process automatically starts;
- persistent Telegram session is reused;
- pending local delivery queue survives;
- bounded reconciliation/backfill fills likely gaps.

### Telegram disconnect / flood wait

- backoff correctly;
- no busy retry loop;
- resume and reconcile.

### Cloudflare temporary outage

- collector retains outgoing events locally;
- delivery resumes later;
- D1 idempotency prevents duplicates.

### Queue retry/out-of-order delivery

- current event/raw-post state is not rolled backward;
- repeated jobs remain safe.

### Workers AI outage/error

- events remain stored;
- jobs retry or move to a recoverable failed state;
- no fabricated fallback AI content is published.

### Image-generation failure

- important story can still publish using configured fallback behavior.

### Telegram publishing ambiguity

Handle/reconcile cases where Telegram may have accepted a publish/edit but the Worker did not persist success due to a crash/network error.

## Security Hardening

Review and enforce:

- HMAC request authentication;
- replay protection;
- input validation;
- least-privilege Cloudflare bindings/credentials;
- no secrets in logs;
- no `.session` files in Git;
- secure VPS file permissions;
- Worker secrets rather than committed tokens;
- bot token rotation procedure;
- Telegram monitoring account recovery procedure;
- dependency update policy.

Add/verify `.gitignore` rules for all secret/session/local database artifacts.

## Data Retention

Define configurable retention policies for:

- raw posts;
- raw metadata;
- generated covers;
- local collector buffer;
- operational logs;
- failed jobs/dead-letter data.

Do not delete published-story provenance needed for corrections/auditing.

## Cost Controls

Add practical controls for crisis spikes:

- limit unnecessary Stage-2 calls;
- avoid repeated embeddings for unchanged content;
- avoid cover regeneration on retries;
- configurable editorial thresholds;
- per-stage usage counters where possible;
- protect against accidental loops that continuously reprocess the same event.

## Production Deployment Documentation

Create an end-to-end production runbook covering:

1. required Cloudflare resources;
2. D1 migrations;
3. Queues;
4. Vectorize;
5. Workers AI bindings;
6. R2;
7. Worker secrets;
8. Telegram monitoring account setup;
9. VPS collector deployment;
10. publisher bot/channel setup;
11. source-registry activation;
12. smoke test;
13. rollback/recovery steps;
14. health checks after launch.

## Launch Strategy

Do not immediately enable a huge source list.

Recommended production rollout:

### Stage A — shadow mode

Run 10–20 sources. Process events and editorial decisions but publish only to a private test channel or require manual review.

Measure:

- clustering mistakes;
- false confirmations;
- missed important events;
- excessive/weak editorial selections;
- summary quality.

### Stage B — limited live mode

Enable the real private channel with conservative thresholds and roughly 20–30 verified sources.

### Stage C — controlled expansion

Add sources in small batches, measuring incremental value and duplication before reaching 50–100+.

## Regression Test Suite

Build/expand a fixture-based end-to-end regression suite containing realistic multilingual news flows:

- duplicate copies;
- independent confirmations;
- breaking but unverified reports;
- confirmation arriving later;
- correction;
- contradiction;
- multiple updates;
- irrelevant noise;
- AI output failure;
- Queue retry;
- source username change;
- collector downtime reconciliation.

The suite should validate the final event/publication outcome, not only isolated helper functions.

## Acceptance Criteria

Phase 08 is complete when:

1. published events support controlled update/correction handling;
2. minor updates do not spam the channel;
3. verification/importance can be recalculated after material evidence changes;
4. publication history is auditable;
5. major pipeline components expose useful operational state;
6. actionable alert conditions are documented/configured;
7. collector and Cloudflare outage recovery paths are tested;
8. secrets/session files are protected and excluded from Git;
9. a complete production deployment/runbook exists;
10. an end-to-end regression suite covers the critical V1 flows;
11. a shadow-mode launch can be performed safely before broad source expansion;
12. tests/lint/type checks pass.

At the end, provide a launch-readiness report with remaining risks, production checklist, known limitations and recommended first-week metrics to watch.