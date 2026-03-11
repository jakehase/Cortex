"""
Event Ledger Middleware (One Nervous System)

Records every request/response turn into a durable JSONL ledger so the system
can reason about itself over time.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from typing import Any, Deque, Dict, List

import json
import logging
import os
import threading
import time
import uuid

logger = logging.getLogger(__name__)

EVENT_LEDGER_PATH = os.getenv("CORTEX_EVENT_LEDGER_PATH", "/app/logs/cortex_event_ledger.jsonl")
EVENT_LEDGER_MAX_IN_MEMORY = max(1000, int(os.getenv("CORTEX_EVENT_LEDGER_MAX_IN_MEMORY", "20000")))
EVENT_LEDGER_INCLUDE_DOCS = os.getenv("CORTEX_EVENT_LEDGER_INCLUDE_DOCS", "false").lower() in {"1", "true", "yes", "on"}

_recent_events: Deque[Dict[str, Any]] = deque(maxlen=EVENT_LEDGER_MAX_IN_MEMORY)
_write_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append_event(entry: Dict[str, Any]) -> None:
    _recent_events.append(entry)

    try:
        os.makedirs(os.path.dirname(EVENT_LEDGER_PATH), exist_ok=True)
        line = json.dumps(entry, ensure_ascii=False)
        with _write_lock:
            with open(EVENT_LEDGER_PATH, "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception as exc:
        logger.warning("event_ledger_append_failed: %s", exc)


def get_recent_events(seconds: int = 300, limit: int = 200) -> List[Dict[str, Any]]:
    """Fast in-memory recent events window."""
    cutoff = time.time() - max(1, int(seconds))
    out = [e for e in _recent_events if float(e.get("ts_unix", 0)) >= cutoff]
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

        try:
            response = await call_next(request)
            status_code = int(getattr(response, "status_code", 500) or 500)
            error_name = None
        except Exception as exc:
            response = None
            status_code = 500
            error_name = type(exc).__name__
            raise
        finally:
            latency_ms = int((time.perf_counter() - start) * 1000)
            levels = getattr(request.state, "activated_levels", []) or []
            has_explicit = any(not bool(l.get("derived_from")) for l in levels if isinstance(l, dict))

            entry = {
                "event_id": event_id,
                "ts": _now_iso(),
                "ts_unix": time.time(),
                "method": request.method,
                "path": path,
                "query": str(request.url.query or ""),
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
            _append_event(entry)

            if response is not None:
                try:
                    response.headers.setdefault("x-cortex-event-id", event_id)
                except Exception:
                    pass

        return response
