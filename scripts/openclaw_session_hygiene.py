#!/usr/bin/env python3
"""Bounded, non-destructive OpenClaw session inventory/continuity verifier.

The tool never deletes, rewrites, compacts, resets, or locks a session. It reads a
bounded head/tail window from each regular ``.jsonl`` file and emits candidate
pressure plus continuity evidence for a separately approved compaction drill.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

IDENTITY_KEYS = ("sessionId", "session_id", "sessionKey", "session_key")
DEFAULT_MAX_RECORD_BYTES = 8 * 1024 * 1024


def _parse_line(raw: bytes) -> dict[str, Any] | None:
    if not raw.strip():
        return None
    try:
        value = json.loads(raw.decode("utf-8", errors="strict"))
        return value if isinstance(value, dict) else None
    except (UnicodeDecodeError, ValueError):
        return None


def _identity(record: dict[str, Any] | None) -> str | None:
    if not record:
        return None
    for key in IDENTITY_KEYS:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:256]
    for container in ("metadata", "meta", "context"):
        nested = record.get(container)
        if isinstance(nested, dict):
            for key in IDENTITY_KEYS:
                value = nested.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()[:256]
    return None


def _head_line(handle, size: int, chunk_size: int, max_record_bytes: int) -> tuple[bytes, bool, int]:
    """Read one complete leading JSONL record without assuming it fits in a chunk."""
    handle.seek(0)
    data = bytearray()
    scanned = 0
    while scanned < size and len(data) <= max_record_bytes:
        chunk = handle.read(min(chunk_size, size - scanned, max_record_bytes + 1 - len(data)))
        if not chunk:
            break
        data.extend(chunk)
        scanned += len(chunk)
        newline = data.find(b"\n")
        if newline >= 0:
            return bytes(data[:newline]).rstrip(b"\r"), True, scanned
    if scanned >= size:
        return bytes(data).rstrip(b"\r\n"), True, scanned
    return bytes(data[:max_record_bytes]), False, scanned


def _tail_line(handle, size: int, chunk_size: int, max_record_bytes: int) -> tuple[bytes, bool, int]:
    """Read one complete trailing JSONL record by finding its preceding newline."""
    position = size
    data = b""
    scanned = 0
    while position > 0 and len(data) <= max_record_bytes:
        take = min(chunk_size, position, max_record_bytes + 1 - len(data))
        position -= take
        handle.seek(position)
        data = handle.read(take) + data
        scanned += take
        end = len(data.rstrip())
        newline = data.rfind(b"\n", 0, end)
        if newline >= 0:
            return data[newline + 1:end].rstrip(b"\r"), True, scanned
    if position == 0:
        return data.rstrip(), True, scanned
    return data[-max_record_bytes:], False, scanned


def inspect_session(path: Path, *, read_bytes: int = 65536, max_record_bytes: int = DEFAULT_MAX_RECORD_BYTES) -> dict[str, Any]:
    stat = path.stat(follow_symlinks=False)
    if not path.is_file() or path.is_symlink():
        raise ValueError("not_regular_session_file")
    with path.open("rb", buffering=0) as handle:
        chunk_size = min(read_bytes, max(1, stat.st_size))
        first_raw, first_complete, first_scanned = _head_line(handle, stat.st_size, chunk_size, max_record_bytes)
        last_raw, last_complete, last_scanned = _tail_line(handle, stat.st_size, chunk_size, max_record_bytes)
    first = _parse_line(first_raw) if first_complete else None
    last = _parse_line(last_raw) if last_complete else None
    session_key = _identity(first) or _identity(last) or path.name.removesuffix(".jsonl")
    return {
        "file": path.name,
        "sessionKey": session_key,
        "bytes": stat.st_size,
        "mtimeNs": stat.st_mtime_ns,
        "firstRecordComplete": first_complete,
        "lastRecordComplete": last_complete,
        "firstRecordParseable": first is not None,
        "lastRecordParseable": last is not None,
        "firstRecordFingerprint": hashlib.sha256(first_raw).hexdigest() if first_raw else None,
        "lastRecordFingerprint": hashlib.sha256(last_raw).hexdigest() if last_raw else None,
        "boundedReadBytes": first_scanned + last_scanned,
        "maxRecordBytes": max_record_bytes,
    }


def inventory(session_dir: Path, *, max_files: int = 2000, max_seconds: float = 10.0, read_bytes: int = 65536, max_record_bytes: int = DEFAULT_MAX_RECORD_BYTES, compaction_bytes: int = 8 * 1024 * 1024) -> dict[str, Any]:
    started = time.monotonic()
    session_dir = session_dir.resolve()
    sessions: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    deadline_hit = False
    file_limit_hit = False
    entries_seen = 0
    with os.scandir(session_dir) as entries:
        for entry in entries:
            entries_seen += 1
            if time.monotonic() - started > max_seconds:
                deadline_hit = True
                break
            if not entry.name.endswith(".jsonl"):
                continue
            if len(sessions) >= max_files:
                file_limit_hit = True
                break
            path = Path(entry.path)
            try:
                sessions.append(inspect_session(path, read_bytes=read_bytes, max_record_bytes=max_record_bytes))
            except (OSError, ValueError) as exc:
                skipped.append({"file": entry.name, "error": type(exc).__name__})
    sessions.sort(key=lambda item: item["file"])
    complete = not deadline_hit and not file_limit_hit
    record_limit_files = [item["file"] for item in sessions if not item["firstRecordComplete"] or not item["lastRecordComplete"]]
    parse_failures = [item["file"] for item in sessions if item["firstRecordComplete"] and item["lastRecordComplete"] and (not item["firstRecordParseable"] or not item["lastRecordParseable"])]
    candidates = [item["file"] for item in sessions if item["bytes"] >= compaction_bytes]
    return {
        "schema": "openclaw.session-inventory.v1",
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "sessionDir": str(session_dir),
        "complete": complete,
        "ok": complete and not skipped and not parse_failures and not record_limit_files,
        "bounds": {"maxFiles": max_files, "maxSeconds": max_seconds, "readBytesPerEdgeChunk": read_bytes, "maxRecordBytes": max_record_bytes, "deadlineHit": deadline_hit, "fileLimitHit": file_limit_hit},
        "counts": {"entriesSeen": entries_seen, "sessions": len(sessions), "skipped": len(skipped), "parseFailures": len(parse_failures), "recordLimitExceeded": len(record_limit_files), "compactionCandidates": len(candidates)},
        "totalBytes": sum(item["bytes"] for item in sessions),
        "compactionCandidateFiles": candidates,
        "sessions": sessions,
        "skipped": skipped,
        "parseFailureFiles": parse_failures,
        "recordLimitExceededFiles": record_limit_files,
        "mutationPerformed": False,
    }


def continuity(before: dict[str, Any], after: dict[str, Any], *, require_tail_fingerprint: bool = False) -> dict[str, Any]:
    before_by_key = {str(item.get("sessionKey")): item for item in before.get("sessions") or [] if item.get("sessionKey")}
    after_by_key = {str(item.get("sessionKey")): item for item in after.get("sessions") or [] if item.get("sessionKey")}
    checks = []
    for key, old in sorted(before_by_key.items()):
        new = after_by_key.get(key)
        checks.append({"sessionKey": key, "check": "identity_present", "passed": new is not None})
        if new is not None:
            checks.append({"sessionKey": key, "check": "after_tail_parseable", "passed": bool(new.get("lastRecordParseable"))})
            if require_tail_fingerprint:
                checks.append({"sessionKey": key, "check": "tail_fingerprint_preserved", "passed": old.get("lastRecordFingerprint") == new.get("lastRecordFingerprint")})
    missing = sorted(set(before_by_key) - set(after_by_key))
    failed = [item for item in checks if not item["passed"]]
    return {
        "schema": "openclaw.session-continuity.v1",
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "ok": bool(before.get("complete")) and bool(after.get("complete")) and not failed,
        "beforeComplete": bool(before.get("complete")),
        "afterComplete": bool(after.get("complete")),
        "beforeSessionCount": len(before_by_key),
        "afterSessionCount": len(after_by_key),
        "missingSessionKeys": missing,
        "checks": checks,
        "failedChecks": failed,
        "requireTailFingerprint": require_tail_fingerprint,
        "compactionPerformed": False,
        "mutationPerformed": False,
    }


def write_output(path: str | None, payload: dict[str, Any]) -> None:
    text = json.dumps(payload, indent=2, sort_keys=True)
    if path:
        output = Path(path); output.parent.mkdir(parents=True, exist_ok=True); output.write_text(text + "\n", encoding="utf-8")
    print(text)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    inv = sub.add_parser("inventory")
    inv.add_argument("--session-dir", required=True)
    inv.add_argument("--max-files", type=int, default=2000)
    inv.add_argument("--max-seconds", type=float, default=10.0)
    inv.add_argument("--read-bytes", type=int, default=65536)
    inv.add_argument("--max-record-bytes", type=int, default=DEFAULT_MAX_RECORD_BYTES)
    inv.add_argument("--compaction-bytes", type=int, default=8 * 1024 * 1024)
    inv.add_argument("--output")
    con = sub.add_parser("continuity")
    con.add_argument("--before", required=True)
    con.add_argument("--after-dir", required=True)
    con.add_argument("--max-files", type=int, default=2000)
    con.add_argument("--max-seconds", type=float, default=10.0)
    con.add_argument("--max-record-bytes", type=int, default=DEFAULT_MAX_RECORD_BYTES)
    con.add_argument("--require-tail-fingerprint", action="store_true")
    con.add_argument("--output")
    args = parser.parse_args()
    if args.command == "inventory":
        result = inventory(Path(args.session_dir), max_files=args.max_files, max_seconds=args.max_seconds, read_bytes=args.read_bytes, max_record_bytes=args.max_record_bytes, compaction_bytes=args.compaction_bytes)
    else:
        before = json.loads(Path(args.before).read_text(encoding="utf-8"))
        after = inventory(Path(args.after_dir), max_files=args.max_files, max_seconds=args.max_seconds, max_record_bytes=args.max_record_bytes)
        result = continuity(before, after, require_tail_fingerprint=args.require_tail_fingerprint)
    write_output(args.output, result)
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
