# Benchmark commands

Use this file for common command patterns in the workspace.

## Bootstrap a transfer benchmark preset

```bash
node /root/clawd/large-project-capability-stack/apps/system-benchmark/init-transfer-benchmark.mjs <preset> /root/clawd/large-project-capability-stack
```

Example presets seen in this workspace:
- `pmhnp_denial_copilot_transfer`
- `pmhnp_denial_copilot_transfer_tier2`

## Run the PMHNP functional catalog preflight

```bash
node /root/clawd/large-project-capability-stack/apps/system-benchmark/verify-pmhnp-functional-catalog.mjs
```

Run this from the PMHNP repo when the benchmark uses PMHNP functional scenarios.

## Run the transfer orchestrator benchmark

```bash
node /root/clawd/large-project-capability-stack/apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs <run_contract.json>
```

## Run a single PMHNP scenario directly

```bash
node /root/clawd/large-project-capability-stack/apps/system-benchmark/verify-pmhnp-functional-scenario.mjs <scenario-id>
```

Useful env overrides:

```bash
PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS_OVERRIDE=7000
PMHNP_BENCHMARK_SCENARIO_MIN_CYCLES_OVERRIDE=2
```

## Read the most important artifact files after a run

Start with:
- `<artifactRoot>/completion_summary.json`
- `<artifactRoot>/threshold_evaluation.json`
- `<artifactRoot>/blocker_report.json`
- `<artifactRoot>/orchestrator_run/summary.json`

If needed, continue with:
- `<artifactRoot>/orchestrator_run/supervisor.json`
- `<artifactRoot>/orchestrator_run/worker_events.json`
- `<artifactRoot>/orchestrator_run/patch_queue.json`
- `<artifactRoot>/truth_conflicts.json`

## Common rerun discipline

Before rerunning:
1. identify the actual blocker from artifacts
2. patch the harness or verifier truthfully
3. run tests
4. run a compressed proof when possible
5. only then launch the full-duration rerun

## Important reminder

Do not claim a benchmark pass from command exit alone.
The scored outcome comes from the artifact root, especially `threshold_evaluation.json` and `completion_summary.json`.
