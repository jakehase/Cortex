"""ExecutionEngine adapter for L30 Seer: forecast for the user's scenario.

``trends`` when the message is about trends, else ``predict`` (3 risks /
3 opportunities / outlook). The time horizon is parsed from the message
(e.g. "in 3 months"), defaulting to 6 months. Evidence rows supplied by the
engine in ``context["evidence"]`` ([{source, text}]) are passed through so
``evidence_basis`` is truthful. Model unavailable -> ``ExecutionBlocked``.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Optional

from cortex_server.modules import seer as seer_core
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_router_support import adapter_context_text, adapter_scope, clip

LEVEL = 30
NAME = "seer"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # read-only forecast: one model call, no side effects
DEFAULT_DEADLINE_S = 60.0  # measured 32-40 s per call; leaves headroom inside the 85 s turn budget

_TREND_RE = re.compile(r"\btrends?\b|\btrending\b", re.I)
_HORIZON_RE = re.compile(r"\b(\d{1,3})\s*(day|week|month|quarter|year)s?\b", re.I)


def parse_horizon(query: str) -> str:
    match = _HORIZON_RE.search(query or "")
    if not match:
        return "6 months"
    count, unit = int(match.group(1)), match.group(2).lower()
    return f"{count} {unit}{'' if count == 1 else 's'}"


def _evidence(context: Mapping[str, Any]) -> Optional[List[Dict[str, Any]]]:
    rows = [r for r in (context or {}).get("evidence") or [] if isinstance(r, Mapping) and r.get("text")]
    return [{"source": str(r.get("source") or "unspecified"), "text": str(r.get("text"))} for r in rows[:5]] or None


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    scope = adapter_scope(context)
    if not scope:
        raise ExecutionBlocked("missing_principal_scope")
    text = str(query or "").strip()
    if not text:
        raise ExecutionBlocked("empty_query")
    ctx = adapter_context_text(context) or None
    evidence = _evidence(context)
    deadline = DEFAULT_DEADLINE_S - 3.0
    if _TREND_RE.search(text):
        result = await seer_core.analyze_trends(
            text, principal_scope_key=scope, context=ctx, evidence=evidence, deadline_s=deadline
        )
        operation = "seer.trends"
    else:
        result = await seer_core.predict_scenario(
            text, parse_horizon(text), principal_scope_key=scope, context=ctx, evidence=evidence,
            deadline_s=deadline,
        )
        operation = "seer.predict"
    if not result.get("success"):
        raise ExecutionBlocked(str(result.get("model_status") or result.get("status") or "model_unavailable"))

    if operation == "seer.trends":
        data = {
            "emerging": result.get("emerging"),
            "declining": result.get("declining"),
            "disruption": result.get("disruption"),
        }
        summary = (
            "Emerging: " + "; ".join(clip(t.get("trend"), 140) for t in result.get("emerging") or [])
            + "\nDeclining: " + "; ".join(clip(t.get("trend"), 140) for t in result.get("declining") or [])
            + f"\nDisruption: {clip((result.get('disruption') or {}).get('trend'), 160)}"
        )
    else:
        data = {
            "time_horizon": result.get("time_horizon"),
            "outlook": result.get("overall_outlook"),
            "confidence": result.get("confidence"),
            "risks": [
                {k: r.get(k) for k in ("risk", "severity", "likelihood", "mitigation")} for r in result.get("risks") or []
            ],
            "opportunities": [
                {k: o.get(k) for k in ("opportunity", "impact", "difficulty", "action")}
                for o in result.get("opportunities") or []
            ],
            "reasoning": clip(result.get("reasoning"), 800),
        }
        summary = (
            f"Outlook over {result.get('time_horizon')}: {result.get('overall_outlook')} "
            f"(confidence {result.get('confidence')}). "
            + "Risks: " + "; ".join(
                f"{clip(r.get('risk'), 120)} [{r.get('severity')}/{r.get('likelihood')}]" for r in result.get("risks") or []
            )
            + ". Opportunities: " + "; ".join(clip(o.get("opportunity"), 120) for o in result.get("opportunities") or [])
        )
    data["assumptions"] = [clip(a, 300) for a in (result.get("assumptions") or [])[:5]]
    data["evidence_basis"] = result.get("evidence_basis")
    return {
        "operation": operation,
        "origin": "model",
        "summary": clip(summary, 1500),
        "data": data,
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
        "elapsed_ms": result.get("elapsed_ms"),
    }
