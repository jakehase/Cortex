# Cortex Runtime Qualification Final Report — 2026-04-01

## Stage completion checklist

- [x] corpus: Benchmark corpus (30+ cases)
- [x] baseline: Baseline qualification run
- [x] experiments: Experiment matrix (6+ configs)
- [x] tuning_loop_a: Tuning loop A
- [x] tuning_loop_b: Tuning loop B
- [x] soak_run_1: Soak run 1 (30m)
- [x] soak_run_2: Soak run 2 (30m)
- [x] soak_run_3: Soak run 3 (30m)
- [x] final_rerun: Final qualification rerun
- [x] validation: Broad repo validation
- [ ] final_report: Final qualification report

## Corpus

- corpus file: `benchmarks/cortex_runtime_qualification_corpus_2026-04-01.json`
- case count: 32

## Baseline vs final

- baseline failure rate: 0.37
- final failure rate: 0.003
- baseline trace p50 ms: 509.046
- final trace p50 ms: 265.389
- baseline trace p95 ms: 582.075
- final trace p95 ms: 356.708
- baseline drift delta ms: 109.782
- final drift delta ms: 131.975

## Experiment winner

- winner: persistent_2x1_benchmark_mode_serial_prefetch
- experiment count: 7

## Soak summary

- soak run count: 3
- average trace p95 ms across soak runs: 463.812
- max trace p95 ms across soak runs: 467.512
- average drift delta ms across soak runs: 11.098

## Validation

- validation returncode: 0
- validation command: `/usr/bin/python3 -m pytest -q`

## Remaining risks

- Qualification gates are now enforced mechanically by the supervisor state machine and artifact checks.
- Runtime stability still depends on using explicit/winning ONNX embedding settings and isolated Chroma dirs for clean repeated runs.

