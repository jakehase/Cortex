# Dependability Phase 0 (LiveBench)

> Phase 1 extensions now documented in `docs/DEPENDABILITY_PHASE1.md`.

Phase 0 introduces a **run-capsule + run-twin** pattern for long benchmark runs:

- **Run capsule**: immutable run context (model, benches, commands, logs, invariants).
- **Run twin**: external state mirror stored under `reports/run_twin/<run_id>/`.

## Invariant (operator-critical)

**Status checks are read-only and do not touch the worker process.**

`run_livebench_status.py` reads `snapshot.json` from run-twin only. It does not inspect, signal, or query the live worker.

---

## Start command

From repo root (preferred helper):

```bash
benchmarks/LiveBench/run_dependable.sh \
  --model cortex-oracle \
  --api-base http://127.0.0.1:8010/v1 \
  --api-key dummy \
  --bench-name live_bench \
  --parallel-requests 3 \
  --parallel-grading 4
```

Direct (from `benchmarks/LiveBench/livebench/`):

```bash
python3 run_livebench_dependable.py ...
```

Optional dependability knobs:

- `--stall-minutes 20` (no-progress threshold)
- `--max-restarts 2` (bounded inference restarts)
- `--status-interval-seconds 30` (run-twin snapshot cadence)
- `--run-tag <tag>` / `--run-id <id>`

---

## Status command (read-only)

```bash
python3 run_livebench_status.py --run-tag <run_tag>
# or
python3 run_livebench_status.py --run-id <run_id>
# or latest tag from logs/latest_run_tag.txt
python3 run_livebench_status.py
```

JSON mode:

```bash
python3 run_livebench_status.py --run-tag <run_tag> --json
```

---

## Control expectations

- The dependable runner writes snapshots every ~30s.
- Inference progress is computed from model answer files (`answered/total`).
- If progress stalls for `--stall-minutes`, the runner terminates and restarts inference with `--resume --retry-failures` (up to `--max-restarts`).
- After inference completes, it runs grading and result display.
- Final snapshot includes status, return codes, and artifact paths.

---

## Ordering-integrity protocol (operator use)

To avoid stale responses/actions in asynchronous operations:

1. Always bind outbound replies/actions to the **newest pending user message id**.
2. Before sending a result, verify the target message id is still the latest unresolved request.
3. If a newer user message arrives, treat previous pending drafts as stale unless explicitly still requested.
4. Prefer id-based correlation over timestamp-only correlation.
5. Never let a delayed completion overwrite/replace a newer, already-bound response.

This protocol prevents out-of-order updates from long-running jobs.
