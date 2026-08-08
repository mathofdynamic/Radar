# Phase 05 — Source Independence and Verification

## Coding-Agent Prompt

Implement Phase 05 of Radar. Read `Overview/Full-Detailed-Overview.md` and all previous phase files first.

## Goal

Determine whether an event is independently corroborated instead of simply repeated by many Telegram channels. Produce an explainable event-level verification status. Do not implement importance ranking or publication yet.

## Core Rule

Raw channel count is not confirmation count. If several channels repeat one upstream report, they belong to the same origin group. Separate original reporting or independently sourced reporting may count as separate origin groups.

## Required Work

### Source and origin metadata

Use the existing source registry and extend it where needed to represent:

- source role and type;
- authority/trust context;
- known upstream relationships;
- whether the source usually originates, republishes, translates or aggregates reporting.

For every `event_source`, assign a controlled `origin_type`:

- `original_reporting`
- `official_statement`
- `wire_republish`
- `aggregation`
- `translation`
- `forward_repost`
- `unknown`

Prefer deterministic evidence first:

- Telegram forward metadata;
- explicit citations/links;
- known source relationships;
- very high textual similarity shortly after an upstream report.

Use Workers AI only for ambiguous cases and validate its structured JSON output.

### Source relationship graph

Use `source_relationships` to represent relationships such as:

- `republishes`
- `translates`
- `frequently_quotes`
- `forward_of`

Store relationship confidence and allow manual overrides. Do not convert weak statistical correlation into permanent fact automatically.

### Origin groups

Compute an `origin_group` for each report attached to an event.

General rules:

- direct forwards from the same source -> same group;
- republishing the same upstream report -> same group;
- translations of the same original report -> normally same group;
- independently sourced reporting -> separate group;
- many outlets quoting the same primary statement -> do not become many independent confirmations.

The grouping decision must remain inspectable.

### Core fact and details

Maintain a minimal event `core_fact` containing only the part of the event that can be evaluated consistently.

Keep additional or disputed details in `claims_json` for V1 instead of creating a large normalized claim graph.

Suggested shape:

```json
{
  "core_fact": "...",
  "supporting_details": [],
  "disputed_points": []
}
```

### Independent confirmation count

For each event expose both:

- total number of reporting sources;
- number of independent origin groups supporting the core fact.

The final product will display the independent number.

### Verification status

Implement a controlled enum:

- `CONFIRMED`
- `DEVELOPING`
- `DISPUTED`
- `UNVERIFIED`

Recommended starting semantics:

- `CONFIRMED`: core fact supported by at least two credible independent origin groups, or another explicit strong policy defined in configuration, with no major contradiction.
- `DEVELOPING`: credible reporting exists but independent confirmation or important details remain incomplete.
- `DISPUTED`: credible evidence materially conflicts about the core fact or major details.
- `UNVERIFIED`: evidence is isolated, low-confidence or not corroborated.

Keep thresholds and policies centralized/configurable.

### Recalculation

Recompute verification whenever material new evidence joins an event. Preserve status history through event updates so transitions remain auditable.

## Tests

Include fixtures for:

1. many channels repeating one upstream report -> one origin group;
2. multiple translations of one upstream report -> one group;
3. several genuinely independent reports -> multiple groups;
4. one weak source -> `UNVERIFIED`;
5. credible but incomplete reporting -> `DEVELOPING`;
6. independently corroborated core fact -> `CONFIRMED`;
7. materially conflicting credible reports -> `DISPUTED`;
8. forwarded/aggregated reports do not increase independent confirmation count;
9. status changes correctly after new evidence;
10. invalid AI classification output fails safely.

## Observability

For any event, an operator should be able to inspect:

- attached raw posts;
- source role;
- origin type;
- origin group;
- dependency reason;
- total sources;
- independent confirmations;
- verification status;
- disputed points.

## Acceptance Criteria

Phase 05 is complete when:

1. source dependency is explicitly represented;
2. copied/forwarded reports do not inflate confirmation counts;
3. total source count and independent confirmation count are separate;
4. verification status is centralized, documented and recalculated as evidence changes;
5. conflicts can move an event to `DISPUTED`;
6. core fact and uncertain details are separated;
7. confirmation calculations are explainable;
8. AI is only used for ambiguous judgments and outputs are schema-validated;
9. tests/lint/type checks pass;
10. no later importance/publishing work is introduced.

At the end, report the verification rules, example origin-group calculations and known limitations.