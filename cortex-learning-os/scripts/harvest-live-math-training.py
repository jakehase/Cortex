#!/usr/bin/env python3
"""Harvest a detached Hetzner math-training result into the live signed registry.

This process is intentionally separate from both the heavy model worker and the
user-visible notifier. It copies only terminal candidate artifacts, re-verifies
the full manifest and promotion gates on the control plane, atomically installs
the lesson, then marks the remote job completed. No chat content is stored.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import time
from typing import Any

SAFE_RUN = re.compile(r"^math-training-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6}$")
SAFE_REMOTE = re.compile(r"^/[A-Za-z0-9._/-]+$")
TERMINAL = {"blocked", "completed", "failed"}


class HarvestError(RuntimeError):
    pass


def run(command: list[str], *, timeout: int = 120, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    if check and result.returncode != 0:
        raise HarvestError(result.stderr.strip() or result.stdout.strip() or f"command exited {result.returncode}")
    return result


def read_remote(host: str, remote_path: str) -> dict[str, Any]:
    if not SAFE_REMOTE.fullmatch(remote_path):
        raise HarvestError("unsafe remote state path")
    result = run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, "cat", remote_path], timeout=30)
    value = json.loads(result.stdout)
    if not isinstance(value, dict) or not isinstance(value.get("status"), str):
        raise HarvestError("invalid remote state")
    return value


def write_remote(host: str, remote_path: str, payload: dict[str, Any]) -> None:
    if not SAFE_REMOTE.fullmatch(remote_path):
        raise HarvestError("unsafe remote state path")
    temporary = f"{remote_path}.tmp.harvest"
    shell = f"umask 077; cat > {shlex.quote(temporary)} && chmod 600 {shlex.quote(temporary)} && mv -f {shlex.quote(temporary)} {shlex.quote(remote_path)}"
    result = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, shell],
        input=json.dumps(payload, indent=2, sort_keys=True) + "\n",
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise HarvestError(result.stderr.strip() or result.stdout.strip() or f"remote state write exited {result.returncode}")


def atomic_local_state(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--ssh-host", default="root@37.27.129.239")
    parser.add_argument("--remote-state-root", default="/home/jake/clawd-remote/state/cortex-learning-os")
    parser.add_argument("--remote-artifact-root", default="/home/jake/clawd-remote/cortex-learning-os/artifacts")
    parser.add_argument("--local-incoming-root", default="/root/clawd/artifacts/cortex-learning-os-training/incoming")
    parser.add_argument("--live-control", default="/root/clawd/cortex-learning-os/src/live-control.mjs")
    parser.add_argument("--poll-seconds", type=float, default=30.0)
    parser.add_argument("--timeout-seconds", type=float, default=14_400.0)
    parser.add_argument("--state-root", default="/root/.openclaw/cortex-learning-os")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if not SAFE_RUN.fullmatch(args.run_id):
        raise HarvestError("invalid run id")
    remote_state = f"{args.remote_state_root}/{args.run_id}.json"
    remote_artifact = f"{args.remote_artifact_root}/{args.run_id}/"
    if not SAFE_REMOTE.fullmatch(remote_state) or not SAFE_REMOTE.fullmatch(remote_artifact):
        raise HarvestError("unsafe remote path")
    local_artifact = Path(args.local_incoming_root).resolve() / args.run_id
    local_state = Path(args.state_root).resolve() / "training" / f"{args.run_id}.json"
    started = time.monotonic()

    while True:
        try:
            state = read_remote(args.ssh_host, remote_state)
        except (HarvestError, json.JSONDecodeError):
            if time.monotonic() - started > args.timeout_seconds:
                raise
            time.sleep(max(1.0, args.poll_seconds))
            continue
        atomic_local_state(local_state, state)
        status = state["status"]
        if status in TERMINAL:
            return 0 if status == "completed" else 1
        if status not in {"candidate_green", "candidate_no_lesson", "candidate_adaptive"}:
            if time.monotonic() - started > args.timeout_seconds:
                state["status"] = "failed"
                state["reason"] = "control-plane harvester timed out before a terminal training state"
                write_remote(args.ssh_host, remote_state, state)
                atomic_local_state(local_state, state)
                return 1
            time.sleep(max(1.0, args.poll_seconds))
            continue

        try:
            if local_artifact.exists():
                raise HarvestError(f"local incoming artifact already exists: {local_artifact}")
            local_artifact.parent.mkdir(parents=True, exist_ok=True)
            run([
                "rsync", "-a", "--chmod=Du=rwx,Dgo=,Fu=rw,Fgo=", "--protect-args",
                f"{args.ssh_host}:{remote_artifact}", f"{local_artifact}/",
            ], timeout=300)
            if status == "candidate_adaptive":
                apply_result = run([
                    "node", args.live_control, "adaptive-apply",
                    "--state-root", args.state_root,
                    "--artifact-root", str(local_artifact),
                    "--source-commit", str(state.get("sourceCommit") or ""),
                ], timeout=180)
                applied = json.loads(apply_result.stdout)
                verify = run([
                    "node", args.live_control, "verify", "--state-root", args.state_root,
                ], timeout=60)
                verified = json.loads(verify.stdout)
                artifact_status = applied.get("artifactStatus")
                is_blocked = artifact_status == "structured_blocker"
                state.update({
                    "status": "blocked" if is_blocked else "completed",
                    "reason": (
                        "adaptive structured blocker was independently replayed; no unsupported completion was recorded"
                        if is_blocked else
                        "adaptive artifacts independently replayed; canonical mastery and any threshold-qualified scoped lesson were applied by the control plane"
                    ),
                    "adaptiveArtifactStatus": artifact_status,
                    "installedLessonId": applied.get("installedLessonId"),
                    "masteryRevision": applied.get("masteryRevision"),
                    "candidateThresholdPassed": applied.get("candidateThresholdPassed"),
                    "registryRevision": verified.get("revision"),
                    "liveRegistrySignatureValid": verified.get("signatureValid") is True,
                    "controlPlaneArtifactRoot": str(local_artifact),
                    "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })
            elif status == "candidate_no_lesson":
                replay = run([
                    "node", args.live_control, "verify-no-observed-mistake",
                    "--state-root", args.state_root,
                    "--artifact-root", str(local_artifact),
                ], timeout=120)
                replayed = json.loads(replay.stdout)
                verify = run([
                    "node", args.live_control, "verify", "--state-root", args.state_root,
                ], timeout=60)
                verified = json.loads(verify.stdout)
                state.update({
                    "status": "completed",
                    "reason": "baseline artifacts independently replayed with no observed mistake; no lesson was fabricated or installed",
                    "installedLessonId": None,
                    "baselineScore": replayed.get("baselineScore"),
                    "passedItemCount": replayed.get("passedItemCount"),
                    "itemCount": replayed.get("itemCount"),
                    "registryRevision": verified.get("revision"),
                    "liveRegistrySignatureValid": verified.get("signatureValid") is True,
                    "controlPlaneArtifactRoot": str(local_artifact),
                    "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })
            else:
                install = run([
                    "node", args.live_control, "install",
                    "--state-root", args.state_root,
                    "--artifact-root", str(local_artifact),
                    "--profiles", "auto",
                ], timeout=120)
                installed = json.loads(install.stdout)
                verify = run([
                    "node", args.live_control, "verify", "--state-root", args.state_root,
                ], timeout=60)
                verified = json.loads(verify.stdout)
                state.update({
                    "status": "completed",
                    "reason": "training artifacts re-verified and lesson installed into the live signed registry",
                    "installedLessonId": installed.get("installedLessonId"),
                    "registryRevision": verified.get("revision"),
                    "liveRegistrySignatureValid": verified.get("signatureValid") is True,
                    "controlPlaneArtifactRoot": str(local_artifact),
                    "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })
            write_remote(args.ssh_host, remote_state, state)
            atomic_local_state(local_state, state)
            return 0 if state["status"] == "completed" else 1
        except (HarvestError, json.JSONDecodeError, OSError) as error:
            state.update({
                "status": "failed",
                "reason": f"training candidate was not accepted by the control plane: {error}"[:2000],
                "controlPlaneArtifactRoot": str(local_artifact) if local_artifact.exists() else None,
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
            write_remote(args.ssh_host, remote_state, state)
            atomic_local_state(local_state, state)
            return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except HarvestError as error:
        print(f"harvest-live-math-training: {error}", file=os.sys.stderr)
        raise SystemExit(1)
