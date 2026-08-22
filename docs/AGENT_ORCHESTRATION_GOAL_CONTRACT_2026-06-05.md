# Agent orchestration goal contract — 2026-06-05

## Purpose

This is the hard contract for the real agent-orchestration goal. It exists to prevent scoped proof, launcher health, or parity accounting from being mistaken for the actual goal.

## North-star claim

The shared orchestration system may be called goal-complete only when it can take a large product objective, decompose it into executable work, run many agents on a remote execution plane for hours, land fresh verified product progress, dynamically replan from remaining objective surface, and stop only on honest green or a documented real blocker.

## Current proof boundary

- Generated/isolated 100-agent hardened Tier3 orchestration: proven.
- Hetzner 100-agent 30-minute Tier1 smoke: proven.
- Real-repo 100-agent autonomous product creation: not yet proven.
- Mailchimp full-clone parity: red / not complete.

## Required truth layers

Every serious run must report these separately:

1. `executionBoundaryReady`
2. `baselineReady`
3. `mechanicalGreen`
4. `scaleProofReady`
5. `thresholdPass`
6. `freshProductDiffPass`
7. `verificationIntegrityPass`
8. `truthIntegrityPass`
9. `parityForScopePass`
10. `globalFullClonePass`
11. `blockerKind`, when red

A green lower layer never implies a green upper layer.

## Counted work rules

### Counts as real orchestration product work

- Fresh accepted product diffs measured from the run baseline.
- Changed files on declared product paths.
- Relevant non-skipped verifier evidence tied to accepted diffs.
- Admitted merge/promotion through a patch ledger or equivalent canonical landing evidence.
- Work that reduces an explicit unresolved objective surface.

### Does not count as product-creation proof

- Proof-only/product-state credit with no fresh product delta.
- Docs-only, tests-only, scripts-only, artifacts-only, or control-plane-only changes.
- Marker-only/source-syntax-only changes.
- Duplicate/generated bulk without semantic product evidence.
- Verifier-only endurance.
- Transport, launcher, notifier, or supervisor liveness by itself.
- Dirty baseline carried forward without admitted ledger proof.

## Required artifacts

Every serious run must write:

- `run_contract.json`
- `execution_boundary.json`
- `baseline_hashes.json`
- `surface_matrix.json`
- `executable_work_graph.json`
- `worker_events.json`
- `patch_queue.json`
- `loc_accounting.json`
- `claim_ledger.json`
- `truth_conflicts.json`
- `completion_summary.json`
- `threshold_evaluation.json`
- `blocker_report.json` when red

## Default execution boundary

- Control plane: `/root/clawd` OpenClaw/Docker host.
- Heavy execution plane: Hetzner `clawd-exec-hel1`, workspace `/home/jake/clawd-remote`.
- Heavy local execution is a hard-fail unless Jake explicitly approves a local exception.

## Real-repo Tier3 pass threshold

A real-repo Tier3 run passes only if all hold:

- requested agents: 75–100
- target for final qualification: 100 requested agents
- peak concurrency: target 100, minimum 90 for 100-agent claims
- duration: at least 4 hours
- productive iteration rate: at least 0.70
- no-op rate: at most 0.10
- repeat-blocker rate: at most 0.08
- median time to next meaningful progress: at most 20 minutes
- verification integrity: at least 0.95
- truth contradictions: exactly 0
- fake-green incidents: exactly 0
- fresh product diffs: required
- relevant verifier evidence: required

## Decisive real-workload tranche threshold

Before another 75/100-agent real-repo run, a scoped decisive tranche must pass:

- execution plane: Hetzner
- duration: 120 minutes unless scoped work genuinely completes earlier without broader claim
- executable product shards: at least 10 before launch
- product lanes touched: at least 3
- accepted contributing agents: at least 4
- surviving product changed lines: at least 150 adds+dels
- counted product files touched: at least 8
- verification integrity: at least 0.95
- no-op rate: at most 0.20
- truth contradictions: exactly 0
- proof-only credit toward this threshold: forbidden

## Continuation rules

- If the matrix is red and no work remains, trigger objective expansion.
- If objective expansion produces executable product work, continue.
- If objective expansion produces only labels/proof-only/scaffolding, stop with blocker `objective_expansion_missing_executable_work`.
- A strict parity/full-clone claim blocker is not itself permission to start another top-level iteration.

## Stop conditions

A serious run can stop only with one of:

- `threshold_pass`
- `supervisor_green_for_declared_scope`
- `blocker_reported`
- `hard_fail_truth_contradiction`
- `hard_fail_execution_boundary_violation`

For full-clone objectives, scoped green is not terminal full completion.

## Final project done condition

The orchestration project reaches the goal only after:

1. one Mailchimp real-repo 100-agent 4-hour Tier3 pass,
2. one 100-agent 8-hour real-repo soak or equivalent stability proof,
3. one adjacent non-Mailchimp real-workload transfer pass,
4. zero truth contradictions across those runs,
5. operator flow supports plan/launch/status/resume/audit/report without Mailchimp-specific patch-chasing.
