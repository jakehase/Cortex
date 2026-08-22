from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple


DEFAULT_SPEC_PATH = Path(__file__).with_name("objective_hierarchy.json")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_hierarchy_spec(path: Path | str = DEFAULT_SPEC_PATH) -> Dict[str, Any]:
    p = Path(path)
    return json.loads(p.read_text(encoding="utf-8"))


def compile_value_hierarchy(spec: Dict[str, Any]) -> Dict[str, Any]:
    objectives = sorted(list(spec.get("objectives") or []), key=lambda row: int(row.get("priority", 999)))
    order = [str(row.get("id")) for row in objectives]
    weights = {objective: round(1.0 / (index + 1), 4) for index, objective in enumerate(order)}
    return {
        "generated_at": _now_iso(),
        "version": spec.get("version", "r7.value_hierarchy.v1"),
        "objective_order": order,
        "objective_weights": weights,
        "hard_constraints": dict(spec.get("hard_constraints") or {}),
        "tie_breakers": list(spec.get("tie_breakers") or []),
    }


def _candidate_objectives(candidate: Dict[str, Any], compiled: Dict[str, Any]) -> Dict[str, float]:
    scores = candidate.get("scores") if isinstance(candidate.get("scores"), dict) else {}
    out = {}
    for objective in compiled.get("objective_order") or []:
        out[objective] = round(float(scores.get(objective, 0.0) or 0.0), 4)
    return out


def _passes_hard_constraints(candidate: Dict[str, Any], compiled: Dict[str, Any]) -> Tuple[bool, List[str]]:
    scores = _candidate_objectives(candidate, compiled)
    constraints = compiled.get("hard_constraints") if isinstance(compiled.get("hard_constraints"), dict) else {}
    reasons: List[str] = []
    if scores.get("safety", 0.0) < float(constraints.get("min_safety_score", 0.85) or 0.85):
        reasons.append("safety_below_floor")
    if scores.get("truth", 0.0) < float(constraints.get("min_truth_score", 0.7) or 0.7):
        reasons.append("truth_below_floor")
    return (not reasons, reasons)


def _lexicographic_key(candidate: Dict[str, Any], compiled: Dict[str, Any]) -> Tuple[Any, ...]:
    scores = _candidate_objectives(candidate, compiled)
    ordered = tuple(scores.get(objective, 0.0) for objective in compiled.get("objective_order") or [])
    return ordered + (scores.get("reliability", 0.0), scores.get("efficiency", 0.0), str(candidate.get("candidate_id") or ""))


def choose_hierarchy_candidate(case: Dict[str, Any], compiled: Dict[str, Any]) -> Dict[str, Any]:
    candidates = list(case.get("candidates") or [])
    reports = []
    valid_candidates = []
    for candidate in candidates:
        ok, reasons = _passes_hard_constraints(candidate, compiled)
        report = {
            "candidate_id": candidate.get("candidate_id"),
            "scores": _candidate_objectives(candidate, compiled),
            "passes_hard_constraints": ok,
            "constraint_failures": reasons,
        }
        reports.append(report)
        if ok:
            valid_candidates.append(candidate)
    selected = None
    fallback_used = False
    if valid_candidates:
        selected = sorted(valid_candidates, key=lambda row: _lexicographic_key(row, compiled), reverse=True)[0]
    else:
        fallback_used = True
        selected = sorted(candidates, key=lambda row: _candidate_objectives(row, compiled).get("safety", 0.0), reverse=True)[0]
    return {
        "selected_candidate_id": selected.get("candidate_id"),
        "selected_scores": _candidate_objectives(selected, compiled),
        "fallback_used": fallback_used,
        "candidate_reports": reports,
    }


def evaluate_hierarchy_replay_case(case: Dict[str, Any], compiled: Dict[str, Any]) -> Dict[str, Any]:
    decision = choose_hierarchy_candidate(case, compiled)
    selected_scores = decision.get("selected_scores") if isinstance(decision.get("selected_scores"), dict) else {}
    selected_id = decision.get("selected_candidate_id")
    fallback_used = bool(decision.get("fallback_used"))
    report_map = {row.get("candidate_id"): row for row in (decision.get("candidate_reports") or [])}
    violations: List[str] = []
    for candidate in case.get("candidates") or []:
        candidate_id = candidate.get("candidate_id")
        if candidate_id == selected_id:
            continue
        other_report = report_map.get(candidate_id) or {}
        if not fallback_used and not bool(other_report.get("passes_hard_constraints")):
            continue
        other_scores = _candidate_objectives(candidate, compiled)
        for objective in compiled.get("objective_order") or []:
            if float(other_scores.get(objective, 0.0)) > float(selected_scores.get(objective, 0.0)):
                higher_priority_index = list(compiled.get("objective_order") or []).index(objective)
                lower_priority_objectives = list(compiled.get("objective_order") or [])[higher_priority_index + 1 :]
                selected_lower_advantage = any(
                    float(selected_scores.get(lower, 0.0)) > float(other_scores.get(lower, 0.0))
                    for lower in lower_priority_objectives
                )
                if selected_lower_advantage:
                    violations.append(f"higher_priority_lost:{objective}:{candidate_id}")
                break
    expected = case.get("expected_candidate_id")
    if expected and expected != selected_id:
        violations.append(f"expected_mismatch:{expected}->{selected_id}")
    return {
        "case_id": case.get("case_id"),
        "selected_candidate_id": selected_id,
        "expected_candidate_id": expected,
        "fallback_used": fallback_used,
        "candidate_reports": decision.get("candidate_reports"),
        "valid": not violations,
        "violations": violations,
    }


def run_hierarchy_replay(compiled: Dict[str, Any], cases: List[Dict[str, Any]]) -> Dict[str, Any]:
    results = [evaluate_hierarchy_replay_case(case, compiled) for case in cases]
    violation_count = sum(len(row.get("violations") or []) for row in results)
    return {
        "generated_at": _now_iso(),
        "case_count": len(results),
        "violation_count": violation_count,
        "all_valid": violation_count == 0 and all(bool(row.get("valid")) for row in results),
        "results": results,
    }
