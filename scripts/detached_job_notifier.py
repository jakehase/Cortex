#!/usr/bin/env python3
"""Deliver terminal detached-job state directly through OpenClaw.

This intentionally does not rely on an exec-completion wake.  The notifier runs
on the control plane, reads a local or SSH-hosted JSON state file, and sends a
deduplicated terminal notification through ``openclaw message send``.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import time
from typing import Any


DEFAULT_TERMINAL_STATUSES = {
    "blocked",
    "candidate_green_pending_delivery",
    "complete",
    "completed",
    "delivered",
    "failed",
    "green",
}
SUCCESS_TERMINAL_STATUSES = {
    "candidate_green_pending_delivery",
    "complete",
    "completed",
    "delivered",
    "green",
}
FAILURE_TERMINAL_STATUSES = {"blocked", "failed"}
TERMINAL_STATE_SCHEMA = "cortex.detached-job-terminal.v2"
DELIVERY_ACK_SCHEMAS = {
    "openclaw.message.delivery.v1",
    "openclaw.message.send.v1",
}
DEFAULT_MAX_STATE_AGE_SECONDS = 86_400.0
DEFAULT_ROUTING_FILE = Path("/root/clawd/state/notification-routing/default.json")
DEFAULT_DEDUPE_FILE = Path("/root/clawd/state/detached-job-notifications/delivered.json")
SAFE_REMOTE_PATH = re.compile(r"^/[A-Za-z0-9._/-]+$")
SAFE_SSH_HOST = re.compile(r"^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$")
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
SHA256_HEX = re.compile(r"^[a-f0-9]{64}$")


class NotifierError(RuntimeError):
    pass


class DeliveryRejected(NotifierError):
    """The provider positively reported that it did not accept the message."""


class DeliveryNotAttempted(NotifierError):
    """The sender executable did not start, so retry cannot duplicate a send."""


def _bounded_max_state_age(value: float) -> float:
    """Keep the configurable freshness window finite and no weaker than default."""

    maximum_age = float(value)
    if (
        not math.isfinite(maximum_age)
        or maximum_age < 1.0
        or maximum_age > DEFAULT_MAX_STATE_AGE_SECONDS
    ):
        raise NotifierError(
            "max state age must be finite and between 1 and "
            f"{int(DEFAULT_MAX_STATE_AGE_SECONDS)} seconds"
        )
    return maximum_age


def _fsync_directory(path: Path) -> None:
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def read_json_state(state_file: str, ssh_host: str | None = None) -> dict[str, Any]:
    if ssh_host:
        if not SAFE_SSH_HOST.fullmatch(ssh_host):
            raise NotifierError(f"unsafe SSH host: {ssh_host!r}")
        if not SAFE_REMOTE_PATH.fullmatch(state_file):
            raise NotifierError(f"unsafe remote state path: {state_file!r}")
        result = subprocess.run(
            [
                "ssh",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                ssh_host,
                "cat",
                state_file,
            ],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if result.returncode != 0:
            raise NotifierError(result.stderr.strip() or f"ssh exited {result.returncode}")
        raw = result.stdout
    else:
        raw = Path(state_file).read_text(encoding="utf-8")

    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise NotifierError("state JSON must be an object")
    if not isinstance(payload.get("status"), str) or not payload["status"].strip():
        raise NotifierError("state JSON has no non-empty status")
    return payload


def _parse_utc_timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise NotifierError(f"terminal state requires non-empty {field}")
    text = value.strip()
    try:
        parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    except ValueError as exc:
        raise NotifierError(f"terminal state {field} is not RFC3339") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise NotifierError(f"terminal state {field} must be UTC")
    return parsed.astimezone(timezone.utc)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _remote_sha256(path: str, ssh_host: str) -> str:
    if not SAFE_SSH_HOST.fullmatch(ssh_host):
        raise NotifierError(f"unsafe SSH host: {ssh_host!r}")
    if not SAFE_REMOTE_PATH.fullmatch(path):
        raise NotifierError(f"unsafe remote artifact path: {path!r}")
    result = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            ssh_host,
            f"sha256sum -- {shlex.quote(path)}",
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise NotifierError("remote terminal artifact could not be verified")
    observed = result.stdout.strip().split(maxsplit=1)[0] if result.stdout.strip() else ""
    if not SHA256_HEX.fullmatch(observed):
        raise NotifierError("remote terminal artifact returned an invalid SHA-256")
    return observed


def _validate_artifact_manifest(
    manifest: Any,
    *,
    ssh_host: str | None,
) -> dict[str, str]:
    if not isinstance(manifest, dict):
        raise NotifierError("successful terminal state requires artifactManifest")
    artifact_path = manifest.get("path")
    expected_hash = str(manifest.get("sha256") or "").lower()
    if not isinstance(artifact_path, str) or not artifact_path.strip():
        raise NotifierError("artifactManifest.path must be non-empty")
    artifact_path = artifact_path.strip()
    if not SHA256_HEX.fullmatch(expected_hash):
        raise NotifierError("artifactManifest.sha256 must be a lowercase SHA-256")
    if ssh_host:
        observed_hash = _remote_sha256(artifact_path, ssh_host)
    else:
        path = Path(artifact_path)
        if not path.is_absolute():
            raise NotifierError("artifactManifest.path must be absolute")
        if path.is_symlink() or not path.is_file():
            raise NotifierError(f"terminal artifact is missing or unsafe: {artifact_path}")
        observed_hash = _sha256_file(path)
    if observed_hash != expected_hash:
        raise NotifierError("terminal artifact SHA-256 does not match artifactManifest")
    return {"path": artifact_path, "sha256": expected_hash}


def validate_terminal_state(
    state: dict[str, Any],
    *,
    terminal_statuses: set[str] | None = None,
    max_age_seconds: float = DEFAULT_MAX_STATE_AGE_SECONDS,
    ssh_host: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Validate the authority needed to render a terminal notification."""

    status = str(state.get("status") or "").strip()
    allowed = terminal_statuses or DEFAULT_TERMINAL_STATUSES
    if status not in allowed or status not in SUCCESS_TERMINAL_STATUSES | FAILURE_TERMINAL_STATUSES:
        raise NotifierError(f"unsupported terminal status: {status!r}")
    if state.get("schemaVersion") != TERMINAL_STATE_SCHEMA:
        raise NotifierError(f"terminal state requires schemaVersion {TERMINAL_STATE_SCHEMA}")
    for field in ("jobId", "runId"):
        value = state.get(field)
        if not isinstance(value, str) or not SAFE_ID.fullmatch(value.strip()):
            raise NotifierError(f"terminal state {field} is missing or invalid")
    sequence = state.get("terminalSequence")
    if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 0:
        raise NotifierError("terminal state terminalSequence must be a non-negative integer")
    truth_boundary = state.get("truthBoundary")
    if not isinstance(truth_boundary, str) or not truth_boundary.strip() or len(truth_boundary) > 4096:
        raise NotifierError("terminal state requires a bounded truthBoundary")
    if not isinstance(state.get("verificationPassed"), bool):
        raise NotifierError("terminal state verificationPassed must be boolean")

    completed_at = _parse_utc_timestamp(state.get("completedAt"), "completedAt")
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    maximum_age = _bounded_max_state_age(max_age_seconds)
    age_seconds = (current - completed_at).total_seconds()
    if age_seconds < -300:
        raise NotifierError("terminal state completion time is implausibly in the future")
    if age_seconds > maximum_age:
        raise NotifierError(
            f"terminal state is stale ({int(age_seconds)}s > {int(maximum_age)}s)"
        )

    validated = dict(state)
    validated["completedAt"] = completed_at.isoformat().replace("+00:00", "Z")
    validated["truthBoundary"] = truth_boundary.strip()
    if status in SUCCESS_TERMINAL_STATUSES:
        if state["verificationPassed"] is not True:
            raise NotifierError("successful terminal state requires verificationPassed=true")
        validated["artifactManifest"] = _validate_artifact_manifest(
            state.get("artifactManifest"), ssh_host=ssh_host
        )
    else:
        if state["verificationPassed"] is not False:
            raise NotifierError("failed or blocked terminal state requires verificationPassed=false")
        blocker = state.get("blocker") or state.get("error") or state.get("reason")
        if not isinstance(blocker, str) or not blocker.strip():
            raise NotifierError("failed or blocked terminal state requires blocker/error/reason")
        if state.get("artifactManifest") is not None:
            validated["artifactManifest"] = _validate_artifact_manifest(
                state.get("artifactManifest"), ssh_host=ssh_host
            )
    return validated


def notification_key(job_label: str, source: str, state: dict[str, Any]) -> str:
    manifest = state.get("artifactManifest") if isinstance(state.get("artifactManifest"), dict) else {}
    stable = {
        "schemaVersion": state.get("schemaVersion"),
        "job": job_label,
        "jobId": state.get("jobId"),
        "runId": state.get("runId"),
        "source": source,
        "status": state.get("status"),
        "completedAt": state.get("completedAt"),
        "terminalSequence": state.get("terminalSequence"),
        "verificationPassed": state.get("verificationPassed"),
        "artifactPath": manifest.get("path"),
        "artifactSha256": manifest.get("sha256"),
        "truthBoundary": state.get("truthBoundary"),
        "head": state.get("candidateHead") or state.get("head") or state.get("commit"),
        "blocker": state.get("blocker") or state.get("error") or state.get("reason"),
    }
    encoded = json.dumps(stable, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def format_message(job_label: str, state: dict[str, Any]) -> str:
    status = str(state["status"])
    title = status.replace("_", " ").upper()
    lines = [
        f"[Cortex] Detached job: {title}",
        f"Job: {job_label}",
        f"Run: {state['runId']}",
        f"Completed: {state['completedAt']}",
        f"Verification passed: {str(state['verificationPassed']).lower()}",
        f"Truth boundary: {state['truthBoundary']}",
    ]

    head = state.get("candidateHead") or state.get("head") or state.get("commit")
    if head:
        lines.append(f"Head: {head}")
    blocker = state.get("blocker") or state.get("error") or state.get("reason")
    if blocker:
        compact = " ".join(str(blocker).split())
        lines.append(f"Blocker: {compact[:1500]}")
    artifact = state.get("artifactManifest")
    if isinstance(artifact, dict):
        lines.append(f"Artifact: {artifact.get('path')}")
        lines.append(f"Artifact SHA-256: {artifact.get('sha256')}")
    return "\n".join(lines)


def load_route(path: Path | None) -> dict[str, str]:
    if path is None or not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise NotifierError("routing file must contain a JSON object")
    return {key: str(value) for key, value in payload.items() if value is not None}


def send_message(
    *,
    sender: str,
    channel: str,
    account: str,
    target: str,
    message: str,
    idempotency_key: str,
    idempotency_flag: str | None,
    dry_run: bool,
) -> dict[str, Any]:
    command = [
        sender,
        "message",
        "send",
        "--channel",
        channel,
        "--account",
        account,
        "--target",
        target,
        "--message",
        message,
        "--json",
    ]
    if idempotency_flag:
        if not idempotency_flag.startswith("--") or not re.fullmatch(r"--[a-z0-9-]{1,63}", idempotency_flag):
            raise NotifierError("sender idempotency flag must be an explicit safe long option")
        command.extend([idempotency_flag, idempotency_key])
    if dry_run:
        command.append("--dry-run")
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=60, check=False
        )
    except OSError as exc:
        raise DeliveryNotAttempted(
            f"sender executable did not start: {type(exc).__name__}"
        ) from exc
    if result.returncode != 0:
        raise NotifierError(
            "delivery outcome uncertain after sender failure: "
            + (result.stderr.strip() or result.stdout.strip() or f"sender exited {result.returncode}")
        )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise NotifierError("delivery outcome uncertain: sender returned non-JSON output") from exc
    if not isinstance(payload, dict):
        raise NotifierError("delivery outcome uncertain: sender response must be an object")
    if dry_run:
        return payload
    if payload.get("schemaVersion") not in DELIVERY_ACK_SCHEMAS:
        raise NotifierError("delivery outcome uncertain: sender acknowledgement schema is missing or unsupported")
    if payload.get("ok") is not True:
        if payload.get("ok") is False and payload.get("delivery") == "rejected":
            raise DeliveryRejected("sender positively rejected delivery")
        raise NotifierError("delivery outcome uncertain: sender did not positively acknowledge delivery")
    message_id = payload.get("messageId") or payload.get("message_id")
    if not isinstance(message_id, str) or not message_id.strip():
        raise NotifierError("delivery outcome uncertain: sender acknowledgement has no message ID")
    return payload


def load_ledger(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schemaVersion": "detached-job-notifier.v2", "attempts": {}, "delivered": {}}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("delivered"), dict):
        raise NotifierError(f"invalid dedupe ledger: {path}")
    attempts = payload.get("attempts", {})
    if not isinstance(attempts, dict):
        raise NotifierError(f"invalid pending-attempt ledger: {path}")
    payload["schemaVersion"] = "detached-job-notifier.v2"
    payload["attempts"] = attempts
    return payload


def process_terminal_state(args: argparse.Namespace, state: dict[str, Any]) -> str:
    try:
        route = load_route(args.routing_file)
    except PermissionError:
        # An explicit target is self-contained; an unreadable optional routing
        # file must not prevent delivery through the safe built-in defaults.
        if not args.target:
            raise
        route = {}
    channel = args.channel or route.get("channel") or "whatsapp"
    account = args.account or route.get("account") or "default"
    target = args.target or route.get("target")
    if not target:
        raise NotifierError("no target; pass --target or configure the routing file")

    source = f"{args.ssh_host or 'local'}:{args.state_file}"
    key = notification_key(args.job_label, source, state)
    lock_path = args.dedupe_file.with_suffix(args.dedupe_file.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    with lock_path.open("a+", encoding="utf-8") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        ledger = load_ledger(args.dedupe_file)
        if key in ledger["delivered"]:
            return "already_delivered"

        message = format_message(args.job_label, state)
        if args.dry_run:
            result = send_message(
                sender=args.sender,
                channel=channel,
                account=account,
                target=target,
                message=message,
                idempotency_key=key,
                idempotency_flag=args.sender_idempotency_flag,
                dry_run=True,
            )
            print(json.dumps({"dryRun": True, "message": message, "result": result}, sort_keys=True))
            return "dry_run"

        if key in ledger["attempts"]:
            raise NotifierError(
                "delivery_outcome_uncertain: a durable pre-send attempt exists; "
                "reconcile it with the provider before retrying"
            )
        ledger["attempts"][key] = {
            "account": account,
            "attemptedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "channel": channel,
            "idempotencyKey": key,
            "job": args.job_label,
            "runId": state["runId"],
            "source": source,
            "status": "sending",
        }
        atomic_write_json(args.dedupe_file, ledger)
        try:
            result = send_message(
                sender=args.sender,
                channel=channel,
                account=account,
                target=target,
                message=message,
                idempotency_key=key,
                idempotency_flag=args.sender_idempotency_flag,
                dry_run=False,
            )
        except (DeliveryRejected, DeliveryNotAttempted):
            # A versioned negative acknowledgement proves the provider did not
            # accept the message, and failure to start the sender proves there
            # was no attempt.  A later attempt is safe in either case.
            ledger["attempts"].pop(key, None)
            atomic_write_json(args.dedupe_file, ledger)
            raise

        ledger["delivered"][key] = {
            "account": account,
            "channel": channel,
            "deliveredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "job": args.job_label,
            "result": result,
            "source": source,
            "status": state["status"],
        }
        ledger["attempts"].pop(key, None)
        atomic_write_json(args.dedupe_file, ledger)
        print(json.dumps({"delivered": True, "key": key, "result": result}, sort_keys=True))
        return "delivered"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-file", required=True)
    parser.add_argument("--ssh-host")
    parser.add_argument("--job-label", required=True)
    parser.add_argument("--terminal-status", action="append", dest="terminal_statuses")
    parser.add_argument("--poll-seconds", type=float, default=30.0)
    parser.add_argument(
        "--max-state-age-seconds",
        type=float,
        default=DEFAULT_MAX_STATE_AGE_SECONDS,
        help="Reject terminal authority older than this many seconds",
    )
    parser.add_argument(
        "--terminal-grace-seconds",
        type=float,
        default=0.0,
        help="Require the same terminal state to persist this long before delivery",
    )
    parser.add_argument("--once", action="store_true", help="Check once; do not wait or retry")
    parser.add_argument(
        "--exit-after-delivery",
        action="store_true",
        help="Exit after delivering or deduplicating the first stable terminal state",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--routing-file", type=Path, default=DEFAULT_ROUTING_FILE)
    parser.add_argument("--dedupe-file", type=Path, default=DEFAULT_DEDUPE_FILE)
    parser.add_argument("--sender", default="openclaw")
    parser.add_argument(
        "--sender-idempotency-flag",
        help="Provider-documented long option for a delivery idempotency key; unset by default",
    )
    parser.add_argument("--channel")
    parser.add_argument("--account")
    parser.add_argument("--target")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    raw_terminals = args.terminal_statuses or DEFAULT_TERMINAL_STATUSES
    terminals = {
        status.strip()
        for value in raw_terminals
        for status in str(value).split(",")
        if status.strip()
    }
    delay = max(1.0, args.poll_seconds)
    grace = max(0.0, args.terminal_grace_seconds)
    max_state_age = _bounded_max_state_age(args.max_state_age_seconds)
    pending_key: str | None = None
    pending_since = 0.0

    while True:
        try:
            state = read_json_state(args.state_file, args.ssh_host)
            if state["status"] not in terminals:
                pending_key = None
                pending_since = 0.0
                if args.once:
                    return 3
                time.sleep(delay)
                continue

            state = validate_terminal_state(
                state,
                terminal_statuses=terminals,
                max_age_seconds=max_state_age,
                ssh_host=args.ssh_host,
            )
            source = f"{args.ssh_host or 'local'}:{args.state_file}"
            current_key = notification_key(args.job_label, source, state)
            now = time.monotonic()
            if grace and current_key != pending_key:
                pending_key = current_key
                pending_since = now
                if args.once:
                    time.sleep(grace)
                    confirmed = read_json_state(args.state_file, args.ssh_host)
                    if confirmed["status"] not in terminals:
                        return 3
                    confirmed = validate_terminal_state(
                        confirmed,
                        terminal_statuses=terminals,
                        max_age_seconds=max_state_age,
                        ssh_host=args.ssh_host,
                    )
                    confirmed_key = notification_key(args.job_label, source, confirmed)
                    if confirmed_key != current_key:
                        return 3
                    process_terminal_state(args, confirmed)
                    return 0
                time.sleep(delay)
                continue
            if grace and now - pending_since < grace:
                time.sleep(min(delay, max(0.01, grace - (now - pending_since))))
                continue

            process_terminal_state(args, state)
            if args.once or args.exit_after_delivery:
                return 0
            # Stay attached to the state artifact so later reruns can emit a
            # different blocker or final completion without launching a new
            # watcher. The delivery ledger prevents repeats of the same state.
            delay = max(1.0, args.poll_seconds)
            time.sleep(delay)
        except (NotifierError, OSError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
            print(f"detached_job_notifier: {exc}", file=sys.stderr, flush=True)
            if args.once:
                return 4
            time.sleep(delay)
            delay = min(delay * 2, 300.0)


if __name__ == "__main__":
    raise SystemExit(main())
