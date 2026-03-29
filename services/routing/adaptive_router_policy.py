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

    quality = 0.5 + 0.35 * float(features.get("complexity", 0.0)) + 0.08 * float(features.get("historical_success", 0.5))
    if candidate["chain_id"] == "creative_fractal":
        quality += 0.28 * float(features.get("creativity", 0.0))
    if candidate["chain_id"] == "research_grounded":
        quality += 0.26 * float(features.get("research", 0.0))
        if "live_state" in list(features.get("risk_flags") or []):
            quality += 0.08
    if candidate["chain_id"] == "deliberate_council":
        quality += 0.24 * (1 if int(features.get("risk_count", 0) or 0) > 0 or float(features.get("coding", 0.0)) > 0 else 0)
    if candidate["chain_id"] == "safe_reminder":
        quality += 0.18 * (1 if str(features.get("intent") or "") == "reminder" else 0)
    if candidate["chain_id"] == "fastlane_memory" and (float(features.get("complexity", 0.0)) > 0.45 or int(features.get("risk_count", 0) or 0) > 0):
        quality -= 0.18

    hard_threshold = float(runtime_policy.get("complexity_hard_threshold", 0.42) or 0.42)
    escalation_threshold = float(runtime_policy.get("fastlane_escalation_threshold", 0.72) or 0.72)
    if candidate["chain_id"] == "deliberate_council" and float(features.get("complexity", 0.0)) >= hard_threshold:
        quality += 0.07
    if candidate["chain_id"] == "fastlane_memory" and float(features.get("historical_success", 0.0)) < escalation_threshold:
        quality -= 0.04

    recommended = str(policy_hint.get("recommended_policy") or "")
    stage = str(policy_hint.get("stage") or "")
    should_apply = bool(policy_hint.get("apply_recommendation")) or stage == "recommend"
    if should_apply and recommended == candidate["chain_id"]:
        quality += 0.06
    elif should_apply and recommended and recommended != candidate["chain_id"]:
        quality -= 0.03

    utility = (
        weights["quality"] * quality
        - weights["latency"] * float(candidate.get("latency", 0.0))
        - weights["cost"] * float(candidate.get("cost", 0.0))
        - weights["risk"] * float(candidate.get("risk", 0.0))
    )
    return {
        **candidate,
        "estimated_quality": round(max(0.0, min(1.0, quality)), 4),
        "utility": round(utility, 4),
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
    }
