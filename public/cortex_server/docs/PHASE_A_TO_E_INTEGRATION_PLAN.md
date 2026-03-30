# Phase A–E Integration Plan

## Purpose
Close the remaining gap so that Phases A–E are not merely validated roadmap slices, but a genuinely integrated continuation of the Reasoning OS.

## Current state snapshot
Already completed in meaningful part:
- roadmap continuity docs restored for A–D
- Phase C / R5 embodiment package restored
- Phase D / R9 routing package restored
- R9 integrated into live policy synthesis
- R9 integrated into live runtime execution + explain surfaces
- R7 integrated into live policy synthesis
- R7 integrated into live runtime execution + explain surfaces
- Step 11 runtime controls implemented
- Step 11 authorization + audit trails implemented
- Step 1 upgraded to prefer live rolling telemetry windows

Still open:
- A–B remain mostly reference/docs continuity rather than live implementation packages
- C + D + E are all present, but not yet unified into one generalized governance/runtime layer
- end-to-end A–E proof is still incomplete

## Target outcome
At the end of this plan, the repo should support this stronger statement:

> The Reasoning OS core and the roadmap phases A–E operate as one coherent runtime layer, with live policy integration, operator controls, durable artifacts, and end-to-end execution tests.

## Success criteria

### Functional
- Phase A–D surfaces are restored or re-landed in the live checkout.
- Phase E / R7 influences the main reasoning runtime rather than only sidecar scripts.
- Phase D / R9 influences both live policy synthesis and live runtime execution.
- Operator freeze / rollback / resume controls mutate real runtime policy/governor state.
- Bootstrap artifact-derived baselines are replaced or augmented with live telemetry windows.
- Explain/analytics surfaces can show when and why homeostasis or routing changed a runtime decision.

### Verification
- Existing reasoning-core tests continue to pass.
- Existing Phase D / R9 tests continue to pass.
- Existing Phase E / R7 tests continue to pass.
- New end-to-end integration tests pass, covering:
  1. task creation
  2. planning
  3. scheduling/runtime execution
  4. routing + homeostasis influence
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

### Status
- **Done in part:** roadmap continuity docs restored for A–D; live Phase D / R9 routing package restored with scripts, services, artifacts, contracts, and tests.
- **Still open:** A–C remain mostly reference/docs continuity, not runnable implementation packages.

### Remaining exit criteria
- A–C become visible in the live tree as auditable implementation packages, not just docs.

---

## Workstream 2 — Integrate R7 into the live Reasoning OS policy path

### Goal
Make homeostasis part of the actual runtime decision loop.

### Status
- **Largely done.**
- R7 now participates in live policy synthesis, runtime execution, explain surfaces, operator controls, and telemetry baselines.

### Remaining exit criteria
- R7 behavior continues to compose cleanly with later D/E unification work.

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
- Roadmap continuity is restored, but the audit/plan/docs need periodic refresh as the repo advances quickly.

### Remaining exit criteria
- roadmap docs and audits stay in sync with the live tree after each major integration slice.

---

## Workstream 6 — End-to-end integration proof

### Goal
Prove the later phase work is part of the OS rather than adjacent to it.

### Status
- **In progress.**
- Routing/runtime/homeostasis integration tests now exist.
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

# Remaining highest-value work

## Priority 1 — Restore more of A/B implementation surfaces
A–B are now the weakest part of the roadmap line.

## Priority 2 — Unify C + D + E into a more generalized governance layer
The repo now has real C, D, and E restorations/integrations, but they still read as partially absorbed subsystems rather than one unified operating layer.

## Priority 3 — Strengthen end-to-end proof across C/D/E
The repo now has enough live surface area that stronger integrated proof should move the audit needle more than restoring more docs alone.

## Priority 4 — Strengthen end-to-end proof
Add tests that demonstrate one task moving through:
- planning
- routing
- homeostasis
- runtime execution
- operator intervention
- explain/audit surfaces

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

## Completion definition
This plan is complete when a fresh audit can honestly conclude:
- the Reasoning OS core still passes,
- phases A–E are present and auditable in the live checkout,
- R7 and R9 both influence real runtime behavior,
- operator controls are real,
- baseline evidence is operational rather than bootstrap-only,
- and end-to-end tests prove the later phase work is truly part of the OS.
e later phase work is truly part of the OS.
