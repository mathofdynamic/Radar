# AI Architecture for Event Detection, Verification, and Importance Ranking on Cloudflare Workers AI (August 2026)

## Executive summary

This document designs a V1 architecture for an AI-powered news intelligence pipeline optimized for Cloudflare Workers AI, Cloudflare D1, and Vectorize as of August 2026. The system ingests raw reports from Telegram, news sites, RSS, APIs, and official sources, clusters them into real-world events, verifies claims across independent sources, scores importance, and publishes a very small number of concise, verified Telegram posts.[^1][^2][^3][^4]

The design emphasizes: (1) low-cost, streaming operation using Workers + Queues, (2) a hybrid of deterministic logic and lightweight LLM calls, (3) explicit modeling of source relationships to avoid wire-service echo chambers, and (4) a two-stage editorial AI (cheap classifier + heavier editor model) to keep inference costs low while preserving high signal-to-noise quality.[^5][^2][^4]

***

## High-level system goals and constraints

The core editorial goal is: "Read everything. Understand what events are happening. Determine which events genuinely matter. Verify them across independent sources. Publish only what a person needs to know." The target channel should feel like an expert human editor who reads hundreds of items and surfaces 5–25 stories per day, with clear verification status and minimal noise.

Key constraints and requirements:

- Initial scale: 30–50 sources, growing to 100–200, ultimately handling thousands of raw posts per day.
- Primary focus: Iran, war, security, sanctions, major political/economic shocks, important global tech/AI developments.
- Infrastructure: Cloudflare Workers, D1, Queues, Vectorize, Workers AI models catalog as of mid-2026.[^2][^3][^1]
- Cost-sensitive: rely on embeddings, classification, and small/medium LLMs hosted on Workers AI where possible.[^4][^5]
- Very high bar for publication; minimize false positives and sensationalism even at the cost of missing some marginal stories.

***

## Cloudflare Workers AI model landscape (August 2026)

Cloudflare Workers AI provides a catalog of open and partner models for text generation, embeddings, classification, reranking, summarization, and image generation, exposed via an OpenAI-compatible API and tightly integrated with Vectorize. Relevant families as of 2026 include:[^3][^6][^1][^2]

- **Embeddings**: BAAI BGE (base, large, multilingual bge-m3), Google EmbeddingGemma-300M, Qwen3-embedding-0.6B, and PLaMo-Embedding-1B (Japanese).[^7][^8][^9][^1][^2]
- **LLMs (text generation)**: Meta Llama 3.x (1B–70B), GLM-4.7-Flash, GLM-5.2, Qwen3-30B, Gemma 4 26B, and others suitable for summarization and reasoning.[^10][^7][^2][^3][^4]
- **Text classification / reranker**: small DistilBERT-based classifiers, sentiment models, and BAAI rerankers (bge-reranker-base).[^8][^9][^5][^2]
- **Summarization**: bart-large-cnn (beta / legacy but available), while general LLMs can also perform summarization.
- **Vision / image generation**: Stable Diffusion / SDXL-style models and newer image generators, plus text-to-speech and other modalities.[^6][^3]

Workers AI typically supports around 3,000 requests/minute for embeddings, 2,000 for text classification, 1,500 for summarization, and about 300 for text generation per account by default, which is ample for a news-intelligence pipeline at the scale of thousands of daily items. Pricing is neuron-based; as a rough reference, a mid-sized 8B Llama model is around 0.045 USD per million input tokens and 0.384 USD per million output tokens, making it attractive for routing moderate volumes of text classification and summarization through Workers AI instead of external providers.[^11][^2][^4]

### Recommended model choices for V1

Given the multilingual nature of Iran-related news (Persian, Arabic, English, sometimes others), and the focus on low cost and high throughput:

- **Embeddings & similarity**: `@cf/baai/bge-m3` for multilingual embeddings (supports 100+ languages and long texts), or `@cf/google/embeddinggemma-300m` if you want smaller, cheaper embeddings with good multilingual performance.[^9][^7][^2][^8]
- **Reranking / fine similarity**: `@cf/baai/bge-reranker-base` to refine similarity in borderline cases for event clustering or claim matching when necessary.[^9]
- **Stage 1 classifiers (cheap)**: `@cf/meta/llama-3.2-1b-instruct` or comparable 1–3B models for light classification, or a dedicated DistilBERT sentiment/classification model fine-tuned for topic/importance if you build one.[^5][^2][^4]
- **Stage 2 editor / reasoning**: `@cf/meta/llama-3.1-8b-instruct-fp8-fast` or `@cf/zai-org/glm-4.7-flash` for reasoning, structured JSON extraction, and editorial judgments on a subset of events.[^7][^10][^4]
- **Summarization**: For stability, use the 8B LLM with a summarization prompt rather than relying on bart-large-cnn (which is labeled beta/deprecated), unless your tests show bart is significantly cheaper and adequate.[^2][^5]
- **Image generation**: Use Cloudflare-hosted SDXL/imaging (or FLUX-style models exposed through Workers AI if available) for abstract, symbolic covers; exact model choice can be swapped without changing architecture.[^3][^6]

***

## Ingestion and normalization layer

### Sources and ingest mechanisms

Initial sources include:

- Telegram channels (via a separate Telegram bot/bridge pushing messages into a Webhook or queue).
- News websites (crawler + RSS feeds, scheduled Workers hitting HTML pages or RSS and extracting articles).
- APIs and official feeds (e.g., government press releases, central bank, ministries, embassies, news agencies like IRNA, Fars, Tasnim, Reuters, AP).

Each ingest pipeline should normalize metadata into a `raw_posts` table in D1 with fields such as `id`, `source_id`, `url_or_message_id`, `published_at`, `language`, `raw_text`, `raw_html`, and `raw_metadata_json`. Normalization includes simple cleaning (strip HTML tags, merge multi-part Telegram posts, remove boilerplate) using standard code, not AI.

### Language detection and basic metadata

A lightweight deterministic library (or small classification model if necessary) should assign `language` (fa, ar, en, etc.), and attempt to extract `headline` vs `body` where possible from HTML/RSS. Time normalization converts feed timestamps into a canonical UTC timestamp and infers approximate local time when only local time is given.[^6]

AI is not required in this stage beyond optional language detection; this minimizes cost since every item passes through ingestion.

***

## Vectorization, deduplication, and event clustering

### Embedding strategy

For each normalized `raw_post`, the system computes an embedding using `bge-m3` or EmbeddingGemma over a compact representation, for example: `title + first N characters of body (e.g., 512–1024 tokens)`. These embeddings are stored in a Vectorize index with metadata (source, language, timestamp, geo, URL/message_id, etc.), and a pointer back to the `raw_posts.id`.[^8][^7][^2][^9][^6]

To control cost, embeddings can be computed for:

- All posts except obviously low-signal ones filtered by static rules (e.g., posts below 15 characters, obvious ads, pure memes detected by regex/heuristics or a small classifier).
- Or in two tiers, where very low-likelihood posts (e.g., celebrity gossip, sports) are filtered out using a cheap classifier before embedding.

### Deduplication within short windows

A first de-duplication layer runs per-source and cross-source within a short time window (e.g., ±1–2 hours). The system queries Vectorize for nearest neighbors with high cosine similarity, requiring both high embedding similarity and high lexical overlap (Jaccard over keywords, or simple min-hash) to mark posts as near-duplicates.[^12][^2]

This removes:

- Identical re-posts from the same Telegram channel.
- Slightly modified reprints (e.g., title changed, text mostly same).

Only one representative `raw_post_id` is kept for downstream event clustering, but all duplicates are linked in a `raw_post_duplicates` table for traceability.

### Event clustering approach

Research on news stream clustering suggests effective combinations of dense embeddings with temporal and sometimes geographic constraints. A practical V1 approach on Workers AI is an online, non-parametric clustering algorithm that:[^13][^14][^12]

- Uses dense embeddings from `bge-m3` or EmbeddingGemma.[^15][^12][^7][^2][^8]
- Applies temporal windows so that only posts within a configurable window (e.g., ±24–48 hours) are candidates for the same event.[^14][^13]
- Uses optional geographic filters based on extracted locations (cities, countries) from deterministic NER/regex/lookup, and/or LLM-assisted extraction when needed.

Algorithm sketch (streaming event clustering):

1. For each new post embedding, query Vectorize for the top K neighbors within the temporal window.
2. Filter neighbors by:
   - Cosine similarity ≥ `sim_threshold` (e.g., 0.78–0.85, tuned by experiments).
   - Overlapping key entities (location, organization, person) when available.
3. If one or more candidate events exist:
   - Score each candidate event by a weighted combination of embedding similarity, keyword overlap, shared entities, and temporal proximity.
   - Assign the post to the highest-scoring event if score ≥ `cluster_threshold`.
4. If no candidate event passes threshold, create a new event with this post as its seed (`events` table row) and set the event "center" embedding as the post embedding.
5. Update the event prototype (e.g., average embedding over members, summary of time span, entity union) and store the mapping in `event_sources` and `event_updates`.

This style is similar to entity-aware contextual embedding approaches for event-driven news clustering, which combine dense and sparse signals. A more sophisticated HDBSCAN-based approach (as in Temporal-Guided News Stream Clustering) can be prototyped offline to tune thresholds, then approximated with the above streaming method.[^13][^14][^15][^12]

### LLM classification as a backstop

Borderline items—posts with ambiguous similarity or conflicting geography—can be routed to Stage-2 LLM classification:

- Input: candidate event summary, new post text, extracted entities, timestamps.
- Task: binary classification: "same real-world event" vs "different event" plus a short justification.

This call uses the 8B class LLM, but only for a small fraction of posts near decision boundaries, keeping cost controlled.[^4]

***

## Entity extraction and enrichment

Entity extraction is used for clustering, importance scoring, and tags.

- **Primary method**: deterministic libraries and gazetteers for locations (e.g., list of Iranian cities, key facilities like Bandar Abbas Port, Natanz, etc.), plus regex for currencies, numbers, and dates.
- **LLM-assisted NER**: Stage-2 model can generate structured JSON with entities when needed, using JSON schema support in Workers AI.[^5][^2]

Recommended entity types:

- `LOCATION` (country, city, region, facility, online service).
- `ORG` (government bodies, militaries, companies, NGOs, militant groups).
- `PERSON` (political leaders, commanders, public figures).
- `INSTRUMENT` (missile, drone, cyberattack, etc.).
- `MARKET` (USD/IRR, Bitcoin, stock index, oil price).
- `TECH` (models like OpenAI GPT, OpenAI, Open-source projects, etc.).

Entities and their normalized forms go into an `entities` table, with a join table `event_entities` linking them to events.

***

## Source modeling and relationship analysis

### Source metadata

The `sources` table tracks for each source:

- Type: telegram_channel, news_agency, wire_service, government, international_org, aggregator, bot, etc.
- Country / affiliation: e.g., Iran state media, Western international, opposition outlet.
- Typical language(s).
- Whether it is likely to publish original reporting vs reprints (e.g., Reuters, AP are wire services; many outlets copy them).[^13]
- Trust / authority score (human-curated in V1; later could be learned).

### Source relationship model

To detect dependence among sources:

- Mark known wire services (Reuters, AP, AFP, IRNA, Tasnim, Fars, etc.) as `wire_origin=true`.
- For each `raw_post`, estimate its **origin type**:
  - `original_reporting` (direct eyewitness, unique context, not attributable to another public report).
  - `wire_republish` (explicitly cites a wire like Reuters/IRNA/AP as source).
  - `official_statement` (direct from government official channel or speech transcript).
  - `aggregation/summary` (summarizes other media without new claims).
  - `translation` (non-original but from another language, may or may not add context).
  - `forward/repost` (Telegram forwards without added content).

These labels can be inferred using a mix of rules (e.g., "via Reuters" patterns, Telegram `forwarded_from` metadata) and a classifier.

Create a `source_relationships` table with edges:

- `from_source_id`, `to_source_id`, `relationship_type`, e.g. `republishes`, `translates`, `frequently_quotes`, `forward_of`.
- This can be built incrementally by detecting repeated co-occurrence where posts from one source appear shortly after another with high textual similarity.

### Independent confirmation counting

For each event, compute **independent confirmations** by grouping sources by their dependency structure:

1. Group all posts in an event by their `origin_group`:
   - Each wire service is its own group (Reuters, AP, IRNA, Tasnim, Fars, etc.).
   - Each government or official organ is a group (Iran MoD, IRGC, White House, etc.).
   - Outlets that mostly republish a single wire are assigned to that wire group.
   - Known independent outlets (e.g., local channels, citizen journalists with track records) form separate groups.
2. For each **claim** or for the core event fact, count the number of distinct origin groups that assert it, excluding pure forwards/aggregation without new confirmation.

Thus, "12 Telegram channels, all quoting IRNA" becomes **1 independent source**, whereas "IRNA + local eyewitness + international news agency" becomes **3 independent sources**.

This logic will be encoded in code using the `source_relationships` table and origin labels, with optional LLM assistance when patterns are unclear.

***

## Claim modeling: per-event vs per-claim

### Event and claim structures

For each event, define:

- **Event-level core**: what undoubtedly happened (e.g., "Explosion reported in Bandar Abbas" with minimal assertions).
- **Claims**: atomic statements that may or may not be confirmed, such as:
  - Explosion occurred.
  - Location was facility Y.
  - Three people injured.
  - Cause was equipment failure.

In a full system, claim-level verification allows precise tracking of what is confirmed vs disputed. Multi-source events often show partial agreement—e.g., all agree an explosion occurred, but casualty numbers vary.

### V1 recommendation on claims

Given the complexity and cost, a pragmatic V1 approach is:

- Implement **event-level claim sets** but not fully normalized per-claim tables.
- The Stage-2 LLM produces a JSON structure per event with:
  - `core_fact` (minimal statement).
  - `supporting_details` (list of optional claims with confidence levels and which sources mention them).
  - `disputed_points` (claims with conflicting reports).

These are stored as JSON in `events.claims_json` and used for summary generation and verification status. A later V2 can normalize individual claims into a `claims` table with `claim_sources` join table if fine-grained analytics are desired.

This keeps V1 manageable while still enabling: "Explosion confirmed; cause unclear; casualty numbers disputed".

***

## Verification workflow and status logic

### Evidence scoring per event

For each event, derive these verification features:

- `num_total_sources`: count of distinct sources in event.
- `num_origin_groups`: independent confirmation count (distinct origin groups as above).
- `has_official_statement`: boolean if any government/official channel confirms.
- `has_independent_reporting`: boolean if any non-government, non-wire outlet reports from the ground (approximate using origin classification + entity patterns such as "our correspondent").
- `has_conflict`: boolean if key facts contradict (e.g., casualty numbers differ by >X%, one source denies another).
- `time_since_first_report`: recency.

Use a small classifier or rule-based logic to assign verification status.

### Verification status categories

Recommended controlled set:

- **CONFIRMED**: At least 2 independent origin groups confirm the core fact, or 1 credible official plus 1 independent outlet, and no strong contradiction on whether the event occurred.
- **DEVELOPING**: At least 1 credible source reports, but independent confirmation < 2; or details (scale, casualties, cause) remain unclear or shifting.
- **DISPUTED**: Credible sources issue conflicting statements about whether the core fact occurred or its nature (e.g., "explosion" vs "training exercise"), or major casualty/cause discrepancies.
- **UNVERIFIED**: Only a single low-trust or unknown source; no corroboration yet; often should not be published to the main channel.

V1 logic can be rules-based with thresholds on `num_origin_groups`, source trust scores, conflict detection, and time; Stage-2 LLM can double-check and explain status for borderline cases.

***

## Importance ranking model

### Dimensions

Importance is a score in 0–100 driven by several dimensions:

- **Impact**: scale of effect (casualties, geographic spread, magnitude of economic or political shift).
- **Urgency**: how quickly the information affects decisions (e.g., airstrikes ongoing vs policy discussion next year).
- **Relevance to Iran and core focus**: direct impact on Iran, war/security, sanctions, currency, internet, AI, and major tech developments.
- **Confidence**: combination of verification status and source quality.
- **Novelty**: how new the information is vs existing event coverage.
- **Magnitude**: number of people affected, monetary values, severity of sanctions, etc.
- **Persistence/duration**: whether it is a transient incident vs a structural shift (e.g., long-term sanctions, regime change).
- **Geopolitical significance**: cross-border implications, involvement of major powers.

### Scoring function

A simple weighted linear model can work well in V1, with weights tuned manually:

- `impact_weight`: 0.25
- `urgency_weight`: 0.15
- `relevance_weight`: 0.25 (emphasize Iran-related aspects).
- `confidence_weight`: 0.15
- `novelty_weight`: 0.10
- `geo_weight`: 0.10

Each dimension gets a subscore in 0–1, derived from deterministic rules and optionally a classifier:

- Impact: derived from casualty numbers, economic metrics (e.g., FX move > 5%), size of protests, infrastructure significance.
- Urgency: based on whether event is ongoing, time since occurrence, presence of language like "now", "ongoing", "emergency".
- Relevance: high if event occurs in Iran or directly affects Iran (sanctions, nuclear talks, cross-border strikes); medium if regional; low otherwise.
- Confidence: mapped from verification status (UNVERIFIED 0.1, DEVELOPING 0.5, DISPUTED 0.4, CONFIRMED 1.0) with additional adjustments for trusted sources.
- Novelty: 1.0 if initial event, decreasing as more updates with similar content appear.
- Geopolitical: high if states or major organizations take direct actions (military, sanctions, treaties).

Final importance score: `score = 100 * (sum(weight_i * subscore_i))`.

### Thresholds and critique of four-tier model

Proposed bands:

- **0–59**: ignore (or just log as background / for internal dashboard).
- **60–77**: monitor.
- **78–89**: publish during routine editorial cycles.
- **90–100**: breaking-news candidate.

Critique and adjustments:

- The original thresholds risk either under-publishing on slow days or over-publishing if many events cluster around 75–80.
- To keep output in the 5–25 stories/day range, thresholds should adapt based on daily distribution and editorial budget (see below).
- In V1, keep static bands but apply an **editorial budget** overlay: for each day, only events above a dynamic cutoff around the Nth-ranked score are published.

***

## Editorial budget and notification scarcity

### Objectives

The Telegram channel should be readable in a few minutes per day:

- Normal day: 5–15 stories.
- Busy day: 15–25 stories.
- Exceptional crisis: higher volume is acceptable but still curated.

### Strategies

Combine fixed thresholds with dynamic ranking:

1. Compute importance scores for all events each day.
2. Define `min_publish_score` (e.g., 75) below which nothing is published.
3. Within events with `score >= min_publish_score`, sort by score descending.
4. Apply daily caps:
   - Normal mode: top 15 events.
   - Surge mode: top 25 events.

A simple regime switch can be based on the number of events above 85:

- If > 20 events with `score >= 85`, treat as "busy/exceptional" and allow up to 25.
- Otherwise cap at 15.

Additionally, apply **category balancing**:

- Enforce at least a few key categories: e.g., min 2 Iran/War & Security items when available, so one big tech story does not crowd out everything.

Stage-2 LLM can help when there is tie-breaking: "From these 5 borderline events, choose 2 that matter most to an Iran-focused analyst".

***

## Event updates and change classification

### Update types

For each new post mapped to an existing event, classify update type:

- **NO_CHANGE**: content is essentially identical to existing information; no new facts.
- **MINOR_UPDATE**: small additional detail, quote, or minor number change that does not materially alter understanding.
- **MAJOR_UPDATE**: significant new information: casualty numbers jump, cause identified, official admission/denial, escalation (e.g., second strike).
- **CORRECTION**: source corrects previous information (e.g., "previously said 10 casualties; actually 3").
- **CONTRADICTION**: new credible source disputes the core fact or presents fundamentally different narrative.

### Update classification mechanism

Use a combination of heuristics and LLM classification:

- Compute difference between new post and existing event summary using embeddings + lexical diff; if similarity is very high and no new entities/numbers appear, label as NO_CHANGE.
- If new numbers, new actors, or new official statements appear but core narrative unchanged, treat as MINOR_UPDATE.
- If verification status changes (e.g., new independent confirmation moves UNVERIFIED to CONFIRMED, or major escalation), label as MAJOR_UPDATE.
- If post explicitly retracts or corrects previous info from same source, label as CORRECTION.
- If post asserts opposite of prior claims (e.g., "no explosion occurred"), label as CONTRADICTION.

When ambiguous, send to Stage-2 LLM: "Given previous event summary and this new report, classify update type among [NO_CHANGE, MINOR_UPDATE, MAJOR_UPDATE, CORRECTION, CONTRADICTION] and explain briefly." This classification and explanation are stored in `event_updates.update_type` and `update_note`.

### Telegram update behavior

Map update types to actions:

- NO_CHANGE: do nothing (no Telegram action).
- MINOR_UPDATE: if the event already has a published story, consider **editing the existing message** (if within Telegram edit window) to incorporate key numbers and append "Updated at HH:MM"; otherwise, append a short "Update" paragraph at the bottom.
- MAJOR_UPDATE: if it materially changes importance or understanding (e.g., verification status changes, casualties drastically higher, major political reaction), create a **new UPDATE post** referencing the original event (e.g., "Update to EVENT #123: ..."). Also edit the original message summary to reflect new knowledge when possible.
- CORRECTION: edit original message with clear correction; publish a separate **CORRECTION post** if the original was significant (importance ≥ 85), clearly stating what changed and why.
- CONTRADICTION: publish new post only if the contradicting source is credible and the disagreement is itself important; label verification status as DISPUTED and explain briefly.

This keeps the channel from spamming minor detail updates while ensuring major shifts are visible.

***

## Summary generation and story schema

### Story fields

Each published story should contain at least:

- `title`
- `short_description` (≤ 1000 characters)
- `verification_status` (CONFIRMED, DEVELOPING, DISPUTED, UNVERIFIED)
- `num_independent_confirmations`
- `primary_sources` (short list of key sources used)
- `category` (from controlled taxonomy)
- `entity_tags` (key entities like "Iran", "Tehran", "Israel", "Trump", "OpenAI")
- `links` (URLs or deep links to Telegram posts/official statements)

### Summary generation process

The Stage-2 LLM generates the story using a structured prompt and requiring JSON output in a fixed schema, leveraging Workers AI JSON mode where available. The prompt includes:[^2][^5]

- Event core fact and claims JSON.
- Verification evidence and status.
- Importance dimension scores and editorial notes.
- A requirement to:
  - Separate confirmed facts from unconfirmed allegations.
  - Explicitly mark uncertain or disputed aspects.
  - Avoid sensational language and speculation.
  - Prioritize why the event matters for Iran, security, economy, or global tech.
  - Preserve key numbers, dates, and named entities without hallucinating.

The output JSON is validated against a JSON Schema in code. If invalid, the system can re-prompt the model or fall back to a simpler deterministic template for the title and description.

Example JSON schema (conceptual):

```json
{
  "title": "string",
  "short_description": "string",
  "verification_status": "CONFIRMED | DEVELOPING | DISPUTED | UNVERIFIED",
  "num_independent_confirmations": "integer",
  "primary_sources": ["string"],
  "category": "string",
  "entity_tags": ["string"],
  "links": ["string"]
}
```

***

## Verification status logic in more detail

Mapping evidence to status:

- **CONFIRMED**:
  - `num_origin_groups >= 2` with at least one being either a reputable international outlet or an official source with strong track record; or
  - 1 official statement + 1 independent outlet, no credible denial; and
  - No major contradictions about whether event occurred.
- **DEVELOPING**:
  - `num_origin_groups >= 1` with medium/high trust; and
  - Either details are still emerging (large variance in reported casualties/causes) or independent confirmation not yet sufficient.
- **DISPUTED**:
  - Two or more credible origin groups provide conflicting accounts about core fact (e.g., "attack" vs "accident", "no casualties" vs "many casualties") or about whether any event occurred at all.
- **UNVERIFIED**:
  - Only low-trust or unknown sources; or
  - Single official statement unsupported by other credible reporting when the claim is extraordinary.

The system can maintain a small config of source trust levels and adjust statuses accordingly. Stage-2 LLM can re-evaluate if the rules produce borderline outcomes (e.g., conflicting but low-trust sources).

***

## Category taxonomy and tags

### Categories (controlled list)

Initial V1 categories aligned with user priorities:

- Iran
- World
- Politics
- Economy
- War & Security
- Technology
- Science
- Society
- Culture
- Sports

Rules:

- Each event has **one primary category** for high-level grouping.
- Optionally, a secondary category can be stored if an event sits at a boundary (e.g., Tech × Economy).

Category assignment is done by a small classifier or by Stage-2 LLM during summary generation, backed by deterministic overrides (e.g., any event located in Iran defaults to Iran unless clearly global tech-only).

### Entity tags

Entity tags are dynamic and used for search and filtering, not as a controlled taxonomy:

- Use normalized entity names ("Iran", "Tehran", "Israel", "Trump", "OpenAI", "Dollar", "IRGC").
- Limit to 5–10 tags per event to avoid clutter.

Tags come from the entities extracted earlier; the summary LLM may reorder or prune them but should not invent new entities.

***

## AI-generated covers and image workflow

### Editorial principles

The system must not generate synthetic images that look like documentary evidence of real-world events, to avoid misleading users and violating basic journalistic ethics. Particularly for explosions, protests, or violence, avoid photorealistic images that could be mistaken for actual photos.[^3][^6]

Instead, covers should be:

- Abstract or symbolic illustrations (e.g., map segments, icons for missiles or sanctions, stylized silhouettes).
- Category-themed compositions (e.g., "War & Security" uses a color palette and icon set distinct from "Economy" or "Technology").
- Map-centric graphics showing relevant countries or regions without fabricated on-the-ground imagery.

### Prompt generation strategy

The cover generator uses a deterministic template-based prompt builder based on:

- Category.
- Key entities (countries, cities, organizations).
- High-level narrative (e.g., "missile strike", "sanctions", "internet outage").

Example for an explosion in Bandar Abbas:

> "Minimalist editorial illustration, flat design, dark blue and orange palette, map of southern Iran with Bandar Abbas labeled, abstract explosion icon over port area, clean typography for the word 'Iran', no photorealism, no real people, suitable as news cover art."

For sanctions on Iran’s oil exports:

> "Abstract illustration of oil barrels and shipping routes around the Persian Gulf on a map, muted colors, modern infographic style, no logos or real photos, suitable for news article cover about economic sanctions."

Image generation uses Cloudflare Workers AI image models (e.g., SDXL-like or FLUX-style) and is executed only for events selected for publication, not for every raw post. The system stores `cover_image_url` in `published_stories` with versioning if images are regenerated.[^6][^3]

***

## Database model (D1 schema)

A reasonably simple relational schema in D1 can support V1:

### `sources`

- `id` (PK)
- `name`
- `type` (telegram_channel, news_agency, wire_service, government, etc.)
- `country`
- `language`
- `wire_origin` (boolean)
- `trust_score` (float 0–1)
- `metadata_json`

### `raw_posts`

- `id` (PK)
- `source_id` (FK → sources)
- `external_id` (Telegram message_id, URL, etc.)
- `published_at` (timestamp)
- `ingested_at` (timestamp)
- `language`
- `title`
- `text`
- `raw_metadata_json`

### `raw_post_duplicates`

- `id` (PK)
- `canonical_post_id` (FK → raw_posts)
- `duplicate_post_id` (FK → raw_posts)
- `similarity_score` (float)

### `events`

- `id` (PK)
- `created_at` (timestamp)
- `first_seen_at` (timestamp)
- `last_updated_at` (timestamp)
- `core_fact_text`
- `claims_json` (JSON, event-level claims/uncertainties)
- `verification_status` (enum)
- `num_independent_confirmations`
- `importance_score` (float)
- `category`
- `status` (active, closed, resolved)

### `event_sources`

- `id` (PK)
- `event_id` (FK → events)
- `raw_post_id` (FK → raw_posts)
- `source_id` (FK → sources)
- `origin_type` (original_reporting, wire_republish, official_statement, aggregation, translation, forward)

### `event_updates`

- `id` (PK)
- `event_id` (FK → events)
- `raw_post_id` (FK → raw_posts)
- `update_type` (NO_CHANGE, MINOR_UPDATE, MAJOR_UPDATE, CORRECTION, CONTRADICTION)
- `update_note`
- `created_at`

### `entities`

- `id` (PK)
- `name_normalized`
- `type` (LOCATION, ORG, PERSON, MARKET, TECH, etc.)
- `metadata_json`

### `event_entities`

- `id` (PK)
- `event_id` (FK → events)
- `entity_id` (FK → entities)

### `source_relationships`

- `id` (PK)
- `from_source_id` (FK → sources)
- `to_source_id` (FK → sources)
- `relationship_type` (republishes, translates, frequently_quotes, forward_of)
- `confidence` (float)

### `published_stories`

- `id` (PK)
- `event_id` (FK → events)
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

This schema can be extended later with a dedicated `claims` table if needed.

***

## End-to-end V1 pipeline

### 1. Ingestion → normalization (code)

- Workers scheduled or triggered by webhooks gather raw posts from Telegram, RSS, APIs, and web crawlers.
- Normalize into `raw_posts` with language, title/body, timestamps.
- Push `raw_post_id` into a Cloudflare Queue for further processing.

### 2. Vectorization & deduplication (AI + code)

Worker consuming the queue:

- Filters obvious noise by rules or cheap classifier (Stage 1) for domain relevance (Iran, war, tech, etc.).
- Calls Workers AI embedding model (bge-m3 or EmbeddingGemma) to create embeddings for remaining posts and upserts them into Vectorize.[^7][^8][^9][^2][^6]
- Uses Vectorize nearest-neighbor search + lexical checks to detect duplicates, populating `raw_post_duplicates`.

### 3. Event assignment / clustering (AI + code)

- For non-duplicate posts, query Vectorize for neighbors in a temporal window.
- If neighbors exist:
  - Evaluate candidate events via similarity + entity/geographic filters.
  - Possibly call Stage-2 LLM for borderline "same event or new?" classification.
- Create or update `events` and `event_sources` accordingly.
- Update `events.first_seen_at`, `last_updated_at`, and maintain an event-level embedding (e.g., centroid).

### 4. Entity extraction (code + optional AI)

- Apply deterministic NER (e.g., rule-based or classical models) to extract key entities and locations.
- Optionally call Stage-2 LLM for structured entity extraction on important events.
- Populate `entities` and `event_entities`.

### 5. Source relationship + origin classification (code + AI)

- Use known lists of wire services and official channels to set base labels.
- Apply pattern-matching for "via Reuters", "according to IRNA", and Telegram `forwarded_from` to classify origin_type for each `event_source`.
- Periodically run an offline/background job to update `source_relationships` by measuring how often a source republishes texts from another within short lags.

### 6. Verification and importance scoring (code + AI)

- For each active event, compute feature set (num_origin_groups, trust-weighted confirmations, conflicts, impact heuristics, relevance to Iran, etc.).
- Stage-1 classifier (cheap model) computes importance and an initial verification guess.
- Stage-2 LLM is invoked only for:
  - Events whose importance is above a pre-threshold (e.g., ≥ 70) and/or whose verification is borderline.
  - Tasks: refine importance, confirm verification status, provide rationale, and update claims JSON.

### 7. Editorial budget and selection (code)

- Once or several times per day, run a batch Worker that:
  - Retrieves all events updated in the last 24 hours.
  - Ranks them by importance.
  - Applies `min_publish_score` and daily caps based on editorial budget.
  - For selected events, enqueues them into a `to_publish` queue.

### 8. Summary generation & cover creation (AI + code)

Worker for publishing:

- For each event in `to_publish`:
  - Call Stage-2 LLM with structured prompt to produce story JSON (title, description, verification, tags, links).
  - Validate JSON; if invalid, retry or fallback template.
  - Build a deterministic image prompt based on category and entities.
  - Call Workers AI image generator to produce a cover.
  - Insert row into `published_stories` with Telegram message metadata once sent.

### 9. Update handling (code + AI)

- When an event receives a new post (`event_updates`), the update classifier determines type (NO_CHANGE, MINOR_UPDATE, MAJOR_UPDATE, CORRECTION, CONTRADICTION).
- Based on type, the publishing worker edits the existing Telegram message or posts an update/correction as per rules defined above.

***

## AI usage and cost estimation (high-level)

Assuming:

- 2,000 raw posts/day.
- 50% filtered as irrelevant/noise before embedding via cheap classifier or rules.
- 1,000 posts/day embedded.
- Embedding cost: `bge-m3` or EmbeddingGemma at ~0.01 USD/1M tokens equivalent for embeddings is negligible; each post is ~400 tokens average → 400k tokens/day → < 0.01–0.05 USD/day for embeddings (order-of-magnitude).[^4][^3][^6]
- Stage-1 classification: cheap 1B model, 1–2 short prompts per post (tokens similar to embeddings) → low cents-per-day.
- Event clustering uses no additional LLM for most posts, with perhaps 5–10% borderline posts invoking Stage-2 classification (say 100–200 posts/day × 300 tokens input + 50 output = 70k tokens/day) → roughly a few cents per day at 0.045/0.384 USD per 1M tokens.[^4]
- Stage-2 editor/summarization: only for events above threshold, say 20–40 events/day × (2k input tokens context + 300 output) → ~50–100k tokens/day → again, cents to tens of cents daily.
- Image generation: 5–25 images/day; depending on Workers AI pricing, likely a small constant monthly cost.

Overall, the architecture is comfortably within a low double-digit USD/month range on Workers AI for the assumed scale, excluding external crawling or storage costs.[^3][^6][^4]

***

## Expected weaknesses and V1 limitations

- **Reliance on heuristics for independence**: The source relationship model in V1 is partly manual and heuristic; some outlets may be treated as independent when they actually mirror wires, or vice versa.
- **Entity and geo extraction noise**: Rule-based NER/geocoding will occasionally misclassify locations or fail in noisy Telegram messages; this can affect clustering and importance estimation.
- **Temporal clustering edge cases**: Long-running events (e.g., protracted conflicts) may fragment into multiple events or merge unrelated incidents in the same region unless carefully tuned.[^14][^13]
- **LLM hallucinations**: Although prompts and JSON schema validation mitigate hallucinations, Stage-2 models might still invent small details; manual spot checks and conservative publication thresholds remain necessary.
- **Language coverage**: While bge-m3 and EmbeddingGemma are multilingual, performance may vary by language, especially for code-mixed or colloquial Telegram content.[^8][^9][^7][^2]
- **Cost spikes in crises**: During major crises with thousands of relevant posts per day, Stage-2 LLM usage may spike; mitigations include raising thresholds for Stage-2, lowering frequencies, or temporarily limiting image generation.

***

## Implementation priorities for V1

1. **Ingestion + D1 schema + Vectorize wiring**: Get raw posts flowing into D1 and Vectorize with embeddings and timestamp metadata.
2. **Basic clustering & deduplication**: Implement streaming clustering with simple thresholds and temporal windows; verify quality on historical data.
3. **Source modeling (manual) & independence logic**: Curate a list of key Iranian and international sources, mark wire vs original vs official, and implement grouping logic.
4. **Verification + importance scoring (rule-based)**: Implement rule-based status and scoring with manual weights; calibrate to achieve 5–25 stories/day.
5. **Stage-2 editorial summaries**: Integrate 8B LLM for JSON summaries and categories; design robust prompts and schema validation.
6. **Update classification**: Implement basic NO_CHANGE/MINOR/MAJOR/CORRECTION/CONTRADICTION detection and Telegram actions.
7. **AI covers**: Add abstract cover generation after editorial pipeline is stable.

This staged approach delivers immediate value—a high-signal Telegram channel with verified, prioritized events—while leaving room for later enhancements like full claim-level modeling, learned independence graphs, and more sophisticated temporal clustering.

---

## References

1. [Workers AI Models · Cloudflare Workers AI docs](https://developers.cloudflare.com/workers-ai/models/) - Browse the catalog of machine learning models available on Workers AI.

2. [Workers AI llms-full.txt](https://developers.cloudflare.com/workers-ai/llms-full.txt)

3. [Workers AI: serverless GPU-powered inference on ...](https://blog.cloudflare.com/workers-ai/) - We are excited to launch Workers AI - an AI inference as a service platform, empowering developers t...

4. [The Cloudflare AI Stack: Workers AI, Vectorize, AI Gateway ...](https://www.cipher.co.th/en/blogs/cloudflare-ai-stack-explained/) - A practical guide to the Cloudflare AI stack: Neuron pricing, the 1,536-dimension Vectorize ceiling,...

5. [Cloudflare Workers AI is not a cloud GPU. Practical design ...](https://note.com/gtminami/n/n0d6526c26ad8?hl=en) - Can I run any model I want on Cloudflare, just like a cloud GPU?This is the first question that ofte...

6. [Cloudflare Workers AI Has a Free API: Run AI Models at ...](https://dev.to/0012303/cloudflare-workers-ai-has-a-free-api-run-ai-models-at-the-edge-with-zero-infrastructure-2ibo) - What is Workers AI? Workers AI lets you run AI models on Cloudflare's edge network — text...

7. [New Workers AI models for text generation and embedding in AI ...](https://developers.cloudflare.com/changelog/post/2026-04-09-new-workers-ai-models/) - AI Search adds four new Workers AI models including GLM, Qwen, and EmbeddingGemma.

8. [Models · Cloudflare AI docs](https://developers.cloudflare.com/ai/models/) - Browse AI models available through Cloudflare, including hosted models on Workers AI and external pr...

9. [Workers AI Changelog | Cloudflare Docs](https://developers.cloudflare.com/changelog/product/workers-ai/2/)

10. [Changelog · Cloudflare Workers AI docs](https://developers.cloudflare.com/workers-ai/changelog/) - Review recent changes to Cloudflare Workers AI.

11. [Limits · Cloudflare Workers AI docs](https://developers.cloudflare.com/workers-ai/platform/limits/) - Rate limits for Workers AI inference requests, organized by task type and model.

12. [Event-Driven News Stream Clustering using Entity-Aware Contextual Embeddings](https://axi.lims.ac.uk/paper/2101.11059)

13. [A Comparison of Bottom-Up and Top-Down Approaches ...](https://arxiv.org/html/2607.00849v1)

14. [[PDF] Temporal-Guided News Stream Clustering with Event Summaries](https://aclanthology.org/anthology-files/pdf/findings/2023.findings-emnlp.274.pdf) - The embedded documents are clustered us- ing HDBSCAN to identify key news events. We study the impac...

15. [Event-based news embedding: leveraging entities, themes, and ...](https://link.springer.com/article/10.1007/s00521-026-12021-2) - In this paper, we propose a novel, lightweight method that optimizes news embedding generation by fo...

