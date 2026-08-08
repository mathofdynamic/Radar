# Phase 04 — Embeddings, Deduplication, and Event Clustering

## Coding-Agent Prompt

Implement Phase 04 of Radar.

Read first:

- `Overview/Full-Detailed-Overview.md`
- all previous phase files

Assume live Telegram ingestion, source registry, normalization and bounded backfill are already working.

## Goal

Convert normalized raw posts into real-world event clusters while preserving traceability.

This phase should answer:

> Are these two reports duplicates, updates to the same event, or different events?

Do not implement final verification, importance scoring, publishing or cover generation yet.

## Core Principle

A raw post is evidence. An `event` is the real editorial object.

Multiple posts from different channels that describe the same occurrence must be attached to one event instead of creating separate stories.

## Workers AI Embeddings

Add multilingual embedding generation using a currently available Workers AI model suitable for Persian, English and Arabic.

Preferred starting model:

```text
@cf/baai/bge-m3
```

If this model is unavailable in the actual account/runtime, use the best current multilingual Workers AI replacement and document the change.

### Embedding input

Build a deterministic compact representation from normalized content, such as:

- headline if available
- normalized body/caption
- limited important metadata when useful

Do not blindly embed huge raw metadata blobs.

Record:

- model ID/version
- embedding status
- embedding timestamp
- reference to the raw post

## Vectorize

Create/configure a Vectorize index suitable for the selected embedding dimensions.

Store metadata sufficient for candidate filtering, including when supported:

- raw post ID
- source ID
- published timestamp
- language
- event ID once assigned
- key category/source hints

Treat D1 as the system of record. Vectorize is an index, not the authoritative database.

## Cheap Pre-Embedding Filter

Avoid embedding obviously useless records.

Reuse Phase 03 deterministic noise flags and only add very conservative additional logic.

Do not aggressively filter plausible news based on an AI classifier yet unless it is required to control cost and is fully testable.

## Near-Duplicate Detection

Implement a first-pass duplicate layer before event assignment.

Use a hybrid of:

- embedding cosine similarity
- lexical overlap
- short temporal window
- source identity

Examples of duplicates:

- same channel reposting almost identical content;
- another channel copying the same wire text;
- headline changed but body effectively identical.

Do not delete duplicates. Store a relation in `raw_post_duplicates` or equivalent so provenance remains queryable.

Create deterministic similarity utilities and configurable thresholds.

Do not hardcode research thresholds as absolute truth. Initial values such as `0.78–0.85` may be used only as documented defaults pending calibration.

## Event Candidate Retrieval

For every non-duplicate post:

1. Query recent nearest neighbors from Vectorize.
2. Restrict candidate time horizon, initially approximately 24–48 hours depending on category.
3. Retrieve the associated candidate events from D1.
4. Score whether the new post belongs to each event.

Candidate score should combine multiple signals instead of embedding similarity alone.

Include at minimum:

- semantic similarity
- lexical overlap
- shared named entities when available
- geographic compatibility when available
- temporal proximity

## Lightweight Entity Extraction for Clustering

Add enough entity extraction to make clustering safer.

V1 may use deterministic/gazetteer approaches for:

- Iranian cities/provinces
- countries
- major organizations
- common political figures
- currencies/markets
- important military/infrastructure locations

Store normalized entities in a reusable form.

Do not attempt a perfect universal NER system in this phase.

## Event Creation and Assignment

If a candidate passes the configured cluster threshold:

- link the raw post to that event;
- update `last_updated_at`;
- update event source membership;
- update event prototype/centroid representation as designed.

If no candidate passes:

- create a new event;
- attach the raw post as the seed source;
- create/store an event-level embedding representation or centroid reference.

Preserve `first_seen_at` independently from `last_updated_at`.

## Borderline Same-Event Classifier

Only ambiguous cases should call a stronger Workers AI text model.

Input should be constrained and structured:

- candidate event core text/representative reports
- new post
- extracted entities
- timestamps

Expected result:

```json
{
  "same_event": true,
  "confidence": 0.91,
  "reason": "..."
}
```

Validate this output with a schema.

Never use the LLM for every incoming post if deterministic/vector logic already produces a confident decision.

## Long-Running Event Protection

Avoid merging an entire multi-day war, election or negotiation into one giant event.

An event should represent a coherent development, not a broad topic.

Examples:

- "Iran-US negotiations" is a topic.
- "New negotiation round begins in Muscat on date X" is an event.
- "Talks end without agreement" is another event/update depending on temporal continuity and editorial design.

Introduce configurable time/category constraints that reduce over-merging.

## Calibration Dataset

Create a small test fixture dataset containing Persian/English example reports with known relationships:

- exact duplicates
- translated duplicates
- same event with different wording
- similar topic but different event
- same location but different incident
- event updates

Use it to test threshold behavior.

## Tests

Add automated tests for:

- embedding job eligibility;
- Vectorize metadata mapping using mocks where needed;
- lexical similarity utilities;
- duplicate classification;
- event candidate scoring;
- create-new-event decision;
- attach-to-existing-event decision;
- entity/location conflict preventing a bad merge;
- long-running topic separation;
- schema validation of borderline LLM output;
- idempotent reprocessing of a post already assigned to an event.

## Metrics / Debugging

Add structured metrics/log fields for:

- posts embedded
- posts skipped
- duplicates detected
- new events created
- posts attached to existing events
- borderline LLM calls
- average candidate similarity
- clustering failures

Make thresholds configurable without code rewrites.

## Acceptance Criteria

Phase 04 is complete when:

1. Eligible normalized posts receive multilingual embeddings.
2. Vectorize can retrieve recent semantically related reports.
3. Near-duplicates are linked without destroying provenance.
4. Same-event reports from multiple sources reliably cluster in the fixture dataset.
5. Similar-topic/different-event examples remain separate.
6. Every clustered source remains traceable back to its raw post.
7. Ambiguous cases can use a validated LLM backstop without making every post expensive.
8. Thresholds/configuration are documented and tunable.
9. Tests/lint/type checks pass.
10. No verification/importance/publishing logic from later phases is implemented yet.

At the end, report the initial thresholds, fixture results, known clustering failure modes, and what should be tuned using real traffic.