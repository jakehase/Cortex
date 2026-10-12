"""L25 Bridge adapter: never auto-run.

Bridge relays caller content to an external endpoint.  That is an external
disclosure (user content may include PHI), so the ExecutionEngine must never
run it automatically: every invocation raises
``ExecutionBlocked("approval_required")`` without touching the network.
(Bridge is additionally disabled by default; ``/bridge/status`` reports that.)

An approved relay must go through ``POST /bridge/relay`` with its own token,
allowlist, rate limit and an explicit approval/action capability.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 25
NAME = "bridge"
NEEDS_MODEL = False
SAFE_AUTORUN = False
DEFAULT_DEADLINE_S = 1.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    del query, context
    raise ExecutionBlocked("approval_required")
