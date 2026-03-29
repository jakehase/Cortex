from __future__ import annotations

from typing import Any, Dict, List

from services.routing._compat import optional_import


def _arm_library() -> Dict[str, Dict[str, Any]]:
    module = optional_import("cortex_server.modules.level_optimizer")
    library = getattr(module, "ARM_LIBRARY", None) if module else None
    if isinstance(library, dict):
        return library
    return {
        "fastlane_memory": {"levels": [5, 34, 7, 22], "policy": "fastlane", "description": "Fastlane with memory context reinforcement"},
        "deliberate_council": {"levels": [5, 15, 32, 34], "policy": "deliberate", "description": "Multi-perspective path for tradeoffs and constraints"},
        "creative_fractal": {"levels": [13, 29, 32, 34], "policy": "creative", "description": "Recursive ideation/synthesis path"},
    }


_CHAIN_METRICS = {
    "fastlane_memory": {"latency": 1.0, "cost": 1.0, "risk": 0.1},
    "deliberate_council": {"latency": 2.8, "cost": 2.4, "risk": 0.15},
    "creative_fractal": {"latency": 2.4, "cost": 2.1, "risk": 0.18},
    "research_grounded": {"latency": 2.9, "cost": 2.2, "risk": 0.12},
    "safe_reminder": {"latency": 1.1, "cost": 0.8, "risk": 0.05},
}


def _base_candidate(chain_id: str, *, levels: List[int], policy: str, description: str) -> Dict[str, Any]:
    metrics = _CHAIN_METRICS.get(chain_id, {"latency": 2.0, "cost": 1.5, "risk": 0.1})
    return {
        "chain_id": chain_id,
        "levels": list(levels),
        "policy": policy,
        "description": description,
        "latency": metrics["latency"],
        "cost": metrics["cost"],
        "risk": metrics["risk"],
    }


def generate_candidates(features: Dict[str, Any]) -> List[Dict[str, Any]]:
    intent = str(features.get("intent") or "qa")
    library = _arm_library()
    out: List[Dict[str, Any]] = []
    base_ids = ["fastlane_memory", "deliberate_council"]
    if intent == "creative":
        base_ids.append("creative_fractal")
    for chain_id in base_ids:
        arm = library.get(chain_id)
        if not isinstance(arm, dict):
            continue
        out.append(
            _base_candidate(
                chain_id,
                levels=list(arm.get("levels") or []),
                policy=str(arm.get("policy") or chain_id),
                description=str(arm.get("description") or chain_id),
            )
        )
    if intent == "research":
        out.append(
            _base_candidate(
                "research_grounded",
                levels=[2] + list((library.get("fastlane_memory") or {}).get("levels") or [5, 34, 7, 22]),
                policy="research",
                description="Grounded research path with live evidence emphasis",
            )
        )
    if intent == "reminder":
        out.append(
            _base_candidate(
                "safe_reminder",
                levels=[5, 34],
                policy="reminder",
                description="Low-risk reminder path",
            )
        )
    unique: Dict[str, Dict[str, Any]] = {row["chain_id"]: row for row in out}
    return list(unique.values())
