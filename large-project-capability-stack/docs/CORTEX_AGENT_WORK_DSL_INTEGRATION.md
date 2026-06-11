# Cortex ↔ Agent Work DSL integration

Agent Work DSL is now the structured handoff boundary between Cortex intent/routing and the shared orchestration runners.

## Boundary

- **Cortex owns:** objective binding, route provenance, memory citations, owner/session metadata, and intent-to-surface shaping.
- **Shared stack owns:** DSL validation, safety guardrails, run-contract compilation, surface matrix/work graph generation, and benchmark runner ingestion.
- **Runners own:** execution-plane checks, verifier execution, truth artifacts, and completion/blocker reporting.

## Flow

```text
Cortex intent
  -> cortex.agent_work_handoff.v0
  -> packages/cortex-agent-work-adapter
  -> claw.agent_work_spec.v0
  -> run_contract.json + surface_matrix.json + work_graph.json
  -> transfer/continuous runners
```

## Compile a Cortex handoff

```bash
node apps/system-benchmark/compile-cortex-agent-work.mjs handoff.json --out artifacts/agent-work-dsl/current
```

## Run from DSL or compiled artifacts

```bash
node apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs artifacts/agent-work-dsl/current
node apps/system-benchmark/run-continuous-real-workload-controller.mjs artifacts/agent-work-dsl/current --dry-run
```

Both runners also accept raw `.aw`/JSON Agent Work specs and materialize compiler artifacts before execution.

## Truth boundary

This integration makes Agent Work DSL a usable Cortex handoff and runner-ingestion format. It does not claim every existing benchmark launcher has been rewritten to author DSL internally, and it does not launch or prove a new benchmark by itself.
