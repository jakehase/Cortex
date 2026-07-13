"""
Event Ledger Middleware (One Nervous System)

Records every request/response turn into a durable JSONL ledger so the system
can reason about itself over time.
"""

from __future__ import annotations

from collections import deque
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from typing import Any, Deque, Dict, List
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import asyncio
import errno
import fcntl
import json
import logging
import os
import threading
import time
import uuid

from cortex_server.modules.metrics_store import record_event_ledger_durable_write_drop

logger = logging.getLogger(__name__)


EVENT_LEDGER_MIN_BYTES = 1024


def _positive_int_env(name: str, default: int, minimum: int = 1) -> int:
    """Parse a resource bound, clamping non-positive values but rejecting garbage."""
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"{name} must be an integer, got {raw!r}") from exc
    return max(minimum, value)


EVENT_LEDGER_PATH = os.getenv("CORTEX_EVENT_LEDGER_PATH", "/app/logs/cortex_event_ledger.jsonl")
EVENT_LEDGER_MAX_IN_MEMORY = max(1000, int(os.getenv("CORTEX_EVENT_LEDGER_MAX_IN_MEMORY", "20000")))
EVENT_LEDGER_INCLUDE_DOCS = os.getenv("CORTEX_EVENT_LEDGER_INCLUDE_DOCS", "false").lower() in {"1", "true", "yes", "on"}
EVENT_LEDGER_MAX_BYTES = _positive_int_env(
    "CORTEX_EVENT_LEDGER_MAX_BYTES", 10485760, EVENT_LEDGER_MIN_BYTES
)
EVENT_LEDGER_BACKUP_COUNT = max(0, int(os.getenv("CORTEX_EVENT_LEDGER_BACKUP_COUNT", "3")))
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
_write_lock = threading.Lock()


class _DurableWriteAdmission:
    """Bound both running and queued writes before touching an executor queue."""

    def __init__(self, capacity: int, workers: int) -> None:
        self.capacity = capacity
        self._slots = threading.BoundedSemaphore(capacity)
        self._executor = ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="cortex-event-ledger"
        )

    def submit(self, entry: Dict[str, Any]) -> Future[None] | None:
        if not self._slots.acquire(blocking=False):
            return None

        def write_and_release() -> None:
            try:
                _append_event(entry)
            finally:
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


def _acquire_process_lock() -> int:
    """Acquire the stable sidecar lock without blocking a worker indefinitely."""
    lock_path = f"{EVENT_LEDGER_PATH}.lock"
    flags = os.O_CREAT | os.O_RDWR
    flags |= getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(lock_path, flags, 0o600)
    deadline = time.monotonic() + EVENT_LEDGER_LOCK_TIMEOUT_SECONDS
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


def _append_event(entry: Dict[str, Any]) -> None:
    with _recent_events_lock:
        _recent_events.append(entry)

    try:
        line = json.dumps(entry, ensure_ascii=False)
        encoded_size = len((line + "\n").encode("utf-8"))
        # A single pathological record must not defeat the configured disk cap.
        # It remains available in the bounded in-memory window.
        if encoded_size > EVENT_LEDGER_MAX_BYTES:
            return
        with _write_lock:
            directory = os.path.dirname(EVENT_LEDGER_PATH)
            if directory:
                os.makedirs(directory, exist_ok=True)
            process_lock_fd = _acquire_process_lock()
            try:
                if (
                    os.path.exists(EVENT_LEDGER_PATH)
                    and os.path.getsize(EVENT_LEDGER_PATH) + encoded_size > EVENT_LEDGER_MAX_BYTES
                ):
                    _rotate_ledger()
                with open(EVENT_LEDGER_PATH, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
            finally:
                _release_process_lock(process_lock_fd)
    except Exception as exc:
        try:
            logger.warning("event_ledger_append_failed: %s", exc)
        except Exception:
            pass


def _retain_event(entry: Dict[str, Any]) -> None:
    """Retain an event whose durable write could not be admitted."""
    with _recent_events_lock:
        _recent_events.append(entry)


def _rotate_ledger() -> None:
    """Rotate while holding both writer locks; os.replace makes each move atomic."""
    if EVENT_LEDGER_BACKUP_COUNT <= 0:
        try:
            os.remove(EVENT_LEDGER_PATH)
        except FileNotFoundError:
            pass
        return
    oldest = f"{EVENT_LEDGER_PATH}.{EVENT_LEDGER_BACKUP_COUNT}"
    try:
        os.remove(oldest)
    except FileNotFoundError:
        pass
    for generation in range(EVENT_LEDGER_BACKUP_COUNT - 1, 0, -1):
        source = f"{EVENT_LEDGER_PATH}.{generation}"
        if os.path.exists(source):
            os.replace(source, f"{EVENT_LEDGER_PATH}.{generation + 1}")
    if os.path.exists(EVENT_LEDGER_PATH):
        os.replace(EVENT_LEDGER_PATH, f"{EVENT_LEDGER_PATH}.1")


_SENSITIVE_QUERY_PARTS = (
    "token", "secret", "password", "signature", "credential", "api_key", "apikey", "key", "auth",
)
EVENT_LEDGER_MAX_QUERY_CHARS = _positive_int_env("CORTEX_EVENT_LEDGER_MAX_QUERY_CHARS", 8192)
EVENT_LEDGER_MAX_QUERY_FIELDS = _positive_int_env("CORTEX_EVENT_LEDGER_MAX_QUERY_FIELDS", 64)
_QUERY_LIMIT_MARKER = "[TRUNCATED]"
_QUERY_REDACTION_MARKER = "[REDACTED]"
_MAX_NESTED_URL_DEPTH = 4


def _is_sensitive_query_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return normalized == "sig" or any(part in normalized for part in _SENSITIVE_QUERY_PARTS)


def _sanitize_url_value(value: str, depth: int) -> str:
    """Redact credentials in the query component of a URL-valued parameter."""
    if not (value.lower().startswith(("http://", "https://")) or value.startswith("//")):
        return value
    try:
        parsed = urlsplit(value)
    except ValueError:
        # A URL-like value that cannot be safely parsed is not useful telemetry.
        return _QUERY_REDACTION_MARKER
    if not parsed.query:
        return value
    if depth >= _MAX_NESTED_URL_DEPTH:
        return _QUERY_REDACTION_MARKER
    if (
        len(parsed.query) > EVENT_LEDGER_MAX_QUERY_CHARS
        or parsed.query.count("&") + 1 > EVENT_LEDGER_MAX_QUERY_FIELDS
    ):
        return _QUERY_REDACTION_MARKER
    query = _sanitize_query(parsed.query, depth + 1)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment))


def _sanitize_query(query: str, depth: int = 0) -> str:
    pairs = []
    for key, value in parse_qsl(
        query, keep_blank_values=True, max_num_fields=EVENT_LEDGER_MAX_QUERY_FIELDS
    ):
        if _is_sensitive_query_key(key):
            value = _QUERY_REDACTION_MARKER
        else:
            value = _sanitize_url_value(value, depth)
        pairs.append((key, value))
    return urlencode(pairs)


def _safe_query(query: str) -> str:
    """Keep useful query metadata without doing unbounded parsing on the event loop."""
    if not query:
        return ""
    if len(query) > EVENT_LEDGER_MAX_QUERY_CHARS or query.count("&") + 1 > EVENT_LEDGER_MAX_QUERY_FIELDS:
        return _QUERY_LIMIT_MARKER
    return _sanitize_query(query)


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
        return {
            "window_seconds": int(seconds),
            "total": 0,
            "success_rate": 1.0,
            "error_rate": 0.0,
            "avg_latency_ms": 0,
            "p95_latency_ms": 0,
        }

    latencies = sorted(int(e.get("latency_ms", 0) or 0) for e in events)
    errors = sum(1 for e in events if int(e.get("status_code", 0) or 0) >= 400)

    def _p95(vals: List[int]) -> int:
        if not vals:
            return 0
        idx = max(0, min(len(vals) - 1, int(round(0.95 * (len(vals) - 1)))))
        return int(vals[idx])

    avg_latency = int(sum(latencies) / len(latencies)) if latencies else 0

    return {
        "window_seconds": int(seconds),
        "total": total,
        "success_rate": round((total - errors) / total, 4),
        "error_rate": round(errors / total, 4),
        "avg_latency_ms": avg_latency,
        "p95_latency_ms": _p95(latencies),
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

        try:
            response = await call_next(request)
            status_code = int(getattr(response, "status_code", 500) or 500)
        except BaseException as exc:
            application_error = exc
            error_name = type(exc).__name__
            raise
        finally:
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
                    "path": path,
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
                try:
                    logger.warning("event_ledger_append_failed: %s", exc)
                except BaseException:
                    pass
                # Telemetry must not replace an application failure already in
                # flight, but cancellation during telemetry on a successful
                # request still belongs to the caller and must propagate.
                if application_error is None and not isinstance(exc, Exception):
                    raise

            if response is not None:
                try:
                    response.headers.setdefault("x-cortex-event-id", event_id)
                except Exception:
                    pass

        return response
