from __future__ import annotations

import asyncio
import time
import json
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

_scheduler_running: bool = False
_scheduler_task: Optional[asyncio.Task] = None
_scan_interval: int = 1800
_lock: asyncio.Lock = asyncio.Lock()

_watchers: Dict[str, Dict[str, Any]] = {}
_scan_history: List[Dict[str, Any]] = []

MAX_HISTORY = 120
DEFAULT_ENDPOINT_TIMEOUT_S = 2.5
BASE_URL = "http://127.0.0.1:8888"
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
    return datetime.now().isoformat()


def _save_watchers():
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(_watchers))
    except Exception:
        pass


def _load_watchers():
    try:
        if STATE_FILE.exists():
            data = json.loads(STATE_FILE.read_text())
            if isinstance(data, dict):
                _watchers.clear()
                _watchers.update(data)
    except Exception:
        pass



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

    # Backward-compat self-heal: legacy L9 alias /architect/status now maps to /meta_conductor/status.
    if t.endswith("/architect/status"):
        fixed = t[: -len("/architect/status")] + "/meta_conductor/status"
        _record_heal(watch_id, t, fixed, "deprecated_architect_alias")
        return fixed

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


async def _run_scan(only_watch_id: Optional[str] = None, timeout_override: Optional[float] = None) -> Dict[str, Any]:
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


async def _periodic_scan_loop() -> None:
    global _scheduler_running
    while True:
        async with _lock:
            if not _scheduler_running:
                break
        try:
            await _run_scan()
        except Exception:
            pass
        await asyncio.sleep(_scan_interval)


@router.get("/status")
async def sentinel_status():
    return {
        "success": True,
        "level": 21,
        "name": "Sentinel",
        "status": "active",
        "severity": "healthy",
        "scheduler_running": _scheduler_running,
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
    return {
        "success": True,
        "running": _scheduler_running,
        "interval_seconds": _scan_interval,
        "scans_completed": len(_scan_history),
        "watchers_count": len(_watchers),
    }


@router.post("/scheduler/start")
async def start_scheduler(interval_seconds: Optional[int] = None):
    global _scheduler_running, _scheduler_task, _scan_interval
    async with _lock:
        if interval_seconds is not None:
            _scan_interval = max(10, int(interval_seconds))
        if _scheduler_running and _scheduler_task and not _scheduler_task.done():
            return {"success": True, "message": "Already running"}
        _scheduler_running = True
        _scheduler_task = asyncio.create_task(_periodic_scan_loop())
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


@router.on_event("startup")
async def auto_start_scheduler():
    try:
        _load_watchers()
        await start_scheduler()
    except Exception:
        pass
