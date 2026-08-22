#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_json(script: str):
    proc = subprocess.run(["python3", str(ROOT / script)], capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def main() -> int:
    step1 = run_json("scripts/cortex_r7_step1_baseline_regulation.py")
    step2 = run_json("scripts/cortex_r7_step2_state_signal_model.py")
    step3 = run_json("scripts/cortex_r7_step3_value_hierarchy_compiler.py")
    step4 = run_json("scripts/cortex_r7_step4_conflict_arbitration.py")
    step5 = run_json("scripts/cortex_r7_step5_dynamic_budget_allocator.py")
    step6 = run_json("scripts/cortex_r7_step6_adaptive_effort_controller.py")
    step7 = run_json("scripts/cortex_r7_step7_safety_envelope_overrides.py")
    step8 = run_json("scripts/cortex_r7_step8_shadow_governor_runner.py")
    step9 = run_json("scripts/cortex_r7_step9_canary_governor_controller.py")
    step10 = run_json("scripts/cortex_r7_step10_full_rollout_autotuner.py")
    payload = {
        "success": True,
        "phase": "phase_e_r7",
        "landed_steps": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        "remaining_steps": list(range(11, 13)),
        "step1": step1,
        "step2": step2,
        "step3": step3,
        "step4": step4,
        "step5": step5,
        "step6": step6,
        "step7": step7,
        "step8": step8,
        "step9": step9,
        "step10": step10,
    }
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
