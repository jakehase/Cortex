# Cortex Runtime Durability Validation Summary — 2026-04-01

## Validation performed
### Automated tests
Command:
- `pytest -q tests/test_cortex_kernel_v2.py tests/test_kernel_v2_benchmark_runner.py tests/test_runtime_pressure_and_governor.py`

Result:
- `12 passed`

Coverage validated by those tests:
- kernel timing / runtime-pressure telemetry fields
- benchmark result schema additions
- runtime-pressure degradation classification
- bounded latency-governor adaptation under degraded runtime pressure

### Runtime probe validation
Artifacts:
- `artifacts/benchmarks/2026-04-01/durability_experiments/direct_embedding_probe.json`
- `artifacts/benchmarks/2026-04-01/durability_experiments/direct_embedding_probe_v2.json`

Validated:
- legacy default embedding path is slower and warning-prone
- persistent ONNX path removes repeated session creation cost
- explicit thread counts prevent the new durable path from generating additional affinity warnings

### Experiment-matrix validation
Artifact index:
- `artifacts/benchmarks/2026-04-01/durability_experiments/index.json`

Validated:
- baseline default delegate reproduces the affinity-warning storm
- persistent `2x1` threads is the best safe config in the tested matrix
- runtime-pressure counters match observed runtime behavior

### Repeatability validation
Artifacts:
- `artifacts/benchmarks/2026-04-01/final_stabilization_runs/aggregate_summary.json`

Validated across 3 isolated reruns:
- zero affinity warnings total
- stable failure rate (`0.12` each run)
- stable trace p95 band (`188.299 ms` to `192.652 ms`)
- stable runtime-pressure signature (`110` embedding calls, `1` ONNX session init, healthy status)

## What was validated as improved
- ONNX affinity-warning storm elimination in the winning config
- materially lower Oracle/Nexus-heavy latency than the reproduced legacy baseline
- single-session ONNX reuse instead of repeated session churn
- richer runtime diagnostics in kernel snapshots / benchmark artifacts / librarian status
- bounded conservative behavior path for speculative prefetch under degraded runtime conditions

## What was validated as preserved
- benchmark correctness floor was not sacrificed to gain speed
- benchmark failure rate remained stable in the final repeated winner runs
- existing tests around kernel routing / benchmark runner behavior still pass

## What remains open
- residual long-sequence drift slope in Oracle/Nexus-heavy cases was reduced in absolute latency terms but not eliminated by the ONNX/session fix alone
- additional runtime-backed surfaces outside the librarian wrapper could still emit ONNX affinity warnings if they do not adopt explicit thread configuration
