# Cortex Codec

## What it is

Cortex Codec is the layer that compresses raw interaction history into reusable **state**, not just shorter text.

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

`public/cortex_server/cortex_server/modules/cortex_codec.py`

Current functions:

- `build_codec_state(events, previous_state=None)`
  - compiles raw events into a Codec state packet
- `apply_codec_outcome_feedback(state, outcome_event)`
  - updates state from observed success/failure outcomes
- `compress_codec_for_prompt(state, max_chars=1200)`
  - renders a compact prompt packet from state
- session helpers in `cortex_codec.py`
  - maintain shared per-session Codec state
  - persist updated snapshots into L22/Mnemosyne
  - lazily hydrate the latest snapshot back from L22 when in-memory state is cold
  - dedupe by meaningful state fingerprint (not just timestamps)
  - prune older per-session snapshots with a bounded retention window

## Near-term roadmap

### Phase 1 — useful now
- compile state from session events / memory recalls
- prepend compact Codec packet to selected prompts
- benchmark against plain transcript replay

### Phase 2 — stronger memory
- persist Codec state to durable store
- align fields to neuro-symbolic memory schema
- add utility scoring and retention policy

### Phase 3 — smarter over time
- promote memories by observed downstream usefulness
- maintain explicit failure-pattern memory
- add task-type scorecards for which reasoning strategies work best

## Debug / visibility

Current visibility surface:

- `GET /nexus/codec/status`
  - resolves the current session via `x-session-id` / `x-chat-id` or accepts `session_key`
  - returns:
    - current Codec packet
    - summary and fingerprint
    - compression stats / prompt-size savings
    - recent persisted L22 snapshots
    - latest retention action metadata

- `GET /nexus/codec/benchmark`
  - compares, for a given session/query:
    - raw state-source character count
    - Codec packet size
    - referent-only prompt size
    - referent+Codec prompt size
    - recent snapshot timeline with packet/raw sizes

- `GET /nexus/codec/evaluate`
  - builds three prompt variants for a query:
    - query only
    - referents only
    - referents + Codec
  - always returns a heuristic judge verdict with per-variant scores + winner
  - can optionally run all variants through the Oracle lane (`run_oracle=true`)
  - can optionally ask an Oracle judge for a model-based winner (`judge_with_oracle=true`)
  - records the winning variant into Codec policy learning
  - returns side-by-side prompt hashes, excerpts, sizes, Oracle outputs/backend labels, judge results, and updated policy state

- `GET /nexus/codec/policy`
  - shows learned Codec injection recommendations by task archetype
  - can also return the current recommendation for a specific query
  - includes rollout stage / rollout percent / query-level rollout decision data

## Adaptive rollout

Codec policy learning now supports closed-loop rollout tuning:

- evaluation winners are logged by task archetype
- Oracle-judge wins can carry more weight than heuristic-only wins
- learned policy can:
  - gradually **skip Codec** for archetypes where it loses
  - **boost Codec packet budget** for archetypes where it keeps winning
- rollout is deterministic per query, so behavior is stable for the same prompt class while evidence accumulates

## Success criteria

Codec is working if it measurably improves:

- response coherence across sessions
- lower prompt size for same or better quality
- fewer repeated mistakes
- better retention of active goals and user preferences
