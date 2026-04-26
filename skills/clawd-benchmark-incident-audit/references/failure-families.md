# Benchmark failure families

Use this file when a benchmark run failed and you need a fast, honest classification.

## 1. Threshold red after mechanical green

Meaning:
- orchestrator path finished cleanly enough
- benchmark still failed on scored thresholds

Inspect:
- `threshold_evaluation.json`
- `completion_summary.json`

Typical symptoms:
- autonomy window too short
- transfer score missing or too low
- no-op or handoff metrics below threshold

## 2. Fake-green contradiction

Meaning:
- a supervisor or notifier truth layer implied green while canonical execution state was still unfinished or blocked

Inspect:
- `truth_conflicts.json`
- `orchestrator_run/supervisor.json`
- `orchestrator_run/summary.json`

Typical symptoms:
- green top-level with ready/pending/in-progress shards
- completion claim with unmerged shards

## 3. Stale lease churn

Meaning:
- workers were recovered or respawned because lease TTL did not fit runtime reality

Inspect:
- `orchestrator_run/summary.json`
- `orchestrator_run/worker_events.json`

Typical symptoms:
- `staleLeaseCount > 0`
- `recoveryCount > 0`
- repeated respawns of the same shard

## 4. Verifier failure

Meaning:
- shard or verifier logic failed even though orchestration may have been fine

Inspect:
- `orchestrator_run/patch_queue.json`
- shard result files under `orchestrator_run/results/`

Typical symptoms:
- non-zero verifier output
- JSON parse or truncation failures
- OOM or signal exits inside verifier execution

## 5. Late-wave shutdown

Meaning:
- a second or later wave was scheduled too close to the runtime budget and got killed at shutdown

Inspect:
- `orchestrator_run/worker_events.json`
- `completion_summary.json`
- `orchestrator_run/summary.json`

Typical symptoms:
- shards spawned near the end of the run
- SIGKILL or forced termination shortly after spawn
- merged shard count below total despite earlier wave succeeding

## 6. Continuity or state loss

Meaning:
- worker output or merge evidence failed to survive the run truthfully

Inspect:
- `orchestrator_run/summary.json`
- `orchestrator_run/patch_queue.json`
- `orchestrator_run/artifact_bus.json` if needed

Typical symptoms:
- `stateLossEvents > 0`
- `continuityFailures` non-empty

## 7. Scale shortfall

Meaning:
- the run could not honestly support the requested agent count or concurrency claim

Inspect:
- `completion_summary.json`
- `orchestrator_summary.json`
- surface count and overlap shape

Typical symptoms:
- too few low-overlap surfaces
- peak concurrency below requested scale

## 8. Execution-boundary violation

Meaning:
- the run happened on the wrong plane or without the required remote boundary

Inspect:
- run contract
- launcher path
- execution-boundary notes

Typical symptoms:
- heavy runs launched locally despite policy
- missing remote sync or remote worker proof

## Default answer pattern

- observed failure family
- evidence
- root cause
- next repair
- rerun gate
