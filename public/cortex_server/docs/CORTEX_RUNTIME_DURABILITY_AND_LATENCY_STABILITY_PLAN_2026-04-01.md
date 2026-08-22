# Cortex Runtime Durability and Latency Stability Plan — 2026-04-01

## Purpose
Follow up on the Kernel V2 benchmark program by targeting the main remaining weakness:

- sustained Oracle/Nexus-heavy latency drift over longer runs
- likely influenced by host/container ONNX Runtime thread-affinity behavior

This is a **tight, practical stabilization plan**, not another broad architecture rewrite.
Its purpose is to turn the benchmark findings into a controlled durability hardening effort.

---

# Problem statement

Kernel V2 improved correctness, routing discipline, and several benchmark outcomes, but the durability run still showed instability over longer sequences.

## Observed symptoms
- longer runs degraded trace latency
- Oracle/Nexus-heavy benchmark cases drifted upward over time
- durability metrics were meaningfully worse than the best short-run post-change numbers

## Leading suspected cause
- ONNX Runtime thread-affinity behavior in this host/container environment
- possible interaction with:
  - container CPU topology visibility
  - thread pinning/affinity defaults
  - oversubscription
  - runtime contention between inference and surrounding orchestration work

## Working hypothesis
The remaining issue is no longer primarily “bad routing logic.”
It is likely a **runtime execution stability problem** at the model/runtime/container layer.

---

# North star
At the end of this plan, Cortex should be able to:
- hold stable latency under longer benchmark runs
- avoid drift caused by poor host/runtime threading behavior
- preserve Kernel V2’s correctness/routing gains
- expose enough telemetry to distinguish infra/runtime instability from planner/router regressions

---

# Success criteria

## Primary
- reduce durability-run latency drift versus current `final.json`
- reduce Oracle/Nexus-heavy p50/p95 trace latency during prolonged runs
- preserve or improve current benchmark failure-rate gains

## Secondary
- make host/runtime causes easier to attribute
- add operator-visible signals for runtime pressure / contention
- document safe runtime configuration defaults

## Hard safety rule
No durability optimization counts if it materially regresses correctness or broad test-suite behavior.

---

# Program stages

## Stage 1 — Reproduce and isolate

### Goal
Confirm exactly where the latency drift is coming from.

### Work
- rerun the existing benchmark corpus with emphasis on:
  - Oracle-heavy subsets
  - Nexus-heavy subsets
  - mixed long-sequence runs
- separate results by runtime/surface
- capture stderr/runtime warnings during benchmark runs
- specifically log ONNX-related affinity/thread warnings as first-class benchmark metadata

### Deliverables
- a short reproduction report:
  - which cases drift most
  - whether warnings correlate with drift
  - whether drift is runtime-specific or shared

### Exit criteria
- drift is reproducible and classified by runtime/surface

---

## Stage 2 — Add runtime-pressure instrumentation

### Goal
Make the system observable enough that we can see contention instead of inferring it vaguely.

### Work
Add telemetry fields where practical for:
- runtime backend used
- inference/warning counters
- per-run warning summaries
- benchmark-run environment metadata
- queue depth / pending work / active trace counts
- coarse timing breakdowns for:
  - compile
  - context assembly
  - runtime routing
  - downstream execution

### Operator surfaces
Expose where appropriate through:
- Mission Control runtime economics
- kernel diagnostics bundle
- benchmark result artifacts

### Exit criteria
- durability runs produce enough metadata to support cause attribution

---

## Stage 3 — Host/runtime configuration experiments

### Goal
Test targeted runtime mitigations instead of guessing.

### Candidate experiments
At minimum, test controlled variants of:
- ONNX/ML runtime thread-count limits
- intra-op vs inter-op thread settings
- affinity disable or alternate affinity behavior where supported
- environment-variable based runtime controls
- reduced concurrency in Oracle/Nexus-heavy paths during benchmark mode
- container-visible CPU count / scheduling assumptions

### Experiment matrix
Each experiment should be benchmarked against a common subset, for example:
- baseline current config
- single-thread conservative runtime
- low-thread bounded runtime
- affinity-relaxed runtime
- benchmark-mode serialized or reduced-parallel run

### Deliverables
- experiment table
- before/after results per config
- recommended runtime defaults

### Exit criteria
- at least one configuration is shown to improve durability without harming correctness

---

## Stage 4 — Kernel/route adaptation for unstable runtimes

### Goal
Let Cortex respond gracefully if the runtime environment is degraded.

### Work
Add guarded behavior such as:
- benchmark-mode runtime caps
- degraded-runtime markers in kernel telemetry
- optional conservative mode for Oracle/Nexus when runtime pressure is high
- lower-cost fallback planning when inference runtime warnings spike
- explicit runtime-health fields in diagnostics bundle

### Important rule
This is not about hiding problems.
It is about making the system adapt transparently when runtime conditions are bad.

### Exit criteria
- degraded runtime states are visible and can influence safe routing behavior in a bounded way

---

## Stage 5 — Durability benchmark loop

### Goal
Prove the stability fix under repeated runs, not just one lucky pass.

### Required runs
- rerun durability benchmark multiple times
- compare against:
  - original baseline
  - current post-change best run
  - original durability run

### Metrics to watch
- overall failure rate
- trace failure rate
- trace latency p50/p95
- warning count / warning correlation
- per-runtime drift deltas

### Exit criteria
- improved durability metrics are repeatable across runs

---

## Stage 6 — Final stabilization report

### Goal
Capture a clean operator/engineering summary.

### Final report should include
- confirmed root-cause assessment level:
  - confirmed
  - strongly suspected
  - still ambiguous
- winning runtime configuration
- benchmark deltas
- any remaining caveats
- recommended production defaults
- rollback instructions if the runtime tuning causes regressions

---

# Practical implementation targets

## Likely code areas
- `cortex_server/modules/cortex_kernel_v2.py`
- `cortex_server/modules/latency_budget_governor.py`
- benchmark runner and benchmark artifacts logic
- Oracle/Nexus runtime integration points
- Mission Control runtime economics surfaces
- any runtime wrapper/config modules currently feeding ONNX-backed behavior

## Likely docs/artifacts
- new durability-specific report
- updated validation summary
- benchmark experiment result files
- host/runtime configuration notes

---

# Suggested concrete deliverables

## Docs
- `docs/CORTEX_RUNTIME_DURABILITY_AND_LATENCY_STABILITY_PLAN_2026-04-01.md`
- `docs/CORTEX_RUNTIME_DURABILITY_BASELINE_2026-04-01.md`
- `docs/CORTEX_RUNTIME_DURABILITY_FINAL_REPORT_2026-04-01.md`

## Artifacts
- `artifacts/benchmarks/<date>/durability_experiments/*.json`

## Tests
- benchmark runner tests for warning capture / environment metadata
- runtime diagnostics tests
- route adaptation tests for degraded-runtime markers

---

# Fastest path to value
If we want the shortest high-value follow-up, do this in order:

1. reproduce drift with runtime warning capture
2. add runtime-pressure telemetry
3. test 3–5 runtime thread/affinity configs
4. pick the best stable config
5. rerun durability benchmark
6. publish final report

That is the shortest path from “we suspect ONNX/runtime instability” to “we have evidence and a safer operating configuration.”

---

# What not to do
- do not immediately add more planner complexity
- do not assume routing logic is the main culprit without runtime evidence
- do not declare success from one short-run benchmark win
- do not hide runtime degradation behind silent fallbacks

---

# Final framing
Kernel V2 made Cortex smarter and more disciplined.
This follow-up plan is about making it **stay fast and stable under sustained real load**.

That is the right next move.
