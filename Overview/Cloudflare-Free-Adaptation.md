# Cloudflare-Free Radar Adaptation

Radar is implemented here as a Cloudflare-only polling MVP.

## Replaced boundary

The original plan used a persistent Telethon user account on a Linux VPS. This repository has no external runtime, so collection uses public Telegram pages:

```text
Cloudflare Cron
  -> one lightweight radar-poll Queue message
  -> poll-cycle Queue consumer
       -> select due sources from D1
       -> https://t.me/s/{username}
       -> persist + analyze synchronously
       -> publish Queue only for approved stories
```

The Cron handler must remain intentionally tiny because Workers Free gives Cron invocations only a very small CPU budget. It performs no D1 reads, recovery scans, Telegram fetches, HTML parsing, hashing, embeddings, or editorial work.

The adapter does not promise real-time delivery, reliable deletes, complete forward metadata, or numeric Telegram channel IDs. Stable internal source IDs and public message URLs are the authoritative identity available to the polling transport.

## Why the poll Queue is one cycle, not one source

Workers Free Queues have a daily operation allowance, and a normally delivered message uses write + read + delete operations. Enqueuing one message per source every few minutes would consume the Free allowance too quickly once 20+ sources are active.

Radar therefore emits exactly one normal `poll_cycle` Queue message per Cron tick. The consumer selects a bounded batch of due sources and processes them within that invocation.

With a one-minute Cron:

- maximum normal poll-cycle messages/day: 1,440;
- approximate Queue operations for those successful deliveries: 4,320/day;
- publication messages and rare fallback retries use the remaining headroom.

The previous raw-ingest, analysis, and editorial queues remain configured, but they are no longer the normal path for every post. They are used as stage-specific fallbacks if synchronous processing fails after data has been persisted.

The `radar-poll` consumer uses `max_batch_size=1` and `max_concurrency=1` to prevent overlapping poll cycles from repeatedly selecting the same overdue sources when a backlog forms.

## Storage decision

R2 is intentionally not used. Covers are generated in Worker memory: Workers AI is used when the cover budget allows, and a deterministic branded PNG is used otherwise. The bytes are uploaded directly to Telegram with `sendPhoto`; D1 stores the event/version cover reference. AI-generated cover bytes are not archived, so a retry after an unpersisted Telegram failure may generate a new AI image.

## Polling defaults

- one scheduled Cron tick per minute;
- Cron only enqueues one `poll_cycle` job;
- up to eight due sources per poll-cycle consumer invocation by default;
- base source interval of three minutes, with actual revisit time depending on active-source count and backlog;
- bounded response body of 512 KiB;
- failed pages mark the source degraded and never look like an empty page;
- source cursors are stored in D1;
- repeated messages are idempotent on `(source_id, telegram_message_id)`;
- suspicious jumps between the previous message ID and the earliest currently visible public-page message increment `poll_gap_suspected` and are logged for operator review;
- stale publication recovery runs from the poll consumer only on fifteen-minute boundaries rather than on every Cron invocation.

Public-page polling still has a hard limitation: a sufficiently active channel can publish enough messages between successful polls that older unseen posts disappear from the current web preview. The V2 polling changes reduce this risk and make suspected gaps observable; they do not eliminate it. MTProto remains the stronger long-term ingestion transport if collection completeness becomes a requirement.

## Intelligence V2

The current pipeline uses Workers AI embeddings as an actual event-matching signal rather than only storing them in Vectorize. Vectorize nearest neighbors are combined with lexical overlap, entities, and temporal proximity when assigning reports to events.

Near-duplicate reports are retained as evidence. A report may be marked as duplicate content while still being attached to the event, allowing independent confirmation logic to evaluate its origin instead of discarding it.

The public Telegram parser also extracts available forward and citation hints. These hints, plus strong lexical-copy relationships, are used to group reports by likely origin so copied reports do not automatically inflate confirmation counts.

Importance scoring intentionally uses conservative deterministic priors. Events that reach the editorial stage are then reviewed by a low-cost AI editor that can adjust the score and recommend `PUBLISH`, `MONITOR`, or `IGNORE`. Verification and publication safety gates still remain deterministic.

Material changes to an already-published event can edit the existing Telegram caption instead of creating a second story. Verification changes, meaningful confirmation growth, and breaking-event developments are treated as material updates.

## Publishing identity

The Radar destination is `https://t.me/RadarKhabarOnline` with chat ID `-1004496469105`. The bot token is a Worker secret and must be rotated if exposed. Publishing is gated by `PUBLISH_ENABLED` and the bot's channel administrator permission.

`PUBLISH_ENABLED` is intentionally set to `false` on the Intelligence V2 branch. Re-enable it only after type generation, tests, deployment smoke checks, source validation, and observation of real event clustering/editorial decisions.

## Deployment change for existing installations

Create the additional Queue before deploying this branch:

```powershell
npx wrangler queues create radar-poll
```

Then deploy normally and verify that Cron executions no longer report `exceededCpu`. The expensive work should appear under `radar-poll` Queue consumer invocations instead.

## AI and cost policy

AI is optional at every stage. D1 stores the raw evidence even when an AI stage is skipped. Daily usage counters and configured stage caps stop new AI work when the free budget is exhausted. Deterministic clustering fallbacks, scoring, story fallback, and branded PNG cover generation remain available without R2.
