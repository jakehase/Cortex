#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import json
from services.plasticity.replay_scheduler import schedule_replay
from services.plasticity.continual_eval import continual_eval_matrix
from services.plasticity.forgetting_alerts import forgetting_alert
samples = [
    {'sample_id': 'anchor_1', 'anchor': True, 'priority': 0.8, 'recency': 0.3},
    {'sample_id': 'novel_1', 'anchor': False, 'priority': 0.9, 'recency': 0.9},
]
metrics = continual_eval_matrix(retain=0.97, transfer=1.12, forget=0.03)
print(json.dumps({'schedule': schedule_replay(samples), 'metrics': metrics, 'alert': forgetting_alert(metrics)}, indent=2))
