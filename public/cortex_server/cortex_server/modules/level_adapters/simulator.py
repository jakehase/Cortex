"""ExecutionEngine adapter for L20 Simulator: best / most-likely / worst-case
outcomes for the plan or decision in the user's message (one model call)."""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.level_adapters._deliberation_common import (
    blocked,
    clip,
    context_text,
    require_query,
    require_scope,
)

LEVEL = 20
NAME = "simulator"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # read-only projection; no side effects outside Cortex state
DEFAULT_DEADLINE_S = 50.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.routers import simulator as simulator_router

    scope = require_scope(context)
    message = require_query(query)
    extra = context_text(context, 800)
    scenario = message[:1800] + (f"\n\n{extra}" if extra else "")
    out = await simulator_router.simulate_core(
        scenario,
        mode="fast",
        principal_scope_key=scope,
        deadline_s=DEFAULT_DEADLINE_S - 5.0,
    )
    if not out.get("success"):
        raise blocked(out.get("status"))
    outcomes = [
        {
            "label": o["label"],
            "probability": o["probability"],
            "key_events": [clip(e, 140) for e in o["key_events"][:3]],
            "impact_assessment": clip(o["impact_assessment"], 200),
        }
        for o in out["outcomes"]
    ]
    lines = [
        f"{o['label']} ({o['probability']}): {'; '.join(o['key_events'])} -> {o['impact_assessment']}"
        for o in outcomes
    ]
    uncertainties = [clip(u, 160) for u in out.get("key_uncertainties", [])[:2]]
    summary = (
        "Simulated outcomes (model probability estimates, not computed forecasts):\n"
        + "\n".join(lines)
        + (f"\nKey uncertainties: {'; '.join(uncertainties)}" if uncertainties else "")
    )
    return {
        "operation": "simulator.run",
        "origin": "model",
        "summary": clip(summary, 1500),
        "data": {
            "outcomes": outcomes,
            "assumptions": [clip(a, 160) for a in out.get("assumptions", [])[:3]],
            "key_uncertainties": uncertainties,
            "scenario_truncated": out.get("scenario_truncated", False),
            "probability_basis": "model_estimate",
        },
        "model": out.get("model"),
        "receipt_id": out.get("receipt_id"),
        "elapsed_ms": out.get("elapsed_ms"),
    }
