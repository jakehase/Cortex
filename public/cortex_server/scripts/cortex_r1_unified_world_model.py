#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import json
from services.world_state.update_pipeline import apply_events
from services.world_state.snapshot_manager import save_snapshot
from pathlib import Path
root = Path(__file__).resolve().parents[1]
out = root / 'artifacts' / 'cortex_roadmap' / 'r1_unified_world_model'
out.mkdir(parents=True, exist_ok=True)
events = [
    {'entity_id': 'service:api', 'kind': 'service', 'state': {'status': 'healthy'}, 'confidence': 0.9, 'provenance': [{'source': 'probe', 'event_id': 'evt1', 'ts': '2026-03-30T00:00:00+00:00'}]},
    {'entity_id': 'service:api', 'kind': 'service', 'state': {'latency_ms': 121}, 'confidence': 0.92, 'provenance': [{'source': 'probe', 'event_id': 'evt2', 'ts': '2026-03-30T00:05:00+00:00'}]},
]
snapshot = apply_events(events)
save_snapshot(out / 'snapshot_latest.json', snapshot)
print(json.dumps({'snapshot_path': str((out / 'snapshot_latest.json').relative_to(root)), 'entity_count': len(snapshot['entities'])}, indent=2))
