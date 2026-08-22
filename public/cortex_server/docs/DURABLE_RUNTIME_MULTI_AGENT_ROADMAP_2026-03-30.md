# Durable Runtime + Multi-Agent Continuity Roadmap — 2026-03-30

## Purpose
Define the next frontier beyond the integrated Reasoning OS:

> A durable, trustworthy, real-time cognitive runtime that can run for hours, coordinate multiple agents, survive interruptions, and avoid silent context loss.

This roadmap assumes the current baseline is already true:
- Cortex is the primary reasoning substrate.
- The 38 levels provide a rich cognitive repertoire.
- The integrated Reasoning OS now provides governance, runtime constraint compilation, arbitration, and explainability.
- The repo has already crossed the line from “promising architecture” into “real integrated system.”

The next problem is different.
It is no longer mainly about *better reasoning*.
It is about **durable continuity, reliability, distributed coordination, and trust over long real-time execution**.

---

# North Star
At the end of this roadmap, the system should be able to:
- run for **hours in real time**,
- survive waiting, interruption, retries, handoffs, and partial failure,
- coordinate multiple agents without conversational chaos,
- preserve important state without silent context loss,
- resume from durable state rather than re-improvising from prompt fragments,
- and explain what happened through replayable process state.

A stronger formulation:

> The prompt is not the state. The state lives in durable logs, snapshots, artifacts, beliefs, world-state, handoff packets, and runtime constraints. Prompts are only views over that state.

---

# Core doctrine

## 1. No silent context loss
Absolute zero-loss of all raw model state is unrealistic.
That is **not** the target.

The correct target is:

### **No silent context loss**
Meaning:
- durable state exists outside the prompt window,
- every important transition is written somewhere durable,
- handoffs are explicit and inspectable,
- omissions are deliberate and auditable,
- and the system can reconstruct process state from durable records.

## 2. Context windows are caches, not source of truth
The durable source of truth should be:
- process journal,
- snapshots,
- artifact store,
- shared world-state,
- belief state,
- runtime policy/constraint state,
- handoff envelopes,
- and agent mailbox/message records.

Prompt context should only be a **working set view** over that substrate.

## 3. Multi-agent should be stateful, not conversationally improvised
Agents should not primarily “share context” by dumping giant prompt blobs into one another.

Instead they should communicate through:
- durable handoff packets,
- shared process state,
- blackboard/world-state,
- mailboxes,
- revisions,
- and explicit ownership/leases.

---

# What this system becomes
Today the stack is roughly:
- Cortex = reasoning substrate
- 38 levels = cognitive repertoire
- Reasoning OS = governance/execution/explainability substrate

This roadmap adds the next layer:

## Durable Cognitive Runtime
A substrate that provides:
- long-lived process execution,
- resumability,
- replayability,
- multi-agent coordination,
- causal auditability,
- and reliability semantics.

In short:
- **Cortex thinks**
- **Reasoning OS governs**
- **Durable runtime preserves and coordinates cognition over time**

---

# Architecture planes

## Plane 1 — Durable Process Plane
### Goal
Make every long-running task a durable process instead of a transient prompt-local episode.

### Requirements
Every process should have:
- `process_id`
- stable lifecycle state
- append-only event journal
- checkpoint/snapshot support
- resumable execution state
- durable artifacts
- durable runtime constraints / policy view

### Target lifecycle
- created
- planned
- running
- waiting
- blocked
- delegated
- resumed
- completed
- failed
- rolled_back
- cancelled

### Why it matters
This is the difference between:
- “we’re currently thinking about a task”
and
- “the task exists as a durable process with state.”

### Exit criteria
- long-running processes can be stopped and resumed from durable state
- process state is not lost with context-window turnover
- process history is replayable from snapshots + event tail

---

## Plane 2 — Context Plane
### Goal
Separate context into clear classes instead of treating it as one undifferentiated blob.

### Context classes
#### A. Working context
- what the active agent needs right now
- small and prompt-local

#### B. Durable context
- persisted process state
- survives turns, waits, and restarts

#### C. Shared context
- common state visible to multiple agents
- e.g. world-state, open decisions, process goals

#### D. Handoff context
- explicit transfer packet from one agent to another
- bounded, typed, revisioned

#### E. Epistemic context
- beliefs, evidence, contradictions, confidence, provenance

### Exit criteria
- context boundaries are explicit in code and docs
- handoffs never depend on implicit prompt continuity alone
- process recovery can reconstruct all important context layers

---

## Plane 3 — Multi-Agent Coordination Plane
### Goal
Support multiple agents without letting the system degrade into uncontrolled chat choreography.

### Target model
Not “many full brains speaking randomly.”
Instead:
- coordinator/supervisor
- specialist agents
- mailboxes/messages
- shared blackboard / world-state
- explicit task ownership
- lease/heartbeat/retry semantics

### Agent roles
Potential roles:
- executive / coordinator
- planner
- retrieval / research agent
- truth / contradiction reviewer
- world-state updater
- operator-control / runtime agent
- routing / strategy specialist
- embodiment/safety monitor

### Required coordination primitives
- mailbox / message bus
- handoff envelopes
- task claims
- leases / ownership
- delivery receipts
- causal references
- dead-letter handling
- stale-view detection

### Exit criteria
- agents can work on the same durable process without silent state divergence
- agent handoffs are replayable and inspectable
- failed agents can be retried or replaced without process amnesia

---

## Plane 4 — Trust / Safety / Reliability Plane
### Goal
Ensure long-running and multi-agent execution remains trustworthy.

### Required properties
- idempotency
- replay safety
- causal ordering
- conflict detection
- stale revision detection
- retry semantics
- rollback semantics
- provenance tracking
- operator-visible audit trails

### Questions this plane must answer
- who changed what?
- based on what evidence?
- at what revision?
- did another agent race with that change?
- was the action taken on stale state?
- can the action be replayed safely?
- can it be rolled back?

### Exit criteria
- important actions carry provenance + revision info
- conflicting writes are detectable
- replay/recovery does not produce silent divergence

---

## Plane 5 — Observability / Review Plane
### Goal
Make the live system inspectable as a process, not just as a series of answers.

### Required views
- timeline view
- current state view
- agent state / agent lease view
- handoff graph
- belief/evidence graph
- world-state evolution
- runtime constraint history
- policy patch history
- incident report
- postmortem
- self-review
- drift detection

### Exit criteria
- operators can inspect live and historical process state
- hours-long runs are understandable after the fact
- agent decisions can be audited causally, not just narratively

---

# Core infrastructure to build

## Workstream 1 — Process journal
### Goal
Create a durable append-only event ledger for process execution.

### Event classes
Suggested event types:
- process_created
- process_planned
- process_started
- process_waiting
- process_resumed
- process_blocked
- process_failed
- process_completed
- step_started
- step_completed
- step_failed
- agent_assigned
- agent_heartbeat
- handoff_created
- handoff_accepted
- snapshot_created
- policy_patch_applied
- policy_patch_rolled_back
- belief_written
- world_state_updated
- operator_override

### Required fields
- event_id
- process_id
- ts
- kind
- causal_parent_ids
- agent_id / actor
- revision_id
- payload

### Exit criteria
- every important process transition becomes an event
- events are append-only and replayable

---

## Workstream 2 — Snapshotter / replay engine
### Goal
Make long-running processes resumable without replaying all history every time.

### Requirements
- snapshot every N events or major state transitions
- durable snapshot schema
- replay from snapshot + tail journal
- replay integrity checks

### Replay targets
Must reconstruct at least:
- process lifecycle state
- active steps
- runtime policy/constraints
- shared world-state
- belief state references
- outstanding handoffs/messages
- agent assignments/leases

### Exit criteria
- crash/restart recovery works from snapshot + tail log
- replay produces the same meaningful process state

---

## Workstream 3 — Handoff contract
### Goal
Make inter-agent transfer explicit, typed, and durable.

### Required handoff fields
- handoff_id
- process_id
- from_agent
- to_agent
- source_revision
- objective
- scope
- assumptions
- relevant evidence refs
- relevant artifacts
- open questions
- expected output
- timeout / lease expectations

### Design rule
A handoff should be inspectable on its own.
It should not depend on “the receiving agent probably saw the same context window.”

### Exit criteria
- all agent handoffs use explicit envelopes
- handoff omissions are visible and auditable

---

## Workstream 4 — Shared blackboard / state plane
### Goal
Create a shared durable substrate for process-level knowledge.

### Blackboard contents
- process goals
- plan state
- open decisions
- runtime constraints
- world-state snapshot
- belief references / epistemic state
- active risks
- unresolved contradictions
- operator overrides
- active agent ownership

### Exit criteria
- shared process state exists independently from any single agent’s prompt
- multiple agents can reference the same durable state safely

---

## Workstream 5 — Agent mailbox / bus
### Goal
Provide a durable communication substrate between agents.

### Required capabilities
- send
- receive
- ack
- retry
- timeout
- dead-letter
- causal references
- mailbox inspection

### Design rule
Messages are records in the system of record, not just transient chat turns.

### Exit criteria
- agent communication is durable and inspectable
- undelivered / failed / stale messages are visible

---

## Workstream 6 — Supervisor / lease manager
### Goal
Manage live multi-agent execution safely.

### Required capabilities
- assign work
- maintain leases
- track heartbeats
- detect stuck agents
- reassign timed-out work
- prevent duplicate claims
- support operator intervention

### Exit criteria
- each process step has clear ownership
- stale or dead agents do not silently strand process state

---

## Workstream 7 — Durable world-state + belief persistence integration
### Goal
Make shared epistemic state first-class in long-running execution.

### Requirements
- revisioned world-state snapshots
- durable belief references
- contradiction state persistence
- evidence provenance persistence
- explicit change sets

### Exit criteria
- long-running processes can preserve and update shared knowledge safely
- no need to reconstruct epistemic state from prompt leftovers alone

---

## Workstream 8 — Reliability semantics
### Goal
Make long-running execution trustworthy under failure.

### Required semantics
- idempotent event handling where possible
- retriable operations with dedupe keys
- rollback-safe state transitions
- stale-revision detection
- conflict resolution strategy
- dead-letter queues for unrecoverable agent/message failures

### Exit criteria
- failures become manageable operational states, not amnesia events

---

## Workstream 9 — Soak testing in real time
### Goal
Prove the system can actually run for hours, not merely simulate readiness.

### Required test categories
#### A. Real-time wait/resume tests
- process waits for real clock time
- resumes correctly
- no state loss

#### B. Interruption tests
- operator pause/resume
- partial process restart
- agent replacement

#### C. Crash/recovery tests
- process restarts from snapshots/journal
- step ownership restored
- no silent duplication

#### D. Multi-agent coordination tests
- multiple agents on one process
- handoffs succeed
- stale revisions detected
- duplicate claims blocked

#### E. Context-loss resistance tests
- force prompt/window turnover
- verify durable state is sufficient to continue
- verify missing context is visible, not silent

#### F. Hours-long soak tests
- 2h, 4h, 8h runs
- mixed waiting, retries, delegation, failures, resumes

### Exit criteria
- real-time soak tests pass repeatedly
- long-running behavior is stable under failure/interruption

---

# Trustworthy long-running execution invariants
These should become explicit invariants in code/tests/docs.

## Invariant 1
No important process transition occurs without a durable event.

## Invariant 2
No agent handoff occurs without an explicit handoff envelope.

## Invariant 3
Prompt context is never the only source of truth for long-running state.

## Invariant 4
Every write to shared state carries actor + revision + provenance.

## Invariant 5
A process can be resumed from durable state after interruption or restart.

## Invariant 6
If context was omitted, the omission is explicit and inspectable.

## Invariant 7
A multi-agent conflict is detectable rather than silently merged.

## Invariant 8
Operator-facing timelines and incident reports are reconstructable from the durable record.

---

# Proposed milestone sequence

## Milestone R1 — Durable single-process kernel
Build the durable process journal, snapshots, and replay support first.

### Goal
Make one long-running process trustworthy before distributing it.

### Deliverables
- process journal
- snapshotter
- replay engine
- lifecycle state model
- single-process resume support

### Success criterion
One process can run for hours, pause, resume, and recover without prompt-amnesia.

---

## Milestone R2 — Context formalization
Create explicit working/durable/shared/handoff/epistemic context layers.

### Deliverables
- typed context packets
- handoff contract
- blackboard state model
- explicit prompt-view generation from durable state

### Success criterion
Context loss becomes visible and bounded instead of silent and accidental.

---

## Milestone R3 — Multi-agent runtime substrate
Add mailboxes, leases, supervisor semantics, and shared state coordination.

### Deliverables
- mailbox/message bus
- supervisor
- lease/heartbeat model
- conflict detection
- handoff routing

### Success criterion
Multiple agents can collaborate on one process without conversational chaos.

---

## Milestone R4 — Reliability and recovery semantics
Add replay-safe and failure-safe behavior.

### Deliverables
- retry semantics
- dedupe/idempotency support
- rollback behavior
- dead-letter handling
- stale-revision rejection

### Success criterion
Failures become inspectable operational states instead of process amnesia.

---

## Milestone R5 — Multi-hour real-time soak certification
Prove the system under real elapsed time.

### Deliverables
- 2h / 4h / 8h soak suites
- interruption/recovery scenarios
- multi-agent coordination soak scenarios
- operator audit/playback views

### Success criterion
The system can honestly be described as durable and trustworthy over hours.

---

# Concrete first tickets

## Ticket A1 — Introduce process journal schema
Create:
- `process_event.py` / `process_journal.py`
- typed event models
- append API
- event validation tests

## Ticket A2 — Introduce process snapshot schema
Create:
- `process_snapshot.py`
- snapshot save/load
- versioned snapshot format

## Ticket A3 — Replay engine
Create:
- `process_replay.py`
- replay from snapshot + event tail
- replay equivalence tests

## Ticket A4 — Handoff envelope contract
Create:
- `handoff_contract.py`
- validation + serialization tests

## Ticket A5 — Shared blackboard state schema
Create:
- `shared_process_state.py`
- world/belief/decision/open-question sections

## Ticket A6 — Agent mailbox
Create:
- `agent_mailbox.py`
- send/receive/ack/retry/dead-letter

## Ticket A7 — Supervisor / leases
Create:
- `agent_supervisor.py`
- ownership/lease/heartbeat logic

## Ticket A8 — Resume-safe runtime integration
Touch runtime so execution uses durable state instead of prompt-local continuity.

## Ticket A9 — Context view compiler
Create the layer that generates prompt-ready working context from durable state.

## Ticket A10 — Real-time soak harness
Create:
- multi-hour integration harness
- pause/resume/restart tests
- stale-agent / stale-revision scenarios

---

# Suggested file layout
One possible target shape:

- `cortex_server/runtime/process_journal.py`
- `cortex_server/runtime/process_snapshot.py`
- `cortex_server/runtime/process_replay.py`
- `cortex_server/runtime/shared_process_state.py`
- `cortex_server/runtime/handoff_contract.py`
- `cortex_server/runtime/agent_mailbox.py`
- `cortex_server/runtime/agent_supervisor.py`
- `cortex_server/runtime/context_views.py`
- `cortex_server/runtime/soak_harness.py`

This is only one layout option, but the durable runtime should become an explicit subsystem of the codebase.

---

# What success looks like
The system should eventually support a claim like this:

> Cortex runs inside a durable reasoning runtime with explicit policy, explicit state, explicit handoffs, explicit recovery semantics, and explicit observability. Multi-agent collaboration happens through durable shared process state rather than fragile prompt continuity.

That is the real destination.

---

# Short recommendation
If we start this now, the correct order is:

1. durable process journal
2. snapshots + replay
3. handoff contract
4. shared blackboard
5. mailbox + supervisor
6. reliability semantics
7. hours-long soak testing

Do **not** start with multi-agent conversation choreography first.
Build the durable substrate first.

That is the difference between:
- a clever agent demo,
and
- a trustworthy cognitive runtime.
