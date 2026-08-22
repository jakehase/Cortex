# Cortex Runtime Durability Baseline — 2026-04-01

## Scope
This report captures the reproduction/isolation phase for the runtime durability plan in `docs/CORTEX_RUNTIME_DURABILITY_AND_LATENCY_STABILITY_PLAN_2026-04-01.md`.

Primary questions:
- can the long-run latency drift still be reproduced?
- do ONNX Runtime affinity warnings correlate with the slow path?
- is the problem mostly routing logic, or mostly runtime/session behavior?

## Host evidence
Observed on this host during the experiment runs:
- `Cpus_allowed_list`: `4-8,10,14`
- allowed CPU count: `7`
- layout is **not zero-based contiguous**
- ONNX Runtime warning masks observed in failing runs: `{0,}`, `{1,}`, `{3,}`

That mismatch is concrete evidence that this container/host CPU layout can trigger ONNX Runtime affinity failures when thread counts are left implicit.

## Historical checkpoint before this pass
From existing benchmark artifacts already in the repo:
- `artifacts/benchmarks/2026-04-01/baseline.json`
  - failure rate: `0.588`
  - trace failure rate: `0.84`
  - trace p50: `392.706 ms`
  - trace p95: `458.705 ms`
- `artifacts/benchmarks/2026-04-01/final.json`
  - failure rate: `0.625`
  - trace failure rate: `0.90`
  - trace p50: `624.982 ms`
  - trace p95: `869.051 ms`

Those older checkpoints established the original durability problem but did not isolate the runtime mechanism.

## Direct reproduction artifact
Artifact:
- `artifacts/benchmarks/2026-04-01/durability_experiments/direct_embedding_probe_v2.json`

Key findings:
- `DefaultEmbeddingFunction()` average: `146.418 ms` per call across 5 calls
- persistent ONNX instance with implicit threads average: `39.476 ms`
- persistent ONNX instance with explicit `2x1` threads average: `47.976 ms`
- combined stderr affinity warnings: `18`

Interpretation:
- the legacy default path recreates ONNX sessions repeatedly and is much slower
- keeping one ONNX session alive removes most of the session churn cost
- leaving threads implicit still emits affinity warnings on first session init
- explicit thread counts avoid adding new affinity warnings in the durable path

## Baseline reproduction experiment
Artifact set:
- `artifacts/benchmarks/2026-04-01/durability_experiments/baseline_default_delegate.experiment.json`
- `artifacts/benchmarks/2026-04-01/durability_experiments/baseline_default_delegate.benchmark.json`

Configuration:
- `CORTEX_LIBRARIAN_EMBEDDING_MODE=default`
- no explicit ONNX thread settings
- isolated benchmark Chroma directory per run

Observed results:
- total experiment duration: `35365.722 ms`
- affinity warnings on stderr: `330`
- benchmark failure rate: `0.12`
- trace failure rate: `0.092`
- trace p50: `272.757 ms`
- trace p95: `323.097 ms`
- drift delta (second-half avg minus first-half avg): `51.531 ms`

Per-runtime latency concentration:
- Oracle trace p95: `327.596 ms`
- Nexus trace p95: `315.049 ms`
- Meta Conductor trace p95: `19.926 ms`

Worst drift cases in the reproduced baseline:
- `oracle_analysis_tradeoff`: `+69.531 ms`
- `oracle_strict_contract_micro`: `+67.825 ms`
- `nexus_micro_fastlane`: `+66.007 ms`
- `nexus_high_risk_prod`: `+58.461 ms`
- `oracle_micro_fact_fast`: `+56.462 ms`

## Root-cause assessment at baseline
Assessment level: **strongly suspected, with direct supporting evidence**

What is confirmed:
- repeated `pthread_setaffinity_np failed` warnings are real on this host
- warning masks target CPUs that are not valid in this container cpuset
- the default Chroma embedding path repeatedly re-initializes ONNX-backed embedding work
- repeated session churn is materially slower than a persistent ONNX session

What remained to verify after baseline:
- whether an explicit thread configuration plus persistent session removes the warning storm in the full benchmark loop
- whether those changes hold up across repeated isolated durability runs
- whether correctness/failure-rate behavior is preserved
