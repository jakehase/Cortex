"""Shared, authenticated model calls for model-backed Cortex levels.

Levels such as Council, Seer, Muse, Polyglot or Simulator need real judgement.
They previously called ``/oracle/chat`` over HTTP without credentials, which
the write-auth middleware rejected, and then often returned canned text marked
as a success. This module replaces that with one in-process call through the
same OpenClaw lane the Oracle consult uses:

* the call goes straight to ``call_openclaw_local`` with an ephemeral session
  scoped to the caller's principal (never a shared ``internal-system`` session);
* the provider completion receipt must validate before the output is used;
* structured output is parsed against a strict schema, with one repair attempt;
* on any failure the result says so (``status != "ok"``) and carries no
  invented domain content. Callers must surface that honestly.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import threading
import time
from typing import Any, Dict, Optional, Type

from pydantic import BaseModel, ValidationError

LEVEL_MODEL_UNAVAILABLE_LABEL = "MODEL UNAVAILABLE — NOT A MODEL ANALYSIS"
_DEFAULT_DEADLINE_S = 90.0
_MAX_PROMPT_CHARS = 24_000
_MAX_CONCURRENT = 4
_SLOTS = threading.BoundedSemaphore(_MAX_CONCURRENT)
_SCOPE_RE = re.compile(r"[^A-Za-z0-9:._-]")
# Level calls run inside a live chat turn, so they default to medium reasoning
# (still the configured model) instead of the consult lane's setting.
_THINKING_LEVELS = ("off", "minimal", "low", "medium", "high", "xhigh", "ultra")
# Measured per-level defaults (embedded gpt-5.6-sol, Oct 2026): Council took
# 72-83 s at medium vs 52-54 s at low with equivalent specificity, so it runs
# at low to fit the in-turn budget. Env overrides still win.
_LEVEL_THINKING_DEFAULTS = {"council": "low"}


def level_model_thinking(name: Optional[str] = None) -> str:
    """Reasoning level for a level's model call.

    CORTEX_LEVEL_MODEL_THINKING_<NAME> (e.g. ..._COUNCIL) overrides the global
    CORTEX_LEVEL_MODEL_THINKING, which defaults to medium.
    """

    default = os.getenv("CORTEX_LEVEL_MODEL_THINKING", "medium").strip().lower()
    default = default if default in _THINKING_LEVELS else "medium"
    if name:
        key = "CORTEX_LEVEL_MODEL_THINKING_" + re.sub(r"[^A-Za-z0-9]", "_", str(name)).upper()
        override = os.getenv(key, "").strip().lower()
        if override in _THINKING_LEVELS:
            return override
        if str(name) in _LEVEL_THINKING_DEFAULTS:
            return _LEVEL_THINKING_DEFAULTS[str(name)]
    return default


def _name_from_lane(lane: str) -> Optional[str]:
    match = re.fullmatch(r"level_(.+)_direct", str(lane or ""))
    return match.group(1) if match else None


def scope_key_for_request(http_request: Any, level_name: str) -> str:
    """Principal-scoped model session key for one level.

    Uses the authenticated memory principal when present (each principal gets
    an isolated, ephemeral provider session) and a fixed admin scope otherwise.
    """

    name = _SCOPE_RE.sub("_", str(level_name or "level"))[:48] or "level"
    state = getattr(http_request, "state", None)
    principal = getattr(state, "authenticated_memory_principal", None) if state is not None else None
    isolation = getattr(principal, "isolation_key", None)
    if callable(isolation):
        try:
            return str(isolation(f"level.{name}.v1"))
        except Exception:
            pass
    return f"admin:level.{name}"


def _strip_fence(text: str) -> str:
    t = (text or "").strip()
    m = re.fullmatch(r"```(?:json|JSON)?\s*\n?(.*?)\n?```", t, flags=re.S)
    if m:
        return m.group(1).strip()
    # Tolerate prose around a single top-level JSON object.
    if not t.startswith("{"):
        start, end = t.find("{"), t.rfind("}")
        if 0 <= start < end:
            return t[start:end + 1]
    return t


def _result(status: str, *, level: int, name: str, started: float, **extra: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "status": status,
        "ok": status == "ok",
        "level": int(level),
        "name": str(name),
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        "origin": "model" if status == "ok" else "model_unavailable",
    }
    if status != "ok":
        out["label"] = LEVEL_MODEL_UNAVAILABLE_LABEL
    out.update(extra)
    return out


def _call_once(prompt: str, system: Optional[str], scope_key: str, lane: str) -> Dict[str, Any]:
    from cortex_server.routers import oracle

    text = oracle.call_openclaw_local(
        prompt,
        system,
        principal_scope_key=scope_key,
        ephemeral_session=True,
        thinking=level_model_thinking(_name_from_lane(lane)),
    )
    answer = oracle._backend_answer(text, oracle._openclaw_model_label(), lane)
    completion = oracle._backend_completion(answer, response=str(text))
    return {"text": str(text or ""), "model": answer[1], "completion": completion}


def level_model_call_sync(
    *,
    level: int,
    name: str,
    system: str,
    prompt: str,
    principal_scope_key: str,
    schema: Optional[Type[BaseModel]] = None,
    max_repairs: int = 1,
    acquire_timeout_s: float = 30.0,
) -> Dict[str, Any]:
    """Blocking model call for a level. Returns a result dict, never raises."""

    started = time.monotonic()
    lane = f"level_{_SCOPE_RE.sub('_', str(name))[:40]}_direct"
    scope = str(principal_scope_key or "").strip()
    if not scope or scope == "internal-system":
        return _result("invalid_scope", level=level, name=name, started=started)
    body = str(prompt or "").strip()
    if not body:
        return _result("empty_prompt", level=level, name=name, started=started)
    if len(body) > _MAX_PROMPT_CHARS:
        body = body[:_MAX_PROMPT_CHARS] + "\n[truncated]"
    if not _SLOTS.acquire(timeout=max(0.0, float(acquire_timeout_s))):
        return _result("busy", level=level, name=name, started=started)
    try:
        attempt_prompt = body
        last_error = ""
        for attempt in range(max(0, int(max_repairs)) + 1):
            try:
                call = _call_once(attempt_prompt, system or None, scope, lane)
            except Exception as exc:  # HTTPException (503/429) or provider error
                detail = getattr(exc, "detail", None) or str(exc)
                return _result(
                    "model_unavailable", level=level, name=name, started=started,
                    error=str(detail)[:200],
                )
            completion = call["completion"]
            receipt = completion.get("completion_receipt") if isinstance(completion, dict) else None
            if not (isinstance(completion, dict) and completion.get("done") and completion.get("provider_invoked")
                    and not completion.get("degraded") and isinstance(receipt, dict)):
                return _result("model_unverified", level=level, name=name, started=started, model=call["model"])
            text = call["text"].strip()
            if not text:
                return _result("empty_output", level=level, name=name, started=started, model=call["model"])
            meta = {
                "model": call["model"],
                "receipt_id": str(receipt.get("receipt_id") or ""),
                "provider_invoked": True,
                "attempts": attempt + 1,
            }
            if schema is None:
                return _result("ok", level=level, name=name, started=started, text=text, **meta)
            try:
                data = schema.model_validate(json.loads(_strip_fence(text)))
                return _result("ok", level=level, name=name, started=started,
                               data=data.model_dump(), **meta)
            except (ValueError, ValidationError) as exc:
                last_error = str(exc)[:600]
                attempt_prompt = (
                    f"{body}\n\nYour previous output was not valid JSON for the required schema. "
                    f"Validation error: {last_error}\nReturn ONLY the corrected JSON object, nothing else."
                )
        return _result("invalid_output", level=level, name=name, started=started, error=last_error[:200])
    finally:
        _SLOTS.release()


async def level_model_json(
    *,
    level: int,
    name: str,
    system: str,
    prompt: str,
    principal_scope_key: str,
    schema: Optional[Type[BaseModel]] = None,
    deadline_s: float = _DEFAULT_DEADLINE_S,
    max_repairs: int = 1,
) -> Dict[str, Any]:
    """Async wrapper with an overall deadline. Never raises."""

    started = time.monotonic()
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(
                level_model_call_sync,
                level=level, name=name, system=system, prompt=prompt,
                principal_scope_key=principal_scope_key, schema=schema,
                max_repairs=max_repairs,
            ),
            timeout=max(1.0, float(deadline_s)),
        )
    except asyncio.TimeoutError:
        return _result("timeout", level=level, name=name, started=started)
    except Exception as exc:
        return _result("model_unavailable", level=level, name=name, started=started,
                       error=type(exc).__name__)


def unavailable_payload(result: Dict[str, Any], *, operation: str) -> Dict[str, Any]:
    """Standard honest response body when a level could not reach the model."""

    return {
        "success": False,
        "operation": operation,
        "origin": "model_unavailable",
        "status": result.get("status"),
        "label": LEVEL_MODEL_UNAVAILABLE_LABEL,
        "error": result.get("error"),
        "elapsed_ms": result.get("elapsed_ms"),
    }
