from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from services.homeostasis.safety_envelope_overrides import evaluate_safety_envelope


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _live_baseline_decision(case: Dict[str, Any]) -> Dict[str, Any]:
    intent = str(case.get("intent") or "qa")
    risk_tier = str(case.get("risk_tier") or "low")
    if intent == "research":
        prefer_chain = "research_grounded"
    elif intent == "creative":
        prefer_chain = "creative_fractal"
    elif intent == "reminder":
        prefer_chain = "safe_reminder"
    elif risk_tier in {"high", "critical"}:
        prefer_chain = "deliberate_council"
    else:
        prefer_chain = "fastlane_memory"
    return {
        "mode": "normal",
        "prefer_chain": prefer_chain,
        "block_side_effects": risk_tier in {"high", "critical"},
        "manual_ack": risk_tier == "critical",
    }


def _estimate_quality(decision: Dict[str, Any], case: Dict[str, Any]) -> float:
    intent = str(case.get("intent") or "qa")
    risk_tier = str(case.get("risk_tier") or "low")
    prefer_chain = str(decision.get("prefer_chain") or "")
    score = 0.62
    if intent == "research" and prefer_chain == "research_grounded":
        score += 0.12
    if intent == "creative" and prefer_chain == "creative_fractal":
        score += 0.1
    if intent == "reminder" and prefer_chain == "safe_reminder":
        score += 0.08
    if intent in {"coding", "planning"} and prefer_chain == "deliberate_council":
        score += 0.08
    if risk_tier in {"high", "critical"} and prefer_chain == "deliberate_council":
        score += 0.1
    if decision.get("mode") == "protective":
        score += 0.05
    if decision.get("mode") == "baseline_safe_fallback":
        score += 0.03
    if decision.get("manual_ack"):
        score += 0.02
    if decision.get("mode") == "conserve":
        score -= 0.005
    return round(min(0.99, score), 4)


def _estimate_safety(decision: Dict[str, Any], case: Dict[str, Any]) -> float:
    risk_tier = str(case.get("risk_tier") or "low")
    score = 0.7
    if decision.get("block_side_effects"):
        score += 0.12
    if decision.get("manual_ack"):
        score += 0.08
    if decision.get("mode") == "emergency_freeze":
        score += 0.12
    elif decision.get("mode") == "baseline_safe_fallback":
        score += 0.08
    if risk_tier == "critical":
        score -= 0.06
    elif risk_tier == "high":
        score -= 0.03
    return round(min(0.99, score), 4)


def run_shadow_governor(cases: List[Dict[str, Any]]) -> Dict[str, Any]:
    rows = []
    disagreements = 0
    uplift_sum = 0.0
    safety_regressions = 0
    for case in cases:
        live = dict(case.get("live_decision") or _live_baseline_decision(case))
        shadow_result = evaluate_safety_envelope(
            intent=case["intent"],
            risk_tier=case["risk_tier"],
            state_snapshot=case.get("state_snapshot"),
            observed_load=case.get("observed_load") or {},
            incident_flags=case.get("incident_flags") or [],
        )
        shadow_override = shadow_result.get("override") if isinstance(shadow_result.get("override"), dict) else {}
        shadow = {
            "mode": shadow_override.get("mode"),
            "prefer_chain": (shadow_override.get("allowed_chains") or [None])[0],
            "block_side_effects": bool(shadow_override.get("block_side_effects")),
            "manual_ack": bool(shadow_override.get("require_manual_ack")),
        }
        disagree = (live.get("mode") != shadow.get("mode")) or (live.get("prefer_chain") != shadow.get("prefer_chain")) or (bool(live.get("block_side_effects")) != bool(shadow.get("block_side_effects")))
        disagreements += 1 if disagree else 0
        live_quality = _estimate_quality(live, case)
        shadow_quality = _estimate_quality(shadow, case)
        live_safety = _estimate_safety(live, case)
        shadow_safety = _estimate_safety(shadow, case)
        uplift = round((shadow_quality - live_quality) + (shadow_safety - live_safety), 4)
        uplift_sum += uplift
        if shadow_safety + 1e-9 < live_safety:
            safety_regressions += 1
        rows.append(
            {
                "case_id": case.get("case_id"),
                "intent": case.get("intent"),
                "risk_tier": case.get("risk_tier"),
                "live": live,
                "shadow": shadow,
                "disagree": disagree,
                "live_quality": live_quality,
                "shadow_quality": shadow_quality,
                "live_safety": live_safety,
                "shadow_safety": shadow_safety,
                "estimated_uplift": uplift,
            }
        )
    total = max(1, len(rows))
    disagreement_rate = round(disagreements / total, 4)
    avg_uplift = round(uplift_sum / total, 4)
    return {
        "generated_at": _now_iso(),
        "case_count": len(rows),
        "disagreement_rate": disagreement_rate,
        "average_estimated_uplift": avg_uplift,
        "safety_regression_count": safety_regressions,
        "gate_pass": safety_regressions == 0 and avg_uplift >= 0.0,
        "rows": rows,
    }
