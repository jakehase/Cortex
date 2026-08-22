#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_probe(script: str):
    proc = subprocess.run(["python3", str(ROOT / script)], capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def main() -> int:
    result = run_probe("scripts/probes/probe_r5_embodiment.py")
    print(json.dumps({"success": True, "phase": "c", "probe": result}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
