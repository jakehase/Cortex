# Cortex Codec Overview

Cortex Codec is Cortex's memory compression and reuse system.

In plain terms: it turns messy conversation history into structured state such as preferences, goals, durable facts, open loops, lessons, and failure patterns. It does more than summarize — it scores what matters, tracks freshness and confidence, resolves contradictions, and decides what should be promoted or retained over time. Then it packages that state back into compact prompt context, evaluates whether it helped, and learns from replay/history so the memory system gets smarter instead of just bigger.

## What it currently includes

- structured codec state compilation
- schema versioning and migration (`cortex.codec.v1`, `cortex.codec.schema.v1`)
- utility scoring and retention policy
- contradiction and supersession handling
- promotion rules for durable memory
- freshness/confidence modeling
- cross-session rollups and semantic aliasing
- policy learning and autotuning
- benchmark/evaluation gates
- persistent eval history and trend summaries
- replay reports and corpus export
- scheduled replay plans and automatic due-plan execution
- heuristic re-execution and live local-path re-execution
- semantic drift tracking and backend comparison

## Why it exists

The goal is not to make memory larger. The goal is to make memory:

- smaller when injected into prompts
- more durable when facts matter
- more selective when noise accumulates
- more correct when reality changes
- more testable through replay, evaluation, and drift analysis

## Key surfaces

Current Nexus surfaces include:

- `/nexus/codec/evaluate`
- `/nexus/codec/benchmark`
- `/nexus/codec/policy`
- `/nexus/codec/corpus-replay`
- `/nexus/codec/corpus-replay/export`
- `/nexus/codec/corpus-replay/reports`
- `/nexus/codec/corpus-replay/diff`
- `/nexus/codec/corpus-replay/plans`
- `/nexus/codec/corpus-replay/scheduler`
- `/nexus/codec/corpus-replay/live-reexecute`
- `/nexus/codec/corpus-replay/live-reexecute/compare`

## Current status

Codec is implemented as a serious internal R&D/runtime system and is now strongly instrumented, replayable, and test-backed. The remaining frontier work is less about adding basic surfaces and more about:

- broader backend orchestration
- stronger semantic evaluators
- larger corpus lifecycle management
- learned optimization from regenerated outputs
