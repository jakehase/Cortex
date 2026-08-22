import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_r7_step11_script_emits_dashboard_probe():
    proc = subprocess.run([
        "python3",
        str(ROOT / "scripts" / "cortex_r7_step11_operator_dashboard.py"),
    ], capture_output=True, text=True, check=True)
    payload = json.loads(proc.stdout)
    assert payload["gate_pass"] is True
    assert payload["dashboard_path"].endswith("dashboard_live_local.html")
