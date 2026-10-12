"""ExecutionEngine adapter for L29 Muse: brainstorm or creative piece.

Mode: ``brainstorm`` (5/3/1 ideas) when the message asks for ideas/options/
ways/brainstorming; otherwise ``inspire`` with a style inferred from the
message (poem / story / essay, else a brainstorm-style list of angles).
One model call; model unavailable -> ``ExecutionBlocked(<status>)``.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Mapping

from cortex_server.modules import muse as muse_core
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_router_support import adapter_context_text, adapter_scope, clip

LEVEL = 29
NAME = "muse"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # creative generation only: one model call, no side effects
DEFAULT_DEADLINE_S = 45.0

_BRAINSTORM_RE = re.compile(r"\b(ideas?|brainstorm\w*|options|ways to|suggestions?|alternatives)\b", re.I)
_STYLE_RES = (
    ("poem", re.compile(r"\b(poem|poetry|verse|haiku|sonnet|lyrics)\b", re.I)),
    ("story", re.compile(r"\b(story|tale|fiction|narrative)\b", re.I)),
    ("essay", re.compile(r"\b(essay|article|op-?ed)\b", re.I)),
)


def select_mode(query: str) -> tuple[str, str]:
    """Return (mode, style) for a message."""

    for style, pattern in _STYLE_RES:
        if pattern.search(query or ""):
            return "inspire", style
    if _BRAINSTORM_RE.search(query or ""):
        return "brainstorm", "brainstorm"
    return "inspire", "brainstorm"


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    scope = adapter_scope(context)
    if not scope:
        raise ExecutionBlocked("missing_principal_scope")
    text = str(query or "").strip()
    if not text:
        raise ExecutionBlocked("empty_query")
    ctx = adapter_context_text(context) or None
    mode, style = select_mode(text)
    deadline = DEFAULT_DEADLINE_S - 3.0
    if mode == "brainstorm":
        result = await muse_core.brainstorm(
            text[: muse_core.MAX_PROBLEM_CHARS], principal_scope_key=scope, context=ctx, deadline_s=deadline
        )
    else:
        result = await muse_core.inspire(
            text[: muse_core.MAX_TOPIC_CHARS], style, principal_scope_key=scope, context=ctx, deadline_s=deadline
        )
    if not result.get("success"):
        raise ExecutionBlocked(str(result.get("model_status") or result.get("status") or "model_unavailable"))

    if mode == "brainstorm":
        items = (
            [{"kind": "conventional", **i} for i in result.get("conventional") or []]
            + [{"kind": "unconventional", **i} for i in result.get("unconventional") or []]
            + ([{"kind": "moonshot", **result["moonshot"]}] if result.get("moonshot") else [])
        )
        summary = "Ideas: " + "; ".join(f"[{i['kind']}] {clip(i.get('idea'), 140)}" for i in items)
        data: Dict[str, Any] = {"mode": "brainstorm", "items": items[:9]}
    else:
        content = str(result.get("content") or "")
        summary = f"{style} draft" + (f" '{clip(result.get('title'), 80)}'" if result.get("title") else "") + ":\n" + content
        data = {"mode": "inspire", "style": style, "title": result.get("title"), "content": clip(content, 4000)}
    return {
        "operation": f"muse.{mode}",
        "origin": "model",
        "summary": clip(summary, 1500),
        "data": data,
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
        "elapsed_ms": result.get("elapsed_ms"),
    }
