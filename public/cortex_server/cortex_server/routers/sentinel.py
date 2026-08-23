from __future__ import annotations

import asyncio
import time
import json
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from cortex_server.internal_addressing import CORTEX_INTERNAL_BASE_URL


@asynccontextmanager
async def _sentinel_lifespan(_app):
    global _startup_error
    _startup_error = None
    try:
        _load_watchers()
    except Exception as exc:
        _startup_error = _format_error("watcher_load_failed", exc)
    try:
        await start_scheduler()
    except Exception as exc:
        _startup_error = _format_error("scheduler_start_failed", exc)
    try:
        yield
    finally:
        try:
            await stop_scheduler()
        except Exception as exc:
            _startup_error = _format_error("scheduler_stop_failed", exc)


router = APIRouter(lifespan=_sentinel_lifespan)

_scheduler_running: bool = False
_scheduler_task: Optional[asyncio.Task] = None
_scan_interval: int = 1800
_lock: asyncio.Lock = asyncio.Lock()
_scheduler_started_at: Optional[float] = None
_last_scan_attempt_at: Optional[float] = None
_last_scan_success_at: Optional[float] = None
_last_scan_error: Optional[str] = None
_last_scan_issues: Optional[int] = None
_startup_error: Optional[str] = None
_last_load_error: Optional[str] = None
_last_save_error: Optional[str] = None
_last_task_error: Optional[str] = None

_watchers: Dict[str, Dict[str, Any]] = {}
_scan_history: List[Dict[str, Any]] = []

MAX_HISTORY = 120
DEFAULT_ENDPOINT_TIMEOUT_S = 2.5
MIN_SCAN_STALE_SECONDS = 30.0
SCAN_STALE_INTERVAL_MULTIPLIER = 2.0
BASE_URL = CORTEX_INTERNAL_BASE_URL
STATE_FILE = Path("/app/cortex_server/knowledge/evolution/sentinel_watchers.json")
_self_heal_events: List[Dict[str, Any]] = []


class WatchRequest(BaseModel):
    name: str
    watch_type: str
    target: str
    interval_seconds: Optional[int] = 60
    timeout_seconds: Optional[float] = DEFAULT_ENDPOINT_TIMEOUT_S


class ScanRequest(BaseModel):
    only_watch_id: Optional[str] = None
    timeout_seconds: Optional[float] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _timestamp_iso(value: Optional[float]) -> Optional[str]:
    if value is None:
        return None
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def _age_seconds(value: Optional[float], *, now: Optional[float] = None) -> Optional[float]:
    if value is None:
        return None
    observed = time.time() if now is None else now
    return round(max(0.0, observed - value), 3)


def _format_error(stage: str, exc: BaseException) -> str:
    detail = " ".join(str(exc).split())[:500]
    suffix = f":{detail}" if detail else ""
    return f"{stage}:{type(exc).__name__}{suffix}"


def _save_watchers():
    global _last_save_error
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(_watchers))
        _last_save_error = None
    except Exception as exc:
        _last_save_error = _format_error("watcher_save_failed", exc)
        raise


def _load_watchers():
    global _last_load_error
    try:
        if STATE_FILE.exists():
            data = json.loads(STATE_FILE.read_text())
            if not isinstance(data, dict):
                raise ValueError("watcher state must be a JSON object")
            _watchers.clear()
            _watchers.update(data)
        _last_load_error = None
    except Exception as exc:
        _last_load_error = _format_error("watcher_load_failed", exc)
        raise



def _record_heal(watch_id: str, before: str, after: str, reason: str):
    _self_heal_events.append({
        "timestamp": _now_iso(),
        "watch_id": watch_id,
        "before": before,
        "after": after,
        "reason": reason,
    })
    if len(_self_heal_events) > MAX_HISTORY:
        del _self_heal_events[:-MAX_HISTORY]


def _normalize_target(watch_id: str, target: str) -> str:
    t = str(target or "").strip()
    if t.startswith("/"):
        fixed = f"{BASE_URL}{t}"
        _record_heal(watch_id, t, fixed, "missing_scheme_host")
        t = fixed

    return t


async def _check_endpoint(url: str, timeout_s: float) -> Dict[str, Any]:
    t0 = time.time()
    try:
        async with httpx.AsyncClient(timeout=timeout_s, follow_redirects=True, trust_env=False) as client:
            r = await client.get(url)
        return {
            "ok": True,
            "status_code": r.status_code,
            "latency_ms": int((time.time() - t0) * 1000),
        }
    except Exception as e:
        return {
            "ok": False,
            "error": f"{type(e).__name__}:{e}",
            "latency_ms": int((time.time() - t0) * 1000),
        }


async def _execute_scan(only_watch_id: Optional[str] = None, timeout_override: Optional[float] = None) -> Dict[str, Any]:
    watchers_items = list(_watchers.items())
    if only_watch_id:
        watchers_items = [(only_watch_id, _watchers.get(only_watch_id))]
        if watchers_items[0][1] is None:
            raise HTTPException(status_code=404, detail=f"Unknown watch_id: {only_watch_id}")

    scan = {
        "timestamp": _now_iso(),
        "ts": time.time(),
        "watchers_checked": 0,
        "issues_found": 0,
        "results": [],
    }

    for watch_id, w in watchers_items:
        if not w:
            continue
        scan["watchers_checked"] += 1

        wtype = w.get("type")
        timeout_s = float(timeout_override if timeout_override is not None else w.get("timeout_s", DEFAULT_ENDPOINT_TIMEOUT_S))
        target = _normalize_target(watch_id, w.get("target"))
        if w.get("target") != target:
            w["target"] = target
            _save_watchers()

        res: Dict[str, Any] = {
            "watch_id": watch_id,
            "name": w.get("name"),
            "type": wtype,
            "target": target,
            "ok": True,
        }

        if wtype == "endpoint":
            chk = await _check_endpoint(target, timeout_s=timeout_s)
            res.update(chk)
            if not chk.get("ok") or int(chk.get("status_code") or 0) >= 400:
                scan["issues_found"] += 1
                res["ok"] = False
        else:
            res["ok"] = False
            res["error"] = f"unsupported_watch_type:{wtype}"
            scan["issues_found"] += 1

        scan["results"].append(res)

    _scan_history.append(scan)
    if len(_scan_history) > MAX_HISTORY:
        del _scan_history[:-MAX_HISTORY]
    return scan


async def _run_scan(
    only_watch_id: Optional[str] = None,
    timeout_override: Optional[float] = None,
) -> Dict[str, Any]:
    global _last_scan_attempt_at, _last_scan_success_at
    global _last_scan_error, _last_scan_issues

    full_health_scan = only_watch_id is None
    if full_health_scan:
        _last_scan_attempt_at = time.time()
    try:
        scan = await _execute_scan(
            only_watch_id=only_watch_id,
            timeout_override=timeout_override,
        )
    except Exception as exc:
        if full_health_scan:
            _last_scan_error = _format_error("scan_failed", exc)
        raise

    # A scoped manual scan is useful diagnostic evidence but cannot prove that
    # every configured watcher is healthy.  Only a complete scan may update
    # subsystem health authority.
    if full_health_scan:
        _last_scan_success_at = time.time()
        _last_scan_error = None
        _last_scan_issues = int(scan.get("issues_found", 0) or 0)
    return scan


def _scheduler_task_done(task: asyncio.Task) -> None:
    global _scheduler_running, _last_task_error

    if not _scheduler_running:
        return
    _scheduler_running = False
    if task.cancelled():
        _last_task_error = "scheduler_task_cancelled_unexpectedly"
        return
    try:
        exc = task.exception()
    except Exception as task_exc:
        _last_task_error = _format_error("scheduler_task_observation_failed", task_exc)
        return
    _last_task_error = (
        _format_error("scheduler_task_failed", exc)
        if exc is not None
        else "scheduler_task_exited_unexpectedly"
    )


async def _periodic_scan_loop() -> None:
    global _scheduler_running, _last_task_error
    try:
        while True:
            async with _lock:
                if not _scheduler_running:
                    break
            try:
                await _run_scan()
            except Exception:
                # _run_scan retains the failure for the status surface. Continue
                # probing so a transient failure can recover without a restart.
                pass
            await asyncio.sleep(_scan_interval)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        _last_task_error = _format_error("scheduler_task_failed", exc)
        _scheduler_running = False
        raise


def _scheduler_task_state() -> tuple[str, Optional[str]]:
    task = _scheduler_task
    if task is None:
        return "missing", None
    if task.cancelled():
        return "cancelled", "scheduler_task_cancelled_unexpectedly"
    if not task.done():
        return "running", None
    try:
        exc = task.exception()
    except BaseException as task_exc:
        return "error", _format_error("scheduler_task_observation_failed", task_exc)
    if exc is not None:
        return "error", _format_error("scheduler_task_failed", exc)
    return "exited", "scheduler_task_exited_unexpectedly"


def _sentinel_health_snapshot(*, now: Optional[float] = None) -> Dict[str, Any]:
    observed = time.time() if now is None else now
    stale_after = max(
        MIN_SCAN_STALE_SECONDS,
        float(_scan_interval) * SCAN_STALE_INTERVAL_MULTIPLIER,
    )
    task_state, observed_task_error = _scheduler_task_state()
    task_error = _last_task_error or observed_task_error
    scan_age = _age_seconds(_last_scan_success_at, now=observed)
    attempt_age = _age_seconds(_last_scan_attempt_at, now=observed)
    scan_belongs_to_current_run = bool(
        _last_scan_success_at is not None
        and _scheduler_started_at is not None
        and _last_scan_success_at >= _scheduler_started_at
    )

    health_error = _startup_error or _last_load_error or _last_save_error or task_error
    if health_error:
        status, severity, reason = "error", "unavailable", health_error
    elif not _scheduler_running:
        status, severity, reason = "stopped", "unavailable", "scheduler_not_running"
    elif task_state != "running":
        status, severity, reason = "error", "unavailable", f"scheduler_task_{task_state}"
    elif _last_scan_error and (
        _last_scan_success_at is None
        or (_last_scan_attempt_at or 0.0) >= _last_scan_success_at
    ):
        status, severity, reason = "error", "degraded", _last_scan_error
    elif not scan_belongs_to_current_run:
        status, severity, reason = "starting", "degraded", "no_successful_scan_for_current_scheduler_run"
    elif scan_age is None or scan_age > stale_after:
        status, severity, reason = "stale", "degraded", "successful_scan_is_stale"
    elif int(_last_scan_issues or 0) > 0:
        status, severity, reason = "degraded", "degraded", "latest_scan_found_issues"
    else:
        status, severity, reason = "active", "healthy", "scheduler_and_scan_are_healthy"

    success = status == "active"
    return {
        "success": success,
        "status": status,
        "severity": severity,
        "health_reason": reason,
        "scheduler_running": bool(_scheduler_running and task_state == "running"),
        "scheduler_requested": _scheduler_running,
        "scheduler_task_state": task_state,
        "scheduler_started_at": _timestamp_iso(_scheduler_started_at),
        "last_scan_attempt_at": _timestamp_iso(_last_scan_attempt_at),
        "last_scan_attempt_age_seconds": attempt_age,
        "last_scan_success_at": _timestamp_iso(_last_scan_success_at),
        "last_scan_age_seconds": scan_age,
        "scan_stale_after_seconds": stale_after,
        "latest_scan_issues": _last_scan_issues,
        "startup_error": _startup_error,
        "load_error": _last_load_error,
        "save_error": _last_save_error,
        "scan_error": _last_scan_error,
        "task_error": task_error,
    }


@router.get("/status")
async def sentinel_status():
    health = _sentinel_health_snapshot()
    return {
        **health,
        "level": 21,
        "name": "Sentinel",
        "scan_interval_seconds": _scan_interval,
        "active_watchers": len(_watchers),
        "scans_completed": len(_scan_history),
        "self_heal_events": len(_self_heal_events),
        "capabilities": ["endpoint_watching", "manual_scan", "scheduled_scan", "scan_history", "self_heal"],
    }


@router.post("/watch")
async def add_watcher(request: WatchRequest):
    wtype = (request.watch_type or "").strip().lower()
    if wtype not in {"endpoint"}:
        raise HTTPException(status_code=400, detail=f"Unsupported watch_type: {wtype} (supported: endpoint)")

    target = _normalize_target("pending", request.target)

    async with _lock:
        for wid, w in _watchers.items():
            if w.get("type") == wtype and str(w.get("target")) == str(target):
                return {"success": True, "watch_id": wid, "name": request.name, "reused": True}

        watch_id = f"watch_{len(_watchers) + 1}"
        _watchers[watch_id] = {
            "name": request.name,
            "type": wtype,
            "target": target,
            "timeout_s": float(request.timeout_seconds or DEFAULT_ENDPOINT_TIMEOUT_S),
            "added_at": _now_iso(),
        }

    _save_watchers()
    return {"success": True, "watch_id": watch_id, "name": request.name}


@router.get("/scheduler/status")
async def scheduler_status():
    health = _sentinel_health_snapshot()
    return {
        **health,
        "running": health["scheduler_running"],
        "interval_seconds": _scan_interval,
        "scans_completed": len(_scan_history),
        "watchers_count": len(_watchers),
    }


@router.post("/scheduler/start")
async def start_scheduler(interval_seconds: Optional[int] = None):
    global _scheduler_running, _scheduler_task, _scan_interval
    global _scheduler_started_at, _last_task_error
    async with _lock:
        if interval_seconds is not None:
            _scan_interval = max(10, int(interval_seconds))
        if _scheduler_running and _scheduler_task and not _scheduler_task.done():
            return {"success": True, "message": "Already running"}
        _scheduler_running = True
        _scheduler_started_at = time.time()
        _last_task_error = None
        _scheduler_task = asyncio.create_task(_periodic_scan_loop())
        _scheduler_task.add_done_callback(_scheduler_task_done)
        return {"success": True, "message": "Scheduler started", "interval_seconds": _scan_interval}


@router.post("/scheduler/stop")
async def stop_scheduler():
    global _scheduler_running, _scheduler_task
    async with _lock:
        _scheduler_running = False
        if _scheduler_task and not _scheduler_task.done():
            _scheduler_task.cancel()
        _scheduler_task = None
    return {"success": True, "message": "Scheduler stopped"}


@router.post("/scheduler/scan_now")
async def scan_now():
    scan = await _run_scan()
    return {"success": True, "scan": scan}


@router.post("/scan")
async def manual_scan(req: ScanRequest):
    scan = await _run_scan(only_watch_id=req.only_watch_id, timeout_override=req.timeout_seconds)
    return {"success": True, "scan": scan}


@router.get("/history")
async def history(limit: int = 20):
    limit = max(1, min(int(limit), 200))
    return {"success": True, "total": len(_scan_history), "history": _scan_history[-limit:]}


@router.get("/self_heal/status")
async def self_heal_status(limit: int = 20):
    limit = max(1, min(int(limit), 200))
    return {
        "success": True,
        "events_total": len(_self_heal_events),
        "recent_events": _self_heal_events[-limit:],
        "auto_normalization": True,
    }
