# Reasoning OS Elegance Execution Plan — 2026-03-30

## Purpose
Translate the high-level elegance roadmap into a concrete, sequenced execution plan with:
- numbered tickets,
- target files,
- implementation notes,
- acceptance criteria,
- and suggested test coverage.

This plan is intentionally pragmatic. The goal is not just to imagine a beautiful architecture, but to reach it through low-chaos, reversible steps.

---

# Baseline assumptions

Current state already achieved:
- Reasoning OS core is real and passing.
- Phases A–E are present as live implementation surfaces.
- R7/homeostasis and R9/routing are strongly runtime-integrated.
- Restored A/B/C surfaces now participate in policy/runtime/explain layers.
- Current integration still leans on subsystem-specific settings, overlays, and summary builders.

Therefore the next work is **architectural normalization**, not archaeology.

---

# Sequencing principles

1. **Stabilize contracts before large refactors.**
2. **Centralize arbitration before adding more hooks.**
3. **Normalize explainability before heavy doc cleanup.**
4. **Prefer thin adapter layers over giant rewrites.**
5. **Keep regressions green after each ticket.**

---

# Milestone structure

## Milestone M1 — Canonical contracts
Tickets 1–2

## Milestone M2 — Governance compiler + arbitration
Tickets 3–5

## Milestone M3 — Unified explainability/control plane
Tickets 6–7

## Milestone M4 — Native subsystem hooks
Tickets 8–13

## Milestone M5 — Scenario proof + docs + beauty pass
Tickets 14–17

---

# Ticket 1 — Introduce canonical contract models

## Goal
Create the shared architectural vocabulary the rest of the system will use.

## Deliverables
Introduce typed models for:
- `EpistemicContext`
- `GovernanceSignal`
- `RuntimeConstraintSet`
- `ConstraintDecision`
- `ExplainAtom`
- `SubsystemActivation`

## Target files
Create:
- `cortex_server/modules/reasoning_contracts.py`

Touch later callers only minimally in this ticket.

## Suggested model shape

### `EpistemicContext`
- entity_ids / claim_ids
- confidence
- uncertainty
- freshness
- contradiction_count
- provenance_strength
- summary

### `GovernanceSignal`
- source
- kind
- severity
- scope
- blocking
- recommendation
- rationale
- confidence
- evidence_refs

### `RuntimeConstraintSet`
- execution_mode
- max_parallelism
- verification_mode
- same_tick_drain
- step_timeout_seconds
- retry_max_attempts
- retry_on_timeout
- human_review_required
- escalation_recommended
- rollback_bias

### `ConstraintDecision`
- field
- previous_value
- chosen_value
- decided_by
- overridden_signals
- rationale

### `ExplainAtom`
- subsystem
- title
- expected_effect
- observed_effect
- outcome
- mismatch_reason
- evidence_refs

## Acceptance criteria
- contract module exists with stable exported types
- types are documented inline
- at least one tiny unit test validates serialization/default behavior

## Test targets
Create:
- `tests/test_reasoning_contracts.py`

---

# Ticket 2 — Add subsystem adapter layer

## Goal
Move subsystem-specific extraction logic out of the giant policy function and into adapter functions that emit canonical contracts.

## Deliverables
Add adapter functions for:
- world state
- modulation
- workspace
- truth engine
- plasticity
- embodiment
- homeostasis
- routing

Each adapter should emit some combination of:
- `EpistemicContext`
- `GovernanceSignal`
- partial `RuntimeConstraintSet`
- explain seed data

## Target files
Create:
- `cortex_server/modules/reasoning_subsystem_adapters.py`

Touch:
- `cortex_server/modules/reasoning_policy.py`

Potential future extraction directories if needed later:
- `cortex_server/modules/policy_inputs/`

## Acceptance criteria
- subsystem logic is no longer primarily encoded inline in `build_workflow_policy()`
- adapters are pure or near-pure functions where possible
- current behavior is preserved

## Test targets
Create:
- `tests/test_reasoning_subsystem_adapters.py`

Run existing:
- `tests/test_reasoning_restored_phase_integration.py`
- `tests/test_reasoning_policy_homeostasis.py`
- `tests/test_reasoning_policy_r9_integration.py`

---

# Ticket 3 — Introduce governance compiler

## Goal
Turn policy construction into a pipeline instead of an accumulation function.

## Deliverables
Create a compiler that:
1. collects subsystem adapter outputs
2. normalizes them
3. aggregates governance signals
4. compiles runtime constraints
5. emits final policy payload

## Target files
Create:
- `cortex_server/modules/governance_compiler.py`

Touch:
- `cortex_server/modules/reasoning_policy.py`
- `cortex_server/modules/reasoning_contracts.py`
- `cortex_server/modules/reasoning_subsystem_adapters.py`

## Design note
`build_workflow_policy()` should become a thin wrapper around the compiler.

## Acceptance criteria
- `build_workflow_policy()` shrinks substantially
- policy output schema remains backward-compatible or is explicitly versioned
- compiler emits structured intermediate artifacts useful for explainability

## Test targets
Create:
- `tests/test_governance_compiler.py`

---

# Ticket 4 — Introduce explicit runtime constraint compiler

## Goal
Centralize runtime field resolution so overlays stop being distributed procedural logic.

## Deliverables
Create one component that merges subsystem recommendations into the final runtime constraint set.

This should absorb the logic currently spread across:
- `_r9_runtime_overlay()`
- `_homeostasis_runtime_overlay()`
- restored phase overlay logic

## Target files
Create:
- `cortex_server/modules/runtime_constraint_compiler.py`

Touch:
- `cortex_server/modules/reasoning_runtime_execution.py`
- `cortex_server/modules/governance_compiler.py`

## Acceptance criteria
- runtime constraint precedence is computed in one place
- `workflow_policy_settings()` becomes thin and obvious
- generated constraint decisions are inspectable

## Test targets
Create:
- `tests/test_runtime_constraint_compiler.py`

Run existing runtime suites.

---

# Ticket 5 — Add first-class arbitration / precedence model

## Goal
Make subsystem conflict resolution explicit, inspectable, and testable.

## Deliverables
Create:
- a precedence table
- conflict resolution rules
- conflict trace output

Suggested precedence order:
1. truth/safety hard blocks
2. embodiment safety constraints
3. homeostasis protective constraints
4. plasticity rollback/anchor constraints
5. routing decisions
6. modulation tempo/depth adjustments
7. workspace/operator presentation constraints

## Target files
Create:
- `cortex_server/modules/governance_arbitration.py`

Touch:
- `cortex_server/modules/governance_compiler.py`
- `cortex_server/modules/runtime_constraint_compiler.py`
- `cortex_server/modules/reasoning_runtime_explain.py`

## Acceptance criteria
- every conflicting runtime field has a visible winner
- losing recommendations are preserved in trace form
- explain surfaces can show why a choice won

## Test targets
Create:
- `tests/test_governance_arbitration.py`

Include explicit conflicts such as:
- truth block vs routing fastlane
- embodiment pause vs modulation speed
- homeostasis protect vs routing fastlane
- plasticity rollback bias vs normal routing

---

# Ticket 6 — Normalize explain atoms and subsystem activation summaries

## Goal
Replace repeated per-subsystem summary builders with a generic explain model.

## Deliverables
Create logic that compiles:
- subsystem activations
- governance signals
- constraint decisions
- explain atoms
- operator summary rows

## Target files
Create:
- `cortex_server/modules/explain_compiler.py`

Touch:
- `cortex_server/modules/reasoning_runtime_explain.py`
- `cortex_server/modules/reasoning_explain.py`
- `cortex_server/modules/reasoning_observability.py`

## Acceptance criteria
- explain generation is mostly data-driven
- subsystem summaries are derived from shared contracts where possible
- duplicated summary formatting shrinks meaningfully

## Test targets
Create:
- `tests/test_explain_compiler.py`

---

# Ticket 7 — Build unified control-plane/explain response

## Goal
Produce one process explain response that feels like the OS talking about itself.

## Deliverables
Add a unified explain response structure with sections like:
- `epistemic_state`
- `subsystem_activations`
- `governance_signals`
- `constraint_stack`
- `decision_path`
- `runtime_effects`
- `policy_outcome_summary`
- `postmortem`

## Target files
Touch:
- `cortex_server/modules/reasoning_runtime_explain.py`
- `cortex_server/modules/reasoning_explain.py`
- `cortex_server/routers/orchestrator.py` if API shape changes

## Acceptance criteria
- one API response can explain the final decision path coherently
- conflict-resolution trace appears in operator-visible output
- subsystem influence is represented generically, not as stitched special cases

## Test targets
Create:
- `tests/test_reasoning_unified_explain_surface.py`

---

# Ticket 8 — World-state native planning hooks

## Goal
Make world state shape planning structure, not just runtime caution.

## Deliverables
Add planning hooks so world-state context can influence:
- dependency ordering
- step grouping
- plan decomposition confidence
- durable process recommendation

## Target files
Touch:
- `cortex_server/modules/reasoning_planner.py`
- `cortex_server/modules/reasoning_policy.py`
- `services/world_state/update_pipeline.py`
- `services/world_state/snapshot_manager.py`

## Acceptance criteria
- world-state context changes plan structure in at least one testable way
- trace/explain output shows that influence explicitly

## Test targets
Create:
- `tests/test_reasoning_world_state_planning.py`

---

# Ticket 9 — Truth-engine native claim/output hooks

## Goal
Make truth engine govern output semantics directly, not just verification posture.

## Deliverables
Introduce truth-engine hooks for:
- step result confidence tagging
- claim emission qualification
- output blocking/clarification semantics
- explainable contradiction pressure

## Target files
Touch:
- `cortex_server/modules/reasoning_runtime_execution.py`
- `cortex_server/modules/reasoning_explain.py`
- `services/truth_engine/calibration_model.py`
- `services/truth_engine/confabulation_detector.py`
- `services/truth_engine/pre_send_guard.py`

## Acceptance criteria
- output semantics change materially when truth-engine signals demand it
- explain surface shows truth-engine effect on final claim posture

## Test targets
Create:
- `tests/test_reasoning_truth_engine_hooks.py`

---

# Ticket 10 — Modulation native planner/runtime hooks

## Goal
Let modulation shape decomposition strategy and reasoning depth more natively.

## Deliverables
Use modulation to influence:
- planner decomposition depth
- chain complexity guidance
- timeout/parallelism reasoning through shared constraints instead of ad hoc mutation only

## Target files
Touch:
- `cortex_server/modules/reasoning_planner.py`
- `cortex_server/modules/reasoning_policy.py`
- `services/modulation/policy_runtime.py`
- `services/modulation/adaptive_depth_controller.py`

## Acceptance criteria
- modulation changes planning shape in at least one scenario
- runtime constraint effect is compiler-driven, not only special-cased

## Test targets
Create:
- `tests/test_reasoning_modulation_hooks.py`

---

# Ticket 11 — Workspace native decomposition / operator hooks

## Goal
Use workspace specialization more structurally.

## Deliverables
Make workspace affect:
- specialist decomposition
- role selection in multi-step plans
- operator-facing message/broadcast prioritization

## Target files
Touch:
- `cortex_server/modules/reasoning_planner.py`
- `cortex_server/modules/reasoning_runtime_explain.py`
- `services/workspace/arbitration_engine.py`
- `services/workspace/broadcast_policy.py`

## Acceptance criteria
- workspace selection visibly changes decomposition or execution path
- operator view reflects workspace-selected emphasis

## Test targets
Create:
- `tests/test_reasoning_workspace_hooks.py`

---

# Ticket 12 — Plasticity native adaptation hooks

## Goal
Make plasticity influence adaptation/memory behavior directly.

## Deliverables
Use plasticity signals for:
- rollback bias
- adaptation caution
- memory write-back policy
- continual evaluation annotations in postmortems

## Target files
Touch:
- `cortex_server/modules/reasoning_observability.py`
- `cortex_server/modules/reasoning_runtime_explain.py`
- `services/plasticity/continual_eval.py`
- `services/plasticity/forgetting_alerts.py`
- `services/plasticity/replay_scheduler.py`

## Acceptance criteria
- plasticity alerts materially affect adaptation/reporting behavior
- explain/postmortem surfaces show why

## Test targets
Create:
- `tests/test_reasoning_plasticity_hooks.py`

---

# Ticket 13 — Embodiment native interruption/situational hooks

## Goal
Make embodiment affect runtime control flow more directly.

## Deliverables
Use embodiment for:
- interruption semantics
- pause/resume posture
- environment-sensitive plan constraints
- situational risk projection

## Target files
Touch:
- `cortex_server/modules/reasoning_runtime_service.py`
- `cortex_server/modules/reasoning_runtime_execution.py`
- `cortex_server/modules/reasoning_planner.py`
- `services/embodiment/integration_hooks.py`
- `services/embodiment/episode_orchestrator.py`

## Acceptance criteria
- embodiment risk can interrupt or reshape process control flow natively
- explain surface clearly shows embodiment as an operating input, not just a summary

## Test targets
Create:
- `tests/test_reasoning_embodiment_hooks.py`

---

# Ticket 14 — Add full-stack scenario suite

## Goal
Prove the system behaves as one OS under realistic integrated scenarios.

## Deliverables
Create scenario tests for:
- epistemic stress
- operator risk
- adaptive learning instability
- arbitration conflict cases
- full unified flow

## Target files
Create:
- `tests/test_reasoning_scenario_epistemic_stress.py`
- `tests/test_reasoning_scenario_operator_risk.py`
- `tests/test_reasoning_scenario_adaptation_stability.py`
- `tests/test_reasoning_scenario_arbitration.py`
- `tests/test_reasoning_scenario_full_stack.py`

Potential supporting fixtures:
- `tests/fixtures/reasoning_scenarios/`

## Acceptance criteria
- at least one full-stack scenario activates most subsystem families in one run
- explain/postmortem outputs are asserted, not just success/failure

---

# Ticket 15 — Canonical architecture doc pass

## Goal
Make the system legible to a fresh reader.

## Deliverables
Create or refresh:
- `docs/REASONING_OS_ARCHITECTURE.md`
- `docs/REASONING_OS_EXPLAINABILITY.md`
- `docs/ROADMAP_STATE.md`

Touch/refine:
- `docs/REASONING_OS.md`
- `docs/PHASE_A_TO_E_AUDIT_2026-03-29.md`
- `docs/PHASE_A_TO_E_INTEGRATION_PLAN.md`

## Acceptance criteria
- docs reflect live reality exactly
- canonical contracts and arbitration model are documented
- outdated “reference-only” or stale language is removed

---

# Ticket 16 — Beauty refactor pass

## Goal
Reduce architectural friction after semantics are stable.

## Deliverables
Refactor to:
- shrink large module functions
- consolidate repeated summary/default logic
- reduce branch complexity
- isolate subsystem adapters and compilers

## Primary target files
Refactor/split as needed:
- `cortex_server/modules/reasoning_policy.py`
- `cortex_server/modules/reasoning_runtime_execution.py`
- `cortex_server/modules/reasoning_runtime_explain.py`
- `cortex_server/modules/reasoning_explain.py`

Possible extraction targets:
- `cortex_server/modules/policy_inputs/`
- `cortex_server/modules/explain_blocks/`
- `cortex_server/modules/runtime_controls/`

## Acceptance criteria
- each major module has a clearer single responsibility
- adding a new subsystem does not require invasive edits across many files
- diff complexity for future subsystem changes is notably reduced

---

# Ticket 17 — Final elegance audit

## Goal
Validate that the system now deserves the “integrated and elegant” label.

## Deliverables
Run:
- broad regression suite
- full scenario suite
- architecture doc verification
- explainability review against canonical contracts

Create:
- `docs/REASONING_OS_ELEGANCE_AUDIT_2026-03-30.md` (or later date if done later)

## Acceptance criteria
The audit can honestly say:
- runtime decisions resolve through one visible governance model
- explainability is unified
- subsystem contracts are normalized
- restored phases participate natively, not just through overlays
- docs, tests, and code all tell the same story

---

# Recommended first implementation batch

If this were started immediately, I’d do these first in one focused sequence:

## Batch A
- Ticket 1 — canonical contracts
- Ticket 2 — subsystem adapters
- Ticket 3 — governance compiler

## Batch B
- Ticket 4 — runtime constraint compiler
- Ticket 5 — arbitration model

## Batch C
- Ticket 6 — explain compiler
- Ticket 7 — unified explain surface

That would create the architectural backbone before doing more subsystem-specific native hooks.

---

# Risk notes

## Main risk
Trying to do native subsystem hooks before normalization may create a second generation of special-case wiring.

## Guardrail
Do not deepen subsystem-specific branching until:
- contracts exist,
- compiler exists,
- arbitration exists.

## Refactor discipline
Prefer:
- add adapter
- add compiler
- migrate one subsystem at a time
- preserve output compatibility while moving logic inward

Avoid:
- giant rewrite of all policy/runtime/explain code in one patch

---

# Suggested success metrics

## Architecture metrics
- smaller `reasoning_policy.py`
- smaller `reasoning_runtime_execution.py`
- fewer subsystem-specific conditionals in runtime path
- explicit arbitration traces available

## Product metrics
- one unified explain response
- clear decision-path summaries
- easier subsystem extension

## Testing metrics
- scenario suite green
- broad regression suite remains green
- arbitration conflicts explicitly covered

---

# Short recommendation

If the goal is *perfect elegance*, the highest-value next move is not another subsystem feature.

It is this:

> **Build the canonical contracts and governance compiler first.**

That is the step that turns the current integrated system into a system with a clean architectural center of gravity.
