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
import hashlib
import hmac
import logging
import os
import re
import secrets
import threading
import time
from contextlib import asynccontextmanager
from contextvars import ContextVar, Token
from datetime import datetime
from typing import Any, Callable, Dict, List, Mapping, Optional

import httpx
from starlette.responses import JSONResponse

from cortex_server.internal_addressing import internal_url
from cortex_server.modules.level_registry import get_level_registry
from cortex_server.modules.memory_scope import configured_internal_memory_headers
from cortex_server.modules.sensitive_data_redaction import (
    redact_sensitive_data,
)

logger = logging.getLogger("consciousness_integration")


def _registered_level_count() -> int:
    return len(get_level_registry())

# ---------------------------------------------------------------------------
# Internal singleton accessors (lazy, import-safe)
# ---------------------------------------------------------------------------

def _get_core():
    """Return the ConsciousnessCore singleton (never raises)."""
    try:
        from cortex_server.modules.consciousness_core import get_consciousness_core
        return get_consciousness_core()
    except Exception as exc:
        logger.debug(
            "consciousness_dependency_unavailable dependency=core failure_type=%s",
            type(exc).__name__,
        )
        return None


def _get_bus():
    """Return the ConsciousnessBus singleton (never raises)."""
    try:
        from cortex_server.modules.unified_messaging import get_bus
        return get_bus()
    except Exception as exc:
        logger.debug(
            "consciousness_dependency_unavailable dependency=bus failure_type=%s",
            type(exc).__name__,
        )
        return None


def _report(level_name: str, activity_type: str, data: dict):
    """Report to auto_reporting (never raises)."""
    try:
        from cortex_server.modules.auto_reporting import report_activity
        report_activity(level_name, activity_type, data)
    except Exception as exc:
        logger.debug(
            "consciousness_dependency_unavailable dependency=auto_reporting failure_type=%s",
            type(exc).__name__,
        )


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
    except Exception as exc:
        logger.debug(
            "conscious_action_internal_failure phase=enter_think failure_type=%s",
            type(exc).__name__,
        )

    try:
        bus = _get_bus()
        if bus:
            bus.broadcast(level_name, "action_start", {
                "action": action_type,
                "input": _safe_summary(input_data),
            })
    except Exception as exc:
        logger.debug(
            "conscious_action_internal_failure phase=enter_broadcast failure_type=%s",
            type(exc).__name__,
        )

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
            failure_type = type(error_occurred).__name__
            try:
                core = _get_core()
                if core:
                    await core.think(level_name, {
                        "type": "error",
                        "action": action_type,
                        "failure_type": failure_type,
                        "elapsed_ms": elapsed_ms,
                    })
            except Exception:
                pass
            try:
                bus = _get_bus()
                if bus:
                    bus.broadcast(level_name, "action_error", {
                        "action": action_type,
                        "failure_type": failure_type,
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
_CHAIN_MAX_DEPTH = 8
_CHAIN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_CHAIN_LEVEL_RE = re.compile(r"^[a-z0-9][a-z0-9._:-]{0,79}$")
_CHAIN_CONTEXT_HEADER_NAMES = (
    "x-cortex-chain-id",
    "x-cortex-chain-visited",
    "x-cortex-chain-depth",
    "x-cortex-chain-deadline-ms",
)
_CHAIN_SIGNATURE_HEADER = "x-cortex-chain-signature"
_CHAIN_HEADER_NAMES = (*_CHAIN_CONTEXT_HEADER_NAMES, _CHAIN_SIGNATURE_HEADER)
_CHAIN_LEVEL_ALIASES = {
    # Public router prefixes that differ from the logical Cortex level name.
    "browser": "ghost",
    "parsers": "parser",
    "synthesist_api": "synthesist",
}
# A deployment-provisioned value keeps signatures valid across worker
# processes. The random fallback remains safe and compatible for a single
# process; cross-worker chain calls then fail closed until configured. Resolve
# it only when chain signing is actually used so router discovery remains a
# read-only, configuration-neutral operation.
_CHAIN_HMAC_SECRET: Optional[bytes] = None
_CHAIN_HMAC_SECRET_LOCK = threading.Lock()
_ACTIVE_CHAIN_CONTEXT: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
    "cortex_active_chain_context",
    default=None,
)


def _chain_level_key(value: Any) -> str:
    key = str(value or "").strip().lower().replace(" ", "_")
    return _CHAIN_LEVEL_ALIASES.get(key, key)


def _chain_hmac_secret() -> bytes:
    global _CHAIN_HMAC_SECRET

    if _CHAIN_HMAC_SECRET is not None:
        return _CHAIN_HMAC_SECRET
    with _CHAIN_HMAC_SECRET_LOCK:
        if _CHAIN_HMAC_SECRET is None:
            _CHAIN_HMAC_SECRET = (
                os.getenv("CORTEX_CHAIN_HMAC_SECRET", "").encode("utf-8")
                or secrets.token_bytes(32)
            )
        return _CHAIN_HMAC_SECRET


def _chain_context_signature(headers: Mapping[str, Any]) -> str:
    canonical = "\n".join(
        f"{name}:{str(headers.get(name) or '')}" for name in _CHAIN_CONTEXT_HEADER_NAMES
    )
    return hmac.new(
        _chain_hmac_secret(), canonical.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def chain_context_from_headers(headers: Mapping[str, Any]) -> Dict[str, Any]:
    """Parse bounded chain metadata propagated by :func:`chain_to`."""
    chain_id = str(headers.get("x-cortex-chain-id") or "").strip()
    raw_visited = str(headers.get("x-cortex-chain-visited") or "").strip()
    raw_depth = str(headers.get("x-cortex-chain-depth") or "").strip()
    raw_deadline = str(headers.get("x-cortex-chain-deadline-ms") or "").strip()
    if not _CHAIN_ID_RE.fullmatch(chain_id):
        raise ValueError("invalid chain ID")
    visited = [_chain_level_key(item) for item in raw_visited.split(",") if item.strip()]
    if (
        not visited
        or len(visited) > _CHAIN_MAX_DEPTH + 1
        or len(set(visited)) != len(visited)
        or any(not _CHAIN_LEVEL_RE.fullmatch(item) for item in visited)
    ):
        raise ValueError("invalid visited-level chain")
    try:
        depth = int(raw_depth)
        deadline_epoch_ms = int(raw_deadline)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid chain depth or deadline") from exc
    if depth < 0 or depth > _CHAIN_MAX_DEPTH or depth != len(visited) - 1 or deadline_epoch_ms <= 0:
        raise ValueError("invalid chain depth or deadline")
    return {
        "chain_id": chain_id,
        "visited_levels": visited,
        "depth": depth,
        "deadline_epoch_ms": deadline_epoch_ms,
    }


class ChainContextMiddleware:
    """Install validated internal-chain metadata for every HTTP request.

    ``chain_to`` reads this request-local context automatically.  This makes
    hop/deadline/cycle checks survive the HTTP boundary without requiring each
    router to remember to forward request headers manually.
    """

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: Dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        raw_chain_headers: Dict[str, str] = {}
        duplicate_header = False
        for raw_name, raw_value in scope.get("headers", []):
            name = raw_name.decode("latin-1").lower()
            if name not in _CHAIN_HEADER_NAMES:
                continue
            if name in raw_chain_headers:
                duplicate_header = True
                break
            raw_chain_headers[name] = raw_value.decode("latin-1")

        active_context: Optional[Dict[str, Any]] = None
        if raw_chain_headers:
            # The absolute request deadline is also used by Nexus without a
            # chain. It may appear alone and must not become chain provenance.
            deadline_only = set(raw_chain_headers) == {"x-cortex-chain-deadline-ms"}
            if deadline_only and not duplicate_header:
                raw_chain_headers = {}
            elif duplicate_header or set(raw_chain_headers) != set(_CHAIN_HEADER_NAMES):
                await JSONResponse(
                    status_code=400,
                    content={
                        "success": False,
                        "error": "invalid Cortex chain context",
                        "terminal_reason": "invalid_chain_headers",
                    },
                )(scope, receive, send)
                return
            if raw_chain_headers:
                supplied_signature = raw_chain_headers.pop(_CHAIN_SIGNATURE_HEADER)
                valid_signature = hmac.compare_digest(
                    supplied_signature,
                    _chain_context_signature(raw_chain_headers),
                )
            else:
                valid_signature = True
            try:
                if not valid_signature:
                    raise ValueError("invalid chain signature")
                if raw_chain_headers:
                    active_context = chain_context_from_headers(raw_chain_headers)
            except ValueError:
                await JSONResponse(
                    status_code=400,
                    content={
                        "success": False,
                        "error": "invalid Cortex chain context",
                        "terminal_reason": "invalid_chain_headers",
                    },
                )(scope, receive, send)
                return

        token: Token[Optional[Dict[str, Any]]] = _ACTIVE_CHAIN_CONTEXT.set(active_context)
        try:
            await self.app(scope, receive, send)
        finally:
            _ACTIVE_CHAIN_CONTEXT.reset(token)

async def chain_to(
    from_level: str,
    endpoint: str,
    payload: Optional[Dict[str, Any]] = None,
    *,
    method: str = "POST",
    timeout: float = _CHAIN_TIMEOUT,
    chain_context: Optional[Dict[str, Any]] = None,
    chain_id: Optional[str] = None,
    visited_levels: Optional[List[str]] = None,
    depth: Optional[int] = None,
    deadline_epoch_ms: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Call another Cortex level via its HTTP endpoint and return the JSON response.

    Parameters:
        from_level: Name of the calling level (for bus broadcast).
        endpoint:   Path under the internal Cortex origin (e.g. ``"ethicist/evaluate"``).
        payload:    JSON body for POST requests.
        method:     HTTP method (default POST).
        timeout:    Request timeout in seconds.

    Returns the parsed JSON dict, or ``None`` on any error.
    """
    inherited_context = _ACTIVE_CHAIN_CONTEXT.get()
    if inherited_context is not None and any(
        value is not None
        for value in (chain_context, chain_id, visited_levels, depth, deadline_epoch_ms)
    ):
        _broadcast_chain_error(
            from_level,
            endpoint,
            "inherited_chain_context_override",
            chain_id=str(inherited_context.get("chain_id") or ""),
            terminal_reason="inherited_chain_context_override",
        )
        return None
    context = dict(inherited_context or chain_context or {})
    resolved_chain_id = str(chain_id or context.get("chain_id") or secrets.token_hex(16)).strip()
    if not _CHAIN_ID_RE.fullmatch(resolved_chain_id):
        _broadcast_chain_error(from_level, endpoint, "invalid_chain_id", terminal_reason="invalid_chain_id")
        return None

    try:
        resolved_timeout = float(timeout)
        resolved_depth = int(context.get("depth", 0) if depth is None else depth)
    except (TypeError, ValueError):
        _broadcast_chain_error(from_level, endpoint, "invalid_chain_budget", chain_id=resolved_chain_id, terminal_reason="invalid_chain_budget")
        return None
    if resolved_timeout <= 0 or resolved_timeout > 300 or resolved_timeout != resolved_timeout:
        _broadcast_chain_error(from_level, endpoint, "invalid_chain_timeout", chain_id=resolved_chain_id, terminal_reason="invalid_chain_timeout")
        return None
    if resolved_depth < 0 or resolved_depth >= _CHAIN_MAX_DEPTH:
        _broadcast_chain_error(from_level, endpoint, "max_depth_exceeded", chain_id=resolved_chain_id, terminal_reason="max_depth_exceeded")
        return None

    normalized_endpoint = endpoint.lstrip("/")
    target_level = _chain_level_key(normalized_endpoint.split("/", 1)[0])
    source_level = _chain_level_key(from_level)
    if not _CHAIN_LEVEL_RE.fullmatch(target_level) or not _CHAIN_LEVEL_RE.fullmatch(source_level):
        _broadcast_chain_error(from_level, endpoint, "invalid_chain_level", chain_id=resolved_chain_id, terminal_reason="invalid_chain_level")
        return None

    raw_visited = visited_levels if visited_levels is not None else context.get("visited_levels", [])
    if not isinstance(raw_visited, list):
        _broadcast_chain_error(from_level, endpoint, "invalid_visited_levels", chain_id=resolved_chain_id, terminal_reason="invalid_visited_levels")
        return None
    visited = [_chain_level_key(item) for item in raw_visited]
    if (
        len(visited) > _CHAIN_MAX_DEPTH + 1
        or len(set(visited)) != len(visited)
        or any(not _CHAIN_LEVEL_RE.fullmatch(item) for item in visited)
    ):
        _broadcast_chain_error(from_level, endpoint, "invalid_visited_levels", chain_id=resolved_chain_id, terminal_reason="invalid_visited_levels")
        return None
    has_supplied_context = bool(inherited_context or chain_context or visited_levels is not None or depth is not None)
    if has_supplied_context and (
        not visited
        or resolved_depth != len(visited) - 1
        or visited[-1] != source_level
    ):
        _broadcast_chain_error(from_level, endpoint, "source_context_mismatch", chain_id=resolved_chain_id, terminal_reason="source_context_mismatch")
        return None
    if source_level not in visited:
        visited.append(source_level)
    if target_level in visited:
        _broadcast_chain_error(from_level, endpoint, "cycle_detected", chain_id=resolved_chain_id, terminal_reason="cycle_detected")
        return None

    deadline_value = deadline_epoch_ms if deadline_epoch_ms is not None else context.get("deadline_epoch_ms")
    if deadline_value is None:
        deadline_value = int(time.time() * 1000 + (resolved_timeout * 1000))
    try:
        resolved_deadline_ms = int(deadline_value)
    except (TypeError, ValueError):
        _broadcast_chain_error(from_level, endpoint, "invalid_chain_deadline", chain_id=resolved_chain_id, terminal_reason="invalid_chain_deadline")
        return None
    remaining_s = (resolved_deadline_ms - int(time.time() * 1000)) / 1000.0
    if remaining_s <= 0:
        _broadcast_chain_error(from_level, endpoint, "deadline_exhausted", chain_id=resolved_chain_id, terminal_reason="deadline_exhausted")
        return None
    effective_timeout = min(resolved_timeout, remaining_s)
    next_visited = [*visited, target_level]
    chain_headers = {
        "x-cortex-chain-id": resolved_chain_id,
        "x-cortex-chain-visited": ",".join(next_visited),
        "x-cortex-chain-depth": str(resolved_depth + 1),
        "x-cortex-chain-deadline-ms": str(resolved_deadline_ms),
    }
    chain_headers[_CHAIN_SIGNATURE_HEADER] = _chain_context_signature(chain_headers)
    url = internal_url(f"/{normalized_endpoint}")

    # Broadcast chain start
    try:
        bus = _get_bus()
        if bus:
            bus.broadcast(from_level, "chain_call", {
                "target_endpoint": endpoint,
                "payload_keys": list((payload or {}).keys()),
                "chain_id": resolved_chain_id,
                "depth": resolved_depth + 1,
                "visited_levels": next_visited,
            })
    except Exception:
        pass

    try:
        internal_headers = configured_internal_memory_headers()
        if internal_headers is None:
            memory_endpoint = (
                normalized_endpoint.startswith(("librarian/", "l22/"))
                or normalized_endpoint == "knowledge/search"
            )
            terminal_reason = (
                "memory_credentials_unavailable"
                if memory_endpoint
                else "internal_credentials_unavailable"
            )
            _broadcast_chain_error(
                from_level,
                endpoint,
                terminal_reason,
                chain_id=resolved_chain_id,
                terminal_reason=terminal_reason,
            )
            return None
        request_headers = {**internal_headers, **chain_headers}
        async with asyncio.timeout(effective_timeout):
            async with httpx.AsyncClient(timeout=effective_timeout) as client:
                if method.upper() == "GET":
                    resp = await client.get(url, params=payload, headers=request_headers)
                else:
                    body = dict(payload or {})
                    resp = await client.post(url, json=body, headers=request_headers)
                resp.raise_for_status()
                result = resp.json()

        # Broadcast chain success
        try:
            bus = _get_bus()
            if bus:
                bus.broadcast(from_level, "chain_complete", {
                    "target_endpoint": endpoint,
                    "status": "success",
                    "chain_id": resolved_chain_id,
                    "depth": resolved_depth + 1,
                    "terminal_reason": "target_completed",
                })
        except Exception:
            pass

        return result

    except (httpx.TimeoutException, TimeoutError):
        logger.warning("chain_to %s -> %s timed out after %.1fs", from_level, endpoint, effective_timeout)
        _broadcast_chain_error(from_level, endpoint, "timeout", chain_id=resolved_chain_id, terminal_reason="timeout")
        return None
    except Exception as exc:
        logger.warning(
            "consciousness_chain_failure failure_type=%s",
            type(exc).__name__,
        )
        _broadcast_chain_error(
            from_level,
            endpoint,
            type(exc).__name__,
            chain_id=resolved_chain_id,
            terminal_reason="target_error",
        )
        return None


def _broadcast_chain_error(
    from_level: str,
    endpoint: str,
    failure_type: str,
    *,
    chain_id: str = "",
    terminal_reason: str = "target_error",
):
    safe_failure_type = (
        str(failure_type)
        if str(failure_type).replace("_", "").isalnum()
        and len(str(failure_type)) <= 64
        else "InternalFailure"
    )
    try:
        bus = _get_bus()
        if bus:
            bus.broadcast(from_level, "chain_error", {
                "target_endpoint": endpoint,
                "failure_type": safe_failure_type,
                "chain_id": chain_id,
                "terminal_reason": terminal_reason,
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
    except Exception as exc:
        logger.debug(
            "consciousness_subscription_failure failure_type=%s",
            type(exc).__name__,
        )


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
            # coherence = fraction of registered levels that have contributed
            context["coherence"] = round(len(context["active_levels"]) / max(1, _registered_level_count()), 3)
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
    except Exception as exc:
        logger.debug(
            "consciousness_context_read_failure failure_type=%s",
            type(exc).__name__,
        )

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

def _bounded_summary(obj: Any, max_len: int) -> Any:
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        s = str(obj)
        return s[:max_len] if len(s) > max_len else obj
    if isinstance(obj, dict):
        out = {}
        total = 0
        for k, v in obj.items():
            sv = _bounded_summary(v, 200)
            out[str(k)[:100]] = sv
            total += len(str(sv))
            if total > max_len:
                out["_truncated"] = True
                break
        return out
    if isinstance(obj, (list, tuple)):
        out = []
        for item in obj[:20]:
            out.append(_bounded_summary(item, 100))
        if len(obj) > 20:
            out.append(f"... +{len(obj) - 20} more")
        return out
    # Fallback
    s = str(obj)
    return s[:max_len] if len(s) > max_len else s


def _safe_summary(obj: Any, max_len: int = 500) -> Any:
    """Return a bounded, recursively redacted summary for trace storage."""
    redacted = redact_sensitive_data(
        obj,
        max_depth=8,
        max_items=512,
        max_string_chars=max(1, int(max_len)),
    )
    return _bounded_summary(redacted, max(1, int(max_len)))
