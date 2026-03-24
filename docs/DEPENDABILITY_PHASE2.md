# Dependability Phase 2 (LiveBench)

Phase 2 adds **policy-driven recovery**, **read-only watchdog checks**, and **status timeline visibility** on top of Phase 1.

## New capabilities

1. **Policy-driven restart behavior** in `run_livebench_dependable.py`
   - Restart backoff: `--restart-backoff-seconds`
   - Adaptive concurrency reduction across restarts:
     - `--adaptive-parallel-floor`
     - `--disable-adaptive-parallel` (opt-out)
   - Failure signature extraction from inference logs (stored in events/snapshots) for faster diagnosis.

2. **Read-only watchdog** (`run_livebench_watchdog.py`)
   - Monitors run-twin snapshot freshness and no-progress windows.
   - Never touches worker process.
   - Exit code `2` on stale/stalled condition (cron-friendly).

3. **Status timeline + freshness checks** in `run_livebench_status.py`
   - `--events N` prints last N run-twin events.
   - `--check-fresh-seconds` fails with exit `2` if snapshot is too old.
   - Prints `snapshot_seq`, current parallel request count, and preflight summary.

## Commands

Start dependable run (Phase 2 defaults):

```bash
cd benchmarks/LiveBench
./run_dependable.sh \
  --model cortex-oracle \
  --bench-name live_bench \
  --api-base http://127.0.0.1:8010/v1 \
  --api-key dummy \
  --parallel-requests 3 \
  --parallel-grading 4
```

Status with timeline + freshness gate:

```bash
python3 benchmarks/LiveBench/livebench/run_livebench_status.py \
  --run-tag <tag> --events 8 --check-fresh-seconds 180
```

Watchdog probe (read-only):

```bash
python3 benchmarks/LiveBench/livebench/run_livebench_watchdog.py \
  --run-tag <tag> --max-stale-seconds 180 --max-no-progress-seconds 1500
```

## Invariants retained

- Status and watchdog are read-only and sourced from run-twin state.
- Worker isolation lock remains default-on (single writer).
- Restart loop remains bounded by `--max-restarts`.
- Snapshot ordering remains monotonic via `snapshot_seq`.
