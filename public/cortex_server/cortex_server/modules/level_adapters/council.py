"""ExecutionEngine adapter for L15 Council: five-perspective deliberation on
the user's current message (one schema-validated model call)."""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.level_adapters._deliberation_common import (
    blocked,
    clip,
    context_text,
    require_query,
    require_scope,
)

LEVEL = 15
NAME = "council"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # read-only judgement; no side effects outside Cortex state
DEFAULT_DEADLINE_S = 80.0  # measured 52-54 s at low thinking; fits the route gate's 85 s budget


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.routers import council as council_router

    scope = require_scope(context)
    topic = require_query(query)[:2000]
    out = await council_router.deliberate_core(
        topic,
        context_text(context, 3000) or None,
        principal_scope_key=scope,
        chain_ethicist=False,  # Ethicist runs as its own adapter when selected
        deadline_s=DEFAULT_DEADLINE_S - 5.0,
    )
    if not out.get("success"):
        raise blocked(out.get("status"))
    d = out["deliberation"]
    perspectives = [
        {"name": p["key"], "score": p["score"], "reasoning": clip(p["reasoning"], 200)}
        for p in d["perspectives"]
    ]
    risks = [
        {"risk": clip(r.get("risk"), 160), "severity": r.get("severity"), "mitigation": clip(r.get("mitigation"), 160)}
        for r in (d.get("risks") or [])[:3]
    ]
    conditions = [clip(c, 160) for c in (d.get("conditions") or [])[:3]]
    scores = ", ".join(f"{p['name']} {p['score']}/10" for p in perspectives)
    summary = (
        f"Council recommendation: {d['recommendation']} (risk_score {d['risk_score']:.2f}; "
        f"scores, higher is better: {scores}). "
        + (f"Top risks: {'; '.join(r['risk'] + ' [' + str(r['severity']) + ']' for r in risks)}. " if risks else "")
        + (f"Conditions: {'; '.join(conditions)}. " if conditions else "")
        + f"Rationale: {d['rationale']}"
    )
    return {
        "operation": "council.deliberate",
        "origin": "model",
        "summary": clip(summary, 1500),
        "data": {
            "recommendation": d["recommendation"],
            "risk_score": d["risk_score"],
            "score_polarity": "higher_is_better",
            "perspectives": perspectives,
            "top_risks": risks,
            "conditions": conditions,
        },
        "model": d.get("model"),
        "receipt_id": d.get("receipt_id"),
        "elapsed_ms": d.get("elapsed_ms"),
    }
