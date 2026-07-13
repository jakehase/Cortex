"""Lightweight in-process metrics for Cortex HTTP observability."""
from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime, timezone
import os
import threading

_LOCK = threading.Lock()
_STARTED_AT = datetime.now(timezone.utc).isoformat()

_REQUEST_TOTAL = 0
_ROUTE_TOTAL = defaultdict(int)
_METHOD_TOTAL = defaultdict(int)
_STATUS_TOTAL = defaultdict(int)
_ROUTE_LATENCY_SUM_MS = defaultdict(float)
_ROUTE_LATENCY_MAX_MS = defaultdict(float)
_RECENT = deque(maxlen=2000)
_EVENT_LEDGER_DURABLE_WRITE_DROPS = 0
_MAX_ROUTES = max(1, int(os.getenv("CORTEX_METRICS_MAX_ROUTES", "200")))
_FALLBACK_ROUTE = "<unmatched>"
_OVERFLOW_ROUTE = "<other>"
_MAX_ROUTE_LABEL_LENGTH = 512
_STANDARD_HTTP_METHODS = frozenset(
    {"GET", "HEAD", "POST", "PUT", "DELETE", "CONNECT", "OPTIONS", "TRACE", "PATCH"}
)
_FALLBACK_METHOD = "OTHER"
_FALLBACK_STATUS = "OTHER"


def _bounded_route(path: str) -> str:
    """Return an existing/new route key without allowing unbounded growth."""
    candidate = str(path or _FALLBACK_ROUTE).split("?", 1)[0]
    if not candidate or len(candidate) > _MAX_ROUTE_LABEL_LENGTH:
        candidate = _FALLBACK_ROUTE
    if candidate in _ROUTE_TOTAL:
        return candidate
    # Reserve one of the bounded slots for all excess/unmatched direct callers.
    if len(_ROUTE_TOTAL) < max(0, _MAX_ROUTES - 1):
        return candidate
    return _OVERFLOW_ROUTE


def _escape_label(value: str) -> str:
    """Escape Prometheus label text, including newline injection."""
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _bounded_method(method: str) -> str:
    """Map request-controlled method text onto a fixed label set."""
    candidate = str(method or "GET").upper()
    return candidate if candidate in _STANDARD_HTTP_METHODS else _FALLBACK_METHOD


def _bounded_status(status: object) -> tuple[str, int | object]:
    """Preserve standard HTTP codes and collapse all other values to one label."""
    if type(status) is int and 100 <= status <= 599:
        return str(status), status
    return _FALLBACK_STATUS, status


def record_http_request(path: str, method: str, status: int, latency_ms: float, request_id: str = "") -> None:
    method = _bounded_method(method)
    status_label, status = _bounded_status(status)
    latency_ms = float(latency_ms or 0.0)

    with _LOCK:
        path = _bounded_route(path)
        global _REQUEST_TOTAL
        _REQUEST_TOTAL += 1
        _ROUTE_TOTAL[path] += 1
        _METHOD_TOTAL[method] += 1
        _STATUS_TOTAL[status_label] += 1
        _ROUTE_LATENCY_SUM_MS[path] += latency_ms
        if latency_ms > _ROUTE_LATENCY_MAX_MS[path]:
            _ROUTE_LATENCY_MAX_MS[path] = latency_ms
        _RECENT.append(
            {
                "ts": datetime.now(timezone.utc).isoformat(),
                "path": path,
                "method": method,
                "status": status,
                "latency_ms": round(latency_ms, 2),
                "request_id": request_id,
            }
        )


def record_event_ledger_durable_write_drop() -> None:
    """Count capacity drops without accepting request-controlled labels."""
    with _LOCK:
        global _EVENT_LEDGER_DURABLE_WRITE_DROPS
        _EVENT_LEDGER_DURABLE_WRITE_DROPS += 1


def snapshot_metrics() -> dict:
    with _LOCK:
        top_routes = sorted(_ROUTE_TOTAL.items(), key=lambda kv: kv[1], reverse=True)[:20]
        route_latency_avg = {}
        route_latency_max = {}
        for route, count in top_routes:
            if count <= 0:
                continue
            route_latency_avg[route] = round(_ROUTE_LATENCY_SUM_MS[route] / count, 2)
            route_latency_max[route] = round(_ROUTE_LATENCY_MAX_MS[route], 2)

        return {
            "started_at": _STARTED_AT,
            "requests_total": _REQUEST_TOTAL,
            "event_ledger_durable_write_drops_total": _EVENT_LEDGER_DURABLE_WRITE_DROPS,
            "methods": dict(_METHOD_TOTAL),
            "status_codes": dict(_STATUS_TOTAL),
            "top_routes": [{"path": p, "count": c} for p, c in top_routes],
            "route_latency_avg_ms": route_latency_avg,
            "route_latency_max_ms": route_latency_max,
            "recent": list(_RECENT)[-50:],
        }


def render_prometheus() -> str:
    with _LOCK:
        lines = [
            "# HELP cortex_http_requests_total Total HTTP requests",
            "# TYPE cortex_http_requests_total counter",
            f"cortex_http_requests_total {_REQUEST_TOTAL}",
            "# HELP cortex_event_ledger_durable_write_drops_total Durable event ledger writes dropped at capacity",
            "# TYPE cortex_event_ledger_durable_write_drops_total counter",
            f'cortex_event_ledger_durable_write_drops_total{{reason="capacity"}} {_EVENT_LEDGER_DURABLE_WRITE_DROPS}',
            "# HELP cortex_http_requests_by_method Total HTTP requests by method",
            "# TYPE cortex_http_requests_by_method counter",
        ]

        for method, count in sorted(_METHOD_TOTAL.items()):
            lines.append(f'cortex_http_requests_by_method{{method="{method}"}} {count}')

        lines.extend(
            [
                "# HELP cortex_http_requests_by_status Total HTTP requests by status code",
                "# TYPE cortex_http_requests_by_status counter",
            ]
        )
        for status, count in sorted(_STATUS_TOTAL.items()):
            lines.append(f'cortex_http_requests_by_status{{status="{status}"}} {count}')

        lines.extend(
            [
                "# HELP cortex_http_route_requests_total HTTP requests by path",
                "# TYPE cortex_http_route_requests_total counter",
            ]
        )
        for path, count in sorted(_ROUTE_TOTAL.items()):
            safe_path = _escape_label(path)
            lines.append(f'cortex_http_route_requests_total{{path="{safe_path}"}} {count}')

        lines.extend(
            [
                "# HELP cortex_http_route_latency_avg_ms Average route latency in ms",
                "# TYPE cortex_http_route_latency_avg_ms gauge",
                "# HELP cortex_http_route_latency_max_ms Max route latency in ms",
                "# TYPE cortex_http_route_latency_max_ms gauge",
            ]
        )
        for path, count in sorted(_ROUTE_TOTAL.items()):
            if count <= 0:
                continue
            safe_path = _escape_label(path)
            avg = _ROUTE_LATENCY_SUM_MS[path] / count
            mx = _ROUTE_LATENCY_MAX_MS[path]
            lines.append(f'cortex_http_route_latency_avg_ms{{path="{safe_path}"}} {avg:.2f}')
            lines.append(f'cortex_http_route_latency_max_ms{{path="{safe_path}"}} {mx:.2f}')

        return "\n".join(lines) + "\n"
