#!/usr/bin/env python3
"""Repeat detached acquisition-only waves until a bounded honest terminal state."""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
from typing import Any

SCHEMA = "cortex.learning_os.parallel_continuation.v1"
SAFE_ID = re.compile(r"^math-acceleration-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6}$")
STOP_REQUESTED = False


class ParallelContinuationError(RuntimeError):
    pass


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


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


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ParallelContinuationError(f"JSON object required: {path}")
    return value


def run(command: list[str], timeout: float = 300.0) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode != 0:
        raise ParallelContinuationError((result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}")[:3000])
    return result


def parse_descriptor(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            value, _end = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("ok") is True and isinstance(value.get("waveId"), str):
            return value
    raise ParallelContinuationError("parallel launcher returned no valid descriptor")


def validate_dispatch_receipts(descriptor: dict[str, Any], selected_count: int) -> list[dict[str, Any]]:
    receipts = descriptor.get("dispatchReceipts")
    merge_order = descriptor.get("mergeOrder")
    if not isinstance(receipts, list) or len(receipts) != selected_count:
        raise ParallelContinuationError("launcher returned incomplete remote dispatch receipts")
    if descriptor.get("dispatchedCount") != selected_count:
        raise ParallelContinuationError("launcher dispatched count differs from selected count")
    if not isinstance(merge_order, list) or len(merge_order) != selected_count:
        raise ParallelContinuationError("launcher merge order differs from selected count")
    run_ids: list[str] = []
    for receipt in receipts:
        if not isinstance(receipt, dict):
            raise ParallelContinuationError("launcher returned an invalid remote dispatch receipt")
        run_id = receipt.get("runId")
        if not isinstance(run_id, str) or not run_id:
            raise ParallelContinuationError("launcher returned a dispatch receipt without a run identity")
        if receipt.get("placement") != "hetzner" or receipt.get("status") not in {"running", "candidate"}:
            raise ParallelContinuationError("launcher returned an unproved remote dispatch receipt")
        if receipt.get("sourceCommit") != descriptor.get("sourceCommit") or receipt.get("sourceTree") != descriptor.get("sourceTree"):
            raise ParallelContinuationError("launcher dispatch receipt source binding changed")
        if receipt.get("modelThinking") != descriptor.get("thinking"):
            raise ParallelContinuationError("launcher dispatch receipt reasoning binding changed")
        run_ids.append(run_id)
    if run_ids != merge_order or len(set(run_ids)) != selected_count:
        raise ParallelContinuationError("launcher dispatch receipts differ from deterministic merge order")
    return receipts


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--continuation-id", required=True)
    parser.add_argument("--state-file", required=True, type=Path)
    parser.add_argument("--launcher", default="/root/clawd/cortex-learning-os/scripts/launch-parallel-adaptive-wave.sh", type=Path)
    parser.add_argument("--acquisition-state", default="/root/.openclaw/cortex-learning-os/mastery.json", type=Path)
    parser.add_argument("--source-marker", default="/root/clawd/CORTEX_LEARNING_OS_SOURCE_COMMIT", type=Path)
    parser.add_argument("--source-ref", default="refs/heads/main")
    parser.add_argument("--repo-root", default="/root/clawd", type=Path)
    parser.add_argument("--remote-repo", default="/home/jake/clawd-remote")
    parser.add_argument("--graph", default="/root/clawd/cortex-learning-os/capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json", type=Path)
    parser.add_argument("--policy", default="/root/clawd/cortex-learning-os/policies/adaptive-math-phd-v1.json", type=Path)
    parser.add_argument("--capsule", default="/root/clawd/cortex-learning-os/capsules/math-foundations/capsule.json", type=Path)
    parser.add_argument("--assessment-bank", required=True, type=Path)
    parser.add_argument("--approved-model-executable-binding", required=True, type=Path)
    parser.add_argument("--remote-graph", default="/home/jake/clawd-remote/cortex-learning-os/capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json")
    parser.add_argument("--remote-policy", default="/home/jake/clawd-remote/cortex-learning-os/policies/adaptive-math-phd-v1.json")
    parser.add_argument("--remote-capsule", default="/home/jake/clawd-remote/cortex-learning-os/capsules/math-foundations/capsule.json")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--max-waves", type=int, default=100)
    parser.add_argument("--max-sessions", type=int, default=800)
    parser.add_argument("--max-wall-seconds", type=float, default=86_400)
    parser.add_argument("--wave-timeout-seconds", type=float, default=14_400)
    parser.add_argument("--poll-seconds", type=float, default=15)
    parser.add_argument("--thinking", choices=("xhigh", "ultra"), default="ultra")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def validate(args: argparse.Namespace) -> None:
    if not SAFE_ID.fullmatch(args.continuation_id):
        raise ParallelContinuationError("invalid continuation id")
    if not args.launcher.is_file() or not os.access(args.launcher, os.X_OK):
        raise ParallelContinuationError("parallel launcher is unavailable")
    if not args.acquisition_state.is_file() or not args.repo_root.is_dir():
        raise ParallelContinuationError("signed acquisition state or repository root is unavailable")
    if not args.graph.is_file() or not args.policy.is_file() or not args.capsule.is_file():
        raise ParallelContinuationError("adaptive graph, policy, or capsule is unavailable")
    if not args.approved_model_executable_binding.is_file():
        raise ParallelContinuationError("approved model executable binding is unavailable")
    if not args.assessment_bank.is_file() or args.assessment_bank.is_symlink() or not os.access(args.assessment_bank, os.R_OK):
        raise ParallelContinuationError("independent assessment bank is unavailable")
    for remote_path in (args.remote_graph, args.remote_policy, args.remote_capsule):
        if not re.fullmatch(r"/[A-Za-z0-9._/-]+", remote_path):
            raise ParallelContinuationError("unsafe remote adaptive input path")
    if not re.fullmatch(r"/[A-Za-z0-9._/-]+", args.remote_repo) or ".." in args.remote_repo:
        raise ParallelContinuationError("remote repository path is unsafe")
    if not re.fullmatch(r"refs/heads/[A-Za-z0-9._/-]+", args.source_ref) or ".." in args.source_ref:
        raise ParallelContinuationError("source ref is unsafe")
    if not 1 <= args.concurrency <= 8:
        raise ParallelContinuationError("concurrency must be 1..8")
    if not 1 <= args.max_waves <= 100:
        raise ParallelContinuationError("max waves must be 1..100")
    if not 1 <= args.max_sessions <= 800:
        raise ParallelContinuationError("max sessions must be 1..800")
    if not 300 <= args.max_wall_seconds <= 86_400:
        raise ParallelContinuationError("wall cap must be 300..86400 seconds")
    if not 60 <= args.wave_timeout_seconds <= 14_400:
        raise ParallelContinuationError("wave timeout must be 60..14400 seconds")
    if args.poll_seconds < 5:
        raise ParallelContinuationError("poll interval must be at least five seconds")


def elapsed(timestamp: str) -> float:
    value = dt.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ParallelContinuationError("persisted timestamp lacks timezone")
    return (dt.datetime.now(dt.timezone.utc) - value).total_seconds()


def source_commit(args: argparse.Namespace) -> str:
    commit = (
        args.source_marker.read_text(encoding="utf-8").strip()
        if args.source_marker.is_file()
        else run(["git", "-C", str(args.repo_root), "rev-parse", "HEAD"], timeout=30).stdout.strip()
    )
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ParallelContinuationError("canonical source marker is invalid")
    return commit


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def wait_for_wave(path: Path, launched_at: str, args: argparse.Namespace, started_at: str) -> dict[str, Any]:
    while True:
        if STOP_REQUESTED:
            raise ParallelContinuationError("operator stop signal received")
        if path.exists():
            state = read_json(path)
            if state.get("status") in {"completed", "failed"}:
                return state
        if elapsed(started_at) > args.max_wall_seconds:
            raise ParallelContinuationError("parallel continuation reached wall-time cap")
        if elapsed(launched_at) > args.wave_timeout_seconds:
            raise ParallelContinuationError("parallel wave reached timeout cap")
        time.sleep(args.poll_seconds)


def terminal(state: dict[str, Any], state_file: Path, status: str, reason: str, result: str) -> None:
    state.update(
        status=status,
        reason=reason[:3000],
        terminalResult=result,
        currentWaveId=None,
        updatedAt=utc_now(),
        finishedAt=utc_now(),
    )
    atomic_json(state_file, state)


def signal_handler(_signum: int, _frame: object) -> None:
    global STOP_REQUESTED
    STOP_REQUESTED = True


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    validate(args)
    lock_path = args.state_file.with_suffix(args.state_file.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = lock_path.open("a+", encoding="utf-8")
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        raise ParallelContinuationError("another parallel continuation owns this state") from error

    committed_source = source_commit(args)
    assessment_bank_sha256 = file_sha256(args.assessment_bank)
    acquisition = read_json(args.acquisition_state)
    revision = acquisition.get("revision")
    if not isinstance(revision, int):
        raise ParallelContinuationError("canonical source or acquisition revision is invalid")
    if args.state_file.exists():
        if not args.resume:
            raise ParallelContinuationError("continuation state exists; use --resume")
        state = read_json(args.state_file)
        if state.get("schemaVersion") != SCHEMA or state.get("continuationId") != args.continuation_id:
            raise ParallelContinuationError("resume identity mismatch")
        if state.get("sourceCommit") != committed_source:
            raise ParallelContinuationError("resume source changed")
        if (
            state.get("concurrency") != args.concurrency
            or state.get("maxWaves") != args.max_waves
            or state.get("maxSessions") != args.max_sessions
            or state.get("maxWallSeconds") != args.max_wall_seconds
            or state.get("waveTimeoutSeconds") != args.wave_timeout_seconds
            or state.get("pollSeconds") != args.poll_seconds
            or state.get("thinking") != args.thinking
            or state.get("graph") != str(args.graph)
            or state.get("policy") != str(args.policy)
            or state.get("capsule") != str(args.capsule)
            or state.get("assessmentBank") != str(args.assessment_bank)
            or state.get("assessmentBankSha256") != assessment_bank_sha256
            or state.get("sourceRef") != args.source_ref
            or state.get("remoteRepo") != args.remote_repo
            or state.get("remoteGraph") != args.remote_graph
            or state.get("remotePolicy") != args.remote_policy
            or state.get("remoteCapsule") != args.remote_capsule
        ):
            raise ParallelContinuationError("resume safety boundary changed")
        if state.get("status") in {"completed", "blocked"}:
            print(json.dumps(state, indent=2, sort_keys=True))
            return 0
    else:
        now = utc_now()
        state = {
            "schemaVersion": SCHEMA,
            "continuationId": args.continuation_id,
            "status": "running",
            "reason": "parallel acquisition continuation is active",
            "sourceCommit": committed_source,
            "sourceRef": args.source_ref,
            "remoteRepo": args.remote_repo,
            "startedAt": now,
            "updatedAt": now,
            "initialAcquisitionRevision": revision,
            "currentAcquisitionRevision": revision,
            "concurrency": args.concurrency,
            "maxWaves": args.max_waves,
            "maxSessions": args.max_sessions,
            "maxWallSeconds": args.max_wall_seconds,
            "waveTimeoutSeconds": args.wave_timeout_seconds,
            "pollSeconds": args.poll_seconds,
            "thinking": args.thinking,
            "graph": str(args.graph),
            "policy": str(args.policy),
            "capsule": str(args.capsule),
            "assessmentBank": str(args.assessment_bank),
            "assessmentBankSha256": assessment_bank_sha256,
            "remoteGraph": args.remote_graph,
            "remotePolicy": args.remote_policy,
            "remoteCapsule": args.remote_capsule,
            "wavesStarted": 0,
            "wavesCompleted": 0,
            "sessionsStarted": 0,
            "currentWaveId": None,
            "waves": [],
            "reviewSelectionEnabled": False,
            "placement": {
                "controlPlane": "responsive supervisor, independent wave harvester, and notifier",
                "executionPlane": "concurrent detached Hetzner Codex children",
            },
            "truthBoundary": "Only independently replayed acquisition or correction evidence can advance signed state; no review or retention claim is scheduled.",
        }
        atomic_json(args.state_file, state)

    try:
        while True:
            if STOP_REQUESTED:
                raise ParallelContinuationError("operator stop signal received")
            if elapsed(str(state["startedAt"])) > args.max_wall_seconds:
                terminal(state, args.state_file, "blocked", "wall-time cap reached", "wall_time_cap")
                break
            if not state.get("currentWaveId") and state["wavesStarted"] >= args.max_waves:
                terminal(state, args.state_file, "blocked", "wave cap reached", "wave_cap")
                break
            if not state.get("currentWaveId") and state["sessionsStarted"] >= args.max_sessions:
                terminal(state, args.state_file, "blocked", "session cap reached", "session_cap")
                break
            if source_commit(args) != committed_source:
                raise ParallelContinuationError("canonical source changed during continuation")
            if file_sha256(args.assessment_bank) != assessment_bank_sha256:
                raise ParallelContinuationError("independent assessment bank changed during continuation")
            if state.get("currentWaveId"):
                matches = [
                    row for row in state["waves"]
                    if row.get("waveId") == state["currentWaveId"] and row.get("status") == "running"
                ]
                if len(matches) != 1:
                    raise ParallelContinuationError("resume current wave identity is invalid")
                wave_record = matches[0]
                before_revision = wave_record.get("beforeAcquisitionRevision")
                if not isinstance(before_revision, int):
                    raise ParallelContinuationError("resume current wave revision is invalid")
            else:
                before_revision = read_json(args.acquisition_state).get("revision")
                remaining = args.max_sessions - int(state["sessionsStarted"])
                concurrency = min(args.concurrency, remaining)
                command = [
                    str(args.launcher),
                    "--concurrency", str(concurrency),
                    "--source-ref", args.source_ref,
                    "--remote-repo", args.remote_repo,
                    "--graph", str(args.graph),
                    "--policy", str(args.policy),
                    "--capsule", str(args.capsule),
                    "--assessment-bank", str(args.assessment_bank),
                    "--approved-model-executable-binding", str(args.approved_model_executable_binding),
                    "--thinking", args.thinking,
                    "--remote-graph", args.remote_graph,
                    "--remote-policy", args.remote_policy,
                    "--remote-capsule", args.remote_capsule,
                    "--no-notify",
                ]
                if args.dry_run:
                    command.append("--dry-run")
                descriptor = parse_descriptor(run(command).stdout)
                if descriptor.get("sourceCommit") != committed_source:
                    raise ParallelContinuationError("launcher source binding changed")
                if descriptor.get("reviewSelectionEnabled") is not False:
                    raise ParallelContinuationError("launcher enabled forbidden review selection")
                if descriptor.get("thinking") != args.thinking:
                    raise ParallelContinuationError("launcher reasoning binding changed")
                if descriptor.get("placement", {}).get("executionPlane") != "concurrent detached Hetzner Codex children":
                    raise ParallelContinuationError("launcher did not place all Codex children on Hetzner")
                selected_count = descriptor.get("selectedCount")
                if not isinstance(selected_count, int) or selected_count < 0 or selected_count > concurrency:
                    raise ParallelContinuationError("launcher selected invalid child count")
                if selected_count == 0:
                    terminal(state, args.state_file, "completed", "graph acquisition frontier reached", "curriculum_frontier_reached")
                    break
                if args.dry_run:
                    state.update(status="ready", reason="parallel no-call preflight passed", updatedAt=utc_now())
                    atomic_json(args.state_file, state)
                    break
                dispatch_receipts = validate_dispatch_receipts(descriptor, selected_count)
                wave_record = {
                    "waveId": descriptor["waveId"],
                    "status": "running",
                    "selectedCount": selected_count,
                    "mergeOrder": descriptor.get("mergeOrder"),
                    "dispatchReceipts": dispatch_receipts,
                    "beforeAcquisitionRevision": before_revision,
                    "launchedAt": utc_now(),
                    "stateFile": descriptor.get("stateFile"),
                }
                state["waves"].append(wave_record)
                state["wavesStarted"] += 1
                state["sessionsStarted"] += selected_count
                state["currentWaveId"] = descriptor["waveId"]
                state["updatedAt"] = utc_now()
                atomic_json(args.state_file, state)
            wave_state = wait_for_wave(
                Path(str(wave_record["stateFile"])),
                wave_record["launchedAt"],
                args,
                str(state["startedAt"]),
            )
            if wave_state.get("status") != "completed":
                terminal(
                    state,
                    args.state_file,
                    "blocked",
                    str(wave_state.get("reason") or "wave failed closed"),
                    "genuine_or_infrastructure_blocker",
                )
                break
            after_revision = wave_state.get("acquisitionRevision")
            if not isinstance(after_revision, int) or after_revision <= before_revision:
                raise ParallelContinuationError("completed wave made no atomic signed acquisition progress")
            wave_record.update(status="completed", afterAcquisitionRevision=after_revision, completedAt=utc_now())
            state["wavesCompleted"] += 1
            state["currentWaveId"] = None
            state["currentAcquisitionRevision"] = after_revision
            state["updatedAt"] = utc_now()
            atomic_json(args.state_file, state)
    except (ParallelContinuationError, OSError, json.JSONDecodeError, subprocess.SubprocessError) as error:
        terminal(state, args.state_file, "blocked", str(error), "genuine_or_infrastructure_blocker")
    print(json.dumps(state, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    try:
        raise SystemExit(main())
    except ParallelContinuationError as error:
        print(f"continue_parallel_adaptive_math: {error}", file=os.sys.stderr)
        raise SystemExit(2)
