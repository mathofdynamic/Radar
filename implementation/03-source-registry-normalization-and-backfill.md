# Phase 03 — Source Registry, Normalization, and Backlog Recovery

## Source registry

`sources` is the canonical registry for source identity, public username, language, category, priority, role, trust, origin status, polling health, and cursor state. Source identity and origin relationships are deterministic configuration/runtime facts. They are not invented by the LLM.

## Deterministic normalization

Normalize Persian/Arabic text, remove known boilerplate, calculate a stable content hash, and filter obvious noise/deleted records before any Nebula call. Preserve `original_text`, raw metadata, timestamps, and the normalized hash for audit and edit safety.

Useful reports use generic states:

```text
pending -> queued -> analyzing -> analyzed
                       \-> noise
```

Unfinished legacy states are normalized to `pending`; already analyzed/noise rows remain terminal. A ten-minute stale lease is recovered in bounded steps.

## Historical recovery

Migration `0008_remove_embedding_pipeline.sql` makes unfinished legacy analysis eligible for the normal batch path and drops the obsolete checkpoint table. It preserves raw posts, events, source evidence, generic analysis hashes/leases/attempts, and historical AI usage rows. Recovery prioritizes fresh pending reports and never synchronously enqueues the entire backlog.

## Acceptance

- same source/message identity is idempotent;
- changed content resets only generic analysis state;
- obvious noise never consumes Nebula batch capacity;
- stale leases become recoverable without deleting evidence;
- fresh work is not starved by historical recovery;
- all source health failures remain visible in D1 and operations output.
