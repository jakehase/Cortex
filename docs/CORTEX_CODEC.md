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

- `POST /nexus/outcome/feedback`
  - now feeds real user/outcome signals back into Codec policy as well as the broader outcome tuner
  - supports `policy_label` / `codec_variant`, `user_correction`, `recovery_needed`, and optional `validator_pass`

- `POST /nexus/codec/outcome`
  - direct Codec-specific real-outcome feedback hook
  - records actual success/correction/recovery signals into Codec policy learning

- automatic execution-flow learning in Nexus and Oracle
  - successful `/nexus/orchestrate` runs now emit Codec outcome artifacts automatically
  - failed `/nexus/orchestrate` runs also emit Codec failure outcomes automatically
  - Oracle served turns now emit Codec execution artifacts automatically too
  - Oracle exception paths also emit Codec failure outcomes automatically
  - execution reality now contributes to Codec policy even without explicit user feedback
  - Nexus execution outcomes are **step-shaped**, factoring in:
    - completed vs failed steps
    - retries
    - rollbacks
    - validator pass/fail
    - fastlane escalation / recovery state
  - Oracle execution outcomes are graded from:
    - lane quality
    - backend used
    - fallback reason
    - contract success/failure
    - response presence
  - Codec policy now also learns **step-type attribution** by archetype, surfacing:
    - helpful execution patterns
    - risky execution patterns
    - step/lane/backend/fallback motifs correlated with success or recovery
  - those learned step patterns now also feed **routing priors**, which can:
    - prefer stronger orchestrated lanes for archetypes where they historically win
    - avoid fallback-heavy behavior for archetypes where fallback motifs are risky
    - deepen quality mode when the learned execution priors indicate cheap paths underperform

- passive follow-up capture in Oracle
  - the next user turn in the same session can automatically score the prior served variant when it clearly looks like:
    - correction / retry (`actually`, `that was wrong`, `try again`, etc.)
    - success confirmation (`that worked`, `fixed it`, `thanks`, etc.)
  - passive signals are now **confidence-scored** instead of binary
  - scoring is now **contextual**, using overlap with the prior query and prior answer excerpt
  - a lightweight local **semantic verifier** now blends token overlap with trigram similarity for prior query/answer matching
  - explicit completion/failure markers like `tests passed`, `deploy works`, `still broken`, and `same issue` raise confidence beyond simple phrase matching
  - positive/negative resolution verbs like `solved`, `resolved`, `broken`, and `failing` can promote ambiguous follow-ups when semantic alignment is strong
  - ambiguous passive signals can now trigger an **optional tiny Oracle verifier** that returns a small JSON verdict (`success` / `correction` / `recovery` / `none`) instead of firing a full heavy judge every time
  - weak signals are ignored below a minimum confidence threshold
  - stale prior turns expire and are not auto-attributed once they age out
  - session telemetry now exposes the last served variant, stored query/answer hashes, answer excerpt size, age, expiry state, and last passive signal

## Adaptive rollout

Codec policy learning now supports closed-loop rollout tuning:

- evaluation winners are logged by task archetype
- Oracle-judge wins can carry more weight than heuristic-only wins
- real production outcomes can now contribute reward signals too
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


## Current Contract Snapshot (2026-03-26)

### Codec state contract
- `version`: `cortex.codec.v1`
- `schema_version`: `cortex.codec.schema.v1`
- stable domains:
  - `identity_state` / `schema.identity`
  - `project_state` / `schema.projects`
  - `world_state` / `schema.world`
  - `failure_state` / `schema.failure`
  - `outcome_state` / `schema.outcomes`
  - `utility_state` / `schema.utility`
  - `promotion_state` / `schema.promotion`

### Replay / evaluation surfaces
- `/nexus/codec/evaluate`
  - variant evaluation
  - acceptance gates
  - trend history
  - autotune / rollup autotune
- `/nexus/codec/corpus-replay`
  - versioned replay report artifact
- `/nexus/codec/corpus-replay/reports`
  - persisted replay report listing
- `/nexus/codec/corpus-replay/diff`
  - report-to-report diffing
- `/nexus/codec/corpus-replay/export`
  - versioned benchmark corpus export
- `/nexus/codec/corpus-replay/live-reexecute`
  - live/current-path prompt re-execution
- `/nexus/codec/corpus-replay/live-reexecute/compare`
  - multi-backend re-execution comparison
- `/nexus/codec/corpus-replay/live-reexecute/backends`
  - backend registry / capability surface
- `/nexus/codec/corpus-replay/plans`
  - replay plan listing
- `/nexus/codec/corpus-replay/plan`
  - replay plan creation
- `/nexus/codec/corpus-replay/plan/run`
  - execute one replay plan now
- `/nexus/codec/corpus-replay/plans/run-due`
  - execute due replay plans
- `/nexus/codec/corpus-replay/scheduler`
  - in-process scheduler status
- `/nexus/codec/corpus-replay/scheduler/tick`
  - deterministic due-plan tick

### Benchmark corpus export
Current export artifact shape:
- `export_version`: `cortex.codec.benchmark_corpus.v1`
- `export_id`
- `generated_at`
- `session_key`
- `corpus_version`
- `manifest`
- `history`
- `recommendations`

This export is the current frozen handoff format for offline benchmark/corpus work.
