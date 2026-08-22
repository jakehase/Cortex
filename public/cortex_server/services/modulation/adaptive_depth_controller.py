from __future__ import annotations

from typing import Any, Dict

JsonDict = Dict[str, Any]


def choose_reasoning_profile(state: JsonDict) -> JsonDict:
    salience = float(state.get('salience', 0.0) or 0.0)
    uncertainty = float(state.get('uncertainty', 0.0) or 0.0)
    urgency = float(state.get('urgency', 0.0) or 0.0)
    novelty = float(state.get('novelty', 0.0) or 0.0)
    score = (salience * 0.35) + (uncertainty * 0.3) + (urgency * 0.2) + (novelty * 0.15)
    if score >= 0.7:
        depth = 5
    elif score >= 0.55:
        depth = 4
    elif score >= 0.4:
        depth = 3
    elif score >= 0.25:
        depth = 2
    else:
        depth = 1
    return {
        'reasoning_depth': depth,
        'tempo': 'deliberate' if depth >= 4 else ('steady' if depth >= 2 else 'fast'),
        'deep_reasoning_required': depth >= 4,
    }
