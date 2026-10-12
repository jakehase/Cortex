"""Level 1 Kernel: bounded read-only host and process telemetry.

The Kernel deliberately exposes no host-control primitive. Mutating control
belongs behind an existing exact action capability; unsupported control is
rejected rather than represented as successful execution.

Every value is measured from ``/proc``, ``statvfs`` or ``getrusage``; when a
source is unavailable the field is ``None`` (never a zero default).

``kernel_level_status(app)`` is the pure, in-process level-availability
function other levels (Nexus's consistency guard, Meta-conductor, Awareness)
call instead of an HTTP self-request to ``/kernel/levels``.
"""

from __future__ import annotations

import os
import resource
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional

from cortex_server.modules.health_status import (
    DEGRADED,
    DISABLED_BY_DESIGN,
    FAILED,
    OPERATIONAL,
    RESTRICTED_BY_DESIGN,
    STALE_EVIDENCE,
    UNTESTED,
    aggregate_status,
    vocabulary_payload,
)

METRICS_SCHEMA_VERSION = "cortex.kernel.metrics.v2"
_ACCEPTED_METRICS_SCHEMAS = frozenset({"cortex.kernel.metrics.v1", METRICS_SCHEMA_VERSION})
_CPU_SAMPLE_SECONDS = 0.1
_CPU_SAMPLE_MAX_AGE_SECONDS = 600.0
_cpu_lock = threading.Lock()
_last_cpu_sample: Optional[tuple[float, int, int]] = None


class KernelControlDenied(RuntimeError):
    """Raised when a caller asks this read-only kernel slice to mutate state."""


def _read_key_values(path: Path) -> Dict[str, int]:
    values: Dict[str, int] = {}
    try:
        for line in path.read_text(encoding="utf-8", errors="strict").splitlines():
            key, separator, raw = line.partition(":")
            if not separator:
                continue
            fields = raw.strip().split()
            if not fields or not fields[0].isdigit():
                continue
            amount = int(fields[0])
            if len(fields) > 1 and fields[1].lower() == "kb":
                amount *= 1024
            values[key] = amount
    except (OSError, UnicodeError, ValueError):
        return {}
    return values


def _read_proc_stat_cpu() -> Optional[tuple[int, int]]:
    """Return (busy_jiffies, total_jiffies) from the aggregate cpu line."""

    try:
        with open("/proc/stat", "r", encoding="utf-8") as handle:
            first = handle.readline()
    except OSError:
        return None
    parts = first.split()
    if not parts or parts[0] != "cpu":
        return None
    try:
        values = [int(value) for value in parts[1:]]
    except ValueError:
        return None
    if len(values) < 4:
        return None
    idle = values[3] + (values[4] if len(values) > 4 else 0)  # idle + iowait
    total = sum(values[:8]) if len(values) >= 8 else sum(values)
    return total - idle, total


def _cpu_utilization_percent() -> Dict[str, Any]:
    """CPU utilisation over the interval since the previous sample.

    The first call (or a call after a long gap) takes a short 100 ms sample;
    later calls reuse the previous reading so status endpoints never block.
    """

    global _last_cpu_sample
    with _cpu_lock:
        now = time.monotonic()
        current = _read_proc_stat_cpu()
        if current is None:
            return {"utilizationPercent": None, "sampleWindowSeconds": None}
        previous = _last_cpu_sample
        if previous is None or not (0.05 <= now - previous[0] <= _CPU_SAMPLE_MAX_AGE_SECONDS):
            time.sleep(_CPU_SAMPLE_SECONDS)
            first_now, first = now, current
            now = time.monotonic()
            current = _read_proc_stat_cpu()
            if current is None:
                return {"utilizationPercent": None, "sampleWindowSeconds": None}
            previous = (first_now, first[0], first[1])
        busy_delta = current[0] - previous[1]
        total_delta = current[1] - previous[2]
        _last_cpu_sample = (now, current[0], current[1])
        if total_delta <= 0:
            return {"utilizationPercent": None, "sampleWindowSeconds": round(now - previous[0], 3)}
        return {
            "utilizationPercent": round(max(0.0, min(100.0, 100.0 * busy_delta / total_delta)), 2),
            "sampleWindowSeconds": round(now - previous[0], 3),
        }


def _disk_usage(path: str) -> Optional[Dict[str, Any]]:
    try:
        stats = os.statvfs(path)
    except (OSError, ValueError):
        return None
    total = int(stats.f_blocks * stats.f_frsize)
    free = int(stats.f_bavail * stats.f_frsize)
    if total <= 0:
        return None
    return {
        "mount": path,
        "totalBytes": total,
        "freeBytes": free,
        "usedPercent": round(100.0 * (total - free) / total, 2),
    }


def _state_disk_paths() -> List[str]:
    candidates = [os.getenv("CORTEX_STATE_DIR", "/opt/clawdbot/state"), "/"]
    seen: List[str] = []
    for candidate in candidates:
        path = str(candidate or "").strip()
        if path and os.path.isabs(path) and os.path.isdir(path) and path not in seen:
            seen.append(path)
    return seen


def _open_fd_count() -> Optional[int]:
    try:
        return len(os.listdir("/proc/self/fd"))
    except OSError:
        return None


def collect_system_metrics() -> Dict[str, Any]:
    """Collect bounded numeric telemetry without command execution or secrets."""

    load_average: Optional[list[float]]
    try:
        load_average = [round(float(value), 4) for value in os.getloadavg()]
    except (AttributeError, OSError):
        load_average = None

    meminfo = _read_key_values(Path("/proc/meminfo"))
    process_status = _read_key_values(Path("/proc/self/status"))
    usage = resource.getrusage(resource.RUSAGE_SELF)
    uptime_seconds: Optional[float] = None
    try:
        uptime_seconds = round(float(Path("/proc/uptime").read_text().split()[0]), 3)
    except (OSError, ValueError, IndexError):
        pass

    total_memory = meminfo.get("MemTotal")
    available_memory = meminfo.get("MemAvailable")
    available_percent = (
        round(100.0 * available_memory / total_memory, 2)
        if total_memory and available_memory is not None
        else None
    )

    return {
        "schemaVersion": METRICS_SCHEMA_VERSION,
        "cpu": {
            "logicalCount": int(os.cpu_count() or 0) or None,
            "loadAverage": load_average,
            **_cpu_utilization_percent(),
        },
        "memory": {
            "totalBytes": total_memory,
            "availableBytes": available_memory,
            "availablePercent": available_percent,
            "swapTotalBytes": meminfo.get("SwapTotal"),
            "swapFreeBytes": meminfo.get("SwapFree"),
        },
        "disk": [usage_row for path in _state_disk_paths() if (usage_row := _disk_usage(path)) is not None],
        "process": {
            "pid": int(os.getpid()),
            "rssBytes": process_status.get("VmRSS"),
            "threads": process_status.get("Threads"),
            "openFds": _open_fd_count(),
            "userCpuSeconds": round(float(usage.ru_utime), 6),
            "systemCpuSeconds": round(float(usage.ru_stime), 6),
            # Kept for the v1 contract: this process produced the reading.
            "alive": True,
        },
        "host": {
            "uptimeSeconds": uptime_seconds,
            "monotonicSeconds": round(float(time.monotonic()), 3),
        },
        "sources": {
            "meminfo": bool(meminfo),
            "procStatus": bool(process_status),
            "procStat": _read_proc_stat_cpu() is not None,
        },
        "control": {
            "available": False,
            "reason": "read_only_kernel_slice",
        },
    }


class Kernel:
    """Level 1 bounded telemetry facade."""

    def __init__(self, metrics_collector: Callable[[], Dict[str, Any]] = collect_system_metrics):
        self.level = 1
        self.name = "Kernel"
        self._metrics_collector = metrics_collector

    def metrics(self) -> Dict[str, Any]:
        metrics = self._metrics_collector()
        if not isinstance(metrics, dict) or metrics.get("schemaVersion") not in _ACCEPTED_METRICS_SCHEMAS:
            raise RuntimeError("kernel metrics collector returned an invalid contract")
        return metrics

    def status(self) -> Dict[str, Any]:
        try:
            metrics = self.metrics()
        except Exception as exc:
            return {
                "level": self.level,
                "name": self.name,
                "status": DEGRADED,
                "metricsAvailable": False,
                "processAlive": True,
                "controlAvailable": False,
                "errorType": type(exc).__name__,
            }
        sources = metrics.get("sources") if isinstance(metrics.get("sources"), dict) else {}
        missing = sorted(name for name, ok in sources.items() if ok is False)
        memory = metrics.get("memory") if isinstance(metrics.get("memory"), dict) else {}
        # "online" requires the core /proc sources to have produced readings;
        # an empty collector (non-Linux, masked /proc) is reported as degraded.
        core_ok = memory.get("totalBytes") is not None and "meminfo" not in missing
        return {
            "level": self.level,
            "name": self.name,
            "status": OPERATIONAL if core_ok else DEGRADED,
            "metricsAvailable": core_ok,
            "processAlive": True,
            "controlAvailable": False,
            "missingSources": missing,
        }

    def control(self, _operation: str, **_kwargs: Any) -> None:
        raise KernelControlDenied(
            "kernel control is unavailable in the read-only production slice"
        )


_kernel: Optional[Kernel] = None


def get_kernel() -> Kernel:
    """Get or create the process-local bounded Kernel facade."""

    global _kernel
    if _kernel is None:
        _kernel = Kernel()
    return _kernel


# ---------------------------------------------------------------------------
# Measured level availability (pure, in-process)
# ---------------------------------------------------------------------------

_RECENT_FAILURE_MIN_REQUESTS = 3
_PROBE_EVIDENCE_MAX_AGE_S = 120.0
_OWN_LEVEL_PATHS = ("/kernel/levels",)


def kernel_level_status(
    app: Any = None,
    *,
    probe_snapshot: Optional[Dict[str, Any]] = None,
    probe_max_age_s: float = _PROBE_EVIDENCE_MAX_AGE_S,
) -> Dict[str, Any]:
    """Per-level availability derived from the running app; never guesses.

    Pure and synchronous: reads the mounted route table, the router load
    report, the metrics ring (recent responses on each level's routes) and,
    when present and fresh, the cached in-process probe snapshot. It performs
    no I/O beyond reading in-memory state, so Nexus can call it on every turn.

    Status values use ``cortex.health-status.v1``. In particular, safe-mode
    policy states and stale probe evidence are not component failures.
    """

    from cortex_server.modules import level_probe

    resolved = level_probe.resolve_app(app)
    if resolved is None:
        from cortex_server.modules.level_registry import get_level_registry

        rows = [
            {
                "level": int(row["level"]),
                "name": str(row["name"]),
                "canonical_status": str(row["canonical_status"]),
                "status": UNTESTED,
                "reason": "app_unavailable",
            }
            for row in get_level_registry()
        ]
        return _summarise_levels(rows, measured=False, probe_age_s=None)

    rows = level_probe.level_mount_states(resolved)
    evidence = level_probe.recent_level_evidence(
        [row["route_prefix"] for row in rows], own_paths=_OWN_LEVEL_PATHS
    )
    snapshot = probe_snapshot if probe_snapshot is not None else level_probe.cached_probe_snapshot(None)
    snapshot_age = snapshot.get("age_s") if isinstance(snapshot, dict) else None
    use_probe_evidence = bool(
        isinstance(snapshot, dict)
        and (
            probe_snapshot is not None
            or snapshot_age is None
            or float(snapshot_age) <= float(probe_max_age_s)
        )
    )
    probes: Dict[int, Dict[str, Any]] = {}
    if use_probe_evidence:
        for probed in snapshot.get("levels") or ():
            if isinstance(probed, dict) and isinstance(probed.get("probe"), dict):
                probes[int(probed["level"])] = probed["probe"]

    for row in rows:
        observed = evidence.get(row["route_prefix"]) or {}
        row["recent_evidence"] = observed
        recent = [status for status in observed.get("recent_statuses") or () if isinstance(status, int)]
        if (
            row["status"] in {OPERATIONAL, RESTRICTED_BY_DESIGN}
            and len(recent) >= _RECENT_FAILURE_MIN_REQUESTS
            and all(status >= 500 for status in recent)
        ):
            row["status"] = DEGRADED
            row["reason"] = "recent_server_errors"
        probe = probes.get(row["level"])
        if probe is not None:
            row["probe"] = {
                key: probe.get(key)
                for key in ("outcome", "status_code", "latency_ms", "reported_status", "probed_at")
            }
            outcome = probe.get("outcome")
            reported_status = probe.get("reported_status")
            if row["status"] in {OPERATIONAL, RESTRICTED_BY_DESIGN} and outcome not in {
                "healthy", "auth_required", "nested_probe_suppressed", None
            }:
                row["status"] = (
                    reported_status
                    if outcome == "self_reported_unhealthy"
                    and reported_status in {DEGRADED, FAILED}
                    else DEGRADED
                )
                row["reason"] = f"probe_{outcome}"
            elif (
                row["status"] in {OPERATIONAL, RESTRICTED_BY_DESIGN}
                and outcome == "healthy"
                and reported_status in {
                    RESTRICTED_BY_DESIGN,
                    DISABLED_BY_DESIGN,
                    STALE_EVIDENCE,
                    UNTESTED,
                }
            ):
                row["status"] = reported_status
                row["reason"] = f"self_reported_{reported_status}"
    evidence_status = (
        UNTESTED
        if snapshot is None
        else OPERATIONAL
        if use_probe_evidence
        else STALE_EVIDENCE
    )
    return _summarise_levels(
        rows,
        measured=True,
        probe_age_s=snapshot_age,
        probe_evidence_status=evidence_status,
        probe_used=use_probe_evidence,
    )


def _summarise_levels(
    rows: List[Dict[str, Any]],
    *,
    measured: bool,
    probe_age_s: Optional[float],
    probe_evidence_status: str = UNTESTED,
    probe_used: bool = False,
) -> Dict[str, Any]:
    def levels_with(*states: str) -> List[int]:
        return [row["level"] for row in rows if row.get("status") in states]

    counts: Dict[str, int] = {}
    for row in rows:
        counts[str(row.get("status"))] = counts.get(str(row.get("status")), 0) + 1
    return {
        "schemaVersion": "cortex.kernel.levels.v3",
        "status": aggregate_status(row.get("status") for row in rows),
        "status_vocabulary": vocabulary_payload(),
        "measured": measured,
        "sources": ["route_table", "router_load_report", "metrics_ring"]
        + (["in_process_probe_cache"] if probe_used else []),
        "probe_snapshot_age_s": probe_age_s,
        "probe_evidence_status": probe_evidence_status,
        "counts": counts,
        "operational_levels": levels_with(OPERATIONAL),
        "restricted_by_design_levels": levels_with(RESTRICTED_BY_DESIGN),
        "disabled_by_design_levels": levels_with(DISABLED_BY_DESIGN),
        "stale_evidence_levels": levels_with(STALE_EVIDENCE),
        "degraded_levels": levels_with(DEGRADED),
        "untested_levels": levels_with(UNTESTED),
        "failed_levels": levels_with(FAILED),
        # Compatibility collection names; member rows use only the canonical
        # status vocabulary.
        "online_levels": levels_with(OPERATIONAL),
        "restricted_levels": levels_with(RESTRICTED_BY_DESIGN),
        "unavailable_levels": levels_with(DISABLED_BY_DESIGN, UNTESTED, FAILED),
        "levels": rows,
    }


def kernel_online_levels(app: Any = None) -> Optional[set]:
    """Convenience for routing guards: levels that are measurably usable.

    Returns ``None`` when availability cannot be measured (no running app), so
    callers can distinguish "unknown" from "nothing is online".
    """

    status = kernel_level_status(app)
    if not status.get("measured"):
        return None
    return set(status["operational_levels"]) | set(status["restricted_by_design_levels"])


def summarise_metrics(metrics: Dict[str, Any]) -> Dict[str, Any]:
    """Small digest of a metrics reading for adapters and self-reports."""

    cpu = metrics.get("cpu") if isinstance(metrics.get("cpu"), dict) else {}
    memory = metrics.get("memory") if isinstance(metrics.get("memory"), dict) else {}
    process = metrics.get("process") if isinstance(metrics.get("process"), dict) else {}
    load = cpu.get("loadAverage") if isinstance(cpu.get("loadAverage"), list) else None
    rss = process.get("rssBytes")
    disks: Iterable[Any] = metrics.get("disk") if isinstance(metrics.get("disk"), list) else ()
    return {
        "cpu": {
            "load1": load[0] if load else None,
            "util_pct": cpu.get("utilizationPercent"),
            "sample_window_s": cpu.get("sampleWindowSeconds"),
            "logical": cpu.get("logicalCount"),
        },
        "mem": {"avail_pct": memory.get("availablePercent")},
        "disk": [
            {"mount": row.get("mount"), "used_pct": row.get("usedPercent")}
            for row in disks
            if isinstance(row, dict)
        ],
        "process": {
            "rss_mb": round(rss / 1_048_576, 1) if isinstance(rss, int) else None,
            "fds": process.get("openFds"),
            "threads": process.get("threads"),
        },
    }
