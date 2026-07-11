# Agent Work v1 schema catalog

Status: Phase 1 contract freeze, created 2026-07-10.

Canonical schema directory: `packages/canonical-agent-work/schemas/`.

## Rules

- Schema identifiers are immutable after v1 release. Breaking changes require a new schema version.
- Unknown top-level critical fields fail validation. Explicit `metadata`, `source`, or `payload` objects are the only extension points.
- A valid individual contract is not enough: the cross-contract bundle must agree on `runId` and `objectiveId`.
- Operational state will be transactionally stored in SQLite during Phase 3; these JSON contracts remain portable inputs/evidence.
- V0 compatibility is a one-way upgrade into v1 contracts. V1 execution never silently downgrades to v0 truth.

## Catalog

| Contract | Schema ID | Authority | Required before | Purpose |
|---|---|---|---|---|
| Objective contract | `clawd.agent_work.objective_contract.v1` | Cortex grounding + canonical validation | plan admission | Binds objective, reply anchor, path, fidelity, scope, implementation surface, stop condition, done conditions, and requested claims. |
| Budget contract | `clawd.agent_work.budget_contract.v1` | canonical admission; runtime enforcement later | plan admission | Hard token, money, duration, spawn, retry, concurrency, and provider-call limits. |
| Permission contract | `clawd.agent_work.permission_contract.v1` | canonical admission | plan admission | Explicit allow/forbid capabilities with external writes denied by default. |
| Run manifest | `clawd.agent_work.run_manifest.v1` | canonical facade | run creation | Stable run identity, plan digest, placement, initial state, artifact root, and controller. |
| Durable event | `clawd.agent_work.event.v1` | future `agent-work-runtime` | every state change | Append-only event identity, sequence, entity, idempotency key, state version, and payload. |
| Task contract | `clawd.agent_work.task.v1` | Full Parity Engine + canonical validation | scheduling | Objective-backed task, file allowlist, verifiers, dependencies, and initial state. |
| Lease | `clawd.agent_work.lease.v1` | future `agent-work-runtime` | worker start | Worker/task ownership with expiration and monotonic fencing token. |
| Worker call | `clawd.agent_work.worker_call.v1` | future worker adapter | real-worker credit | Command, model, runtime state, exit code, provider-observed usage, and result artifact. |
| Verifier result | `clawd.agent_work.verifier_result.v1` | future verifier service | patch/terminal credit | Independent result bound to exact source digest and content-hashed evidence. |
| State truth | `clawd.agent_work.state_truth.v1` | `orchestrator-run-state` | continuation/terminal decision | Projected run state, terminal/ok flags, evidence completeness, contradictions, and next action. |
| Blocker | `clawd.agent_work.blocker.v1` | terminal truth projector + canonical facade | terminal red | Classified blocker, observed evidence, reproduction, retryability, and next action. |
| Completion packet | `clawd.agent_work.completion_packet.v1` | canonical facade | terminal delivery | Exact source digest, objective truth, required artifacts, allowed/rejected claims, and review status. |

## V0 compatibility mapping

`upgradeAgentWorkV0ToV1()` currently maps a Cortex handoff plus `claw.agent_benchmark_run_contract.v1` into:

- objective contract;
- permission contract;
- budget contract;
- run manifest;
- one task contract per compiled surface.

Compatibility safety rules:

- external writes stay denied unless `external_send` is explicitly allowed and not forbidden;
- a capability appearing in both `allow` and `forbid` invalidates the bundle;
- run and task projections receive deterministic idempotency keys;
- missing v0 budget values become `null`, not invented limits;
- the v1 plan digest is stable over the grounded objective, permissions, budgets, and surfaces;
- v0 runtime execution remains unchanged in Phase 1; the new contracts are materialized alongside current compiler artifacts;
- compilation is green only if the v1 cross-contract bundle validates.

## Validation API

```js
import {
  loadAgentWorkV1Schemas,
  validateAgentWorkV1Contract,
  validateAgentWorkV1Bundle,
  upgradeAgentWorkV0ToV1
} from './packages/canonical-agent-work/index.mjs';
```

The built-in validator intentionally covers the schema features used by this catalog without adding a runtime dependency. Phase 2 may replace its implementation, but not its failure behavior or returned error shape, without a recorded decision.
