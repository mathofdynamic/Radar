# Phase 02 — Telegram Collector and Cloudflare Ingestion

## Coding-Agent Prompt

Implement Phase 02 of Radar.

Read first:

- `Overview/Full-Detailed-Overview.md`
- `implementation/README.md`
- `implementation/01-foundation-and-contracts.md`

Assume Phase 01 is complete. Reuse its schemas and contracts rather than replacing them.

## Goal

Build the first end-to-end live data path:

```text
Telegram public channel
  -> Telethon collector on VPS/runtime
  -> signed HTTPS request
  -> Cloudflare ingestion Worker
  -> Cloudflare Queue
  -> Queue consumer
  -> idempotent D1 raw_posts upsert
```

Do not implement embeddings, event clustering, importance scoring, story generation or publishing yet.

## Collector Requirements

Use Python 3.11+ and Telethon unless the repository already contains a justified equivalent.

The collector must support a dedicated Telegram user account authenticated with:

- `api_id`
- `api_hash`
- phone/login flow
- persistent session file

### New messages

Listen for new posts from configured channels and normalize them into the shared ingest envelope.

Capture at minimum:

- Telegram channel ID
- channel username/name when available
- message ID
- canonical message URL
- original publication time
- edit time
- normalized text/caption
- media type
- media group ID / album identity
- views
- forwards
- forwarded-from metadata
- reply-to message ID
- message entities/links where useful
- safe raw metadata subset for debugging

### Edits

Handle Telegram message edits and emit `update_type=edit` with the same stable message identity.

### Deletes

Handle delete updates where Telethon exposes them. Emit `update_type=delete` without assuming every deletion can always be observed.

### Albums

Ensure grouped media posts are represented consistently. Avoid inserting every image caption as unrelated news when Telegram emits album-related events separately.

### Reconnect behavior

- rely on Telethon reconnect support;
- explicitly log reconnect/failure events;
- handle `FloodWaitError` by respecting Telegram's required wait time;
- never implement aggressive retry loops;
- persist the session between restarts.

### Local delivery buffer

Implement a small durable outgoing buffer on the collector side, preferably SQLite or another simple local disk-backed mechanism.

Behavior:

1. Normalize Telegram update.
2. Store pending delivery locally.
3. Send to Cloudflare.
4. Remove/mark delivered only after successful accepted response.
5. Retry failed delivery with bounded exponential backoff.

This protects against Cloudflare/network downtime.

## Channel Configuration

Do not hardcode monitored channels inside event handler code.

Provide a configuration mechanism that initially supports a list of Telegram usernames/channel IDs.

A later phase will build the richer source registry; this phase only needs a simple reliable configuration path.

## Signed HTTPS Delivery

Use the Phase 01 payload contract.

Sign requests using HMAC with a timestamp and request body so the ingestion Worker can verify authenticity and reject replayed/forged requests.

Recommended properties:

- timestamp header
- signature header
- bounded accepted clock skew
- constant-time signature comparison where available
- no HMAC secret in logs

## Cloudflare Ingestion Worker

The HTTP ingestion route should:

1. accept only expected method/path;
2. enforce reasonable payload size;
3. verify timestamp/signature;
4. validate the JSON envelope;
5. reject malformed/unauthorized requests clearly;
6. enqueue validated events to the raw ingest Queue;
7. return quickly after enqueueing.

Do not perform AI or heavy D1 processing in the HTTP request.

## Queue Consumer

Consume raw Telegram updates and persist them to D1.

Use idempotent upsert behavior keyed by:

```text
(telegram_channel_id, telegram_message_id)
```

Rules:

- repeated `create` must not duplicate the row;
- `edit` updates current content/edit timestamp when newer;
- `delete` marks the row deleted instead of physically removing history;
- out-of-order retry delivery must not roll a newer edit back to older content;
- failures should be retried by Queue semantics;
- unrecoverable validation/data failures should be logged clearly and routed to a dead-letter strategy if available in the project setup.

## Observability

Collector logs should include:

- startup/auth state without secrets;
- channel subscriptions being monitored;
- received message/update counts;
- Cloudflare delivery success/failure;
- retry counts;
- flood waits;
- last successful Telegram update time.

Add a small collector health endpoint or CLI health command exposing non-sensitive state such as:

- process healthy
- Telegram connected
- pending local delivery count
- last received update timestamp
- last successful Cloudflare delivery timestamp

Cloudflare logs should include request rejection reasons, Queue processing errors and D1 persistence failures without dumping sensitive tokens.

## Tests

Add tests for:

- Telegram object -> normalized payload mapping using fixtures/mocks;
- HMAC generation/verification;
- replay/timestamp rejection;
- repeated create idempotency;
- edit ordering;
- delete behavior;
- local delivery buffer retry lifecycle;
- malformed payload rejection.

Do not require live Telegram credentials for the normal automated test suite.

## Deployment Documentation

Document exact steps for running the collector on a small Linux VPS, including:

- Python/dependency setup;
- environment variables;
- first Telegram authentication;
- session persistence;
- systemd or Docker restart configuration;
- health check;
- safe logs;
- how to add temporary test channels.

Document Cloudflare deployment and Queue/D1 binding setup using placeholders, not real account secrets.

## Acceptance Criteria

Phase 02 is complete when:

1. A mocked/local Telegram update can traverse the full collector -> Worker -> Queue -> D1 path.
2. A real Telegram account can be configured without code changes.
3. New messages persist once even when delivered repeatedly.
4. Edits update the correct row.
5. Deletes mark the correct row when an event is available.
6. Collector outbound events survive a temporary Cloudflare outage via local durable buffering.
7. Invalid signatures and stale/replayed requests are rejected.
8. The collector restarts without losing its Telegram session.
9. Tests/lint/type checks pass.
10. No event intelligence or publishing logic has been added yet.

At the end, provide a concise implementation report and a short manual live-test checklist.