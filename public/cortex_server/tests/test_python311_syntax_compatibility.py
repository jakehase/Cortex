import subprocess
import sys
from pathlib import Path


def test_oracle_runtime_source_uses_python311_grammar():
    oracle_source = (
        Path(__file__).resolve().parents[1] / "cortex_server" / "routers" / "oracle.py"
    )
    # Parser diagnostics are unconditional; F821 keeps this from becoming a
    # general lint gate while Ruff applies the requested Python grammar.
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "ruff",
            "check",
            "--isolated",
            "--no-cache",
            "--target-version",
            "py311",
            "--select",
            "F821",
            str(oracle_source),
        ],
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
