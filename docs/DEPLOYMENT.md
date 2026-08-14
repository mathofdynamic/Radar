# Radar V8 Deployment Runbook

This branch is review-only. Do not deploy it, apply migration `0008` remotely, enable publishing, or delete the existing `radar-events` resource during V8 review.

## Local validation

```powershell
npm install
npm run types
npm run types:check
npm run typecheck
npm test
npm run deploy:dry
git diff --check
```

## Required resources

- D1: `radar-db`;
- Queues: `radar-poll`, `radar-raw-ingest`, `radar-event-analysis`, `radar-editorial`, `radar-publish`, `radar-dead-letter`;
- Workers AI binding `AI` for optional image covers only.

Radar V8 has no `EVENT_INDEX` binding and no Vectorize runtime dependency. The pre-existing `radar-events` Vectorize index is an orphaned resource and must be reviewed/deleted manually later, never automatically by this branch.

## Nebula secret/configuration

The Worker configuration contains the public endpoint and `NEBULA_MODEL=auto`. The API key must be stored as a Worker secret and never committed:

```powershell
npx wrangler secret put NEBULA_API_KEY
```

Do not add provider keys to Radar. Nebula owns provider routing and fallback.

## Migration order after approval

Only after review approval:

```powershell
npx wrangler d1 migrations apply radar-db --remote
npm run types
npm run types:check
```

Migration `0008_remove_embedding_pipeline.sql` drops the obsolete checkpoint table, requeues unfinished legacy analysis states, and creates durable Nebula batch audit tables. It does not delete raw posts, events, or evidence. This command is intentionally not run during the V8 implementation task.

## Publishing safety

Before any later deployment, verify both:

```text
wrangler.jsonc: PUBLISH_ENABLED=false
D1 runtime_settings: publishing_enabled=false
```

No Stage-2 story generation, cover generation, Telegram send, or publishing-resume operation is allowed during this review. Do not enable publishing until backtest, smoke tests, and manual review are complete.

## Operational checks after an approved deployment

Check `/health`, `/ops/summary`, Queue failures/dead letters, `intelligence_batches`, `intelligence_batch_items`, stale leases, Nebula failure counters, and raw-post backlog. Confirm fresh pending reports are not starved by historical recovery. Confirm no provider credentials or API keys appear in logs or batch audit rows.
