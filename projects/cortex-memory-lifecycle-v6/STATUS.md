# Cortex Memory Lifecycle v6 — Terminal Status

## State

**Deployed and mechanically healthy, with one measured recall-quality gap.**

- Source commit: `a828d0a027753c4ad089343ed7c599f3bc1cf26f`
- Accepted remote ref: `accepted/cortex-memory-lifecycle-v6-20261002`
- Active immutable release: `/opt/cortex/releases/cortex-memory-lifecycle-20261002-v6.4`
- Rollback release: `/opt/cortex/releases/cortex-memory-repair-20260930-v5`
- Cortex service: active
- OpenClaw Gateway: active; memory/plugin load paths point to v6.4
- Runtime/source parity: all checked key files match

## Verification

- Corrected focused lifecycle smoke: passed.
- Privacy-scope production blocker: fixed and focused check passed.
- Stable semantic verification blockers: fixed with exact-ID authority retained.
- Owner index migration: healthy; 415 accepted/semantically verified, 1 sensitive chunk quarantined hash-only, 0 pending.
- Root owner indexer promoted and hash-matched to the release.
- Live typed `memory_search` through the restarted v6.4 plugin returned current owner records.

## Live owner-question recall

Six bounded owner questions were measured:

- answer recall@5: `0.833333` (5/6)
- source recall@5: `0.833333` (5/6)
- leakage rate: `0.0`
- stale-answer error rate: `0.0`
- contradiction-winner accuracy: `1.0`

The remaining miss is `remote-execution-boundary`. Therefore this release is not claimed to prove complete or global recall quality.

## Evidence

- `/root/clawd/artifacts/cortex-memory-lifecycle-v6-20261002/smoke.json`
- `/root/clawd/artifacts/cortex-memory-lifecycle-v6-20261002/owner-index-apply-v6.4.json`
- `/root/clawd/artifacts/cortex-memory-lifecycle-v6-20261002/owner-recall-live.json`
- `/root/clawd/artifacts/cortex-memory-lifecycle-v6-20261002/terminal-evidence.json`

## Truth boundary

The deployed release proves the exercised mechanical lifecycle paths, immutable activation, owner-index convergence, plugin/default-path activation, and the stated six-case recall metrics. It does not prove broad regression freedom, soak durability, or perfect recall.
