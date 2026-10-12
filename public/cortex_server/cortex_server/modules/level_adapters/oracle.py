"""L5 Oracle adapter.

The Oracle consult already runs on every turn inside the route gate (before
level execution) and its brief is passed in ``context["oracle_brief"]``. This
adapter reports that observed execution; it never makes a second model call.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 5
NAME = "oracle"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 1.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    brief = str(context.get("oracle_brief") or "").strip()
    if not brief:
        raise ExecutionBlocked("oracle_consult_not_supplied")
    return {
        "operation": "oracle.consult_observed",
        "origin": "model",
        "summary": "Oracle consult brief was produced for this turn (supplied separately).",
        "data": {"brief_chars": len(brief)},
    }
