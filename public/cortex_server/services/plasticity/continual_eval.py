from __future__ import annotations

from typing import Any, Dict

JsonDict = Dict[str, Any]


def continual_eval_matrix(*, retain: float, transfer: float, forget: float) -> JsonDict:
    retain = float(retain)
    transfer = float(transfer)
    forget = float(forget)
    return {
        'retain': round(retain, 4),
        'transfer': round(transfer, 4),
        'forget': round(forget, 4),
        'retention_regression_after_update': round(max(0.0, 1.0 - retain), 4),
        'forward_transfer_gain': round(max(0.0, transfer - 1.0), 4),
    }
