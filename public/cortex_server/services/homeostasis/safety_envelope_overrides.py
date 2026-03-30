from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from services.homeostasis.adaptive_effort_controller import choose_effort_profile
from services.homeostasis.state_signal_model import build_state_signal_snapshot


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _state_vector(state_snapshot: Dict[str, Any] | None) -> Dict[str, float]:
    if state_snapshot is None:
        state_snapshot = build_state_signal_snapshot()
    return state_snapshot.get("smoothed_state_vector") if isinstance(state_snapshot.get("smoothed_state_vector"), dict) else {}


def evaluate_safety_envelope(
    *,
    intent: str,
    risk_tier: str,
    state_snapshot: Dict[str, Any] | None = None,
    observed_load: Dict[str, float] | None = None,
    incident_flags: List[str] | None = None,
) -> Dict[str, Any]:
    state_snapshot = state_snapshot or build_state_signal_snapshot()
    state_vector = _state_vector(state_snapshot)
    signal_health = state_snapshot.get("signal_health") if isinstance(state_snapshot.get("signal_health"), dict) else {}
    anomaly_tags = list(signal_health.get("anomaly_tags") or [])
    incident_flags = list(incident_flags or [])

    profile = choose_effort_profile(
        intent=intent,
        risk_tier=risk_tier,
        state_snapshot=state_snapshot,
        observed_load=observed_load or {},
    )

    risk_pressure = float(state_vector.get("risk_pressure", 0.0) or 0.0)
    error_pressure = float(state_vector.get("error_pressure", 0.0) or 0.0)
    timeout_pressure = float(state_vector.get("timeout_pressure", 0.0) or 0.0)
    escalation_debt = float(state_vector.get("escalation_debt", 0.0) or 0.0)

    freeze_trigger = (
        risk_tier == "critical"
        and (risk_pressure >= 0.7 or error_pressure >= 0.65)
        and ("dependency_degraded" in anomaly_tags or "runtime_health_warning" in anomaly_tags or "external_side_effect" in incident_flags or "destructive_action" in incident_flags)
    ) or ("emergency_freeze" in incident_flags)

    fallback_trigger = (
        (risk_tier in {"high", "critical"} and timeout_pressure >= 0.6)
        or ("rollback_required" in incident_flags)
        or ("dependency_degraded" in anomaly_tags and escalation_debt >= 0.4)
    ) and not freeze_trigger

    elevated_review = (
        profile["effort"]["human_review_required"]
        or risk_tier in {"high", "critical"}
        or bool(incident_flags)
        or "dependency_degraded" in anomaly_tags
    )

    if freeze_trigger:
        override_mode = "emergency_freeze"
        allowed_chains = ["research_grounded"] if intent == "research" else ["deliberate_council"]
        max_depth = min(3, int(profile["effort"]["reasoning_depth"]))
        block_side_effects = True
        require_manual_ack = True
    elif fallback_trigger:
        override_mode = "baseline_safe_fallback"
        allowed_chains = ["research_grounded"] if intent == "research" else ["deliberate_council"]
        max_depth = max(2, min(4, int(profile["effort"]["reasoning_depth"])))
        block_side_effects = True
        require_manual_ack = elevated_review
    elif elevated_review:
        override_mode = "elevated_review"
        allowed_chains = list(profile["guardrails"]["allowed_chains"])
        max_depth = int(profile["effort"]["reasoning_depth"])
        block_side_effects = risk_tier in {"high", "critical"}
        require_manual_ack = True
    else:
        override_mode = "normal"
        allowed_chains = list(profile["guardrails"]["allowed_chains"])
        max_depth = int(profile["effort"]["reasoning_depth"])
        block_side_effects = False
        require_manual_ack = False

    rationale: List[str] = []
    if freeze_trigger:
        rationale.append("freeze_triggered")
    if fallback_trigger:
        rationale.append("fallback_triggered")
    if elevated_review:
        rationale.append("elevated_review_required")
    rationale.extend(f"incident:{flag}" for flag in incident_flags)
    rationale.extend(f"anomaly:{tag}" for tag in anomaly_tags)

    return {
        "generated_at": _now_iso(),
        "intent": intent,
        "risk_tier": risk_tier,
        "profile": profile,
        "override": {
            "mode": override_mode,
            "allowed_chains": allowed_chains,
            "max_reasoning_depth": max_depth,
            "block_side_effects": block_side_effects,
            "require_manual_ack": require_manual_ack,
        },
        "rationale": rationale,
    }


def run_safety_override_drills(cases: List[Dict[str, Any]]) -> Dict[str, Any]:
    results = []
    success_count = 0
    for case in cases:
        result = evaluate_safety_envelope(
            intent=case["intent"],
            risk_tier=case["risk_tier"],
            state_snapshot=case.get("state_snapshot"),
            observed_load=case.get("observed_load") or {},
            incident_flags=case.get("incident_flags") or [],
        )
        override = result.get("override", {}) if isinstance(result.get("override"), dict) else {}
        violations: List[str] = []
        if case.get("expected_mode") and override.get("mode") != case.get("expected_mode"):
            violations.append(f"mode:{case.get('expected_mode')}->{override.get('mode')}")
        if case.get("expect_block_side_effects") is not None and bool(override.get("block_side_effects")) != bool(case.get("expect_block_side_effects")):
            violations.append("block_side_effects_mismatch")
        if case.get("expect_manual_ack") is not None and bool(override.get("require_manual_ack")) != bool(case.get("expect_manual_ack")):
            violations.append("manual_ack_mismatch")
        if case.get("max_reasoning_depth") is not None and int(override.get("max_reasoning_depth", 0)) > int(case.get("max_reasoning_depth")):
            violations.append("max_depth_exceeded")
        success = not violations
        if success:
            success_count += 1
        results.append({
            "case_id": case.get("case_id"),
            "result": result,
            "violations": violations,
            "success": success,
        })
    success_rate = round(success_count / max(1, len(results)), 4)
    return {
        "generated_at": _now_iso(),
        "case_count": len(results),
        "success_count": success_count,
        "success_rate": success_rate,
        "gate_pass": success_rate >= 0.92,
        "results": results,
    }
