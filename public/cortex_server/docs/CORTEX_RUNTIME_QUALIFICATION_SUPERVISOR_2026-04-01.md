# Cortex Runtime Qualification Supervisor — 2026-04-01

## Purpose
This supervisor framework moves the stop condition for long-horizon qualification work out of the model's head and into:
- a machine-readable state file
- required artifact gates
- real background soak processes
- parent-side verification

This is the intended fix for premature "coherent slice" completion.

---

# Components

## Supervisor module
- `cortex_server/benchmarks/runtime_qualification_supervisor.py`

Provides:
- canonical stage order
- required artifact definitions
- state-file management
- stage verification
- next-stage / completion status
- completion summary generation
- notification state tracking
- background soak launch + poll/termination
- machine-readable stage specs

## CLI wrapper
- `scripts/run_runtime_qualification_supervisor.py`

Commands:
- `init`
- `status`
- `completion-summary`
- `verify [--require-complete]`
- `stage-spec [--stage <name>]`
- `run-stage --stage <name> [--background]`
- `poll`
- `terminate`
- `watch [--timeout-seconds N] [--interval-seconds N] [--mark-notified]`
- `mark-notified [--note TEXT]`

## Completion watcher wrapper
- `scripts/watch_runtime_qualification_completion.py`

This wrapper blocks until qualification is complete and then emits the final JSON payload for delivery.

## Human-readable notifier wrapper
- `scripts/run_runtime_qualification_notify_once.py`

This wrapper blocks until qualification is complete and then prints a concise human-facing summary derived from `completion_summary.json`. In OpenClaw, this is the best target for a dedicated watcher subagent because the subagent completion announcement becomes the user-facing notification.

---

# State file

Default state path:
- `artifacts/qualification/<date>/program_state.json`

Tracked fields include:
- stage order
- per-stage completion
- missing artifacts
- details from verification
- active process metadata for long-running soak stages
- next required stage
- all-complete flag

Additional machine-readable artifacts:
- `artifacts/qualification/<date>/completion_summary.json`
- `artifacts/qualification/<date>/notification_state.json`

---

# Mechanical completion gates

A run is only complete when these stages verify successfully:
- corpus
- baseline
- experiments
- tuning_loop_a
- tuning_loop_b
- soak_run_1
- soak_run_2
- soak_run_3
- final_rerun
- validation
- final_report

The supervisor verifies these from artifacts, not from model self-report.

---

# Background soak control

Soak stages should be launched with real OS processes:

```bash
python3 scripts/run_runtime_qualification_supervisor.py --date 2026-04-01 run-stage --stage soak_run_2 --background
```

Then checked with:

```bash
python3 scripts/run_runtime_qualification_supervisor.py --date 2026-04-01 poll
```

A soak stage is only marked complete when:
- the background process exits successfully
- the required soak artifact files exist
- the JSON reports `duration_seconds >= 1800`

This is what prevents fake or compressed completion.

---

# Parent-session enforcement model

Recommended usage pattern:
1. initialize supervisor state
2. run or delegate implementation/tuning work
3. use supervisor `status` / `verify` to check which stages are still missing
4. only accept completion if `verify --require-complete` returns success

To fix silent finishes, use the watcher layer so a parent session or wrapper can emit the completion summary as soon as `all_complete=true`.

This makes the parent session the judge of completion.

---

# Example usage

## Initialize or reconcile state
```bash
python3 scripts/run_runtime_qualification_supervisor.py --date 2026-04-01 init
```

## See stage requirements
```bash
python3 scripts/run_runtime_qualification_supervisor.py --date 2026-04-01 stage-spec
```

## Run auto-runnable baseline
```bash
python3 scripts/run_runtime_qualification_supervisor.py --date 2026-04-01 run-stage --stage baseline
```

## Launch a soak in background
```bash
python3 scripts/run_runtime_qualification_supervisor.py --date 2026-04-01 run-stage --stage soak_run_1 --background
```

## Poll active soak
```bash
python3 scripts/run_runtime_qualification_supervisor.py --date 2026-04-01 poll
```

## Verify completion
```bash
python3 scripts/run_runtime_qualification_supervisor.py --date 2026-04-01 verify --require-complete
```

## Emit completion summary
```bash
python3 scripts/run_runtime_qualification_supervisor.py --date 2026-04-01 completion-summary
```

## Block until complete and mark notification delivered
```bash
python3 scripts/watch_runtime_qualification_completion.py --date 2026-04-01 --mark-notified
```

## Block until complete and print a human summary
```bash
python3 scripts/run_runtime_qualification_notify_once.py --date 2026-04-01 --mark-notified
```

Exit code semantics:
- `0` = all required stages verified complete
- `2` = still incomplete

Watcher exit semantics:
- `0` = qualification completed and summary emitted
- `3` = timed out before completion

---

# Important note

The supervisor does **not** magically solve all autonomy issues by itself.
What it does is remove the weakest part of the old setup:
- letting the worker model also decide when the program is done

With this framework:
- the model can still do the work
- but the filesystem/process/state machine decide whether the gates were actually satisfied

That is the intended fix.
