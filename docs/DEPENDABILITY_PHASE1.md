# Dependability Phase 1 (LiveBench)

> Phase 2 extensions now documented in `docs/DEPENDABILITY_PHASE2.md`.

Phase 1 extends Phase 0 with **preflight gating**, **single-writer lock isolation**, and **ordered snapshot sequencing**.

## What’s new

1. **Preflight gate (default ON)** in `run_livebench_dependable.py`
   - Validates python executable, required LiveBench scripts, question set non-empty, logs dir writable, and `openai` import smoke.
   - Optional API reachability smoke (`/models`) with `--preflight-require-api` to make it fatal.
   - Writes preflight outcome into run-twin snapshot and events.

2. **Single-writer run lock**
   - New helper: `reliability/run_lock.py`
   - Prevents concurrent writers in the same work plane.
   - Enabled by default (`--lock-name livebench-dependable`), can be bypassed with `--disable-lock`.

3. **Snapshot ordering integrity**
   - `reliability/run_twin.py` now stamps monotonic `snapshot_seq` on each snapshot write.
   - `run_livebench_status.py` prints `snapshot_seq` so operators can detect stale status reads.

## Commands

Start dependable run (Phase 1 defaults):

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

Read status (still read-only):

```bash
python3 benchmarks/LiveBench/livebench/run_livebench_status.py --run-tag <tag>
```

Preflight controls:

- `--skip-preflight`
- `--preflight-timeout-seconds 6`
- `--preflight-require-api`

Lock controls:

- `--lock-name <name>`
- `--disable-lock`

## Invariants retained

- Status path remains read-only from run-twin snapshot (`reports/run_twin/<run_id>/snapshot.json`).
- Status checks never touch the live worker process.
- Restarts remain bounded (`--max-restarts`) with forced `--resume --retry-failures` after stall/failure.
