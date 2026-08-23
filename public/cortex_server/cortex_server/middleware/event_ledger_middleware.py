"""
Event Ledger Middleware (One Nervous System)

Records every request/response turn into a durable JSONL ledger so the system
can reason about itself over time.
"""

from __future__ import annotations

from collections import deque
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from typing import Any, Deque, Dict, List

import asyncio
import errno
import fcntl
import hashlib
import json
import logging
import os
import re
import stat
import threading
import time
import uuid
from urllib.parse import unquote

from cortex_server.modules.metrics_store import record_event_ledger_durable_write_drop
from cortex_server.modules.sensitive_data_redaction import (
    is_sensitive_query_key,
    redact_query_string,
    redact_sensitive_text,
    redact_url_query_value,
)

logger = logging.getLogger(__name__)


EVENT_LEDGER_MIN_BYTES = 1024
EVENT_LEDGER_MAX_BACKUP_COUNT = 32
EVENT_LEDGER_DIRECTORY_SCAN_LIMIT = 1024


def _positive_int_env(name: str, default: int, minimum: int = 1) -> int:
    """Parse a resource bound, clamping non-positive values but rejecting garbage."""
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"{name} must be an integer, got {raw!r}") from exc
    return max(minimum, value)


def _bounded_backup_count_env(name: str, default: int) -> int:
    value = _positive_int_env(name, default, minimum=0)
    if value > EVENT_LEDGER_MAX_BACKUP_COUNT:
        raise RuntimeError(
            f"{name} must be <= {EVENT_LEDGER_MAX_BACKUP_COUNT}, got {value}"
        )
    return value


EVENT_LEDGER_PATH = os.getenv("CORTEX_EVENT_LEDGER_PATH", "/app/logs/cortex_event_ledger.jsonl")
EVENT_LEDGER_MAX_IN_MEMORY = max(1000, int(os.getenv("CORTEX_EVENT_LEDGER_MAX_IN_MEMORY", "20000")))
EVENT_LEDGER_INCLUDE_DOCS = os.getenv("CORTEX_EVENT_LEDGER_INCLUDE_DOCS", "false").lower() in {"1", "true", "yes", "on"}
EVENT_LEDGER_MAX_BYTES = _positive_int_env(
    "CORTEX_EVENT_LEDGER_MAX_BYTES", 10485760, EVENT_LEDGER_MIN_BYTES
)
EVENT_LEDGER_BACKUP_COUNT = _bounded_backup_count_env(
    "CORTEX_EVENT_LEDGER_BACKUP_COUNT", 3
)
EVENT_LEDGER_LOCK_TIMEOUT_SECONDS = max(
    0.0, float(os.getenv("CORTEX_EVENT_LEDGER_LOCK_TIMEOUT_SECONDS", "2.0"))
)
EVENT_LEDGER_WRITE_CAPACITY = _positive_int_env(
    "CORTEX_EVENT_LEDGER_WRITE_CAPACITY", 64
)
EVENT_LEDGER_WRITE_WORKERS = min(
    EVENT_LEDGER_WRITE_CAPACITY,
    _positive_int_env("CORTEX_EVENT_LEDGER_WRITE_WORKERS", 4),
)
EVENT_LEDGER_TELEMETRY_DEADLINE_SECONDS = max(
    0.0, float(os.getenv("CORTEX_EVENT_LEDGER_TELEMETRY_DEADLINE_SECONDS", "0.01"))
)

_recent_events: Deque[Dict[str, Any]] = deque(maxlen=EVENT_LEDGER_MAX_IN_MEMORY)
_recent_events_lock = threading.Lock()
_WRITE_LOCK_STRIPES = tuple(threading.Lock() for _ in range(256))
_durable_outcomes: Deque[Dict[str, Any]] = deque(maxlen=EVENT_LEDGER_MAX_IN_MEMORY)
_durable_health_lock = threading.Lock()
_durable_totals = {"writes_succeeded": 0, "write_failures": 0, "records_dropped": 0}
_last_durable_success_at: str | None = None
_last_durable_success_path: str | None = None


@dataclass(frozen=True)
class _LedgerWriteConfig:
    """Immutable destination settings captured when a durable write is admitted."""

    path: str
    max_bytes: int
    backup_count: int
    lock_timeout_seconds: float


_durable_write_context = threading.local()


def _snapshot_write_config() -> _LedgerWriteConfig:
    return _LedgerWriteConfig(
        path=EVENT_LEDGER_PATH,
        max_bytes=EVENT_LEDGER_MAX_BYTES,
        backup_count=EVENT_LEDGER_BACKUP_COUNT,
        lock_timeout_seconds=EVENT_LEDGER_LOCK_TIMEOUT_SECONDS,
    )


def _active_write_config() -> _LedgerWriteConfig:
    return getattr(_durable_write_context, "config", None) or _snapshot_write_config()


def _write_lock_for_path(path: str) -> threading.Lock:
    digest = hashlib.blake2b(os.fsencode(os.path.abspath(path)), digest_size=2).digest()
    return _WRITE_LOCK_STRIPES[int.from_bytes(digest, "big") % len(_WRITE_LOCK_STRIPES)]


def _record_durable_outcome(
    outcome: str,
    *,
    error: str | None = None,
    ledger_path: str | None = None,
) -> None:
    global _last_durable_success_at, _last_durable_success_path
    key = {
        "success": "writes_succeeded",
        "failure": "write_failures",
        "drop": "records_dropped",
    }.get(outcome)
    if key is None:
        raise ValueError(f"unknown durable ledger outcome: {outcome}")
    if ledger_path is None:
        ledger_path = _active_write_config().path
    ledger_path_sha256 = hashlib.sha256(
        os.fsencode(os.path.abspath(ledger_path))
    ).hexdigest()
    now_unix = time.time()
    now_iso = _now_iso()
    with _durable_health_lock:
        _durable_totals[key] += 1
        _durable_outcomes.append(
            {
                "outcome": outcome,
                "ts_unix": now_unix,
                "ts": now_iso,
                "error": error,
                "ledger_path_sha256": ledger_path_sha256,
            }
        )
        if outcome == "success":
            _last_durable_success_at = now_iso
            _last_durable_success_path = ledger_path


class _DurableWriteAdmission:
    """Bound both running and queued writes before touching an executor queue."""

    def __init__(self, capacity: int, workers: int) -> None:
        self.capacity = capacity
        self._slots = threading.BoundedSemaphore(capacity)
        self._executor = ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="cortex-event-ledger"
        )

    def submit(self, entry: Dict[str, Any]) -> Future[bool] | None:
        if not self._slots.acquire(blocking=False):
            return None
        config = _snapshot_write_config()

        def write_and_release() -> bool:
            previous_config = getattr(_durable_write_context, "config", None)
            _durable_write_context.config = config
            try:
                return _append_event(entry)
            finally:
                if previous_config is None:
                    del _durable_write_context.config
                else:
                    _durable_write_context.config = previous_config
                # BaseException and cancellation must never strand capacity.
                self._slots.release()

        try:
            return self._executor.submit(write_and_release)
        except BaseException:
            self._slots.release()
            raise


_durable_write_admission = _DurableWriteAdmission(
    EVENT_LEDGER_WRITE_CAPACITY, EVENT_LEDGER_WRITE_WORKERS
)


class _LedgerLockTimeout(TimeoutError):
    pass


def _open_directory_no_symlinks(directory: str) -> int:
    """Open/create an absolute directory chain without following symlinks."""

    absolute = os.path.abspath(directory or ".")
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    directory_fd = os.open(os.path.sep, flags)
    try:
        for component in (part for part in absolute.split(os.path.sep) if part):
            try:
                child_fd = os.open(component, flags, dir_fd=directory_fd)
            except FileNotFoundError:
                try:
                    os.mkdir(component, mode=0o700, dir_fd=directory_fd)
                    os.fsync(directory_fd)
                except FileExistsError:
                    pass
                child_fd = os.open(component, flags, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = child_fd
        return directory_fd
    except BaseException:
        os.close(directory_fd)
        raise


def _open_ledger_parent(path: str) -> tuple[int, str]:
    absolute = os.path.abspath(path)
    directory, ledger_name = os.path.split(absolute)
    if not ledger_name or ledger_name in {".", ".."}:
        raise ValueError(f"event ledger path must name a file: {path!r}")
    return _open_directory_no_symlinks(directory), ledger_name


def _require_regular_file(file_descriptor: int, path: str) -> os.stat_result:
    file_stat = os.fstat(file_descriptor)
    if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_nlink != 1:
        raise OSError(f"event ledger must be a singly-linked regular file: {path!r}")
    return file_stat


def _acquire_process_lock(
    directory_fd: int | None = None,
    ledger_name: str | None = None,
) -> int:
    """Acquire the stable sidecar lock without blocking a worker indefinitely."""
    config = _active_write_config()
    owns_directory_fd = directory_fd is None
    if directory_fd is None or ledger_name is None:
        directory_fd, ledger_name = _open_ledger_parent(config.path)
    lock_name = f"{ledger_name}.lock"
    flags = os.O_CREAT | os.O_RDWR
    flags |= getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    flags |= getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(lock_name, flags, 0o600, dir_fd=directory_fd)
    finally:
        if owns_directory_fd:
            os.close(directory_fd)
    lock_path = f"{config.path}.lock"
    try:
        _require_regular_file(fd, lock_path)
        os.fchmod(fd, 0o600)
    except BaseException:
        os.close(fd)
        raise
    deadline = time.monotonic() + config.lock_timeout_seconds
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except OSError as exc:
            if exc.errno not in (errno.EACCES, errno.EAGAIN):
                os.close(fd)
                raise
            if time.monotonic() >= deadline:
                os.close(fd)
                raise _LedgerLockTimeout(
                    f"timed out acquiring event ledger lock {lock_path!r}"
                ) from exc
            time.sleep(min(0.01, max(0.0, deadline - time.monotonic())))


def _release_process_lock(fd: int) -> None:
    try:
        fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append_event(entry: Dict[str, Any]) -> bool:
    owns_context = not hasattr(_durable_write_context, "config")
    if owns_context:
        _durable_write_context.config = _snapshot_write_config()
    try:
        config = _active_write_config()
        with _recent_events_lock:
            _recent_events.append(entry)

        try:
            line = json.dumps(entry, ensure_ascii=False)
            encoded_size = len((line + "\n").encode("utf-8"))
            # A single pathological record must not defeat the configured disk cap.
            # It remains available in the bounded in-memory window.
            if encoded_size > config.max_bytes:
                _record_durable_outcome("drop", error="record_exceeds_max_bytes")
                record_event_ledger_durable_write_drop()
                return False
            with _write_lock_for_path(config.path):
                directory_fd, ledger_name = _open_ledger_parent(config.path)
                try:
                    process_lock_fd = _acquire_process_lock(directory_fd, ledger_name)
                    try:
                        _reconcile_retained_generations(
                            directory_fd,
                            ledger_name,
                            config.backup_count,
                        )
                        try:
                            existing = os.stat(
                                ledger_name,
                                dir_fd=directory_fd,
                                follow_symlinks=False,
                            )
                        except FileNotFoundError:
                            existing = None
                        if existing is not None:
                            if not stat.S_ISREG(existing.st_mode) or existing.st_nlink != 1:
                                raise OSError(
                                    "event ledger must be a singly-linked regular file: "
                                    f"{config.path!r}"
                                )
                            if existing.st_size + encoded_size > config.max_bytes:
                                _rotate_ledger(directory_fd, ledger_name)

                        flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT
                        flags |= getattr(os, "O_CLOEXEC", 0)
                        flags |= getattr(os, "O_NOFOLLOW", 0)
                        flags |= getattr(os, "O_NONBLOCK", 0)
                        ledger_fd = os.open(
                            ledger_name,
                            flags,
                            0o600,
                            dir_fd=directory_fd,
                        )
                        try:
                            _require_regular_file(ledger_fd, config.path)
                            os.fchmod(ledger_fd, 0o600)
                            with os.fdopen(
                                ledger_fd,
                                "a",
                                encoding="utf-8",
                                closefd=False,
                            ) as ledger_file:
                                ledger_file.write(line + "\n")
                                ledger_file.flush()
                                os.fsync(ledger_file.fileno())
                        finally:
                            os.close(ledger_fd)
                        # Persist file creation and every rotation namespace
                        # mutation before reporting authoritative durability.
                        os.fsync(directory_fd)
                    finally:
                        _release_process_lock(process_lock_fd)
                finally:
                    os.close(directory_fd)
            _record_durable_outcome("success")
            return True
        except Exception as exc:
            safe_error = type(exc).__name__
            _record_durable_outcome("failure", error=safe_error)
            try:
                logger.warning("event_ledger_append_failed: %s", safe_error)
            except Exception:
                pass
            return False
    finally:
        if owns_context:
            del _durable_write_context.config


def _retain_event(entry: Dict[str, Any]) -> None:
    """Retain an event whose durable write could not be admitted."""
    with _recent_events_lock:
        _recent_events.append(entry)


def _rotate_ledger(directory_fd: int | None = None, ledger_name: str | None = None) -> None:
    """Rotate while holding both writer locks; os.replace makes each move atomic."""
    config = _active_write_config()
    owns_directory_fd = directory_fd is None
    if directory_fd is None or ledger_name is None:
        directory_fd, ledger_name = _open_ledger_parent(config.path)
    try:
        _rotate_ledger_at(directory_fd, ledger_name, config.backup_count)
    finally:
        if owns_directory_fd:
            os.close(directory_fd)


def _rotate_ledger_at(directory_fd: int, ledger_name: str, backup_count: int) -> None:
    if backup_count <= 0:
        try:
            os.unlink(ledger_name, dir_fd=directory_fd)
        except FileNotFoundError:
            pass
        return
    oldest = f"{ledger_name}.{backup_count}"
    try:
        os.unlink(oldest, dir_fd=directory_fd)
    except FileNotFoundError:
        pass
    for generation in range(backup_count - 1, 0, -1):
        source = f"{ledger_name}.{generation}"
        try:
            _secure_ledger_generation(directory_fd, source)
        except FileNotFoundError:
            continue
        os.replace(
            source,
            f"{ledger_name}.{generation + 1}",
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
        )
    try:
        _secure_ledger_generation(directory_fd, ledger_name)
    except FileNotFoundError:
        return
    os.replace(
        ledger_name,
        f"{ledger_name}.1",
        src_dir_fd=directory_fd,
        dst_dir_fd=directory_fd,
    )


def _secure_ledger_generation(directory_fd: int, name: str) -> None:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    flags |= getattr(os, "O_NONBLOCK", 0)
    generation_fd = os.open(name, flags, dir_fd=directory_fd)
    try:
        generation_stat = _require_regular_file(generation_fd, name)
        if stat.S_IMODE(generation_stat.st_mode) != 0o600:
            os.fchmod(generation_fd, 0o600)
            os.fsync(generation_fd)
    finally:
        os.close(generation_fd)


def _reconcile_retained_generations(
    directory_fd: int,
    ledger_name: str,
    backup_count: int,
) -> None:
    prefix = f"{ledger_name}."
    scanned = 0
    with os.scandir(directory_fd) as entries:
        for entry in entries:
            scanned += 1
            if scanned > EVENT_LEDGER_DIRECTORY_SCAN_LIMIT:
                raise OSError(
                    "event ledger directory exceeds bounded audit limit "
                    f"{EVENT_LEDGER_DIRECTORY_SCAN_LIMIT}"
                )
            if not entry.name.startswith(prefix):
                continue
            suffix = entry.name[len(prefix):]
            if not suffix.isdigit():
                continue
            generation = int(suffix)
            if generation <= 0 or suffix != str(generation) or generation > backup_count:
                try:
                    os.unlink(entry.name, dir_fd=directory_fd)
                except FileNotFoundError:
                    pass
                continue
            try:
                _secure_ledger_generation(directory_fd, entry.name)
            except FileNotFoundError:
                continue


EVENT_LEDGER_MAX_QUERY_CHARS = _positive_int_env("CORTEX_EVENT_LEDGER_MAX_QUERY_CHARS", 8192)
EVENT_LEDGER_MAX_QUERY_FIELDS = _positive_int_env("CORTEX_EVENT_LEDGER_MAX_QUERY_FIELDS", 64)
_QUERY_LIMIT_MARKER = "[TRUNCATED]"
_QUERY_REDACTION_MARKER = "[REDACTED]"
_MAX_NESTED_URL_DEPTH = 4
_PATH_REDACTION_MARKER = "[REDACTED]"
_MAX_EVENT_PATH_CHARS = 2048
_SAFE_STATIC_PATH_SEGMENT = re.compile(r"[A-Za-z_-]{1,48}")
_SAFE_API_VERSION_SEGMENT = re.compile(r"v[0-9]{1,3}", re.IGNORECASE)
_SENSITIVE_PATH_HINT = re.compile(
    r"(?:auth|bearer|credential|password|patient|secret|session|signature|token)",
    re.IGNORECASE,
)


def _is_sensitive_query_key(key: str) -> bool:
    return is_sensitive_query_key(key)


def _sanitize_url_value(value: str, depth: int) -> str:
    """Redact credentials in the query component of a URL-valued parameter."""
    return redact_url_query_value(
        value,
        depth=depth,
        max_chars=EVENT_LEDGER_MAX_QUERY_CHARS,
        max_fields=EVENT_LEDGER_MAX_QUERY_FIELDS,
        max_depth=_MAX_NESTED_URL_DEPTH,
        marker=_QUERY_REDACTION_MARKER,
    )


def _sanitize_query(query: str, depth: int = 0) -> str:
    return redact_query_string(
        query,
        depth=depth,
        max_chars=EVENT_LEDGER_MAX_QUERY_CHARS,
        max_fields=EVENT_LEDGER_MAX_QUERY_FIELDS,
        max_depth=_MAX_NESTED_URL_DEPTH,
        marker=_QUERY_REDACTION_MARKER,
        limit_marker=_QUERY_LIMIT_MARKER,
    )


def _safe_query(query: str) -> str:
    """Keep useful query metadata without doing unbounded parsing on the event loop."""
    return _sanitize_query(query)


def _safe_request_path(request: Request, fallback_path: str) -> str:
    """Prefer a trusted route template and bound/redact an unmatched raw path."""

    route = request.scope.get("route")
    route_path = getattr(route, "path", None)
    if (
        isinstance(route_path, str)
        and route_path.startswith("/")
        and len(route_path) <= _MAX_EVENT_PATH_CHARS
        and "?" not in route_path
        and "#" not in route_path
        and not any(ord(character) < 0x20 for character in route_path)
    ):
        return route_path

    raw_path = str(fallback_path or "/")
    if len(raw_path) > _MAX_EVENT_PATH_CHARS:
        return "/" + _PATH_REDACTION_MARKER

    safe_segments = []
    for raw_segment in raw_path.split("/"):
        if not raw_segment:
            safe_segments.append("")
            continue
        decoded = unquote(raw_segment)
        redacted = redact_sensitive_text(decoded, max_chars=96)
        if (
            redacted != decoded.replace("\x00", "")
            or _SENSITIVE_PATH_HINT.search(decoded)
            or not (
                _SAFE_STATIC_PATH_SEGMENT.fullmatch(decoded)
                or _SAFE_API_VERSION_SEGMENT.fullmatch(decoded)
            )
        ):
            safe_segments.append(_PATH_REDACTION_MARKER)
        else:
            safe_segments.append(decoded)
    safe_path = "/".join(safe_segments)
    return safe_path if safe_path.startswith("/") else "/" + safe_path


def get_recent_events(seconds: int = 300, limit: int = 200) -> List[Dict[str, Any]]:
    """Fast in-memory recent events window."""
    cutoff = time.time() - max(1, int(seconds))
    # Keep the critical section independent of filtering/sorting work so worker
    # appends and event-loop health reads cannot hold one another up.
    with _recent_events_lock:
        snapshot = list(_recent_events)
    out = [e for e in snapshot if float(e.get("ts_unix", 0)) >= cutoff]
    return out[-max(1, int(limit)):]


def get_event_health(seconds: int = 300) -> Dict[str, Any]:
    events = get_recent_events(seconds=seconds, limit=100000)
    total = len(events)
    if total == 0:
        event_health = {
            "window_seconds": int(seconds),
            "total": 0,
            "success_rate": None,
            "error_rate": None,
            "avg_latency_ms": 0,
            "p95_latency_ms": 0,
        }
    else:
        latencies = sorted(int(e.get("latency_ms", 0) or 0) for e in events)
        errors = sum(1 for e in events if int(e.get("status_code", 0) or 0) >= 400)

        def _p95(vals: List[int]) -> int:
            if not vals:
                return 0
            idx = max(0, min(len(vals) - 1, int(round(0.95 * (len(vals) - 1)))))
            return int(vals[idx])

        avg_latency = int(sum(latencies) / len(latencies)) if latencies else 0
        event_health = {
            "window_seconds": int(seconds),
            "total": total,
            "success_rate": round((total - errors) / total, 4),
            "error_rate": round(errors / total, 4),
            "avg_latency_ms": avg_latency,
            "p95_latency_ms": _p95(latencies),
        }

    cutoff = time.time() - max(1, int(seconds))
    ledger_path = EVENT_LEDGER_PATH
    ledger_path_sha256 = hashlib.sha256(
        os.fsencode(os.path.abspath(ledger_path))
    ).hexdigest()
    with _durable_health_lock:
        path_outcomes = [
            row
            for row in _durable_outcomes
            if row.get("ledger_path_sha256") == ledger_path_sha256
        ]
        outcomes = [
            row
            for row in path_outcomes
            if float(row.get("ts_unix", 0) or 0) >= cutoff
        ]
        totals = dict(_durable_totals)
        if _last_durable_success_path == ledger_path:
            last_success_at = _last_durable_success_at
        else:
            last_success_at = next(
                (
                    row.get("ts")
                    for row in reversed(path_outcomes)
                    if row.get("outcome") == "success"
                ),
                None,
            )
    writes_succeeded = sum(1 for row in outcomes if row.get("outcome") == "success")
    write_failures = sum(1 for row in outcomes if row.get("outcome") == "failure")
    records_dropped = sum(1 for row in outcomes if row.get("outcome") == "drop")
    durable_samples = writes_succeeded + write_failures + records_dropped
    durable_status = "unknown" if durable_samples == 0 else "healthy" if write_failures == 0 and records_dropped == 0 else "degraded"
    return {
        **event_health,
        "status": durable_status,
        "durable": {
            "status": durable_status,
            "sample_count": durable_samples,
            "writes_succeeded": writes_succeeded,
            "write_failures": write_failures,
            "records_dropped": records_dropped,
            "last_success_at": last_success_at,
            "lifetime": totals,
            "recent_errors": [str(row.get("error") or "") for row in outcomes if row.get("outcome") != "success"][-10:],
        },
    }


def probe_event_ledger_durability() -> Dict[str, Any]:
    """Perform an active fsynced write and report authoritative ledger readiness."""

    ok = _append_event(
        {
            "event_id": f"readiness-{uuid.uuid4().hex[:16]}",
            "ts": _now_iso(),
            "ts_unix": time.time(),
            "method": "PROBE",
            "path": "/ready",
            "status_code": 200,
            "latency_ms": 0,
            "success": True,
            "event_type": "durability_readiness_probe",
        }
    )
    with _durable_health_lock:
        after = dict(_durable_totals)
        last_success_at = (
            _last_durable_success_at
            if _last_durable_success_path == EVENT_LEDGER_PATH
            else None
        )
    return {
        "ok": ok,
        "status": "healthy" if ok else "degraded",
        "lastSuccessAt": last_success_at,
        "writeFailures": after["write_failures"],
        "recordsDropped": after["records_dropped"],
    }


class EventLedgerMiddleware(BaseHTTPMiddleware):
    """Write request/response metadata to a JSONL event ledger."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path or "/"
        if (
            not EVENT_LEDGER_INCLUDE_DOCS
            and (path.startswith("/docs") or path.startswith("/redoc") or path.startswith("/openapi"))
        ):
            return await call_next(request)

        start = time.perf_counter()
        event_id = uuid.uuid4().hex[:16]
        response = None
        status_code = 500
        error_name = None
        application_error: BaseException | None = None
        request_task = asyncio.current_task()

        try:
            response = await call_next(request)
            status_code = int(getattr(response, "status_code", 500) or 500)
        except BaseException as exc:
            application_error = exc
            error_name = type(exc).__name__
            raise
        finally:
            telemetry_cancellations = (
                request_task.cancelling() if request_task is not None else 0
            )
            try:
                latency_ms = int((time.perf_counter() - start) * 1000)
                levels = getattr(request.state, "activated_levels", []) or []
                has_explicit = any(
                    not bool(level.get("derived_from"))
                    for level in levels
                    if isinstance(level, dict)
                )

                entry = {
                    "event_id": event_id,
                    "ts": _now_iso(),
                    "ts_unix": time.time(),
                    "method": request.method,
                    "path": _safe_request_path(request, path),
                    "query": _safe_query(str(request.url.query or "")),
                    "status_code": status_code,
                    "latency_ms": latency_ms,
                    "success": status_code < 400,
                    "request_id": getattr(request.state, "request_id", None),
                    "lane": getattr(request.state, "lane", None),
                    "activation_count": len(levels),
                    "activation_has_explicit": bool(has_explicit),
                    "client": request.client.host if request.client else None,
                    "error": error_name,
                }
                durable_write = _durable_write_admission.submit(entry)
                if durable_write is None:
                    _retain_event(entry)
                    _record_durable_outcome("drop", error="write_capacity_exhausted")
                    record_event_ledger_durable_write_drop()
                elif EVENT_LEDGER_TELEMETRY_DEADLINE_SECONDS > 0:
                    try:
                        await asyncio.wait_for(
                            asyncio.shield(asyncio.wrap_future(durable_write)),
                            timeout=EVENT_LEDGER_TELEMETRY_DEADLINE_SECONDS,
                        )
                    except asyncio.TimeoutError:
                        pass
            except BaseException as exc:  # also protect against replaced/test writers
                safe_error = type(exc).__name__
                _record_durable_outcome("failure", error=safe_error)
                try:
                    logger.warning("event_ledger_append_failed: %s", safe_error)
                except BaseException:
                    pass
                # Telemetry must never replace an application result. A
                # CancelledError only belongs to the caller when cancellation
                # was actually requested for this dispatch task; telemetry
                # implementations can themselves raise BaseException.
                if (
                    application_error is None
                    and isinstance(exc, asyncio.CancelledError)
                    and request_task is not None
                    and request_task.cancelling() > telemetry_cancellations
                ):
                    raise

            if response is not None:
                try:
                    response.headers.setdefault("x-cortex-event-id", event_id)
                except Exception:
                    pass

        return response
