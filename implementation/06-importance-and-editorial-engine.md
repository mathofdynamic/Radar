# Phase 06 — Importance Scoring and Editorial Engine

Radar calculates importance deterministically, then uses Nebula only for bounded editorial judgment above the existing Stage-1 threshold.

## Deterministic score

Store explicit 0–100 subscores for impact, Iran relevance, urgency, confidence, novelty, and geopolitical/systemic significance. Preserve the existing weights:

```text
impact                         25%
iran_relevance                 25%
urgency                       15%
confidence                    15%
novelty                       10%
geopolitical/systemic         10%
```

Use event age, deterministic source metadata, origin-group confirmations, verification state, category, and concrete event signals. Do not ask an LLM to rediscover structured fields or confirmation counts.

## Stage-1 Nebula judgment

Only events at or above the current Stage-1 gate call Nebula. The prompt asks for strict JSON containing `PUBLISH`, `MONITOR`, or `IGNORE`, a bounded score adjustment, a short reason, and a breaking-candidate flag. The result is validated and never overrides deterministic verification or publishing rules.

Stage-1 should penalize routine statements, minor incidents, copied commentary, clickbait, and low-impact rumors. It should prioritize concrete consequences, scale, urgency, geopolitical/economic significance, and Iran relevance.

## Stage-2

Stage-2 Persian story generation is a separate Nebula prompt and is called only when publishing is eventually enabled and the deterministic/editorial gates permit it. It receives current event evidence and the deterministic verification count. It may not invent source confirmations or identifiers.

## Safety

During V8 review, `PUBLISH_ENABLED=false` and D1 `publishing_enabled=false`. Editorial analysis may continue, but no Stage-2 story, cover, or Telegram send is allowed.
