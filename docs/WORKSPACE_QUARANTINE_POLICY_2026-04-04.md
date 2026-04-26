# Workspace quarantine policy — 2026-04-04

Purpose: keep `/root/clawd` clean, navigable, and single-truth-oriented when old repos, comparison harnesses, scratch outputs, or superseded runtimes are no longer part of the active architecture.

## Rule
When something is no longer active but might still be useful for audit/recovery, **quarantine it instead of deleting it**.

## Quarantine root
- `/_quarantine/<date>-<label>/...`

## What should be quarantined
- superseded external repos/clones that are no longer part of the active architecture
- installed binaries/config directories for disabled runtimes
- benchmark/comparison harnesses that are no longer meant to influence current implementation decisions
- top-level scratch files, one-off search dumps, temporary audits, and generated summaries that clutter navigation
- stale artifacts from abandoned campaigns

## What should usually stay in place
- the currently active product repo(s)
- current campaign state/artifacts for live work
- long-term docs that still describe active architecture
- intentional backups if still part of the active recovery plan

## Current doctrine
- Cortex-owned implementations should carry forward only the selected superior ideas from outside systems.
- Do **not** leave old external repos/runtimes on PATH or in obvious top-level workspace locations if they are no longer part of the active path.
- Prefer one clear active implementation path over multiple similarly named repos/tools/artifacts.
- Moving forward: if implementation or repair work adds a new path, revives a fallback path, or chooses one path over another, quarantine the unused/superseded bits instead of letting them remain mixed into the active workspace.
- Apply this generally, not only to ClawHip-related cleanup.

## Operational steps
1. Identify the active architecture first.
2. Move superseded surfaces into `_quarantine/`.
3. Record what was moved and why.
4. Verify the old binary/runtime is no longer discoverable accidentally (for example, `command -v <tool>` no longer resolves).
5. Update any live campaign/docs so they point only at the active path.

## Helper
Use:
- `node scripts/quarantine-paths.mjs --label <label> --reason <reason> <path>...`

The helper creates a dated quarantine bucket and writes a `manifest.json` so the move is auditable.
