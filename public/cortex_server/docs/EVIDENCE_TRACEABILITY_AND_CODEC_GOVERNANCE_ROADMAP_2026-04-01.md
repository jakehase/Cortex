# Evidence, Traceability, and Codec Governance Roadmap — 2026-04-01

## Purpose
Take the current system from **rich but fragmented** to **coherent, traceable, governable, and operator-safe**.

This roadmap is specifically about tightening the architecture around five priorities:

1. a single canonical event schema
2. a single traceability story from raw action → report → codec rollup → operator UI
3. a clear contract for:
   - raw evidence
   - inferred state
   - learned preference
   - operator override
4. per-layer disable switches that are easy to reason about
5. redaction/safety rules for the richer live trace layer

The intent is not to remove ambition.
The intent is to make the ambition legible, auditable, and safe.

---

# North Star
At the end of this roadmap, an operator should be able to pick any runtime decision, memory artifact, or live Mission Control trace and answer:

- **What raw events happened?**
- **What higher-level state was inferred from them?**
- **What durable memory/codec rollup was produced?**
- **What operator-visible UI/report reflected that?**
- **What safety/redaction rules touched the data?**
- **What layer was enabled or disabled at the time?**

A stronger formulation:

> No important runtime conclusion should exist without an auditable path back to raw evidence and an explicit statement of which layers transformed it.

---

# Executive diagnosis

## What is already strong
- Mission Control now exists as a real runtime/operator surface.
- Runtime processes, shared state, mailbox, and leases provide real coordination primitives.
- Codec policy and codec rollup logic are ambitious and more evidence-aware than naive summarization.
- Live activity traces are beginning to expose real execution evidence instead of narrative-only summaries.

## What is still weak
- Event shapes vary by subsystem and by reporting surface.
- The path from **runtime event** to **report** to **codec memory** to **UI** is not yet one explicit contract chain.
- Raw evidence, inferred state, learned preference, and operator override are still too easy to blur together.
- Multiple layers can adapt or override behavior, but the enable/disable model is not yet unified enough.
- Rich live traces are becoming useful faster than the redaction/safety model is maturing.

## Main architectural gap
The system has real pieces, but not yet a single canonical evidence model.

Right now, the architecture is closer to:
- many useful subsystems producing partially overlapping facts

The target architecture is:
- one canonical event substrate
- one typed state/inference substrate
- one operator-facing traceability chain
- one explicit safety/redaction layer
- one clear runtime capability toggle surface

---

# Core doctrine

## 1. Raw evidence is sacred
Raw evidence must be preserved separately from interpretation.

Examples:
- command started / finished
- stdout / stderr chunks
- file writes
- git diffs
- test results
- mailbox messages
- lease heartbeats
- shared-state revisions

These are observations.
They may be incomplete.
They may be noisy.
But they must not be silently rewritten into “truth.”

## 2. Inference must be typed and attributed
If the system concludes:
- “agent is blocked”
- “user prefers replies to start with [Cortex]”
- “this archetype benefits from codec”
- “this open loop is still active”

then that conclusion must carry:
- provenance
- confidence
- freshness
- source evidence references
- generating subsystem

## 3. Learned preference is not the same thing as truth
Preferences are not world facts.
Policies are not evidence.
Rollups are not the same as raw events.
The architecture should make that impossible to confuse.

## 4. Operator override must be visible and dominant
When a human or operator override exists, it should be explicitly marked as an override layer — not disguised as autonomous inference.

## 5. Redaction is a first-class transformation
Redaction is not a UI afterthought.
It is part of the evidence lifecycle.
The system must know:
- what was captured
- what was stored
- what was redacted
- what was shown to which surface

---

# Target architectural model

## The evidence pipeline
The target end-to-end model:

1. **Raw action/event layer**
   - commands
   - output chunks
   - file operations
   - mailbox traffic
   - process lifecycle changes
   - state revisions

2. **Normalized event layer**
   - canonical typed event envelope
   - schema versioning
   - consistent actor/process/objective references

3. **Derived state layer**
   - inferred process state
   - inferred blockers
   - inferred active work / ownership
   - inferred task health

4. **Durable memory / codec layer**
   - extracted preferences
   - active projects
   - open loops
   - lessons
   - durable facts
   - codec policy outcomes

5. **Operator surface layer**
   - Mission Control live timeline
   - reports
   - explain surfaces
   - postmortems
   - policy status views

6. **Safety / redaction layer**
   - storage redaction
   - presentation redaction
   - access-tier filtering
   - event retention rules

7. **Capability control layer**
   - per-layer enable/disable switches
   - dry-run / shadow modes
   - tracing verbosity control
   - codec rollout control

---

# Canonical contracts

## 1. `RuntimeEvent`
The canonical append-only event envelope.

### Required fields
- `event_id`
- `schema_version`
- `event_kind`
- `ts`
- `process_id`
- `objective_key` (optional but preferred)
- `agent_id` (optional)
- `scope` (optional)
- `source_subsystem`
- `payload`

### Standard metadata fields
- `correlation_id`
- `causal_parent_ids`
- `session_key`
- `repo_path`
- `visibility`
- `redaction_level`
- `storage_policy`
- `presentation_policy`

### Event families
- process lifecycle
- command execution
- output stream
- file/artifact
- git/test evidence
- mailbox/handoff
- lease/heartbeat
- shared-state revision
- report emission
- codec extraction
- operator action
- redaction action
- capability-toggle action

### Exit criteria
- all new events conform to `RuntimeEvent`
- legacy events are either migrated or explicitly mapped
- Mission Control consumes normalized events, not ad hoc payload shapes

---

## 2. `DerivedStateFact`
Represents interpreted runtime state derived from evidence.

### Required fields
- `fact_id`
- `fact_kind`
- `subject_ref`
- `value`
- `confidence`
- `freshness_seconds` or `observed_window`
- `source_event_ids`
- `source_subsystem`
- `generated_at`

### Examples
- current active task for an agent
- blocker present
- process appears stalled
- release stage advanced
- lease appears stale

### Exit criteria
- Mission Control “current state” views are backed by explicit `DerivedStateFact` rows or equivalent typed structures
- every derived UI claim can point back to source events

---

## 3. `CodecMemoryFact`
Represents durable memory produced from rollup/codec logic.

### Required fields
- `memory_id`
- `memory_kind`
- `value`
- `confidence`
- `durability_class`
- `retention_priority`
- `source_refs`
- `rollup_method`
- `session_count`
- `revision_chain`
- `supersedes`
- `generated_at`

### Memory kinds
- preference
- active_project
- active_goal
- open_loop
- durable_fact
- pattern
- lesson

### Exit criteria
- codec outputs become first-class typed rows instead of semi-implicit summaries
- learned preference and durable fact are distinct types
- every durable memory artifact names its evidence inputs

---

## 4. `OperatorOverride`
Represents a human/operator-imposed override.

### Required fields
- `override_id`
- `scope`
- `override_kind`
- `value`
- `actor`
- `reason`
- `created_at`
- `expires_at` (optional)
- `source_surface`
- `supersedes` (optional)

### Examples
- pause objective
- disable codec for archetype
- suppress trace output for a scope
- acknowledge blocker
- force human review

### Exit criteria
- overrides are queryable as a distinct layer
- override state is never silently blended into learned preference or inferred state

---

# Roadmap

## Phase 1 — Canonical event schema
### Goal
Make event production consistent enough that every other layer has stable input.

### Deliverables
- define `RuntimeEvent` schema and versioning rules
- define canonical event families and naming conventions
- add an event normalization utility for legacy emitters
- add schema validation tests for emitted events
- add event examples to docs

### Specific work
- unify current runtime event kinds under one naming convention
- standardize fields like:
  - `agent_id`
  - `scope`
  - `objective_key`
  - `process_id`
  - `source_subsystem`
- attach correlation/causal metadata where possible
- mark visibility/redaction intent at emission time

### Exit criteria
- Mission Control timeline can assume one event envelope
- new runtime/tool/lab traces all land in canonical form
- test fixtures cover representative event families

---

## Phase 2 — Single traceability chain
### Goal
Make the path from raw action to UI/report/memory explicit.

### Deliverables
- define a traceability contract:
  - `raw event` → `derived state` → `report` → `codec memory` → `operator surface`
- add stable references between those layers
- create a traceability viewer/API for a process or memory fact
- update Mission Control to show evidence lineage

### Suggested API surfaces
- `GET /runtime/processes/{process_id}/traceability`
- `GET /mission_control/objectives/{objective_key}/lineage`
- `GET /codec/memory/{memory_id}/lineage`

### Operator questions this should answer
- which raw events caused this report?
- which report or event produced this codec memory fact?
- which UI badge is inferred vs observed?
- what got redacted before display?

### Exit criteria
- one process page can show observed vs inferred vs rolled-up artifacts distinctly
- one memory fact can be traced back to source evidence

---

## Phase 3 — State contract separation
### Goal
Make the architecture explicit about what kind of “thing” each piece of information is.

### Deliverables
- document and enforce four distinct state classes:
  1. raw evidence
  2. inferred state
  3. learned preference / codec memory
  4. operator override
- add typed storage or typed envelope conventions for each
- prevent accidental promotion across class boundaries without attribution

### Rules
- raw evidence cannot be overwritten by inference
- inferred state must cite evidence
- learned preference must cite rollup/evidence lineage
- operator overrides must be dominant and clearly labeled

### Exit criteria
- no Mission Control field is ambiguous about its class
- explain surfaces can group values by class
- tests enforce class separation semantics

---

## Phase 4 — Capability and disable-switch unification
### Goal
Make it easy to understand, disable, shadow, or limit each adaptive layer.

### Deliverables
- one capability/control matrix for:
  - codec policy
  - codec rollup promotion
  - runtime tracing
  - output chunk capture
  - redaction strictness
  - Mission Control live evidence panes
  - archetype-based rollout
- support modes like:
  - disabled
  - enabled
  - shadow
  - read-only
  - operator-gated

### Suggested control surface
A canonical config/status object like:
- `event_capture`
- `derived_state_generation`
- `codec_policy_adaptation`
- `codec_rollup_promotion`
- `operator_override_enforcement`
- `ui_live_trace_rendering`
- `redaction_mode`

### Exit criteria
- operator can answer “what is turned on?” in one place
- weird behavior can be narrowed to a specific enabled layer
- shadow-mode experiments become easy

---

## Phase 5 — Redaction and safety model
### Goal
Make richer live traces safe enough to scale.

### Deliverables
- define redaction classes for event payloads
- define storage-time vs display-time redaction
- define surface-specific presentation rules
- define retention policies for sensitive payloads
- add a redaction audit trail

### Proposed sensitivity classes
- `public_safe`
- `operator_safe`
- `sensitive_local`
- `credential_like`
- `secret_never_display`

### Proposed transformation stages
1. raw captured payload
2. storage redaction pass
3. lineage-preserving redacted event
4. surface-specific presentation pass
5. operator audit view of what was suppressed

### Exit criteria
- stdout/stderr/file diffs can be captured without reckless leakage
- Mission Control can show evidence safely by default
- redaction behavior is testable and documented

---

## Phase 6 — Operator surfaces and explainability unification
### Goal
Make the UI reflect the architecture cleanly.

### Deliverables
- Mission Control sections explicitly grouped by:
  - observed evidence
  - inferred state
  - learned memory
  - operator overrides
- lineage drill-down from any row
- visual labeling for redacted content
- per-layer enable/disable status visible in UI

### Exit criteria
- operators do not need to guess what kind of truth they are looking at
- the UI itself teaches the architecture

---

## Phase 7 — Codec governance hardening
### Goal
Make codec powerful without letting it become an opaque authority.

### Deliverables
- require lineage for all promoted codec artifacts
- add confidence/freshness display for codec memory
- add explicit supersession/revision visualization
- separate preferences from world facts from active open loops
- attach rollout policy status to codec-derived decisions

### Key questions codec should always answer
- why do we believe this?
- how durable is it?
- what evidence supports it?
- was this operator-specified or learned?
- what replaced it, if anything?

### Exit criteria
- codec memory is visibly useful and visibly bounded
- operators can audit memory without reverse-engineering internals

---

# Recommended implementation order

## Slice A — Foundations
Do first:
- canonical `RuntimeEvent`
- state class definitions
- capability matrix draft

Reason:
Without this, everything else is downstream cleanup on unstable shapes.

## Slice B — Traceability path
Do second:
- lineage APIs
- references from report/memory/UI back to events
- Mission Control lineage section

Reason:
This is where the architecture becomes legible.

## Slice C — Safety hardening
Do third:
- redaction classes
- storage/display redaction
- retention rules for sensitive event payloads

Reason:
The juicy trace layer should not outpace its safety model.

## Slice D — Codec hardening
Do fourth:
- typed codec memory outputs
- codec lineage and supersession views
- policy/rollout visibility

Reason:
Codec gets much stronger once the evidence model under it is clean.

## Slice E — UI polish and operator ergonomics
Do last:
- cleaner operator views
- toggles/status in UI
- explicit observed/inferred/learned/override grouping

Reason:
Polish is much easier after the contracts stabilize.

---

# Concrete milestones

## Milestone 1 — Event substrate complete
- canonical event schema merged
- new events validated
- legacy event mapping documented

## Milestone 2 — Lineage available
- one API path from objective/process to evidence lineage
- Mission Control can show lineage drill-down

## Milestone 3 — State classes enforced
- raw vs inferred vs learned vs override visibly separated
- tests enforce non-blending rules

## Milestone 4 — Redaction safe-by-default
- rich trace capture exists with storage/display policies
- sensitive fields do not leak into operator surfaces by default

## Milestone 5 — Codec governable and auditable
- codec artifacts are typed, traced, revisable, and bounded

---

# Suggested first tickets

## Ticket 1
Define `RuntimeEvent` schema and add validation helpers.

## Ticket 2
Introduce `source_subsystem`, `visibility`, and `redaction_level` to emitted events.

## Ticket 3
Create `DerivedStateFact`, `CodecMemoryFact`, and `OperatorOverride` typed models.

## Ticket 4
Add `/traceability` or `/lineage` endpoint for a process/objective.

## Ticket 5
Update Mission Control to visually separate:
- observed evidence
- inferred state
- learned memory
- overrides

## Ticket 6
Create a redaction policy module and test it against stdout/stderr/diff/file payloads.

## Ticket 7
Expose a unified capability matrix/status surface.

## Ticket 8
Make codec rollups emit explicit lineage references and supersession metadata.

---

# Anti-goals
To stay disciplined, do **not** let this roadmap turn into:
- more clever heuristics without stronger contracts
- UI embellishment before lineage exists
- broader trace capture before redaction rules exist
- codec promotion getting more aggressive before its provenance is clearer
- multiple overlapping event formats surviving indefinitely

---

# Final framing
This roadmap is not about making the system less ambitious.
It is about making the ambition **structural** instead of **improvised**.

The desired result is a system where:
- runtime behavior is observable,
- memory formation is auditable,
- operator control is explicit,
- safety transformations are first-class,
- and “why did this happen?” has one coherent answer path.

That is the difference between a powerful collection of mechanisms and an actual reasoning runtime.
