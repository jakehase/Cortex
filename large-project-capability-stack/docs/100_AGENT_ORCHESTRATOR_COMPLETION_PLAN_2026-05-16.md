# 100-Agent Orchestrator Completion Plan — 2026-05-16

## Goal

Build a shared orchestration system that can take a large product objective, decompose it into grounded product work, keep up to 100 agents productively occupied for long runs, land real verified product-code changes, and stop only on honest completion or a real blocker.

The goal is **not** to prove that Mailchimp is cloned. Mailchimp is a proving-ground workload. The product is the orchestrator/control plane.

## Current truth baseline

Already proven:

- 100-agent Mailchimp production-slice product-diff benchmark passed for 30 minutes: `100/100` merged, peak concurrency `100`.
- 100-agent semantic product-architecture benchmark passed for 30 minutes: `100/100` merged.
- Continuous planner proof passed with replenishment: two waves, `200/200` merged, peak concurrency `100`.
- Integration/functional/realism gates passed in generated isolated Mailchimp-grade benchmark repos.
- Shared campaign runtime refactor exists: Mailchimp is less of the owner of orchestration semantics.
- Proof-carrying claim ledger / adversarial verifier slice exists on VM102 with passing tests, but is not yet promoted cleanly into the canonical shared stack.

Not yet proven:

- Multi-hour 100-agent canonical real-app throughput with real product changes landed in the main product repo.
- Generic objective-to-surface decomposition for arbitrary large apps without project-specific scaffolding.
- Fully integrated proof-carrying claims, adversarial verification, and survival/counterclaim ledgers in the main run loop.
- Clean one-command operator experience with reliable remote execution, notifier, resume, and artifact truth.
- Full Mailchimp 1:1 parity. That is explicitly a separate product-parity claim, not the orchestrator completion bar.

## Completion definition

The orchestrator is “done enough” when it can pass this final gate:

1. **Generic input**: given a large product objective and a repo, it builds a surface inventory and work plan without a hand-written Mailchimp-only backlog.
2. **Scale**: runs up to 100 agents on VM102 or another execution plane with observed peak concurrency near the requested tier, not just requested concurrency.
3. **Duration**: sustains productive execution for at least 4 hours for the main qualification gate, with an 8-hour soak as the final confidence run.
4. **Real product work**: lands non-trivial product-code deltas in canonical repo paths, with unique-landed-diff accounting and no marker/source-syntax-only credit.
5. **Claim integrity**: every merge credit has proof-carrying claims, adversarial challenge results, and verifier evidence.
6. **Continuity**: planner replenishes work dynamically when queues drain; no dead gaps unless true completion or a blocker exists.
7. **Truth**: artifacts distinguish mechanical green, scale proof, threshold pass, product parity, and claim blockers.
8. **Recovery**: if workers, runners, sync, or remote execution die, terminal state is written and the run is resumable or honestly blocked.
9. **Portability**: the same shared runner can execute at least one non-Mailchimp brownfield transfer benchmark with minimal adapter code.
10. **Operator UX**: one command launches, monitors, syncs artifacts, and reports a concise pass/blocker summary.

## Phase 0 — Freeze the target and clean the battlefield

Purpose: prevent another month of benchmark drift, fake-green ambiguity, and path confusion.

Steps:

1. Create a canonical run contract schema for orchestrator qualification:
   - objective
   - target repo
   - fidelity: `production_slice`, `parity_for_scope`, or `full_clone`
   - requested agent tier
   - duration target
   - required product paths
   - proof requirements
   - stop condition: `threshold_pass_or_blocker_report`
2. Create a canonical artifact register:
   - `run_contract.json`
   - `surface_inventory.json`
   - `surface_matrix.json`
   - `claim_ledger.json`
   - `patch_queue.json`
   - `landing_evidence.json`
   - `worker_events.json`
   - `supervisor_snapshot.json`
   - `threshold_evaluation.json`
   - `completion_summary.json`
   - `blocker_report.json`, if blocked
3. Mark stale benchmark paths as historical and prevent new work from reading them as current truth.
4. Add a prelaunch check that fails if the target repo has dirty/unclassified product state.
5. Document the final qualification ladder in one canonical file.

Exit criteria:

- A new run cannot start without a contract, artifact root, baseline hash, and explicit fidelity.
- Reporting cannot call a run complete without a threshold evaluation.

## Phase 1 — Promote proof-carrying claim ledger into the canonical shared stack

Purpose: make merge credit depend on evidence, not just worker success messages.

Steps:

1. Promote VM102 proof-carrying claim ledger work into the canonical shared repo path.
2. Add stable APIs:
   - `createPatchClaim()`
   - `attachVerifierProof()`
   - `createAdversarialChallenge()`
   - `recordChallengeOutcome()`
   - `aggregateClaimLedger()`
   - `deriveMergeEligibility()`
3. Wire claim ledger into `processPatchQueue` so a patch cannot receive merge credit unless claims survive policy.
4. Add policy modes:
   - `off`
   - `audit_only`
   - `block_on_failed_claim`
   - `require_adversarial_survival`
5. Update supervisor snapshots to expose:
   - claim count
   - survived claims
   - challenged claims
   - failed claims
   - counterclaims
   - claim-integrity score
6. Add tests for:
   - happy-path surviving claim
   - failed proof blocks merge
   - adversarial counterclaim blocks merge
   - audit-only records but does not block
   - summary aggregation is stable

Exit criteria:

- Full shared-stack test suite passes.
- A benchmark can run with claim policy enabled and show claim-ledger output in the artifact root.

## Phase 2 — Build generic objective-to-surface decomposition

Purpose: stop relying on handcrafted Mailchimp backlog files.

Steps:

1. Implement a repo survey tool that inventories:
   - apps
   - packages
   - routes
   - APIs
   - storage models
   - job/event systems
   - integration seams
   - tests
   - docs/spec hints
2. Implement a negative-space inventory:
   - likely missing product surfaces
   - weakly implemented surfaces
   - synthetic/local-only surfaces
   - no-op or placeholder-heavy areas
3. Convert the survey into a surface graph:
   - surface id
   - product area
   - target files
   - allowed file ownership
   - verifier type
   - collision risk
   - dependency edges
4. Add dynamic expansion rules:
   - if matrix is green but objective remains unsatisfied, expand from the objective
   - if queue is empty and parity/product goal is red, produce blocker or new surfaces
   - never treat finite backlog exhaustion as completion by itself
5. Add surface quality scoring:
   - real runtime path?
   - testable behavior?
   - user-visible or system-visible impact?
   - enough file independence for parallel work?

Exit criteria:

- Given a repo and a product objective, the planner creates a surface matrix without hand-editing.
- It can produce at least 100 low-overlap candidate surfaces for a Mailchimp-scale repo or honestly report why not.

## Phase 3 — Define the real product-work protocol

Purpose: make worker outputs cohesive architecture work, not marker patches or source-syntax churn.

Steps:

1. Define the worker output contract:
   - objective slice
   - touched product files
   - implementation diff
   - runtime behavior proof
   - verifier commands
   - claim bundle
   - rollback notes
2. Ban merge credit for:
   - marker-only changes
   - source/syntax-only changes when semantic mode is required
   - generated bulk without unique behavior
   - duplicate normalized line bloat
   - docs/tests-only changes unless the surface is explicitly docs/tests
3. Require each product patch to map to at least one runtime behavior:
   - route/API response
   - state transition
   - storage read/write
   - job/event execution
   - integration contract
   - UI interaction proof
4. Add implementation templates for common product lanes:
   - UI route/workflow
   - API/domain service
   - storage/migration
   - job/event
   - analytics/reporting
   - integration provider
   - auth/security
5. Add verifier pairing rules so every surface has a verifier type before workers start.

Exit criteria:

- Product patches are accepted only when they include concrete runtime delta and proof.
- Rejected patches explain exactly which semantic/product rule failed.

## Phase 4 — Harden scheduler, leases, and concurrency balancing

Purpose: make requested 100-agent runs actually use 100 agents productively.

Steps:

1. Add a scheduler model that tracks:
   - file-area ownership
   - lane balance
   - dependency readiness
   - verifier cost
   - worker runtime estimates
   - collision risk
2. Implement lease fairness:
   - no single lane monopolizes the farm
   - stale leases expire safely
   - repeated failed surfaces are cooled down or escalated
3. Add observed-concurrency truth:
   - unique agents spawned
   - peak concurrent workers
   - active worker-minutes
   - idle gaps
   - time-to-next-assignment
4. Add anti-fake-scale gate:
   - requested tier is not proof
   - scale credit requires observed concurrency and productive merges
5. Add remote execution boundary checks:
   - heavy worker farm runs only on VM102/execution plane
   - control plane only monitors, syncs, and notifies
6. Add graceful pressure controls:
   - CPU/memory cap awareness
   - backoff when VM102 is resource constrained
   - artifact sync decoupled from worker execution

Exit criteria:

- 100-agent run reports observed worker-minutes and idle gaps.
- If actual concurrency is low, the run blocks honestly instead of claiming scale.

## Phase 5 — Canonical landing and merge integrity

Purpose: ensure accepted patches actually land in the canonical checkout and survive.

Steps:

1. Before every run, record clean baseline:
   - git commit/hash
   - dirty status
   - tracked/untracked product paths
   - product LOC baseline
2. For every patch, record:
   - pre-apply hashes
   - post-apply hashes
   - applied/skipped/no-op status
   - canonical file paths changed
   - unique normalized added lines
   - duplicate line ratio
3. Reject merge credit when:
   - patch applied to artifact workspace but not canonical checkout
   - patch is skipped/no-op
   - touched files are outside allowed product paths
   - semantic bloat threshold fails
4. Add admitted-ledger-only promotion:
   - sync/promotion copies only admitted patches
   - cumulative dirty overlay cannot be counted as selected-tier progress
5. Add rollback/quarantine path for failed runs:
   - preserve remote dirty diff
   - label it unpromoted
   - never include it in next baseline unless deliberately admitted

Exit criteria:

- Completion summary reports selected-run landed product diff, not cumulative dirty state.
- A stale/dirty remote baseline cannot contaminate a new pass.

## Phase 6 — Supervisor truth and stop/continue semantics

Purpose: one authoritative answer for whether a run is active, complete, blocked, or soaking.

Steps:

1. Centralize run-state reducer in shared runtime:
   - local runner status
   - remote status
   - worker farm status
   - artifact sync status
   - supervisor status
   - terminalizer status
2. Add explicit terminal states:
   - `threshold_pass`
   - `blocked_retryable`
   - `blocked_terminal`
   - `claim_blocked`
   - `timeout_incomplete`
   - `operator_stopped`
   - `soaking_after_green`
3. Require terminal writes on signal/kill/failure.
4. Add continuation-decision helper:
   - may continue
   - must stop green
   - must stop blocked
   - must expand objective
   - must wait for remote
5. Add contradiction detector:
   - local says stopped while remote heartbeat is fresh
   - supervisor green but threshold red
   - matrix green but claim ledger failed
   - parity/full-clone claimed without parity evidence

Exit criteria:

- No run can remain indefinitely `running=true` after the process dies.
- Contradictions produce a blocker report, not a green summary.

## Phase 7 — Benchmark ladder to final proof

Purpose: earn trust in stages instead of jumping straight to final-boss runs.

### Rung A — Local deterministic unit/integration gate

- Scope: shared stack only.
- Agent count: simulated/deterministic.
- Duration: short.
- Required pass:
  - unit tests
  - claim ledger tests
  - scheduler tests
  - landing evidence tests
  - supervisor reducer tests

Exit: full local shared-stack suite green.

### Rung B — 10-agent real product-code run

- Target: PMHNP or another small brownfield repo.
- Agent count: 10.
- Duration: 60–120 minutes.
- Required:
  - real product diffs
  - claim ledger enabled
  - adversarial audit-only mode at minimum
  - no fake-scale
  - no dirty-baseline contamination

Exit: `thresholdPass=true`, `mechanicalGreen=true`, `scaleProofReady=true`, real landed product-code evidence.

### Rung C — 25-agent Mailchimp production-slice run

- Target: Mailchimp production slice, not full clone.
- Agent count: 25.
- Duration: 2 hours.
- Required:
  - dynamic surface expansion
  - runtime behavior proofs
  - claim ledger blocking mode
  - selected-run landed diff accounting
  - no truth conflicts

Exit: threshold pass plus product-diff and claim-integrity pass.

### Rung D — 50-agent Mailchimp production-slice run

- Agent count: 50.
- Duration: 2–4 hours.
- Required:
  - observed productive concurrency
  - replenishment waves
  - adversarial verifier challenge sampling
  - lane/file-area balancing

Exit: threshold pass; no dead-gap or fake-scale blocker.

### Rung E — 100-agent canonical real-app run

- Agent count: 100.
- Duration: 4 hours.
- Required:
  - 100 observed peak concurrency or honest near-tier threshold defined in contract
  - multiple replenishment waves
  - non-trivial unique landed product LOC
  - claim ledger survival
  - runtime proof classes green
  - no stale baseline/dirty overlay issue

Exit: this is the main “done enough” qualification if passed.

### Rung F — 8-hour soak

- Agent count: 100.
- Duration: 8 hours.
- Required:
  - no state loss
  - resumability proof
  - notifier proof
  - terminal summary proof
  - artifact sync proof

Exit: production-confidence run.

### Rung G — Brownfield transfer/generalization run

- Target: a different repo not used to tune the system.
- Agent count: scaled to honest surface count.
- Duration: 2–4 hours.
- Required:
  - generic survey creates surface matrix
  - minimal adapter code
  - real product diffs
  - claim ledger and landing evidence green

Exit: proves the orchestrator is not just Mailchimp-specific.

## Phase 8 — Operator experience

Purpose: make the system usable without bespoke babysitting.

Steps:

1. Add one launch command:
   - objective
   - repo path
   - fidelity
   - agent tier
   - duration
   - execution plane
2. Add one status command:
   - current phase
   - active workers
   - productivity rate
   - current blockers
   - artifact root
3. Add one stop command:
   - graceful stop
   - terminal state
   - partial artifact summary
4. Add notification hooks:
   - pass
   - blocker
   - crash/no heartbeat
   - human decision needed
5. Add summary renderer:
   - status
   - evidence
   - root cause/blocker
   - next action
   - exact artifact paths
6. Add resume support:
   - resume from last terminal/incomplete artifact root
   - preserve baseline truth
   - do not double-count previous work

Exit criteria:

- A long run can be launched, monitored, stopped, resumed, and audited from documented commands.

## Phase 9 — Documentation and handoff

Purpose: make future work not depend on chat memory.

Steps:

1. Write architecture docs:
   - control plane vs execution plane
   - scheduler
   - claim ledger
   - landing evidence
   - supervisor truth
   - benchmark ladder
2. Write operator runbooks:
   - launching a benchmark
   - interpreting artifacts
   - debugging blockers
   - remote execution recovery
3. Write honesty rules:
   - what counts as pass
   - what does not count
   - how to report product parity separately
4. Update project memory after each rung.

Exit criteria:

- A future agent can pick up the system from docs/artifacts, not from vague prior context.

## Suggested immediate execution order

1. **Promote the proof-carrying claim ledger from VM102 into canonical shared stack.**
2. **Wire claim ledger into patch admission and supervisor summaries.**
3. **Add canonical landing evidence and selected-run diff accounting everywhere.**
4. **Add generic objective-to-surface survey for one real repo.**
5. **Run a 10-agent claim-ledger product-code proof.**
6. **Run 25-agent and 50-agent Mailchimp production-slice proofs.**
7. **Run the 100-agent 4-hour canonical real-app proof.**
8. **Run the 100-agent 8-hour soak.**
9. **Run one non-Mailchimp brownfield transfer proof.**
10. **Cut a final orchestrator capability report with exact pass/fail evidence.**

## Main risks

1. **Counting generated benchmark artifacts as product work.**
   - Mitigation: canonical landing evidence and product-path gates.
2. **Mailchimp-specific scaffolding hiding lack of generality.**
   - Mitigation: brownfield transfer proof before final claim.
3. **Fake scale from requested tier rather than observed concurrency.**
   - Mitigation: observed worker-minutes and productive concurrency gates.
4. **No-op or semantic-bloat patches sneaking through.**
   - Mitigation: claim ledger, adversarial verifier, unique-line accounting, runtime proof.
5. **Remote/control-plane status split.**
   - Mitigation: shared run-state reducer and terminalizer.
6. **Execution-plane overload.**
   - Mitigation: VM102 execution boundary and resource-aware launch checks.

## Final report shape

When the final qualification is complete, report in this exact structure:

1. Status: pass or blocked.
2. Benchmark id and run id.
3. Artifact root.
4. Baseline and target repo hash.
5. Agent tier requested and observed.
6. Duration and worker-minutes.
7. Product surfaces completed.
8. Real landed product diff summary.
9. Claim-ledger/adversarial verification summary.
10. Runtime proof summary.
11. Truth conflicts: must be zero for pass.
12. Remaining blockers or next action.

## North-star sentence

A successful orchestrator is not one that launches 100 agents. It is one that keeps 100 agents doing useful, verified, landed product work for hours, knows when that is no longer happening, and tells the truth every time.
