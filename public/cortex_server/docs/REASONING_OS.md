# Cortex Reasoning OS Blueprint

This document begins the transition from a collection of Cortex modules into a reasoning operating system.

## Phase 1 implemented: canonical kernel objects

The first step is a shared object model in `cortex_server/modules/reasoning_kernel.py`.

Current canonical objects:

- `ReasoningTask`
- `Subtask`
- `BeliefClaim`
- `ArtifactRef`
- `ExecutionRecord`
- `OutcomeRecord`
- `PolicyDecision`
- `ReasoningEnvelope`

## Phase 2 implemented: executable planner graph

The second step is `cortex_server/modules/reasoning_planner.py`.

Current planner graph capabilities:

- `ReasoningPlanGraph` + `PlanNode` schema
- dependency validation and cycle detection
- topological execution order derivation
- projection from plan graph → `ReasoningTask`
- compilation from plan graph → executable workflow steps
- dependency-aware payload templating between nodes (`{{node_id.response.foo}}`)
- orchestrator endpoints for plan preview and execution

New orchestrator routes:

- `POST /orchestrator/plan`
- `POST /orchestrator/plan/execute`

## Phase 3 implemented: scheduler / wake-resume / dependency runtime

The third step is `cortex_server/modules/reasoning_scheduler.py` plus orchestrator runtime endpoints.

Current runtime capabilities:

- persistent managed process state for reasoning workflows/plans
- per-node lifecycle: pending / blocked / waiting / ready / running / completed / failed
- dependency promotion: downstream nodes become ready when prerequisites complete
- failure propagation: dependents stay blocked if an upstream node fails
- wake-resume semantics for waiting processes
- scheduler ticks that surface runnable nodes
- orchestrator batch execution of due work using the managed runtime
- process event log for debugging and operator visibility

New orchestrator routes:

- `POST /orchestrator/runtime/plan`
- `POST /orchestrator/runtime/tick`
- `GET /orchestrator/runtime/status`
- `GET /orchestrator/runtime/processes`
- `GET /orchestrator/runtime/process/{process_id}`
- `POST /orchestrator/runtime/wake/{process_id}`

## Phase 4 implemented: unified belief + provenance store

The fourth step is `cortex_server/modules/reasoning_beliefs.py`.

Current belief-store capabilities:

- durable belief records backed by `BeliefClaim`
- provenance-aware upsert flow
- automatic supersession / contradiction marking for stale claims
- task-scoped and query-scoped belief lookup
- runtime execution results projected into beliefs for later inspection

## Phase 5 implemented: standard verification contracts

The fifth step is `cortex_server/modules/verification_contracts.py`.

Current verification capabilities:

- canonical `VerificationContract` and `VerificationResult`
- pre-execution and post-execution contract stages
- dependency-success checks
- response status checks
- response path exists / equals checks
- approval-required checks
- orchestrator integration that can fail a step on contract failure

## Phase 6 implemented: routing-as-policy integration

The sixth step is `cortex_server/modules/reasoning_policy.py`.

Current routing/policy capabilities:

- workflow-level policy synthesis
- archetype classification using existing latency governor logic
- policy decisions for routing / scheduler / verification / memory domains
- policy snapshot attached to plan previews, workflows, kernel tasks, and runtime metadata

## Phase 7 implemented: persistent long-running processes

This extends `cortex_server/modules/reasoning_scheduler.py`.

Current long-running process capabilities:

- recurring managed processes via `cadence_seconds`
- persistent next-run tracking
- pause / resume controls
- recurring run history
- automatic process reset when the next run becomes due

## Phase 8 implemented: operator introspection surfaces

This extends `cortex_server/routers/orchestrator.py`.

Current operator/introspection capabilities:

- process view with event stream and attached beliefs
- explain surface with policy, incidents, and timeline context
- runtime belief listing / search
- better debugging hooks for blocked / failed process nodes

Additional orchestrator routes:

- `GET /orchestrator/runtime/explain/{process_id}`
- `GET /orchestrator/runtime/beliefs`
- `GET /orchestrator/runtime/analytics-summary`
- `GET /orchestrator/runtime/analytics-report`
- `GET /orchestrator/runtime/analytics-report-markdown`
- `GET /orchestrator/runtime/analytics-compare`
- `GET /orchestrator/runtime/analytics-correlation`
- `POST /orchestrator/runtime/pause/{process_id}`
- `POST /orchestrator/runtime/resume/{process_id}`
- `POST /orchestrator/runtime/policy-apply/{process_id}` (supports dry-run, operator-selected metadata overrides, and explicit opt-in for confirmation-required settings)
- `GET /orchestrator/runtime/policy-history/{process_id}`
- `POST /orchestrator/runtime/policy-rollback/{process_id}/{revision_id}` (supports dry-run and explicit opt-in when intervening revisions touched the same settings)

## Phase 9 implemented: hardened safety + permission model

The ninth step is `cortex_server/modules/reasoning_safety.py`.

Current safety capabilities:

- endpoint risk classification
- approval-gated execution for high-risk and explicitly approval-required steps
- method allowlisting in the managed runtime
- runtime safety decision attached to step execution results

## Why this matters

Cortex already contains execution transactions, memory/codec state, routing policies, validators, and orchestration artifacts. Until these systems can project into a shared schema, Cortex behaves like adjacent subsystems instead of a unified runtime.

The kernel object layer gives Cortex:

- a common language for work-in-progress
- a consistent place to attach provenance and verification
- a bridge from execution into memory/outcome learning
- a base for the scheduler, planner, belief store, and operator console

## Initial integrations

`ExecutionTransaction` now exposes:

- `to_reasoning_task(...)`
- `to_reasoning_outcome(...)`

These convert transaction state into canonical kernel objects without breaking existing transaction behavior.

## Planned build order

1. **Kernel objects** ✅
2. **Executable planner graph** ✅
3. **Scheduler / wake-resume / dependencies** ✅
4. **Unified belief + provenance store** ✅
5. **Standard verification contracts** ✅
6. **Routing-as-policy integration** ✅
7. **Persistent long-running processes** ✅
8. **Operator introspection surfaces** ✅
9. **Hardened safety + permission model** ✅

## Design note

Kernel objects should be additive and projection-friendly. Existing systems should be able to emit kernel records before they are rewritten to depend on them directly.
