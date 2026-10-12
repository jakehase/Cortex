"""L24 Nexus adapter.

Nexus routing (plus the Oracle semantic level choice) runs on every turn in the
route gate before level execution. This adapter reports the routing that was
actually applied, from ``context["routing"]``; it does not re-route.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 24
NAME = "nexus"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 1.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    routing = context.get("routing")
    if not isinstance(routing, Mapping):
        raise ExecutionBlocked("routing_not_supplied")
    method = str(routing.get("method") or "unknown")[:64]
    selected = [int(x) for x in (routing.get("selected") or []) if isinstance(x, int) and 1 <= x <= 38][:16]
    return {
        "operation": "nexus.routing_observed",
        "origin": "deterministic",
        "summary": f"Routing method {method}; executed levels {selected or 'none'}.",
        "data": {"method": method, "selected": selected},
    }
