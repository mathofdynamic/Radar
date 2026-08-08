# Cloudflare-Free Radar Adaptation

Radar is implemented here as a Cloudflare-only polling MVP.

## Replaced boundary

The original plan used a persistent Telethon user account on a Linux VPS. This repository has no external runtime, so collection uses scheduled Worker requests to public Telegram pages:

```text
Cloudflare Cron -> https://t.me/s/{username} -> D1/Queue -> intelligence pipeline
```

The adapter does not promise real-time delivery, reliable deletes, full forward metadata, or numeric Telegram channel IDs. Stable internal source IDs and public message URLs are the authoritative identity available to the polling transport.

## Storage decision

R2 is intentionally not used. Covers are generated in Worker memory: Workers AI is used when the cover budget allows, and a deterministic branded SVG is used otherwise. The bytes are uploaded directly to Telegram with `sendPhoto`; D1 stores the event/version cover reference. AI-generated cover bytes are not archived, so a retry after an unpersisted Telegram failure may generate a new AI image.

## Polling defaults

- one scheduled invocation per minute;
- at most two sources per invocation;
- approximately 15-minute source cadence for 30 active sources;
- bounded response body of 512 KiB;
- failed pages mark the source degraded and never look like an empty page;
- source cursors are stored in D1;
- repeated messages are idempotent on `(source_id, telegram_message_id)`.

## Publishing identity

The Radar destination is `https://t.me/RadarKhabarOnline` with chat ID `-1004496469105`. The bot token is a Worker secret and must be rotated if exposed. Publishing is gated by `PUBLISH_ENABLED` and the bot's channel administrator permission.

## AI and cost policy

AI is optional at every stage. D1 stores the raw evidence even when an AI stage is skipped. Daily usage counters and configured stage caps stop new AI work when the free budget is exhausted. Deterministic clustering, scoring, story fallback, and branded SVG cover generation remain available without R2.
