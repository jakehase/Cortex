# Mailchimp 100-agent full audit — 2026-04-06

## Reply anchor
Jake requested a full audit of the 100-agent orchestration, architecture, and setup for the Mailchimp 1:1 parity campaign, with no more bandaid patches.

## Scope
- Control plane on CT101
- Execution plane on VM102
- 100-agent worker farm stability
- Implementation-lane behavior
- Supervisor / notifier / artifact truth
- Remote baseline integrity
- Sync-back and scoring path

## Executive status

### What is proven
- The 100-agent execution path is stable on VM102.
- Repeated qualification soak passed 12/12 rounds green.
- CT101 no longer runs heavy worker farms locally.
- CT101 no longer runs duplicate local Cortex; VM102 is the active Cortex host.

### What is not proven
- Mailchimp full 1:1 parity is not achieved.
- One-shot continuous 100-agent project execution from clean baseline to parity is not ready.

### Current audit conclusion
The system is ready for **100-agent qualification** but not yet ready for **100-agent one-shot implementation to parity**.

The blocker is no longer compute capacity. The blocker is the implementation architecture and truth/reporting chain.

## Observed architecture

### Control plane (CT101)
Responsibilities currently implemented:
- gateway
- supervisor
- notifier
- artifact consumer
- top-level persistent parity runner

### Execution plane (VM102)
Responsibilities currently implemented:
- heavy worker farm
- repo-scale qualification
- browser validation
- Mailchimp implementation lane

### Policy state
`mailchimp-clone/execution-boundary-policy.json` is correctly enforcing remote heavy execution on VM102.

## Proven-good area: worker-farm stability
Observed facts:
- 12/12 soak rounds passed on VM102
- rounds ended with `supervisorStatus=green`, `matrixStatus=all_complete`, `highestPassingTier=100`
- this proves the 100-agent qualification path is stable

Conclusion:
- worker-farm instability is no longer the primary blocker

## Failure chain for the parity campaign

### 1. Implementation lane initially not active
Observed facts:
- VM102 live logs originally showed verification-only runtime shards rather than parity-focus shards
- the remote runner was not inheriting `ORCHESTRATOR_IMPLEMENTATION_PROFILE=mailchimp_parity_focus`
- implementation script path was not being carried into the remote runner

Impact:
- the first parity campaign iterations were effectively qualification-only, not true implementation

### 2. Remote git hygiene was missing
Observed facts:
- VM102 Mailchimp repo initially lacked a `.git` worktree
- implementation mode refused to run without a clean git workspace

Impact:
- implementation mode failed before doing useful work

### 3. Remote baseline integrity drifted repeatedly
Observed facts:
- browser realism repeatedly failed on VM102 because `apps/web/public/app-shell.css` drifted away from the known-good browser-safe baseline
- the implementation worker itself also rewrote that CSS incorrectly at one point, reintroducing the dirty-baseline loop

Impact:
- implementation mode frequently failed preflight or browser baseline before reaching meaningful product work

### 4. Local/remote scoring mismatch
Observed facts:
- CT101 top-level supervisor originally scored the local repo while implementation happened only on VM102
- a sync-back step was added later so CT101 could grade the files VM102 actually changed

Impact:
- early parity loops could not converge because the top-level supervisor was grading the wrong tree

### 5. Stale artifact / stale notifier truth
Observed facts:
- VM102 tier trace showed red tier-8 implementation failures while notifier artifacts still claimed green tier-100 qualification success
- qualification artifacts and implementation artifacts share the same `orchestrator_real_repo_clean_baseline` root

Impact:
- stale green qualification state can coexist with fresh red implementation state
- wrappers and notifier consumers can misread mixed-state artifacts

### 6. Implementation generator faults
Observed facts:
Real generator bugs already found:
- persistence generator rewrote legacy fallback from `app.json` to `workspace-state.json`
- security generator emitted `persistState(state)` while importing `persistState as saveDb`
- implementation worker rewrote builder CSS without `pointer-events: none`

Impact:
- tier-8 implementation fails before qualification can continue
- these are generator-level defects, not just one-off repo defects

### 7. Tier-8 failure anchor
Observed facts from VM102 live trace:
- failed shard: `focus.persistence`
- stage: `tier_repo_tests_start`
- `liveRunOk=false`
- `liveRunSupervisorStatus=red`
- state-loss and continuity failures spike immediately after implementation attempts

Impact:
- implementation lane is not robust enough yet for one-shot parity runs

## Root cause summary

### Primary root causes
1. **Qualification architecture was stabilized before implementation architecture was made trustworthy.**
2. **Implementation generator still emits unsafe code transformations.**
3. **Qualification and implementation share artifact roots, enabling stale-truth collisions.**
4. **Remote baseline is mutable and long-lived instead of disposable per run.**
5. **Top-level scoring still depends on artifact mirroring and sync timing rather than a single canonical result source.**

### Not primary root causes anymore
- RAM on CT101
- worker-farm concurrency instability on VM102
- local Cortex duplication

Those were real problems earlier, but they are not the main blocker now.

## What must be true before one-shot 100-agent parity runs are ready

### Hard requirements
1. **Separate qualification and implementation artifact roots**
   - do not reuse `orchestrator_real_repo_clean_baseline` for both
   - each run needs a unique run id / artifact root

2. **Run implementation in disposable git snapshots/worktrees on VM102**
   - never mutate the long-lived baseline repo directly
   - start each iteration from a known commit/worktree snapshot
   - promote only validated changes back to a canonical branch/worktree

3. **Implementation generator must pass its own qualification suite**
   - generator-level regression suite required for:
     - persistence transforms
     - security transforms
     - builder CSS / browser realism
     - integration parity transforms
     - reporting/predictive transforms

4. **Single canonical truth source per run**
   - one run id
   - one status root
   - notifier must only read current-run artifacts
   - stale green qualification summaries must not be visible to implementation runs

5. **Top-level supervisor must grade canonical remote outputs**
   - not heuristic local scans first
   - not mixed old/new artifacts
   - prefer canonical remote run summary or synced patch application with run id verification

6. **Dirty-worktree preflight must operate on disposable worktrees**
   - keep the safety guard
   - but stop using a mutable long-lived baseline repo as the implementation target

7. **Implementation-lane shard selection must be explicit and auditable**
   - each run should record whether parity-focus shards were actually launched
   - if a run falls back to verification-only shards, that must be fatal and explicit

8. **Fail-stop on stale notifier truth**
   - if current tier trace is red and notifier is green for the same artifact root, mark the run invalid and block delivery

## Recommended next program, not patches

### Phase A — architecture hardening for implementation mode
- create a dedicated VM102 implementation runner using disposable worktrees
- unique artifact root per run
- run-id stamped summaries and notifier inputs

### Phase B — generator qualification suite
Build a dedicated suite for `orchestrator-real-repo-clean-implement.mjs` covering:
- persistence transforms
- security transforms
- website/builder transforms
- integration transforms
- growth/forms transforms
- experiment/reporting transforms

### Phase C — canonical result contract
- current run id propagated end-to-end
- control-plane supervisor/notifier only accept matching run id
- stale artifacts ignored by default

### Phase D — restart parity campaign only after A/B/C
Do not continue patch-chasing individual parity shard failures in the current architecture.

## Honest readiness statement
As of this audit:
- **100-agent qualification:** ready
- **100-agent continuous qualification:** ready
- **100-agent one-shot project implementation to parity:** **not ready**

The gap is not raw compute anymore. The gap is implementation-run architecture, generator reliability, and truth-path integrity.
