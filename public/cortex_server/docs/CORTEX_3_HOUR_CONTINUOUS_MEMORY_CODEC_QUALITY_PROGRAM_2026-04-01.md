# Cortex 3-Hour Continuous Memory/Codec Quality Program — 2026-04-01

## Purpose
This program is designed to test two things at once:

1. materially improve Cortex memory/codec quality
2. force a **truly continuous 3+ hour autonomous run**

The key requirement is not just elapsed time.
It is **continuous work**.

That means the program must be structured so the system always has another active task to do:
- while benchmark runs execute
- while durability loops are running
- while results are being written
- while reports are being updated

No passive “start soak and mostly wait” behavior should count as success.

---

# Core rule

A run only counts as valid if it is:
- **multi-hour**, and
- **continuously occupied with active work**

This means the roadmap must include:
- background execution lanes
- foreground analysis/tuning lanes
- a standing work queue
- no stage that degenerates into idle waiting for long periods

---

# What we are evaluating

This program focuses on the quality of Cortex memory and codec behavior, especially:
- continuity across turns
- preference recall quality
- active-project/open-loop retention quality
- stale memory suppression
- false-memory / invented-memory rate
- correct use of codec vs skipping codec
- context-budget discipline
- memory usefulness across Oracle/Nexus-style reasoning surfaces

---

# Definition of continuous work

A run qualifies as **continuous** only if, for the full program duration, at least one of the following is always active:
- benchmark runner
- experiment runner
- memory-case triage/labeling work
- tuning implementation work
- artifact/report synthesis work
- regression analysis work

The system should behave like a small research team, not like a single worker waiting on a stopwatch.

---

# Program architecture

The program should run in **parallel lanes**.

## Lane A — Runner lane
Responsible for:
- corpus execution
- repeatability runs
- long-sequence memory durability runs
- config matrix runs

## Lane B — Analysis lane
Responsible for:
- clustering failures
- tagging false-memory vs stale-memory vs omission vs over-triggered security/risk routing
- selecting next tuning changes
- maintaining the rolling triage queue

## Lane C — Tuning lane
Responsible for:
- changing codec thresholds/budgets/rules
- adjusting memory continuity detection
- refining bucket policies
- improving prompt/context memory assembly behavior

## Lane D — Reporting lane
Responsible for:
- updating baseline/intermediate/final reports
- maintaining comparison tables
- preserving evidence for each tuning loop

The whole point is that while Lane A is busy running, B/C/D still have work to do.

---

# Hard completion gates

This run is **not complete** unless all mandatory gates are satisfied.

## Gate 1 — Memory/codec corpus
Must create a real evaluation corpus.

### Minimum size
- **40 cases minimum**

### Required categories
At minimum:
1. preference memory
2. preference override / changed preference
3. active project continuity
4. open loop continuity
5. stale memory suppression
6. false-memory trap cases
7. codec helpful / codec harmful comparison cases
8. cross-turn follow-up continuity
9. operator-visible explanation / why-memory-was-used cases
10. long-sequence durability memory cases

### Per-case metadata
Each case must define where practical:
- id
- category
- target surface/runtime
- prior context setup
- expected memory behavior
- expected codec behavior
- expected failure modes
- success/failure rubric

### Required artifact
- `benchmarks/cortex_memory_codec_quality_corpus_2026-04-01.json`

### Completion rule
Fewer than 40 cases = incomplete.

---

## Gate 2 — Baseline quality run
Run the full corpus against the current system.

### Required outputs
Per case where practical:
- codec used or skipped
- memory sources used
- continuity success/failure
- false-memory indicator
- stale-memory indicator
- latency
- context/codec size contribution
- quality label

### Aggregate metrics
At minimum:
- overall pass rate
- false-memory rate
- stale-memory failure rate
- omission rate
- preference recall accuracy
- open-loop continuity accuracy
- codec-overuse rate
- codec-underuse rate
- latency summary

### Required artifacts
- baseline result JSON
- baseline report doc

---

## Gate 3 — Experiment matrix
Must test multiple meaningful memory/codec configurations.

### Minimum
- **8 configurations minimum**

### Candidate dimensions
- codec enabled vs bounded vs suppressed on certain archetypes
- memory continuity thresholds
- stale-memory decay/retention behavior
- bucket-specific budget caps
- preference prioritization strength
- open-loop prioritization strength
- follow-up detection thresholds
- memory-vs-live-evidence preference ordering

### Required artifacts
- experiment index
- per-config result files
- comparison summary

### Completion rule
Fewer than 8 real configs = incomplete.

---

## Gate 4 — Triage queue
This is one of the mechanisms that guarantees continuous work.

### Requirement
Maintain an explicit triage queue of at least:
- **20 failure clusters minimum**

Each cluster should be labeled such as:
- false_memory
- stale_memory
- preference_miss
- project_continuity_miss
- open_loop_miss
- codec_overuse
- codec_underuse
- latency_budget_overrun
- wrong-surface-context selection

### Required artifact
- failure cluster queue JSON/MD

### Completion rule
No triage queue = incomplete.

---

## Gate 5 — Tuning loop A
Use experiment data and triage queue to land real changes.

### Required work
- implement at least one meaningful tuning batch
- rerun targeted subsets
- document what improved/regressed

### Required artifact
- tuning loop A summary

---

## Gate 6 — Tuning loop B
Repeat tuning with a second cycle.

### Required work
- second tuning batch informed by loop A results
- rerun targeted subsets
- document improvements/regressions

### Required artifact
- tuning loop B summary

### Completion rule
Only one tuning loop = incomplete.

---

## Gate 7 — Continuous-work durability lane
This is the part that ensures the run stays occupied for hours, not just minutes.

### Requirement
Run **three 30-minute memory/codec durability workloads**, but do not let the system idle during them.

Mandatory durability runs:
- memory durability run 1 — 30 min
- memory durability run 2 — 30 min
- memory durability run 3 — 30 min

### During each durability run, the foreground must continue doing active tasks:
While run 1 is executing:
- analyze baseline/experiment failures
- expand failure clusters
- prepare tuning loop A

While run 2 is executing:
- analyze loop A deltas
- refine tuning loop B
- draft interim findings

While run 3 is executing:
- prepare final comparison tables
- validate cluster resolutions
- draft final report sections

### Required artifacts
- `memory_durability_run_1.*`
- `memory_durability_run_2.*`
- `memory_durability_run_3.*`
- active foreground-work logs or summaries for each durability window

### Completion rule
If the durability runs happen but no concurrent foreground work artifacts exist, the run is incomplete.

This is the key continuous-work enforcement mechanism.

---

## Gate 8 — Final rerun
Run the winning configuration across the full corpus again.

### Required artifacts
- final result JSON
- final comparison vs baseline

---

## Gate 9 — Broad validation
Run validation so memory/codec tuning didn’t break broader behavior.

### Required validation
- focused memory/codec tests
- relevant runtime/kernel tests
- broad repo suite or broad relevant suite

### Required artifact
- validation summary

---

## Gate 10 — Final report

### Required contents
The final report must include:
1. stage checklist
2. corpus summary
3. baseline metrics
4. config matrix summary
5. triage queue summary
6. tuning loop A changes/results
7. tuning loop B changes/results
8. durability run results
9. foreground concurrent work completed during durability windows
10. final benchmark results
11. before/after summary
12. remaining weaknesses
13. recommended defaults
14. exact validation run

### Required artifact
- final memory/codec quality report doc

---

# Continuous-work enforcement design

This program should not be run as one agent doing one thing at a time.

It should be run as a **supervised multi-lane program**:

## Background lane(s)
- corpus execution
- long memory durability runs
- config sweeps

## Foreground lane(s)
- triage clustering
- tuning changes
- report synthesis
- validation prep

## Supervisor requirements
The supervisor should check not only:
- required artifacts exist

but also:
- each durability window has corresponding foreground-work artifacts

That is what enforces *continuous* work rather than passive waiting.

---

# Suggested artifact layout

## Corpus
- `benchmarks/cortex_memory_codec_quality_corpus_2026-04-01.json`

## Baseline
- `artifacts/memory_codec_quality/2026-04-01/baseline/*`

## Experiments
- `artifacts/memory_codec_quality/2026-04-01/experiments/index.json`
- `artifacts/memory_codec_quality/2026-04-01/experiments/*.json`

## Triage queue
- `artifacts/memory_codec_quality/2026-04-01/triage/failure_clusters.json`
- `artifacts/memory_codec_quality/2026-04-01/triage/failure_clusters.md`

## Tuning loops
- `artifacts/memory_codec_quality/2026-04-01/tuning_loop_a/*`
- `artifacts/memory_codec_quality/2026-04-01/tuning_loop_b/*`

## Durability runs
- `artifacts/memory_codec_quality/2026-04-01/durability_run_1.*`
- `artifacts/memory_codec_quality/2026-04-01/durability_run_2.*`
- `artifacts/memory_codec_quality/2026-04-01/durability_run_3.*`

## Foreground-work evidence
- `artifacts/memory_codec_quality/2026-04-01/foreground_window_1_summary.md`
- `artifacts/memory_codec_quality/2026-04-01/foreground_window_2_summary.md`
- `artifacts/memory_codec_quality/2026-04-01/foreground_window_3_summary.md`

## Final
- `artifacts/memory_codec_quality/2026-04-01/final/*`
- `docs/CORTEX_MEMORY_CODEC_QUALITY_FINAL_REPORT_2026-04-01.md`

---

# Why this should actually last 3+ hours continuously

Approximate real timeline:
- corpus creation/expansion: 45–60 min
- baseline run + analysis: 20–30 min
- experiment matrix runs: 45–75 min
- triage queue construction: 30–45 min
- tuning loop A + reruns: 20–30 min
- tuning loop B + reruns: 20–30 min
- three 30-minute durability runs: 90 min
- during those 90 minutes, concurrent foreground work continues
- final rerun + validation + report: 30–45 min

That naturally pushes this into the **3–5+ hour** range, and the concurrent foreground-work requirement prevents the soak period from degenerating into idle time.

---

# Recommended execution contract prompt

Use this style of instruction:

> Execute the full Cortex 3-Hour Continuous Memory/Codec Quality Program. Completion requires: a 40+ case corpus, baseline run, 8+ configuration experiments, a 20+ cluster triage queue, two tuning loops, three 30-minute durability runs, foreground-work artifacts during each durability window, a final rerun, broad validation, and a final report. If any of those are missing, the task is incomplete. Do not stop after implementation slices; maintain continuous work for the full program.

---

# Final framing

This program is designed so that the model cannot pass by being merely fast or clever.
It must demonstrate:
- repeated measurement
- real memory/codec improvement work
- continuous concurrent activity
- long-duration execution
- final reporting with evidence

That is the correct shape for a true continuous 3+ hour memory/codec quality test.
