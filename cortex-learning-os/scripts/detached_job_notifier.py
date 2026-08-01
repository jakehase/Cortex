#!/usr/bin/env python3
"""Bounded detached-state notifier used by packaged Cortex launchers."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time


TERMINAL = {
    "completed",
    "failed",
    "ready_for_independent_replay",
    "retained_mastery_qualified",
}


def read_state(target: Path, ssh_host: str | None = None) -> dict:
    if ssh_host is None:
        if target.is_symlink() or not target.is_file():
            raise RuntimeError("state file is missing or unsafe")
        raw = target.read_text(encoding="utf-8")
    else:
        if not re.fullmatch(r"[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+", ssh_host):
            raise RuntimeError("unsafe SSH host")
        if not re.fullmatch(r"/[A-Za-z0-9._/-]+", str(target)):
            raise RuntimeError("unsafe remote state path")
        remote_code = (
            "import os,pathlib,sys;"
            "p=pathlib.Path(sys.argv[1]);"
            "s=p.lstat();"
            "assert s.st_mode & 0o170000 == 0o100000 and not p.is_symlink();"
            "sys.stdout.write(p.read_text(encoding='utf-8'))"
        )
        command = (
            f"python3 -c {shlex.quote(remote_code)} {shlex.quote(str(target))}"
        )
        result = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", ssh_host, command],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError("remote state file is missing or unsafe")
        raw = result.stdout
    value = json.loads(raw)
    if not isinstance(value, dict) or not isinstance(value.get("status"), str):
        raise RuntimeError("state file does not contain a status")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-file", required=True, type=Path)
    parser.add_argument("--ssh-host")
    parser.add_argument("--job-label", required=True)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--poll-seconds", type=float, default=30.0)
    parser.add_argument("--timeout-seconds", type=float, default=172800.0)
    args = parser.parse_args()
    started = time.monotonic()
    while True:
        state = read_state(args.state_file, args.ssh_host)
        if state["status"] in TERMINAL:
            print(json.dumps({
                "job": args.job_label,
                "status": state["status"],
                "stateFile": str(args.state_file.resolve()) if args.ssh_host is None else str(args.state_file),
                "truthBoundary": state.get(
                    "truthBoundary",
                    "A terminal worker or harvester status is not qualification evidence.",
                ),
            }, sort_keys=True))
            return 0
        if args.once:
            return 1
        if time.monotonic() - started > args.timeout_seconds:
            raise RuntimeError("notification wait timed out without a terminal state")
        time.sleep(max(1.0, min(args.poll_seconds, 60.0)))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"detached_job_notifier: {error}", file=sys.stderr)
        raise SystemExit(1)
