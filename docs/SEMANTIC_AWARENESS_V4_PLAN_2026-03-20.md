# Semantic Awareness v4 Plan

## Goal
Make Cortex semantically aware in a way that is:
- event-driven instead of ambient/self-narrating
- grounded in commitments, deltas, tensions, and closure
- useful for routing, validation, and follow-through
- testable and measurable

## Phase 1 — Source audit and integration map
### Objectives
- Read the relevant Awareness, Nexus, middleware, and integration code paths completely.
- Identify the factual substrate already available.
- Confirm where semantic observations can be attached without creating another ambient loop.

### Files covered
- `cortex_server/routers/awareness.py`
- `cortex_server/routers/nexus.py`
- `cortex_server/modules/nexus.py`
- `cortex_server/middleware/event_ledger_middleware.py`
- `cortex_server/modules/consciousness_integration.py`
- `cortex_server/modules/unified_messaging.py`
- `cortex_server/main.py`
- existing tests under `tests/`

### Planned outcome
- Use the event ledger as the factual substrate.
- Use bus broadcasts from Nexus as the semantic observation path.
- Keep Awareness event-driven.

## Phase 2 — Core semantic engine
### Objectives
Implement a reusable semantic-awareness core module that can:
- classify conversation phase
- extract commitments from requests/answers
- extract and label claims
- detect semantic deltas
- compute semantic tensions
- compute semantic gravity / closure risk
- decide intervention policy
- produce a derived semantic snapshot

### Deliverable
New module:
- `cortex_server/modules/semantic_awareness.py`

### Key concepts
- **Commitments**: promises, open asks, follow-ups, verification obligations
- **Claims**: factual assertions with epistemic labels
- **Deltas**: meaningful changes relative to the last semantic snapshot
- **Tensions**: promise/truth/plan/social/quality/risk/closure pressures
- **Interventions**: verify, reroute, ask, defer, remember, follow up
- **Phase awareness**: ideation, research, planning, execution, verification, scheduling, follow-up, etc.

## Phase 3 — Awareness integration
### Objectives
Teach L37 Awareness to ingest semantic observations and derive snapshots without restarting ambient cognition.

### Planned changes
- Add semantic-awareness state to working memory.
- Add ingestion methods for semantic observations.
- Add endpoints for:
  - semantic snapshot
  - commitments
  - tensions
  - semantic observation ingestion
- Extend status/introspection to surface semantic awareness cleanly.
- Keep the event-driven probe model; do not add a new loop.

### Intended result
Awareness becomes the place that derives and exposes semantic posture, not the place that constantly narrates itself.

## Phase 4 — Nexus + ledger integration
### Objectives
Make semantic awareness broad across Cortex by wiring it into the orchestration path.

### Planned changes
- Nexus emits semantic turn start/result events onto the bus.
- Nexus computes conversation phase and semantic context for each turn.
- Event ledger captures compact semantic context from request state.
- Validator/route fallback conditions become semantic triggers.

### Intended result
Awareness gets meaningful semantic observations from real orchestration, not from idle speculation.

## Phase 5 — Hardening + tests
### Objectives
Add direct test coverage for the new engine and integration points.

### Planned tests
- conversation phase classification
- commitment extraction
- claim extraction and epistemic labeling
- tension engine behavior
- intervention broker behavior
- awareness semantic ingestion
- nexus semantic broadcast/context integration
- event ledger semantic field capture
- event-driven awareness startup remains loop-free

## Phase 6 — Optional broad alignment
### Objectives
Align remaining Cortex legacy compatibility surfaces with the new model if they are still active.

### Candidates
- `alive_cortex.py`
- legacy status/identity wording that still implies always-on cognition

### Guardrail
Do not introduce any new watchdogs, ambient loops, or decorative self-monitoring.
