"""ExecutionEngine adapter for L13 Dreamer: gap analysis and improvement ideas.

One model call (``modules.dreamer.dream``) over the user's message plus the
recent conversation / Oracle brief. Nothing is persisted from the adapter.
Model unavailable or invalid output -> ``ExecutionBlocked(<status>)``.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules import dreamer as dreamer_core
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_router_support import adapter_context_text, adapter_scope, clip

LEVEL = 13
NAME = "dreamer"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # pure ideation: one model call, no side effects
DEFAULT_DEADLINE_S = 45.0


def _summary(result: Dict[str, Any]) -> str:
    lines = [clip(result.get("summary"), 400)]
    gaps = result.get("gaps") or []
    if gaps:
        lines.append("Gaps: " + "; ".join(
            f"{clip(g.get('gap'), 120)} ({g.get('impact')}, from {g.get('evidence_source')})" for g in gaps[:5]
        ))
    imps = result.get("improvements") or []
    if imps:
        lines.append("Improvements: " + "; ".join(
            f"{clip(i.get('idea'), 120)} [effort {i.get('effort')}; first step: {clip(i.get('first_step'), 100)}]"
            for i in imps[:5]
        ))
    return clip("\n".join(x for x in lines if x), 1500)


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    scope = adapter_scope(context)
    if not scope:
        raise ExecutionBlocked("missing_principal_scope")
    if not str(query or "").strip():
        raise ExecutionBlocked("empty_query")
    result = await dreamer_core.dream(
        query,
        principal_scope_key=scope,
        context=adapter_context_text(context) or None,
        deadline_s=DEFAULT_DEADLINE_S - 3.0,
    )
    if not result.get("success"):
        raise ExecutionBlocked(str(result.get("model_status") or result.get("status") or "model_unavailable"))
    return {
        "operation": "dreamer.dream",
        "origin": "model",
        "summary": _summary(result),
        "data": {
            "summary": clip(result.get("summary"), 600),
            "gaps": (result.get("gaps") or [])[:5],
            "scenarios": (result.get("scenarios") or [])[:3],
            "improvements": (result.get("improvements") or [])[:5],
            "assumptions": [clip(a, 300) for a in (result.get("assumptions") or [])[:5]],
            "evidence_sources_supplied": result.get("evidence_sources_supplied"),
        },
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
        "elapsed_ms": result.get("elapsed_ms"),
    }
