from __future__ import annotations


def calibrate_confidence(raw_confidence: float, *, evidence_count: int = 0, contradiction_count: int = 0) -> float:
    value = float(raw_confidence)
    value += min(0.2, 0.04 * max(0, int(evidence_count)))
    value -= min(0.5, 0.2 * max(0, int(contradiction_count)))
    return round(max(0.0, min(1.0, value)), 4)
