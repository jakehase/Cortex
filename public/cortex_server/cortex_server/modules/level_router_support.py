"""Small shared helpers for model-backed level routers (L13, L28, L29, L30).

* ``principal_scope_for_request`` picks the model-session scope for a caller so
  two principals never share a provider session (never ``internal-system``).
* ``OutcomeWindow`` keeps a rolling record of real model-call outcomes so a
  level's ``/status`` reports measured health instead of a hard-coded
  ``"active"``.
* ``model_lane_readiness`` reports whether the OpenClaw executable is present
  (a path lookup only: no provider call is made).
"""

from __future__ import annotations

import hashlib
import re
import threading
import time
from collections import deque
from typing import Any, Deque, Dict, Optional

from cortex_server.modules import level_model

_NAME_RE = re.compile(r"[^A-Za-z0-9_.-]")
_PRINCIPAL_FIELDS = ("tenant_id", "workspace_id", "agent_id", "user_id", "channel_id", "session_id")


def _state(http_request: Any) -> Any:
    return getattr(http_request, "state", None) if http_request is not None else None


def is_global_admin(http_request: Any) -> bool:
    """True only when the admin guard authenticated the global admin credential."""

    state = _state(http_request)
    principal = getattr(state, "cortex_principal", None) if state is not None else None
    return bool(
        principal is not None
        and getattr(principal, "role", "") == "admin"
        and getattr(principal, "credential_id", "") == "cortex-admin"
    )


def principal_scope_for_request(http_request: Any, level_name: str) -> str:
    """Return the per-principal model session scope for a level call."""

    name = _NAME_RE.sub("_", str(level_name or "level"))[:48] or "level"
    state = _state(http_request)
    if state is not None and getattr(state, "authenticated_memory_principal", None) is not None:
        return level_model.scope_key_for_request(http_request, name)
    for attr in ("cortex_principal", "cortex_read_principal"):
        principal = getattr(state, attr, None) if state is not None else None
        if principal is not None and getattr(principal, "role", "") == "principal":
            parts = [f"level.{name}.v1"] + [str(getattr(principal, f, "") or "") for f in _PRINCIPAL_FIELDS]
            return "principal:" + hashlib.sha256("\0".join(parts).encode("utf-8")).hexdigest()
    return f"admin:level.{name}"


def model_lane_readiness() -> Dict[str, Any]:
    """Whether the OpenClaw executable resolves on PATH (no provider call)."""

    try:
        from cortex_server.routers import oracle

        info = oracle._openclaw_executable_readiness()
        return {
            "executable_available": bool(info.get("available")),
            "check": "path_lookup_only",
            "provider_call_made": False,
        }
    except Exception as exc:  # pragma: no cover - import failure is reported, not hidden
        return {
            "executable_available": None,
            "check": "unavailable",
            "error": type(exc).__name__,
            "provider_call_made": False,
        }


class OutcomeWindow:
    """Thread-safe rolling window of recent model-call outcomes."""

    def __init__(self, size: int = 20) -> None:
        self._rows: Deque[Dict[str, Any]] = deque(maxlen=max(1, int(size)))
        self._lock = threading.Lock()
        self._total_ok = 0
        self._total_failed = 0
        self._last_ok_at: Optional[float] = None
        self._last_error: Optional[str] = None
        self._last_error_at: Optional[float] = None

    def record(self, status: str, error: Optional[str] = None) -> None:
        ok = status == "ok"
        now = time.time()
        with self._lock:
            self._rows.append({"ok": ok, "status": str(status), "at": now})
            if ok:
                self._total_ok += 1
                self._last_ok_at = now
            else:
                self._total_failed += 1
                self._last_error = str(error or status)[:300]
                self._last_error_at = now

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            rows = list(self._rows)
            recent_ok = sum(1 for r in rows if r["ok"])
            return {
                "recent_calls": len(rows),
                "recent_ok": recent_ok,
                "recent_failed": len(rows) - recent_ok,
                "last_status": rows[-1]["status"] if rows else None,
                "total_ok": self._total_ok,
                "total_failed": self._total_failed,
                "last_ok_at": self._last_ok_at,
                "last_error": self._last_error,
                "last_error_at": self._last_error_at,
            }

    def health(self, lane: Optional[Dict[str, Any]] = None) -> str:
        """``unavailable`` | ``untested`` | ``degraded`` | ``ok`` from measured state."""

        if lane is not None and lane.get("executable_available") is False:
            return "unavailable"
        snap = self.snapshot()
        if snap["recent_calls"] == 0:
            return "untested"
        if snap["recent_failed"] * 2 > snap["recent_calls"] or snap["last_status"] != "ok":
            return "degraded"
        return "ok"

    def reset(self) -> None:
        with self._lock:
            self._rows.clear()
            self._total_ok = 0
            self._total_failed = 0
            self._last_ok_at = None
            self._last_error = None
            self._last_error_at = None


def model_fields(result: Dict[str, Any]) -> Dict[str, Any]:
    """Provenance fields copied from a level_model result."""

    return {
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id") or None,
        "elapsed_ms": result.get("elapsed_ms"),
        "model_status": result.get("status"),
        "attempts": result.get("attempts"),
    }


def honest_failure(result: Dict[str, Any], *, operation: str) -> Dict[str, Any]:
    """``level_model.unavailable_payload`` with ``error`` set to the stable status code."""

    body = level_model.unavailable_payload(result, operation=operation)
    # Stable machine code in ``error``; provider/validation text in ``error_detail``.
    body["error_detail"] = body.get("error")
    body["error"] = str(result.get("status") or "model_unavailable")
    body["fallback"] = {"kind": "none", "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL}
    return body


def adapter_scope(context: Any) -> str:
    """Principal scope from an ExecutionEngine context ('' when absent/invalid)."""

    scope = str((context or {}).get("principal_scope_key") or "").strip()
    return "" if scope == "internal-system" else scope


def adapter_context_text(context: Any, max_chars: int = 4000) -> str:
    """Recent conversation + Oracle brief from an ExecutionEngine context, bounded."""

    ctx = context or {}
    parts = []
    conversation = str(ctx.get("conversation") or "").strip()
    if conversation:
        parts.append(f"Recent conversation:\n{conversation}")
    brief = str(ctx.get("oracle_brief") or "").strip()
    if brief:
        parts.append(f"Oracle consult brief for this turn:\n{brief}")
    text = "\n\n".join(parts)
    return text[-max_chars:] if len(text) > max_chars else text


def clip(value: Any, limit: int) -> str:
    text = str(value or "")
    return text if len(text) <= limit else text[: max(0, limit - 1)] + "…"
