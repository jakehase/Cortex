"""Measured level availability for the running Cortex application.

Several levels (L1 Kernel, L23 Cartographer, L36 Meta-conductor, L37
Awareness) need to answer "which levels are actually available right now?".
Before this module each of them guessed: Kernel hard-coded ``online`` for all
38 levels, Cartographer probed status routes over unauthenticated HTTP (and
reported the resulting 403s as degradation), and Awareness called admin-only
routes with a principal signature that could never pass.

This module derives availability from three measured sources only:

1. **Mount state** — the concrete routes in ``app.routes`` plus
   ``app.state.router_load_report`` (what ``load_dynamic_routers`` actually
   loaded, partially loaded, skipped in safe mode, or failed to import).
2. **Recent evidence** — the per-request ring kept by
   ``modules.metrics_store`` (status codes observed on each level's routes).
3. **In-process probes** — the level's canonical status handler is invoked
   directly through its Starlette route object (no network, no credentials,
   no auth middleware involved), and the HTTP status plus the handler's own
   self-reported status are recorded.

Nothing here makes network calls or writes files.  Probe results are cached
with a timestamp so status endpoints can report freshness instead of
re-probing on every request.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import sys
import time
import weakref
from contextlib import AsyncExitStack
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

from cortex_server.modules.health_status import (
    DEGRADED,
    DISABLED_BY_DESIGN,
    FAILED,
    OPERATIONAL,
    RESTRICTED_BY_DESIGN,
    STALE_EVIDENCE,
    UNTESTED,
    normalize_status,
)
from cortex_server.modules.level_registry import LEVEL_REGISTRY_VERSION, get_level_registry

PROBE_SCHEMA_VERSION = "cortex.level-probe.v2"
DEFAULT_PROBE_TIMEOUT_S = 3.0
DEFAULT_PROBE_CONCURRENCY = 8
MAX_PROBE_BODY_BYTES = 256_000
DEFAULT_CACHE_TTL_S = 30.0

# Canonical self-reported statuses that mean "this level says it is not healthy".
UNHEALTHY_REPORTED_STATUSES = frozenset(
    {DEGRADED, FAILED}
)

_IN_PROBE: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "cortex_level_probe_active", default=False
)
_app_ref: Any = None
_probe_cache: Dict[str, Any] = {"snapshot": None, "measured_monotonic": None}
_refresh_tasks: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Task]" = (
    weakref.WeakKeyDictionary()
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Locating the running application
# ---------------------------------------------------------------------------


def remember_app(app: Any) -> None:
    """Remember the running app so callers without a Request can find it."""

    global _app_ref
    if app is None:
        return
    try:
        _app_ref = weakref.ref(app)
    except TypeError:
        _app_ref = lambda: app  # noqa: E731 - strong ref fallback


def resolve_app(app: Any = None) -> Any:
    """Return the running FastAPI app without forcing lazy construction."""

    if app is not None:
        remember_app(app)
        return app
    if _app_ref is not None:
        try:
            remembered = _app_ref()
        except Exception:
            remembered = None
        if remembered is not None:
            return remembered
    main_module = sys.modules.get("cortex_server.main")
    holder = getattr(main_module, "app", None) if main_module is not None else None
    if holder is None:
        return None
    if type(holder).__name__ == "_LazyCortexApplication":
        # Read the constructed instance directly: attribute access on the lazy
        # holder would construct a second application as a side effect.
        return holder.__dict__.get("_application")
    if hasattr(holder, "routes"):
        return holder
    return None


# ---------------------------------------------------------------------------
# Mount state
# ---------------------------------------------------------------------------


def _effective_routes(app: Any) -> List[Any]:
    from cortex_server.modules.route_inventory import iter_effective_routes

    return list(iter_effective_routes(getattr(app, "routes", ()) or ()))


def mounted_route_keys(app: Any) -> Set[Tuple[str, str]]:
    keys: Set[Tuple[str, str]] = set()
    for route in _effective_routes(app):
        path = str(getattr(route, "path", "") or "")
        if not path:
            continue
        for method in getattr(route, "methods", None) or ():
            upper = str(method).upper()
            if upper in {"HEAD", "OPTIONS"}:
                continue
            keys.add((upper, path))
    return keys


def _capability_by_prefix() -> Dict[str, Any]:
    try:
        from cortex_server.capability_manifest import ROUTER_CAPABILITIES
    except Exception:
        return {}
    return {
        str(cap.prefix): cap
        for cap in ROUTER_CAPABILITIES
        if getattr(cap, "kind", "http") == "http" and getattr(cap, "prefix", "")
    }


def _router_names(rows: Any) -> Set[str]:
    names: Set[str] = set()
    for row in rows or ():
        if isinstance(row, str):
            names.add(row)
        elif isinstance(row, Mapping) and row.get("router"):
            names.add(str(row.get("router")))
    return names


def _mount_classification(module: str, report: Any, has_routes: bool) -> str:
    if not isinstance(report, Mapping):
        return "mounted" if has_routes else "not_mounted"
    if module in _router_names(report.get("failed")):
        return "import_failed"
    if module in _router_names(report.get("missingRouter")):
        return "missing_router"
    if module in _router_names(report.get("safeModeSkipped")):
        return "skipped_safe_mode"
    disabled = {
        str(row.get("router"))
        for row in report.get("disabled") or ()
        if isinstance(row, Mapping) and row.get("reason") != "safe_mode"
    }
    if module in disabled:
        return "disabled"
    if module in _router_names(report.get("safeModePartial")):
        return "safe_subset" if has_routes else "no_routes"
    if module in _router_names(report.get("loaded")):
        return "full" if has_routes else "no_routes"
    return "mounted" if has_routes else "not_loaded"


_MOUNT_TO_STATE = {
    "full": OPERATIONAL,
    "mounted": OPERATIONAL,
    "safe_subset": RESTRICTED_BY_DESIGN,
    "skipped_safe_mode": DISABLED_BY_DESIGN,
    "disabled": DISABLED_BY_DESIGN,
    "not_loaded": UNTESTED,
    "not_mounted": UNTESTED,
    "no_routes": UNTESTED,
    "import_failed": FAILED,
    "missing_router": FAILED,
}


def level_mount_states(app: Any) -> List[Dict[str, Any]]:
    """Per-level mount state derived from the running app's route table."""

    report = getattr(getattr(app, "state", None), "router_load_report", None)
    keys = mounted_route_keys(app)
    capabilities = _capability_by_prefix()
    rows: List[Dict[str, Any]] = []
    for row in get_level_registry():
        prefix = str(row["route_prefix"])
        level_routes = sorted(
            f"{method} {path}"
            for method, path in keys
            if path == prefix or path.startswith(prefix + "/")
        )
        capability = capabilities.get(prefix)
        module = str(getattr(capability, "module", "") or prefix.strip("/"))
        mount = _mount_classification(module, report, bool(level_routes))
        canonical = str(row["canonical_status"])
        canonical_mounted = ("GET", canonical) in keys
        state = _MOUNT_TO_STATE.get(mount, UNTESTED)
        reason = mount
        if state == OPERATIONAL and not canonical_mounted:
            state, reason = DEGRADED, "canonical_status_route_missing"
        aliases = [
            {"path": str(alias), "mounted": ("GET", str(alias)) in keys}
            for alias in row.get("aliases") or ()
        ]
        rows.append(
            {
                "level": int(row["level"]),
                "name": str(row["name"]),
                "slug": str(row["slug"]),
                "route_prefix": prefix,
                "router_module": module,
                "canonical_status": canonical,
                "canonical_status_mounted": canonical_mounted,
                "mount": mount,
                "status": state,
                "reason": reason,
                "mounted_route_count": len(level_routes),
                "mounted_routes": level_routes[:64],
                "aliases": aliases,
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Recent evidence (metrics_store ring)
# ---------------------------------------------------------------------------


def _recent_requests() -> List[Dict[str, Any]]:
    try:
        from cortex_server.modules import metrics_store
    except Exception:
        return []
    public = getattr(metrics_store, "recent_requests", None)
    if callable(public):
        try:
            rows = public()
            return [dict(row) for row in rows if isinstance(row, Mapping)]
        except Exception:
            return []
    lock = getattr(metrics_store, "_LOCK", None)
    ring = getattr(metrics_store, "_RECENT", None)
    if lock is None or ring is None:
        return []
    with lock:
        return [dict(row) for row in ring if isinstance(row, Mapping)]


def recent_level_evidence(prefixes: Iterable[str], *, own_paths: Sequence[str] = ()) -> Dict[str, Dict[str, Any]]:
    """Summarise observed responses per route prefix (since boot, bounded ring)."""

    wanted = [str(p) for p in prefixes]
    excluded = set(own_paths)
    evidence: Dict[str, Dict[str, Any]] = {
        prefix: {"requests": 0, "server_errors": 0, "last_status": None, "last_at": None, "recent_statuses": []}
        for prefix in wanted
    }
    for row in _recent_requests():
        path = str(row.get("path") or "")
        if path in excluded:
            continue
        for prefix in wanted:
            if path == prefix or path.startswith(prefix + "/"):
                item = evidence[prefix]
                status = row.get("status")
                item["requests"] += 1
                if isinstance(status, int) and status >= 500:
                    item["server_errors"] += 1
                item["last_status"] = status if isinstance(status, int) else None
                item["last_at"] = row.get("ts")
                item["recent_statuses"].append(status if isinstance(status, int) else None)
                if len(item["recent_statuses"]) > 5:
                    del item["recent_statuses"][:-5]
                break
    return evidence


# ---------------------------------------------------------------------------
# In-process probes
# ---------------------------------------------------------------------------


def _match_route(app: Any, method: str, path: str) -> Optional[Tuple[Any, Dict[str, Any]]]:
    try:
        from starlette.routing import Match
    except Exception:  # pragma: no cover - starlette is a hard dependency
        return None
    probe_scope = {"type": "http", "method": method, "path": path, "root_path": ""}
    for route in _effective_routes(app):
        matcher = getattr(route, "matches", None)
        if not callable(matcher):
            continue
        try:
            match, child_scope = matcher(probe_scope)
        except Exception:
            continue
        if match == Match.FULL:
            return route, dict(child_scope or {})
    return None


def _reported(body: Any) -> Dict[str, Any]:
    if not isinstance(body, Mapping):
        return {"reported_status": None, "reported_success": None, "reported_level": None}
    data = body.get("data") if isinstance(body.get("data"), Mapping) else {}
    status = body.get("status", data.get("status"))
    success = body.get("success")
    level = body.get("level", data.get("level"))
    return {
        # Preserve the prior contract for unfamiliar positive endpoint words:
        # only known negative legacy words map to a failure.
        "reported_status": normalize_status(status, default=OPERATIONAL) if isinstance(status, str) else None,
        "reported_status_raw": str(status).lower() if isinstance(status, str) else None,
        "reported_success": success if isinstance(success, bool) else None,
        "reported_level": level if isinstance(level, int) and not isinstance(level, bool) else None,
    }


def classify_probe(status_code: Optional[int], reported: Mapping[str, Any]) -> str:
    if status_code is None:
        return "error"
    if int(status_code) in (401, 403):
        # Mounted and enforcing authentication: an unauthenticated in-process
        # probe cannot see a principal-scoped status, but the route is alive.
        return "auth_required"
    if not 200 <= int(status_code) < 300:
        return "http_error"
    if reported.get("reported_status") in UNHEALTHY_REPORTED_STATUSES:
        return "self_reported_unhealthy"
    # Policy and freshness states are successful observations even when a
    # legacy endpoint also sets ``success=false`` to mean "not fully active".
    if reported.get("reported_status") in {
        RESTRICTED_BY_DESIGN,
        DISABLED_BY_DESIGN,
        STALE_EVIDENCE,
        UNTESTED,
    }:
        return "healthy"
    if reported.get("reported_success") is False:
        return "self_reported_unhealthy"
    return "healthy"


async def probe_route(
    app: Any,
    path: str,
    *,
    method: str = "GET",
    timeout_s: float = DEFAULT_PROBE_TIMEOUT_S,
) -> Dict[str, Any]:
    """Invoke one mounted route handler in-process and record what it returned.

    The handler runs through its own Starlette route object, so dependency
    injection and response serialisation are real, but no network hop and no
    auth middleware are involved.  Only GET status-style routes should be
    probed; nested probes are suppressed to prevent fan-out recursion.
    """

    started = time.monotonic()
    base = {"path": path, "method": method.upper(), "probed_at": _now_iso()}
    if _IN_PROBE.get():
        return {**base, "probed": False, "outcome": "nested_probe_suppressed", "latency_ms": 0.0}
    if app is None:
        return {**base, "probed": False, "outcome": "app_unavailable", "latency_ms": 0.0}
    matched = _match_route(app, method.upper(), path)
    if matched is None:
        return {**base, "probed": True, "outcome": "not_mounted", "status_code": None, "latency_ms": 0.0}
    route, child_scope = matched

    response: Dict[str, Any] = {"status": None, "body": bytearray(), "truncated": False}
    delivered = {"done": False}

    async def receive() -> Dict[str, Any]:
        if not delivered["done"]:
            delivered["done"] = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await asyncio.Event().wait()
        return {"type": "http.disconnect"}  # pragma: no cover

    async def send(message: Mapping[str, Any]) -> None:
        kind = message.get("type")
        if kind == "http.response.start":
            response["status"] = int(message.get("status") or 0)
        elif kind == "http.response.body":
            chunk = bytes(message.get("body") or b"")
            room = MAX_PROBE_BODY_BYTES - len(response["body"])
            if room > 0:
                response["body"].extend(chunk[:room])
            if len(chunk) > max(room, 0):
                response["truncated"] = True

    scope: Dict[str, Any] = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method.upper(),
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("utf-8"),
        "root_path": "",
        "query_string": b"",
        "headers": [(b"host", b"cortex-level-probe"), (b"user-agent", b"cortex-level-probe/1")],
        "client": ("127.0.0.1", 0),
        "server": ("127.0.0.1", 0),
        "app": app,
        "router": getattr(app, "router", None),
        "state": {},
        "extensions": {},
    }
    scope.update(child_scope)

    async def dispatch() -> None:
        async with AsyncExitStack() as stack:
            # FastAPI releases differ in which exit-stack key the request
            # handler expects the (normally middleware-provided) stack under.
            scope["fastapi_astack"] = stack
            scope["fastapi_middleware_astack"] = stack
            await route.handle(scope, receive, send)

    outcome_error: Optional[str] = None
    token = _IN_PROBE.set(True)
    try:
        await asyncio.wait_for(dispatch(), timeout=max(0.1, float(timeout_s)))
    except asyncio.TimeoutError:
        outcome_error = "timeout"
    except Exception as exc:  # HTTPException carries a real status code
        status_code = getattr(exc, "status_code", None)
        if isinstance(status_code, int) and response["status"] is None:
            response["status"] = status_code
        else:
            outcome_error = type(exc).__name__
    finally:
        _IN_PROBE.reset(token)

    latency_ms = round((time.monotonic() - started) * 1000.0, 2)
    status_code = response["status"]
    body: Any = None
    if response["body"] and not response["truncated"]:
        try:
            body = json.loads(bytes(response["body"]).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            body = None
    reported = _reported(body)
    if outcome_error == "timeout":
        outcome = "timeout"
    elif outcome_error is not None and status_code is None:
        outcome = "error"
    else:
        outcome = classify_probe(status_code, reported)
    return {
        **base,
        "probed": True,
        "status_code": status_code,
        "outcome": outcome,
        "error_type": outcome_error,
        "latency_ms": latency_ms,
        **reported,
    }


async def probe_levels(
    app: Any = None,
    *,
    levels: Optional[Iterable[int]] = None,
    timeout_s: float = DEFAULT_PROBE_TIMEOUT_S,
    concurrency: int = DEFAULT_PROBE_CONCURRENCY,
) -> Dict[str, Any]:
    """Mount state plus an in-process probe of each mounted canonical status."""

    resolved = resolve_app(app)
    started = time.monotonic()
    if resolved is None:
        return {
            "schemaVersion": PROBE_SCHEMA_VERSION,
            "available": False,
            "reason": "app_unavailable",
            "measured_at": _now_iso(),
            "levels": [],
        }
    wanted = {int(level) for level in levels} if levels is not None else None
    states = [row for row in level_mount_states(resolved) if wanted is None or row["level"] in wanted]
    semaphore = asyncio.Semaphore(max(1, int(concurrency)))

    async def one(row: Dict[str, Any]) -> Dict[str, Any]:
        if not row["canonical_status_mounted"]:
            return {**row, "probe": {"probed": False, "outcome": "not_mounted"}}
        async with semaphore:
            probe = await probe_route(resolved, row["canonical_status"], timeout_s=timeout_s)
        merged = {**row, "probe": probe}
        identity_ok = probe.get("reported_level") in (None, row["level"])
        if probe.get("outcome") == "nested_probe_suppressed":
            return merged
        reported_status = probe.get("reported_status")
        if row["status"] in {OPERATIONAL, RESTRICTED_BY_DESIGN}:
            if probe.get("outcome") != "healthy":
                merged["status"] = (
                    reported_status
                    if probe.get("outcome") == "self_reported_unhealthy"
                    and reported_status in {DEGRADED, FAILED}
                    else DEGRADED
                )
                merged["reason"] = f"probe_{probe.get('outcome')}"
            elif not identity_ok:
                merged["status"] = DEGRADED
                merged["reason"] = "probe_identity_mismatch"
            elif reported_status in {
                RESTRICTED_BY_DESIGN,
                DISABLED_BY_DESIGN,
                STALE_EVIDENCE,
                UNTESTED,
                DEGRADED,
                FAILED,
            }:
                # A safe-mode mount remains restricted even when its handler
                # reports operational; otherwise the handler's canonical state
                # is more specific than mount availability.
                merged["status"] = reported_status
                merged["reason"] = f"self_reported_{reported_status}"
        return merged

    rows = await asyncio.gather(*(one(row) for row in states))
    snapshot = {
        "schemaVersion": PROBE_SCHEMA_VERSION,
        "available": True,
        "registry_version": LEVEL_REGISTRY_VERSION,
        "measured_at": _now_iso(),
        "elapsed_ms": round((time.monotonic() - started) * 1000.0, 2),
        "probe_mode": "in_process_route_handler",
        "levels": sorted(rows, key=lambda r: r["level"]),
    }
    if wanted is None:
        _probe_cache["snapshot"] = snapshot
        _probe_cache["measured_monotonic"] = time.monotonic()
    return snapshot


def cached_probe_snapshot(max_age_s: Optional[float] = DEFAULT_CACHE_TTL_S) -> Optional[Dict[str, Any]]:
    """Return the last full probe snapshot (with its age) if fresh enough."""

    snapshot = _probe_cache.get("snapshot")
    measured = _probe_cache.get("measured_monotonic")
    if snapshot is None or measured is None:
        return None
    age = max(0.0, time.monotonic() - float(measured))
    if max_age_s is not None and age > float(max_age_s):
        return None
    return {**snapshot, "age_s": round(age, 3)}


def probe_snapshot_age_s() -> Optional[float]:
    measured = _probe_cache.get("measured_monotonic")
    if measured is None:
        return None
    return round(max(0.0, time.monotonic() - float(measured)), 3)


async def refresh_probe_snapshot(app: Any = None, *, max_age_s: float = DEFAULT_CACHE_TTL_S) -> Optional[Dict[str, Any]]:
    """Single-flight refresh; returns a fresh snapshot (cached if recent)."""

    cached = cached_probe_snapshot(max_age_s)
    if cached is not None:
        return cached
    if _IN_PROBE.get():
        return cached_probe_snapshot(None)
    loop = asyncio.get_running_loop()
    task = _refresh_tasks.get(loop)
    if task is None or task.done():
        task = loop.create_task(probe_levels(app), name="cortex-level-probe-refresh")
        _refresh_tasks[loop] = task
    snapshot = await asyncio.shield(task)
    if not snapshot.get("available", True):
        return {**snapshot, "age_s": None}
    age = probe_snapshot_age_s()
    return {**snapshot, "age_s": age if age is not None else 0.0}


def schedule_probe_refresh(app: Any = None, *, max_age_s: float = DEFAULT_CACHE_TTL_S) -> bool:
    """Start a background refresh if the cache is stale; never blocks."""

    if cached_probe_snapshot(max_age_s) is not None or _IN_PROBE.get():
        return False
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return False
    task = _refresh_tasks.get(loop)
    if task is not None and not task.done():
        return False
    if resolve_app(app) is None:
        return False
    task = loop.create_task(probe_levels(app), name="cortex-level-probe-refresh")
    task.add_done_callback(lambda t: t.cancelled() or t.exception())
    _refresh_tasks[loop] = task
    return True


def refresh_in_progress() -> bool:
    """True while a probe sweep is running (including inside a probed handler)."""

    if _IN_PROBE.get():
        return True
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return False
    task = _refresh_tasks.get(loop)
    return task is not None and not task.done()


def reset_probe_cache() -> None:
    """Test helper: forget cached probe results."""

    _probe_cache["snapshot"] = None
    _probe_cache["measured_monotonic"] = None
