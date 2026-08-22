#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from cortex_server.benchmarks import mailchimp_parity_supervisor as supervisor


def _print(payload):
    print(json.dumps(payload, indent=2, sort_keys=True))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Supervisor-enforced Mailchimp Parity Program 0 controller.")
    parser.add_argument("--date", default="2026-04-01")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init")
    sub.add_parser("status")
    sub.add_parser("completion-summary")
    verify = sub.add_parser("verify")
    verify.add_argument("--require-complete", action="store_true")
    spec = sub.add_parser("stage-spec")
    spec.add_argument("--stage")
    watch = sub.add_parser("watch")
    watch.add_argument("--timeout-seconds", type=int, default=0)
    watch.add_argument("--interval-seconds", type=int, default=30)
    watch.add_argument("--mark-notified", action="store_true")
    mark = sub.add_parser("mark-notified")
    mark.add_argument("--note")
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
    if args.command == "watch":
        payload = supervisor.wait_for_completion(date, timeout_seconds=max(0, int(args.timeout_seconds or 0)), interval_seconds=max(1, int(args.interval_seconds or 30)), mark_complete_notification=bool(args.mark_notified))
        _print(payload)
        return 0 if payload.get("all_complete") else 3
    if args.command == "mark-notified":
        _print(supervisor.mark_notified(date, note=args.note))
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
