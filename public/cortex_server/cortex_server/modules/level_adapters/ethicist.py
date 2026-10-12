"""ExecutionEngine adapter for L33 Ethicist: ethical / privacy / fairness /
safety evaluation of the action in the user's message (one model call; scores
recomputed server-side from model-selected criteria)."""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.level_adapters._deliberation_common import (
    blocked,
    clip,
    context_text,
    require_query,
    require_scope,
)

LEVEL = 33
NAME = "ethicist"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # read-only judgement; no side effects outside Cortex state
DEFAULT_DEADLINE_S = 60.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.routers import ethicist as ethicist_router

    scope = require_scope(context)
    message = require_query(query)
    action = str((context or {}).get("candidate_action") or "").strip() or message
    out = await ethicist_router.evaluate_core(
        action[:4000],
        context_text(context, 3000),
        "medium",
        principal_scope_key=scope,
        deadline_s=DEFAULT_DEADLINE_S - 5.0,
    )
    if not out.get("success"):
        raise blocked(out.get("status"))
    ev = out["evaluation"]
    dims = {
        k: {
            "score": v["score"],
            "reasoning": clip(v.get("reasoning"), 200),
            "criteria": [c["criterion"] for c in v.get("criteria_flagged", [])],
        }
        for k, v in ev["dimensions"].items()
    }
    flagged = [f"{k}:{c}" for k, v in dims.items() for c in v["criteria"]]
    summary = (
        f"Ethicist: {ev['recommendation']} (risk_score {ev['risk_score']:.2f}, recomputed from criteria). "
        + (f"Flagged criteria: {', '.join(flagged)}. " if flagged else "No risk criteria flagged. ")
        + (f"Concerns: {'; '.join(clip(c, 160) for c in ev.get('concerns', [])[:3])}. " if ev.get("concerns") else "")
        + (f"Mitigations: {'; '.join(clip(m, 160) for m in ev.get('mitigations', [])[:3])}. " if ev.get("mitigations") else "")
        + f"{ev.get('summary') or ''}"
    )
    return {
        "operation": "ethicist.evaluate",
        "origin": "model",
        "summary": clip(summary, 1500),
        "data": {
            "recommendation": ev["recommendation"],
            "risk_score": ev["risk_score"],
            "dimensions": dims,
            "scoring": ev.get("scoring", {}).get("method"),
        },
        "model": out.get("model"),
        "receipt_id": out.get("receipt_id"),
        "elapsed_ms": out.get("elapsed_ms"),
    }
