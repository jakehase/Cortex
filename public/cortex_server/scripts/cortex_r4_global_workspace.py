#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import json
from services.workspace.arbitration_engine import choose_specialist
from services.workspace.broadcast_policy import select_broadcast_payload

candidates = [
    {'name': 'planner', 'priority': 0.8, 'confidence': 0.9},
    {'name': 'retriever', 'priority': 0.7, 'confidence': 0.85},
]
payload = [
    {'topic': 'goal', 'salience': 0.9},
    {'topic': 'smalltalk', 'salience': 0.2},
]
print(json.dumps({'arbitration': choose_specialist(candidates), 'broadcast': select_broadcast_payload(payload)}, indent=2))
