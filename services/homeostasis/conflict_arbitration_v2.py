from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

from services.homeostasis.state_signal_model import build_state_signal_snapshot
from services.homeostasis.value_hierarchy_compiler import compile_value_hierarchy, load_hierarchy_spec


DEFAULT_R7_ROOT = Path("artifacts/cortex_roadmap/r7_value_homeostasis")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clip(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, round(float(value), 4)))


def determine_regulation_mode(state_vector: Dict[str, float]) -> Dict[str, Any]:
    urgency = float(state_vector.get("urgency", 0.0) or 0.0)
    risk_pressure = float(state_vector.get("risk_pressure", 0.0) or 0.0)
    fatigue = float(state_vector.get("fatigue", 0.0) or 0.0)
    timeout_pressure = float(state_vector.get("timeout_pressure", 0.0) or 0.0)
    error_pressure = float(state_vector.get("error_pressure", 0.0) or 0.0)
    budget_pressure = float(state_vector.get("budget_pressure", 0.0) or 0.0)
    escalation_debt = float(state_vector.get("escalation_debt", 0.0) or 0.0)

    reasons: List[str] = []
    mode = "normal"
    if max(risk_pressure, urgency, error_pressure) >= 0.6:
        mode = "protective"
        if risk_pressure >= 0.6:
            reasons.append("high_risk_pressure")
        if urgency >= 0.6:
            reasons.append("high_urgency")
        if error_pressure >= 0.6:
            reasons.append("high_error_pressure")
    elif max(fatigue, timeout_pressure, budget_pressure, escalation_debt) >= 0.55:
        mode = "conserve"
        if fatigue >= 0.55:
            reasons.append("high_fatigue")
        if timeout_pressure >= 0.55:
            reasons.append("high_timeout_pressure")
        if budget_pressure >= 0.55:
            reasons.append("high_budget_pressure")
        if escalation_debt >= 0.55:
            reasons.append("high_escalation_debt")
    else:
        reasons.append("nominal_window")
    return {"mode": mode, "reasons": reasons}


def _candidate_scores(candidate: Dict[str, Any], compiled: Dict[str, Any]) -> Dict[str, float]:
    scores = candidate.get("scores") if isinstance(candidate.get("scores"), dict) else {}
    return {objective: _clip(scores.get(objective, 0.0)) for objective in compiled.get("objective_order") or []}


def _passes_hard_constraints(scores: Dict[str, float], compiled: Dict[str, Any]) -> Tuple[bool, List[str]]:
    constraints = compiled.get("hard_constraints") if isinstance(compiled.get("hard_constraints"), dict) else {}
    reasons: List[str] = []
    if float(scores.get("safety", 0.0)) < float(constraints.get("min_safety_score", 0.85) or 0.85):
        reasons.append("safety_below_floor")
    if float(scores.get("truth", 0.0)) < float(constraints.get("min_truth_score", 0.7) or 0.7):
        reasons.append("truth_below_floor")
    return (not reasons, reasons)


def _apply_mode_adjustments(candidate: Dict[str, Any], base_scores: Dict[str, float], mode: str, state_vector: Dict[str, float]) -> Tuple[Dict[str, float], List[str]]:
    adjusted = dict(base_scores)
    trace: List[str] = []
    traits = candidate.get("traits") if isinstance(candidate.get("traits"), dict) else {}
    safety_margin = float(traits.get("safety_margin", 0.5) or 0.5)
    truth_margin = float(traits.get("truth_margin", 0.5) or 0.5)
    intent_alignment = float(traits.get("intent_alignment", 0.5) or 0.5)
    reliability_margin = float(traits.get("reliability_margin", 0.5) or 0.5)
    efficiency_margin = float(traits.get("efficiency_margin", 0.5) or 0.5)

    if mode == "protective":
        adjusted["safety"] = _clip(adjusted["safety"] + 0.06 * safety_margin + 0.04 * float(state_vector.get("risk_pressure", 0.0) or 0.0))
        adjusted["truth"] = _clip(adjusted["truth"] + 0.03 * truth_margin)
        adjusted["reliability"] = _clip(adjusted["reliability"] + 0.05 * reliability_margin)
        adjusted["efficiency"] = _clip(adjusted["efficiency"] - 0.05 * max(0.0, 1.0 - efficiency_margin))
        trace.append("protective_mode_bias_to_safety_truth_reliability")
    elif mode == "conserve":
        adjusted["efficiency"] = _clip(adjusted["efficiency"] + 0.06 * efficiency_margin + 0.04 * float(state_vector.get("budget_pressure", 0.0) or 0.0))
        adjusted["reliability"] = _clip(adjusted["reliability"] + 0.03 * reliability_margin)
        adjusted["user_intent"] = _clip(adjusted["user_intent"] + 0.02 * intent_alignment)
        trace.append("conserve_mode_bias_to_efficiency_reliability")
    else:
        adjusted["user_intent"] = _clip(adjusted["user_intent"] + 0.03 * intent_alignment)
        adjusted["truth"] = _clip(adjusted["truth"] + 0.02 * truth_margin)
        trace.append("normal_mode_bias_to_intent_truth_balance")
    return adjusted, trace


def _lexicographic_key(scores: Dict[str, float], compiled: Dict[str, Any], candidate_id: str) -> Tuple[Any, ...]:
    ordered = tuple(scores.get(objective, 0.0) for objective in compiled.get("objective_order") or [])
    return ordered + (scores.get("reliability", 0.0), scores.get("efficiency", 0.0), candidate_id)


def arbitrate_conflict(case: Dict[str, Any], compiled: Dict[str, Any], state_snapshot: Dict[str, Any] | None = None) -> Dict[str, Any]:
    if state_snapshot is None:
        state_snapshot = build_state_signal_snapshot()
    state_vector = state_snapshot.get("smoothed_state_vector") if isinstance(state_snapshot.get("smoothed_state_vector"), dict) else {}
    mode_info = determine_regulation_mode(state_vector)
    reports = []
    valid_rows = []
    for candidate in case.get("candidates") or []:
        base_scores = _candidate_scores(candidate, compiled)
        adjusted_scores, mode_trace = _apply_mode_adjustments(candidate, base_scores, str(mode_info.get("mode") or "normal"), state_vector)
        ok, failures = _passes_hard_constraints(adjusted_scores, compiled)
        report = {
            "candidate_id": candidate.get("candidate_id"),
            "base_scores": base_scores,
            "adjusted_scores": adjusted_scores,
            "passes_hard_constraints": ok,
            "constraint_failures": failures,
            "trace": mode_trace,
        }
        reports.append(report)
        if ok:
            valid_rows.append(report)

    fallback_used = False
    if valid_rows:
        selected = sorted(valid_rows, key=lambda row: _lexicographic_key(row["adjusted_scores"], compiled, str(row.get("candidate_id") or "")), reverse=True)[0]
    else:
        fallback_used = True
        selected = sorted(reports, key=lambda row: row["adjusted_scores"].get("safety", 0.0), reverse=True)[0]
        selected["trace"] = list(selected.get("trace") or []) + ["fallback_to_highest_safety_candidate"]

    selected_scores = selected.get("adjusted_scores") if isinstance(selected.get("adjusted_scores"), dict) else {}
    runner_up = None
    if len(valid_rows) > 1:
        ordered = sorted(valid_rows, key=lambda row: _lexicographic_key(row["adjusted_scores"], compiled, str(row.get("candidate_id") or "")), reverse=True)
        runner_up = ordered[1]
    rationale = [f"mode={mode_info.get('mode')}"] + list(mode_info.get("reasons") or []) + list(selected.get("trace") or [])
    if runner_up is not None:
        for objective in compiled.get("objective_order") or []:
            a = float(selected_scores.get(objective, 0.0) or 0.0)
            b = float(runner_up.get("adjusted_scores", {}).get(objective, 0.0) or 0.0)
            if a > b:
                rationale.append(f"selected_wins_on_{objective}")
                break

    return {
        "case_id": case.get("case_id"),
        "mode": mode_info.get("mode"),
        "mode_reasons": mode_info.get("reasons") or [],
        "selected_candidate_id": selected.get("candidate_id"),
        "selected_scores": selected_scores,
        "fallback_used": fallback_used,
        "candidate_reports": reports,
        "rationale": rationale,
    }


def run_conflict_arbitration_benchmark(compiled: Dict[str, Any], cases: List[Dict[str, Any]], state_snapshot: Dict[str, Any] | None = None) -> Dict[str, Any]:
    results = []
    successes = 0
    for case in cases:
        state_override = case.get("state_snapshot") if isinstance(case.get("state_snapshot"), dict) else state_snapshot
        result = arbitrate_conflict(case, compiled, state_snapshot=state_override)
        expected = case.get("expected_candidate_id")
        success = result.get("selected_candidate_id") == expected and bool(result.get("rationale"))
        if success:
            successes += 1
        results.append({
            **result,
            "expected_candidate_id": expected,
            "success": success,
        })
    success_rate = round(successes / max(1, len(results)), 4)
    return {
        "generated_at": _now_iso(),
        "case_count": len(results),
        "success_count": successes,
        "success_rate": success_rate,
        "gate_pass": success_rate >= 0.92,
        "results": results,
    }
