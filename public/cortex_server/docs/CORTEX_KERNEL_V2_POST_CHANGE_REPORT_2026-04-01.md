# Cortex Kernel V2 Post-Change Benchmark Report — 2026-04-01

## Artifact

- `artifacts/benchmarks/2026-04-01/post_change.json`

## Corpus

- `benchmarks/cortex_kernel_v2_corpus_2026-04-01.json`
- 16 cases
- 5 iterations
- 80 total runs

## Post-change summary

- Overall failure rate: **0.287** (23 / 80)
- Trace-bearing failure rate: **0.360**
- Operator-surface failure rate: **0.167**
- Trace latency p50 / p95: **494.273 ms / 646.361 ms**
- Compile latency p50 / p95: **0.064 ms / 0.109 ms**
- Planned fast rate: **0.500**
- Planned deep rate: **0.500**
- Actual fast rate: **0.500**
- Actual deep rate: **0.500**
- Escalation rate: **0.200**
- Average reused context chars: **220.4**

## Before vs after highlights

### Failure rate

- Overall failure rate: **0.600 → 0.287**
- Trace-bearing failure rate: **0.860 → 0.360**

### Routing balance

- Planned fast rate: **0.300 → 0.500**
- Planned deep rate: **0.700 → 0.500**
- Actual deep rate: **0.300 → 0.500**

### Trace latency

- Trace latency p50: **564.068 ms → 494.273 ms**
- Compile latency p95: **0.122 ms → 0.109 ms**

## Case-level improvements

### Memory continuity pair improved materially

- `oracle_memory_seed`: **5 / 5 failures → 0 / 5 failures**
  - p50 **581.4 ms → 531.4 ms**
- `oracle_memory_followup`: **4 / 5 failures → 1 / 5 failures**
  - p50 **611.4 ms → 523.2 ms**

### Nexus deep/fast balance improved

- `nexus_planning_orchestrate`: **5 / 5 failures → 2 / 5 failures**
  - p50 **599.9 ms → 514.6 ms**
- `nexus_high_risk_prod`: **5 / 5 failures → 2 / 5 failures**
  - p50 **603.9 ms → 519.4 ms**

### Oracle deep-path cases improved, though not fully solved

- `oracle_analysis_tradeoff`: **5 / 5 failures → 3 / 5 failures**
  - p50 **629.7 ms → 588.3 ms**
- `oracle_coding_rollout`: **5 / 5 failures → 3 / 5 failures**
  - p50 **630.6 ms → 561.6 ms**
- `oracle_micro_fact_fast`: **5 / 5 failures → 1 / 5 failures**
  - p50 **584.1 ms → 502.6 ms**

## What changed in code

### 1. Safer risk classification for benign memory-token prompts

Generic `token` wording no longer automatically implies a security workflow.
This keeps benign continuity prompts on the fast path while still escalating clear credential/auth/security wording.

### 2. More coherent deep-lane execution accounting

Deep plans that execute through best-effort/gated paths now contribute to the deep-family telemetry when that is what the plan/runtime semantics imply.

### 3. Shared diagnostic bundle plus one-pass mission summary aggregation

Kernel V2 now exposes a shared diagnostic bundle used by runtime telemetry endpoints.
Mission Control summary construction was reworked into a single aggregation pass, and Command Center / Command Center Live now consume the latest event directly from that shared summary.

## Residual issues after the post-change run

- `mission_control_status` still missed the benchmark latency SLO in all 5 iterations
- Oracle and Nexus still dominate end-to-end latency failures
- the main remaining regressions are now much more latency-driven than routing-integrity-driven
