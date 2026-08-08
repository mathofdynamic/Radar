# Radar — Full Technical Project Overview

## 1. Product Definition

Radar is a private AI-assisted news intelligence pipeline whose final interface is a Telegram channel.

The product does **not** attempt to republish every incoming post. Its purpose is to ingest a large volume of reporting, convert individual posts into real-world events, estimate how well each event is independently confirmed, score its importance, and publish only the small number of developments that are worth the user's attention.

The editorial objective is:

> Read everything. Understand the events. Verify the signal. Publish only what matters.

The initial editorial focus is Iran and Iran-relevant developments, including politics, war and security, sanctions, economy, internet/infrastructure, regional geopolitics, major world events, AI and important technology developments.

## 2. Core Product Requirements

Each published Telegram story must contain:

1. Cover image.
2. Title.
3. Short description, maximum 1000 characters.
4. Verification status.
5. Number of independent confirming source groups.
6. Primary sources.
7. Category and entity tags.
8. Inline buttons or links to the original reporting.

The channel should remain intentionally sparse. A normal day should typically produce roughly 5–15 high-value stories, a busy day roughly 15–25, with temporary exceptions during major crises.

## 3. Core Architectural Principle: Events, Not Posts

Raw source posts are evidence. They are not the primary editorial object.

Example:

- IRNA reports an explosion.
- Tasnim reports an explosion in the same city.
- Fars republishes a similar report.
- A Telegram radar channel posts footage.
- An aggregator copies the wording.

Radar should represent these as one `event`, not five news stories.

The system therefore maintains three distinct layers:

- **Raw reports** — exact source messages/articles.
- **Events** — clustered representations of real-world developments.
- **Published stories** — the final editorial output shown in Telegram.

## 4. Recommended V1 Architecture

```text
Telegram public channels
        |
        v
Telethon collector on Linux VPS
        |
        | signed HTTPS
        v
Cloudflare Ingestion Worker
        |
        v
Cloudflare Queue
        |
        v
Normalization / D1 persistence
        |
        v
Noise filtering
        |
        v
Workers AI embeddings
        |
        v
Cloudflare Vectorize
        |
        v
Deduplication + event clustering
        |
        v
Source-origin / independence analysis
        |
        v
Verification + importance scoring
        |
        v
Stage-2 AI Editor
        |
        v
Editorial selection
        |
        +--> FLUX cover generation --> R2
        |
        v
Telegram publishing bot
        |
        v
Radar Telegram channel
```

Websites, RSS feeds, APIs and official sources can enter the same normalized ingestion layer later without changing the event pipeline.

## 5. Telegram Collection Layer

### Technology

Use:

- Python 3.11+
- Telethon
- Dedicated Telegram user account
- Small Linux VPS
- Persistent Telethon session
- systemd or Docker restart policy

The Telegram collector is intentionally isolated from Cloudflare because it requires a long-lived MTProto connection and stateful Telegram session.

### Responsibilities

The collector must:

- Monitor configured public channels.
- Receive new messages with low latency.
- Capture edits.
- Capture deletions where Telegram exposes them.
- Capture albums/media groups.
- Preserve Telegram channel ID, username and message ID.
- Preserve canonical message URLs.
- Preserve timestamps.
- Capture text/captions.
- Capture views/forward counts when available.
- Capture `forwarded_from` and reply metadata.
- Perform bounded history backfill for newly added sources.
- Retry after temporary disconnects.
- Respect Telegram flood waits.
- Buffer events locally if Cloudflare is temporarily unreachable.

### Delivery Contract

The collector sends normalized Telegram update envelopes to a Cloudflare Worker using signed HTTPS requests.

Every envelope must include an idempotency key based on:

```text
telegram_channel_id + telegram_message_id + update_type
```

`update_type` should at minimum support:

- `create`
- `edit`
- `delete`

The Worker must reject invalid signatures and malformed payloads before queueing.

## 6. Cloudflare Platform Responsibilities

### Workers

Use separate Workers for distinct responsibilities rather than one oversized Worker.

Recommended logical services:

- `ingestion-worker`
- `raw-processing-worker`
- `event-processing-worker`
- `editorial-worker`
- `publisher-worker`
- optional scheduled maintenance/analytics Worker

These may begin as fewer deployable Workers if operational simplicity is more valuable, but module boundaries should remain clear.

### Queues

Queues provide durable asynchronous processing and isolate the Telegram collector from downstream failures.

Suggested queues:

- `raw-ingest`
- `event-analysis`
- `editorial-candidates`
- `publish`
- dead-letter queue(s)

Do not perform expensive AI work inside the initial HTTP ingestion request.

### D1

D1 is the system of record for normalized metadata, event state and publication history.

### Vectorize

Vectorize stores embeddings used for:

- cross-source similarity
- duplicate detection
- candidate event retrieval
- semantic event matching

### Workers AI

Workers AI handles:

- multilingual embeddings
- cheap relevance/importance classification
- borderline same-event classification
- source-origin classification when rules are insufficient
- final structured editorial reasoning
- summary generation
- category/tag generation
- cover prompt generation
- image generation

### R2

R2 stores generated covers and, if later needed, selectively archived source media.

Source media archiving is not required for early V1.

## 7. Proposed Data Model

V1 should remain relational and traceable.

### `sources`

Suggested fields:

- `id`
- `name`
- `source_type`
- `telegram_channel_id`
- `telegram_username`
- `website_url`
- `language`
- `category`
- `affiliation`
- `priority_tier`
- `role`
- `trust_score`
- `is_wire_origin`
- `is_active`
- `metadata_json`
- timestamps

`role` may include:

- `primary_source`
- `authority_confirmation`
- `breaking_radar`
- `specialist`
- `aggregator`

### `raw_posts`

Suggested fields:

- `id`
- `source_id`
- `telegram_channel_id`
- `telegram_message_id`
- `canonical_url`
- `update_type`
- `published_at`
- `edited_at`
- `language`
- `text`
- `media_type`
- `media_group_id`
- `views`
- `forwards`
- `forward_origin_json`
- `reply_to_message_id`
- `entities_json`
- `raw_metadata_json`
- `is_deleted`
- timestamps

Create a unique constraint on:

```text
(telegram_channel_id, telegram_message_id)
```

Use idempotent upserts for repeated delivery.

### `raw_post_duplicates`

Stores duplicate/near-duplicate relationships without discarding traceability.

### `events`

Suggested fields:

- `id`
- `canonical_title`
- `core_fact`
- `claims_json`
- `category`
- `verification_status`
- `importance_score`
- `confidence_score`
- `novelty_score`
- `iran_relevance_score`
- `first_seen_at`
- `last_updated_at`
- `event_state`
- `event_embedding_ref`
- `published_story_id`
- timestamps

### `event_sources`

Links raw reports to events and stores source interpretation:

- `event_id`
- `raw_post_id`
- `source_id`
- `origin_type`
- `origin_group`
- `supports_core_fact`
- `relationship_confidence`

`origin_type` may include:

- `original_reporting`
- `official_statement`
- `wire_republish`
- `aggregation`
- `translation`
- `forward_repost`

### `source_relationships`

Represents dependencies between sources:

- `from_source_id`
- `to_source_id`
- `relationship_type`
- `confidence`

Relationships may include:

- `republishes`
- `translates`
- `frequently_quotes`
- `forward_of`

### `entities` and `event_entities`

Normalized people, organizations, locations, markets, technologies and other important entities.

### `event_updates`

Stores material changes to an existing event.

### `published_stories`

Stores the final Telegram artifact:

- `event_id`
- `published_at`
- `telegram_message_id`
- `title`
- `short_description`
- `verification_status`
- `num_independent_confirmations`
- `primary_sources_json`
- `category`
- `entity_tags_json`
- `links_json`
- `cover_image_url`

## 8. Source Registry Strategy

Start with a manually curated source registry rather than trying to learn trust automatically.

Initial source groups should cover:

- official/state sources
- semi-official Iranian agencies
- opposition/international Persian media
- fast Telegram-native radar channels
- economy/market specialists
- later: technology/AI specialists

A source's trust is contextual. A government agency may be highly authoritative for the existence and wording of its own official statement while not being an independent verifier of the underlying claim.

Store both:

- **source trust/authority**
- **source role/origin relationship**

Do not collapse these concepts into a single reliability number.

## 9. Deduplication and Event Clustering

### Step 1 — Cheap noise removal

Before embeddings, remove obvious low-signal content where deterministic rules are sufficient:

- advertisements
- extremely short meaningless posts
- channel housekeeping
- obvious repost boilerplate
- irrelevant categories if configured

### Step 2 — Embeddings

Generate multilingual embeddings using a Workers AI model suitable for Persian/English/Arabic, initially `@cf/baai/bge-m3` or a validated replacement.

Embed a compact normalized representation, not uncontrolled full message history.

### Step 3 — Near-duplicate detection

Use a combination of:

- embedding similarity
- lexical overlap
- time proximity
- source metadata

Very high similarity within a short time window should create a duplicate relationship rather than a new event.

### Step 4 — Event assignment

For each non-duplicate post:

1. Query recent nearest neighbors from Vectorize.
2. Retrieve candidate events.
3. Compare semantic similarity.
4. Compare important entities.
5. Compare geography.
6. Compare timestamps.
7. Assign to the strongest candidate if above threshold.
8. Otherwise create a new event.

Use an LLM only when the decision is genuinely ambiguous.

Thresholds such as `0.78–0.85` are starting hypotheses, not permanent constants. They must be calibrated on actual Persian news traffic.

## 10. Independent Confirmation Logic

Raw channel count must never equal confirmation count.

Example:

```text
IRNA publishes report
  -> Channel A copies IRNA
  -> Channel B summarizes IRNA
  -> Channel C forwards Channel A
```

This should count as roughly one origin group.

By contrast:

```text
IRNA
Reuters
Local eyewitness source
```

may count as three distinct origin groups if all independently support the core fact.

V1 combines:

- explicit Telegram forwarding metadata
- phrases such as "according to Reuters" / "به نقل از ایرنا"
- high textual similarity shortly after another source
- manually known publisher/wire relationships
- lightweight AI classification for ambiguous cases

The final UI should report **independent confirmations**, not number of posts.

## 11. Verification Status

Use a controlled status vocabulary.

Recommended initial set:

### `CONFIRMED`

Core fact is supported by at least two credible independent origin groups, or another strong confirmation policy defined in code, with no major contradiction about whether the event occurred.

### `DEVELOPING`

Credible reporting exists but independent confirmation or important details are incomplete.

### `DISPUTED`

Credible sources materially disagree on the core fact or key interpretation.

### `UNVERIFIED`

Only weak or isolated evidence exists. These events normally stay out of the final channel.

Verification should be conservative. It is acceptable to miss a marginal story; it is not acceptable to confidently invent certainty.

## 12. Importance Model

V1 should use an explicit 0–100 score with separate dimensions.

Recommended starting dimensions:

- Impact: 25%
- Iran relevance: 25%
- Urgency: 15%
- Confidence: 15%
- Novelty: 10%
- Geopolitical/systemic significance: 10%

The system should score the dimensions individually first, then combine them. This makes later tuning understandable.

Initial bands may be:

- `0–59`: ignore/archive
- `60–77`: monitor
- `78–89`: routine editorial candidate
- `90–100`: breaking candidate

These bands are starting points only.

## 13. Editorial Scheduling

Ingestion, deduplication and event clustering should be continuous.

Editorial selection should run frequently enough to preserve breaking-news value.

Recommended V1:

- continuous ingestion
- immediate normalization and clustering
- immediate cheap importance pass
- editorial evaluation every ~5 minutes
- immediate Stage-2 evaluation for exceptional high-confidence/high-importance events

Do not wait hours for batch editorial processing.

Apply both:

- minimum score thresholds
- a dynamic editorial budget

This prevents a busy news cycle from turning the final channel into another noisy feed.

## 14. Stage-2 AI Editor

Only promising or ambiguous events should reach the more capable model.

The editor receives structured evidence, not arbitrary raw database dumps.

Expected structured output:

```json
{
  "publish": true,
  "title": "...",
  "description": "...",
  "verification_status": "CONFIRMED",
  "independent_confirmations": 3,
  "category": "WAR_SECURITY",
  "tags": ["ایران", "..."],
  "primary_source_ids": [1, 2, 8],
  "cover_concept": "...",
  "editorial_reason": "..."
}
```

Use schema validation. Invalid output must be retried or rejected, never silently parsed with assumptions.

The generated story must:

- separate fact from allegation
- preserve important numbers and dates
- state uncertainty clearly
- avoid sensationalism
- avoid adding unsupported background
- stay under the configured description limit

## 15. Categories and Tags

Use controlled categories and dynamic entity tags.

Initial categories:

- `IRAN`
- `WORLD`
- `POLITICS`
- `ECONOMY`
- `WAR_SECURITY`
- `TECHNOLOGY`
- `SCIENCE`
- `SOCIETY`
- `CULTURE`
- `SPORTS`

Entity tags are generated from normalized entities, for example:

- ایران
- تهران
- دلار
- اسرائیل
- OpenAI

Do not allow the model to invent endless category names.

## 16. Cover Generation

Generate covers only after the story is approved for publication.

Use Cloudflare Workers AI image generation, initially FLUX.2 Klein 4B if it meets quality and cost requirements.

Covers should have a fixed Radar visual language and should be editorial illustrations rather than fake documentary photography.

Never generate a photorealistic depiction that could be mistaken for evidence of the actual event.

The image prompt should be derived from structured fields such as:

- category
- entities
- location
- event type
- desired symbolic visual

Store final covers in R2 and publish their stable URL/reference.

## 17. Telegram Publisher

A standard Telegram Bot API bot publishes to the final Radar channel.

Each message should contain:

- generated cover
- bold/clear title
- concise Persian description
- verification status
- independent confirmation count
- source names
- category/entity tags
- inline keyboard linking to original reports

Prefer separate source buttons rather than a vague single "Read More" link when Telegram layout allows it.

Store the resulting Telegram message ID in `published_stories` so later updates can edit the existing post.

## 18. Event Update Handling

When new evidence is attached to an already published event, classify the change as:

- `NO_CHANGE`
- `MINOR_UPDATE`
- `MAJOR_UPDATE`
- `CORRECTION`
- `CONTRADICTION`

Expected behavior:

- `NO_CHANGE`: do nothing.
- `MINOR_UPDATE`: update internal state only in most cases.
- `MAJOR_UPDATE`: edit the existing Telegram story or publish a clearly marked update depending on age and significance.
- `CORRECTION`: visibly correct the existing story and preserve internal correction history.
- `CONTRADICTION`: update verification status and explicitly surface the contradiction when material.

Avoid publishing a new post for every small detail.

## 19. Reliability and Failure Handling

### Telegram collector

- persistent session file
- automatic reconnect
- explicit flood-wait handling
- startup reconciliation/backfill after long downtime
- structured logs
- health endpoint
- stable VPS/IP where practical

### Cloudflare ingestion

- HMAC-signed payloads
- strict schema validation
- request size limits
- rapid queue acknowledgement

### Queue processing

- at-least-once semantics
- idempotent D1 upserts
- bounded retries
- dead-letter handling

### Cloudflare outage

Collector should maintain a small disk-backed local buffer, such as SQLite, and resend when Cloudflare becomes reachable.

### Secrets

Never commit:

- Telegram `api_id`
- Telegram `api_hash`
- Telegram session files
- Telegram bot token
- HMAC secrets
- Cloudflare API credentials

Use environment variables, Worker secrets and appropriate local secret management.

## 20. V1 Scope

V1 should prove the complete vertical slice with approximately 20–30 carefully selected Telegram sources.

Required V1 capabilities:

- live Telegram ingestion
- bounded backfill
- edits
- source registry
- D1 storage
- idempotency
- embeddings
- duplicate detection
- event clustering
- manual source dependency metadata
- independent confirmation estimate
- verification status
- importance score
- 5-minute editorial cycle
- structured AI summary
- Telegram publication
- source buttons
- generated editorial cover
- material event update handling
- basic operational monitoring

## 21. Explicit Non-Goals for Early V1

Do not overbuild these before the core signal quality is proven:

- full claim-level relational knowledge graph
- automatic learned source trust scores
- hundreds of sources on day one
- large analyst dashboard
- full source-media archival
- complex microservice infrastructure
- custom ML training pipeline
- perfect delete tracking
- autonomous source discovery

## 22. Recommended Implementation Order

1. Repository foundation, configuration contracts and schemas.
2. Telegram collector + Cloudflare ingestion + D1 persistence.
3. Source registry, normalization, edits and bounded backfill.
4. Embeddings, deduplication and event clustering.
5. Source independence and verification logic.
6. Importance scoring and editorial engine.
7. Story generation, covers and Telegram publisher.
8. Update handling, observability, hardening and production launch.

The `implementation/` folder contains one coding-agent prompt for each phase. Each phase should be completed and validated before proceeding to the next.