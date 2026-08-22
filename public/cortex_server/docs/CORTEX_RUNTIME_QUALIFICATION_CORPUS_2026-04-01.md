# Cortex Runtime Qualification Corpus — 2026-04-01

## File
- `benchmarks/cortex_runtime_qualification_corpus_2026-04-01.json`

## Scope
This corpus was expanded for the Cortex 4-Hour Runtime Qualification Program and is intended to exercise:
- Oracle
- Nexus
- Meta Conductor
- Mission Control
- Command Center / Command Center Live
- long-sequence durability / continuity reuse

## Size
- 32 benchmark cases

## Category coverage
- micro utility / factual fast-path: 3
- memory continuity / follow-up: 6
- planning / architecture / tradeoff: 2
- coding / runtime orchestration: 3
- operator diagnostics / explain / trace: 10
- high-risk / high-ambiguity: 2
- durability / repeated-sequence stress: 6

## Runtime coverage
- oracle: 17
- nexus: 5
- meta_conductor: 3
- mission_control: 2
- command_center: 3
- command_center_live: 2

## Design notes
- Memory and durability cases use explicit `x-session-id` continuity so long-sequence recall can be validated instead of just replaying isolated prompts.
- Operator diagnostics are split across Mission Control, Command Center, Command Center Live, and runtime-scoped telemetry endpoints.
- Late-sequence operator cases deliberately re-check cumulative kernel summaries after many measured runtime events.
- Mission Control status cases keep a tighter latency SLO than the rest of the operator views because they are the main tuning target uncovered during corpus validation.

## Metadata carried per case
Where practical, each case includes:
- id
- runtime / surface
- category / class
- lane tendency / expected depth
- risk level
- latency expectation / SLO
- quality expectation
- failure heuristics
- pass/fail checks
