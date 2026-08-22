import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_r7_step12_script_emits_novelty_probe():
    subprocess.run([
        "python3",
        str(ROOT / "scripts" / "cortex_r7_value_homeostasis.py"),
    ], capture_output=True, text=True, check=True)
    proc = subprocess.run([
        "python3",
        str(ROOT / "scripts" / "cortex_r7_step12_novelty_packaging.py"),
    ], capture_output=True, text=True, check=True)
    payload = json.loads(proc.stdout)
    assert payload["gate_pass"] is True
    assert payload["claim_map_path"].endswith("claim_map_latest.json")
