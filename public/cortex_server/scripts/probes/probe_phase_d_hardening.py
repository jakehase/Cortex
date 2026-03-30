#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.embodiment.closed_loop_runner import run_closed_loop_episode


PROFILES = [
    "contract_baseline_v2",
    "sim2real_transfer_v1",
    "failure_taxonomy_challenge_v1",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    runs = [run_closed_loop_episode(profile_name=name, seed=11) for name in PROFILES]
    out = {
        "generated_at": now_iso(),
        "profiles": [run["summary"] for run in runs],
        "gates": {
            "phase_d_fault_injection_exercised": any(run["profile"].get("fault_mode") for run in runs),
            "phase_d_intervention_path_seen": any(run["summary"]["intervention_triggered"] for run in runs),
            "phase_d_action_bounds_hold": all(run["summary"]["bounded_actions"] for run in runs),
        },
    }
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
