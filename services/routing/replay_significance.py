from __future__ import annotations

from typing import Dict


def significance_from_delta(delta: float, rows: int) -> Dict[str, float | bool]:
    score = abs(float(delta)) * max(1, int(rows))
    p_value = max(0.0001, min(1.0, 1.0 / (1.0 + score * 6.0)))
    return {
        "rows": int(rows),
        "delta": round(float(delta), 4),
        "p_value": round(p_value, 4),
        "significant": p_value < 0.05,
    }
