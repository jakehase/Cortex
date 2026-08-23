from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from cortex_server.internal_addressing import CORTEX_INTERNAL_BASE_URL
from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    assert_action_authorized,
    require_action_capability,
)
from cortex_server.outbound_egress import (
    EgressError,
    EgressPolicy,
    request as outbound_request,
    validate_destination,
)
from cortex_server.runtime.resilient_json_state import (
    ResilientJSONStateError,
    ResilientJSONStateStore,
    StateCorruptionError,
)


@asynccontextmanager
async def _sentinel_lifespan(_app):
    _load_watchers()
    try:
        yield
    finally:
        try:
            await stop_scheduler()
        except Exception:
            pass


router = APIRouter(lifespan=_sentinel_lifespan)

_scheduler_running: bool = False
_scheduler_task: Optional[asyncio.Task] = None
_scan_interval: int = 1800
_lock: asyncio.Lock = asyncio.Lock()

_watchers: Dict[str, Dict[str, Any]] = {}
_scan_history: List[Dict[str, Any]] = []

MAX_HISTORY = 120
MAX_WATCHERS = 1000
DEFAULT_ENDPOINT_TIMEOUT_S = 2.5
MAX_ENDPOINT_RESPONSE_BYTES = 64_000
BASE_URL = CORTEX_INTERNAL_BASE_URL
STATE_FILE = Path(
    os.getenv(
        "CORTEX_SENTINEL_STATE_PATH",
        "/opt/clawdbot/state/sentinel/watchers.json",
    )
).expanduser()
if not STATE_FILE.is_absolute():
    raise ValueError("CORTEX_SENTINEL_STATE_PATH must be absolute")
_self_heal_events: List[Dict[str, Any]] = []
_watcher_store_instance: Optional[ResilientJSONStateStore] = None
_watcher_store_path: Optional[Path] = None


def _validate_watcher_state(payload: Any) -> Dict[str, Dict[str, Any]]:
    if not isinstance(payload, dict):
        raise ValueError("Sentinel watcher state must be an object")
    if len(payload) > MAX_WATCHERS:
        raise ValueError("Sentinel watcher state exceeds watcher limit")
    validated: Dict[str, Dict[str, Any]] = {}
    for watch_id, row in payload.items():
        if not isinstance(watch_id, str) or not watch_id.strip():
            raise ValueError("Sentinel watcher IDs must be non-empty strings")
        if not isinstance(row, dict):
            raise ValueError("Sentinel watcher records must be objects")
        if row.get("type") != "endpoint":
            raise ValueError("Sentinel watcher type must be endpoint")
        if not isinstance(row.get("target"), str) or not row.get("target", "").strip():
            raise ValueError("Sentinel watcher target must be non-empty")
        timeout = row.get("timeout_s", DEFAULT_ENDPOINT_TIMEOUT_S)
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 < float(timeout) <= 120:
            raise ValueError("Sentinel watcher timeout is invalid")
        if row.get("name") is not None and not isinstance(row.get("name"), str):
            raise ValueError("Sentinel watcher name must be a string")
        if row.get("added_at") is not None and not isinstance(row.get("added_at"), str):
            raise ValueError("Sentinel watcher added_at must be a string")
        validated[watch_id] = dict(row)
    return validated


def _watcher_store() -> ResilientJSONStateStore:
    global _watcher_store_instance, _watcher_store_path
    path = Path(STATE_FILE)
    if _watcher_store_instance is None or _watcher_store_path != path:
        _watcher_store_instance = ResilientJSONStateStore(
            path,
            validator=_validate_watcher_state,
            max_state_bytes=2_000_000,
        )
        _watcher_store_path = path
    return _watcher_store_instance


def watcher_state_health() -> Dict[str, Any]:
    return _watcher_store().health


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


def _save_watchers() -> None:
    _watcher_store().save(dict(_watchers))


def _load_watchers() -> bool:
    try:
        data = _watcher_store().load(default_factory=dict)
    except (StateCorruptionError, ResilientJSONStateError, OSError, ValueError):
        # Never retain stale in-memory targets when the durable source cannot be
        # trusted. The store health carries the exact recovery/quarantine state.
        _watchers.clear()
        return False
    _watchers.clear()
    _watchers.update(data)
    return True

def _record_heal(watch_id: str, before: str, after: str, reason: str):
    before_bytes = str(before or "").encode("utf-8", errors="replace")
    after_bytes = str(after or "").encode("utf-8", errors="replace")
    _self_heal_events.append({
        "timestamp": _now_iso(),
        "watch_id": watch_id,
        "before": "[REDACTED]",
        "before_sha256": hashlib.sha256(before_bytes).hexdigest(),
        "after": "[REDACTED]",
        "after_sha256": hashlib.sha256(after_bytes).hexdigest(),
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


def _authorized_persistent_target(value: str) -> str:
    """Admit only exact server-owned, query-free persistent watch targets."""

    from urllib.parse import urlsplit

    target = str(value or "").strip()
    try:
        parsed = urlsplit(target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid Sentinel target") from exc
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise HTTPException(
            status_code=400,
            detail="persistent Sentinel targets must be query-free HTTP(S) URLs",
        )
    configured = tuple(
        item.strip()
        for item in os.getenv("CORTEX_SENTINEL_PERSISTENT_TARGETS", "").split(",")
        if item.strip()
    )
    if not any(hmac.compare_digest(target, item) for item in configured):
        raise HTTPException(
            status_code=403,
            detail="Sentinel target is not in the server-owned persistent target policy",
        )
    return target


async def _check_endpoint(url: str, timeout_s: float) -> Dict[str, Any]:
    t0 = time.time()
    try:
        r = await outbound_request(
            "GET",
            url,
            policy=EgressPolicy.from_environment("sentinel"),
            timeout=timeout_s,
            max_response_bytes=MAX_ENDPOINT_RESPONSE_BYTES,
        )
        return {
            "ok": True,
            "status_code": r.status_code,
            "latency_ms": int((time.time() - t0) * 1000),
        }
    except EgressError as exc:
        return {
            "ok": False,
            "error": type(exc).__name__,
            "latency_ms": int((time.time() - t0) * 1000),
        }


async def _run_scan(
    only_watch_id: Optional[str] = None,
    timeout_override: Optional[float] = None,
    authorization: Optional[ActionAuthorization] = None,
) -> Dict[str, Any]:
    assert_action_authorized(authorization)
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
        target = _authorized_persistent_target(target)
        if w.get("target") != target:
            # Serialize the in-memory transition with add_watcher and commit
            # the same snapshot under the durable store lock. Never mutate the
            # list() snapshot before acquiring ownership of the live record.
            async with _lock:
                live = _watchers.get(watch_id)
                if live is not None and live.get("target") == w.get("target"):
                    previous_target = live.get("target")
                    live["target"] = target
                    try:
                        _save_watchers()
                    except (ResilientJSONStateError, OSError, ValueError) as exc:
                        live["target"] = previous_target
                        raise HTTPException(
                            status_code=503,
                            detail="Sentinel watcher persistence is degraded",
                        ) from exc

        target_bytes = target.encode("utf-8", errors="replace")
        raw_name = str(w.get("name") or "")
        res: Dict[str, Any] = {
            "watch_id": watch_id,
            "name": "[REDACTED]" if raw_name else "",
            "name_sha256": hashlib.sha256(raw_name.encode("utf-8", errors="replace")).hexdigest() if raw_name else None,
            "type": wtype,
            "target": "[REDACTED]",
            "target_sha256": hashlib.sha256(target_bytes).hexdigest(),
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
    persistence = watcher_state_health()
    persistence_healthy = persistence.get("status") == "healthy"
    return {
        "success": True,
        "level": 21,
        "name": "Sentinel",
        "status": "active" if persistence_healthy else "degraded",
        "severity": "healthy" if persistence_healthy else "degraded",
        "scheduler_running": _scheduler_running,
        "scan_interval_seconds": _scan_interval,
        "active_watchers": len(_watchers),
        "scans_completed": len(_scan_history),
        "self_heal_events": len(_self_heal_events),
        "persistence": persistence,
        "capabilities": ["endpoint_watching", "manual_scan", "scheduled_scan", "scan_history", "self_heal"],
    }


@router.post("/watch")
async def add_watcher(
    request: WatchRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
):
    assert_action_authorized(authorization)
    wtype = (request.watch_type or "").strip().lower()
    if wtype not in {"endpoint"}:
        raise HTTPException(status_code=400, detail=f"Unsupported watch_type: {wtype} (supported: endpoint)")

    target = _normalize_target("pending", request.target)
    try:
        await validate_destination(
            target,
            EgressPolicy.from_environment("sentinel"),
        )
    except EgressError as exc:
        raise HTTPException(
            status_code=400,
            detail="watch target is not permitted by the server egress policy",
        ) from exc
    target = _authorized_persistent_target(target)

    async with _lock:
        for wid, w in _watchers.items():
            if w.get("type") == wtype and str(w.get("target")) == str(target):
                return {"success": True, "watch_id": wid, "name": "[REDACTED]", "reused": True}

        prior_watchers = dict(_watchers)
        watch_id = f"watch_{len(_watchers) + 1}"
        _watchers[watch_id] = {
            "name": "[REDACTED]",
            "name_sha256": hashlib.sha256(
                request.name.encode("utf-8", errors="replace")
            ).hexdigest(),
            "type": wtype,
            "target": target,
            "timeout_s": float(request.timeout_seconds or DEFAULT_ENDPOINT_TIMEOUT_S),
            "added_at": _now_iso(),
        }
        try:
            _save_watchers()
        except (ResilientJSONStateError, OSError, ValueError) as exc:
            _watchers.clear()
            _watchers.update(prior_watchers)
            raise HTTPException(
                status_code=503,
                detail="Sentinel watcher persistence is degraded",
            ) from exc
    return {"success": True, "watch_id": watch_id, "name": "[REDACTED]"}


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
    raise HTTPException(
        status_code=503,
        detail="Sentinel scheduled scans require a per-run delegated action capability",
    )


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
async def scan_now(
    authorization: ActionAuthorization = Depends(require_action_capability),
):
    scan = await _run_scan(authorization=authorization)
    return {"success": True, "scan": scan}


@router.post("/scan")
async def manual_scan(
    req: ScanRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
):
    scan = await _run_scan(
        only_watch_id=req.only_watch_id,
        timeout_override=req.timeout_seconds,
        authorization=authorization,
    )
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
