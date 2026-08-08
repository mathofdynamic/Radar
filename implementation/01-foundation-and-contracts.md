# Phase 01 — Foundation and Contracts

## Coding-Agent Prompt

You are implementing Phase 01 of Radar, an AI-assisted news intelligence system whose final output is a curated Telegram channel.

Read these files first:

- `Overview/Full-Detailed-Overview.md`
- `implementation/README.md`

Do not implement Telegram collection, AI clustering, publishing or cover generation yet. This phase is only the foundation that later phases depend on.

## Goal

Create a clean production-oriented repository foundation with explicit service boundaries, configuration contracts, Cloudflare project setup, initial D1 schema, shared types and local development instructions.

The architecture must support:

- a Python Telegram collector running separately on a Linux VPS;
- Cloudflare Workers for serverless processing;
- Cloudflare Queues for asynchronous work;
- D1 as the relational system of record;
- Vectorize for embeddings in a later phase;
- Workers AI in later phases;
- R2 in later phases;
- a Telegram Bot API publisher in later phases.

## Required Work

### 1. Repository structure

Create a structure that cleanly separates the VPS collector from Cloudflare code. Prefer a simple layout similar to:

```text
collector/
cloudflare/
  src/
    ingestion/
    processing/
    shared/
  migrations/
  tests/
docs/
.env.example
README.md
```

You may adjust names if the chosen tooling requires it, but preserve the separation of concerns.

### 2. Cloudflare Worker foundation

Set up the Cloudflare project using current supported Workers tooling.

Include bindings/config placeholders for:

- D1 database
- raw ingest Queue
- later Workers AI binding
- later Vectorize binding
- later R2 binding

Do not require real production IDs in committed configuration. Use documented placeholders and environment-specific setup where appropriate.

### 3. Initial D1 schema

Create migrations for the minimum relational model needed by the project.

Include at least:

#### `sources`

Fields sufficient for:

- source identity
- Telegram channel ID
- Telegram username
- source type
- language
- role
- priority tier
- trust/authority metadata
- active/inactive state
- optional website URL
- metadata JSON
- timestamps

#### `raw_posts`

Fields sufficient for:

- source relation
- Telegram channel ID
- Telegram message ID
- canonical URL
- update type
- published/edit timestamps
- language
- text/caption-normalized content
- media type/group metadata
- views/forwards
- forward origin metadata
- reply metadata
- raw metadata JSON
- deleted state
- timestamps

Add a unique constraint on:

```text
(telegram_channel_id, telegram_message_id)
```

#### future-facing event tables

Create the minimum schemas for:

- `events`
- `event_sources`
- `source_relationships`
- `event_updates`
- `published_stories`

Keep them practical. Do not build a normalized claim graph yet. Use JSON fields where V1 can remain simpler.

### 4. Shared contracts

Define validated shared payload contracts for the Telegram collector -> Cloudflare boundary.

At minimum support:

- `create`
- `edit`
- `delete`

A Telegram event envelope must contain enough information to produce idempotency and to update the correct D1 row.

Document the exact JSON schema.

### 5. Idempotency design

Implement or document a deterministic idempotency key based on:

```text
telegram_channel_id + telegram_message_id + update_type
```

Do not rely on Queue ordering.

### 6. Configuration

Create `.env.example`/equivalent placeholders for future secrets, including:

- Telegram API ID
- Telegram API hash
- Telegram phone/account configuration
- collector-to-Worker HMAC secret
- Telegram publishing bot token
- Telegram destination channel identifier

Never include real credentials.

### 7. Developer documentation

Update root `README.md` with:

- what Radar is;
- major components;
- local prerequisites;
- how to install dependencies;
- how to run migrations locally;
- how to run tests;
- what external resources will eventually be required;
- clear note that later phases are intentionally not implemented yet.

## Engineering Constraints

- Prefer TypeScript for Cloudflare Workers unless the existing repo establishes a better supported choice.
- Prefer explicit schema validation at external boundaries.
- Keep modules small enough to test without Cloudflare deployment.
- Avoid introducing an ORM unless it clearly improves D1 migrations and type safety without adding unnecessary complexity.
- Do not build a dashboard.
- Do not generate AI prompts yet.
- Do not add source scraping logic yet.

## Tests

Add tests for:

- payload validation;
- idempotency key generation;
- basic database repository/upsert behavior where locally testable;
- invalid update types/payloads.

## Acceptance Criteria

Phase 01 is complete when:

1. The repo has a clear collector/cloudflare separation.
2. Cloudflare development config can start locally with placeholder bindings.
3. D1 migrations create all required V1 tables.
4. `raw_posts` enforces uniqueness on Telegram channel/message identity.
5. Telegram ingest JSON contracts are documented and validated.
6. Idempotency logic is deterministic and tested.
7. No real secrets are committed.
8. Root documentation explains local setup and the architecture.
9. Tests/lint/type checks pass.
10. No Phase 02+ business logic has been prematurely implemented.

At the end, provide a concise implementation report listing files changed, commands run, tests passed, and any external setup still required.