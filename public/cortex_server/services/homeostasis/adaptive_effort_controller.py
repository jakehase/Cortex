from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from services.homeostasis.conflict_arbitration_v2 import determine_regulation_mode
from services.homeostasis.dynamic_budget_allocator import allocate_dynamic_budget
from services.homeostasis.state_signal_model import build_state_signal_snapshot


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clip(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, round(float(value), 4)))


def _tempo(mode: str, state_vector: Dict[str, float]) -> str:
    if mode == "protective":
        return "deliberate"
    if mode == "conserve":
        return "tight"
    if float(state_vector.get("urgency", 0.0) or 0.0) >= 0.55:
        return "brisk"
    return "balanced"


def _reasoning_depth(mode: str, intent: str, risk_tier: str) -> int:
    base = {"qa": 2, "coding": 4, "planning": 4, "research": 4, "creative": 3, "reminder": 1}.get(intent, 2)
    if mode == "protective":
        base += 1
    elif mode == "conserve":
        base -= 1
    if risk_tier == "high":
        base += 1
    elif risk_tier == "critical":
        base += 2
    if intent == "reminder" and risk_tier in {"high", "critical"}:
        base = max(base, 2)
    if intent == "research" and risk_tier == "critical":
        base = max(base, 5)
    return max(1, min(base, 6))


def _route_guardrails(mode: str, intent: str, risk_tier: str) -> Dict[str, Any]:
    chain_allow = {
        "qa": ["fastlane_memory", "deliberate_council"],
        "coding": ["deliberate_council"],
        "planning": ["deliberate_council"],
        "research": ["research_grounded", "deliberate_council"],
        "creative": ["creative_fractal", "deliberate_council"],
        "reminder": ["safe_reminder", "deliberate_council"],
    }.get(intent, ["fastlane_memory"])
    if mode == "protective":
        if intent == "research":
            chain_allow = ["research_grounded", "deliberate_council"]
        else:
            chain_allow = ["deliberate_council"]
    elif mode == "conserve":
        if intent == "research":
            chain_allow = ["research_grounded"]
        elif intent == "creative":
            chain_allow = ["creative_fractal"]
        elif intent == "qa":
            chain_allow = ["fastlane_memory"]
    if risk_tier == "critical":
        chain_allow = ["research_grounded"] if intent == "research" else ["deliberate_council"]
    return {
        "allowed_chains": chain_allow,
        "prefer_chain": chain_allow[0],
        "block_fastlane": mode == "protective" or risk_tier in {"high", "critical"},
    }


def choose_effort_profile(
    *,
    intent: str,
    risk_tier: str,
    state_snapshot: Dict[str, Any] | None = None,
    observed_load: Dict[str, float] | None = None,
) -> Dict[str, Any]:
    if state_snapshot is None:
        state_snapshot = build_state_signal_snapshot()
    state_vector = state_snapshot.get("smoothed_state_vector") if isinstance(state_snapshot.get("smoothed_state_vector"), dict) else {}
    mode_info = determine_regulation_mode(state_vector)
    mode = str(mode_info.get("mode") or "normal")
    budget = allocate_dynamic_budget(
        intent=intent,
        risk_tier=risk_tier,
        state_snapshot=state_snapshot,
        observed_load=observed_load or {},
    )
    reasoning_depth = _reasoning_depth(mode, intent, risk_tier)
    guardrails = _route_guardrails(mode, intent, risk_tier)
    tempo = _tempo(mode, state_vector)
    tool_budget_class = "minimal" if mode == "conserve" and intent in {"qa", "reminder"} else "focused" if mode == "conserve" else "expanded" if mode == "protective" or intent in {"research", "coding"} else "standard"
    human_review = bool(risk_tier in {"high", "critical"} or mode == "protective")
    escalation = bool(
        float(state_vector.get("escalation_debt", 0.0) or 0.0) >= 0.6
        or mode == "protective"
        or risk_tier == "critical"
        or (intent == "reminder" and risk_tier in {"high", "critical"})
    )
    if human_review and intent in {"coding", "research"} and risk_tier in {"high", "critical"}:
        escalation = True
    profile = {
        "generated_at": _now_iso(),
        "intent": intent,
        "risk_tier": risk_tier,
        "mode": mode,
        "mode_reasons": mode_info.get("reasons") or [],
        "effort": {
            "reasoning_depth": reasoning_depth,
            "tempo": tempo,
            "tool_budget_class": tool_budget_class,
            "human_review_required": human_review,
            "escalation_recommended": escalation,
        },
        "guardrails": guardrails,
        "budget_reference": budget,
    }
    return profile


def run_effort_controller_benchmark(cases: List[Dict[str, Any]]) -> Dict[str, Any]:
    results = []
    success_count = 0
    for case in cases:
        profile = choose_effort_profile(
            intent=case["intent"],
            risk_tier=case["risk_tier"],
            state_snapshot=case.get("state_snapshot"),
            observed_load=case.get("observed_load") or {},
        )
        violations: List[str] = []
        expected_mode = case.get("expected_mode")
        if expected_mode and profile["mode"] != expected_mode:
            violations.append(f"mode:{expected_mode}->{profile['mode']}")
        expected_chain = case.get("expected_prefer_chain")
        if expected_chain and profile["guardrails"]["prefer_chain"] != expected_chain:
            violations.append(f"prefer_chain:{expected_chain}->{profile['guardrails']['prefer_chain']}")
        min_depth = case.get("min_reasoning_depth")
        if min_depth is not None and int(profile["effort"]["reasoning_depth"]) < int(min_depth):
            violations.append(f"depth_below_min:{min_depth}->{profile['effort']['reasoning_depth']}")
        max_depth = case.get("max_reasoning_depth")
        if max_depth is not None and int(profile["effort"]["reasoning_depth"]) > int(max_depth):
            violations.append(f"depth_above_max:{max_depth}->{profile['effort']['reasoning_depth']}")
        if case.get("expect_human_review") is not None and bool(profile["effort"]["human_review_required"]) != bool(case.get("expect_human_review")):
            violations.append("human_review_mismatch")
        if case.get("expect_escalation") is not None and bool(profile["effort"]["escalation_recommended"]) != bool(case.get("expect_escalation")):
            violations.append("escalation_mismatch")
        success = not violations
        if success:
            success_count += 1
        results.append({
            "case_id": case.get("case_id"),
            "profile": profile,
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
