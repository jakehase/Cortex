from __future__ import annotations

from typing import Any, Dict

JsonDict = Dict[str, Any]


def _clamp(value: float) -> float:
    return round(max(0.0, min(1.0, float(value))), 4)


def modulation_state_from_observations(*, salience: float = 0.0, novelty: float = 0.0, uncertainty: float = 0.0, urgency: float = 0.0) -> JsonDict:
    state = {
        'salience': _clamp(salience),
        'novelty': _clamp(novelty),
        'uncertainty': _clamp(uncertainty),
        'urgency': _clamp(urgency),
    }
    state['focus_gain'] = _clamp((state['salience'] * 0.45) + (state['urgency'] * 0.35) + (state['novelty'] * 0.2))
    state['learning_gain'] = _clamp((state['novelty'] * 0.5) + (state['uncertainty'] * 0.35) + (state['salience'] * 0.15))
    return state
