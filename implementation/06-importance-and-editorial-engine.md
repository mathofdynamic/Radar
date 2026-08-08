# Phase 06 — Importance Scoring and Editorial Engine

## Coding-Agent Prompt

Implement Phase 06 of Radar.

Read first:

- `Overview/Full-Detailed-Overview.md`
- all previous implementation phase files

Assume events already have source membership, independent confirmation counts and verification status.

## Goal

Decide which events are worth attention, rank them consistently, and produce a controlled queue of editorial candidates without yet generating covers or sending Telegram posts.

The system must optimize for signal-to-noise quality, not maximum publication volume.

## Importance Dimensions

Implement explicit 0–100 subscores for at least:

- `impact`
- `iran_relevance`
- `urgency`
- `confidence`
- `novelty`
- `geopolitical_or_systemic_significance`

Recommended starting weights:

```text
impact                         25%
iran_relevance                 25%
urgency                        15%
confidence                     15%
novelty                        10%
geopolitical/systemic          10%
```

Keep weights centralized and configurable.

## Deterministic Features First

Use normal code for features that can be measured reliably, for example:

- event age;
- number of independent confirmations;
- verification status;
- source authority metadata;
- event category;
- whether Iran is directly involved;
- whether the event is ongoing;
- important numeric signals when extracted reliably;
- whether the event is materially different from already published/active events.

Do not ask an LLM to rediscover information that already exists as structured fields.

## Stage-1 AI Classifier

Use a low-cost Workers AI model for semantic judgments that deterministic rules cannot provide well, such as:

- likely impact;
- whether the event has broad significance;
- urgency beyond simple age;
- category refinement;
- whether the event is mostly routine commentary rather than substantive news.

Require schema-validated structured output.

The Stage-1 call should be compact and inexpensive.

## Score Calculation

Calculate and store:

- each dimension subscore;
- final weighted score;
- scoring version/config version;
- short machine-readable reasons/features;
- timestamp of last scoring.

Do not store only a mysterious final number.

Recommended initial bands:

```text
0–59    ignore/archive
60–77   monitor
78–89   routine editorial candidate
90–100  breaking candidate
```

Treat these as defaults pending calibration.

## Editorial Preferences

Encode the initial product priorities from the project overview.

High priority generally includes:

- major Iran developments;
- war/security escalation;
- important government decisions;
- sanctions/negotiations;
- major economic/currency shocks;
- large internet/infrastructure disruptions;
- significant regional/geopolitical changes;
- major AI/technology developments;
- major disasters/emergencies.

Low priority generally includes:

- celebrity gossip;
- minor isolated incidents;
- routine statements with no new substance;
- clickbait;
- repetitive opinion/commentary;
- low-impact rumors.

Implement this as configurable editorial policy, not scattered prompt prose only.

## Stage-2 Editorial Review

Only send promising or ambiguous events to a stronger Workers AI model.

Initial trigger examples:

- importance above a pre-threshold such as ~70;
- verification borderline;
- likely breaking event;
- strong conflict between deterministic and Stage-1 scores.

Stage-2 input should include structured event evidence:

- core fact;
- verification state;
- independent confirmations;
- key source summaries;
- category/entities;
- current subscores;
- important disputed points;
- prior publication/update state.

Expected output:

```json
{
  "publish_recommendation": "PUBLISH|MONITOR|IGNORE",
  "importance_adjustment": 0,
  "reason": "...",
  "category": "...",
  "is_breaking_candidate": false
}
```

Validate strictly.

## Editorial Cycle

Implement a frequent editorial selection process.

Recommended V1 behavior:

- ingestion/clustering: continuous;
- cheap score: immediate after meaningful event changes;
- scheduled editorial selection: approximately every 5 minutes;
- exceptional high-score/high-confidence event: allowed to enter editorial review immediately.

Do not use a once-per-day batch model.

## Editorial Budget

The final channel must remain sparse.

Implement both:

- minimum publication score;
- dynamic/ranked publication budget.

Starting target:

- normal day: roughly 5–15 stories;
- busy day: roughly 15–25;
- major crisis: controlled temporary increase.

Do not blindly block a truly exceptional event because a daily cap was reached. Use a reserved breaking path or score override.

## Category Balance

Avoid one noisy category consuming the entire feed when several equally important categories exist.

Implement light category balancing only after score/importance. Never promote unimportant content just to fill a category quota.

## Candidate Queue

Approved editorial candidates should enter a dedicated Queue/table for Phase 07.

Each candidate must reference the stable event ID and contain enough immutable snapshot/version information to detect if the event materially changes before publication.

Do not generate the final user-facing summary yet unless a small internal preview is needed for debugging.

## Calibration Support

Create tooling or scripts that allow an operator to review recent events with:

- final score;
- subscores;
- verification;
- source count;
- independent confirmations;
- publish/monitor/ignore decision;
- reasons.

Make it practical to adjust weights/thresholds and rerun scoring over a fixture/sample set.

## Tests

Include fixtures for:

- high-impact verified Iran event -> high score;
- popular but low-impact gossip -> low score;
- unverified dramatic claim -> confidence penalty;
- verified routine statement -> moderate/low novelty/impact;
- significant AI release -> high technology significance;
- duplicate event update -> low novelty;
- editorial cap behavior;
- exceptional breaking override;
- Stage-2 invalid output failing safely;
- deterministic score reproducibility for the same config/version.

## Acceptance Criteria

Phase 06 is complete when:

1. every eligible active event receives explainable subscores and a final importance score;
2. weights/thresholds/editorial policy are centralized and configurable;
3. verification directly influences confidence;
4. Stage-1 AI is low-cost and structured;
5. Stage-2 is used only on promising/ambiguous events;
6. a 5-minute editorial cycle can rank and select candidates;
7. an editorial budget prevents feed explosion without hiding exceptional breaking events;
8. operators can inspect why an event was selected or rejected;
9. tests/lint/type checks pass;
10. no cover generation or Telegram publishing from Phase 07 is implemented yet.

At the end, report the current weights, thresholds, editorial budget rules, model choices and calibration instructions.