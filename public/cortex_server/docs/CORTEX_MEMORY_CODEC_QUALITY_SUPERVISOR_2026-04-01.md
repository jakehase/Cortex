# Cortex Memory/Codec Quality Supervisor — 2026-04-01

## Purpose
This supervisor framework enforces completion for the continuous memory/codec quality program using:
- a machine-readable state file
- artifact-gated stage verification
- completion summary generation
- notification state tracking
- a watcher/notifier wrapper for automatic completion delivery

This is the same fix pattern used for runtime qualification, adapted to the continuous memory/codec roadmap.

---

# Components

## Supervisor module
- `cortex_server/benchmarks/memory_codec_quality_supervisor.py`

Provides:
- canonical stage order
- required artifact definitions
- stage verification
- next-stage / all-complete status
- completion summary generation
- notification state tracking

## CLI wrapper
- `scripts/run_memory_codec_quality_supervisor.py`

Commands:
- `init`
- `status`
- `completion-summary`
- `verify [--require-complete]`
- `stage-spec [--stage <name>]`
- `watch [--timeout-seconds N] [--interval-seconds N] [--mark-notified]`
- `mark-notified [--note TEXT]`

## Human notifier
- `scripts/run_memory_codec_quality_notify_once.py`

Blocks until the program is complete and then prints a clean human-readable completion summary.

---

# State and artifacts

Default state path:
- `artifacts/memory_codec_quality/<date>/program_state.json`

Completion payload:
- `artifacts/memory_codec_quality/<date>/completion_summary.json`

Notification state:
- `artifacts/memory_codec_quality/<date>/notification_state.json`

---

# Hard gates enforced

The supervisor only reports completion when all of these are satisfied:
- corpus with 40+ cases
- baseline artifacts
- experiment matrix with 8+ configurations
- triage queue with 20+ clusters
- tuning loop A
- tuning loop B
- durability run 1 + foreground window 1
- durability run 2 + foreground window 2
- durability run 3 + foreground window 3
- final rerun
- validation
- final report

This is how the program enforces continuous work rather than passive elapsed time.

---

# Recommended launch pattern

## Initialize state
```bash
cd /root/clawd/public/cortex_server
python3 scripts/run_memory_codec_quality_supervisor.py --date 2026-04-01 init
```

## Start the worker run
Launch the long-running implementation/evaluation worker.

## Start the notifier watcher separately
```bash
cd /root/clawd/public/cortex_server
python3 scripts/run_memory_codec_quality_notify_once.py --date 2026-04-01 --mark-notified
```

## Verify mechanically
```bash
cd /root/clawd/public/cortex_server
python3 scripts/run_memory_codec_quality_supervisor.py --date 2026-04-01 verify --require-complete
```

Exit code semantics:
- `0` = complete
- `2` = incomplete

Watcher exit semantics:
- `0` = completed and summary emitted
- `3` = timed out before completion

---

# Why this is the right launch method

This prevents the old failure mode where the worker lands a useful slice and decides it is done.

With this supervisor:
- the worker does the work
- the filesystem proves stage completion
- the watcher handles completion delivery

That is the intended control loop.
