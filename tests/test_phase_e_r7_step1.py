from services.homeostasis.baseline_regulation import build_baseline_regulation_snapshot, validate_baseline_regulation_snapshot


def test_r7_step1_baseline_snapshot_has_required_sections():
    snapshot = build_baseline_regulation_snapshot()
    assert snapshot["phase"] == "phase_e_r7_step1"
    assert "source_artifacts" in snapshot
    telemetry = snapshot["telemetry"]
    for key in ["quality", "latency", "reliability", "cost", "safety", "operator"]:
        assert key in telemetry


def test_r7_step1_baseline_snapshot_validates_cleanly():
    snapshot = build_baseline_regulation_snapshot()
    validation = validate_baseline_regulation_snapshot(snapshot)
    assert validation["valid"] is True
    assert validation["drift_stable"] is True


import json
import subprocess
from pathlib import Path


def test_r7_phase_e_aggregate_entrypoint_reports_step1_landed():
    root = Path(__file__).resolve().parents[1]
    proc = subprocess.run(["python3", str(root / "scripts/cortex_r7_value_homeostasis.py")], capture_output=True, text=True, check=True)
    payload = json.loads(proc.stdout)
    assert payload["success"] is True
    assert payload["phase"] == "phase_e_r7"
    assert payload["landed_steps"] == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
