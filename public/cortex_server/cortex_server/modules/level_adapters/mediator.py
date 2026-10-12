"""ExecutionEngine adapter for L31 Mediator: the model decides whether the
message describes a conflict between parties and, if so, mediates it (one
model call). A message with no conflict returns ``applicable: false``."""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.level_adapters._deliberation_common import (
    blocked,
    clip,
    context_text,
    require_query,
    require_scope,
)

LEVEL = 31
NAME = "mediator"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # read-only analysis; no side effects outside Cortex state
DEFAULT_DEADLINE_S = 60.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.routers import mediator as mediator_router

    scope = require_scope(context)
    message = require_query(query)
    out = await mediator_router.mediate_message_core(
        message, context_text(context, 2500), principal_scope_key=scope,
    )
    if not out.get("success"):
        raise blocked(out.get("status"))
    data = out["data"]
    meta = {"model": out.get("model"), "receipt_id": out.get("receipt_id"), "elapsed_ms": out.get("elapsed_ms")}
    if not data.get("applicable"):
        return {
            "operation": "mediator.mediate",
            "origin": "model",
            "summary": "Mediator: the message does not describe a conflict between identifiable parties; "
                       "no mediation applies.",
            "data": {"applicable": False},
            **meta,
        }
    parties = [{"party": clip(p["party"], 80), "position": clip(p["position"], 240)} for p in data["parties"][:6]]
    differences = [{"issue": clip(d["issue"], 160)} for d in data["core_differences"][:5]]
    proposals = [
        {"proposal": clip(p["proposal"], 240), "fairness_rating": p["fairness_rating"]}
        for p in data["compromise_proposals"][:5]
    ]
    common = [clip(c["area"], 120) for c in data["common_ground"][:5]]
    summary = (
        f"Mediation between {', '.join(p['party'] for p in parties)}. "
        f"Common ground: {'; '.join(common)}. "
        f"Core differences: {'; '.join(d['issue'] for d in differences)}. "
        f"Compromises: {'; '.join(p['proposal'] + ' (fairness ' + p['fairness_rating'] + ')' for p in proposals)}. "
        f"Recommended: {data['recommended_resolution']}"
    )
    return {
        "operation": "mediator.mediate",
        "origin": "model",
        "summary": clip(summary, 1500),
        "data": {
            "applicable": True,
            "parties": parties,
            "common_ground": common,
            "core_differences": differences,
            "compromise_proposals": proposals,
            "recommended_resolution": clip(data["recommended_resolution"], 1000),
        },
        **meta,
    }
