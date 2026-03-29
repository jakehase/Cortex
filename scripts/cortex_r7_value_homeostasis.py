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
    payload = {
        "success": True,
        "phase": "phase_e_r7",
        "landed_steps": [1],
        "remaining_steps": list(range(2, 13)),
        "step1": step1,
    }
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
