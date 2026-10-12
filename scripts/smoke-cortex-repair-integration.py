#!/usr/bin/env python3
"""Run the single local integration smoke for the recovered repair candidate."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]
DEPENDENCY_MANIFEST = (
    ROOT / "cortex-repair-20261011" / "requirements-integration-correction.txt"
)
DEFAULT_RECEIPT = (
    ROOT / "cortex-repair-20261011" / "integration-correction-smoke-receipt.json"
)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def pinned_dependencies() -> dict[str, str]:
    pins: dict[str, str] = {}
    for raw in DEPENDENCY_MANIFEST.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, version = line.partition("==")
        if not separator or not name or not version:
            raise RuntimeError(f"dependency is not exactly pinned: {line}")
        pins[name] = version
    return pins


def python_environment() -> dict[str, object]:
    expected = pinned_dependencies()
    installed: dict[str, str | None] = {}
    mismatches: list[dict[str, str | None]] = []
    for name, required in expected.items():
        try:
            actual = metadata.version(name)
        except metadata.PackageNotFoundError:
            actual = None
        installed[name] = actual
        if actual != required:
            mismatches.append({"package": name, "expected": required, "actual": actual})
    manifest_text = DEPENDENCY_MANIFEST.read_text(encoding="utf-8")
    in_venv = sys.prefix != sys.base_prefix
    workspace_local = in_venv and Path(sys.prefix).resolve() == (
        ROOT / ".integration-venv"
    ).resolve()
    return {
        "ok": workspace_local and not mismatches,
        "executable": sys.executable,
        "prefix": sys.prefix,
        "basePrefix": sys.base_prefix,
        "workspaceLocalVenv": workspace_local,
        "dependencyManifest": str(DEPENDENCY_MANIFEST),
        "dependencyManifestSha256": sha256_text(manifest_text),
        "expected": expected,
        "installed": installed,
        "mismatches": mismatches,
    }


def run_stage(name: str, command: list[str], env: dict[str, str]) -> dict[str, object]:
    started = time.monotonic()
    try:
        completed = subprocess.run(
            command,
            cwd=ROOT,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=180,
            check=False,
        )
        returncode = completed.returncode
        stdout = completed.stdout
        stderr = completed.stderr
        timed_out = False
    except subprocess.TimeoutExpired as exc:
        returncode = 124
        stdout = exc.stdout if isinstance(exc.stdout, str) else ""
        stderr = exc.stderr if isinstance(exc.stderr, str) else ""
        stderr += f"\n{name} exceeded the 180 second local smoke limit"
        timed_out = True

    duration_ms = round((time.monotonic() - started) * 1000)
    print(f"===== {name} (exit={returncode}, duration_ms={duration_ms}) =====")
    if stdout:
        print(stdout.rstrip())
    if stderr:
        print(stderr.rstrip(), file=sys.stderr)
    return {
        "name": name,
        "command": command,
        "status": "passed" if returncode == 0 else "failed",
        "exitCode": returncode,
        "durationMs": duration_ms,
        "timedOut": timed_out,
        "stdout": {
            "bytes": len(stdout.encode("utf-8")),
            "sha256": sha256_text(stdout),
            "text": stdout,
        },
        "stderr": {
            "bytes": len(stderr.encode("utf-8")),
            "sha256": sha256_text(stderr),
            "text": stderr,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--receipt", default=str(DEFAULT_RECEIPT))
    args = parser.parse_args()
    receipt_path = Path(args.receipt)
    if not receipt_path.is_absolute():
        receipt_path = ROOT / receipt_path
    started_at = datetime.now(timezone.utc)
    environment = python_environment()
    env = os.environ.copy()
    env.update(
        {
            "CORTEX_INTEGRATION_SMOKE": "1",
            "CORTEX_SAFE_MODE": "true",
            "CORTEX_EXTERNAL_WRITES": "false",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONPATH": str(ROOT / "public" / "cortex_server"),
        }
    )
    # Preserve the venv entry point. Resolving the symlink would bypass its
    # pyvenv.cfg and make child stages silently use the host interpreter.
    python_bin = sys.executable
    env["PATH"] = f"{Path(python_bin).parent}{os.pathsep}{env.get('PATH', '')}"
    env["CORTEX_PYTHON"] = python_bin

    stages = [
        (
            "routing-and-subagent-trust",
            ["node", "--test", "plugins/cortex-route-memory-repair.test.mjs"],
        ),
        (
            "memory-lifecycle",
            [python_bin, "scripts/smoke-cortex-memory-ops-repair.py"],
        ),
        (
            "health-and-parser",
            [
                python_bin,
                "-m",
                "pytest",
                "-q",
                "public/cortex_server/tests/test_health_parser_truth_repair.py",
            ],
        ),
        (
            "least-privilege-and-policy",
            ["node", "scripts/smoke-cortex-security-policy.mjs"],
        ),
        (
            "browser-reliability",
            [
                "node",
                "--test",
                "plugins/cortex-browser-bridge/browser-reliability.test.mjs",
            ],
        ),
        (
            "release-contract",
            [python_bin, "tests/release_contract_smoke.py"],
        ),
    ]

    results = [run_stage(name, command, env) for name, command in stages]
    passed = environment["ok"] is True and all(
        result["exitCode"] == 0 for result in results
    )
    completed_at = datetime.now(timezone.utc)
    receipt = {
        "schemaVersion": "cortex.repair-integration-smoke.v2",
        "status": "passed" if passed else "failed",
        "startedAt": started_at.isoformat(),
        "completedAt": completed_at.isoformat(),
        "durationMs": round((completed_at - started_at).total_seconds() * 1000),
        "workspaceRoot": str(ROOT),
        "receiptPath": str(receipt_path),
        "safeMode": True,
        "externalWrites": False,
        "deploymentPerformed": False,
        "pythonEnvironment": environment,
        "stages": results,
        "scope": [
            "routing/subagent trust",
            "memory lifecycle",
            "health/parser",
            "least privilege/policy",
            "browser status/search/exact-page/retry/fallback/egress",
            "release contract",
        ],
        "truthBoundary": (
            "This receipt covers one source-side focused integration smoke only. "
            "It is not deployment, live-service, full-suite, or promotion evidence."
        ),
    }
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_receipt = receipt_path.with_name(f".{receipt_path.name}.tmp")
    temporary_receipt.write_text(
        f"{json.dumps(receipt, indent=2, sort_keys=True)}\n", encoding="utf-8"
    )
    os.chmod(temporary_receipt, 0o600)
    temporary_receipt.replace(receipt_path)
    print("===== integration receipt =====")
    print(json.dumps(receipt, indent=2, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
