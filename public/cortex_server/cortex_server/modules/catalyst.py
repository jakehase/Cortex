"""Level 11: Catalyst - measured performance profiling and bottleneck analysis.

Everything reported here is measured inside the running process:

* per-route request counts, latency percentiles and server-error rates from
  the observability ring in ``modules.metrics_store`` (bounded, since boot);
* host and process telemetry from L1 Kernel (``/proc``, ``statvfs``);
* event-loop scheduling lag (a timed ``asyncio.sleep``);
* blocking-offload admission state (``modules.async_offload``);
* dependency breaker state (``modules.route_health``, read without mutation).

Bottlenecks are ranked by explicit deterministic rules with the evidence
numbers attached. Catalyst does not apply optimizations: any recommendation is
advice, and nothing here claims something was "optimized".
"""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

SCHEMA_VERSION = "cortex.catalyst.profile.v1"
_STATE = {"analyses_run": 0, "profiles_run": 0, "started_at": datetime.now(timezone.utc).isoformat()}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def thresholds() -> Dict[str, float]:
    return {
        "p95_slo_ms": _env_float("CORTEX_CATALYST_P95_SLO_MS", 1500.0),
        "min_samples": 5.0,
        "error_rate": 0.05,
        "min_error_samples": 10.0,
        "offload_saturation": 0.8,
        "event_loop_lag_ms": 100.0,
        "cpu_util_pct": 90.0,
        "mem_available_pct": 10.0,
        "disk_used_pct": 90.0,
    }


def _percentile(sorted_values: List[float], fraction: float) -> Optional[float]:
    if not sorted_values:
        return None
    index = max(0, min(len(sorted_values) - 1, int(round(fraction * (len(sorted_values) - 1)))))
    return round(sorted_values[index], 2)


def _recent_requests() -> List[Dict[str, Any]]:
    from cortex_server.modules.level_probe import _recent_requests as ring

    return ring()


def route_statistics(*, route: Optional[str] = None, window_s: Optional[float] = None) -> Dict[str, Dict[str, Any]]:
    """Latency/error statistics per route template from the observability ring."""

    cutoff: Optional[float] = None
    if window_s is not None and window_s > 0:
        cutoff = time.time() - float(window_s)
    grouped: Dict[str, Dict[str, Any]] = {}
    for row in _recent_requests():
        path = str(row.get("path") or "")
        if route is not None and path != route:
            continue
        if cutoff is not None:
            ts = row.get("ts")
            try:
                observed = datetime.fromisoformat(str(ts)).timestamp()
            except (TypeError, ValueError):
                continue
            if observed < cutoff:
                continue
        item = grouped.setdefault(path, {"latencies": [], "server_errors": 0, "client_errors": 0})
        latency = row.get("latency_ms")
        if isinstance(latency, (int, float)) and not isinstance(latency, bool):
            item["latencies"].append(float(latency))
        status = row.get("status")
        if isinstance(status, int):
            if status >= 500:
                item["server_errors"] += 1
            elif status >= 400:
                item["client_errors"] += 1
    stats: Dict[str, Dict[str, Any]] = {}
    for path, item in grouped.items():
        values = sorted(item["latencies"])
        count = len(values)
        stats[path] = {
            "route": path,
            "count": count,
            "p50_ms": _percentile(values, 0.50),
            "p95_ms": _percentile(values, 0.95),
            "max_ms": round(values[-1], 2) if values else None,
            "server_errors": item["server_errors"],
            "client_errors": item["client_errors"],
            "error_rate": round(item["server_errors"] / count, 4) if count else None,
        }
    return stats


async def event_loop_lag_ms(sample_s: float = 0.01) -> float:
    loop = asyncio.get_running_loop()
    started = loop.time()
    await asyncio.sleep(sample_s)
    return round(max(0.0, (loop.time() - started - sample_s) * 1000.0), 2)


def _offload_status() -> Optional[Dict[str, Any]]:
    try:
        from cortex_server.modules.async_offload import blocking_operation_status

        return blocking_operation_status()
    except Exception:
        return None


def _dependency_state() -> Optional[Dict[str, Any]]:
    """Read breaker state without triggering persistence side effects."""

    try:
        from cortex_server.modules.route_health import get_route_health_monitor

        monitor = get_route_health_monitor()
        deps = dict((monitor.state or {}).get("dependencies") or {})
    except Exception:
        return None
    now = time.time()
    out: Dict[str, Any] = {}
    for name, row in deps.items():
        if not isinstance(row, dict):
            continue
        state = str(row.get("state") or "closed")
        if state == "open" and float(row.get("breaker_open_until") or 0.0) <= now:
            state = "half_open"
        out[str(name)] = {
            "state": state,
            "consecutive_failures": int(row.get("consecutive_failures") or 0),
            "latency_ema_ms": row.get("latency_ema_ms"),
        }
    return out


async def snapshot() -> Dict[str, Any]:
    """Measured performance snapshot of the running process."""

    from cortex_server.modules.kernel import get_kernel, summarise_metrics

    try:
        metrics = await asyncio.to_thread(get_kernel().metrics)
        host = summarise_metrics(metrics)
        host_error = None
    except Exception as exc:
        host, host_error = None, type(exc).__name__
    lag = await event_loop_lag_ms()
    routes = route_statistics()
    ring_size = sum(row["count"] for row in routes.values())
    return {
        "schemaVersion": SCHEMA_VERSION,
        "measured_at": datetime.now(timezone.utc).isoformat(),
        "window": "since_boot_bounded_ring",
        "samples": ring_size,
        "host": host,
        "host_error": host_error,
        "event_loop_lag_ms": lag,
        "offload": _offload_status(),
        "dependencies": _dependency_state(),
        "routes": sorted(routes.values(), key=lambda r: (r["p95_ms"] or 0.0), reverse=True)[:25],
    }


def bottlenecks(snap: Dict[str, Any], *, focus: Optional[str] = None) -> List[Dict[str, Any]]:
    """Deterministic, evidence-carrying bottleneck rules over a snapshot."""

    limits = thresholds()
    findings: List[Dict[str, Any]] = []

    def add(rule: str, severity: str, value: Any, threshold: Any, **extra: Any) -> None:
        ratio = None
        try:
            ratio = round(float(value) / float(threshold), 3) if float(threshold) else None
        except (TypeError, ValueError, ZeroDivisionError):
            ratio = None
        findings.append({"rule": rule, "severity": severity, "value": value, "threshold": threshold, "ratio": ratio, **extra})

    for row in snap.get("routes") or ():
        if focus and row["route"] != focus:
            continue
        if row["count"] >= limits["min_samples"] and row["p95_ms"] is not None and row["p95_ms"] > limits["p95_slo_ms"]:
            add("p95_over_slo", "high" if row["p95_ms"] > 2 * limits["p95_slo_ms"] else "medium",
                row["p95_ms"], limits["p95_slo_ms"], route=row["route"], count=row["count"])
        if row["count"] >= limits["min_error_samples"] and (row["error_rate"] or 0) > limits["error_rate"]:
            add("server_error_rate", "high", row["error_rate"], limits["error_rate"], route=row["route"], count=row["count"])

    offload = snap.get("offload") or {}
    limit = offload.get("limit")
    if isinstance(limit, int) and limit > 0:
        saturation = round(float(offload.get("active") or 0) / limit, 3)
        if saturation >= limits["offload_saturation"]:
            add("blocking_offload_saturation", "high", saturation, limits["offload_saturation"])
    if int(offload.get("timed_out_total") or 0) > 0:
        add("blocking_offload_timeouts", "medium", int(offload.get("timed_out_total") or 0), 0)
    if int(offload.get("rejected_total") or 0) > 0:
        add("blocking_offload_rejections", "high", int(offload.get("rejected_total") or 0), 0)

    lag = snap.get("event_loop_lag_ms")
    if isinstance(lag, (int, float)) and lag > limits["event_loop_lag_ms"]:
        add("event_loop_lag", "high", lag, limits["event_loop_lag_ms"])

    host = snap.get("host") or {}
    cpu = host.get("cpu") or {}
    if isinstance(cpu.get("util_pct"), (int, float)) and cpu["util_pct"] > limits["cpu_util_pct"]:
        add("cpu_saturation", "high", cpu["util_pct"], limits["cpu_util_pct"])
    load1, logical = cpu.get("load1"), cpu.get("logical")
    if isinstance(load1, (int, float)) and isinstance(logical, int) and logical > 0 and load1 > 2 * logical:
        add("load_average_high", "medium", load1, 2 * logical)
    mem = host.get("mem") or {}
    if isinstance(mem.get("avail_pct"), (int, float)) and mem["avail_pct"] < limits["mem_available_pct"]:
        add("memory_pressure", "high", mem["avail_pct"], limits["mem_available_pct"])
    for disk in host.get("disk") or ():
        if isinstance(disk.get("used_pct"), (int, float)) and disk["used_pct"] > limits["disk_used_pct"]:
            add("disk_pressure", "medium", disk["used_pct"], limits["disk_used_pct"], mount=disk.get("mount"))

    for name, dep in (snap.get("dependencies") or {}).items():
        if dep.get("state") in {"open", "half_open"}:
            add("dependency_breaker_open", "high", dep.get("consecutive_failures"), 0, dependency=name, state=dep.get("state"))

    order = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: (order.get(f["severity"], 3), -(f["ratio"] or 0.0)))
    return findings[:10]


async def analyze(focus: Optional[str] = None) -> Dict[str, Any]:
    snap = await snapshot()
    findings = bottlenecks(snap, focus=focus)
    _STATE["analyses_run"] += 1
    return {
        "schemaVersion": SCHEMA_VERSION,
        "measured_at": snap["measured_at"],
        "window": snap["window"],
        "samples": snap["samples"],
        "focus": focus,
        "thresholds": thresholds(),
        "bottlenecks": findings,
        "host": snap["host"],
        "event_loop_lag_ms": snap["event_loop_lag_ms"],
        "top_routes": snap["routes"][:5],
        "optimization_applied": False,
    }


def profile_route(route: str, *, window_s: Optional[float] = None) -> Dict[str, Any]:
    stats = route_statistics(route=route, window_s=window_s).get(route)
    _STATE["profiles_run"] += 1
    if stats is None:
        stats = {"route": route, "count": 0, "p50_ms": None, "p95_ms": None, "max_ms": None,
                 "server_errors": 0, "client_errors": 0, "error_rate": None}
    return {
        "schemaVersion": SCHEMA_VERSION,
        "measured_at": datetime.now(timezone.utc).isoformat(),
        "window": f"last_{int(window_s)}s_of_bounded_ring" if window_s else "since_boot_bounded_ring",
        "measured": stats["count"] > 0,
        **stats,
    }


def counters() -> Dict[str, Any]:
    return dict(_STATE)


class Catalyst:
    """Compatibility facade over the measured functions above."""

    def __init__(self):
        self.name = "catalyst"
        self.level = 11
        self.description = "Measured performance profiling and bottleneck analysis"

    async def analyze(self, focus: Optional[str] = None) -> Dict[str, Any]:
        return await analyze(focus)

    def optimize(self, target: str) -> Dict[str, Any]:
        raise NotImplementedError("Catalyst does not apply optimizations; use analyze() for advice")

    def accelerate(self, process: str) -> Dict[str, Any]:
        raise NotImplementedError("Catalyst does not apply optimizations; use analyze() for advice")
