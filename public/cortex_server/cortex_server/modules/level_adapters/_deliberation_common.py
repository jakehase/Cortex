"""Shared helpers for the deliberation/risk level adapters (Council, Simulator,
Mediator, Ethicist). Private module: ``discover()`` skips names starting with
an underscore, so this is not itself an adapter."""

from __future__ import annotations

from typing import Any, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked


def require_scope(context: Mapping[str, Any]) -> str:
    key = str((context or {}).get("principal_scope_key") or "").strip()
    if not key or key == "internal-system":
        raise ExecutionBlocked("missing_principal_scope")
    return key


def require_query(query: Any) -> str:
    text = str(query or "").strip()
    if not text:
        raise ExecutionBlocked("empty_query")
    return text


def context_text(context: Mapping[str, Any], limit: int = 3000) -> str:
    """Bounded text built from the turn context (Oracle brief + recent turns)."""

    ctx = context or {}
    parts = []
    brief = ctx.get("oracle_brief")
    if brief:
        parts.append(f"Consult brief: {str(brief)[:1200]}")
    convo = ctx.get("conversation")
    if convo:
        if isinstance(convo, (list, tuple)):
            convo = "\n".join(str(x) for x in convo[-8:])
        parts.append(f"Recent conversation:\n{str(convo)[-1800:]}")
    return "\n\n".join(parts)[:limit]


def blocked(status: Any) -> ExecutionBlocked:
    s = str(status or "model_unavailable")
    if s == "timeout":
        return ExecutionBlocked("provider_timeout")
    if s in {"invalid_scope"}:
        return ExecutionBlocked("missing_principal_scope")
    return ExecutionBlocked(f"model_unavailable:{s}")


def clip(text: Any, n: int) -> str:
    s = str(text or "").strip()
    return s if len(s) <= n else s[: max(0, n - 1)] + "…"
