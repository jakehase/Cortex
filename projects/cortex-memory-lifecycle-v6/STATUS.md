# Cortex Memory Lifecycle v6 — Status

## Current state

**Implementation candidate passed the approved corrected focused smoke; deployment is in progress.**

- Active implementation worktree: `/root/clawd/worktrees/cortex-memory-lifecycle-v6-20261002`
- Branch: `feature/cortex-memory-lifecycle-v6-20261002`
- Accepted source base: `02491ba4370e28bd8bdd6520af6787e456da4c8a`
- Production still remains on: `/opt/cortex/releases/cortex-memory-repair-20260930-v5`
- Planned immutable release: `/opt/cortex/releases/cortex-memory-lifecycle-20261002-v6`

## Implemented candidate

- temporal truth, freshness metadata, as-of/as-known-at visibility, and historical retention;
- privacy admission with hash-only quarantine;
- principal-scoped hard deletion, source-file preservation, and replay fences;
- stable owner source/chunk identity and typed pre-ranking filters;
- contradiction/supersession fact edges with deterministic active winners;
- encrypted crash-replayable lifecycle payloads and receipts;
- review-gated promotion with independent-evidence thresholds;
- bounded recall metrics plus actual-owner and synthetic no-PHI corpora;
- versioned-source reconciliation of the current production runtime.

## Focused smoke evidence

Replacement smoke artifact: `/root/clawd/artifacts/cortex-memory-lifecycle-v6-20261002/smoke.json`

Result: **passed** at `2026-10-02T15:57:01.676870Z`.

Exercised checks:

- Python compile and diff hygiene;
- router imports and Pydantic models;
- temporal visibility and pre-ranking typed filters;
- hash-only sensitive-data quarantine;
- contradiction edges and review-gated promotion;
- server outbox idempotency;
- stable IDs and exact semantic verification;
- bounded recall metric calculations;
- principal semantic/fallback deletion and pre-deletion replay rejection;
- source-file preservation;
- AES-256-GCM replay/receipt encryption and tamper rejection.

The original harness failure remains preserved at `/root/clawd/artifacts/cortex-memory-lifecycle-v6-20261002/smoke-attempt-1-failed.json`. Jake explicitly approved one corrected replacement run. The resolved blocker record is `/root/clawd/artifacts/cortex-memory-lifecycle-v6-20261002/blocker-report.json`.

## Truth boundary

The passing smoke proves only the isolated mechanical paths it exercised. It is not broad regression, soak, production-health, or empirical owner-recall-quality evidence. Live deployment, owner reindexing, production health, exact runtime/source hashes, and remote persistence remain pending at this checkpoint.
