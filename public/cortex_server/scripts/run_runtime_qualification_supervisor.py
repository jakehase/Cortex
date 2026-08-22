#!/usr/bin/env python3
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime
import json
import os
from pathlib import Path
import re
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from cortex_server.benchmarks import runtime_qualification_supervisor as supervisor


def _print(payload):
    print(json.dumps(payload, indent=2, sort_keys=True))


def _validated_date(value: str) -> str:
    """Accept only canonical calendar dates before supervisor constructs paths."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise argparse.ArgumentTypeError("date must use strict YYYY-MM-DD format")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"invalid calendar date: {value}") from exc
    if parsed.strftime("%Y-%m-%d") != value:
        raise argparse.ArgumentTypeError(f"invalid calendar date: {value}")
    return value


def _qualification_root(date: str) -> Path:
    base = (REPO_ROOT / "artifacts" / "qualification").resolve()
    candidate = (base / date).resolve()
    if candidate == base or base not in candidate.parents:
        raise ValueError("qualification path escapes qualification root")
    return candidate


def _process_start_time(pid: int) -> str | None:
    """Return the kernel process start tick, which disambiguates PID reuse."""
    if pid <= 0:
        return None
    try:
        # comm may contain spaces and ')', so fields begin after the last ')'.
        fields = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8").rsplit(")", 1)[1].split()
        return fields[19]  # field 22 overall; suffix starts at field 3
    except (OSError, IndexError):
        return None


def _validate_background_launch(date: str, result):
    """Fail closed unless the launch result matches the durable owner record.

    ``launch_stage`` is solely responsible for observing and persisting the
    kernel-backed process identity.  The CLI must not reconstruct that
    security boundary from its command arguments (or write launch state at
    all), because doing so weakens the supervisor's v1 identity.
    """
    returned = (result or {}).get("active_process") if isinstance(result, dict) else None
    if not isinstance(result, dict) or not result.get("launched") or not isinstance(returned, dict):
        return result

    persisted = (supervisor.load_or_create_state(date).get("active_process") or None)
    try:
        returned_pid = int(returned.get("pid"))
        persisted_pid = int(persisted.get("pid")) if isinstance(persisted, dict) else 0
    except (TypeError, ValueError):
        returned_pid = persisted_pid = 0

    identity = returned.get("process_identity")
    if not (
        returned_pid > 0
        and isinstance(returned.get("run_id"), str) and returned["run_id"]
        and isinstance(persisted, dict)
        and persisted_pid == returned_pid
        and persisted.get("run_id") == returned.get("run_id")
        and persisted.get("stage") == returned.get("stage")
        and supervisor._valid_process_identity(identity)
        and persisted.get("process_identity") == identity
    ):
        raise RuntimeError("background launch result does not match persisted active process")
    return result


def _terminate_verified(date: str):
    state = supervisor.load_or_create_state(date)
    active = state.get("active_process") or None
    if not active:
        return {"terminated": False, "reason": "no_active_process"}
    try:
        pid = int(active.get("pid"))
    except (TypeError, ValueError):
        pid = 0
    expected_start = str((active.get("process_identity") or {}).get("start_time") or "")
    actual_start = _process_start_time(pid)
    if pid <= 0 or not expected_start or actual_start != expected_start:
        return {"terminated": False, "reason": "process_identity_mismatch"}
    return supervisor.terminate_active_process(date)


@contextmanager
def _process_lock(date: str):
    with supervisor.qualification_process_lock(date):
        yield


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Supervisor-enforced Cortex runtime qualification controller.")
    parser.add_argument("--date", type=_validated_date, default="2026-04-01")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init")
    sub.add_parser("status")
    sub.add_parser("completion-summary")

    verify = sub.add_parser("verify")
    verify.add_argument("--require-complete", action="store_true")

    spec = sub.add_parser("stage-spec")
    spec.add_argument("--stage")

    launch = sub.add_parser("run-stage")
    launch.add_argument("--stage", required=True)
    launch.add_argument("--background", action="store_true")

    sub.add_parser("poll")
    sub.add_parser("terminate")

    watch = sub.add_parser("watch")
    watch.add_argument("--timeout-seconds", type=int, default=0)
    watch.add_argument("--interval-seconds", type=int, default=30)
    watch.add_argument("--mark-notified", action="store_true")

    mark = sub.add_parser("mark-notified")
    mark.add_argument("--note")

    args = parser.parse_args(argv)
    date = args.date

    # Validate containment independently of the imported implementation.  The
    # lock covers reads which reconcile/persist as well as explicit mutations.
    _qualification_root(date)

    # A watcher must release the shared lock between polls so a launcher can
    # make progress.  Its individual reconciliation/notification operations
    # acquire the same library-owned lock themselves.
    if args.command == "watch":
        payload = supervisor.wait_for_completion(
            date,
            timeout_seconds=max(0, int(args.timeout_seconds or 0)),
            interval_seconds=max(1, int(args.interval_seconds or 30)),
            mark_complete_notification=bool(args.mark_notified),
        )
        _print(payload)
        return 0 if payload.get("all_complete") else 3

    # A foreground launch deliberately drops the library-owned lock while it
    # waits for the workload.  Do not retain this command-wide recursive lock,
    # or status and termination commands cannot observe or stop that workload.
    if args.command == "run-stage" and not args.background:
        result = supervisor.launch_stage(date, args.stage, background=False)
        _print(result)
        return 0

    with _process_lock(date):
        if args.command == "init":
            state = supervisor.load_or_create_state(date)
            state = supervisor.reconcile_state(date)
            _print(state)
            return 0
        if args.command == "status":
            _print(supervisor.stage_status_summary(date))
            return 0
        if args.command == "completion-summary":
            state = supervisor.reconcile_state(date)
            _print(supervisor.build_completion_summary(date, state=state, persist=True))
            return 0
        if args.command == "verify":
            payload = supervisor.stage_status_summary(date)
            _print(payload)
            if args.require_complete and not payload.get("all_complete"):
                return 2
            return 0
        if args.command == "stage-spec":
            _print(supervisor.stage_spec_view(date, stage=args.stage))
            return 0
        if args.command == "run-stage":
            result = supervisor.launch_stage(date, args.stage, background=bool(args.background))
            result = _validate_background_launch(date, result)
            _print(result)
            return 0
        if args.command == "poll":
            supervisor.reconcile_state(date)
            _print(supervisor.stage_status_summary(date))
            return 0
        if args.command == "terminate":
            _print(_terminate_verified(date))
            return 0
        if args.command == "mark-notified":
            _print(supervisor.mark_notified(date, note=args.note))
            return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
