# Phase A–E Integration Plan

## Purpose
Close the remaining gap so that Phases A–E are not merely validated roadmap slices, but a genuinely integrated continuation of the Reasoning OS.

## Current state snapshot
Already completed in meaningful part:
- roadmap continuity docs restored for A–E
- Phase A bootstrap surfaces restored (`world_state`, `modulation`, `workspace`, `truth_engine`)
- Phase B bootstrap surface restored (`plasticity`)
- Phase C / R5 embodiment package restored
- Phase D / R9 routing package restored
- Phase E / R7 homeostasis package restored
- R9 integrated into live policy synthesis
- R9 integrated into live runtime execution + explain surfaces
- R7 integrated into live policy synthesis
- R7 integrated into live runtime execution + explain surfaces
- Step 11 runtime controls implemented
- Step 11 authorization + audit trails implemented
- Step 1 upgraded to prefer live rolling telemetry windows
- broad regression sweep refreshed green (`176 passed`)

Still open:
- A/B/C are restored and tested, but remain only lightly connected to the main runtime path compared with D/E
- C + D + E are all present, but not yet unified into one generalized governance/runtime layer with A/B
- end-to-end A–E proof is still incomplete

## Target outcome
At the end of this plan, the repo should support this stronger statement:

> The Reasoning OS core and the roadmap phases A–E operate as one coherent runtime layer, with live policy integration, operator controls, durable artifacts, and end-to-end execution tests.

## Success criteria

### Functional
- Phase A–E surfaces are restored or re-landed in the live checkout.
- Phase E / R7 influences the main reasoning runtime rather than only sidecar scripts.
- Phase D / R9 influences both live policy synthesis and live runtime execution.
- Restored A/B/C surfaces influence live reasoning/runtime behavior in auditable ways where appropriate.
- Operator freeze / rollback / resume controls mutate real runtime policy/governor state.
- Bootstrap artifact-derived baselines are replaced or augmented with live telemetry windows.
- Explain/analytics surfaces can show when and why homeostasis or routing changed a runtime decision.

### Verification
- Existing reasoning-core tests continue to pass.
- Existing Phase A/B/C restore tests continue to pass.
- Existing Phase D / R9 tests continue to pass.
- Existing Phase E / R7 tests continue to pass.
- New end-to-end integration tests pass, covering:
  1. task creation
  2. planning
  3. scheduling/runtime execution
  4. routing + homeostasis influence
  5. restored A/B/C subsystem influence where expected
  6. safety override / rollback
  7. explain/operator inspection

### Documentation
- Roadmap docs present for all phases A–E in the live checkout.
- Phase labels are internally consistent.
- Landed/not-landed language reflects reality.

---

# Workstreams

## Workstream 1 — Restore phase continuity in the live checkout

### Goal
Reconstruct the missing phase surfaces so the live repo contains the actual roadmap lineage instead of only Phase E.

### Status
- **Substantially done.**
- Roadmap continuity docs are restored.
- A/B/C implementation surfaces are back in the live tree.
- D/E implementation surfaces are back and further integrated.

### Remaining exit criteria
- keep restored surfaces maintained as real packages rather than letting them drift back into reference-only status.

---

## Workstream 2 — Integrate R7 into the live Reasoning OS policy path

### Goal
Make homeostasis part of the actual runtime decision loop.

### Status
- **Largely done.**
- R7 now participates in live policy synthesis, runtime execution, explain surfaces, operator controls, and telemetry baselines.

### Remaining exit criteria
- R7 behavior continues to compose cleanly with broader A–E unification work.

---

## Workstream 3 — Replace bootstrap-only baselines with live telemetry grounding

### Goal
Upgrade R7 Step 1 from artifact-derived scaffolding to live operational evidence.

### Status
- **Initial live rolling-window support done.**
- Step 1 now prefers live runtime telemetry and falls back to artifact bootstrap only when needed.

### Remaining exit criteria
- richer live-window evidence and drift comparisons as the runtime history deepens.

---

## Workstream 4 — Make Step 11 controls real

### Goal
Replace local-stub operator controls with actual controlled runtime actions.

### Status
- **Done for current Step 11 scope.**
- Freeze / rollback / resume are live runtime routes.
- Authorization and audit trails are present.

### Remaining exit criteria
- eventually fold these into a more generalized OS governance/operator layer.

---

## Workstream 5 — Reconcile roadmap docs with reality

### Goal
Remove drift between implementation and narrative.

### Status
- **In progress.**
- The old audit language lagged the restore work; docs need periodic refresh as the repo advances quickly.

### Remaining exit criteria
- roadmap docs and audits stay in sync with the live tree after each major integration slice.

---

## Workstream 6 — End-to-end integration proof

### Goal
Prove the later phase work is part of the OS rather than adjacent to it.

### Status
- **In progress.**
- Broad regression coverage is green.
- Full A–E proof is still incomplete.

### Remaining exit criteria
- the integrated system can be demonstrated end to end without relying on roadmap prose alone.

---

## Workstream 7 — R9 runtime absorption

### Goal
Carry restored Phase D routing into live policy synthesis, live runtime execution, and explain surfaces.

### Status
- **Done for first integrated slice.**
- R9 now participates in policy synthesis and runtime execution.
- Runtime/explain surfaces expose selected chain and routing influence.
- Runtime semantics were deliberately narrowed so only `research_grounded` forces sequential execution; `deliberate_council` affects runtime more lightly without breaking existing batching semantics.

### Remaining exit criteria
- continue harmonizing R9 with broader governance/runtime semantics rather than leaving it as an adjacent routing layer.

---

## Workstream 8 — Absorb restored A/B/C surfaces into the runtime path

### Goal
Move A/B/C from restored-and-tested packages to runtime-visible operating layers.

### Status
- **Open.**
- A/B/C now exist as live packages with dedicated tests.
- They do not yet show the same level of absorption into `reasoning_policy.py`, `reasoning_runtime_execution.py`, and explain/operator surfaces as D/E.

### Remaining exit criteria
- policy/runtime/explain surfaces expose where world-state, modulation, workspace, truth-engine, plasticity, or embodiment materially change live behavior.

---

# Remaining highest-value work

## Priority 1 — Runtime absorption for A/B/C
The biggest remaining gap is no longer missing code; it is missing integration.

## Priority 2 — Unify A–E into a broader governance/runtime layer
The repo now has real restored packages across A–E, but they still read as partially absorbed subsystems rather than one unified operating layer.

## Priority 3 — Strengthen end-to-end proof across the restored stack
The repo now has enough live surface area that stronger integrated proof should move the audit needle more than restoring more docs alone.

## Priority 4 — Keep docs synchronized with live state
The restore work is moving quickly enough that stale docs become misleading fast.

## Ticket history note
The original “start here” ticket — wiring R7 into `reasoning_policy` and explain surfaces — is done, and several follow-on slices are also done:
- R7 runtime enforcement
- Step 11 runtime controls
- Step 11 authorization + audit
- Step 1 live telemetry baselines
- Phase C / R5 embodiment restoration
- Phase D / R9 restoration
- R9 policy integration
- R9 runtime execution integration
- Phase A/B bootstrap restoration

## Completion definition
This plan is complete when a fresh audit can honestly conclude:
- the Reasoning OS core still passes,
- phases A–E are present and auditable in the live checkout,
- R7 and R9 both influence real runtime behavior,
- restored A/B/C surfaces also influence runtime behavior where expected,
- operator controls are real,
- baseline evidence is operational rather than bootstrap-only,
- and end-to-end tests prove the later phase work is truly part of the OS.
