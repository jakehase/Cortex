#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_ROOT = ROOT / "artifacts" / "cortex_roadmap" / "phase_d_wave"


def run_json(script: str):
    proc = subprocess.run(["python3", str(ROOT / script)], capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    integration = run_json("scripts/probes/probe_phase_d_integration.py")
    hardening = run_json("scripts/probes/probe_phase_d_hardening.py")
    benchmark = run_json("scripts/run_phase_d_embodiment_benchmark.py")
    aggregate = {
        "success": True,
        "integration": integration,
        "hardening": hardening,
        "benchmark": {
            "run_count": benchmark["run_count"],
            "success_rate": benchmark["success_rate"],
            "failure_taxonomy": benchmark["failure_taxonomy"],
        },
    }
    write_json(ARTIFACT_ROOT / "integration" / "probe_latest.json", integration)
    write_json(ARTIFACT_ROOT / "hardening" / "probe_latest.json", hardening)
    write_json(ARTIFACT_ROOT / "benchmark" / "benchmark_latest.json", benchmark)
    write_json(ARTIFACT_ROOT / "phase_d_impl_run_latest.json", aggregate)
    print(json.dumps(aggregate, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
