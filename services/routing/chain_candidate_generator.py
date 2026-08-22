from __future__ import annotations

from typing import Any, Dict, List

from services.routing._compat import optional_import


_CORE_LEVEL_REQUIREMENTS = {
    "fastlane_memory": [34],
    "deliberate_council": [5, 34],
    "creative_fractal": [32, 34],
    "research_grounded": [2, 34],
    "safe_reminder": [5, 34],
}


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


def required_core_levels(chain_id: str) -> List[int]:
    return list(_CORE_LEVEL_REQUIREMENTS.get(str(chain_id), []))


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
        "required_core_levels": required_core_levels(chain_id),
    }


def _dedupe_candidates(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    unique: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        unique[row["chain_id"]] = row
    return list(unique.values())


def _restrict_to_allowed(rows: List[Dict[str, Any]], allowed_chain_ids: List[str], default_chain: str | None = None) -> List[Dict[str, Any]]:
    if not allowed_chain_ids:
        return rows
    by_id = {row["chain_id"]: row for row in rows}
    ordered = [by_id[chain_id] for chain_id in allowed_chain_ids if chain_id in by_id]
    if default_chain and default_chain in by_id and default_chain not in [row["chain_id"] for row in ordered]:
        ordered.insert(0, by_id[default_chain])
    return ordered


def validate_candidate_constraints(features: Dict[str, Any], candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
    allowed = list(features.get("allowed_chain_ids") or [])
    default_chain = str(features.get("default_chain") or "").strip()
    violations = []
    chain_ids = [str(row.get("chain_id") or "") for row in candidates]
    if len(chain_ids) != len(set(chain_ids)):
        violations.append("duplicate_chain_ids")
    if allowed:
        invalid = [chain_id for chain_id in chain_ids if chain_id not in allowed]
        if invalid:
            violations.append(f"disallowed_chains:{','.join(sorted(invalid))}")
    if default_chain and default_chain not in chain_ids:
        violations.append("missing_default_chain")
    candidate_reports = []
    for row in candidates:
        chain_id = str(row.get("chain_id") or "")
        levels = list(row.get("levels") or [])
        required = required_core_levels(chain_id)
        missing_core = [level for level in required if level not in levels]
        if missing_core:
            violations.append(f"missing_core_levels:{chain_id}:{','.join(str(level) for level in missing_core)}")
        candidate_reports.append(
            {
                "chain_id": chain_id,
                "levels": levels,
                "required_core_levels": required,
                "missing_core_levels": missing_core,
                "allowed": (not allowed) or chain_id in allowed,
            }
        )
    return {
        "intent": features.get("intent"),
        "risk_tier": features.get("risk_tier"),
        "default_chain": default_chain,
        "allowed_chain_ids": allowed,
        "candidate_count": len(candidates),
        "candidate_reports": candidate_reports,
        "valid": not violations,
        "violations": violations,
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
    deduped = _dedupe_candidates(out)
    return _restrict_to_allowed(deduped, list(features.get("allowed_chain_ids") or []), default_chain=str(features.get("default_chain") or "").strip())
