# Cortex Kernel V2

Cortex Kernel V2 is the compiled request/runtime layer now wired into Oracle, Nexus, and Meta Conductor, with Mission Control and Command Center exposing the shared runtime-economics view.

## What shipped

### 1) Canonical request compiler / intent contract

`cortex_server/modules/cortex_kernel_v2.py` compiles every Oracle turn into a stable contract with:

- normalized intent kind (`coding`, `planning`, `ops`, `analysis`, `retrieval`, `general`)
- strict-contract detection
- risk flags
- complexity score + reasons
- preferred execution lane (`fast` vs `deep`)
- target latency budget
- escalation triggers

This turns the old mix of prompt heuristics into one reusable contract.

That contract is now also reused inside Nexus orchestration for:

- risk-flag normalization
- simple-QA gating
- fast-vs-deep lane planning
- latency-budget archetype selection / cheap-route planning
- runtime telemetry / rollback visibility

### 2) Context kernel with hot / warm / cold classes

The working-set compiler explicitly separates context into three reuse classes:

- **Hot** — recent reusable turns from the same session
- **Warm** — short-lived referent/session continuity context
- **Cold** — bounded Cortex Codec memory

The prompt compiler assembles these classes into the final prompt only when safe and useful.

Strict-contract prompts intentionally bypass prompt expansion to preserve deterministic outputs.

Beyond Oracle, Nexus now compiles the same hot/warm/cold working set and records how much context was actually reusable on orchestration turns. That keeps context reuse measurable across both major runtime paths even when Nexus preserves its existing downstream execution behavior.

### 3) Fast-path vs deep-path execution lanes

The kernel produces a lane plan before execution:

- `fast` for strict/simple or low-complexity requests
- `deep` for planning, coding, ops, or higher-risk requests

The plan drives Oracle routing hints:

- `depth_mode`
- `use_bridge`
- `force_orchestrate`
- target Oracle lane

Post-execution telemetry records whether the plan held or escalated.

Nexus now consumes the same lane plan to:

- suppress fastlane when Kernel V2 selected a deep path
- widen recommended deep-reasoning levels for planning/coding/ops requests
- emit per-runtime fast/deep telemetry instead of keeping that visibility Oracle-only

### 4) Codec integration as bounded context, not a competing brain

Codec state is now treated as **cold context input** with an explicit size budget. It is compiled into the working set rather than operating as a second planner.

### 5) Prompt / reasoning assembly compiler

Prompt assembly now runs through a dedicated compiler:

- hot context block
- warm context block
- cold context block
- raw user prompt

This makes the working set inspectable and measurable.

### 6) Performance telemetry + operator surfaces

Kernel telemetry records:

- planned lane vs actual lane
- escalation rate
- end-to-end latency
- compile latency
- context reuse hit counts and bytes
- active sessions / pending traces

Operator surfaces:

- `GET /oracle/kernel/status`
- `GET /oracle/kernel/telemetry`
- `GET /nexus/kernel/status`
- `GET /nexus/kernel/telemetry`
- `GET /meta_conductor/kernel/status`
- `GET /meta_conductor/kernel/telemetry`
- `GET /nexus/status`
- `GET /meta_conductor/status` now includes `kernel_v2`
- `GET /oracle/status` now includes `kernel_v2`
- `GET /nexus/context` and `GET /nexus/full` now include `kernel_v2`
- Mission Control board summary now includes aggregate kernel metrics plus runtime, surface, and rollout breakdowns
- Mission Control UI summary renders dynamic runtime economics instead of hardcoding Oracle/Nexus only
- `GET /command_center/state` and `GET /command_center_live/state` now expose the live kernel summary for operator overlays
- `POST /command_center/action` and `POST /command_center_live/action` now support `status_sweep`, `kernel_sweep`, `ping_nexus`, and `ping_meta_conductor` with kernel-aware payloads

Telemetry is now runtime-scoped and surface-scoped. `performance_snapshot(runtime="oracle")`, `performance_snapshot(runtime="nexus")`, and `performance_snapshot(runtime="meta_conductor")` expose separate economics while Mission Control keeps an aggregate view plus dynamic per-runtime and per-surface breakdowns.

### 7) Rollout / safety toggles

Environment switches:

- `ORACLE_KERNEL_V2_ENABLED`
- `ORACLE_KERNEL_V2_MODE=active|shadow|disabled`
- `ORACLE_KERNEL_V2_DISABLE_CONTEXT_REUSE`
- `ORACLE_KERNEL_V2_DISABLE_FAST_PATH`
- `ORACLE_KERNEL_V2_DISABLE_DEEP_PATH`
- `ORACLE_KERNEL_V2_DISABLE_PROMPT_COMPILER`
- `ORACLE_KERNEL_V2_DISABLE_CODEC_CONTEXT`
- `ORACLE_KERNEL_V2_FAST_COMPLEXITY_THRESHOLD`
- `ORACLE_KERNEL_V2_DEEP_COMPLEXITY_THRESHOLD`
- `ORACLE_KERNEL_V2_FAST_BUDGET_MS`
- `ORACLE_KERNEL_V2_DEEP_BUDGET_MS`

The same knobs now support broader rollout scopes:

- `NEXUS_KERNEL_V2_*`
- `CORTEX_KERNEL_V2_*`

Resolution order is runtime-specific first, then shared Cortex scope, then Oracle compatibility defaults. This lets operators canary or shadow Nexus separately without regressing the already-landed Oracle slice.

This gives operators clear disable switches if quality regresses.

## Runtime flow

### Oracle

1. Oracle receives the raw prompt.
2. Existing referent + codec gatherers run.
3. Kernel V2 compiles the request contract.
4. Kernel V2 compiles the working set (hot/warm/cold).
5. In active mode, the prompt compiler emits the final prompt used by Oracle.
6. Oracle executes its existing lane logic.
7. The winning lane finalizes Kernel V2 telemetry.

### Nexus

1. Nexus receives the orchestration query.
2. Codec, referent, latency, and prefetch planners run as before.
3. Kernel V2 compiles the same canonical contract and working set.
4. Kernel lane planning feeds fastlane-vs-deep gating, latency-budget planning, and recommended-level widening.
5. Nexus finalizes Kernel V2 telemetry with runtime-scoped economics.

### Meta Conductor

1. Meta Conductor receives an orchestration request and compiles its own kernel trace.
2. It delegates execution to Nexus without losing the outer runtime boundary.
3. The delegated result is finalized as `meta_conductor` telemetry so operators can separate delegated orchestration traffic from direct Nexus traffic.

### Operator view

1. Mission Control reads the aggregate kernel snapshot.
2. It exposes per-runtime Oracle/Nexus/Meta Conductor summaries plus per-surface economics.
3. Status surfaces keep runtime-local telemetry scoped to the router being inspected.
4. Command Center state/actions can now read the same kernel summary without bespoke heuristics.

## Why this shape

This is intentionally a **governable overlay** on top of the existing Oracle and Nexus runtimes, not a risky rewrite.

That means:

- current quality-preserving Oracle/Nexus behavior stays intact
- the new compiler/kernel is inspectable and testable in isolation
- fast/deep planning is centralized
- context reuse becomes explicit and measurable
- telemetry becomes operator-visible across runtimes

## Tests

Primary new coverage:

- `tests/test_cortex_kernel_v2.py`
- `tests/test_oracle_kernel_v2_integration.py`
- `tests/test_nexus_kernel_v2_integration.py`
- `tests/test_meta_conductor_kernel_v2_integration.py`
- `tests/test_command_center_kernel_v2.py`

Validated in broader regression with the repository test suite subset that exercises kernel, Oracle, Nexus, Meta Conductor, Command Center, and Mission Control behavior.

## Remaining work

No known safe-blocking Kernel V2 roadmap items remain for this repo pass.

Future expansion would be new feature work rather than unfinished migration work, for example pushing the same kernel shell into additional routers only if they gain distinct execution lanes worth tracking.
