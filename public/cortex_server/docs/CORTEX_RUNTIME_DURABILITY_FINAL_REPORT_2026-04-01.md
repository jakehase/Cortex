# Cortex Runtime Durability Final Report — 2026-04-01

## Outcome
The durability pass produced a concrete runtime stabilization win.

Winning configuration:
- persistent librarian embedding function
- explicit ONNX Runtime session threads
- `intra_op_threads=2`
- `inter_op_threads=1`
- `allow_spinning=false`

Recommended env defaults:
- `CORTEX_LIBRARIAN_EMBEDDING_MODE=persistent`
- `CORTEX_LIBRARIAN_ONNX_EXPLICIT_THREADS=true`
- `CORTEX_LIBRARIAN_ONNX_INTRA_OP_THREADS=2`
- `CORTEX_LIBRARIAN_ONNX_INTER_OP_THREADS=1`
- `CORTEX_LIBRARIAN_ONNX_ALLOW_SPINNING=false`

## Code changes shipped
### Runtime durability changes
- `cortex_server/modules/librarian_embedding.py`
  - new persistent ONNX embedding wrapper
  - keeps one ONNX session alive instead of recreating it per embed call
  - applies explicit ONNX thread settings
  - remains collection-config compatible with persisted Chroma `default` embedding config
- `cortex_server/modules/runtime_pressure.py`
  - new runtime-pressure / warning instrumentation
  - records embedding calls, ONNX session inits, explicit-vs-implicit thread usage, affinity-risk warnings, host CPU layout metadata
- `cortex_server/routers/librarian.py`
  - uses the durable embedding wrapper by default
  - exposes runtime-pressure state in `/status`
  - supports `CORTEX_CHROMA_DIR` override so durability benchmarks can use isolated vector stores

### Kernel / diagnostics changes
- `cortex_server/modules/cortex_kernel_v2.py`
  - records per-request timing breakdowns
  - surfaces runtime-pressure markers on events
  - exposes runtime-pressure and timing breakdowns in performance snapshots / diagnostics
- `cortex_server/modules/latency_budget_governor.py`
  - adds bounded adaptation: speculative prefetch can serialize itself in degraded runtime / benchmark mode instead of adding extra contention
- `cortex_server/benchmarks/kernel_v2_benchmark.py`
  - benchmark schema upgraded with environment metadata, runtime-pressure metadata, drift summaries, and by-runtime / by-surface breakdowns
- `cortex_server/benchmarks/runtime_durability_experiments.py`
  - new experiment runner for durability matrix execution with stderr warning capture and isolated Chroma dirs

## Experiment matrix result
Artifact index:
- `artifacts/benchmarks/2026-04-01/durability_experiments/index.json`

Winner from the full isolated matrix:
- `persistent_2x1`

Key experiment comparisons:
- baseline default delegate
  - duration: `35365.722 ms`
  - affinity warnings: `330`
  - trace p95: `323.097 ms`
  - runtime pressure: no durable session tracking available because legacy delegate bypasses the wrapper
- persistent implicit threads
  - duration: `21155.293 ms`
  - affinity warnings: `3`
  - trace p95: `184.869 ms`
  - runtime pressure marked degraded because an ONNX session was initialized without explicit threads on a risky cpuset
- persistent explicit `2x1` threads
  - duration: `22163.757 ms`
  - affinity warnings: `0`
  - trace p95: `192.755 ms`
  - runtime pressure: `110` embedding calls, `1` ONNX session init, `0` warnings, healthy state

Why `persistent_2x1` won over `persistent_no_explicit_threads`:
- `persistent_no_explicit_threads` was slightly faster, but still emitted real ONNX affinity warnings and the new runtime-pressure layer correctly marked it degraded
- `persistent_2x1` preserved the latency win while fully eliminating the affinity warning storm

## Measured improvements
Versus reproduced baseline (`baseline_default_delegate`):
- stderr affinity warnings: `330 -> 0`
- trace p50: `272.757 ms -> 147.630 ms` (`45.9%` lower)
- trace p95: `323.097 ms -> 192.755 ms` (`40.3%` lower)
- end-to-end experiment duration: `35365.722 ms -> 22163.757 ms` (`37.3%` faster)
- ONNX session behavior: effectively repeated legacy session creation -> `1` session for `110` embedding calls in the winning config

Versus the older repo durability checkpoint (`artifacts/benchmarks/2026-04-01/final.json`):
- trace p95: `869.051 ms -> 192.755 ms` (`77.8%` lower)
- failure rate: `0.625 -> 0.12`

## Durability rerun / repeatability
Artifacts:
- `artifacts/benchmarks/2026-04-01/final_stabilization_runs/run_1.json`
- `artifacts/benchmarks/2026-04-01/final_stabilization_runs/run_2.json`
- `artifacts/benchmarks/2026-04-01/final_stabilization_runs/run_3.json`
- `artifacts/benchmarks/2026-04-01/final_stabilization_runs/aggregate_summary.json`

Repeated isolated winner results (`persistent_2x1`, 3 runs):
- affinity warnings total: `0`
- failure rate average: `0.12`
- failure rate max: `0.12`
- trace p95 average: `190.601 ms`
- trace p95 max: `192.652 ms`
- drift delta average: `50.181 ms`

Interpretation:
- the warning storm is gone repeatably
- the lower latency profile is repeatable
- the benchmark failure floor did **not** improve further in this pass, but it did remain stable and far better than the older repo durability checkpoint

## Remaining caveats
1. The half-split drift metric remained around `+50 ms` in both the reproduced baseline and the stabilized runs.
   - This suggests the warning storm and session churn were not the only contributor to the residual long-sequence latency slope.
   - The remaining drift is materially smaller in absolute latency terms because the whole runtime is faster, but the synthetic first-half vs second-half delta did not collapse.
2. Host cpuset layout remains a real environmental risk.
   - `Cpus_allowed_list=4-8,10,14`
   - Any other ONNX-backed path that bypasses the new wrapper can still emit affinity warnings.
3. This pass deliberately did **not** trade correctness away for speed.
   - Failure-rate gains came from preserving the current benchmark floor, not by weakening checks.

## Root-cause assessment
Assessment level: **confirmed for the main warning/latency instability mechanism; still partial for the residual drift slope**

Confirmed:
- legacy Chroma default embedding delegation recreated ONNX session state repeatedly
- that behavior amplified ONNX Runtime affinity warnings on this host/container cpuset
- the warning storm and session churn materially increased latency
- a persistent ONNX session with explicit bounded threads removes the warning storm and materially improves durability latency

Still not fully explained:
- the residual ~`+50 ms` half-split drift signal in Oracle/Nexus-heavy cases after the warning storm is removed

## Rollback instructions
If the durable runtime config causes regressions:
1. revert to legacy collection behavior:
   - `CORTEX_LIBRARIAN_EMBEDDING_MODE=default`
2. unset the explicit thread settings:
   - `CORTEX_LIBRARIAN_ONNX_EXPLICIT_THREADS`
   - `CORTEX_LIBRARIAN_ONNX_INTRA_OP_THREADS`
   - `CORTEX_LIBRARIAN_ONNX_INTER_OP_THREADS`
   - `CORTEX_LIBRARIAN_ONNX_ALLOW_SPINNING`
3. if only benchmarks are being run, also remove any temporary `CORTEX_CHROMA_DIR` override

## Recommendation
Adopt the `persistent_2x1` config as the new safe default for this repo/host context.

It is the best measured balance of:
- zero affinity warnings
- materially lower Oracle/Nexus latency
- single-session ONNX stability
- bounded, visible runtime adaptation instead of silent fallback behavior
