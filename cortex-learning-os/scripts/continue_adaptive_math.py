#!/usr/bin/env python3
"""Continue verifier-gated adaptive math sessions until a real blocker.

The supervisor is intentionally lightweight and runs on the control plane. Each
model session is launched through the canonical detached Hetzner launcher. The
remote worker can only produce candidate evidence; the independent control-plane
harvester verifies and applies each result before this supervisor can continue.
"""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
from typing import Any

SCHEMA = "cortex.learning_os.math_continuation.v2"
SAFE_CONTINUATION = re.compile(r"^math-continuation-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6}$")
SAFE_COMMIT = re.compile(r"^[0-9a-f]{40}$")
CHILD_TERMINAL = {"blocked", "completed", "failed"}
PROGRESS_ARTIFACTS = {"candidate_acquisition_delta", "candidate_lesson_and_acquisition_delta"}
CURRICULUM_FRONTIER = "curriculum_frontier_reached"
STOP_REQUESTED = False


class ContinuationBlocker(RuntimeError):
    pass


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
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


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ContinuationBlocker(f"JSON state is not an object: {path}")
    return value


def run(command: list[str], *, timeout: float = 180.0, cwd: str | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or f"command exited {result.returncode}"
        raise ContinuationBlocker(message[:3000])
    return result


def parse_launcher_output(raw: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for start, char in enumerate(raw):
        if char != "{":
            continue
        try:
            value, _end = decoder.raw_decode(raw[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("ok") is True and isinstance(value.get("runId"), str):
            return value
    raise ContinuationBlocker("launcher did not return a valid run descriptor")


def evaluate_child(child: dict[str, Any], before_revision: int) -> tuple[str, str | None, int]:
    status = str(child.get("status") or "")
    reason = str(child.get("reason") or "child state supplied no reason")
    if status in {"blocked", "failed"}:
        return "blocked", reason, before_revision
    if status != "completed":
        raise ContinuationBlocker(f"unexpected terminal child status: {status!r}")
    artifact_status = str(child.get("adaptiveArtifactStatus") or "")
    revision = child.get("acquisitionRevision")
    if not isinstance(revision, int) or revision < 0:
        raise ContinuationBlocker("completed child state has no valid acquisition revision")
    if artifact_status == CURRICULUM_FRONTIER:
        if revision != before_revision:
            raise ContinuationBlocker("curriculum frontier unexpectedly changed acquisition state")
        return "frontier", None, revision
    if artifact_status not in PROGRESS_ARTIFACTS:
        return "blocked", f"unsupported completed adaptive artifact status: {artifact_status or 'missing'}", revision
    if revision <= before_revision:
        return "blocked", f"adaptive child made no canonical acquisition progress: revision {before_revision} -> {revision}", revision
    return "continue", None, revision


def signal_handler(_signum: int, _frame: object) -> None:
    global STOP_REQUESTED
    STOP_REQUESTED = True


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--continuation-id", required=True)
    parser.add_argument("--state-file", required=True, type=Path)
    parser.add_argument("--artifact-root", required=True, type=Path)
    parser.add_argument("--state-root", default="/root/.openclaw/cortex-learning-os", type=Path)
    parser.add_argument("--launcher", default="/root/clawd/cortex-learning-os/scripts/launch-live-math-training.sh", type=Path)
    parser.add_argument("--live-control", default="/root/clawd/cortex-learning-os/src/live-control.mjs", type=Path)
    parser.add_argument("--acquisition-state", default="/root/.openclaw/cortex-learning-os/mastery.json", type=Path)
    parser.add_argument("--source-marker", default="/root/clawd/CORTEX_LEARNING_OS_SOURCE_COMMIT", type=Path)
    parser.add_argument("--repo-root", default="/root/clawd", type=Path)
    parser.add_argument("--ssh-host", default="root@37.27.129.239")
    parser.add_argument("--remote-repo", default="/home/jake/clawd-remote")
    parser.add_argument("--poll-seconds", type=float, default=15.0)
    parser.add_argument("--child-timeout-seconds", type=float, default=14_400.0)
    parser.add_argument("--max-wall-seconds", type=float, default=86_400.0)
    parser.add_argument("--max-sessions", type=int, default=100)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def validate_arguments(args: argparse.Namespace) -> None:
    if not SAFE_CONTINUATION.fullmatch(args.continuation_id):
        raise ContinuationBlocker("invalid continuation id")
    if not args.launcher.is_file() or not os.access(args.launcher, os.X_OK):
        raise ContinuationBlocker("canonical launcher is missing or not executable")
    if not args.live_control.is_file() or not args.acquisition_state.is_file() or not args.source_marker.is_file():
        raise ContinuationBlocker("canonical control-plane inputs are incomplete")
    if args.max_sessions < 1 or args.max_sessions > 100:
        raise ContinuationBlocker("max sessions must be between 1 and the hard cap of 100")
    if args.child_timeout_seconds < 60 or args.child_timeout_seconds > 14_400:
        raise ContinuationBlocker("child timeout must be between 60 seconds and the four-hour hard cap")
    if args.max_wall_seconds < 300 or args.max_wall_seconds > 86_400:
        raise ContinuationBlocker("wall timeout must be between 300 seconds and the 24-hour hard cap")
    if not re.fullmatch(r"[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+", args.ssh_host):
        raise ContinuationBlocker("unsafe SSH host")
    if not re.fullmatch(r"/[A-Za-z0-9._/-]+", args.remote_repo):
        raise ContinuationBlocker("unsafe remote repository path")


def source_commit(args: argparse.Namespace) -> str:
    commit = args.source_marker.read_text(encoding="utf-8").strip()
    if not SAFE_COMMIT.fullmatch(commit):
        raise ContinuationBlocker("canonical source marker is invalid")
    return commit


def verify_boundary(args: argparse.Namespace, expected_commit: str) -> dict[str, Any]:
    main = run(["git", "-C", str(args.repo_root), "ls-remote", "origin", "refs/heads/main"], timeout=60).stdout.split()
    if not main or main[0] != expected_commit:
        raise ContinuationBlocker("canonical source marker drifted from origin/main")
    remote_marker = run([
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.ssh_host,
        "cat", f"{args.remote_repo}/CORTEX_LEARNING_OS_SOURCE_COMMIT",
    ], timeout=30).stdout.strip()
    if remote_marker != expected_commit:
        raise ContinuationBlocker(f"remote source marker drift: {remote_marker or 'missing'}")
    verified = json.loads(run([
        "node", str(args.live_control), "verify", "--state-root", str(args.state_root),
    ], timeout=60).stdout)
    if verified.get("signatureValid") is not True or verified.get("acquisitionState", {}).get("signatureValid") is not True:
        raise ContinuationBlocker("canonical registry or acquisition-state signature verification failed")
    return verified


def launch_descriptor(args: argparse.Namespace, *, dry_run: bool) -> dict[str, Any]:
    command = [
        str(args.launcher), "--adaptive", "--thinking", "xhigh", "--no-notify",
        "--ssh-host", args.ssh_host, "--remote-repo", args.remote_repo,
        "--state-root", str(args.state_root),
    ]
    if dry_run:
        command.append("--dry-run")
    result = run(command, timeout=240, cwd=str(args.repo_root))
    return parse_launcher_output(result.stdout)


def elapsed_since(timestamp: str) -> float:
    try:
        started = dt.datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
    except ValueError as error:
        raise ContinuationBlocker("persisted continuation timestamp is invalid") from error
    if started.tzinfo is None:
        raise ContinuationBlocker("persisted continuation timestamp lacks a timezone")
    return (dt.datetime.now(dt.timezone.utc) - started).total_seconds()


def wait_for_child(
    path: Path,
    *,
    poll_seconds: float,
    timeout_seconds: float,
    launched_at: str,
    continuation_started_at: str,
    max_wall_seconds: float,
) -> dict[str, Any]:
    while True:
        if STOP_REQUESTED:
            raise ContinuationBlocker("operator or service stop signal received")
        if path.exists():
            child = read_json(path)
            if child.get("status") in CHILD_TERMINAL:
                return child
        if elapsed_since(continuation_started_at) > max_wall_seconds:
            raise ContinuationBlocker(f"continuation reached the {max_wall_seconds:g}-second wall-time safety boundary")
        if elapsed_since(launched_at) > timeout_seconds:
            raise ContinuationBlocker(f"child run timed out before a terminal control-plane state: {path.name}")
        time.sleep(max(1.0, poll_seconds))


def initial_state(args: argparse.Namespace, commit: str, revision: int) -> dict[str, Any]:
    now = utc_now()
    return {
        "schemaVersion": SCHEMA,
        "continuationId": args.continuation_id,
        "status": "preflighting",
        "reason": "verifying remote execution boundary",
        "sourceCommit": commit,
        "thinking": "xhigh",
        "startedAt": now,
        "updatedAt": now,
        "artifactRoot": str(args.artifact_root),
        "initialAcquisitionRevision": revision,
        "currentAcquisitionRevision": revision,
        "sessionsStarted": 0,
        "sessionsCompleted": 0,
        "maxSessions": args.max_sessions,
        "maxWallSeconds": args.max_wall_seconds,
        "childTimeoutSeconds": args.child_timeout_seconds,
        "currentRunId": None,
        "runs": [],
        "placement": {
            "controlPlane": "lightweight supervisor, independent harvester, and notifier",
            "executionPlane": "Hetzner detached Codex worker",
        },
        "reviewSelectionEnabled": False,
        "truthBoundary": "Each child must pass independent control-plane replay before covered-once acquisition state can advance. This does not prove retention, mastery, or model-weight learning.",
    }


def terminalize(
    args: argparse.Namespace,
    state: dict[str, Any],
    *,
    status: str,
    reason: str,
    terminal_result: str | None = None,
) -> None:
    state.update({
        "status": status,
        "reason": reason[:3000],
        "currentRunId": None,
        "updatedAt": utc_now(),
        "finishedAt": utc_now(),
    })
    if terminal_result is not None:
        state["terminalResult"] = terminal_result
    atomic_write_json(args.state_file, state)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    validate_arguments(args)
    args.artifact_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(args.artifact_root, 0o700)
    lock_path = args.state_file.with_suffix(args.state_file.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_handle = lock_path.open("a+", encoding="utf-8")
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        raise ContinuationBlocker("another math continuation supervisor holds the state lock") from error

    commit = source_commit(args)
    current_acquisition = read_json(args.acquisition_state)
    revision = current_acquisition.get("revision")
    if not isinstance(revision, int) or revision < 0:
        raise ContinuationBlocker("canonical acquisition revision is invalid")

    if args.state_file.exists():
        if not args.resume:
            raise ContinuationBlocker("continuation state already exists; use --resume")
        state = read_json(args.state_file)
        if state.get("schemaVersion") != SCHEMA or state.get("continuationId") != args.continuation_id:
            raise ContinuationBlocker("resume state identity mismatch")
        if state.get("sourceCommit") != commit:
            raise ContinuationBlocker("resume source commit drift")
        if (state.get("maxSessions") != args.max_sessions
                or state.get("maxWallSeconds") != args.max_wall_seconds
                or state.get("childTimeoutSeconds") != args.child_timeout_seconds):
            raise ContinuationBlocker("resume safety boundary drift")
        if state.get("status") in {"blocked", "completed"}:
            print(json.dumps(state, indent=2, sort_keys=True))
            return 0
    else:
        state = initial_state(args, commit, revision)
        atomic_write_json(args.state_file, state)

    verify_boundary(args, commit)
    dry_descriptor = launch_descriptor(args, dry_run=True)
    (args.artifact_root / "preflight-launch.json").write_text(json.dumps(dry_descriptor, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(args.artifact_root / "preflight-launch.json", 0o600)
    if dry_descriptor.get("sourceCommit") != commit or dry_descriptor.get("remoteCommit") != commit:
        raise ContinuationBlocker("launcher dry-run did not bind the canonical source commit")
    if dry_descriptor.get("workerRuntime", {}).get("serviceUser") != "jake":
        raise ContinuationBlocker("launcher dry-run did not bind the remote service user")
    if dry_descriptor.get("reviewSelectionEnabled") is not False:
        raise ContinuationBlocker("launcher dry-run did not disable review selection")
    if args.dry_run:
        state.update({"status": "ready", "reason": "no-call continuation preflight passed", "updatedAt": utc_now()})
        atomic_write_json(args.state_file, state)
        print(json.dumps(state, indent=2, sort_keys=True))
        return 0

    state.update({"status": "running", "reason": "adaptive continuation is active", "updatedAt": utc_now()})
    atomic_write_json(args.state_file, state)
    try:
        while True:
            if STOP_REQUESTED:
                raise ContinuationBlocker("operator or service stop signal received")
            elapsed = elapsed_since(str(state["startedAt"]))
            if elapsed > args.max_wall_seconds:
                raise ContinuationBlocker(f"continuation reached the {args.max_wall_seconds:g}-second wall-time safety boundary")
            if not state.get("currentRunId") and int(state["sessionsStarted"]) >= args.max_sessions:
                raise ContinuationBlocker(f"continuation reached the {args.max_sessions}-session safety boundary")
            if source_commit(args) != commit:
                raise ContinuationBlocker("canonical source marker changed during continuation")
            verify_boundary(args, commit)

            if state.get("currentRunId"):
                run_id = str(state["currentRunId"])
                matching = [row for row in state["runs"] if row.get("runId") == run_id]
                if len(matching) != 1 or matching[0].get("status") != "running":
                    raise ContinuationBlocker("resume state has an invalid current child run")
                run_record = matching[0]
                before_revision = run_record.get("beforeAcquisitionRevision")
                if not isinstance(before_revision, int) or before_revision < 0:
                    raise ContinuationBlocker("resume child has an invalid starting acquisition revision")
            else:
                before_revision = int(state["currentAcquisitionRevision"])
                descriptor = launch_descriptor(args, dry_run=False)
                run_id = str(descriptor.get("runId") or "")
                if not re.fullmatch(r"math-training-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6}", run_id):
                    raise ContinuationBlocker("launcher returned an unsafe child run id")
                launch_path = args.artifact_root / f"{run_id}.launch.json"
                launch_path.write_text(json.dumps(descriptor, indent=2, sort_keys=True) + "\n", encoding="utf-8")
                os.chmod(launch_path, 0o600)
                run_record = {
                    "runId": run_id,
                    "status": "running",
                    "launchedAt": utc_now(),
                    "beforeAcquisitionRevision": before_revision,
                    "remoteState": descriptor.get("remoteState"),
                }
                state["runs"].append(run_record)
                state["sessionsStarted"] = int(state["sessionsStarted"]) + 1
                state["currentRunId"] = run_id
                state["updatedAt"] = utc_now()
                atomic_write_json(args.state_file, state)

            child_path = args.state_root / "training" / f"{run_id}.json"
            child = wait_for_child(
                child_path,
                poll_seconds=args.poll_seconds,
                timeout_seconds=args.child_timeout_seconds,
                launched_at=str(run_record.get("launchedAt") or ""),
                continuation_started_at=str(state["startedAt"]),
                max_wall_seconds=args.max_wall_seconds,
            )
            action, reason, after_revision = evaluate_child(child, before_revision)
            run_record.update({
                "status": child.get("status"),
                "completedAt": child.get("updatedAt") or utc_now(),
                "afterAcquisitionRevision": after_revision,
                "adaptiveArtifactStatus": child.get("adaptiveArtifactStatus"),
                "reason": child.get("reason"),
                "controlPlaneArtifactRoot": child.get("controlPlaneArtifactRoot"),
            })
            state["sessionsCompleted"] = int(state["sessionsCompleted"]) + 1
            state["currentAcquisitionRevision"] = after_revision
            state["currentRunId"] = None
            state["updatedAt"] = utc_now()
            atomic_write_json(args.state_file, state)

            if action == "continue":
                continue
            if action == "frontier":
                terminalize(
                    args,
                    state,
                    status="completed",
                    reason="all declared acquisition concepts are exhausted; no review or fabricated lesson was scheduled",
                    terminal_result=CURRICULUM_FRONTIER,
                )
                print(json.dumps(state, indent=2, sort_keys=True))
                return 0
            terminalize(args, state, status="blocked", reason=reason or "child run blocked")
            print(json.dumps(state, indent=2, sort_keys=True))
            return 0
    except (ContinuationBlocker, OSError, json.JSONDecodeError, subprocess.SubprocessError) as error:
        terminalize(args, state, status="blocked", reason=str(error))
        print(json.dumps(state, indent=2, sort_keys=True))
        return 0


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    try:
        raise SystemExit(main())
    except ContinuationBlocker as error:
        print(f"continue_adaptive_math: {error}", file=os.sys.stderr)
        raise SystemExit(2)
