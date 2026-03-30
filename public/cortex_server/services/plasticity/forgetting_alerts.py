from __future__ import annotations

from typing import Any, Dict

JsonDict = Dict[str, Any]


def forgetting_alert(metrics: JsonDict, *, retention_floor: float = 0.95, anchor_violation_count: int = 0) -> JsonDict:
    regression = float(metrics.get('retention_regression_after_update', 0.0) or 0.0)
    retain = 1.0 - regression
    alert = retain < retention_floor or int(anchor_violation_count) > 0
    return {
        'alert': alert,
        'rollback_recommended': alert,
        'reasons': [
            reason for reason, active in {
                'retention_regression': retain < retention_floor,
                'anchor_violation': int(anchor_violation_count) > 0,
            }.items() if active
        ],
    }
