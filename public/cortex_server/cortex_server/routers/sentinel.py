from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timezone
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
    global _startup_error
    _startup_error = None
    try:
        _load_watchers()
    except Exception as exc:
        _startup_error = _format_error("watcher_load_failed", exc)
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
MAX_WATCHERS = 1000
DEFAULT_ENDPOINT_TIMEOUT_S = 2.5
MIN_SCAN_STALE_SECONDS = 30.0
SCAN_STALE_INTERVAL_MULTIPLIER = 2.0
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
    # Status telemetry is intentionally structural: exception messages can
    # contain watched URLs, credentials, or other caller-controlled material.
    return f"{stage}:{type(exc).__name__}"


def _find_exception(exc: BaseException, kind: type[BaseException]) -> Optional[BaseException]:
    """Return the first matching exception in a bounded cause/context chain."""

    current: Optional[BaseException] = exc
    seen: set[int] = set()
    for _ in range(16):
        if current is None or id(current) in seen:
            break
        if isinstance(current, kind):
            return current
        seen.add(id(current))
        current = current.__cause__ or current.__context__
    return None


def _save_watchers() -> None:
    global _last_save_error
    try:
        if Path(STATE_FILE).is_dir():
            raise IsADirectoryError("Sentinel watcher state path is a directory")
        _watcher_store().save(dict(_watchers))
        _last_save_error = None
    except Exception as exc:
        surfaced = _find_exception(exc, IsADirectoryError) or exc
        _last_save_error = _format_error("watcher_save_failed", surfaced)
        if surfaced is not exc:
            raise surfaced from exc
        raise


def _load_watchers() -> bool:
    global _last_load_error
    try:
        data = _watcher_store().load(default_factory=dict)
    except (StateCorruptionError, ResilientJSONStateError, OSError, ValueError) as exc:
        # Never retain stale in-memory targets when the durable source cannot be
        # trusted. The store health carries the exact recovery/quarantine state.
        _watchers.clear()
        surfaced = _find_exception(exc, IsADirectoryError)
        if surfaced is not None:
            _last_load_error = _format_error("watcher_load_failed", surfaced)
            raise surfaced from exc
        _last_load_error = None
        return False
    _watchers.clear()
    _watchers.update(data)
    _last_load_error = None
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

    # Backward-compatible normalization remains subject to the exact,
    # server-owned persistent-target allowlist below.
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


async def _execute_scan(
    only_watch_id: Optional[str] = None,
    timeout_override: Optional[float] = None,
) -> Dict[str, Any]:
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


async def _run_scan(
    only_watch_id: Optional[str] = None,
    timeout_override: Optional[float] = None,
    authorization: Optional[ActionAuthorization] = None,
) -> Dict[str, Any]:
    global _last_scan_attempt_at, _last_scan_success_at
    global _last_scan_error, _last_scan_issues

    assert_action_authorized(authorization)
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
    persistence = watcher_state_health()
    persistence_healthy = persistence.get("status") == "healthy"
    if not persistence_healthy and health.get("status") != "error":
        health = {
            **health,
            "success": False,
            "status": "degraded",
            "severity": "degraded",
            "health_reason": f"watcher_persistence_{persistence.get('reason', 'degraded')}",
        }
    return {
        **health,
        "level": 21,
        "name": "Sentinel",
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
