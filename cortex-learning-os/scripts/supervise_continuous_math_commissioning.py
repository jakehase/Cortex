#!/usr/bin/env python3
"""Durably supervise the three independent bank-commissioning lanes."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from typing import Any

SCHEMA = "cortex.learning_os.continuous_math_commissioning_supervisor.v1"
PURPOSES = ("acquisition", "validity", "retention")


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def read(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"object required: {path}")
    return value


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--root", required=True, type=Path)
    result.add_argument("--clos-root", required=True, type=Path)
    result.add_argument("--spec-root", required=True, type=Path)
    result.add_argument("--codex", default="/home/jake/.local/bin/codex", type=Path)
    result.add_argument("--concurrency-per-lane", default=2, type=int)
    result.add_argument("--batch-size", default=4, type=int)
    result.add_argument("--poll-seconds", default=10, type=int)
    result.add_argument("--max-wall-seconds", default=21600, type=int)
    return result


def main() -> int:
    args = parser().parse_args()
    if not 1 <= args.concurrency_per_lane <= 3 or not 1 <= args.batch_size <= 8:
        raise RuntimeError("unsafe supervisor bounds")
    args.root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(args.root, 0o700)
    state_path = args.root / "supervisor-state.json"
    if state_path.exists():
        raise RuntimeError("supervisor state already exists")
    commissioner = args.clos_root / "scripts/commission_continuous_math_bank.py"
    author_schema = args.clos_root / "schemas/continuous-math-bank-author-output.schema.json"
    reviewer_schema = args.clos_root / "schemas/continuous-math-bank-reviewer-output.schema.json"
    for target in (commissioner, author_schema, reviewer_schema, args.codex):
        if not target.is_file() or target.is_symlink():
            raise RuntimeError(f"required regular file is missing: {target}")
    empty = args.root / "empty"
    empty.mkdir(mode=0o700)
    lanes: dict[str, dict[str, Any]] = {}
    processes: dict[str, subprocess.Popen[bytes]] = {}
    started = now()
    state = {
        "schemaVersion": SCHEMA,
        "status": "running",
        "artifactRoot": str(args.root),
        "startedAt": started,
        "updatedAt": started,
        "maxWallSeconds": args.max_wall_seconds,
        "lanes": lanes,
        "truthBoundary": "Supervisor completion proves commissioning processes terminated with accepted content; it proves no candidate learning result.",
    }
    atomic(state_path, state)
    try:
        for purpose in PURPOSES:
            lane_root = args.root / purpose
            lane_root.mkdir(mode=0o700)
            stdout_path = args.root / f"{purpose}.stdout.log"
            stderr_path = args.root / f"{purpose}.stderr.log"
            command = [
                "/usr/bin/python3", str(commissioner),
                "--root", str(lane_root),
                "--spec", str(args.spec_root / f"{purpose}.commissioning-spec.json"),
                "--author-schema", str(author_schema),
                "--reviewer-schema", str(reviewer_schema),
                "--codex", str(args.codex),
                "--empty", str(empty),
                "--concurrency", str(args.concurrency_per_lane),
                "--batch-size", str(args.batch_size),
            ]
            stdout = stdout_path.open("wb")
            stderr = stderr_path.open("wb")
            process = subprocess.Popen(command, cwd=args.clos_root, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
            processes[purpose] = process
            lanes[purpose] = {"status": "running", "pid": process.pid, "root": str(lane_root), "statePath": str(lane_root / "state.json"), "outputPath": str(lane_root / "commissioned-content.json")}
        state["lanes"] = lanes
        state["updatedAt"] = now()
        atomic(state_path, state)
        started_monotonic = time.monotonic()
        while True:
            all_terminal = True
            blocked: list[str] = []
            for purpose, process in processes.items():
                code = process.poll()
                lane_state_path = Path(lanes[purpose]["statePath"])
                lane_state = read(lane_state_path) if lane_state_path.is_file() else {}
                lanes[purpose].update({
                    "status": lane_state.get("status", "running" if code is None else "blocked"),
                    "exitCode": code,
                    "providerCallsStarted": lane_state.get("providerCallsStarted", 0),
                    "providerCallsCompleted": lane_state.get("providerCallsCompleted", 0),
                    "acceptedConcepts": lane_state.get("acceptedConcepts", 0),
                    "acceptedItems": lane_state.get("acceptedItems", 0),
                    "blocker": lane_state.get("blocker"),
                })
                if code is None:
                    all_terminal = False
                elif code != 0 or lane_state.get("status") != "completed" or not Path(lanes[purpose]["outputPath"]).is_file():
                    blocked.append(f"{purpose}:{lane_state.get('blocker') or f'exit_{code}'}")
            state["updatedAt"] = now()
            state["lanes"] = lanes
            atomic(state_path, state)
            if blocked:
                for process in processes.values():
                    if process.poll() is None:
                        process.terminate()
                state.update(status="blocked", blocker="; ".join(blocked)[:4000], completedAt=now(), updatedAt=now())
                atomic(state_path, state)
                return 2
            if all_terminal:
                state.update(
                    status="completed",
                    completedAt=now(),
                    updatedAt=now(),
                    providerCallsStarted=sum(int(row.get("providerCallsStarted", 0)) for row in lanes.values()),
                    providerCallsCompleted=sum(int(row.get("providerCallsCompleted", 0)) for row in lanes.values()),
                    acceptedConceptAssignments=sum(int(row.get("acceptedConcepts", 0)) for row in lanes.values()),
                    acceptedItems=sum(int(row.get("acceptedItems", 0)) for row in lanes.values()),
                )
                atomic(state_path, state)
                return 0
            if time.monotonic() - started_monotonic > args.max_wall_seconds:
                for process in processes.values():
                    if process.poll() is None:
                        process.terminate()
                state.update(status="blocked", blocker="commissioning wall-time cap reached", completedAt=now(), updatedAt=now())
                atomic(state_path, state)
                return 2
            time.sleep(args.poll_seconds)
    except Exception as error:
        for process in processes.values():
            if process.poll() is None:
                process.terminate()
        state.update(status="blocked", blocker=str(error), completedAt=now(), updatedAt=now())
        atomic(state_path, state)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
