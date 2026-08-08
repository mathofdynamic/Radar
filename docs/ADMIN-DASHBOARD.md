# Radar Admin Dashboard

The dashboard is served by the same Worker at `/admin`. It is intentionally not a separate frontend deployment, so it reads the same D1 database and operational counters as the pipeline.

## Configure credentials

Set both values as Cloudflare Worker secrets. Do not put them in `wrangler.jsonc`, Git, chat, or browser local storage:

```powershell
$DashboardUsername = "radar-operator"
$DashboardPassword = "replace-this-with-a-long-random-password"
$DashboardUsername | npx wrangler secret put RADAR_DASHBOARD_USERNAME
$DashboardPassword | npx wrangler secret put RADAR_DASHBOARD_PASSWORD
```

Or generate and upload both values locally without choosing a weak password:

```powershell
.\scripts\set-dashboard-credentials.ps1
```

Save the printed credentials in your password manager. The script does not write them to the repository.

For a generated password on PowerShell, create it locally and pipe it directly to Wrangler. Do not paste the value into a conversation or commit it.

## What it shows

The console refreshes every 60 seconds and presents the current D1-backed snapshot:

- live pulse KPIs for sources, posts, events, stories, failures, and AI usage;
- activity stream combining polling, ingestion, event clustering, source failures, and publication;
- pulled news cards with original Persian text, processing status, and Telegram links;
- event verification, independent confirmation counts, importance score, and editorial status;
- source health, priority tier, last poll, cursor, and error details;
- persisted story state and Telegram message IDs;
- operator actions for source validation, bot permission checks, and pending requeue.

## Security model

- Passwords are Worker secrets and are compared using timing-safe digests.
- Successful login creates an eight-hour HMAC-signed, HttpOnly, Secure, SameSite session cookie.
- Dashboard API routes reject requests without a valid session.
- No dashboard secret is returned by any API response.
- Existing Bearer-token admin endpoints remain available for automation.

The dashboard is an operations view, not a replacement for Cloudflare Worker logs. Use `wrangler tail radar-pipeline --format json` or Cloudflare Observability for runtime logs; use the dashboard for the D1-backed application state and activity timeline.
