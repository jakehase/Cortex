"""ExecutionEngine adapter for L10 Listener: model-backed message analysis."""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules import listener as listener_core
from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 10
NAME = "listener"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # read-only classification of the message already received
DEFAULT_DEADLINE_S = 50.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    scope = str((context or {}).get("principal_scope_key") or "").strip()
    if not scope:
        raise ExecutionBlocked("missing_principal_scope")
    if not str(query or "").strip():
        raise ExecutionBlocked("empty_query")
    conversation = str((context or {}).get("conversation") or "").strip()
    result = await listener_core.analyze_text(
        query,
        principal_scope_key=scope,
        context=(f"Recent conversation before this message: {conversation}" if conversation else None),
    )
    if not result.get("success"):
        raise ExecutionBlocked(str(result.get("status") or "model_unavailable"))
    analysis = result["analysis"]
    return {
        "operation": "listener.analyze",
        "origin": "model",
        "summary": listener_core.summarize_analysis(analysis),
        "data": {
            "intent": analysis["intent"],
            "urgency": analysis["urgency"],
            "sentiment": analysis["sentiment"],
            "entities": analysis["entities"][:10],
            "action_items": analysis["action_items"][:5],
            "summary": analysis["summary"][:400],
            "truncated": result.get("truncated", False),
        },
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
        "elapsed_ms": result.get("elapsed_ms"),
    }
