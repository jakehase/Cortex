from __future__ import annotations

import math
from typing import Dict, Iterable, List


DEFAULT_SLA_SECONDS = 60.0


def _unique_reasons(reasons: Iterable[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for reason in reasons:
        text = str(reason or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


def evaluate_rollback(
    metrics: Dict[str, float | int],
    *,
    reasons: List[str] | None = None,
    sla_seconds: float = DEFAULT_SLA_SECONDS,
    recovery_seconds: float | None = None,
) -> Dict[str, object]:
    reasons = list(reasons or [])
    metrics = metrics if isinstance(metrics, dict) else {}

    def metric(name: str, *, zero_valid: bool = True) -> float | None:
        value = metrics.get(name)
        if isinstance(value, bool):
            return None
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(parsed) or (not zero_valid and parsed == 0.0):
            return None
        return parsed

    quality = metric("quality_non_regression_rate", zero_valid=False)
    latency = metric("p95_latency_delta")
    violations = metric("risk_policy_violation_count")
    for name, value in (
        ("quality_non_regression_rate", quality),
        ("p95_latency_delta", latency),
        ("risk_policy_violation_count", violations),
    ):
        if value is None:
            reasons.append(f"invalid_metric:{name}")
    if quality is not None and quality < 0.99:
        reasons.append("quality_regression")
    if latency is not None and latency > 0.05:
        reasons.append("latency_spike")
    if violations is not None and violations > 0:
        reasons.append("risk_violation")
    reasons = _unique_reasons(reasons)
    rollback_required = bool(reasons)
    recovery_value = None if recovery_seconds is None else round(float(recovery_seconds), 4)
    sla_breached = bool(rollback_required and recovery_value is not None and recovery_value > float(sla_seconds))
    return {
        "rollback_required": rollback_required,
        "reasons": reasons,
        "reason_count": len(reasons),
        "max_allowed_recovery_seconds": float(sla_seconds),
        "recovery_seconds": recovery_value,
        "sla_breached": sla_breached,
    }


def run_rollback_drill(cases: List[Dict[str, object]], *, sla_seconds: float = DEFAULT_SLA_SECONDS) -> Dict[str, object]:
    scenario_results = []
    expectations_met = True
    recovery_times = []
    for case in cases:
        name = str(case.get("name") or f"case_{len(scenario_results)}")
        metrics = dict(case.get("metrics") or {})
        expect_rollback = bool(case.get("expect_rollback", False))
        recovery_seconds = case.get("recovery_seconds")
        result = evaluate_rollback(
            metrics,
            reasons=list(case.get("reasons") or []),
            sla_seconds=sla_seconds,
            recovery_seconds=None if recovery_seconds is None else float(recovery_seconds),
        )
        matched_expectation = bool(result["rollback_required"]) == expect_rollback
        expectations_met = expectations_met and matched_expectation
        if result["rollback_required"] and result.get("recovery_seconds") is not None:
            recovery_times.append(float(result["recovery_seconds"]))
        scenario_results.append(
            {
                "name": name,
                "expect_rollback": expect_rollback,
                "matched_expectation": matched_expectation,
                "result": result,
            }
        )
    max_recovery = round(max(recovery_times), 4) if recovery_times else 0.0
    sla_met = max_recovery <= float(sla_seconds)
    return {
        "scenario_count": len(scenario_results),
        "scenarios": scenario_results,
        "all_expectations_met": expectations_met,
        "max_recovery_seconds": max_recovery,
        "sla_seconds": float(sla_seconds),
        "sla_met": sla_met,
        "gate_pass": expectations_met and sla_met,
    }
