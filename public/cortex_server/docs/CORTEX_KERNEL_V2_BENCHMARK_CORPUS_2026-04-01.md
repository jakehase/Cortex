# Cortex Kernel V2 Benchmark Corpus — 2026-04-01

## Purpose

This corpus is the reproducible workload set for the multi-hour autonomy validation program.
It covers the required runtime surfaces:

- Oracle
- Nexus
- Meta Conductor
- Mission Control
- Command Center
- Command Center Live

## Corpus file

- `benchmarks/cortex_kernel_v2_corpus_2026-04-01.json`

## Schema

Top-level fields:

- `schema_version`
- `name`
- `created_at`
- `description`
- `classes`
- `cases`

Each case includes:

- `id` — stable benchmark identifier
- `class` — workload class
- `runtime` — target runtime or operator surface
- `surface` — major surface within that runtime
- `title` — human-readable label
- `lane_tendency` — expected fast vs deep tendency where applicable
- `latency_slo_ms` — soft expectation for local deterministic benchmark runs
- `quality_expectation` — concise quality goal
- `failure_heuristics` — conditions that should be treated as failures/regressions
- `request` — HTTP invocation contract:
  - `method`
  - `path`
  - optional `headers`
  - optional `params`
  - optional `json`
- `measure_event` — whether the request is expected to record a new Kernel V2 telemetry event
- `checks` — machine-validated assertions

## Check schema

Each `checks[]` entry has:

- `path` — dot-path into one of:
  - `status_code`
  - `response.*`
  - `kernel_event.*`
  - `snapshot.*`
- `op` — one of:
  - `eq`
  - `ge`
  - `contains`
  - `not_null`
  - `truthy`
- `value` — comparison value for operators that need one

## Order guarantees

The corpus is intentionally ordered.
Later operator-diagnostics cases rely on earlier Oracle/Nexus/Meta runtime cases having already produced telemetry.

## Execution

Use the deterministic runner:

```bash
python3 scripts/run_cortex_kernel_v2_benchmarks.py \
  --corpus benchmarks/cortex_kernel_v2_corpus_2026-04-01.json \
  --iterations 5 \
  --output artifacts/benchmarks/2026-04-01/baseline.json
```

The runner stubs network-heavy paths so the benchmark focuses on kernel/runtime discipline, telemetry integrity, and operator-surface visibility rather than external model/network variance.
