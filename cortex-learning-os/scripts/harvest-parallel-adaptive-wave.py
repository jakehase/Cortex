#!/usr/bin/env python3
"""Harvest all terminal parallel children, then request one atomic signed apply."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from typing import Any

SAFE_WAVE = re.compile(r"^math-wave-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6}$")
SAFE_RUN = re.compile(r"^math-wave-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6}[.]c0[1-8]$")
TERMINAL = {"candidate", "failed"}
DEFAULT_LIVE_CONTROL = str(Path(__file__).resolve().parents[1] / "src" / "live-control.mjs")


class WaveHarvestError(RuntimeError):
    pass


def run(command: list[str], timeout: float = 180.0) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode != 0:
        raise WaveHarvestError((result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}")[:3000])
    return result


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
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


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--wave", required=True, type=Path)
    value.add_argument("--ssh-host", default="root@37.27.129.239")
    value.add_argument("--remote-repo", default="/home/jake/clawd-remote")
    value.add_argument("--local-artifact-root", required=True, type=Path)
    value.add_argument("--state-file", required=True, type=Path)
    value.add_argument("--state-root", default="/root/.openclaw/cortex-learning-os")
    value.add_argument("--live-control", default=DEFAULT_LIVE_CONTROL)
    value.add_argument("--graph")
    value.add_argument("--policy")
    value.add_argument("--capsule")
    value.add_argument("--assessment-bank", required=True, type=Path)
    value.add_argument("--poll-seconds", type=float, default=30.0)
    value.add_argument("--timeout-seconds", type=float, default=14_400.0)
    return value


def remote_json(host: str, path: str) -> dict[str, Any] | None:
    result = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, "cat", path],
        capture_output=True, text=True, timeout=30, check=False,
    )
    if result.returncode != 0:
        return None
    value = json.loads(result.stdout)
    return value if isinstance(value, dict) else None


def main() -> int:
    args = parser().parse_args()
    if not args.assessment_bank.is_file() or args.assessment_bank.is_symlink() or not os.access(args.assessment_bank, os.R_OK):
        raise WaveHarvestError("independent assessment bank is unavailable")
    wave = json.loads(args.wave.read_text(encoding="utf-8"))
    wave_id = str(wave.get("waveId") or "")
    run_ids = list(wave.get("mergeOrder") or [])
    if not SAFE_WAVE.fullmatch(wave_id) or not run_ids or any(not SAFE_RUN.fullmatch(str(run_id)) for run_id in run_ids):
        raise WaveHarvestError("invalid wave or child identity")
    if not 1 <= len(run_ids) <= 8:
        raise WaveHarvestError("invalid wave child count")
    started = time.monotonic()
    state = {
        "schemaVersion": "cortex.learning_os.parallel_wave_harvest.v1",
        "waveId": wave_id,
        "status": "waiting",
        "reason": "waiting for detached Hetzner children",
        "runIds": run_ids,
        "sourceCommit": wave["source"]["commit"],
        "sourceTree": wave["source"]["tree"],
        "startedAt": utc_now(),
        "updatedAt": utc_now(),
        "reviewSelectionEnabled": False,
        "placement": {
            "controlPlane": "independent wave harvester",
            "executionPlane": "concurrent detached Hetzner Codex children",
        },
    }
    atomic_json(args.state_file, state)
    remote_state_root = f"{args.remote_repo}/state/cortex-learning-os/waves/{wave_id}"
    while True:
        children = {
            run_id: remote_json(args.ssh_host, f"{remote_state_root}/{run_id}.json")
            for run_id in run_ids
        }
        if all(child and child.get("status") in TERMINAL for child in children.values()):
            break
        if time.monotonic() - started > args.timeout_seconds:
            state.update(status="failed", reason="wave child timeout; no canonical mutation was attempted", updatedAt=utc_now())
            atomic_json(args.state_file, state)
            return 1
        time.sleep(max(5.0, args.poll_seconds))

    failed = [run_id for run_id, child in children.items() if child.get("status") == "failed"]
    if failed:
        state.update(
            status="failed",
            reason=f"infrastructure/source/execution failure in {','.join(failed)}; no partial mutation was attempted",
            children=children,
            updatedAt=utc_now(),
        )
        atomic_json(args.state_file, state)
        return 1

    for run_id in run_ids:
        local_child = args.local_artifact_root / "children" / run_id
        if local_child.exists():
            raise WaveHarvestError(f"incoming child path already exists: {run_id}")
        local_child.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        remote_child = f"{args.remote_repo}/cortex-learning-os/artifacts/parallel-waves/{wave_id}/children/{run_id}/"
        run([
            "rsync", "-a", "--chmod=Du=rwx,Dgo=,Fu=rw,Fgo=", "--protect-args",
            f"{args.ssh_host}:{remote_child}", f"{local_child}/",
        ], timeout=300)

    try:
        apply_command = [
            "node", args.live_control, "adaptive-wave-apply",
            "--state-root", args.state_root,
            "--wave", str(args.wave),
            "--artifact-root", str(args.local_artifact_root),
            "--source-commit", wave["source"]["commit"],
            "--source-tree", wave["source"]["tree"],
            "--assessment-bank", str(args.assessment_bank),
        ]
        for flag, supplied in [("--graph", args.graph), ("--policy", args.policy), ("--capsule", args.capsule)]:
            if supplied:
                apply_command.extend([flag, supplied])
        applied = json.loads(run(apply_command, timeout=300).stdout)
        state.update(
            status="completed",
            reason="all children independently replayed and merged in one atomic signed state update",
            children=children,
            acquisitionRevision=applied.get("acquisitionRevision"),
            mergeOrder=applied.get("mergeOrder"),
            applied=applied.get("applied"),
            alreadyApplied=applied.get("alreadyApplied"),
            updatedAt=utc_now(),
            finishedAt=utc_now(),
        )
        atomic_json(args.state_file, state)
        return 0
    except (WaveHarvestError, json.JSONDecodeError, OSError) as error:
        state.update(
            status="failed",
            reason=f"wave verification failed closed before canonical mutation: {error}"[:3000],
            children=children,
            updatedAt=utc_now(),
            finishedAt=utc_now(),
        )
        atomic_json(args.state_file, state)
        return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (WaveHarvestError, json.JSONDecodeError, OSError) as error:
        print(f"harvest-parallel-adaptive-wave: {error}", file=os.sys.stderr)
        raise SystemExit(1)
