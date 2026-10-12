"""ExecutionEngine adapter for L9 Architect: model-backed design advice for the
user's design question (components, data flow, risks, trade-offs). Advice only."""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.level_adapters._safe_level_common import (
    blocked_from_status,
    clip,
    context_text,
    require_query,
    require_scope,
)

LEVEL = 9
NAME = "architect"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # returns advice; never writes files or installs packages
DEFAULT_DEADLINE_S = 80.0  # fits inside the route gate's 85 s level budget


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.modules import architect as core

    scope = require_scope(context)
    question = require_query(query)
    out = await core.design(
        question[: core.MAX_QUERY_CHARS],
        principal_scope_key=scope,
        constraints=str(context.get("constraints") or "") or None,
        context=context_text(context, 3000) or None,
        deadline_s=DEFAULT_DEADLINE_S - 5.0,
        compact=True,
    )
    if not out.get("success"):
        raise blocked_from_status(out.get("status"))
    bp = out["blueprint"]
    components = [{"name": c["name"], "responsibility": clip(c["responsibility"], 160),
                   "technology": c.get("technology")} for c in bp["components"][:8]]
    flows = [{"from": f["source"], "to": f["target"], "payload": clip(f["payload"], 100),
              "protocol": f.get("protocol")} for f in bp.get("data_flows", [])[:10]]
    risks = [{"scenario": clip(r["scenario"], 160), "mitigation": clip(r["mitigation"], 160),
              "severity": r["severity"]} for r in bp["risks"][:6]]
    tradeoffs = [{"decision": clip(t["decision"], 120), "chosen": clip(t["chosen"], 120),
                  "rationale": clip(t["rationale"], 200)} for t in bp.get("tradeoffs", [])[:4]]
    summary = (
        f"Architect ({bp['design_type']}): {clip(bp['summary'], 400)} "
        f"Components: {', '.join(c['name'] for c in components)}. "
        f"Top risks: {'; '.join(r['scenario'] + ' -> ' + r['mitigation'] for r in risks[:3])}. "
        f"Recommendation: {clip(bp['recommendation'], 500)}"
    )
    return {
        "operation": "architect.design",
        "origin": "model",
        "summary": clip(summary, 1500),
        "data": {
            "design_type": bp["design_type"],
            "components": components,
            "data_flows": flows,
            "data_model": [{"entity": e["entity"], "fields": e.get("fields", [])[:12]} for e in bp.get("data_model", [])[:8]],
            "infrastructure": [{"resource": i["resource"], "sizing": i.get("sizing")} for i in bp.get("infrastructure", [])[:8]],
            "risks": risks,
            "tradeoffs": tradeoffs,
            "recommendation": clip(bp["recommendation"], 800),
            "open_questions": [clip(q, 200) for q in bp.get("open_questions", [])[:5]],
            "consistency_warnings": out.get("consistency_warnings", [])[:5],
            "checklist_not_mentioned": (out.get("review_checklist") or {}).get("not_mentioned", []),
        },
        "model": out.get("model"),
        "receipt_id": out.get("receipt_id"),
        "elapsed_ms": out.get("elapsed_ms"),
    }
