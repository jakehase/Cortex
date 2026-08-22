#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import json
from services.modulation.policy_runtime import modulation_state_from_observations
from services.modulation.adaptive_depth_controller import choose_reasoning_profile
state = modulation_state_from_observations(salience=0.7, novelty=0.6, uncertainty=0.5, urgency=0.4)
print(json.dumps({'state': state, 'profile': choose_reasoning_profile(state)}, indent=2))
