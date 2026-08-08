# Radar

Radar is a Cloudflare-only Persian news-intelligence pipeline. It polls public Telegram channel pages, turns repeated reports into traceable events, estimates independent confirmation, scores editorial importance, generates concise Persian stories and covers, and publishes selected stories to the Radar Telegram channel.

This implementation intentionally uses scheduled polling of `https://t.me/s/{username}`. It does not use Telethon, a Telegram user session, or a VPS. The tradeoff is lower freshness and incomplete edit/delete/forward metadata compared with a persistent MTProto collector.

## Architecture

```text
Cloudflare Cron
  -> public Telegram page poller
  -> D1 source/raw-post state
  -> raw-ingest Queue
  -> normalization + embeddings + Vectorize
  -> event clustering + verification
  -> importance/editorial Queue
  -> Persian story + AI cover or deterministic SVG fallback
  -> direct Telegram Bot API upload
```

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

Run the Worker locally with `npm run dev`. Trigger the scheduled poller with the Wrangler scheduled-event route shown by the current Wrangler output.

## Cloudflare resources

The target account is `mathofdynamic2`. Create the following resources before production deployment:

- D1: `radar-db`
- Queues: `radar-raw-ingest`, `radar-event-analysis`, `radar-editorial`, `radar-publish`, `radar-dead-letter`
- Vectorize index: `radar-events`

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

## Source registry

The initial seed is in `seeds/sources.json`. Every candidate must pass a public-page fetch smoke test before activation. Source relationships and trust metadata are editorial configuration, not automatically learned truth.

## Validation

The test suite covers public Telegram parsing, idempotent raw-post updates, normalization, clustering, verification, scoring, story constraints, deterministic cover generation, publication formatting, and update classification. Live Telegram, Workers AI, Vectorize, and Cloudflare Queue behavior require deployment smoke tests and credentials.

## Scope note

The original project documents describe a Telethon collector. `Overview/Cloudflare-Free-Adaptation.md` is the current architecture decision for this repository and supersedes the VPS/Telethon portions of the original phase prompts.
