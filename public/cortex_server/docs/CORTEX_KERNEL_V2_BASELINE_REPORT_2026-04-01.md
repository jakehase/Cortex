# Cortex Kernel V2 Baseline Report — 2026-04-01

## Artifact

- `artifacts/benchmarks/2026-04-01/baseline_final_corpus.json`

## Corpus

- `benchmarks/cortex_kernel_v2_corpus_2026-04-01.json`
- 16 cases
- 5 iterations
- 80 total runs

## Baseline summary

- Overall failure rate: **0.600** (48 / 80)
- Trace-bearing failure rate: **0.860**
- Operator-surface failure rate: **0.167**
- Trace latency p50 / p95: **564.068 ms / 625.344 ms**
- Compile latency p50 / p95: **0.061 ms / 0.122 ms**
- Planned fast rate: **0.300**
- Planned deep rate: **0.700**
- Actual fast rate: **0.700**
- Actual deep rate: **0.300**
- Escalation rate: **0.200**
- Average reused context chars: **220.4**

## What the baseline exposed

### 1. Memory-oriented token prompts were over-routed as deep/security work

The benchmark corpus includes a continuity pair:

- `oracle_memory_seed`
- `oracle_memory_followup`

Baseline result:

- `oracle_memory_seed`: **5 / 5 failures**, p50 **581.4 ms**
- `oracle_memory_followup`: **4 / 5 failures**, p50 **611.4 ms**

Observed cause:

- generic `token` wording was being interpreted as a security signal
- this pushed benign memory prompts into deep routing

### 2. Planned-vs-actual deep-lane accounting was under-reporting real deep executions

Baseline summary showed:

- planned deep rate **0.700**
- actual deep rate **0.300**

That gap made the runtime look more fast-path-heavy than the benchmark corpus actually intended.

### 3. Operator summary surfaces were healthy functionally but still slow enough to miss the benchmark SLO

- `mission_control_status`: **5 / 5 failures**, p50 **176.3 ms**

The route was correct, but the aggregate summary path still missed the benchmark latency envelope.

### 4. Oracle and Nexus latency remained the dominant practical cost center

Representative baseline cases:

- `oracle_micro_fact_fast`: **5 / 5 failures**, p50 **584.1 ms**
- `oracle_analysis_tradeoff`: **5 / 5 failures**, p50 **629.7 ms**
- `nexus_micro_fastlane`: **5 / 5 failures**, p50 **599.3 ms**
- `nexus_planning_orchestrate`: **5 / 5 failures**, p50 **599.9 ms**

## Baseline conclusion

The repo started from a position where Kernel V2 correctness was mostly present, but runtime discipline was uneven:

- memory continuity prompts were being over-escalated
- deep execution accounting was inconsistent
- operator summaries were functional but not especially lean
- end-to-end Oracle/Nexus latency dominated benchmark failures
