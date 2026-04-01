#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from cortex_server.benchmarks import runtime_qualification_supervisor as supervisor


def _print(payload):
    print(json.dumps(payload, indent=2, sort_keys=True))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Supervisor-enforced Cortex runtime qualification controller.")
    parser.add_argument("--date", default="2026-04-01")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init")
    sub.add_parser("status")

    verify = sub.add_parser("verify")
    verify.add_argument("--require-complete", action="store_true")

    spec = sub.add_parser("stage-spec")
    spec.add_argument("--stage")

    launch = sub.add_parser("run-stage")
    launch.add_argument("--stage", required=True)
    launch.add_argument("--background", action="store_true")

    sub.add_parser("poll")
    sub.add_parser("terminate")

    args = parser.parse_args(argv)
    date = args.date

    if args.command == "init":
        state = supervisor.load_or_create_state(date)
        state = supervisor.reconcile_state(date)
        _print(state)
        return 0
    if args.command == "status":
        _print(supervisor.stage_status_summary(date))
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
        _print(result)
        return 0
    if args.command == "poll":
        supervisor.reconcile_state(date)
        _print(supervisor.stage_status_summary(date))
        return 0
    if args.command == "terminate":
        _print(supervisor.terminate_active_process(date))
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
