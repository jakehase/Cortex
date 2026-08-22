from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from services.routing._compat import optional_import
from services.routing.chain_candidate_generator import generate_candidates


DEFAULT_WEIGHTS = {
    "quality": 1.35,
    "latency": 0.08,
    "cost": 0.06,
    "risk": 0.18,
}


def scoring_policy_spec(*, weights: Dict[str, float] | None = None) -> Dict[str, Any]:
    weights = dict(DEFAULT_WEIGHTS | dict(weights or {}))
    return {
        "version": "r9.scoring_policy.v1",
        "weights": weights,
        "objectives": {
            "maximize": ["expected_quality"],
            "minimize": ["latency", "cost", "risk"],
        },
        "quality_factors": [
            "complexity",
            "historical_success",
            "creative_fit",
            "research_fit",
            "coding_or_risk_fit",
            "reminder_fit",
            "runtime_policy_thresholds",
            "outcome_tuner_hint",
        ],
        "utility_formula": "quality*Wq - latency*Wl - cost*Wc - risk*Wr",
    }


def _runtime_policy_snapshot() -> Dict[str, Any]:
    module = optional_import("cortex_server.modules.routing_autotune")
    snapshot = getattr(module, "get_policy_snapshot", None) if module else None
    if callable(snapshot):
        try:
            result = snapshot()
            return dict(result) if isinstance(result, dict) else {}
        except Exception:
            return {}
    return {}


def _runtime_policy_hint(features: Dict[str, Any]) -> Dict[str, Any]:
    module = optional_import("cortex_server.modules.outcome_tuner")
    tuner_cls = getattr(module, "OutcomeTuner", None) if module else None
    if tuner_cls is None:
        return {}
    try:
        tuner = tuner_cls(artifact_dir=Path("/opt/clawdbot/artifacts/nexus_orchestration"))
        hint = tuner.get_policy_hint(archetype=str(features.get("archetype") or "simple_qa"), query=str(features.get("query") or ""))
        return dict(hint) if isinstance(hint, dict) else {}
    except Exception:
        return {}


def score_candidate(features: Dict[str, Any], candidate: Dict[str, Any], *, weights: Dict[str, float] | None = None, runtime_policy: Dict[str, Any] | None = None, policy_hint: Dict[str, Any] | None = None) -> Dict[str, Any]:
    weights = dict(DEFAULT_WEIGHTS | dict(weights or {}))
    runtime_policy = dict(runtime_policy or {})
    policy_hint = dict(policy_hint or {})

    quality_base = 0.5
    quality_from_complexity = 0.35 * float(features.get("complexity", 0.0))
    quality_from_history = 0.08 * float(features.get("historical_success", 0.5))
    quality = quality_base + quality_from_complexity + quality_from_history
    components = {
        "base": round(quality_base, 4),
        "complexity": round(quality_from_complexity, 4),
        "historical_success": round(quality_from_history, 4),
    }

    if candidate["chain_id"] == "creative_fractal":
        delta = 0.28 * float(features.get("creativity", 0.0))
        quality += delta
        components["creative_fit"] = round(delta, 4)
    if candidate["chain_id"] == "research_grounded":
        delta = 0.26 * float(features.get("research", 0.0))
        quality += delta
        components["research_fit"] = round(delta, 4)
        if "live_state" in list(features.get("risk_flags") or []):
            quality += 0.08
            components["live_state_bonus"] = 0.08
    if candidate["chain_id"] == "deliberate_council":
        delta = 0.24 * (1 if int(features.get("risk_count", 0) or 0) > 0 or float(features.get("coding", 0.0)) > 0 else 0)
        quality += delta
        components["coding_or_risk_fit"] = round(delta, 4)
    if candidate["chain_id"] == "safe_reminder":
        delta = 0.18 * (1 if str(features.get("intent") or "") == "reminder" else 0)
        quality += delta
        components["reminder_fit"] = round(delta, 4)
    if candidate["chain_id"] == "fastlane_memory" and (float(features.get("complexity", 0.0)) > 0.45 or int(features.get("risk_count", 0) or 0) > 0):
        quality -= 0.18
        components["fastlane_penalty"] = -0.18

    hard_threshold = float(runtime_policy.get("complexity_hard_threshold", 0.42) or 0.42)
    escalation_threshold = float(runtime_policy.get("fastlane_escalation_threshold", 0.72) or 0.72)
    if candidate["chain_id"] == "deliberate_council" and float(features.get("complexity", 0.0)) >= hard_threshold:
        quality += 0.07
        components["runtime_complexity_bonus"] = 0.07
    if candidate["chain_id"] == "fastlane_memory" and float(features.get("historical_success", 0.0)) < escalation_threshold:
        quality -= 0.04
        components["runtime_fastlane_penalty"] = -0.04

    recommended = str(policy_hint.get("recommended_policy") or "")
    stage = str(policy_hint.get("stage") or "")
    should_apply = bool(policy_hint.get("apply_recommendation")) or stage == "recommend"
    if should_apply and recommended == candidate["chain_id"]:
        quality += 0.06
        components["outcome_hint_bonus"] = 0.06
    elif should_apply and recommended and recommended != candidate["chain_id"]:
        quality -= 0.03
        components["outcome_hint_penalty"] = -0.03

    weighted_quality = weights["quality"] * quality
    weighted_latency = weights["latency"] * float(candidate.get("latency", 0.0))
    weighted_cost = weights["cost"] * float(candidate.get("cost", 0.0))
    weighted_risk = weights["risk"] * float(candidate.get("risk", 0.0))
    utility = weighted_quality - weighted_latency - weighted_cost - weighted_risk
    return {
        **candidate,
        "estimated_quality": round(max(0.0, min(1.0, quality)), 4),
        "utility": round(utility, 4),
        "quality_components": components,
        "utility_terms": {
            "weighted_quality": round(weighted_quality, 4),
            "weighted_latency": round(weighted_latency, 4),
            "weighted_cost": round(weighted_cost, 4),
            "weighted_risk": round(weighted_risk, 4),
        },
    }


def choose_route(features: Dict[str, Any], *, weights: Dict[str, float] | None = None) -> Dict[str, Any]:
    runtime_policy = _runtime_policy_snapshot()
    policy_hint = _runtime_policy_hint(features)
    scored = [
        score_candidate(features, row, weights=weights, runtime_policy=runtime_policy, policy_hint=policy_hint)
        for row in generate_candidates(features)
    ]
    scored.sort(key=lambda row: (-float(row.get("utility", 0.0)), row["chain_id"]))
    return {
        "selected": scored[0],
        "candidates": scored,
        "weights": dict(DEFAULT_WEIGHTS | dict(weights or {})),
        "runtime_policy": runtime_policy,
        "policy_hint": policy_hint,
        "policy_spec": scoring_policy_spec(weights=weights),
    }


def explain_route_decision(features: Dict[str, Any], *, weights: Dict[str, float] | None = None) -> Dict[str, Any]:
    decision = choose_route(features, weights=weights)
    selected = decision["selected"]
    utility_gap = 0.0
    if len(decision["candidates"]) > 1:
        utility_gap = round(float(selected.get("utility", 0.0)) - float(decision["candidates"][1].get("utility", 0.0)), 4)
    return {
        "policy_spec": decision["policy_spec"],
        "selected_chain": selected["chain_id"],
        "utility_gap_to_second": utility_gap,
        "candidates": decision["candidates"],
        "runtime_policy": decision["runtime_policy"],
        "policy_hint": decision["policy_hint"],
    }
