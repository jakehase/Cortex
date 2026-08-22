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

## v0.1 policy pass-through

The handoff now preserves the next orchestration layer:

- `budgets` for token/call/runtime ceilings and worker prompt caps
- `wavePolicy` for max waves, bundling, compact/full-context behavior, and wave factpack handoff
- `expansionPolicy` for objective-red / graph-exhausted replanning rules
- `evidenceSchemas` for named truth-layer gates and required artifacts
- `templates` for reusable Agent Work surface macros

Cortex can set these fields directly on `cortex.agent_work_handoff.v0`; the adapter passes them into `claw.agent_work_spec.v0`, and the DSL compiler writes them into `run_contract.json`, `surface_matrix.json`, `work_graph.json`, and `compiler_report.json`.

These fields make dynamic objective expansion explicit in the contract. They do not by themselves prove that a runner enforced every policy; runner artifacts must still report enforcement or unsupported-policy blockers honestly.

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
