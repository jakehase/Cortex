# Mailchimp 100-agent remediation plan — 2026-04-06

## Reply anchor
Jake asked to turn the full audit into an explicit remediation plan / architecture migration checklist.

## Objective grounding
- **Anchor:** Mailchimp 100-agent full audit and Jake's instruction to stop bandaid patches
- **Target path:** `/root/clawd/mailchimp-clone` and its VM102 execution-plane replica at `/home/jake/clawd-remote/mailchimp-clone`
- **Fidelity target:** `full_clone`
- **Current proven state:** 100-agent qualification is stable; one-shot implementation-to-parity is not ready
- **Implementation surface:** product code + runner architecture + truth/reporting path
- **Stop condition for this remediation program:** `parity_runner_architecture_ready_for_one_shot`

## Executive decision
Do **not** continue the current parity campaign architecture as-is.

Before attempting another one-shot 100-agent parity run, complete the remediation phases below.

## What "ready" means
The system is only considered ready for one-shot 100-agent project runs when all of these are true:

1. **Implementation runs use disposable git worktrees/snapshots on VM102**
2. **Qualification artifacts and implementation artifacts are isolated by run id**
3. **Notifier/supervisor only consume artifacts for the active run id**
4. **Implementation generator passes a dedicated regression suite**
5. **Top-level CT101 supervisor grades canonical remote outputs, not stale local heuristics**
6. **Remote baseline can be rebuilt and proven green deterministically before launch**
7. **Implementation-lane activation is explicit and mechanically verified**

## Remediation phases

### Phase 0 — freeze the current patch loop
Status: **done now**

### Progress checkpoint
Implemented architecture slice in this pass:
- run-id aware persistent parity runner on CT101
- run-id aware sync-back step on CT101
- run-id scoped delegate artifact roots in worker/supervisor
- disposable VM102 worktree remote runner
- run-id scoped remote artifact roots via `MAILCHIMP_ORCHESTRATOR_ARTIFACT_ROOT`
- deterministic VM102 baseline refresh script scaffold
- generator regression suite at `tests/implement-worker.regressions.test.mjs`
- top-level generator preflight gate in `scripts/full-audit-campaign-persistent-runner.mjs`

Still not implemented yet:
- none from the original critical list; remaining work is operational validation of the remediated path

Actions:
- stop the current parity runner on CT101
- stop remote implementation runners on VM102
- preserve current artifacts for audit reference
- do not relaunch the current architecture until Phase 1–4 are in place

Acceptance:
- no active parity runner left on CT101 or VM102
- current audit remains the source of truth for this failure class

### Phase 1 — create disposable implementation worktrees on VM102
Problem addressed:
- mutable long-lived repo on VM102 keeps getting dirty
- implementation mode preflight blocks or interacts badly with stale residue

Actions:
- create a dedicated VM102 runner that:
  - starts from a known baseline commit
  - creates a fresh disposable worktree per run/iteration
  - runs implementation only inside that disposable worktree
  - destroys or archives the worktree at the end
- baseline repo should remain read-only except for controlled baseline updates

Acceptance:
- each implementation run has a unique worktree path
- dirty-workspace preflight always runs against a fresh disposable worktree
- baseline repo remains clean after failed runs

Artifacts to add:
- `artifacts/full_audit_campaign/runs/<run_id>/worktree_manifest.json`
- `artifacts/full_audit_campaign/runs/<run_id>/baseline_commit.json`

### Phase 2 — separate qualification and implementation artifact roots
Problem addressed:
- stale green qualification artifacts are colliding with fresh red implementation artifacts
- notifier and supervisor can read mixed state from the same artifact root

Actions:
- split artifact roots into at least:
  - `qualification_runs/<run_id>/...`
  - `implementation_runs/<run_id>/...`
- top-level CT101 parity runner must create a unique run id before launch
- all worker/supervisor/notifier artifacts must be namespaced to that run id

Acceptance:
- no implementation run reuses `orchestrator_real_repo_clean_baseline` as its live artifact root
- current run id is present in:
  - worker status
  - remote execution status
  - supervisor summary
  - notifier state

Artifacts to add:
- `artifacts/full_audit_campaign/current_run.json`
- `artifacts/full_audit_campaign/runs/<run_id>/run_manifest.json`

### Phase 3 — make implementation-lane activation explicit and fatal when missing
Problem addressed:
- earlier runs silently fell back to verification-only qualification
- parity runs looked active without doing parity work

Actions:
- require the remote runner to emit a startup proof showing:
  - implementation profile
  - implementation script path
  - parity-focus work units present in work graph
  - parity-focus assignments actually launched
- if parity-focus assignments are absent, fail immediately with a structured blocker

Acceptance:
- every implementation run writes:
  - `implementation_mode_status.json`
- that status includes:
  - `implementationProfile`
  - `implementationScript`
  - `parityFocusIssuesPresent`
  - `parityFocusAssignmentsObserved`

### Phase 4 — build a generator regression suite
Problem addressed:
- current implementation worker emits unsafe code transforms
- repeated early failures are generator faults, not just repo faults

Actions:
- add a generator-level suite for `scripts/orchestrator-real-repo-clean-implement.mjs`
- test generated output for each focus group in disposable temp repos
- include regressions already found:
  - persistence fallback path must not rewrite `app.json`
  - security imports must match runtime calls
  - builder overlay CSS must remain non-interactive
  - integrations must not stay fabricated
  - website builder undo/revision paths must not break browser realism

Acceptance:
- generator suite must be green before any parity campaign can launch
- launch preflight should refuse to run if generator suite is red

Suggested tests:
- `tests/implement-worker.persistence-regressions.test.mjs`
- `tests/implement-worker.security-regressions.test.mjs`
- `tests/implement-worker.browser-safety.test.mjs`
- `tests/implement-worker.integrations-regressions.test.mjs`

### Phase 5 — canonical truth path for CT101 supervisor and notifier
Problem addressed:
- CT101 can score stale local state or mixed old/new artifacts
- notifier still lies in some paths

Actions:
- CT101 supervisor should consume one canonical remote run summary, not a blend of stale files
- require a matching run id on every consumed artifact
- if run id mismatches or required artifacts are mixed/stale, supervisor must stop with blocker
- notifier must refuse to send green if current tier trace or current run summary is red

Acceptance:
- no stale green notification can coexist with a red current run id
- top-level supervisor result is derived from current-run remote summary + synced product diff proof only

Artifacts to add:
- `artifacts/full_audit_campaign/runs/<run_id>/canonical_summary.json`
- `artifacts/full_audit_campaign/runs/<run_id>/notifier_eligibility.json`

### Phase 6 — deterministic remote baseline rebuild
Problem addressed:
- baseline integrity drifts between runs
- browser realism and repo tests have to be repaired manually

Actions:
- create a VM102 baseline refresh command/script that does all of this deterministically:
  - reset repo to baseline commit
  - clean untracked files
  - install deps if needed
  - prove browser realism green
  - prove full repo suite green
  - write baseline proof artifact

Acceptance:
- one command recreates a green baseline without manual file syncing
- baseline proof artifact exists before any implementation run starts

Artifacts to add:
- `scripts/vm102-refresh-mailchimp-baseline.mjs`
- `artifacts/full_audit_campaign/runs/<run_id>/baseline_proof.json`

### Phase 7 — patch promotion / sync-back redesign
Problem addressed:
- CT101 currently syncs remote product tree back in a coarse tar copy
- this is too blunt for trustworthy scoring and promotion

Actions:
- replace whole-tree tar sync with one of:
  - patch bundle artifacts per successful shard/iteration, or
  - git branch/worktree promotion after validation
- CT101 should consume a validated patch set, not arbitrary dirty tree state

Acceptance:
- synced changes are traceable to a run id and shard set
- CT101 can show exact changed files and promotion source for each iteration

Artifacts to add:
- `artifacts/full_audit_campaign/runs/<run_id>/patch_manifest.json`
- `artifacts/full_audit_campaign/runs/<run_id>/promoted_diff.txt`

## Launch gate after remediation
Do **not** relaunch one-shot Mailchimp parity until all of these are green:

- [ ] Phase 1 disposable worktrees live on VM102
- [ ] Phase 2 run-id namespaced artifact roots live
- [ ] Phase 3 implementation-mode proof artifact emitted and enforced
- [ ] Phase 4 generator suite green
- [ ] Phase 5 canonical truth/notifier path green
- [ ] Phase 6 deterministic VM102 baseline rebuild green
- [ ] Phase 7 patch promotion path in place

## Recommended order of implementation
1. Phase 1 disposable worktrees
2. Phase 2 run-id artifact separation
3. Phase 5 canonical truth/notifier path
4. Phase 6 deterministic baseline rebuild
5. Phase 4 generator regression suite
6. Phase 7 patch promotion path
7. Relaunch parity campaign only after the above are green

## Honest stop condition
This remediation program is complete only when:
- a fresh one-shot 100-agent Mailchimp parity run starts from a deterministic green baseline,
- uses a disposable worktree,
- emits current-run isolated artifacts,
- shows parity-focus assignments active,
- and either reaches top-level green honestly or reports a real blocker without stale/mixed truth.
