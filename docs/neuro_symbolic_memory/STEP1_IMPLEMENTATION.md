# Neuro-Symbolic Memory Substrate — Step 1 (Implemented)

## Objective
Implement Step 1 of the roadmap: define success criteria and freeze a reproducible baseline that can be composed with Steps 2–12.

## What was implemented
1. **Metric contract (machine-readable)**
   - File: `config/neuro_symbolic_memory/step1_metrics.json`
   - Defines 5 locked metrics:
     - `delayed_recall_accuracy` (24h, 7d)
     - `contradiction_rate_per_100`
     - `long_task_continuity`
     - `personalization_retention`
     - `procedure_reuse_success`

2. **Integration schema for downstream steps**
   - Stable schema: `nsm_metric_record_v1`
   - Stable join keys: `metric_id`, `window`, `run_id`, `timestamp_utc`
   - Future-step compatibility explicitly encoded (`future_steps: 2..12`).

3. **Baseline harness script**
   - File: `scripts/nsm_step1_baseline.py`
   - Capabilities:
     - seeds delayed-recall and personalization probes in L22 + L7
     - computes current baseline snapshot
     - emits integration-ready artifacts (JSON + Markdown)

4. **Artifact outputs**
   - Directory: `artifacts/neuro_symbolic_memory/step1/`
   - Files:
     - `baseline_latest.json`
     - `baseline_latest.md`
     - timestamped copies per run

## Why this is compatible with later steps
- Step 2 (schema) and Step 3 (stores) can consume the same metric IDs.
- Step 4/5 (ingestion/retrieval) can update metric values without changing record shape.
- Step 6/7 (consolidation/forgetting) can compare against the frozen baseline run IDs.
- Step 8+ (procedural + novel methods + ablations) can produce apples-to-apples deltas using the same join keys.

## Notes
- Delayed-recall windows may show `warming_up` until seeded cases mature (24h/7d).
- This is expected and preserves baseline integrity (no fabricated measurements).
