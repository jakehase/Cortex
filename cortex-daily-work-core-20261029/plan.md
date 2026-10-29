# Cortex Daily Work Core Plan

## Plan metadata

- Project slug: `cortex-daily-work-core-20261029`
- Plan owner: Jake / Cortex implementation subagent
- Created: 2026-10-29
- Last updated: 2026-10-29
- Status: active
- Fidelity target: `parity_for_scope`
- Primary stop condition: `five_surface_matrix_green_or_exact_blocker`
- Reply anchor: current user message `AC925111138D49CE7CBE148AF79F7F3B`, replying to recommendation `3EB0E8B3478930C8DDDE38`
- Status file: `STATUS.md`
- Decisions log: `DECISIONS.md`
- Machine-readable surface matrix: `surface-matrix.json`

## 1. Working name

Cortex Daily Work Core — five bounded improvements that make ordinary answers, attention tracking, corrections, routing, and decisions more dependable.

## 2. Decision summary

Implement all five approved improvements in the active Cortex/OpenClaw default path, extending existing route-gate, memory-governance, and everyday-intelligence infrastructure rather than creating parallel ledgers. The smallest real end-to-end slice is one signed principal flow through the loaded route-gate plugin and Cortex server, proven by one integrated smoke. This plan claims parity only for the five acceptance rows below, not universal answer correctness or efficacy.

## 3. Core thesis / objective

- Primary objective: Make Cortex reliably distinguish user statements, usable source evidence, inference, and recommendation; expose source-backed attention items; route rewrite/advise/execute/investigate proportionally; transfer corrections only within their scope; and compare decisions without fabricated numeric precision.
- User served: Jake in the default direct-assistant workflow.
- Observable outcome: the default request path mechanically rejects failed/aborted/empty evidence, offers an authenticated attention lifecycle and qualitative decision workbench, and persists/retrieves scoped corrections through canonical memory.
- Existing gap: current components contain provenance, routing, memory supersession, everyday tasks, and decision storage, but they are not joined into these five user-facing guarantees.

## 4. Scope

In scope:

1. **Evidence-bound answer enforcement** — classify tool outcomes as usable, failed, aborted, or empty; consequential advice/investigation cannot claim source verification without usable evidence; preserve user fact vs verified fact vs inference vs recommendation.
2. **Source-backed attention view** — candidate/active/resolved lifecycle with source references; user obligations cannot activate without explicit user text; no external messages.
3. **Proportional routing** — deterministic rewrite/advise/execute/investigate mode applied to the default route path; rewrite adds no facts and avoids unnecessary deep consultation; consequential advice demands evidence; execute retains permission gates; investigate separates observation from inference.
4. **Scope-preserving correction transfer** — strong direct-human corrections become canonical memory candidates with scope-specific claim keys; same scope supersedes, unrelated scopes remain; matching corrections are retrieved into future default turns.
5. **Decision workbench** — qualitative option fields for benefit, time/ongoing burden, cost, reversibility, uncertainty, evidence state, and recommendation-changing gaps; no fabricated scores/rankings.
6. One focused integrated smoke covering the complete five-feature workflow.
7. Safe source commit, remote persistence if normal authentication works, and bounded deployment through existing release controls.

## 5. Non-goals

- No universal claim that every unsupported factual sentence can be detected.
- No automatic external send/post/schedule/deploy action.
- No replacement of Cortex memory, task, issue, provenance, or routing systems.
- No new model, credential, OAuth, reasoning-level, safety-mode, or prompt-policy configuration.
- No broad test suite, canary campaign, multi-agent farm, or benchmark claim.
- No automatic conversion of ambiguous conversation into an active obligation.
- No fabricated reimbursement, business, medical, legal, or decision score.

## 6. Active path / repo layout

Active source worktree:

```text
/root/clawd/_worktrees/oracle-expiring-oauth-20261026
```

Live server release before this work:

```text
/opt/cortex/current -> /opt/cortex/releases/cortex-oracle-oauth-window-28ffec514d3b-20261026
source head: 28ffec514d3b
```

Loaded native plugins before this work:

```text
/opt/cortex/releases/cortex-post-audit-repair-0e96970ac73f-20261013/plugins/*
```

Important implementation paths:

```text
plugins/cortex-route-gate/index.ts                 # default work-mode, evidence and attention/workbench path
plugins/cortex-memory-bridge/index.ts              # canonical scoped correction persistence
public/cortex_server/cortex_server/routers/everyday_intel.py  # existing everyday DB, attention lifecycle/workbench
public/cortex_server/cortex_server/main.py          # signed-principal admission for bounded internal everyday calls
cortex-daily-work-core-20261029/                    # plan, matrix, artifacts, smoke result
```

Not active for this change:

```text
/root/clawd/.cortex-export
```

It is clean at `163fc9386`, but its route-gate and memory-bridge files differ from both the loaded plugin files and the matching active source worktree. It remains intact for recovery; nothing is deleted or quarantined.

## 7. Prior art and existing assets

Prior-art gate decision: `extend_existing`

Artifact:

```text
cortex-daily-work-core-20261029/artifacts/prior-art-gate.json
```

Existing assets extended:

- `cortex-route-gate`: current intent classification, signed principal routing, tool lifecycle hooks, request lock, attachment write guard.
- `completion-integrity` and claim-integrity protocol: existing completion/provenance truth boundaries; no second integrity ledger.
- `cortex-memory-bridge` plus memory governance: existing `claim_key`, `fact_key`, status/supersession, scoped source metadata.
- `everyday_intel.py`: existing tasks, daily brief, and decision storage in `everyday.db`.
- Cortex signed principal/write-token middleware: existing internal authorization boundary.

Per-surface decisions:

| Surface | Prior-art decision | Existing primitive extended |
|---|---|---|
| Evidence-bound answers | `extend_existing` | route-gate lifecycle hooks + claim-integrity rules |
| Attention view | `extend_existing` | everyday intelligence DB/task surfaces |
| Proportional routing | `extend_existing` | route-gate/Nexus task routing |
| Correction transfer | `extend_existing` | memory bridge/governed claim supersession |
| Decision workbench | `extend_existing` | everyday decision infrastructure |

## 8. Target architecture

- **Route-gate default path** classifies the current user request into one work mode before expensive consultation. It appends a bounded work contract, tracks actual tool outcomes, retrieves matching scoped corrections, and auto-loads attention only when the user asks for it.
- **Evidence gate** uses trusted tool lifecycle events, not attempted calls or model claims. Failed, aborted, disabled, and empty results are rejected. A pre-finalization revision hook and deterministic outbound qualification prevent unsupported “I checked/verified” wording; user-provided facts remain distinguishable from source verification.
- **Everyday intelligence** gains principal-scoped attention event rows in its existing `decisions.jsonl` state log and a qualitative workbench normalizer. Active/resolved state transitions require source references; active obligations require an exact quote from current user text as verified by the plugin.
- **Memory bridge** detects strong direct-human corrections, assigns scope-derived claim keys, and stores them through the existing assurance/commit/store path. Route-gate retrieves active `scope_correction` memories and injects only bounded same-scope guidance.
- **Security boundary** remains signed-principal + write-token authenticated, loopback-only from the plugin, safe-mode compatible, and external-write-free.

## 9. Surface matrix / ownership

The canonical detailed matrix is `surface-matrix.json` and contains exactly five product rows. One local implementer owns all rows; no agent fan-out or shared-file lease is needed.

## 10. Agent strategy

- Agent count: one implementation subagent.
- Control/execution plane: local control-plane host for bounded text/code edits and one focused smoke.
- Heavy work: none. No local model workers or worker farm.
- Remote boundary: not required for this bounded change.
- Verification: one integrated smoke only, plus direct live endpoint/plugin inventory checks during deployment.

## 11. Implementation sequence and acceptance checks

### Stage 0 — Grounding and prior art

1. Bind reply anchor, active source, live release, and loaded plugin paths.
2. Read OpenClaw plugin/hook/config documentation.
3. Run prior-art gate and inspect existing provenance, tasks, memory governance, intent routing, corrections, and decision infrastructure.

Acceptance: lifecycle files and prior-art artifact exist before product code changes.

### Stage 1 — Server-side canonical extensions

1. Add principal-scoped attention event schema and candidate/active/resolved transitions to the existing everyday-intelligence `decisions.jsonl` log (distinguished by `record_type`, not a parallel store).
2. Require source reference/quote; reject unconfirmed active obligations.
3. Add qualitative decision-workbench normalization with explicit missing-evidence output and no numeric score.
4. Admit only signed principal calls to `/everyday/*` through existing middleware.

Acceptance: direct internal calls show candidate cannot become active without confirmation and resolved items leave active view.

### Stage 2 — Default route-gate integration

1. Add four-mode classifier and proportional consultation/route behavior.
2. Track trusted tool outcomes and reject failed/aborted/empty evidence.
3. Append claim-source contract and matching correction guidance.
4. Register one bounded internal `cortex_daily_work` tool for attention lifecycle and decision workbench.
5. Auto-load attention view on attention requests; never send externally.

Acceptance: default hook path exposes all five behaviors and preserves existing attachment/external-action guards.

### Stage 3 — Scoped correction persistence

1. Detect strong direct-human corrections.
2. Derive stable same-task scope without globalizing terse feedback.
3. Store through existing assurance and memory governance; use same-scope claim keys and distinct unrelated-scope keys.

Acceptance: same scope produces same claim key; unrelated scope differs; metadata says preserve unrelated scope.

### Stage 4 — One integrated smoke

Run one focused smoke that checks, in one workflow:

- aborted/failed/empty evidence rejected and usable evidence accepted;
- user fact/inference/recommendation boundaries retained;
- attention candidate not active without exact user confirmation and resolved lifecycle works;
- rewrite mode avoids facts/deep consultation; consequential advice requires evidence;
- same-scope correction supersedes while unrelated scope remains distinct;
- workbench exposes missing evidence and contains no fabricated score/ranking;
- no external send or policy bypass.

Acceptance: one machine-readable smoke artifact is green with all five rows.

### Stage 5 — Persist and deploy

1. Commit only files changed in this clean worktree.
2. Push through the configured normal remote if authentication succeeds.
3. Build/promote through the existing release mechanism; do not hand-edit immutable old releases.
4. Update loaded plugin paths only through the existing config/deploy mechanism if required, preserving every unrelated entry.
5. Restart only the component required by the existing owner-approved deployment flow.
6. Verify live release identity, route/plugin source path, and focused endpoint behavior.

Acceptance: matrix records exact `deployed` vs `staged` state by row; any failed remote/deploy step is an explicit blocker, never called complete.

## 12. Verifier and evidence contract

Single focused smoke command (final exact path may be updated only if implementation naming requires it):

```bash
cd /root/clawd/_worktrees/oracle-expiring-oauth-20261026 && \
  python3 cortex-daily-work-core-20261029/smoke_five_improvements.py \
  --artifact cortex-daily-work-core-20261029/artifacts/integrated-smoke.json
```

Required artifacts:

```text
artifacts/prior-art-gate.json
artifacts/integrated-smoke.json
surface-matrix.json
STATUS.md
DECISIONS.md
```

Truth rules:

- A successful tool call is not evidence unless its result is non-empty and not a failure/abort envelope.
- User statements may be repeated as user-stated facts without pretending they were independently verified.
- Inference and recommendation remain explicitly non-source facts.
- An active obligation needs source linkage and plugin-verified exact current-user confirmation.
- A correction affects only its derived scope and does not tombstone unrelated claim keys.
- A decision workbench may expose missing information; it may not synthesize numeric precision.
- Docs/helpers alone do not make a row green; the default loaded product path must use the feature.

## 13. Safety and external-action policy

- Internal reads/writes are allowed only inside existing signed-principal, write-token, and safe-mode boundaries.
- No send, email, post, schedule, device action, deployment outside the approved Cortex/OpenClaw release, or user-visible external mutation.
- Execute mode does not weaken permission or attachment boundaries.
- Attention entries never trigger external actions.
- No secret values enter artifacts or logs.
- No credential, model, OAuth, reasoning-level, or safety-mode config changes.
- Rollback: restore prior release/plugin paths through the existing release/config mechanism; database schema is additive and old code ignores new tables.

## 14. Artifacts and replay

Canonical project root:

```text
/root/clawd/_worktrees/oracle-expiring-oauth-20261026/cortex-daily-work-core-20261029
```

Replay/inspection:

```bash
cat cortex-daily-work-core-20261029/surface-matrix.json
cat cortex-daily-work-core-20261029/artifacts/integrated-smoke.json
openclaw plugins inspect cortex-route-gate --runtime --json
readlink -f /opt/cortex/current
```

## 15. Stop condition

`five_surface_matrix_green_or_exact_blocker`

Completion requires all five matrix rows:

- implementation status `complete`,
- focused smoke assertion green,
- default product integration observed,
- deployment state recorded,
- no unresolved blocker.

If deployment or remote persistence cannot be completed safely, stop with the exact blocker, staged commit, and next command/owner action. Do not downgrade to a plan-only result.

## 16. Truth boundary

Allowed after green verification: “The five bounded daily-work improvements are implemented and active in the verified default Cortex/OpenClaw path for the tested workflow.”

Not allowed: “All Cortex answers are now correct,” “every unsupported claim is impossible,” “all obligations are automatically discovered,” or any universal efficacy/completion claim.

## 17. Risks and mitigations

- **False evidence classification** — classify structured failure envelopes plus empty results conservatively; fail closed only for verification language/consequential evidence claims.
- **Over-routing rewrites** — mode detection prioritizes explicit rewrite language and skips optional deep consultation while preserving mandatory safety levels.
- **Globalized corrections** — derive scope from the prior task and use scope-specific claim keys/tags.
- **Speculative obligations** — candidate by default; exact current-user quote required for activation.
- **Cross-principal leakage** — server derives a principal key from authenticated transport identity; caller cannot choose it, and attention rows are filtered by that key.
- **Invented decision precision** — reject numeric score/rank fields and expose unknowns instead.
- **Release drift** — edit only the clean matching source worktree, compare loaded plugin hashes, and deploy through immutable release controls.

## 18. Estimates and open decisions

Rough estimate for this bounded implementation:

- Grounding/plan/prior art: 20–35 minutes, low compute.
- Product edits: 75–140 minutes, local CPU/text editing only.
- Single integrated smoke and fixes: 25–60 minutes, local CPU only.
- Commit/push/deploy/live verification: 20–45 minutes, no worker farm.

Open decisions before code: none. The user approved all five; the active source and parity-for-scope boundary are now bound. Any new credential/safety/prompt-policy change would be out of scope and require a blocker or separate owner flow.

## 19. Immediate next milestone

Implement the server-side everyday extensions and route-gate/memory-bridge integration, then run the single integrated smoke.
