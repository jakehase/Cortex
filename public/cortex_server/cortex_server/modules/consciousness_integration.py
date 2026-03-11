"""
Consciousness Integration — Drop-in SDK for routers to participate in the unified brain.

Usage in any router:

    from cortex_server.modules.consciousness_integration import conscious_action, chain_to

    @router.post("/evaluate")
    async def evaluate(request):
        async with conscious_action("ethicist", "evaluate", {"action": request.action}) as ctx:
            # ... do your actual work ...
            result = await call_oracle(...)
            ctx.set_result(result)  # contributes to thought stream
        return result

All helpers are fail-safe: consciousness errors are logged but never propagate
to the caller, so existing router logic is never broken.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

import httpx

logger = logging.getLogger("consciousness_integration")

# ---------------------------------------------------------------------------
# Internal singleton accessors (lazy, import-safe)
# ---------------------------------------------------------------------------

def _get_core():
    """Return the ConsciousnessCore singleton (never raises)."""
    try:
        from cortex_server.modules.consciousness_core import get_consciousness_core
        return get_consciousness_core()
    except Exception:
        logger.debug("consciousness_core unavailable", exc_info=True)
        return None


def _get_bus():
    """Return the ConsciousnessBus singleton (never raises)."""
    try:
        from cortex_server.modules.unified_messaging import get_bus
        return get_bus()
    except Exception:
        logger.debug("unified_messaging unavailable", exc_info=True)
        return None


def _report(level_name: str, activity_type: str, data: dict):
    """Report to auto_reporting (never raises)."""
    try:
        from cortex_server.modules.auto_reporting import report_activity
        report_activity(level_name, activity_type, data)
    except Exception:
        logger.debug("auto_reporting unavailable", exc_info=True)


# ---------------------------------------------------------------------------
# 1.  conscious_action — async context manager
# ---------------------------------------------------------------------------

class _ConsciousActionContext:
    """Accumulates result data inside a ``conscious_action`` block."""

    def __init__(self):
        self._result: Any = None
        self._has_result = False

    def set_result(self, result: Any):
        """Mark the action result so it is contributed to the thought stream on exit."""
        self._result = result
        self._has_result = True

    @property
    def result(self) -> Any:
        return self._result

    @property
    def has_result(self) -> bool:
        return self._has_result


@asynccontextmanager
async def conscious_action(level_name: str, action_type: str, input_data: Any = None):
    """Async context manager that wires a router action into the consciousness.

    On enter:
        - Contributes a "start" thought to ConsciousnessCore
        - Broadcasts ``action_start`` on the bus

    On exit (success):
        - Contributes a "complete" thought with the result (if ``ctx.set_result`` was called)
        - Reports the activity via auto_reporting
        - Broadcasts ``action_complete`` on the bus

    On exit (exception):
        - Contributes an "error" thought
        - Broadcasts ``action_error`` on the bus
        - **Re-raises** the original exception (consciousness never swallows router errors)
    """
    ctx = _ConsciousActionContext()
    started_at = time.monotonic()

    # ── Enter ──
    try:
        core = _get_core()
        if core:
            await core.think(level_name, {
                "type": "start",
                "action": action_type,
                "input": _safe_summary(input_data),
                "timestamp": datetime.now().isoformat(),
            })
    except Exception:
        logger.debug("conscious_action enter think failed", exc_info=True)

    try:
        bus = _get_bus()
        if bus:
            bus.broadcast(level_name, "action_start", {
                "action": action_type,
                "input": _safe_summary(input_data),
            })
    except Exception:
        logger.debug("conscious_action enter broadcast failed", exc_info=True)

    error_occurred: Optional[BaseException] = None
    try:
        yield ctx
    except BaseException as exc:
        error_occurred = exc
        raise
    finally:
        elapsed_ms = round((time.monotonic() - started_at) * 1000, 1)

        if error_occurred is not None:
            # ── Error path ──
            try:
                core = _get_core()
                if core:
                    await core.think(level_name, {
                        "type": "error",
                        "action": action_type,
                        "error": str(error_occurred)[:500],
                        "elapsed_ms": elapsed_ms,
                    })
            except Exception:
                pass
            try:
                bus = _get_bus()
                if bus:
                    bus.broadcast(level_name, "action_error", {
                        "action": action_type,
                        "error": str(error_occurred)[:500],
                    })
            except Exception:
                pass
        else:
            # ── Success path ──
            result_summary = _safe_summary(ctx.result) if ctx.has_result else None
            try:
                core = _get_core()
                if core:
                    await core.think(level_name, {
                        "type": "complete",
                        "action": action_type,
                        "result": result_summary,
                        "elapsed_ms": elapsed_ms,
                        "timestamp": datetime.now().isoformat(),
                    })
            except Exception:
                pass
            try:
                bus = _get_bus()
                if bus:
                    bus.broadcast(level_name, "action_complete", {
                        "action": action_type,
                        "result": result_summary,
                        "elapsed_ms": elapsed_ms,
                    })
            except Exception:
                pass
            try:
                _report(level_name, action_type, {
                    "result": result_summary,
                    "elapsed_ms": elapsed_ms,
                })
            except Exception:
                pass


# ---------------------------------------------------------------------------
# 2.  chain_to — call another level
# ---------------------------------------------------------------------------

_CHAIN_TIMEOUT = 30.0  # seconds

async def chain_to(
    from_level: str,
    endpoint: str,
    payload: Optional[Dict[str, Any]] = None,
    *,
    method: str = "POST",
    timeout: float = _CHAIN_TIMEOUT,
) -> Optional[Dict[str, Any]]:
    """Call another Cortex level via its HTTP endpoint and return the JSON response.

    Parameters:
        from_level: Name of the calling level (for bus broadcast).
        endpoint:   Path under ``http://localhost:8888`` (e.g. ``"ethicist/evaluate"``).
        payload:    JSON body for POST requests.
        method:     HTTP method (default POST).
        timeout:    Request timeout in seconds.

    Returns the parsed JSON dict, or ``None`` on any error.
    """
    url = f"http://localhost:8888/{endpoint.lstrip('/')}"

    # Broadcast chain start
    try:
        bus = _get_bus()
        if bus:
            bus.broadcast(from_level, "chain_call", {
                "target_endpoint": endpoint,
                "payload_keys": list((payload or {}).keys()),
            })
    except Exception:
        pass

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if method.upper() == "GET":
                resp = await client.get(url, params=payload)
            else:
                resp = await client.post(url, json=payload or {})
            resp.raise_for_status()
            result = resp.json()

        # Broadcast chain success
        try:
            bus = _get_bus()
            if bus:
                bus.broadcast(from_level, "chain_complete", {
                    "target_endpoint": endpoint,
                    "status": "success",
                })
        except Exception:
            pass

        return result

    except httpx.TimeoutException:
        logger.warning("chain_to %s -> %s timed out after %.1fs", from_level, endpoint, timeout)
        _broadcast_chain_error(from_level, endpoint, "timeout")
        return None
    except Exception as exc:
        logger.warning("chain_to %s -> %s failed: %s", from_level, endpoint, exc)
        _broadcast_chain_error(from_level, endpoint, str(exc)[:300])
        return None


def _broadcast_chain_error(from_level: str, endpoint: str, error: str):
    try:
        bus = _get_bus()
        if bus:
            bus.broadcast(from_level, "chain_error", {
                "target_endpoint": endpoint,
                "error": error,
            })
    except Exception:
        pass


# ---------------------------------------------------------------------------
# 3.  subscribe_to — convenience wrapper
# ---------------------------------------------------------------------------

def subscribe_to(
    level_name: str,
    event_types: List[str],
    handler: Callable[[str, str, Any], None],
):
    """Subscribe to events on the ConsciousnessBus.

    This is a thin wrapper around ``bus.subscribe`` that silently no-ops
    if the bus is unavailable.

    Parameters:
        level_name:  Name of the subscribing level.
        event_types: List of event type strings to listen for.
        handler:     Callback ``(from_level, event_type, data) -> None``.
    """
    try:
        bus = _get_bus()
        if bus:
            bus.subscribe(level_name, event_types, handler)
    except Exception:
        logger.debug("subscribe_to failed for %s", level_name, exc_info=True)


# ---------------------------------------------------------------------------
# 4.  get_collective_context — compact brain state for Oracle prompts
# ---------------------------------------------------------------------------

def get_collective_context() -> Dict[str, Any]:
    """Return a compact summary of the current collective consciousness.

    Designed to be injected into Oracle prompts so any level can benefit
    from cross-level awareness.

    Returns a dict with keys:
        active_levels   — list of level names that have contributed thoughts
        coherence       — float 0-1 indicating how many levels are engaged
        emergent_insights — list of detected cross-level patterns
        recent_thoughts — last few thoughts from the stream (compact)
        shared_state    — snapshot of shared key-value state on the bus
    """
    context: Dict[str, Any] = {
        "active_levels": [],
        "coherence": 0.0,
        "emergent_insights": [],
        "recent_thoughts": [],
        "shared_state": {},
    }

    # ConsciousnessCore
    try:
        core = _get_core()
        if core:
            mind = core.mind_state
            context["active_levels"] = list(mind.get("level_outputs", {}).keys())
            # coherence = fraction of 36 levels that have contributed
            context["coherence"] = round(len(context["active_levels"]) / 36.0, 3)
            context["emergent_insights"] = mind.get("emergent_insights", [])

            # Read last N thoughts from the thought stream file
            try:
                import json
                lines = core.thought_stream.read_text().strip().splitlines()
                # Keep last 10 thoughts, compact
                for line in lines[-10:]:
                    try:
                        entry = json.loads(line)
                        context["recent_thoughts"].append({
                            "from": entry.get("from_level", "?"),
                            "type": entry.get("thought", {}).get("type", "?"),
                            "action": entry.get("thought", {}).get("action", ""),
                            "ts": entry.get("timestamp", ""),
                        })
                    except (json.JSONDecodeError, KeyError):
                        pass
            except FileNotFoundError:
                pass
    except Exception:
        logger.debug("get_collective_context core read failed", exc_info=True)

    # Bus shared state
    try:
        bus = _get_bus()
        if bus:
            context["shared_state"] = bus.get_all_shared()
    except Exception:
        pass

    return context


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _safe_summary(obj: Any, max_len: int = 500) -> Any:
    """Return a JSON-safe, truncated summary of an object for thought storage."""
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        s = str(obj)
        return s[:max_len] if len(s) > max_len else obj
    if isinstance(obj, dict):
        # Keep keys but truncate values
        out = {}
        total = 0
        for k, v in obj.items():
            sv = _safe_summary(v, max_len=200)
            out[str(k)[:100]] = sv
            total += len(str(sv))
            if total > max_len:
                out["_truncated"] = True
                break
        return out
    if isinstance(obj, (list, tuple)):
        out = []
        for item in obj[:20]:
            out.append(_safe_summary(item, max_len=100))
        if len(obj) > 20:
            out.append(f"... +{len(obj) - 20} more")
        return out
    # Fallback
    s = str(obj)
    return s[:max_len] if len(s) > max_len else s
