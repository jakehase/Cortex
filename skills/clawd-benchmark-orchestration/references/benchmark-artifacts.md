# Benchmark artifacts

Use this file when you need the meaning and read order of benchmark artifacts in this workspace.

## First read for a finished run

1. `completion_summary.json`
2. `threshold_evaluation.json`
3. `blocker_report.json` if present
4. `orchestrator_run/summary.json`

This usually tells you:
- run id
- artifact root
- whether duration target was met
- whether the run was mechanically green
- whether the run passed thresholds
- the main blocker and next action

## If the result looks suspicious

Then read:
- `orchestrator_run/supervisor.json`
- `orchestrator_run/worker_events.json`
- `orchestrator_run/patch_queue.json`
- `truth_conflicts.json`
- `surface_matrix.json`

Use these to answer:
- Did the supervisor report green while shards were still unfinished?
- Were workers killed, recovered, or respawned?
- Were shards merged, rejected, or left ready/pending?
- Was there a contradiction between top-level claims and canonical artifacts?

## Key truth fields

### `completion_summary.json`
Main user-facing run summary.

Important fields:
- `thresholdPass`
- `supervisorConfirmedCompletion`
- `mechanicalGreen`
- `scaleProofReady`
- `thresholdFailures`
- `blocker`

Interpretation:
- `thresholdPass: true` means scored pass
- `mechanicalGreen: true` only means the orchestrator path itself came back green
- `supervisorConfirmedCompletion` should not be treated as product completion or parity completion

### `threshold_evaluation.json`
Scored benchmark truth.

Important fields:
- `mechanicalGreen`
- `scaleProofReady`
- `thresholdPass`
- `metrics`
- `failures`

Use this file when the question is "did the benchmark actually pass?"

### `blocker_report.json`
Canonical blocker output when blocked.

Use this for:
- blocker wording
- next action wording
- phase/status reference

### `orchestrator_run/summary.json`
Low-level execution summary.

Important fields:
- `mergedShardCount`
- `elapsedMs`
- `metrics.workerSpawnCount`
- `metrics.workerExitFailures`
- `metrics.staleLeaseCount`
- `metrics.recoveryCount`
- `metrics.stateLossEvents`
- `metrics.continuityFailures`

Use this when the user asks what happened during the run.

### `orchestrator_run/supervisor.json`
Supervisor truth snapshot.

Important fields:
- `topLevel.status`
- `topLevel.counts`
- lane/domain breakdowns
- shard states

Use this when you need to verify whether green/amber/red was honest.

### `orchestrator_run/worker_events.json`
Timeline of worker spawn, exit, recovery, late results, and exhaustion.

Use this for:
- late-wave scheduling problems
- stale lease churn
- SIGKILL / non-zero exits
- proving when a shard started and stopped

### `orchestrator_run/patch_queue.json`
Merged, queued, and rejected patch artifacts.

Use this for:
- which shard evidence actually merged
- verifier result capture
- verification-only shards vs code-changing shards

### `truth_conflicts.json`
Explicit contradiction ledger.

Use this when evaluating:
- fake-green incidents
- truth-integrity contradictions
- claim/reporting honesty regressions

## Truth ladder

Keep these separate:
- `baselineReady`
- `mechanicalGreen`
- `scaleProofReady`
- `thresholdPass`
- parity/full-clone status

They are not interchangeable.

## Benchmark pass language

Safe:
- "mechanically green but threshold red"
- "duration target met, threshold pass failed"
- "blocked by fake-green incident"
- "baseline-ready only"

Unsafe unless proven:
- "passed" when only mechanical green exists
- "complete" when only baseline readiness exists
- "parity done" because benchmark scaffolding ran
