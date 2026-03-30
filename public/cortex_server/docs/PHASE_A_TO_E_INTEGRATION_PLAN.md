# Phase A–E Integration Plan

## Purpose
Close the gap identified in `docs/PHASE_A_TO_E_AUDIT_2026-03-29.md` so that Phases A–E are not merely validated roadmap slices, but a genuinely integrated continuation of the Reasoning OS.

## Target outcome
At the end of this plan, the repo should support this stronger statement:

> The Reasoning OS core and the roadmap phases A–E operate as one coherent runtime layer, with live policy integration, operator controls, durable artifacts, and end-to-end execution tests.

## Success criteria

### Functional
- Phase A–D surfaces are restored or re-landed in the live checkout.
- Phase E / R7 influences the main reasoning runtime rather than only sidecar scripts.
- Operator freeze / rollback / resume controls mutate real runtime policy/governor state.
- Bootstrap artifact-derived baselines are replaced or augmented with live telemetry windows.
- Explain/analytics surfaces can show when and why homeostasis changed a runtime decision.

### Verification
- Existing reasoning-core tests continue to pass.
- Existing Phase E / R7 tests continue to pass.
- New end-to-end integration tests pass, covering:
  1. task creation
  2. planning
  3. scheduling/runtime execution
  4. homeostasis/policy influence
  5. safety override / rollback
  6. explain/operator inspection

### Documentation
- Roadmap docs present for all phases A–E in the live checkout.
- Phase labels are internally consistent.
- Landed/not-landed language reflects reality.

---

# Workstreams

## Workstream 1 — Restore phase continuity in the live checkout

### Goal
Reconstruct the missing phase surfaces so the live repo contains the actual roadmap lineage instead of only Phase E.

### Deliverables
- `docs/cortex_roadmap/ROADMAP_R1_TO_R7.md`
- `docs/cortex_roadmap/R1_*.md`
- `docs/cortex_roadmap/R2_*.md`
- `docs/cortex_roadmap/R3_*.md`
- `docs/cortex_roadmap/R4_*.md`
- `docs/cortex_roadmap/R5_*.md`
- `docs/cortex_roadmap/R6_*.md`
- `docs/cortex_roadmap/R9_ADAPTIVE_ROUTING_BRAIN.md`
- corresponding `config/`, `scripts/`, `artifacts/`, and `services/routing/` or equivalent implementation surfaces where they are intended to be live

### Tasks
1. Recover historical roadmap docs from git history.
2. Identify which historical files are still valid versus stale.
3. Re-land only the pieces that are actually part of the intended current architecture.
4. Mark historical-but-not-live content honestly if some tracks are archival.

### Exit criteria
- A–D are visible in the live tree as auditable phase packages.

---

## Workstream 2 — Integrate R7 into the live Reasoning OS policy path

### Goal
Make homeostasis part of the actual runtime decision loop.

### Primary integration targets
- `cortex_server/modules/reasoning_policy.py`
- `cortex_server/modules/reasoning_runtime_service.py`
- `cortex_server/modules/reasoning_runtime_workflows.py`
- `cortex_server/modules/reasoning_scheduler.py`
- `cortex_server/routers/orchestrator.py`

### Proposed integration shape

#### 2.1 Policy synthesis hook
Extend policy synthesis so a runtime decision may include a homeostasis envelope such as:
- regulation mode (`normal`, `conserve`, `protective`)
- effort depth target
- budget class / token-depth-latency caps
- risk-derived route guardrails
- operator freeze or rollback state

#### 2.2 Runtime application hook
At workflow/runtime execution time:
- derive or load current state signal snapshot
- compute homeostasis profile
- attach profile to runtime metadata
- constrain route choice, budget, and execution options from that profile

#### 2.3 Safety override hook
If homeostasis or safety envelope indicates a hard override:
- trigger freeze / fallback / rollback through the real runtime path
- record this as an operator-visible event
- expose it in explain/analytics surfaces

### Deliverables
- runtime-integrated homeostasis decision object
- reasoning policy integration code
- explain surface output showing homeostasis influences
- tests proving the behavior

### Exit criteria
- a real orchestrator/runtime path changes behavior when homeostasis state changes
- the change is visible in runtime metadata and explain output

---

## Workstream 3 — Replace bootstrap-only baselines with live telemetry grounding

### Goal
Upgrade R7 Step 1 from artifact-derived scaffolding to live operational evidence.

### Tasks
1. Define telemetry schema for:
   - latency
   - cost
   - rollback/failure events
   - quality proxies
   - operator interventions
   - alert-noise metrics
2. Add telemetry collection window support (e.g. rolling 7-day / 14-day snapshots).
3. Persist baseline snapshots in a stable location.
4. Add drift comparisons against previous windows.
5. Differentiate clearly between:
   - fixture-derived bootstrap
   - replay-derived evidence
   - shadow evidence
   - canary evidence
   - live telemetry evidence

### Deliverables
- live baseline collector
- drift validator
- updated Step 1 artifacts and contract
- revised docs removing the bootstrap-only caveat where no longer true

### Exit criteria
- Step 1 can be defended as a real operational baseline rather than a bootstrap stand-in

---

## Workstream 4 — Make Step 11 controls real

### Goal
Replace local-stub operator controls with actual controlled runtime actions.

### Required controls
- freeze policy
- rollback to baseline
- resume governor

### Requirements
- authenticated / explicitly gated control path
- runtime state mutation with audit trail
- operator event log entries
- dry-run support where appropriate
- clear no-op behavior when a control is unavailable

### Integration targets
- orchestrator runtime control endpoints
- policy history / rollback surfaces
- explain/operator dashboards

### Deliverables
- real control implementation
- audit log / event stream entries
- test coverage for freeze/rollback/resume

### Exit criteria
- Step 11 is no longer a UI/demo surface only

---

## Workstream 5 — Reconcile roadmap docs with reality

### Goal
Remove drift between implementation and narrative.

### Immediate fixes
- update `docs/cortex_roadmap/R7_VALUE_HOMEOSTASIS.md`
- remove stale “not fully implemented” language
- normalize whether R7 is described as Phase B2, Phase E, or both with explanation
- restore or regenerate missing roadmap docs for earlier phases
- ensure artifact paths and script names actually match the repo

### Deliverables
- internally consistent roadmap docs
- implementation notes that match the current live tree
- audit references from roadmap docs where useful

### Exit criteria
- a reader can trust the roadmap docs without separately reverse-engineering git history

---

## Workstream 6 — End-to-end integration proof

### Goal
Prove the later phase work is part of the OS rather than adjacent to it.

### Required tests

#### 6.1 Runtime homeostasis influence
A test where:
- a reasoning task is created
- a plan is compiled
- runtime policy is synthesized
- homeostasis state influences effort/routing/budget
- execution metadata shows the decision

#### 6.2 Safety override / rollback
A test where:
- runtime enters a degraded or unsafe state
- homeostasis requests protective/fallback behavior
- rollback/freeze path is triggered
- explain surface records why

#### 6.3 Operator control loop
A test where:
- operator freeze is invoked
- runtime policy changes
- later resume restores normal behavior
- audit log captures both actions

#### 6.4 Explain surface proof
A test where explain output includes:
- state vector summary
- chosen regulation mode
- budget/effort implications
- safety overrides if any
- affected route/policy decisions

### Exit criteria
- the integration can be demonstrated without relying on roadmap prose alone

---

# Sequencing

## Phase 1 — Documentation + continuity recovery
- restore A–D roadmap files
- normalize roadmap language
- document archival vs live state honestly

## Phase 2 — R7 runtime integration
- add policy/runtime hooks
- expose explain metadata
- preserve current R7 tests

## Phase 3 — Real operator controls
- convert Step 11 stubs into runtime control paths
- add audit logging

## Phase 4 — Telemetry grounding
- implement live baseline windows and drift checks
- upgrade Step 1 evidence quality

## Phase 5 — End-to-end proof
- add integration tests
- publish a completion audit showing the OS standard is met end to end

---

# Risks

## Risk 1 — Over-restoring historical roadmap files
Historical files may not all reflect the current intended architecture.

**Mitigation:**
- treat git history as source material, not truth
- re-land only what still fits the architecture

## Risk 2 — Policy coupling becomes too invasive
Integrating R7 into runtime policy could destabilize the existing reasoning runtime.

**Mitigation:**
- add the integration behind explicit policy metadata first
- preserve dry-run / explain-only mode initially
- expand to enforcement only after test coverage exists

## Risk 3 — Operator controls become unsafe
Real rollback/freeze paths could be dangerous if they mutate live state without auditability.

**Mitigation:**
- explicit gates
- structured audit logs
- dry-run support
- permission boundaries

## Risk 4 — “Passing tests” still fail to prove OS integration
If tests only validate sidecar scripts, the same audit failure will recur.

**Mitigation:**
- prioritize end-to-end runtime tests, not only per-step package tests

---

# Recommended immediate next implementation ticket

## Ticket 1 — Wire R7 into `reasoning_policy` and explain surfaces

### Objective
Create the first real bridge between the roadmap package and the core OS.

### Scope
- add a homeostasis decision payload into policy synthesis
- propagate that payload through runtime/workflow metadata
- expose it in explain output
- add tests covering normal / conserve / protective policy outcomes

### Why start here
This is the smallest change that materially improves the audit verdict.
It converts R7 from a sidecar package into a visible part of the Reasoning OS execution model.

---

# Completion definition
This plan is complete when a fresh audit can honestly conclude:

- the Reasoning OS core still passes,
- phases A–E are present and auditable in the live checkout,
- R7 influences real runtime behavior,
- operator controls are real,
- baseline evidence is operational rather than bootstrap-only,
- and end-to-end tests prove the later phase work is truly part of the OS.
