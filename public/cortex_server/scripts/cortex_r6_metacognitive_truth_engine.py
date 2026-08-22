#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import json
from services.truth_engine.claim_graph import build_claim_graph
from services.truth_engine.pre_send_guard import guard_output
claims = [{'claim_id': 'c1', 'text': 'The service is up', 'evidence': ['probe:ok'], 'contradiction_count': 0}]
print(json.dumps({'graph': build_claim_graph(claims), 'guard': guard_output(claims=claims)}, indent=2))
