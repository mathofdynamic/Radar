# Phase 07 — Story Generation, Covers, and Telegram Publisher

## Coding-Agent Prompt

Implement Phase 07 of Radar.

Read first:

- `Overview/Full-Detailed-Overview.md`
- all previous implementation phase files

Assume the editorial engine now produces approved event candidates with stable event IDs, verification state, importance score, independent confirmations and source references.

## Goal

Convert approved events into concise Persian news stories, create a consistent editorial cover, publish them through a Telegram bot, and persist the exact published artifact for future updates.

## Final Story Contract

Every published story must contain:

1. Cover image.
2. Title.
3. Short Persian description, maximum 1000 characters.
4. Verification status.
5. Independent confirmation count.
6. Primary source names.
7. Category.
8. Entity tags.
9. Buttons/links to original reports.

The final story must remain traceable to the event and underlying raw posts.

## Stage-2 Story Writer

Use the stronger validated Workers AI editorial model selected in previous phases.

The model receives structured event evidence rather than an uncontrolled raw dump.

Input should include:

- event core fact;
- important confirmed details;
- disputed/uncertain details;
- verification status;
- independent confirmations;
- selected primary sources;
- event category/entities;
- important dates/numbers;
- why the event was selected;
- previous published version if this is a later update.

Expected JSON output:

```json
{
  "title": "...",
  "description": "...",
  "category": "WAR_SECURITY",
  "tags": ["ایران", "..."],
  "source_ids": [1, 2],
  "cover_concept": "..."
}
```

Validate the output against a schema.

## Editorial Writing Rules

The generated Persian story must:

- describe confirmed facts directly;
- clearly attribute allegations/uncertain information;
- preserve important dates and numbers;
- avoid sensational language;
- avoid unsupported background or invented causality;
- avoid pretending consensus when sources disagree;
- use concise natural Persian;
- keep description <= 1000 characters;
- avoid redundant source list prose because buttons/source metadata handle it separately.

If the model output violates hard constraints, retry with bounded attempts or use a deterministic fallback. Never publish malformed unchecked output.

## Source Selection and Buttons

Choose a small set of primary source links that best represent the evidence.

Prefer:

- original/primary reports;
- authoritative confirmation;
- genuinely independent reporting;
- useful contrasting source when the event is disputed.

Do not create ten buttons for ten copies of the same upstream report.

Use Telegram inline keyboard buttons linking directly to original Telegram posts or source articles.

Use source names as button labels when possible.

## Cover Prompt Generation

Create a deterministic prompt builder using structured event fields:

- event/category;
- relevant entities;
- location when useful;
- symbolic visual concept;
- Radar brand visual constraints.

Do not let the language model freely invent a fake scene of the event.

## Cover Safety and Visual Direction

Covers are editorial illustrations, not documentary evidence.

Never generate a photorealistic fake depiction that could reasonably be mistaken for an actual photograph of the reported event.

Preferred visual approaches:

- abstract editorial illustration;
- symbolic object/composition;
- map-inspired graphics;
- geopolitical composition;
- finance/technology visual metaphor;
- controlled stylized 3D/graphic design consistent with Radar branding.

Avoid text inside generated images unless later proven reliable and intentionally designed.

## Image Generation

Use Cloudflare Workers AI image generation, initially FLUX.2 Klein 4B if available and validated.

Requirements:

- generate only after publication approval;
- use consistent aspect ratio suitable for Telegram posts;
- handle image-generation failure without losing the story;
- store generated image in R2;
- persist R2 key/URL/reference;
- avoid regenerating identical covers due to Queue retries.

A failed cover should have a defined fallback behavior, such as a category-default graphic or text-only post, rather than blocking important breaking news indefinitely.

## Telegram Publisher

Use a Telegram Bot API bot that has permission to publish to the destination Radar channel.

The publishing worker must:

1. consume approved publish jobs;
2. confirm the event/version has not been superseded;
3. generate/validate story text;
4. ensure cover availability/fallback;
5. construct Telegram caption/message and inline keyboard;
6. send the message exactly once;
7. store returned Telegram message ID and publication metadata in `published_stories`;
8. mark the event as published for that version.

## Idempotent Publication

Queue retries must never create duplicate Telegram posts.

Implement a publication state machine or unique publication key based on stable event/version identity.

Before sending, check whether the exact publish job was already completed.

Handle the difficult case where Telegram succeeds but the Worker crashes before D1 records success. Use a practical reconciliation strategy and document the residual edge case; do not simply assume exactly-once external side effects.

## Telegram Format

Keep messages scannable.

A conceptual format:

```text
[Cover]

عنوان خبر

توضیح کوتاه...

وضعیت: تأییدشده
تأیید مستقل: ۳ منبع

#ایران #اقتصاد

[ایرنا] [Reuters] [منبع دیگر]
```

Exact typography can be adjusted to Telegram formatting limitations.

Do not expose internal scores or AI reasoning in the public channel unless intentionally configured.

## Published Story Persistence

Persist at minimum:

- event ID;
- event version/snapshot;
- publication timestamp;
- Telegram message ID;
- final title;
- final description;
- verification status;
- independent confirmation count;
- primary sources;
- category;
- tags;
- source links;
- cover reference;
- story-generation model/version;
- publication state.

This record becomes the baseline for Phase 08 updates.

## Tests

Add tests for:

- story JSON validation;
- Persian description length enforcement;
- uncertainty attribution;
- source selection removing dependent duplicates;
- inline keyboard construction;
- cover prompt construction;
- image failure fallback;
- R2 persistence using mocks/local binding;
- publisher idempotency;
- Queue retry not creating a second publish action in normal simulated cases;
- Telegram API errors and retry behavior;
- superseded event version rejected before publication.

## Acceptance Criteria

Phase 07 is complete when:

1. an approved event can become a validated Persian story;
2. description length never exceeds the configured maximum;
3. verification and independent confirmation are displayed correctly;
4. source buttons resolve to original reports;
5. generated covers follow the editorial-illustration policy;
6. cover failure has a safe fallback;
7. a Telegram bot can publish a complete story;
8. publication metadata is persisted for later edits;
9. Queue retries do not normally duplicate posts;
10. tests/lint/type checks pass.

At the end, provide a sample rendered Telegram story using fixture data, the final structured story schema, cover prompt template, and deployment/configuration checklist for the publishing bot.