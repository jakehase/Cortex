---
name: clawd-workspace-quarantine
description: Cortex-first local skill for choosing the active implementation path and quarantining stale or conflicting paths in this workspace. Use for repo/path selection, scratch-output cleanup, quarantine moves, recovery notes, and preventing future work from reusing the wrong runtime or artifact set.
---

# clawd-workspace-quarantine

Use this skill when workspace sprawl is becoming a source of mistakes.

## Use this skill for

- selecting the active repo/path before implementation
- deciding what should move into `_quarantine/`
- recording what moved and why
- preventing accidental reuse of stale runtimes, snapshots, exports, or artifacts

## Workflow

1. Identify the active path first.
2. Identify competing or superseded paths.
3. Keep anything still needed for recovery or cited evidence.
4. Move stale or misleading paths into `_quarantine/`.
5. Record the move and reason in a note or memory file.

## Guardrails

- Ask before destructive changes.
- Prefer recoverable moves over deletion.
- Do not quarantine the active implementation path.
- Do not quarantine evidence roots that are still part of a live campaign record.

## Output shape

Use this order:
1. Active path
2. Competing paths
3. What should move
4. Why
5. Recovery note location
