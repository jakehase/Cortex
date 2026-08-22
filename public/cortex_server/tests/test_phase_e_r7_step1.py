from services.homeostasis.baseline_regulation import build_baseline_regulation_snapshot, validate_baseline_regulation_snapshot


def test_r7_step1_baseline_snapshot_has_required_sections():
    snapshot = build_baseline_regulation_snapshot(live_processes=[], get_runtime_events_fn=lambda process_id, limit=200: [])
    assert snapshot["phase"] == "phase_e_r7_step1"
    assert "source_artifacts" in snapshot
    telemetry = snapshot["telemetry"]
    for key in ["quality", "latency", "reliability", "cost", "safety", "operator"]:
        assert key in telemetry


def test_r7_step1_baseline_snapshot_validates_cleanly():
    snapshot = build_baseline_regulation_snapshot(live_processes=[], get_runtime_events_fn=lambda process_id, limit=200: [])
    validation = validate_baseline_regulation_snapshot(snapshot)
    assert validation["valid"] is True
    assert validation["drift_stable"] is True


import json
import os
import subprocess
from pathlib import Path


def test_r7_phase_e_aggregate_entrypoint_reports_step1_landed():
    root = Path(__file__).resolve().parents[1]
    proc = subprocess.run(["python3", str(root / "scripts/cortex_r7_value_homeostasis.py")], capture_output=True, text=True, check=True)
    payload = json.loads(proc.stdout)
    assert payload["success"] is True
    assert payload["phase"] == "phase_e_r7"
    assert payload["landed_steps"] == list(range(1, 13))
    assert payload["remaining_steps"] == []



def test_r7_step1_script_respects_artifact_root_override(tmp_path):
    root = Path(__file__).resolve().parents[1]
    artifact_root = tmp_path / "isolated-artifacts"
    proc = subprocess.run(
        ["python3", str(root / "scripts/cortex_r7_step1_baseline_regulation.py")],
        capture_output=True,
        text=True,
        check=True,
        env={**os.environ, "CORTEX_ARTIFACT_ROOT": str(artifact_root)},
    )
    payload = json.loads(proc.stdout)
    expected_snapshot = artifact_root / "r7_value_homeostasis" / "step1" / "baseline_regulation_snapshot_latest.json"
    assert expected_snapshot.exists()
    assert payload["snapshot_path"] == str(expected_snapshot)
