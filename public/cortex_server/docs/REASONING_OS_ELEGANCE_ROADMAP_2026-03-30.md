# Reasoning OS Elegance Roadmap — 2026-03-30

## Purpose
Move the current system from **real and integrated** to **coherent, elegant, and obviously unified**.

This roadmap assumes the current baseline is now true:
- Reasoning OS core is real and passing.
- Phases A–E are present as live implementation surfaces.
- R7/homeostasis and R9/routing are the strongest runtime-integrated subsystems.
- Restored A/B/C surfaces now influence policy/runtime/explain layers, but the integration still feels more like **policy plumbing** than a fully native architectural unification.

## North Star
At the end of this roadmap, a fresh reader should be able to say:

> This is one coherent operating system for reasoning and execution, not a reasoning core with a collection of attached subsystems.

More concretely, the final system should have:
- one intelligible runtime contract,
- one canonical policy/governance surface,
- one explainability model,
- one consistent set of typed subsystem interfaces,
- end-to-end evidence that all major subsystems influence live behavior in auditable ways,
- and docs that describe the system exactly as it exists.

---

# Executive diagnosis

## What is already strong
1. **The core reasoning runtime is real.**
2. **R7 and R9 are genuinely integrated into live behavior.**
3. **A/B/C are no longer just roadmap archaeology.**
4. **The test surface is broad enough to support real refactoring.**

## What still feels inelegant
1. **Integration is spread across settings/overlays rather than unified contracts.**
2. **Subsystems expose different shapes and semantics.**
3. **Explain surfaces are broad, but not yet deeply normalized.**
4. **The runtime still lacks a single “why did the OS do this?” control plane narrative across all phases.**
5. **Docs are closer, but not yet reduced to a clean architectural story.**

## Main architectural gap
The repo now has real subsystem integration, but not yet a fully generalized layer like:
- `governance_context`
- `runtime_constraints`
- `epistemic_state`
- `operator_surface`
- `adaptation_loop`

Instead, multiple subsystems still feed runtime via subsystem-specific settings and summaries. That works, but elegance comes from **normalization**.

---

# Roadmap

## Phase 1 — Normalize subsystem contracts

### Goal
Replace subsystem-specific ad hoc shapes with one shared contract model.

### Deliverables
Create canonical typed envelopes for all major phase subsystems.

Suggested canonical contracts:

#### 1. `EpistemicContext`
Shared representation for truth/world-state/belief confidence:
- confidence
- freshness
- contradiction count
- provenance strength
- uncertainty
- affected entities/claims

#### 2. `GovernanceSignal`
Shared representation for subsystem recommendations:
- source subsystem
- signal kind
- severity
- recommended action
- blocking vs advisory
- rationale
- confidence

#### 3. `RuntimeConstraintSet`
Shared runtime control plane:
- execution mode
- max parallelism
- verification mode
- step timeout
- same-tick drain
- rollback bias
- human review requirement
- escalation recommendation

#### 4. `ExplainAtom`
Shared explainability primitive:
- subsystem
- decision influence
- observed evidence
- expected effect
- actual effect
- mismatch reason if any

### Why it matters
Right now, elegance is limited because each subsystem partially reinvents its own runtime/explain shape. Once contracts are normalized, the system becomes much easier to reason about, extend, and document.

### Exit criteria
- all major subsystems map into shared contracts
- runtime overlays consume normalized contracts rather than subsystem-specific fields directly
- explain surfaces can render subsystem influence generically

---

## Phase 2 — Unify policy synthesis into one governance compiler

### Goal
Refactor policy construction from “many subsystem loaders + settings mutations” into a cleaner compiler model.

### Target model
Turn `build_workflow_policy()` into a pipeline like:
1. collect subsystem inputs
2. normalize them into canonical contracts
3. synthesize governance signals
4. compile runtime constraints
5. emit one policy object with a stable schema

### Deliverables
Introduce a conceptual layer like:
- `policy_inputs/`
- `governance_compiler.py`
- `runtime_constraint_compiler.py`
- `explain_compiler.py`

### Why it matters
This is the single highest-value elegance move.

It changes the architecture from:
- “policy function with many embedded subsystem branches”

to:
- “compiler pipeline that turns reasoning signals into runtime policy.”

That is much easier to understand, maintain, and extend.

### Exit criteria
- `build_workflow_policy()` becomes orchestration rather than accumulation logic
- subsystem loaders are small and isolated
- constraint precedence is explicit and documented
- policy schema is stable and versioned

---

## Phase 3 — Make precedence and conflict resolution first-class

### Goal
Make it explicit how conflicting subsystem recommendations are resolved.

### Current implicit conflicts
Examples:
- homeostasis wants caution
- routing wants research chain
- modulation wants deeper reasoning
- embodiment wants pause noncritical work
- truth engine wants block/clarify
- plasticity wants rollback bias

Right now, much of this is resolved procedurally. Elegance requires a visible arbitration model.

### Deliverables
Create a first-class precedence/arbitration layer.

Suggested order:
1. hard safety / truth blocking
2. embodiment safety constraints
3. homeostasis protective constraints
4. plasticity rollback/anchor constraints
5. routing choice
6. modulation tempo/depth adjustments
7. workspace/broadcast/operator presentation

### Additions
- explicit precedence table in code
- explicit precedence table in docs
- runtime trace of which subsystem won each conflict
- test cases for conflict arbitration

### Exit criteria
- every constraint conflict has a documented resolution path
- explain surfaces can say not just *what happened* but *why one subsystem overrode another*

---

## Phase 4 — Build a truly unified explainability surface

### Goal
Make the system explain itself as one OS.

### Deliverables
Add a unified operator/explain view that answers:
- what task state was observed?
- which subsystems activated?
- what signals did they emit?
- which constraints were compiled?
- which conflicts occurred?
- what runtime behavior changed?
- what was the final decision path?

### Ideal output model
For any process, one response should show:
- **epistemic state** — world model, truth calibration, contradiction posture
- **governance state** — homeostasis, routing, modulation, embodiment, plasticity
- **runtime constraints** — what actually changed execution semantics
- **decision causality** — what evidence mattered most
- **postmortem view** — what mismatched and what to tune

### Why it matters
Right now the system is explainable in pieces. The next level is making the explanation feel like one control panel, not several stitched reports.

### Exit criteria
- one unified process explain page/API response
- generic subsystem explain blocks
- conflict-resolution explanation included
- operator-facing summaries are concise and stable

---

## Phase 5 — Convert restored subsystems from overlays to native runtime participants

### Goal
Reduce the sense that restored A/B/C subsystems are “feeding the runtime from the outside.”

### Target
Subsystems should become native participants in planning/runtime rather than only policy modifiers.

### Examples
- **World state** should shape plan structure and dependency decisions, not just verification strictness.
- **Truth engine** should shape claim emission and step result confidence semantics, not just guard action flags.
- **Modulation** should influence planner depth and decomposition strategy, not only timeout/parallelism.
- **Workspace** should affect specialist decomposition and message selection more structurally.
- **Plasticity** should influence adaptation memory write-back and rollback posture directly.
- **Embodiment** should feed situational constraints into task planning and process interruption semantics.

### Exit criteria
- each subsystem has at least one native planning/runtime hook beyond settings mutation
- runtime traces show direct participation, not only derived settings

---

## Phase 6 — Strengthen end-to-end scenario proof

### Goal
Prove the elegance claim under realistic scenarios.

### Scenario suites to add

#### Suite A — Epistemic stress
- degraded world-state confidence
- contradictory claims
- truth engine blocks/clarifies
- explain surface shows epistemic cause chain

#### Suite B — Operator risk
- embodiment intervention
- homeostasis protective mode
- routing forced deliberate
- runtime pauses noncritical work
- explain surface shows constraint stack

#### Suite C — Adaptive learning stability
- plasticity alert
- rollback recommendation
- operator override
- postmortem shows adaptation mismatch

#### Suite D — Fastlane vs deliberate arbitration
- modulation wants depth
- routing wants fastlane
- homeostasis is normal
- system explains final selection cleanly

#### Suite E — Full unified flow
One scenario where all major subsystem families participate in one task:
- world state
- truth engine
- routing
- modulation
- homeostasis
- workspace
- plasticity
- embodiment
- explain/postmortem

### Exit criteria
- one or more end-to-end tests prove the full stack behaves as a coherent OS
- scenario docs exist alongside tests

---

## Phase 7 — Simplify and harden docs

### Goal
Make the architecture legible to a new reader in under 15 minutes.

### Deliverables
Create a minimal canonical doc set:

1. **REASONING_OS.md**
   - what the OS is
   - core loop
   - policy/runtime relationship

2. **REASONING_OS_ARCHITECTURE.md**
   - major subsystems
   - canonical contracts
   - arbitration model

3. **REASONING_OS_EXPLAINABILITY.md**
   - explain model
   - operator views
   - postmortem/adaptation loop

4. **ROADMAP_STATE.md**
   - what is landed
   - what is integrated
   - what remains

### Documentation rule
Retire stale “maybe/adjacent/reference-only” language once code reality changes. No more drift.

### Exit criteria
- docs match the live tree exactly
- subsystem relationships are clear without reading implementation first

---

## Phase 8 — Refactor for beauty, not just correctness

### Goal
Once the semantics are stable, make the code feel inevitable.

### Refactor targets
- reduce giant policy functions
- isolate subsystem adapters
- isolate contract normalization
- isolate conflict arbitration
- isolate explain compilers
- reduce copy/paste summary builders
- consolidate repeated summary/default structures

### Standards for “beautiful enough”
- each major file has one obvious job
- precedence rules are centralized
- summary/explain generation is mostly generic
- adding a new subsystem should feel routine, not invasive

### Exit criteria
- significantly smaller policy/runtime files
- lower branching complexity
- subsystem onboarding path documented and tested

---

# Priority ordering

## Priority 1
**Canonical contracts + governance compiler**

This is the highest leverage elegance move.

## Priority 2
**Conflict/preference arbitration model**

Without this, the system stays smart but murky.

## Priority 3
**Unified explainability/control-plane view**

This makes the architecture intelligible and defensible.

## Priority 4
**Native runtime participation for restored A/B/C subsystems**

This closes the remaining “overlay architecture” feel.

## Priority 5
**Scenario-based end-to-end proof**

This turns elegance from opinion into evidence.

## Priority 6
**Doc simplification and code-beauty refactors**

This is the polish layer once semantics are stable.

---

# Concrete next ticket sequence

## Ticket 1 — Define canonical contracts
Create shared dataclasses / typed dicts / pydantic models for:
- `EpistemicContext`
- `GovernanceSignal`
- `RuntimeConstraintSet`
- `ExplainAtom`

## Ticket 2 — Introduce governance compiler
Refactor policy assembly into:
- subsystem input collection
- normalized signal generation
- constraint compilation
- policy emission

## Ticket 3 — Add explicit arbitration table
- central precedence order
- conflict resolution tests
- explain output for winning/losing signals

## Ticket 4 — Unify explain surface
- one process explain response for all phases
- generic subsystem blocks
- constraint stack output

## Ticket 5 — Native hooks for A/B/C
- world-state planning hooks
- truth-engine claim/output hooks
- modulation planner hooks
- workspace decomposition hooks
- plasticity adaptation hooks
- embodiment interruption hooks

## Ticket 6 — Full-stack scenario suite
Add end-to-end scenarios where all major subsystem families shape a live task.

## Ticket 7 — Architecture doc pass
Collapse current docs into one clean canonical story.

## Ticket 8 — Beauty refactor
Shrink, isolate, and normalize the implementation.

---

# Definition of “perfectly elegant”
The system is “perfectly elegant” when all of these are true:

1. A new reader can understand the architecture quickly.
2. A runtime decision can be explained in one coherent narrative.
3. Subsystem conflicts resolve through one explicit model.
4. Subsystems participate through shared contracts, not ad hoc wiring.
5. Adding a subsystem requires low-friction integration.
6. Tests prove the OS behaves as one system, not a bundle of features.
7. Docs, runtime behavior, and code structure all tell the same story.

---

# Short verdict
The repo is now good enough to justify an elegance roadmap.

Before, the right question was:
- “Is this real?”

Now the right question is:
- “How do we make the real thing architecturally beautiful?”
