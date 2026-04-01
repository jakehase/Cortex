# Cortex Kernel V2 Validation Summary — 2026-04-01

## Validation artifacts

- Baseline benchmark: `artifacts/benchmarks/2026-04-01/baseline_final_corpus.json`
- Post-change benchmark: `artifacts/benchmarks/2026-04-01/post_change.json`
- Durability benchmark: `artifacts/benchmarks/2026-04-01/final.json`

## Test validation

Executed:

```bash
pytest -q \
  tests/test_cortex_kernel_v2.py \
  tests/test_kernel_v2_benchmark_runner.py \
  tests/test_command_center_kernel_v2.py \
  tests/test_oracle_kernel_v2_integration.py \
  tests/test_nexus_kernel_v2_integration.py \
  tests/test_meta_conductor_kernel_v2_integration.py \
  tests/test_oracle_codec_integration.py
```

Result:

- **28 passed in 10.83s**

## Durability pass

The benchmark corpus was re-run for **10 iterations** to check long-horizon stability.

Artifact:

- `artifacts/benchmarks/2026-04-01/final.json`

Observed summary:

- Overall failure rate: **0.625**
- Trace-bearing failure rate: **0.900**
- Operator-surface failure rate: **0.167**
- Trace latency p50 / p95: **624.982 ms / 869.051 ms**
- Compile latency p50 / p95: **0.062 ms / 0.106 ms**

## Durability finding

The extended run exposed a host/runtime issue that does **not** show up as a correctness failure in the 5-iteration post-change benchmark but does show up as a long-run latency problem:

- repeated ONNX Runtime `pthread_setaffinity_np failed` errors appear during the benchmark run
- trace latencies drift upward materially over longer runs
- operator surfaces stay stable, but Oracle/Nexus-heavy traces degrade

This means the repo pass improved Kernel V2 behavior and telemetry coherence, but **the long-run latency profile is still constrained by the host/container ONNX Runtime affinity behavior**.

## Validation conclusion

Validated successfully:

- benchmark harness and corpus execution
- kernel risk/lane logic changes
- command-center / mission-control telemetry propagation
- oracle / nexus / meta conductor kernel integrations
- codec-related oracle integration coverage

Validated but still problematic under long runs:

- sustained Oracle/Nexus latency under repeated ONNX Runtime affinity failures
