# Radar V8 Nebula Batch Intelligence Decision

## Decision

Radar abandons embeddings and vector search. Semantic event understanding is performed by bounded batched LLM reasoning through the Nebula Free LLM API. The Worker does not call an embedding model, query a vector index, or persist vector checkpoints.

## Rationale

The prior per-report embedding path mixed transient AI work with retryable event finalization. Historical recovery also contaminated efficiency measurement and could cause repeated paid calls. A five-minute batch gives the model the local report context needed to understand paraphrases, Persian/English equivalence, duplicates, updates, temporal distinctions, and same-entity/different-event cases in one bounded request.

## Target request

Radar sends 20–40 compact reports plus a bounded recent active-event shortlist through:

```text
POST https://nebula-free-llm.nebula-ai-company.workers.dev/v1/chat/completions
Authorization: Bearer <NEBULA_API_KEY>
model: auto
```

The request is bounded by report count, report-text characters, active-event count, and total payload characters. D1 remains the source of truth; Queue payloads carry only a durable batch ID.

## Output authority

The model returns grouping actions only:

```text
MATCH_EXISTING_EVENT
NEW_EVENT
DUPLICATE
UPDATE_EXISTING_EVENT
NOISE
UNCERTAIN
```

Radar validates every post/event ID, assignment, category, confidence, and action. Radar—not the model—calculates source identity, copied-source origin groups, independent confirmations, verification state, importance, and publication safety.

## Ambiguity

Confidence below the configured threshold or `UNCERTAIN` triggers one focused request containing only the uncertain reports and two-to-five plausible active events. Persistent uncertainty remains separate and monitorable. The system prefers a temporary false split over an unsafe false merge.

## Backlog and operations

Migration `0008_remove_embedding_pipeline.sql` drops the obsolete checkpoint table, normalizes unfinished legacy analysis states to pending, and adds `intelligence_batches`/`intelligence_batch_items`. Fresh reports have priority over historical recovery. Batch attempts, provider/model, token usage, uncertainty, failures, and applied decisions are durable telemetry. API keys and giant prompts are never persisted.

## Validation before deployment

Use at least 500 production-derived non-noise reports when available in a read-only backtest. Build five-minute-like windows, measure same-event agreement/disagreement, false merges, false splits, and uncertainty, manually inspect representative disagreements, run all tests and deploy-dry checks, and keep publishing disabled. Do not apply the migration or deploy until review approval.
