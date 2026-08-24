#!/usr/bin/env python3
"""Deliver terminal detached-job state directly through OpenClaw.

This intentionally does not rely on an exec-completion wake.  The notifier runs
on the control plane, reads a local or SSH-hosted JSON state file, and sends a
deduplicated terminal notification through ``openclaw message send``.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
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
DEFAULT_ROUTING_FILE = Path("/root/clawd/state/notification-routing/default.json")
DEFAULT_DEDUPE_FILE = Path("/root/clawd/state/detached-job-notifications/delivered.json")
SAFE_REMOTE_PATH = re.compile(r"^/[A-Za-z0-9._/-]+$")


class NotifierError(RuntimeError):
    pass


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
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def read_json_state(state_file: str, ssh_host: str | None = None) -> dict[str, Any]:
    if ssh_host:
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


def notification_key(job_label: str, source: str, state: dict[str, Any]) -> str:
    stable = {
        "job": job_label,
        "source": source,
        "status": state.get("status"),
        "head": state.get("candidateHead") or state.get("head") or state.get("commit"),
        "blocker": state.get("blocker") or state.get("error") or state.get("reason"),
    }
    encoded = json.dumps(stable, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def format_message(job_label: str, state: dict[str, Any]) -> str:
    status = str(state["status"])
    title = status.replace("_", " ").upper()
    lines = [f"[Cortex] Detached job: {title}", f"Job: {job_label}"]

    head = state.get("candidateHead") or state.get("head") or state.get("commit")
    if head:
        lines.append(f"Head: {head}")
    blocker = state.get("blocker") or state.get("error") or state.get("reason")
    if blocker:
        compact = " ".join(str(blocker).split())
        lines.append(f"Blocker: {compact[:1500]}")
    artifact = state.get("artifactRoot") or state.get("artifactPath")
    if artifact:
        lines.append(f"Artifact: {artifact}")
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
    if dry_run:
        command.append("--dry-run")
    result = subprocess.run(command, capture_output=True, text=True, timeout=60, check=False)
    if result.returncode != 0:
        raise NotifierError(result.stderr.strip() or result.stdout.strip() or f"sender exited {result.returncode}")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload = {"raw": result.stdout.strip()}
    return payload


def load_ledger(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schemaVersion": "detached-job-notifier.v1", "delivered": {}}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("delivered"), dict):
        raise NotifierError(f"invalid dedupe ledger: {path}")
    return payload


def process_terminal_state(args: argparse.Namespace, state: dict[str, Any]) -> str:
    route = load_route(args.routing_file)
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
        result = send_message(
            sender=args.sender,
            channel=channel,
            account=account,
            target=target,
            message=message,
            dry_run=args.dry_run,
        )
        if args.dry_run:
            print(json.dumps({"dryRun": True, "message": message, "result": result}, sort_keys=True))
            return "dry_run"

        ledger["delivered"][key] = {
            "account": account,
            "channel": channel,
            "deliveredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "job": args.job_label,
            "result": result,
            "source": source,
            "status": state["status"],
        }
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

            outcome = process_terminal_state(args, state)
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
