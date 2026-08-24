from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


SOURCE_ROOT = Path(__file__).resolve().parents[3]
BUILD = SOURCE_ROOT / "scripts/build-release-envelope.py"
VERIFY = SOURCE_ROOT / "scripts/verify-release-envelope.py"


def _run(*args, cwd=None):
    return subprocess.run(args, cwd=cwd, text=True, capture_output=True, check=False)


def test_release_envelope_binds_exact_files_modes_and_absence_of_extras(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "q9-test"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "q9-test@example.invalid"], cwd=repo, check=True)
    (repo / "app.txt").write_text("q9\n", encoding="utf-8")
    script = repo / "run.sh"
    script.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    os.chmod(script, 0o755)
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=repo, check=True)
    (repo / "second.txt").write_text("second\n", encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "release"], cwd=repo, check=True)

    envelope = tmp_path / "envelope.json"
    built = _run(
        sys.executable,
        str(BUILD),
        "--root",
        str(repo),
        "--output",
        str(envelope),
        "--release-id",
        "q9-test",
        "--require-clean",
    )
    assert built.returncode == 0, built.stderr
    payload = json.loads(envelope.read_text(encoding="utf-8"))
    assert payload["fileCount"] == 3
    assert {row["mode"] for row in payload["files"]} == {0o644, 0o755}

    release = tmp_path / "release"
    release.mkdir()
    for item in repo.iterdir():
        if item.name == ".git":
            continue
        shutil.copy2(item, release / item.name)
    verified = _run(
        sys.executable,
        str(VERIFY),
        "--root",
        str(release),
        "--envelope",
        str(envelope),
    )
    assert verified.returncode == 0, verified.stderr
    assert json.loads(verified.stdout)["outcome"] == "green"

    (release / "app.txt").write_text("tampered\n", encoding="utf-8")
    tampered = _run(
        sys.executable,
        str(VERIFY),
        "--root",
        str(release),
        "--envelope",
        str(envelope),
    )
    assert tampered.returncode == 1
    assert json.loads(tampered.stdout)["mismatchCount"] >= 1

    (release / "app.txt").write_text("q9\n", encoding="utf-8")
    (release / "extra.txt").write_text("unclassified\n", encoding="utf-8")
    extra = _run(
        sys.executable,
        str(VERIFY),
        "--root",
        str(release),
        "--envelope",
        str(envelope),
    )
    assert extra.returncode == 1
    assert json.loads(extra.stdout)["extraPathCount"] == 1


def test_q9_runtime_surface_contract_has_no_live_secret_values():
    contract = json.loads((SOURCE_ROOT / "ops/release/runtime-surfaces.json").read_text())
    schema = json.loads((SOURCE_ROOT / "ops/config/cortex-env.schema.json").read_text())
    assert contract["release"]["readOnly"] is True
    assert contract["release"]["sourceTreeWritesAllowed"] is False
    assert {row["name"] for row in contract["units"]} >= {
        "cortex.service",
        "cortex-health-watchdog.service",
        "cortex-health-watchdog.timer",
        "cortex-ollama-tunnel.service",
        "openclaw-gateway.service",
    }
    assert schema["properties"]["CORTEX_SAFE_MODE"]["enum"] == ["true", "1"]
    assert schema["properties"]["ORACLE_OLLAMA_URL"]["const"] == "http://127.0.0.1:11434"
    encoded = json.dumps({"contract": contract, "schema": schema})
    assert "37.27.129.239" not in encoded
    assert "10.0.0." not in encoded
