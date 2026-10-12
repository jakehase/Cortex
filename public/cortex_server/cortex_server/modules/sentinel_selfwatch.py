"""Sentinel self-watch: always-on, read-only, in-process health checks.

Sentinel's endpoint scanner only runs inside an explicitly delegated, time
bounded schedule (it sends outbound probes). This self-watch is the part that
is always on. Every ``interval_s()`` seconds (default 300) it measures Cortex's
own state from in-process sources:

* startup components (``app.state.lifecycle_checks``)
* level availability (in-process status-route probes + mount state)
* host metrics (disk, memory, load)
* Oracle consult outcomes and the HTTP error rate (in-memory metrics ring)
* level-execution receipts (model lane failures)
* Chronos maintenance recency and the Awareness loop heartbeat
* Sentinel's own watcher persistence

It never makes network calls, never calls a model, never writes files and never
repairs anything. New problems are logged once and broadcast on the internal
event bus (``cortex_alert``); resolved problems are announced the same way.
``CORTEX_SENTINEL_SELFWATCH=0`` turns it off.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("cortex.sentinel.selfwatch")

FIRST_DELAY_S = 60.0
SELF_LEVELS = frozenset({21})
# Judged by a dedicated check with stronger evidence: Oracle (L5) self-reports
# "degraded" until a provider completion is verified, which says nothing about
# whether consults are failing; check_oracle measures the real outcomes.
COVERED_ELSEWHERE = {5: "oracle_consult"}
# Off on purpose until the operator opts in; reported, never alerted.
BY_DESIGN = {17: "git status needs an operator execution token", 25: "Bridge is approval-only"}
WINDOW_S = 30 * 60
CHRONOS_MAX_AGE_H = 27
SEVERITY_ORDER = {"info": 0, "medium": 1, "high": 2}
_HISTORY: "deque[Dict[str, Any]]" = deque(maxlen=48)
_state: Dict[str, Any] = {
    "task": None,
    "started_at": None,
    "runs": 0,
    "last": None,
    "last_error": None,
    "active": {},  # issue key -> check row
}


def enabled() -> bool:
    return os.getenv("CORTEX_SENTINEL_SELFWATCH", "1").strip().lower() not in {"0", "false", "no", "off"}


def interval_s() -> float:
    try:
        value = float(os.getenv("CORTEX_SENTINEL_SELFWATCH_INTERVAL_S", "300"))
    except ValueError:
        value = 300.0
    return max(60.0, min(3600.0, value))


def _row(name: str, ok: bool, detail: str, *, severity: str = "info", value: Any = None) -> Dict[str, Any]:
    return {
        "check": name,
        "ok": bool(ok),
        "severity": "info" if ok else severity,
        "detail": str(detail)[:300],
        "value": value,
    }


def _parse_ts(value: Any) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.astimezone()  # naive timestamps in Cortex are local time
    return parsed.astimezone(timezone.utc)


# ── individual checks (all read-only) ─────────────────────────────────────


def check_lifecycle(app: Any) -> Dict[str, Any]:
    checks = getattr(getattr(app, "state", None), "lifecycle_checks", None)
    if not isinstance(checks, dict):
        return _row("startup_components", True, "lifecycle checks unavailable (no running app)")
    failing = sorted(
        name for name, value in checks.items() if isinstance(value, dict) and value.get("ok") is False
    )
    if failing:
        errors = {name: (checks[name] or {}).get("error") for name in failing}
        return _row("startup_components", False, f"not ready: {errors}", severity="high", value=failing)
    return _row("startup_components", True, "all started components report ready")


async def check_levels(app: Any) -> Dict[str, Any]:
    from cortex_server.modules import level_probe
    from cortex_server.modules.kernel import kernel_level_status

    try:
        await asyncio.wait_for(level_probe.refresh_probe_snapshot(app, max_age_s=60.0), timeout=25.0)
    except Exception as exc:  # probe refresh is best effort; mount state still counts
        logger.debug("self-watch probe refresh failed: %s", type(exc).__name__)
    status = kernel_level_status(app)
    if not status.get("measured"):
        return _row("levels", True, "level availability not measurable (no running app)")
    failed = [row["level"] for row in status.get("levels") or () if row.get("status") == "failed"]
    # L21 is Sentinel itself: its status is derived from this watch, so judging
    # it here would feed back on itself.
    skip = set(SELF_LEVELS) | set(COVERED_ELSEWHERE) | set(BY_DESIGN)
    degraded_rows = [row for row in status.get("levels") or ()
                     if row.get("status") == "degraded" and row.get("level") not in skip]
    degraded = [row["level"] for row in degraded_rows]
    reasons = {row["level"]: _degraded_reason(row) for row in degraded_rows}
    unmounted = [row["level"] for row in status.get("levels") or () if row.get("status") == "unmounted"]
    value = {"failed": failed, "degraded": degraded, "unmounted_by_design": unmounted,
             "online": len(status.get("online_levels") or []), "restricted": len(status.get("restricted_levels") or [])}
    if failed:
        return _row("levels", False, f"levels failed to load: {failed}", severity="high", value=value)
    value["degraded_reasons"] = reasons
    value["by_design"] = {lvl: why for lvl, why in BY_DESIGN.items()}
    value["covered_elsewhere"] = dict(COVERED_ELSEWHERE)
    if degraded:
        detail = "levels probing unhealthy: " + ", ".join(f"L{lvl} ({reasons[lvl]})" for lvl in degraded)
        return _row("levels", False, detail, severity="medium", value=value)
    return _row("levels", True, f"{value['online']} online, {value['restricted']} restricted, none degraded", value=value)


def _degraded_reason(row: Dict[str, Any]) -> str:
    probe = row.get("probe") if isinstance(row.get("probe"), dict) else {}
    reported = probe.get("reported_status")
    return str(reported or probe.get("outcome") or row.get("reason") or "unknown")[:40]


def check_host() -> Dict[str, Any]:
    from cortex_server.modules.kernel import get_kernel, summarise_metrics

    digest = summarise_metrics(get_kernel().metrics())
    problems: List[str] = []
    severity = "medium"
    for disk in digest.get("disk") or ():
        used = disk.get("used_pct")
        if isinstance(used, (int, float)) and used >= 85:
            problems.append(f"disk {disk.get('mount')} {used}% used")
            if used >= 95:
                severity = "high"
    avail = (digest.get("mem") or {}).get("avail_pct")
    if isinstance(avail, (int, float)) and avail < 10:
        problems.append(f"memory {avail}% available")
        if avail < 5:
            severity = "high"
    cpu = digest.get("cpu") or {}
    load1, logical = cpu.get("load1"), cpu.get("logical")
    if isinstance(load1, (int, float)) and isinstance(logical, int) and logical > 0 and load1 > 2 * logical:
        problems.append(f"load {load1} on {logical} CPUs")
    value = {"disk": digest.get("disk"), "mem_avail_pct": avail, "load1": load1}
    if problems:
        return _row("host", False, "; ".join(problems), severity=severity, value=value)
    return _row("host", True, "disk, memory and load within limits", value=value)


def _recent_http(window_s: float = WINDOW_S) -> List[Dict[str, Any]]:
    from cortex_server.modules import level_probe

    cutoff = datetime.now(timezone.utc) - timedelta(seconds=window_s)
    rows = []
    for row in level_probe._recent_requests():
        ts = _parse_ts(row.get("ts"))
        if ts is not None and ts >= cutoff:
            rows.append(row)
    return rows


def check_oracle(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    consults = [r for r in rows if r.get("path") == "/oracle/chat" and str(r.get("method", "POST")).upper() == "POST"]
    ok = sum(1 for r in consults if isinstance(r.get("status"), int) and r["status"] < 400)
    failed = sum(1 for r in consults if isinstance(r.get("status"), int) and r["status"] >= 500)
    value = {"window_min": WINDOW_S // 60, "ok": ok, "failed": failed}
    if failed >= 2 and ok == 0:
        return _row("oracle_consult", False, f"every Oracle consult failed in the last {WINDOW_S // 60} min ({failed})",
                    severity="high", value=value)
    if failed >= 3 and failed > ok:
        return _row("oracle_consult", False, f"most Oracle consults failed ({failed} failed, {ok} ok)",
                    severity="medium", value=value)
    return _row("oracle_consult", True, f"{ok} ok, {failed} failed in the last {WINDOW_S // 60} min", value=value)


def check_http_errors(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    statuses = [r.get("status") for r in rows if isinstance(r.get("status"), int)]
    errors = sum(1 for s in statuses if s >= 500)
    value = {"requests": len(statuses), "server_errors": errors}
    if len(statuses) >= 20 and errors / len(statuses) >= 0.2:
        return _row("http_errors", False, f"{errors} of {len(statuses)} requests returned 5xx", severity="medium", value=value)
    return _row("http_errors", True, f"{errors} server errors in {len(statuses)} requests", value=value)


_MODEL_FAILURE_PREFIXES = ("model_unavailable", "model_unverified", "provider_timeout", "timeout", "busy")


def check_level_execution() -> Dict[str, Any]:
    from cortex_server.modules.execution_engine import get_execution_engine

    cutoff = datetime.now(timezone.utc) - timedelta(seconds=WINDOW_S)
    recent = []
    for receipt in list(get_execution_engine().execution_log):
        ts = _parse_ts(receipt.get("startedAt"))
        if ts is not None and ts >= cutoff:
            recent.append(receipt)
    model_failures = [
        r for r in recent
        if (r.get("status") == "blocked" and str(r.get("reason") or "").startswith(_MODEL_FAILURE_PREFIXES))
        or (r.get("status") == "failed" and r.get("errorType") == "DeadlineExceeded")
    ]
    succeeded = sum(1 for r in recent if r.get("status") == "succeeded")
    value = {"runs": len(recent), "succeeded": succeeded, "model_failures": len(model_failures)}
    if len(model_failures) >= 3 and succeeded == 0:
        return _row("level_execution", False, f"{len(model_failures)} level runs failed on the model lane, none succeeded",
                    severity="medium", value=value)
    return _row("level_execution", True, f"{succeeded} of {len(recent)} level runs succeeded in the last {WINDOW_S // 60} min",
                value=value)


def check_chronos(chronos: Any = None) -> Dict[str, Any]:
    from cortex_server.modules.chronos import get_chronos

    # get_chronos() is per event loop: resolve it on the loop thread (run_once
    # passes it in) or a worker thread would see a fresh, never-started instance.
    view = (chronos or get_chronos()).schedule_view()
    last = view.get("last_completed_run") or {}
    started = _parse_ts(last.get("started_at"))
    age_h = None if started is None else round((datetime.now(timezone.utc) - started).total_seconds() / 3600, 1)
    value = {"scheduler_running": bool(view.get("scheduler_running")), "last_run_age_h": age_h,
             "next_fire": view.get("next_fire")}
    if not view.get("scheduler_running"):
        return _row("chronos", False, "Chronos maintenance scheduler is not running", severity="high", value=value)
    if age_h is not None and age_h > CHRONOS_MAX_AGE_H:
        return _row("chronos", False, f"last maintenance run was {age_h} h ago", severity="medium", value=value)
    return _row("chronos", True, f"running; last maintenance {age_h if age_h is not None else 'n/a'} h ago", value=value)


def check_awareness() -> Dict[str, Any]:
    from cortex_server.routers import awareness

    running = bool(getattr(awareness, "_loop_running", False))
    wm = getattr(awareness, "_memory", None)
    last_tick = None
    try:
        if wm is not None:
            last_tick = (wm.get_state().get("meta") or {}).get("last_tick")
    except Exception:
        last_tick = None
    tick = _parse_ts(last_tick)
    age_s = None if tick is None else int((datetime.now(timezone.utc) - tick).total_seconds())
    limit = 3 * int(getattr(awareness, "TICK_SECONDS", 120) or 120)
    value = {"loop_running": running, "last_tick_age_s": age_s}
    if not running:
        return _row("awareness", False, "Awareness loop is not running", severity="medium", value=value)
    if age_s is not None and age_s > limit:
        return _row("awareness", False, f"Awareness last ticked {age_s} s ago", severity="medium", value=value)
    return _row("awareness", True, f"loop running; last tick {age_s if age_s is not None else 'n/a'} s ago", value=value)


def check_sentinel_state() -> Dict[str, Any]:
    from cortex_server.routers import sentinel

    health = sentinel.watcher_state_health()
    status = str(health.get("status") or "unknown")
    if status != "healthy":
        return _row("sentinel_persistence", False, f"watcher state {status}", severity="medium", value=status)
    return _row("sentinel_persistence", True, f"watcher state {status}", value=status)


# ── sweep, alerts, loop ───────────────────────────────────────────────────


async def _guarded(name: str, fn, *args) -> Dict[str, Any]:
    try:
        if asyncio.iscoroutinefunction(fn):
            return await fn(*args)
        return await asyncio.to_thread(fn, *args)
    except Exception as exc:
        return _row(name, False, f"check could not run ({type(exc).__name__})", severity="medium")


def _loop_chronos() -> Any:
    try:
        from cortex_server.modules.chronos import get_chronos

        return get_chronos()
    except Exception:
        return None


async def run_once(app: Any) -> Dict[str, Any]:
    """One read-only sweep. Returns the result and updates alerts."""

    started = time.monotonic()
    try:
        http_rows = await asyncio.to_thread(_recent_http)
    except Exception:
        http_rows = []
    checks = [
        await _guarded("startup_components", check_lifecycle, app),
        await _guarded("levels", check_levels, app),
        await _guarded("host", check_host),
        check_oracle(http_rows),
        check_http_errors(http_rows),
        await _guarded("level_execution", check_level_execution),
        await _guarded("chronos", check_chronos, _loop_chronos()),
        await _guarded("awareness", check_awareness),
        await _guarded("sentinel_persistence", check_sentinel_state),
    ]
    issues = [c for c in checks if not c["ok"]]
    worst = max((SEVERITY_ORDER.get(c["severity"], 1) for c in issues), default=0)
    result = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "checked_monotonic": time.monotonic(),
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        "status": "healthy" if not issues else ("degraded" if worst < 2 else "unhealthy"),
        "issues": len(issues),
        "checks": checks,
    }
    _state["last"] = result
    _state["runs"] += 1
    _HISTORY.append({k: result[k] for k in ("checked_at", "status", "issues")})
    _announce(issues)
    return result


def _announce(issues: List[Dict[str, Any]]) -> None:
    current = {f"{c['check']}:{c['severity']}": c for c in issues}
    previous: Dict[str, Dict[str, Any]] = _state["active"]
    new_keys = [k for k in current if k not in previous]
    resolved = [k for k in previous if k not in current]
    _state["active"] = current
    if not new_keys and not resolved:
        return
    bus = None
    try:
        from cortex_server.modules.unified_messaging import get_bus

        bus = get_bus()
    except Exception:
        bus = None
    for key in new_keys:
        row = current[key]
        logger.warning("Sentinel self-watch: NEW %s issue %s: %s", row["severity"], row["check"], row["detail"])
        if bus is not None:
            try:
                bus.broadcast("sentinel", "cortex_alert", {
                    "type": "self_watch", "check": row["check"], "severity": row["severity"], "detail": row["detail"],
                })
            except Exception:
                pass
    for key in resolved:
        row = previous[key]
        logger.warning("Sentinel self-watch: RESOLVED %s", row["check"])
        if bus is not None:
            try:
                bus.broadcast("sentinel", "cortex_alert_resolved", {"type": "self_watch", "check": row["check"]})
            except Exception:
                pass


async def _loop(app: Any) -> None:
    await asyncio.sleep(FIRST_DELAY_S)
    while True:
        try:
            await run_once(app)
            _state["last_error"] = None
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # never let one bad sweep stop the watch
            _state["last_error"] = type(exc).__name__
            logger.warning("Sentinel self-watch sweep failed (%s)", type(exc).__name__)
        await asyncio.sleep(interval_s())


async def start(app: Any) -> Optional[asyncio.Task]:
    task = _state.get("task")
    if task is not None and not task.done() and task.get_loop() is asyncio.get_running_loop():
        return task
    if not enabled():
        return None
    _state["started_at"] = time.time()
    task = asyncio.create_task(_loop(app), name="cortex-sentinel-selfwatch")
    _state["task"] = task
    return task


async def stop() -> None:
    task, _state["task"] = _state.get("task"), None
    if task is None or task.done():
        return
    if task.get_loop() is not asyncio.get_running_loop():
        return  # owned by another (finished) event loop; nothing to await here
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


def running() -> bool:
    task = _state.get("task")
    return bool(task is not None and not task.done())


def summary() -> Dict[str, Any]:
    """Content-free view for Sentinel status and the L21 adapter."""

    last = _state.get("last")
    age = None if not last else round(time.monotonic() - float(last["checked_monotonic"]), 1)
    fresh = bool(last) and age is not None and age <= 3 * interval_s()
    return {
        "enabled": enabled(),
        "running": running(),
        "interval_s": interval_s(),
        "mode": "read_only_in_process",
        "runs": _state.get("runs", 0),
        "last_checked_at": (last or {}).get("checked_at"),
        "last_age_s": age,
        "fresh": fresh,
        "status": (last or {}).get("status") if fresh else ("pending" if running() else "off"),
        "issues": [
            {k: c[k] for k in ("check", "severity", "detail")} for c in ((last or {}).get("checks") or []) if not c["ok"]
        ] if fresh else [],
        "checks": [{k: c[k] for k in ("check", "ok", "severity", "detail")} for c in ((last or {}).get("checks") or [])]
        if fresh else [],
        "last_error": _state.get("last_error"),
        "history": list(_HISTORY)[-12:],
    }


def reset_for_tests() -> None:
    _HISTORY.clear()
    _state.update(task=None, started_at=None, runs=0, last=None, last_error=None, active={})
