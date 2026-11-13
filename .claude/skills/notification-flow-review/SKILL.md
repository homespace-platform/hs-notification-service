---
name: notification-flow-review
description: Review HomeSpace notification flows end to end - Kafka event contracts, idempotency and DLT behavior, MongoDB persistence, recipient authorization, push job lifecycle, Firebase errors and realtime compatibility. Use when an explicit notification flow review is requested.
---

# notification-flow-review (Claude Code adapter for hs-notification-service)

This is an adapter. It does not contain the workflow itself. The source workflow is the Codex skill at:

```text
../../../.agents/skills/notification-flow-review/SKILL.md
```

(relative to this directory; it resolves to `.agents/skills/notification-flow-review/SKILL.md` in the `hs-notification-service` repository root).

Claude Code does not import that file automatically. When this skill is triggered:

1. Read the source file above with the Read tool.
2. Follow its workflow exactly, together with the `AGENTS.md` rules of this repository. It is review-only unless the user asks for fixes.
3. The source skill has no `references/` or `scripts/` directories. If they are added later, read them from the source skill directory when the workflow requires them.
