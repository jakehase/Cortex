from __future__ import annotations

from typing import Dict, List


def evaluate_rollback(metrics: Dict[str, float | int], *, reasons: List[str] | None = None) -> Dict[str, object]:
    reasons = list(reasons or [])
    if float(metrics.get("quality_non_regression_rate", 1.0) or 1.0) < 0.99:
        reasons.append("quality_regression")
    if float(metrics.get("p95_latency_delta", 0.0) or 0.0) > 0.05:
        reasons.append("latency_spike")
    if int(metrics.get("risk_policy_violation_count", 0) or 0) > 0:
        reasons.append("risk_violation")
    return {
        "rollback_required": bool(reasons),
        "reasons": reasons,
    }
