# Cortex Codex

## What it is

Cortex Codex is the layer that compresses raw interaction history into reusable **state**, not just shorter text.

Instead of replaying whole transcripts, Codex tries to preserve the pieces of history that should still change behavior now:

- identity preferences
- active projects
- current goals
- open loops
- durable facts / decisions
- failure patterns
- observed lessons from reality

## Why it matters

Most current AI memory systems are either:

- transcript replay
- semantic search over old text
- ad hoc summarization

Codex is meant to be different:

1. **State-first** — compress to machine-usable state objects.
2. **Outcome-aware** — promote lessons based on what later worked or failed.
3. **Prompt-efficient** — render compact state packets for frontier APIs.
4. **Composable** — sit on top of existing Mnemosyne / neuro-symbolic memory work.

## First implemented primitive

`public/cortex_server/cortex_server/modules/cortex_codex.py`

Current functions:

- `build_codex_state(events, previous_state=None)`
  - compiles raw events into a Codex state packet
- `apply_codex_outcome_feedback(state, outcome_event)`
  - updates state from observed success/failure outcomes
- `compress_codex_for_prompt(state, max_chars=1200)`
  - renders a compact prompt packet from state

## Near-term roadmap

### Phase 1 — useful now
- compile state from session events / memory recalls
- prepend compact Codex packet to selected prompts
- benchmark against plain transcript replay

### Phase 2 — stronger memory
- persist Codex state to durable store
- align fields to neuro-symbolic memory schema
- add utility scoring and retention policy

### Phase 3 — smarter over time
- promote memories by observed downstream usefulness
- maintain explicit failure-pattern memory
- add task-type scorecards for which reasoning strategies work best

## Success criteria

Codex is working if it measurably improves:

- response coherence across sessions
- lower prompt size for same or better quality
- fewer repeated mistakes
- better retention of active goals and user preferences
