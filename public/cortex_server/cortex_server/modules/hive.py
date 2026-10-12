"""Level 12: Hive - swarm decomposition and read-only fan-out.

The implementation lives in ``cortex_server.modules.hive_swarm``; this module
keeps the historical ``get_hive()`` entry point and reports real state instead
of a "placeholder" string.
"""

from typing import Any, Dict, Mapping, Optional

from cortex_server.modules import hive_swarm
from cortex_server.modules.level_registry import get_level_entry


class Hive:
    """Thin facade over :mod:`hive_swarm`."""

    def __init__(self):
        identity = get_level_entry(12) or {"level": 12, "name": "Hive/Darwin"}
        self.level = identity["level"]
        self.name = identity["name"]

    def status(self) -> Dict[str, Any]:
        adapters = hive_swarm.adapter_availability()
        return {
            "level": self.level,
            "name": self.name,
            "implementation": "cortex_server.modules.hive_swarm",
            "subtask_adapters": adapters,
            "read_only_adapters_available": sorted(k for k, v in adapters.items() if v.get("available")),
            "stats": hive_swarm.stats(),
        }

    async def run(self, goal: str, *, context: Optional[Mapping[str, Any]] = None,
                  max_subtasks: int = hive_swarm.DEFAULT_SUBTASKS) -> Dict[str, Any]:
        return await hive_swarm.run_swarm(goal, context=context, max_subtasks=max_subtasks)


_hive = None


def get_hive():
    """Get or create singleton instance."""
    global _hive
    if _hive is None:
        _hive = Hive()
    return _hive
