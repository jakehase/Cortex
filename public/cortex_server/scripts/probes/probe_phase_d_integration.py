#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.embodiment.episode_orchestrator import run_orchestrated_episode


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    result = run_orchestrated_episode(profile_name="contract_baseline_v2", seed=7)
    out = {
        "generated_at": now_iso(),
        "success": result["success"],
        "gates": {
            "phase_d_world_state_merge_present": bool(result["integration"]["world_state"]["merged"]),
            "phase_d_arbitration_present": bool(result["integration"]["arbitration"]),
            "phase_d_signal_present": bool(result["integration"]["signal"]),
            "phase_d_regulation_present": bool(result["integration"]["regulation"]),
        },
        "operator_summary": result["operator_summary"],
    }
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
