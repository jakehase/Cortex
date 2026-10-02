# Cortex Memory Lifecycle v6 — Operating Contract

## Objective

Ship one additive, default-on Cortex memory release that preserves the current v5 production behavior while adding:

1. temporal truth/freshness,
2. privacy admission, quarantine, and principal-scoped hard deletion,
3. stable source/chunk identity plus typed pre-retrieval filters,
4. structured facts with contradiction/supersession edges,
5. crash-replayable write-through with payload-hash binding and idempotent commit receipts,
6. privacy-safe promotion/review and a real owner-question recall benchmark,
7. the active owner-index hotfix promoted into versioned source so runtime and source no longer drift.

## Active implementation path

- Clean source worktree: `/root/clawd/worktrees/cortex-memory-lifecycle-v6-20261002`
- Branch: `feature/cortex-memory-lifecycle-v6-20261002`
- Accepted source base: `02491ba4370e28bd8bdd6520af6787e456da4c8a`
- Production overlay baseline: `/opt/cortex/current` (`cortex-memory-repair-20260930-v5`)
- Canonical server package: `public/cortex_server/cortex_server/`
- OpenClaw bridge: `plugins/cortex-memory-bridge/`
- Owner indexer: `scripts/index-owner-memory.py`

Do not implement against the dirty `/root/clawd` checkout or edit `/opt/cortex/current` in place.

## Scope

### In scope

- Native temporal fields and deterministic temporal query policy.
- Default freshness annotation and stale/unknown handling.
- Admission classification using the shared sensitive-data scanner; hash-only quarantine for rejected content.
- Principal-local deletion across semantic records, lexical fallback, structured memory, operation/idempotency/quota state, governance state, and receipt/outbox replay state.
- Stable source IDs, content/anchor-derived chunk IDs, source revisions, continuity migration, and truthful receipts.
- Typed source/type/tag/fact/time filters applied before semantic ranking.
- Structured fact identity plus `supersedes` and `contradicts` edges, conflict-set projection, authority/provenance fields.
- Durable encrypted lifecycle spool payload, payload hash, restart replay, idempotent receipt reuse, and deletion fences.
- Candidate-fact promotion queue with evidence/privacy thresholds and operator-review CLI/API; no autonomous durable-fact promotion.
- Synthetic, no-PHI recall benchmark with answer recall, leakage, staleness, and conflict metrics.
- One focused end-to-end smoke test that exercises every requested invariant.
- Release build, rollback pointer, live deployment, exact current-state inspection, and remote branch persistence.

### Non-goals

- Model-weight training or fine-tuning.
- PHI storage in the owner/non-BAA memory path.
- Automatic promotion of uncertain claims to durable truth.
- Deleting user-owned source files; hard deletion covers Cortex projections/caches/replay state and fences old replay. Source-of-record deletion remains a separate explicit file action.
- Broad regression, soak, canary, or benchmark campaigns beyond the one approved focused smoke test.

## Architecture

### A. Governance kernel

Add a stdlib-only runtime module that owns:

- temporal normalization and visibility,
- typed filter compilation,
- admission classification/quarantine,
- stable source/chunk/fact identity helpers,
- governance SQLite schema for fact edges, promotion queue, quarantine hashes, deletion fences, and deletion receipts,
- conflict projection and recall metric calculation.

The module must fail closed for malformed timestamps, invalid filters, sensitive admission, or unavailable deletion authority.

### B. Librarian/L22 integration

- Normalize and classify every write before quota reservation/publication.
- Keep temporal/filter fields native in Chroma metadata.
- Stage governance intent before publication; finalize fact edges/promotion state only after durable store confirmation.
- Apply typed filters in the backend query `where` clause before ranking.
- Annotate returned rows with temporal state and conflict edges.
- Expose principal-scoped delete, conflict, promotion-review, and benchmark-evaluation endpoints.

### C. Owner source index

- Replace ordinal identity with stable source ID plus chunk-content/duplicate identity.
- Preserve source revision and legacy predecessor IDs in receipts.
- Migrate old ordinal facts by storing stable records first, exact-read plus per-record semantic verification, then retiring predecessors.
- Remove sibling/source-level semantic credit; a chunk is verified only when that exact ID returns semantically.

### D. OpenClaw write-through bridge

- Persist bounded lifecycle payloads encrypted at rest with AES-256-GCM using an explicit/derived local encryption key.
- Bind ciphertext to principal namespace, persistence key, and payload SHA-256 as authenticated data.
- Replay decryptable pending records after restart.
- Retain/reuse the server assurance receipt and idempotency identity until a committed acknowledgement is proven.
- Purge the principal spool on hard-delete and reject replay older than the server deletion epoch.

### E. Evaluation/promotion

- Store candidates as `candidate_fact`, never automatically as canonical fact.
- Promotion eligibility requires non-sensitive admission, minimum independent evidence, non-stale support, no unresolved higher-authority contradiction, and explicit operator review.
- Benchmark runner consumes no-PHI JSON cases and reports answer recall@k, cross-project/source leakage, stale-answer error, and contradiction winner accuracy.

## Subsystem ownership

| Subsystem | Primary files | Responsibility |
|---|---|---|
| Governance kernel | `runtime/memory_governance.py` | schemas, temporal policy, filters, admission, edges, promotions, deletions, metrics |
| Semantic API | `routers/librarian.py` | write/search/filter/delete/conflict integration |
| Canonical memory API | `routers/l22.py` | durable operation integration and principal deletion |
| Receipt ledger | `runtime/assurance_receipt_ledger.py` | principal receipt purge |
| OpenClaw bridge | `plugins/cortex-memory-bridge/index.ts`, `manager.mjs` | encrypted outbox and restart replay |
| Owner index | `scripts/index-owner-memory.py` | stable identity/migration/exact semantic verification |
| Evaluation | `scripts/evaluate-memory-recall.py`, fixture | metrics and operator output |
| Verification | one integrated smoke test | requested invariant proof only |

## Agent strategy

Three read-only audit workers were attempted but produced no evidence, so no delegated result will be trusted. Implementation and verification remain in the clean worktree. No overlapping writers are permitted.

## Evidence and verifier contract

Exactly one focused smoke command will be run after implementation. It must prove, in one scenario:

- temporal as-of/as-known-at visibility and stale/unknown labeling,
- sensitive payload quarantine without raw retention,
- stable chunk IDs across an earlier-file insertion,
- typed filtering excludes another source/project before ranking,
- contradiction/supersession edges and deterministic active winner,
- encrypted outbox replay uses the same payload hash and receipt identity,
- principal deletion removes all test projections and blocks old replay,
- promotion remains review-gated,
- recall metrics detect injected leakage/staleness/conflict errors,
- exact per-record semantic verification rejects sibling-only evidence.

A passing smoke test proves mechanical operation of this path only. It does not prove broad regression freedom, production efficacy, or perfect recall.

## Artifacts and replay

- Project docs: `projects/cortex-memory-lifecycle-v6/`
- Prior-art record: `/root/clawd/artifacts/cortex-memory-lifecycle-v6-20261002/prior-art.json`
- Focused smoke result: `/root/clawd/artifacts/cortex-memory-lifecycle-v6-20261002/smoke.json`
- Release manifest: `/opt/cortex/releases/cortex-memory-lifecycle-20261002-v6/deploy/memory-lifecycle-v6/release-manifest.json`
- Rollback: atomically repoint `/opt/cortex/current` to `/opt/cortex/releases/cortex-memory-repair-20260930-v5`, restart the same Cortex service, inspect `/health` and memory health.

## Stop condition

Complete only when all seven requested capability groups are implemented in the canonical source path, the single focused smoke passes, the immutable release is deployed as `/opt/cortex/current`, health/current path is inspected, the live owner-index script matches the release, and the exact branch commit is pushed to the authoritative remote.

Stop blocked—not green—if any deletion surface, replay fence, sensitive-data fail-closed path, exact semantic verification, deployment health check, or remote persistence cannot be proven.

## Truth boundary

- Existing v5 production behavior is the baseline, not evidence for the new v6 additions.
- One smoke test is mechanical evidence only.
- No broad quality, retention, recall, or regression claim is allowed without a separate requested campaign.
- Historical operational memories remain source records; temporal fields govern retrieval, not retroactive truth rewriting.
- Runtime/source parity is true only after hash comparison of the deployed release and versioned worktree files.

## Risks and controls

- **Destructive deletion:** require authenticated principal scope plus explicit confirmation; create metadata-only deletion receipt; never delete source files.
- **PHI/secret retention:** scanner-based fail-closed admission; quarantine stores hashes/reasons only.
- **Replay resurrection:** deletion epoch/tombstone checked before commit and during replay.
- **Identity migration:** new record must pass exact read and exact-ID semantic retrieval before old record retires.
- **Chroma filter mismatch:** compile only a typed allowlist; reject unsupported combinations.
- **Release drift:** build from this worktree, immutable release directory, atomic symlink switch, rollback pointer.
- **Large dirty parent checkout:** no edits there except the final deployed live index-script copy after release acceptance.

## Estimates

- Implementation: 3–6 focused hours.
- One integrated smoke and release/deploy inspection: 20–45 minutes.
- Compute: light CPU/SQLite/Chroma fixture work; no large model or browser campaign.

## Next milestone

Implement the governance kernel and wire write/search paths before touching deployment state.
