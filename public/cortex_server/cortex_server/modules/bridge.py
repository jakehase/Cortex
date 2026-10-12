"""Level 25: The Bridge - compatibility module.

The former in-process "multi-agent federation" class appended JSON lines to a
local file and reported ``"status": "delivered"``, never persisted read state
(messages re-delivered forever), created directories under
``/app/cortex_server/agents`` on construction, and had no callers.  It did not
federate with anything.

This module now carries no fake behaviour: status delegates to the real L25
router configuration, and the federation methods raise ``NotImplementedError``.
The only real L25 transport is ``POST /bridge/relay`` (feature-flagged,
token-gated, allowlisted, and never auto-run because it discloses user content
externally).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

_NOT_IMPLEMENTED = (
    "L25 agent federation is not implemented; the only real L25 transport is the "
    "feature-flagged, allowlisted POST /bridge/relay, which requires approval"
)


class Bridge:
    """Honest L25 facade: no local queue, no fabricated delivery receipts."""

    def __init__(self) -> None:
        self.level = 25
        self.name = "Bridge"

    def status(self) -> Dict[str, Any]:
        from cortex_server.routers.bridge import bridge_configuration_state

        state = bridge_configuration_state()
        return {
            "level": self.level,
            "name": self.name,
            "status": state["status"],
            "reason": state["reason"],
            "federation": "not_implemented",
        }

    def register_agent(self, agent_id: str, agent_config: dict) -> dict:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def send_message(self, from_agent: str, to_agent: str, message: dict) -> dict:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def get_messages(self, agent_id: str, mark_read: bool = True) -> List[dict]:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def broadcast(
        self, from_agent: str, message: dict, filter_criteria: Optional[dict] = None
    ) -> dict:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def coordinate_task(self, task_description: str, involved_agents: List[str]) -> dict:
        raise NotImplementedError(_NOT_IMPLEMENTED)

    def discover_agents(self, capabilities: Optional[List[str]] = None) -> List[dict]:
        raise NotImplementedError(_NOT_IMPLEMENTED)


_bridge: Optional[Bridge] = None


def get_bridge() -> Bridge:
    """Get or create singleton instance."""
    global _bridge
    if _bridge is None:
        _bridge = Bridge()
    return _bridge
