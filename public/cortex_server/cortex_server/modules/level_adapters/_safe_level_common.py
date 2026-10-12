"""Shared helpers for the safe-mode level adapters (Parser, Lab, Architect,
Exoskeleton, Diplomat, Geneticist, Forge). Private module: ``discover()`` skips
names that start with an underscore."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked

_FENCE = re.compile(r"```[ \t]*([A-Za-z0-9_+#.-]*)[^\n]*\n(.*?)```", re.S)
_LANG_ALIASES = {
    "py": "python", "python3": "python", "python": "python",
    "js": "javascript", "javascript": "javascript", "jsx": "javascript", "node": "javascript", "mjs": "javascript",
    "ts": "typescript", "typescript": "typescript", "tsx": "typescript",
    "html": "html", "htm": "html", "xml": "html",
    "json": "json", "md": "markdown", "markdown": "markdown",
    "calc": "calc", "math": "calc", "": "",
}


def code_blocks(text: Any, *, limit: int = 4, max_chars: int = 60_000) -> List[Dict[str, str]]:
    """Fenced code blocks from a chat message: [{language, code}] (bounded)."""

    out: List[Dict[str, str]] = []
    for lang, body in _FENCE.findall(str(text or "")):
        code = body.strip("\n")
        if not code.strip():
            continue
        out.append({"language": _LANG_ALIASES.get(lang.lower(), lang.lower()), "code": code[:max_chars]})
        if len(out) >= limit:
            break
    return out


def strip_code_blocks(text: Any) -> str:
    return _FENCE.sub(" ", str(text or "")).strip()


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
    ctx = context or {}
    parts = []
    if ctx.get("oracle_brief"):
        parts.append(f"Consult brief: {str(ctx['oracle_brief'])[:1200]}")
    convo = ctx.get("conversation")
    if convo:
        if isinstance(convo, (list, tuple)):
            convo = "\n".join(str(x) for x in convo[-8:])
        parts.append(f"Recent conversation:\n{str(convo)[-1800:]}")
    return "\n\n".join(parts)[:limit]


def blocked_from_status(status: Any) -> ExecutionBlocked:
    s = str(status or "model_unavailable")
    if s == "timeout":
        return ExecutionBlocked("provider_timeout")
    if s == "invalid_scope":
        return ExecutionBlocked("missing_principal_scope")
    return ExecutionBlocked(f"model_unavailable:{s}")


def clip(text: Any, n: int) -> str:
    s = str(text or "").strip()
    return s if len(s) <= n else s[: max(0, n - 1)] + "…"
