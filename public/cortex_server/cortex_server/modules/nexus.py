# cortex_server/modules/nexus.py
"""
Nexus - Level 24: canonical Cortex orchestration helper.

This module is intentionally lightweight, but it should not drift from the
registered Cortex topology or advertise empty orchestration. The FastAPI Nexus
router performs the richer runtime routing; this helper provides a deterministic
in-process orchestration summary for callers that import the module directly.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List

from cortex_server.modules.level_registry import get_level_registry


ALWAYS_ON_LEVELS = [5, 17, 18, 20, 21, 22, 23, 24, 25, 27, 32, 33, 34, 35, 36]

_LEVEL_TRIGGERS: Dict[int, tuple[str, ...]] = {
    2: ("web", "search", "browse", "current", "latest", "source"),
    4: ("code", "test", "script", "calculate", "compute", "debug"),
    5: ("analyze", "reason", "why", "explain", "decide"),
    7: ("remember", "recall", "memory", "previous"),
    8: ("secure", "security", "threat", "scan"),
    9: ("architecture", "design", "system", "blueprint"),
    15: ("review", "critique", "tradeoff", "council"),
    18: ("send", "message", "email", "notify", "communicate"),
    20: ("scenario", "what if", "sandbox"),
    21: ("health", "monitor", "status", "degraded"),
    22: ("long-term", "durable", "history", "memory"),
    24: ("orchestrate", "route", "coordinate", "nexus"),
    26: ("workflow", "pipeline", "steps", "automation"),
    27: ("generate", "forge", "build", "create"),
    30: ("forecast", "predict", "future"),
    33: ("ethic", "policy", "risk", "safe"),
    34: ("validate", "verify", "test", "evidence"),
    37: ("self", "awareness", "capability", "introspect"),
    38: ("augment", "control", "enhance", "classifier", "intent"),
}


def _level_map() -> Dict[int, Dict[str, Any]]:
    return {int(row["level"]): row for row in get_level_registry()}


def _score_query(query: str, levels: Iterable[int]) -> List[Dict[str, Any]]:
    q = (query or "").lower()
    level_map = _level_map()
    scored: List[Dict[str, Any]] = []
    for level in levels:
        triggers = _LEVEL_TRIGGERS.get(level, ())
        matched = [term for term in triggers if term in q]
        if not matched:
            continue
        score = min(0.95, 0.35 + (0.15 * len(matched)))
        row = level_map.get(level, {"name": f"L{level}", "canonical_status": ""})
        scored.append(
            {
                "level": level,
                "name": str(row.get("name", f"L{level}")).lower(),
                "score": round(score, 3),
                "reason": f"matched: {', '.join(matched[:4])}",
                "action": row.get("canonical_status", ""),
            }
        )
    return sorted(scored, key=lambda item: (-float(item["score"]), int(item["level"])))


class Nexus:
    def __init__(self):
        self.level = 24
        self.name = "nexus"
        self._memory: Dict[str, Any] = {}

    def orchestrate(self, query: str, context: Dict | None = None) -> Dict[str, Any]:
        """Return a deterministic orchestration recommendation for *query*."""
        level_map = _level_map()
        total_levels = len(level_map)
        dynamic_scores = _score_query(query, [level for level in level_map if level not in ALWAYS_ON_LEVELS])
        always_on = [
            {
                "level": level,
                "name": str(level_map[level].get("name", f"L{level}")).lower(),
                "score": 1.0,
                "reason": "canonical always-on orchestration layer",
                "action": level_map[level].get("canonical_status", ""),
            }
            for level in ALWAYS_ON_LEVELS
            if level in level_map
        ]
        recommended = (dynamic_scores[:15] + always_on)[: max(15, len(always_on))]
        return {
            "recommended_stack": recommended,
            "all_evaluated": total_levels,
            "activated": len(dynamic_scores),
            "coherence": round(len({item["level"] for item in recommended}) / max(1, total_levels), 3),
            "emergent_insights": [],
            "one_brain": True,
            "registry_version": "cortex.level-registry.v1",
        }

    def commit_to_memory(self, key: str, value: Any) -> None:
        """Store a key-value pair in the nexus internal memory."""
        self._memory[key] = value

    def get_context(self, query: str) -> Dict[str, Any]:
        """Return relevant context from memory based on a query string."""
        relevant = {}
        query_lower = query.lower()
        for key, value in self._memory.items():
            if query_lower in key.lower() or key.lower() in query_lower:
                relevant[key] = value
        if not relevant and self._memory:
            relevant = dict(self._memory)
        return relevant

    def get_full_state(self) -> Dict[str, Any]:
        """Return the complete Nexus helper state."""
        level_map = _level_map()
        return {
            "level": self.level,
            "name": self.name,
            "threshold": 0.5,
            "always_on": [level for level in ALWAYS_ON_LEVELS if level in level_map],
            "registered_levels": len(level_map),
            "memory": dict(self._memory),
            "memory_keys": list(self._memory.keys()),
            "total_memories": len(self._memory),
            "one_brain": True,
        }


# Singleton
nexus = Nexus()
