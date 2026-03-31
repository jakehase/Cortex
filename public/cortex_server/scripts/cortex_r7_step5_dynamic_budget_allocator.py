#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.homeostasis.artifact_paths import resolve_r7_root, resolve_r9_root
from services.homeostasis.dynamic_budget_allocator import allocate_dynamic_budget, run_budget_allocator_simulation
from services.homeostasis.state_signal_model import build_state_signal_snapshot

R7_ROOT = resolve_r7_root()
R9_ROOT = resolve_r9_root()
ARTIFACT_DIR = R7_ROOT / "step5"

SAMPLE_CASES = [
    {"intent": "research", "risk_tier": "high", "observed_load": {"token_pressure": 0.58, "depth_pressure": 0.44, "latency_pressure": 0.52}},
    {"intent": "coding", "risk_tier": "medium", "observed_load": {"token_pressure": 0.5, "depth_pressure": 0.5, "latency_pressure": 0.38}},
    {"intent": "reminder", "risk_tier": "low", "observed_load": {"token_pressure": 0.1, "depth_pressure": 0.05, "latency_pressure": 0.08}},
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    state_snapshot = build_state_signal_snapshot(
        r7_root=R7_ROOT,
        r9_root=R9_ROOT,
    )
    simulation = run_budget_allocator_simulation(state_snapshot=state_snapshot)
    sample_allocations = [
        allocate_dynamic_budget(
            intent=case["intent"],
            risk_tier=case["risk_tier"],
            state_snapshot=state_snapshot,
            observed_load=case["observed_load"],
        )
        for case in SAMPLE_CASES
    ]
    probe_path = ARTIFACT_DIR / "budget_allocator_probe_latest.json"
    payload = {
        "generated_at": now_iso(),
        "sample_allocations": sample_allocations,
        "simulation": simulation,
        "gate_pass": bool(simulation.get("gate_pass")),
    }
    probe_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
