# Radar Implementation Playbook

This folder contains the implementation plan for Radar. V8 is the controlling architecture: public Telegram polling replaces the VPS/Telethon collector, and batched Nebula reasoning replaces semantic embeddings and vector search.

Run the phases **in order**. Each phase assumes the previous phase is complete and passing its acceptance criteria.

## Execution Order

1. [`01-foundation-and-contracts.md`](./01-foundation-and-contracts.md)
2. [`02-telegram-collector-and-ingestion.md`](./02-telegram-collector-and-ingestion.md)
3. [`03-source-registry-normalization-and-backfill.md`](./03-source-registry-normalization-and-backfill.md)
4. [`04-nebula-batch-intelligence.md`](./04-nebula-batch-intelligence.md)
5. [`05-source-independence-and-verification.md`](./05-source-independence-and-verification.md)
6. [`06-importance-and-editorial-engine.md`](./06-importance-and-editorial-engine.md)
7. [`07-story-covers-and-telegram-publisher.md`](./07-story-covers-and-telegram-publisher.md)
8. [`08-updates-observability-and-production-hardening.md`](./08-updates-observability-and-production-hardening.md)

## Global Rules for Every Phase

The coding agent must follow these rules throughout the project:

- Read `Overview/Full-Detailed-Overview.md` before making architectural decisions.
- Inspect the current repository before changing files; preserve working patterns introduced by previous phases.
- Do not implement future phases early unless a minimal interface/stub is required by the current phase.
- Prefer simple, testable components over premature abstraction.
- Keep Telegram public-page parsing isolated from the Cloudflare processing modules.
- Radar does not use embeddings, Vectorize, vector similarity, or semantic-neighbor retrieval. Semantic event understanding is performed by bounded Nebula LLM batches.
- Do not reintroduce Telethon, a Telegram user session, or a VPS without an explicit architecture decision.
- Do not add R2 for covers; the current architecture generates optional covers in memory and uploads them directly to Telegram. If cover generation or image processing fails, publish the story as text-only without a fallback graphic.
- Keep secrets out of Git.
- Use typed/validated contracts at service boundaries.
- All writes that may be retried must be idempotent.
- Treat Queue delivery as at-least-once.
- Add migrations rather than editing production database state manually.
- Add tests for important deterministic logic.
- Add structured logs around external boundaries and failure paths.
- Never let the LLM invent source confirmations, event IDs, or authoritative verification states.
- Do not silently swallow malformed AI output, network failures or database errors.
- Update documentation when configuration, schemas or deployment steps change.
- Do not add a large frontend/dashboard unless a phase explicitly asks for one.
- Preserve traceability from a published story back to the underlying event and raw source posts.

## Definition of Done for a Phase

A phase is complete only when:

- requested functionality is implemented;
- local/static tests pass;
- configuration examples are documented;
- secrets are represented only by placeholders;
- migrations are included when schema changes are introduced;
- failure paths are handled;
- the phase's acceptance criteria can be demonstrated;
- no unrelated refactor or visual/dashboard work has been introduced.

If an external credential or deployment resource is unavailable, implement everything that can be implemented locally, provide a precise setup checklist, and clearly mark the one blocked integration step instead of faking a successful result.
