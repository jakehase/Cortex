# Cortex 4-Hour Runtime Qualification Program — 2026-04-01

## Purpose
This program is designed to force a **real long-horizon autonomous run** that naturally lasts multiple hours.

It is not a normal feature roadmap.
It is a **qualification campaign** with mandatory measurement loops, soak windows, and artifact gates that make early completion invalid.

The goal is twofold:
1. improve Cortex runtime quality/stability/performance
2. prove that long-term autonomous execution can stay coherent over a 3–5+ hour engineering program

---

# Core rule

A run does **not** count as complete just because useful implementation landed.

It is only complete if all mandatory stages below are completed and all required artifacts exist.

If any mandatory stage is skipped, the run is incomplete.

---

# Required wall-clock structure

This program is intentionally shaped so that honest completion should take **at least ~3 hours**, and more realistically **4–5 hours**.

The unavoidable duration comes from:
- corpus expansion
- baseline measurements
- configuration matrix runs
- multiple tuning loops
- **three mandatory soak runs of 30 minutes each**
- broad regression validation
- final reporting

---

# Mandatory stages

## Stage 0 — Execution contract lock-in

### Goal
Prevent premature stopping.

### Requirements
- No partial-progress completion messages
- No “first coherent slice” stopping condition
- No claiming completion before all stages below are done
- If blocked, return:
  - exact blocker
  - artifact/status of each completed stage
  - what remains
  - why continuing would be unsafe or impossible

### Required artifact
- final report must include a stage completion checklist

---

## Stage 1 — Benchmark corpus expansion

### Goal
Create a larger, more realistic runtime qualification corpus.

### Minimum size
- **30 benchmark cases minimum**

### Required coverage
The corpus must include representative workloads for:
- Oracle
- Nexus
- Meta Conductor
- Mission Control / operator views
- Command Center / Command Center Live
- durability / long-sequence scenarios

### Required categories
At minimum:
1. micro utility / factual fast-path
2. memory continuity / follow-up
3. planning / architecture / tradeoff
4. coding / runtime orchestration
5. operator diagnostics / explain / trace
6. high-risk / high-ambiguity
7. durability / repeated-sequence stress cases

### Per-case metadata requirements
Each case should define where practical:
- id
- target runtime/surface
- category
- expected fast/deep tendency
- risk level
- latency expectation
- quality expectation
- pass/fail heuristics

### Required artifacts
- benchmark corpus file(s)
- corpus documentation

### Completion rule
Fewer than 30 cases means the run is incomplete.

---

## Stage 2 — Baseline qualification run

### Goal
Measure the pre-change or current-starting-point system with the expanded corpus.

### Required outputs per case where practical
- planned lane
- actual lane
- latency
- compile latency
- context assembly timing
- codec use
- runtime/surface metadata
- warnings/errors
- quality pass/fail

### Aggregate required outputs
- p50 latency
- p95 latency
- failure rate
- fast-path rate
- deep-path rate
- escalation rate
- warning count
- by-runtime breakdown

### Required artifacts
- baseline result JSON(s)
- baseline report doc

### Completion rule
No baseline artifacts = incomplete run.

---

## Stage 3 — Runtime experiment matrix

### Goal
Run a real matrix of runtime/system configurations and compare them.

### Minimum experiment count
- **6 distinct configuration variants minimum**

### Example experiment axes
- ONNX thread counts
- explicit vs implicit threading
- affinity-related runtime behavior
- benchmark-mode reduced concurrency
- context-budget variants
- degraded-runtime gating variants

### Required for each experiment
- config definition
- benchmark subset or full-corpus run
- metrics capture
- warnings capture
- comparison against baseline

### Required artifacts
- experiment matrix index
- per-experiment result files
- comparison summary

### Completion rule
Fewer than 6 real experiments = incomplete run.

---

## Stage 4 — Tuning loop A

### Goal
Use experiment evidence to change the system.

### Required work
- select promising configurations and/or code changes
- implement tuning changes
- rerun targeted benchmark subset
- record what improved or regressed

### Required artifacts
- tuning notes or change log
- updated result files

---

## Stage 5 — Tuning loop B

### Goal
Repeat the tuning cycle instead of stopping after one lucky improvement.

### Required work
- adjust based on loop A results
- rerun benchmark subset/full set where justified
- record comparison vs baseline and loop A

### Required artifacts
- second tuning report/update
- result files for loop B

### Completion rule
If only one tuning loop happened, the run is incomplete.

---

## Stage 6 — Mandatory soak phase

### Goal
Force true wall-clock endurance validation.

### Mandatory runs
The following are required and may not be skipped:
- **Soak Run 1 — 30 minutes minimum**
- **Soak Run 2 — 30 minutes minimum**
- **Soak Run 3 — 30 minutes minimum**

### Required soak properties
Each soak run must:
- use an explicit runtime/config selection
- produce JSON results
- capture stderr/warnings
- record latency drift over time
- record failure rate over time
- record by-runtime breakdown where possible

### Required artifacts
- `soak_run_1.*`
- `soak_run_2.*`
- `soak_run_3.*`
- aggregate soak summary

### Completion rule
If all three 30-minute soak runs do not exist, the run is incomplete.

This stage is the main mechanism that makes the total task honestly multi-hour.

---

## Stage 7 — Final qualification rerun

### Goal
Run the best-known configuration after tuning/soak work and capture the final comparable numbers.

### Required outputs
- final benchmark results
- before/after comparison against baseline
- comparison against best intermediate run
- comparison against soak behavior

### Required artifacts
- final result JSON(s)
- final comparison tables or report content

---

## Stage 8 — Broad repo validation

### Goal
Prove that improvements did not break the wider system.

### Required validation
- focused runtime/kernel/benchmark tests
- broad repo suite
- report exact commands run
- report pass/fail counts

### Completion rule
No broad validation = incomplete run.

---

## Stage 9 — Final qualification report

### Goal
Produce a single operator/engineering summary.

### Required contents
The final report must include:
1. stage completion checklist
2. corpus summary
3. baseline metrics
4. experiment matrix summary
5. tuning loop A changes/results
6. tuning loop B changes/results
7. soak run results
8. final benchmark results
9. before/after summary
10. remaining risks
11. recommended runtime defaults
12. exact validation performed

### Required artifact
- final report doc in `docs/`

### Completion rule
No final report = incomplete run.

---

# Hard anti-premature-stop rules

The run is automatically considered incomplete if any of these are missing:
- corpus with at least 30 cases
- baseline run artifacts
- at least 6 configuration experiments
- two tuning loops
- three 30-minute soak runs
- final rerun
- broad validation
- final report

This is specifically to prevent a model from compressing the task into a short feature burst and calling it done.

---

# Suggested artifact layout

## Corpus
- `benchmarks/cortex_runtime_qualification_corpus_2026-04-01.json`

## Baseline
- `artifacts/qualification/2026-04-01/baseline/*.json`

## Experiments
- `artifacts/qualification/2026-04-01/experiments/index.json`
- `artifacts/qualification/2026-04-01/experiments/*.json`

## Tuning loops
- `artifacts/qualification/2026-04-01/tuning_loop_a/*.json`
- `artifacts/qualification/2026-04-01/tuning_loop_b/*.json`

## Soak runs
- `artifacts/qualification/2026-04-01/soak_run_1.*`
- `artifacts/qualification/2026-04-01/soak_run_2.*`
- `artifacts/qualification/2026-04-01/soak_run_3.*`
- `artifacts/qualification/2026-04-01/soak_summary.json`

## Final
- `artifacts/qualification/2026-04-01/final/*.json`
- `docs/CORTEX_RUNTIME_QUALIFICATION_FINAL_REPORT_2026-04-01.md`

---

# Recommended execution contract prompt

Use this exact style of instruction for the long-running job:

> Execute the full Cortex 4-Hour Runtime Qualification Program from `docs/CORTEX_4_HOUR_RUNTIME_QUALIFICATION_PROGRAM_2026-04-01.md`. Do not stop for partial progress. Completion requires: a corpus with at least 30 cases, a baseline run, at least 6 config experiments, two tuning loops, three 30-minute soak runs, a final rerun, broad validation, and a final report. If any of those are missing, the task is not complete. Only stop when the full program is complete or when you hit a real blocker.

---

# Why this should last 3+ hours

Approximate honest timeline:
- corpus expansion: 45–60 min
- baseline run + analysis: 20–40 min
- 6 config experiments: 60–90 min
- two tuning loops: 30–60 min
- three mandatory 30-minute soak runs: 90 min minimum
- final rerun + validation + report: 30–60 min

Even with efficient execution, this naturally pushes into the **3–5+ hour** range.

---

# What not to do

Do not count any of these as sufficient:
- one implementation slice
- one benchmark improvement
- one good config run
- one soak run
- no final report
- no broad validation

Those would all fail the endurance test.

---

# Final framing

This program is designed so that a model cannot honestly pass it by being merely clever.
It must demonstrate:
- sustained execution
- repeated measurement
- disciplined tuning
- long-duration validation
- final reporting

That is the right shape for a true 3+ hour autonomous task test.
