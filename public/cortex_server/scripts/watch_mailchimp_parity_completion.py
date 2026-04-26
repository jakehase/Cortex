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


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Wait for Mailchimp parity Program 0 completion and emit summary payload.")
    parser.add_argument("--date", default="2026-04-01")
    parser.add_argument("--timeout-seconds", type=int, default=0)
    parser.add_argument("--interval-seconds", type=int, default=30)
    parser.add_argument("--mark-notified", action="store_true")
    args = parser.parse_args(argv)
    payload = supervisor.wait_for_completion(args.date, timeout_seconds=max(0, int(args.timeout_seconds or 0)), interval_seconds=max(1, int(args.interval_seconds or 30)), mark_complete_notification=bool(args.mark_notified))
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if payload.get("all_complete") else 3


if __name__ == "__main__":
    raise SystemExit(main())
