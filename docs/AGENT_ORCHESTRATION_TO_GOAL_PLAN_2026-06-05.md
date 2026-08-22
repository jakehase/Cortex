# Agent orchestration plan to reach the real goal — 2026-06-05

## Executive summary

The goal is not “finish Mailchimp” as an end in itself.

The goal is to build and prove a shared agent-orchestration system that can take a large product objective, decompose it into executable work, keep many agents doing fresh useful work for hours on a remote execution plane, land only verified real product progress, replan when blocked, and stop only on honest green or a real blocker.

Mailchimp remains the primary proving ground because it is large, messy, easy to overclaim, and large enough to stress planning, assignment, verification, merge, truth reporting, and long-duration autonomy. But success must generalize beyond Mailchimp.

## Current truth baseline

### Proven

1. **Generated/isolated 100-agent orchestration is proven.**
   - Hardened Tier3 benchmark passed at 100 agents for ~256 minutes.
   - 800/800 generated shards merged.
   - Peak concurrency 100.
   - Claim ledger green, no counterclaims.
   - Boundary: generated/isolated Mailchimp-grade planner workload, not arbitrary real repo product work.

2. **Hetzner is now the preferred execution plane.**
   - Remote execution plane has been installed and smoke-verified.
   - 100-agent 30-minute Tier1 semantic-product-architecture smoke passed on Hetzner.
   - Boundary: generated/isolated semantic-product benchmark, not real Mailchimp product parity.

3. **Truth gates are much stronger than before.**
   - Fake-green handling has improved.
   - Strict full-clone blockers no longer automatically trigger more top-level iterations.
   - Run-state and continuation decisions have explicit claim-blocked/objective-expansion handling.
   - Mailchimp inventory/preflight can now separate mechanical green, threshold pass, scoped parity, and full-clone truth.

4. **Current Mailchimp parity accounting moved forward, but only within a scoped proof boundary.**
   - Latest audience/CRM tranche artifact: `/root/clawd/large-project-capability-stack/artifacts/benchmarks/mailchimp_audience_crm_tranche/mailchimp_audience_crm_tranche-20260605T131714Z`.
   - Scoped tranche passed.
   - Strict global gap credits accepted: 5.
   - Strict global gaps remaining: 21.
   - Phase9 inventory after tranche: 23 green leaves / 40 red leaves.
   - Negative-space inventory after tranche: 23/28 open.
   - Boundary: this tranche mostly credited existing product-state proof. It did not strongly prove fresh autonomous product creation throughput.

### Not proven yet

1. 100 agents creating fresh, cohesive product code in a real repo for hours.
2. A generic orchestrator that can take an arbitrary large build request and automatically create the inventory, shards, verifiers, run plan, merge policy, and truthful completion state.
3. Mailchimp full-clone parity.
4. Transfer of the 100-agent long-run behavior to non-Mailchimp real workloads.
5. Final operator experience: one clear command/job producing durable progress, live truth, blocker reports, and resumable continuation.

## North-star goal

A user can ask for a large product build or clone, such as “build a Photoshop-like editor” or “clone this SaaS product,” and the orchestration system can:

1. infer or build a surface inventory,
2. classify work into independent executable shards,
3. assign many agents without fake parallelism,
4. run on a remote execution plane,
5. make real product-code changes,
6. verify them with relevant functional, integration, browser, API, DB, security, and analytics checks,
7. merge only admitted work,
8. replan from remaining objective surface rather than exhausting a fixed checklist,
9. keep going for hours with low idle time,
10. report truth without collapsing scoped green into full completion,
11. stop only when the requested objective is genuinely green or blocked by a real documented blocker.

## Definition of “done” for the orchestration project

The project should not be considered complete until all of the following are artifact-proven:

### A. Real-repo 100-agent long-run pass

- Real repo, not generated-only workload.
- 100 requested agents.
- Peak concurrency at least 90, target 100.
- Duration at least 4 hours for primary qualification; 8 hours for soak.
- Multiple waves or continuous replenishment.
- Fresh product diffs landed in canonical or admitted isolated worktree.
- At least 70% productive iteration rate.
- No-op rate at most 10%.
- Verification integrity at least 95%.
- Truth contradictions exactly 0.
- Median time to next meaningful accepted progress at most 20 minutes.
- No fake-green incidents.

### B. Real product-output quality gate

- Product diffs are not marker-only, syntax-only, repeated generated fluff, or duplicate bulk.
- Diffs touch the product surfaces required by the objective.
- Surviving diffs are measured from run baseline, not cumulative stale dirty state.
- Product changes pass targeted relevant verifiers.
- At least 4 distinct agents land accepted counted product work in the proof run; target many more for 100-agent runs.
- Work spans multiple product lanes, not a single file hotspot.

### C. Dynamic objective expansion

- The planner does not stop just because a finite static queue is exhausted while the broader objective remains red.
- Negative-space detection can create new executable work units.
- Unknown surfaces remain red until proved.
- Claim blockers do not become continuation fuel unless there is executable expansion work.

### D. Transfer proof

- At least one non-Mailchimp real repo benchmark passes adjacent to the Mailchimp proof window.
- The transfer benchmark must require real repo-specific product or architecture work, not Mailchimp-specific IDs.
- Transfer score target: at least 0.70.

### E. Operator-grade run UX

- One durable job contract per run.
- Clear artifact root and run id before launch.
- Live state: running/blocked/green/contradictory.
- Resumable continuation from artifact state.
- Honest notification/status summary.
- No need for project-specific patch-chasing to keep the system alive.

## Strategy

Use a ladder, not another giant final-boss leap.

The generated 100-agent benchmark already proves the execution engine can hit scale under controlled conditions. The missing proof is real-repo productive autonomy. The plan therefore moves from controlled/generated to real-repo scoped work, then to broader continuous real-workload runs, then to transfer and final long soaks.

## Phase 0 — Freeze the truth contract

### Objective
Make the success criteria impossible to blur.

### Work

1. Create a single `orchestration_goal_contract.json` describing:
   - north-star goal,
   - benchmark tiers,
   - counted product work rules,
   - excluded work rules,
   - stop conditions,
   - go/no-go thresholds,
   - artifact schema.

2. Make every serious run write:
   - `run_contract.json`,
   - `execution_boundary.json`,
   - `surface_matrix.json`,
   - `worker_events.json`,
   - `patch_queue.json`,
   - `loc_accounting.json`,
   - `claim_ledger.json`,
   - `truth_conflicts.json`,
   - `completion_summary.json`,
   - `threshold_evaluation.json`,
   - `blocker_report.json` when red.

3. Add a scoreboard row generator that refuses to mark pass unless `thresholdPass=true` and truth contradictions are 0.

### Exit criteria

- Contract checked into shared stack.
- Local tests prove fake-green, proof-only, docs-only, empty-diff, stale-baseline, and contradictory-state cases are rejected.

## Phase 1 — Rebase execution on Hetzner as the real execution plane

### Objective
Stop mixing control-plane and execution-plane responsibilities.

### Work

1. Treat this Docker/OpenClaw host as control plane only.
2. Treat Hetzner as the default heavy execution plane.
3. For every run, hash-prove:
   - orchestrator code,
   - benchmark runner code,
   - target repo baseline,
   - selected verifier scripts.
4. Run every serious benchmark in an isolated execution worktree/copy.
5. Promote changes only through admitted patch ledger, not dirty remote state.
6. Capture resource telemetry:
   - CPU/load,
   - memory,
   - disk/inodes,
   - fd/process limits,
   - worker spawn failures,
   - peak concurrency,
   - idle gaps.

### Exit criteria

- Hetzner 32/64/100 short scale smokes are reproducible from one command.
- A 100-agent 30-minute Tier1 smoke remains green after latest code sync.
- Artifact sync proof local ↔ remote is automatic.

## Phase 2 — Build the first decisive real-workload tranche

### Objective
Stop proof-only accounting and test the missing capability: fresh product creation in a real repo.

### Recommended first tranche

Mailchimp campaign/email-builder production slice.

Why this tranche:

- It is central to Mailchimp’s product identity.
- It has high overlap with remaining phase9 and negative-space gaps.
- It exercises UI routes, campaign domain state, template/content blocks, sending lifecycle, reporting hooks, jobs, analytics, and persistence.
- It is large enough for multiple agents but bounded enough to audit.

### Minimum contract

- Fidelity: `parity_for_scope`.
- Execution boundary: Hetzner.
- Agents: start 10–20 for the decisive real-code proof.
- Duration: 2 hours unless hard blocker appears.
- Required fresh product diffs: yes.
- Proof-only credit: forbidden for the throughput decision.
- Required lanes: at least 3 of:
  - campaign index/manager,
  - campaign wizard,
  - email builder,
  - template library,
  - audience/segment targeting,
  - sending/scheduling,
  - analytics/reporting,
  - jobs/persistence.

### Required gates

- At least 10 executable product shards before launch.
- Each shard names allowed product files and verifier commands.
- No docs/tests/scripts-only credit.
- Product diff must be measured from clean run baseline.
- Accepted work must land in product files under `packages/app/`, `apps/web/`, or other explicitly declared product paths.
- Targeted tests must be non-skipped and relevant.
- Browser/API/DB/job proof should be used where the surface requires it.

### Pass threshold for this tranche

- Autonomy: at least 120 minutes unless all scoped work genuinely completes earlier and no broader-goal claim is made.
- Surviving product changed lines: at least 150 adds+dels, with semantic duplicate guard.
- Product files touched: at least 8.
- Distinct product lanes: at least 3.
- Distinct contributing agents with accepted product work: at least 4.
- Verification integrity: at least 0.95.
- No-op rate: at most 0.20.
- Truth contradictions: 0.

### Exit criteria

- If green: continue to Phase 3.
- If red but honest: classify blocker and repair exactly that subsystem.
- If fake-green/truth contradiction: stop all relaunches and repair truth stack first.

## Phase 3 — Repair the real-workload loop based on tranche results

### Objective
Make the system good at turning open objective surface into fresh admitted product work.

### Likely subsystems

1. **Surface inventory builder**
   - Convert objective → surfaces → leaf work units.
   - Include unknown/negative-space surfaces.
   - Produce executable product shards, not just proof labels.

2. **Shard planner**
   - Balance file areas and lanes.
   - Avoid fake parallelism where many agents contend for one file.
   - Ensure every shard has an implementation target, verifier target, and merge admission rule.

3. **Worker context packs**
   - Include exact anchor, target path, fidelity, allowed files, test commands, proof requirements, and stop condition.
   - Avoid letting workers solve the wrong problem or produce generic scaffolding.

4. **Verifier/admission stack**
   - Reject marker-only/source-syntax-only/duplicate-bulk changes.
   - Require runtime-relevant product evidence.
   - Require targeted tests or browser/API/DB/job proof appropriate to surface type.

5. **Merge/reconciliation**
   - Merge from admitted patch ledger only.
   - Keep selected-tier and cumulative dirty overlay separate.
   - Preserve rejected/dirty overlays non-destructively but never count them as landed.

6. **Continuation/replanning**
   - If work queue empties while objective remains red, trigger objective expansion.
   - If expansion produces no executable product work, stop with `objective_expansion_missing_executable_work`.
   - If blocker repeats without new evidence, stop and repair rather than loop.

### Exit criteria

- Repeat the campaign/email-builder tranche or an equivalent real-workload tranche and pass the Phase 2 threshold.

## Phase 4 — Scale real-workload proof ladder

### Objective
Move from scoped real-code proof to 100-agent real-repo long-run proof without losing honesty.

### Rung 4.1 — 20-agent real-workload endurance

- Repo: Mailchimp clone.
- Agents: 20.
- Duration: 2 hours.
- Scope: campaign/email-builder plus adjacent surfaces.
- Pass: Phase 2 thresholds, with peak concurrency >=20.

### Rung 4.2 — 40-agent real-workload endurance

- Repo: Mailchimp clone.
- Agents: 40.
- Duration: 2–3 hours.
- Scope: at least 40 executable product shards across 5+ lanes.
- Added gate: median time to next meaningful progress <=15 minutes.

### Rung 4.3 — 75-agent real-workload Tier3

- Repo: Mailchimp clone.
- Agents: 75.
- Duration: 4 hours.
- Scope: broad production slice, not strict full-clone claim.
- Required: continuous replenishment from remaining inventory.
- Pass: Tier3 thresholds, no truth contradictions.

### Rung 4.4 — 100-agent real-workload Tier3

- Repo: Mailchimp clone.
- Agents: 100.
- Duration: 4 hours.
- Required peak concurrency: target 100, minimum 90 unless contract explicitly allows shortfall.
- Required productive work: multi-lane, multi-agent, fresh product diffs, admitted through claim ledger.
- Pass: Tier3 thresholds.

### Rung 4.5 — 100-agent 8-hour soak

- Same as Rung 4.4, but 8 hours.
- Goal: prove stability, not just one 4-hour pass.
- Must survive replanning, blocker handling, artifact sync, and notification/reporting.

## Phase 5 — Transfer/generalization proof

### Objective
Prove this is not Mailchimp-specific scaffolding.

### Benchmarks

1. PMHNP or another brownfield app repo:
   - real feature/bugfix/refactor surfaces,
   - repo-native tests,
   - product diff required,
   - 10–25 agents depending on surface count.

2. Shared stack/control-plane repo:
   - architecture/refactor/incident repair surfaces,
   - tests and contract proofs,
   - no Mailchimp IDs.

### Pass criteria

- Transfer score >=0.70.
- No Mailchimp-specific focus IDs required.
- Planner can discover or ingest repo-specific surfaces.
- Verifier/admission rules adapt to the repo’s actual shape.

### Exit criteria

- One Mailchimp real-workload Tier3 pass and one adjacent transfer pass.

## Phase 6 — Full-clone / broad-objective mode

### Objective
Only after real-workload orchestration is proven, return to full-clone/broad-objective completion.

### Work

1. Treat full clone as parity-first, not MVP-first.
2. Maintain a living surface matrix:
   - official-source positive surfaces,
   - negative-space surfaces,
   - unknown surfaces,
   - parity evidence per surface,
   - targeted tests/proofs per surface.
3. Require objective expansion when the matrix is red and no work remains.
4. Allow completion only when:
   - strict global gaps are 0,
   - phase9 leaves are all green,
   - negative-space candidates are closed or explicitly non-applicable with proof,
   - browser/API/DB/job/security/analytics proof exists where relevant,
   - full-clone supervisor is green.

### Current Mailchimp starting point after latest tranche

- Strict remaining: 21.
- Phase9 red leaves: 40.
- Negative-space open: 23/28.
- Global full-clone pass: false.

### Exit criteria

- Mailchimp full clone may be claimed only with explicit parity proof and all matrices green.
- Until then, report scoped passes as scoped passes only.

## Phase 7 — Productize orchestration UX

### Objective
Turn the proven benchmark machinery into a usable durable orchestration product.

### Required operator commands / flows

1. `plan objective`
   - Creates objective inventory and executable work graph.

2. `launch run`
   - Binds run id, artifact root, execution boundary, and contract.

3. `status`
   - Shows live state, truth layers, current blockers, productivity, agent utilization, and next planned work.

4. `resume`
   - Continues from artifact state only if continuation gate allows it.

5. `audit`
   - Checks for fake-green, stale baseline, dirty overlay, missing artifacts, LOC/accounting mismatch, and truth contradictions.

6. `report`
   - Produces a human-safe summary with exact boundaries.

### UX pass criteria

- A future large objective should not require a Mailchimp-specific custom script for every recovery.
- The shared runtime should handle run-state, continuation, objective expansion, truth reporting, and artifact contracts by default.

## Immediate next actions

### 1. Write the goal contract

Create a checked-in contract file in the shared stack for the north-star orchestration goal and run thresholds.

Expected output:
- `docs/AGENT_ORCHESTRATION_GOAL_CONTRACT_2026-06-05.md` or JSON equivalent.
- Tests for truth-layer rejection cases.

### 2. Build the campaign/email-builder real-workload tranche contract

Expected output:
- Run contract for Hetzner.
- Surface matrix with at least 10 executable product shards.
- Allowed files and verifier commands for each shard.
- Prelaunch clean-baseline/hash proof.

### 3. Launch only if the work graph is executable

Prelaunch must fail if the graph is proof-only, docs-only, tests-only, or less than 10 product shards.

### 4. Evaluate the tranche as a decision gate

If it passes, scale up.
If it fails honestly, repair the blocker.
If it fake-greens, stop and repair truth.

### 5. Update the orchestration scoreboard

Add a single current-state row with:

- generated 100-agent Tier3 proof: pass,
- Hetzner 100-agent Tier1 proof: pass,
- real-repo 100-agent product creation: not yet proven,
- Mailchimp full-clone parity: red,
- current next gate: campaign/email-builder real-workload tranche.

## Key risks and mitigations

### Risk: proof-only progress masquerades as product creation

Mitigation:
- Throughput gates must require fresh product diffs from run baseline.
- Proof-only credit can reduce parity accounting but cannot count toward product-creation proof.

### Risk: dirty remote overlays contaminate metrics

Mitigation:
- Clean baseline or explicit admitted ledger before launch.
- Surviving product diff from run baseline only.
- Preserve dirty overlays separately; never silently count them.

### Risk: fake parallelism at high agent count

Mitigation:
- Require peak concurrency and unique-agent evidence.
- Require enough low-overlap executable surfaces before launch.
- Balance file areas and lanes.

### Risk: finite inventory ceiling

Mitigation:
- Objective expansion is mandatory when the matrix is red and queue is exhausted.
- Negative-space surfaces stay red until proved.

### Risk: overfitting to Mailchimp

Mitigation:
- Adjacent transfer benchmark required for final capability claim.
- Shared runtime owns orchestration behaviors; Mailchimp is only a proving-ground adapter.

### Risk: heavy runs overload the control plane

Mitigation:
- Hetzner only for heavy execution.
- Local control plane only launches, watches, syncs, audits, and reports.

## Decision gates

### Continue / scale up

Allowed when a run is:

- thresholdPass=true,
- truth contradictions=0,
- fresh product diff gates satisfied,
- verifier integrity satisfied,
- resource/execution boundary clean,
- no fake-green or stale-baseline issues.

### Repair before relaunch

Required when:

- no executable work graph,
- product diff missing/trivial,
- no-op or repeat-blocker rates too high,
- verifier evidence irrelevant/missing,
- dirty baseline or stale artifact root appears.

### Stop broad campaign and audit

Required when:

- fake-green appears,
- supervisor/status contradicts artifacts,
- heavy run starts on control plane accidentally,
- accepted progress is dominated by proof-only or marker-only work,
- the system loops after a terminal claim blocker.

## Recommended next concrete move

Do the campaign/email-builder tranche, but label it correctly:

> `mailchimp_campaign_email_builder_real_workload_tranche`

This should be the first decisive post-truth-hardening test of the missing capability: fresh, multi-agent, real product creation on a real repo.

If that tranche cannot produce real product deltas under the gates above, then the next work is not more Mailchimp parity accounting; it is repairing planner/worker/admission/merge so agents can actually create product code continuously.
