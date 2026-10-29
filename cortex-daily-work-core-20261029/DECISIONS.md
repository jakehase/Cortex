# Cortex Daily Work Core Decisions

Append-only durable decisions for this bounded implementation.

## 2026-10-29 — Bind reply anchor and parity target

- Decision: Implement all five improvements from message `3EB0E8B3478930C8DDDE38`, as approved by reply `AC925111138D49CE7CBE148AF79F7F3B`, at fidelity `parity_for_scope`.
- Reason: The user approved the complete recommendation, not a plan or subset.
- Evidence: Parent transcript and `plan.md`.
- Supersedes: Any narrower interpretation that would implement only evidence integrity or attention.
- Follow-up: Keep exactly five product rows green or report an exact blocker.

## 2026-10-29 — Select the matching clean source worktree

- Decision: Use `/root/clawd/_worktrees/oracle-expiring-oauth-20261026` as the only implementation source path.
- Reason: `/opt/cortex/current` identifies source commit `28ffec514d3b`; this worktree is clean at that commit. The dirty `/root/clawd` root must not be staged. Loaded route-gate and memory-bridge hashes match this worktree, while `.cortex-export` differs.
- Evidence: live `RELEASE.json`, worktree status/head, `openclaw plugins list/inspect --runtime`, and SHA-256 comparisons performed before editing.
- Supersedes: Treating `/root/clawd/.cortex-export` as canonical merely because its unrelated export commit is newer.
- Follow-up: Preserve `.cortex-export` untouched for recovery.

## 2026-10-29 — Extend existing primitives, do not create parallel ledgers

- Decision: Use `extend_existing` for every row: route-gate/claim-integrity for evidence, everyday intelligence for attention and decisions, route-gate/Nexus for modes, memory bridge/governance for corrections.
- Reason: Prior art exists for each capability and the workspace gate forbids duplicate primitives without explicit justification.
- Evidence: `artifacts/prior-art-gate.json` plus direct source inspection.
- Supersedes: New standalone evidence, obligations, corrections, or decision stores.
- Follow-up: Put attention rows in the existing everyday-intelligence `decisions.jsonl` event log with a distinct `record_type`; put correction state in canonical memory claim keys.

## 2026-10-29 — Preserve the existing everyday event log

- Decision: Store attention lifecycle events in the existing `decisions.jsonl` state log, marked `record_type=attention`, rather than introduce a database or second attention ledger.
- Reason: Direct source inspection showed the canonical everyday implementation is JSONL-based, not SQLite. Extending that store is the smallest compatible path and avoids parallel state.
- Evidence: `public/cortex_server/cortex_server/routers/everyday_intel.py` before product edits.
- Supersedes: The planning shorthand that referred to an `everyday.db`.
- Follow-up: Keep legacy decision rows compatible by treating a missing `record_type` as `decision`.

## 2026-10-29 — Keep active obligations confirmation-gated

- Decision: Attention entries begin as source-backed candidates. Activation of a user commitment/obligation requires an exact quote present in the current user-authored text, verified by the plugin before the server transition.
- Reason: Ambiguous remarks must not become obligations, and model self-attestation is insufficient.
- Evidence: User requirement and source-backed attention acceptance row.
- Supersedes: Automatic obligation extraction directly into an active state.
- Follow-up: Resolution also requires a source reference and leaves an auditable resolved state.

## 2026-10-29 — Use qualitative decision fields only

- Decision: The workbench will preserve benefit, time/ongoing burden, cost, reversibility, uncertainty, evidence state, and recommendation-changing gaps as qualitative/source-backed values; it will not calculate scores or rankings.
- Reason: Numeric precision would be fabricated when evidence and preference weights are absent.
- Evidence: User-approved recommendation and existing `everyday_intel` scoring overlap.
- Supersedes: Extending the old weighted-score helper as the primary workbench.
- Follow-up: Existing legacy endpoint remains for compatibility; new workbench path does not invoke it.

## 2026-10-29 — One integrated smoke and bounded deployment

- Decision: Use one focused integrated smoke for the user's exact five-feature workflow; avoid broad suites, canaries, and review rounds.
- Reason: The user explicitly requested one focused integrated smoke and bounded safe deployment.
- Evidence: Current task contract.
- Supersedes: Broad benchmark or multi-agent campaign.
- Follow-up: Record exact staged/deployed state per row and stop on any release/auth blocker.

## 2026-10-29 — Bind document claims to document evidence type

- Decision: A successful but unrelated memory/search result does not authorize “I reviewed the agreement.” Document/record verification wording requires a usable read/parser/document/file source result; failed, aborted, empty, or unrelated evidence triggers qualification.
- Reason: Evidence integrity is claim-to-source binding, not a count of successful tool calls.
- Evidence: Integrated smoke includes aborted, failed, empty, unrelated-usable, and matching-usable cases.
- Supersedes: Treating any successful tool call as sufficient support for every verification claim.
- Follow-up: Keep the truth boundary bounded; this is deterministic enforcement for declared verification claims, not universal semantic fact checking.

## 2026-10-29 — Implementation green before deployment

- Decision: Mark all five implementation rows complete and smoke-passed, but keep deployment state `staged_not_deployed` until live server, loaded plugin paths, gateway startup guard, and remote commit are verified together.
- Reason: Mechanical green and live deployment are distinct truth layers.
- Evidence: `artifacts/integrated-smoke.json` and the clean-worktree diff.
- Supersedes: Any claim that a green local smoke alone means production is active.
- Follow-up: Use the existing immutable release plus code-manifest guard; do not hot-edit old releases or bypass startup protection.
