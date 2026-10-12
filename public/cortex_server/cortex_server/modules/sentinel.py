"""Level 21: Sentinel - endpoint health watching.

The implementation lives in ``cortex_server.routers.sentinel`` (durable
endpoint watchers, authorized scans, fail-closed health state). This module
delegates to it so no caller ever receives a placeholder status. Sentinel does
not perform filesystem watching, security scanning or self-healing.
"""

from typing import Any, Dict, Optional

from cortex_server.modules.level_registry import get_level_entry


class Sentinel:
    """Delegate to the router's measured health snapshot."""

    def __init__(self):
        identity = get_level_entry(21) or {"level": 21, "name": "Sentinel"}
        self.level = identity["level"]
        self.name = identity["name"]

    def status(self) -> Dict[str, Any]:
        from cortex_server.routers.sentinel import _sentinel_health_snapshot, watcher_state_health

        health = _sentinel_health_snapshot()
        return {
            "level": self.level,
            "name": self.name,
            **health,
            "persistence": watcher_state_health(),
        }


_sentinel: Optional[Sentinel] = None


def get_sentinel() -> Sentinel:
    """Get or create singleton instance."""
    global _sentinel
    if _sentinel is None:
        _sentinel = Sentinel()
    return _sentinel
