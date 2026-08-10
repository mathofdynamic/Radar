# Radar

Radar is a Cloudflare-only Persian news-intelligence pipeline. It polls public Telegram channel pages, turns repeated reports into traceable events, estimates independent confirmation, scores editorial importance, generates concise Persian stories and covers, and publishes selected stories to the Radar Telegram channel.

This implementation intentionally uses scheduled polling of `https://t.me/s/{username}`. It does not use Telethon, a Telegram user session, or a VPS. The tradeoff is lower freshness and incomplete edit/delete/forward metadata compared with a persistent MTProto collector.

## Architecture

```text
Cloudflare Cron (tiny: enqueue one tick only)
  -> radar-poll Queue
  -> poll-cycle Queue consumer
       -> select bounded due-source batch from D1
       -> fetch + parse Telegram public pages
       -> persist raw posts
       -> normalization + embeddings + Vectorize
       -> event clustering + verification
       -> editorial judgment
       -> publish Queue only for approved stories

Fallback queues are retained for failed individual stages:
  radar-raw-ingest
  radar-event-analysis
  radar-editorial
```

The Cron handler deliberately performs no D1 queries, Telegram fetches, HTML parsing, hashing, AI work, or recovery scans. Those operations run inside the `radar-poll` Queue consumer, where the Free-plan CPU constraint is substantially less restrictive.

To stay inside the Workers Free Queues allowance, the normal path does **not** enqueue one message per source or one message per processing stage. One Cron tick creates one `poll_cycle` message; that consumer handles a bounded set of due sources synchronously. The older stage queues are failure fallbacks rather than the default pipeline.

## Local setup

Requirements: Node.js 20+, npm, and authenticated Wrangler v4.

```powershell
npm install
npm run types
npm run typecheck
npm test
npm run deploy:dry
```

For local secrets:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

The bot token must be rotated in BotFather before it is placed in `.dev.vars` or Cloudflare secrets. The token previously pasted into the conversation is not used.

Run the Worker locally with `npm run dev`. Trigger the scheduled event with the Wrangler scheduled-event route shown by the current Wrangler output; the scheduled handler itself only enqueues a `poll_cycle` job.

## Cloudflare resources

The target account is `mathofdynamic2`. Create the following resources before production deployment:

- D1: `radar-db`
- Queues: `radar-poll`, `radar-raw-ingest`, `radar-event-analysis`, `radar-editorial`, `radar-publish`, `radar-dead-letter`
- Vectorize index: `radar-events`

If upgrading an existing deployment, create the new poll queue before deploying this branch:

```powershell
npx wrangler queues create radar-poll
```

The `radar-poll` consumer is configured with `max_batch_size=1` and `max_concurrency=1` so overlapping poll cycles do not repeatedly select the same due sources when a backlog forms.

After creating D1, replace the placeholder `database_id` in `wrangler.jsonc`, apply migrations, and run `npm run types`.

Set the replacement token securely:

```powershell
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put RADAR_ADMIN_KEY
wrangler secret put RADAR_DASHBOARD_USERNAME
wrangler secret put RADAR_DASHBOARD_PASSWORD
```

The protected operations console is available at `/admin`. It uses an HttpOnly, Secure, SameSite session cookie signed with the dashboard password and refreshes its D1-backed snapshot every 60 seconds. Never commit or paste the dashboard password into source control or chat.

Publishing is disabled by default in new environments. Set `PUBLISH_ENABLED` to `true` only after the bot is an administrator of the destination channel with posting permission and the smoke checks pass.

## Free-plan scheduling budget

With a one-minute Cron, `radar-poll` receives at most 1,440 normal poll-cycle messages per UTC day. A successfully delivered Queue message normally incurs write + read + delete operations, so the scheduler consumes roughly 4,320 Queue operations/day before retries. This leaves headroom under the Free Queues daily allowance for publication jobs and rare fallback-stage retries.

Do not change the architecture to enqueue one polling message per source every few minutes: with 20+ sources that can exceed the Free Queues operation allowance even before news-processing messages are counted.

## Source registry

The initial seed is in `seeds/sources.json`. Every candidate must pass a public-page fetch smoke test before activation. Source relationships and trust metadata are editorial configuration, not automatically learned truth.

## Validation

The test suite covers public Telegram parsing, idempotent raw-post updates, normalization, clustering, verification, scoring, story constraints, AI image-format detection, publication formatting, and update classification. Live Telegram, Workers AI, Vectorize, and Cloudflare Queue behavior require deployment smoke tests and credentials.

After deployment, verify both of these separately:

1. Cron executions finish without `exceededCpu` and only produce the poll Queue write.
2. `radar-poll` consumer executions perform the actual polling and processing successfully.

## Scope note

The original project documents describe a Telethon collector. `Overview/Cloudflare-Free-Adaptation.md` is the current architecture decision for this repository and supersedes the VPS/Telethon portions of the original phase prompts.
