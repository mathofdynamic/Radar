# Phase 07 — Story, Cover, and Telegram Publisher

Text intelligence uses Nebula; image generation remains a separate Workers AI concern. Covers are generated in Worker memory and sent directly to Telegram. Radar does not use R2 for cover storage.

## Story generation

When publishing is eventually enabled, Stage-2 Nebula receives the event, deterministic verification state, source evidence, links, tags, and editorial reasons. Structured output is validated, language-checked, and persisted with the event/version. Fallback text is deterministic and cannot fabricate evidence.

## Cover generation

The existing Workers AI image binding may generate an optional `640x360` cover. Image response bytes are MIME-checked. A denied or invalid cover does not create a replacement graphic and does not weaken publishing safety.

## Telegram safety

Publishing uses the existing `publish_key`, event publication lock, and state transitions. It is disabled in V8 review:

```text
PUBLISH_ENABLED=false
D1 publishing_enabled=false
```

No Telegram send, edit, resume operation, or cover call is authorized during this task.
