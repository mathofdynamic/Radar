# Radar Cloudflare Deployment Runbook

Target account: `mathofdynamic2`.

## 1. Install and validate locally

```powershell
npm install
npm run types
npm run types:check
npm run typecheck
npm test
npm run deploy:dry
```

## 2. Create Cloudflare resources

```powershell
npx wrangler d1 create radar-db
npx wrangler queues create radar-raw-ingest
npx wrangler queues create radar-event-analysis
npx wrangler queues create radar-editorial
npx wrangler queues create radar-publish
npx wrangler queues create radar-dead-letter
npx wrangler vectorize create radar-events --dimensions 1024 --metric cosine
```

R2 is not required. Replace the D1 `database_id` in `wrangler.jsonc` with the ID returned by Wrangler.

## 3. Apply migrations

```powershell
npx wrangler d1 migrations apply radar-db --remote
npm run types
npm run types:check
```

Migration `0002_rename_cover_reference.sql` removes the old R2-specific column name from the already-created database. Covers are generated in memory and uploaded directly to Telegram.

## 4. Set secrets

The bot token previously shared in chat is compromised. Revoke it in BotFather first and generate a replacement. Never pass the value as a command-line argument or commit it.

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put RADAR_ADMIN_KEY
npx wrangler secret put RADAR_DASHBOARD_USERNAME
npx wrangler secret put RADAR_DASHBOARD_PASSWORD
```

Use a long random password for the dashboard. The Worker does not contain a default credential and fails closed until both dashboard secrets exist. The protected console is served at `/admin` after deployment.

## 5. Deploy with publishing disabled

Confirm `PUBLISH_ENABLED` is `false` in `wrangler.jsonc`, then:

```powershell
npx wrangler deploy
```

Check the public health endpoint:

```powershell
Invoke-RestMethod https://radar-pipeline.<your-workers-subdomain>.workers.dev/health
```

## 6. Seed and validate sources

Use the admin key only through an authorization header:

```powershell
$headers = @{ Authorization = "Bearer <RADAR_ADMIN_KEY>" }
Invoke-RestMethod -Method Post -Headers $headers -Uri https://radar-pipeline.<your-workers-subdomain>.workers.dev/admin/bootstrap-sources
Invoke-RestMethod -Method Post -Headers $headers -Uri https://radar-pipeline.<your-workers-subdomain>.workers.dev/admin/validate-sources
```

The validator activates only sources whose public Telegram page returns message markers. Failed sources remain inactive with `health_status=invalid` and a recorded error.

## 7. Verify the destination bot

```powershell
Invoke-RestMethod -Headers $headers -Uri https://radar-pipeline.<your-workers-subdomain>.workers.dev/admin/verify-telegram
```

The bot must be an administrator of `-1004496469105` and have posting permission.

## 8. Enable publishing

After the bot check succeeds, change `PUBLISH_ENABLED` to `true`, redeploy, and requeue candidates that were held while publishing was disabled:

```powershell
npx wrangler deploy
Invoke-RestMethod -Method Post -Headers $headers -Uri https://radar-pipeline.<your-workers-subdomain>.workers.dev/admin/requeue-pending
```

The first live run should be monitored with:

```powershell
npx wrangler tail radar-pipeline --format json
```

## Admin dashboard

Open `https://radar-pipeline.<your-workers-subdomain>.workers.dev/admin` and sign in with the dashboard secrets. The console refreshes automatically every minute and exposes source health, pulled Telegram posts, clustered events, verification, editorial decisions, published stories, D1 counters, AI usage, queue failures, and operator actions.

## Recovery

- Queue failures are retried by Cloudflare; inspect `queue_failures` and dead-letter state.
- Raw posts and events remain in D1 when AI calls fail.
- Covers are generated in memory with Workers AI when budget allows, or as deterministic branded SVGs, then uploaded directly to Telegram.
- Publishing retries are guarded by `publish_key = event:<id>:version:<version>`.
- If Telegram accepts a message while the Worker crashes before persistence, reconcile the channel manually before requeueing the candidate.
