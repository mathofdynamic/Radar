# Phase 03 — Source Registry, Normalization, and Backfill

## Coding-Agent Prompt

Implement Phase 03 of Radar.

Read first:

- `Overview/Full-Detailed-Overview.md`
- all previous implementation phase files

Assume the Telegram collector and Cloudflare ingest path already work. Preserve those interfaces.

## Goal

Turn the raw Telegram feed into a controlled source system with curated metadata, clean normalized text, reliable channel identity, bounded history backfill, and correct edit/reconciliation behavior.

Do not implement embeddings, event clustering or final editorial AI yet.

## Source Registry

Make `sources` the canonical registry for every monitored source.

Support these fields/concepts:

- stable internal source ID
- display name
- source type
- Telegram numeric channel ID
- Telegram username
- website URL when known
- language(s)
- affiliation/context metadata
- category focus
- priority tier
- operational role
- trust/authority metadata
- wire/origin metadata
- active/inactive state
- human notes

Recommended roles:

- `primary_source`
- `authority_confirmation`
- `breaking_radar`
- `specialist`
- `aggregator`

Recommended priority tiers:

- `TIER_1`
- `TIER_2`
- `TIER_3`

Create a seed/import mechanism for the initial curated Telegram channels. Do not bury source definitions in application code.

Start with a manageable V1 set (roughly 20–30 channels) and make the registry easy to edit later.

## Initial Source Groups

The configuration should support at least these groups without assuming they are all equally trustworthy:

### Authority / official / semi-official

Examples from the research include IRNA, Fars, Tasnim, ISNA, Entekhab and Nournews.

### International / alternative Persian perspectives

Examples include BBC Persian, Iran International, Al Arabiya Persian and Euronews Persian.

### Fast radar / Telegram-native

Examples include Saberin, Iranian Militarism, regional-development channels, Vahid Online, Khabar Fori and Akharinkhabar.

### Economy

Examples include Eghtesad Online and other validated market/economic channels.

Do not treat the example handles as permanent truth. Store them as editable source data and document that every handle should be manually verified before production activation.

## Collector Integration

Replace temporary Phase 02 channel configuration with source-registry-driven configuration while keeping the collector simple.

The collector should receive/export enough source configuration to know which Telegram channels are active.

Do not make the collector depend directly on D1 over a fragile permanent connection if a simpler config-sync endpoint/file is more reliable. Choose a practical design and document it.

Required behavior:

- active source added -> collector can begin monitoring it;
- source disabled -> collector stops treating it as an active input;
- Telegram username change -> stable numeric channel identity is preserved when known;
- unresolved/invalid channel -> visible error state, not silent failure.

## Normalization

Implement deterministic normalization before AI processing.

Normalize:

- whitespace
- Telegram formatting noise
- duplicated captions/body fragments
- URLs/entities into stable representation where useful
- Persian/Arabic character variants where safe for matching, while preserving original text separately
- timestamps to UTC
- empty/meaningless messages
- album/group behavior

Store both:

- original/raw source content
- normalized text used downstream

Never destroy the original evidence when normalizing.

## Basic Noise Rules

Add conservative deterministic filters/labels for content such as:

- obvious advertisements
- channel promotion/housekeeping
- empty media-only records with no useful context
- repeated boilerplate
- very short meaningless posts

Do not permanently discard uncertain posts. Prefer a `processing_status`/noise flag so rules can be changed later.

## Bounded History Backfill

Implement controlled backfill for a newly activated Telegram source.

Default strategy:

- last 24–72 hours, or
- last 100–500 messages,
- whichever configured bound is reached first.

Make limits configurable.

Backfill must:

- respect Telegram rate/flood waits;
- reuse normal normalization and D1 upsert paths;
- never create duplicates;
- preserve source timestamps;
- avoid unbounded `iter_messages` history downloads;
- record completion/failure state per source.

## Downtime Reconciliation

When the collector has been offline for a meaningful duration, support a defensive last-N reconciliation for active channels.

Compare:

- message IDs
- edit timestamps
- deleted/inaccessible state where detectable

The goal is to recover likely missed posts/edits without crawling entire histories.

## Source Identity and URLs

Store both numeric Telegram identity and current username.

Canonical public links may use the username when available, but do not make database identity depend on a mutable username.

If a username changes, historical raw posts must remain linked to the same internal source.

## Tests

Add tests for:

- source seed/import validation;
- active/inactive source behavior;
- normalization of Persian/Arabic text variants;
- raw text preservation;
- album normalization;
- ad/boilerplate flagging;
- bounded backfill limits;
- duplicate-safe backfill;
- username changes with stable numeric identity;
- reconciliation after simulated downtime.

## Acceptance Criteria

Phase 03 is complete when:

1. Sources are managed through a proper registry, not hardcoded event-handler lists.
2. The initial source set can be seeded/imported and edited safely.
3. Raw and normalized content are both retained.
4. New sources can receive bounded backfill without duplicates.
5. Collector downtime can trigger bounded reconciliation.
6. Source identity survives Telegram username changes.
7. Disabled/broken sources produce visible operational state.
8. Deterministic noise flags exist without destructive over-filtering.
9. Tests/lint/type checks pass.
10. No embedding/event intelligence has been implemented prematurely.

At the end, provide a report including the source-registry format, backfill controls, and manual steps for validating Telegram handles before production.