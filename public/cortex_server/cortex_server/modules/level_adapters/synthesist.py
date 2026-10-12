"""ExecutionEngine adapter for L32 Synthesist: cross-level synthesis of a turn.

The engine runs the other selected levels first and passes their results in
``context["level_results"]`` as ``[{level, name, summary, receipt_id?}]``. This
adapter combines them through one model call. With fewer than two results
there is nothing to synthesise and it raises ``ExecutionBlocked("not_applicable")``.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules import synthesist as synthesist_core
from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 32
NAME = "synthesist"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # read-only: one model call over results already produced
DEFAULT_DEADLINE_S = 65.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    ctx = context or {}
    scope = str(ctx.get("principal_scope_key") or "").strip()
    if not scope:
        raise ExecutionBlocked("missing_principal_scope")
    raw_results = [
        row for row in (ctx.get("level_results") or [])
        if isinstance(row, Mapping) and str(row.get("name") or "").strip().lower() != NAME
    ]
    results = synthesist_core.normalize_level_results(raw_results)
    if len(results) < 2:
        raise ExecutionBlocked("not_applicable")
    brief = str(ctx.get("oracle_brief") or "").strip()
    result = await synthesist_core.synthesize_turn(
        query,
        results,
        principal_scope_key=scope,
        context=(f"Oracle consult brief for this turn: {brief}" if brief else None),
    )
    if not result.get("success"):
        raise ExecutionBlocked(str(result.get("status") or "model_unavailable"))
    return {
        "operation": "synthesist.turn",
        "origin": "model",
        "summary": synthesist_core.summarize_turn(result),
        "data": {
            "answer_synthesis": result["answer_synthesis"],
            "agreements": result["agreements"][:5],
            "conflicts": result["conflicts"][:5],
            "gaps": result["gaps"][:5],
            "confidence": result["confidence"],
            "cited_levels": result["cited_levels"],
            "cited_receipts": result["cited_receipts"],
            "levels_supplied": result["levels_supplied"],
        },
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
        "elapsed_ms": result.get("elapsed_ms"),
    }
