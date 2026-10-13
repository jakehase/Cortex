from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from types import SimpleNamespace
from pathlib import Path


SOURCE_ROOT = Path(__file__).resolve().parents[3]
BUILD = SOURCE_ROOT / "scripts/build-release-envelope.py"
VERIFY = SOURCE_ROOT / "scripts/verify-release-envelope.py"
DEPLOY = SOURCE_ROOT / "scripts/deploy-q9-release.py"
DEPLOY_SPEC = importlib.util.spec_from_file_location("deploy_q9_release", DEPLOY)
assert DEPLOY_SPEC and DEPLOY_SPEC.loader
deploy_q9 = importlib.util.module_from_spec(DEPLOY_SPEC)
DEPLOY_SPEC.loader.exec_module(deploy_q9)

CANARY = SOURCE_ROOT / "scripts/run-q9-canary.py"
CANARY_SPEC = importlib.util.spec_from_file_location("run_q9_canary", CANARY)
assert CANARY_SPEC and CANARY_SPEC.loader
run_q9_canary = importlib.util.module_from_spec(CANARY_SPEC)
CANARY_SPEC.loader.exec_module(run_q9_canary)


def _run(*args, cwd=None):
    return subprocess.run(args, cwd=cwd, text=True, capture_output=True, check=False)


def test_release_envelope_binds_exact_files_modes_and_absence_of_extras(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "q9-test"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "q9-test@example.invalid"], cwd=repo, check=True)
    (repo / "app.txt").write_text("q9\n", encoding="utf-8")
    os.chmod(repo / "app.txt", 0o644)
    script = repo / "run.sh"
    script.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    os.chmod(script, 0o755)
    subprocess.run(["git", "add", "app.txt", "run.sh"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=repo, check=True)
    (repo / "second.txt").write_text("second\n", encoding="utf-8")
    os.chmod(repo / "second.txt", 0o644)
    (repo / "generated" / "artifacts").mkdir(parents=True)
    (repo / "generated" / "artifacts" / "receipt.json").write_text("{}\n", encoding="utf-8")
    os.chmod(repo / "generated" / "artifacts" / "receipt.json", 0o644)
    (repo / "legacy" / "_quarantine").mkdir(parents=True)
    (repo / "legacy" / "_quarantine" / "README.md").write_text("inert\n", encoding="utf-8")
    os.chmod(repo / "legacy" / "_quarantine" / "README.md", 0o644)
    surface = repo / "ops" / "release" / "runtime-surfaces.json"
    surface.parent.mkdir(parents=True)
    surface.write_text(
        json.dumps(
            {
                "schemaVersion": "cortex.runtime-surface-contract.v2",
                "sourceClassification": {
                    "matchPolicy": "first_match",
                    "trackedCategories": [
                        {"name": "quarantined", "pathComponents": ["_quarantine"]},
                        {"name": "generated", "pathComponents": ["artifacts"]},
                        {"name": "product", "default": True},
                    ],
                    "privateRuntime": {
                        "trackedFilesAllowed": False,
                        "absoluteRoots": ["/var/lib/cortex"],
                    },
                },
                "qualification": {
                    "requiredReceiptKinds": ["full-suite", "focused-gates"],
                    "focusedSurfaceIds": ["BROWSER-1", "OPS-2"],
                },
            }
        )
        + "\n",
        encoding="utf-8",
    )
    os.chmod(surface, 0o644)
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "release"], cwd=repo, check=True)
    source_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    source_tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=repo, text=True).strip()

    receipt_paths = {}
    for kind, surfaces in (("full-suite", []), ("focused-gates", ["BROWSER-1", "OPS-2"])):
        receipt = tmp_path / f"{kind}.json"
        receipt.write_text(
            json.dumps(
                {
                    "schemaVersion": "cortex.qualification-receipt.v1",
                    "kind": kind,
                    "outcome": "green",
                    "sourceCommit": source_commit,
                    "sourceTree": source_tree,
                    "exitCode": 0,
                    "startedAt": "2026-10-12T00:00:00Z",
                    "completedAt": "2026-10-12T00:01:00Z",
                    "replayCommand": ["python", "-m", "pytest", "-q"],
                    "surfaceIds": surfaces,
                    "artifacts": [{"path": f"logs/{kind}.log", "sha256": "a" * 64}],
                }
            )
            + "\n",
            encoding="utf-8",
        )
        receipt_paths[kind] = receipt

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
        "--surface-contract",
        str(surface),
        "--qualification-receipt",
        f"full-suite={receipt_paths['full-suite']}",
        "--qualification-receipt",
        f"focused-gates={receipt_paths['focused-gates']}",
        "--require-clean",
    )
    assert built.returncode == 0, built.stderr
    payload = json.loads(envelope.read_text(encoding="utf-8"))
    assert payload["schemaVersion"] == "cortex.release-envelope.v2"
    assert payload["sourceIdentity"]["clean"] is True
    assert payload["fileCount"] == 6
    assert {row["mode"] for row in payload["files"]} == {0o644, 0o755}
    assert payload["sourceClassification"]["trackedCounts"] == {
        "generated": 1,
        "product": 4,
        "quarantined": 1,
    }
    assert {row["kind"] for row in payload["qualificationReceipts"]} == {"full-suite", "focused-gates"}

    release = tmp_path / "release"
    shutil.copytree(repo, release, ignore=shutil.ignore_patterns(".git"))
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

    (repo / "dirty.txt").write_text("untracked\n", encoding="utf-8")
    dirty = _run(
        sys.executable,
        str(BUILD),
        "--root",
        str(repo),
        "--output",
        str(tmp_path / "dirty-envelope.json"),
        "--release-id",
        "q9-dirty",
        "--surface-contract",
        str(surface),
        "--qualification-receipt",
        f"full-suite={receipt_paths['full-suite']}",
        "--qualification-receipt",
        f"focused-gates={receipt_paths['focused-gates']}",
    )
    assert dirty.returncode != 0
    assert "not clean" in dirty.stderr


def test_q9_runtime_surface_contract_has_no_live_secret_values():
    contract = json.loads((SOURCE_ROOT / "ops/release/runtime-surfaces.json").read_text())
    schema = json.loads((SOURCE_ROOT / "ops/config/cortex-env.schema.json").read_text())
    assert contract["schemaVersion"] == "cortex.runtime-surface-contract.v2"
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
    assert contract["sourceClassification"]["privateRuntime"]["trackedFilesAllowed"] is False
    assert contract["qualification"]["requiredReceiptKinds"] == ["full-suite", "focused-gates"]
    assert {
        "ROUTE-1", "MEM-1", "MEM-2", "MEM-3", "SEC-1", "POLICY-1",
        "HEALTH-1", "PARSER-1", "BROWSER-1", "OPS-1", "OPS-2", "AIOS-1",
    } <= set(contract["qualification"]["focusedSurfaceIds"])
    assert {
        "cortex-oracle-executor.service",
        "cortex-owner-memory-index.service",
        "cortex-owner-memory-index.timer",
    } <= set(deploy_q9.LIVE_UNITS)
    assert {
        "cortex-oracle-executor.service",
        "cortex-owner-memory-index.service",
        "cortex-owner-memory-index.timer",
        "cortex-health-watchdog.service",
    } <= set(deploy_q9.MANAGED_STOP_ORDER)
    encoded = json.dumps({"contract": contract, "schema": schema})
    assert "37.27.129.239" not in encoded
    assert "10.0.0." not in encoded


def test_cortex_service_proc_hardening_preserves_onnx_cpu_discovery():
    unit = (SOURCE_ROOT / "ops/systemd/cortex.service").read_text(encoding="utf-8")
    assert "ProtectProc=invisible" in unit
    assert "ProcSubset=all" in unit
    assert "ProcSubset=pid" not in unit


def test_cortex_service_owns_nexus_state_outside_legacy_clawdbot_root():
    unit = (SOURCE_ROOT / "ops/systemd/cortex.service").read_text(encoding="utf-8")
    nexus = (
        SOURCE_ROOT
        / "public/cortex_server/cortex_server/routers/nexus.py"
    ).read_text(encoding="utf-8")

    assert "Environment=CORTEX_STATE_DIR=/var/lib/cortex/state" in unit
    assert "StateDirectory=cortex" in unit
    assert "ReadWritePaths=/var/lib/cortex /var/log/cortex /run/cortex" in unit
    assert 'construction_config("CORTEX_STATE_DIR", "/opt/clawdbot/state")' in nexus
    assert 'Path(_nexus_state_default("nexus_principals"))' in nexus


def test_gateway_restart_reloads_user_systemd_after_validation_before_restart(monkeypatch):
    calls: list[list[str]] = []

    def fake_run(command, **_kwargs):
        calls.append(command)

    monkeypatch.setattr(deploy_q9, "run", fake_run)
    monkeypatch.setattr(
        deploy_q9.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=0,
            stdout="Connectivity probe: ok\n",
            stderr="",
        ),
    )

    deploy_q9.restart_gateway()

    assert calls == [
        ["/usr/bin/openclaw", "config", "validate"],
        ["systemctl", "--user", "daemon-reload"],
        ["/usr/bin/openclaw", "gateway", "restart"],
    ]

    calls.clear()

    def fail_daemon_reload(command, **_kwargs):
        calls.append(command)
        if command == ["systemctl", "--user", "daemon-reload"]:
            raise RuntimeError("daemon reload failed")

    monkeypatch.setattr(deploy_q9, "run", fail_daemon_reload)

    try:
        deploy_q9.restart_gateway()
    except RuntimeError as exc:
        assert str(exc) == "daemon reload failed"
    else:
        raise AssertionError("daemon-reload failure must abort gateway restart")

    assert calls == [
        ["/usr/bin/openclaw", "config", "validate"],
        ["systemctl", "--user", "daemon-reload"],
    ]


def test_release_supervisor_derives_a_terminal_blocker_from_matrix_and_missing_receipts(tmp_path, monkeypatch):
    source = tmp_path / "source"
    matrix_path = source / "cortex-repair-20261011" / "surface-matrix.json"
    matrix_path.parent.mkdir(parents=True)
    matrix = {
        "schemaVersion": "cortex.repair-surface-matrix.v1",
        "stopCondition": "supervisor_green_or_blocker_report",
        "surfaces": [
            {"id": "PROV-1", "severity": "high", "acceptance": "immutable deployment"},
            {"id": "PROV-2", "severity": "high", "acceptance": "rollback and accepted ref"},
            {"id": "QUAL-1", "severity": "high", "acceptance": "exact candidate qualification"},
            {"id": "BROWSER-1", "severity": "medium", "acceptance": "browser receipt"},
            {"id": "OPS-2", "severity": "low", "acceptance": "operations receipt"},
        ],
    }
    matrix_path.write_text(json.dumps(matrix) + "\n", encoding="utf-8")
    source_commit = "a" * 40
    source_tree = "b" * 40
    focused_payload = {
        "schemaVersion": "cortex.qualification-receipt.v1",
        "kind": "focused-gates",
        "outcome": "green",
        "sourceCommit": source_commit,
        "sourceTree": source_tree,
        "exitCode": 0,
        "startedAt": "2026-10-12T00:00:00Z",
        "completedAt": "2026-10-12T00:01:00Z",
        "replayCommand": ["python3", "tests/release_contract_smoke.py"],
        "artifacts": [{"path": "logs/focused-gates.log", "sha256": "f" * 64}],
        "surfaceIds": ["BROWSER-1", "OPS-2"],
    }
    full_payload = {
        **focused_payload,
        "kind": "full-suite",
        "surfaceIds": [],
        "artifacts": [{"path": "logs/full-suite.log", "sha256": "a" * 64}],
    }
    envelope = {
        "schemaVersion": "cortex.release-envelope.v2",
        "releaseId": "q9-supervisor-test",
        "sourceCommit": source_commit,
        "sourceTree": source_tree,
        "sourceIdentity": {
            "clean": True,
            "indexTree": source_tree,
        },
        "files": [
            {
                "path": "cortex-repair-20261011/surface-matrix.json",
                "sha256": hashlib.sha256(matrix_path.read_bytes()).hexdigest(),
            }
        ],
        "qualificationReceipts": [
            {
                "kind": "full-suite",
                "receiptSha256": "d" * 64,
                "payloadSha256": hashlib.sha256(
                    json.dumps(full_payload, sort_keys=True, separators=(",", ":")).encode()
                ).hexdigest(),
                "payload": full_payload,
            },
            {
                "kind": "focused-gates",
                "receiptSha256": "e" * 64,
                "payloadSha256": hashlib.sha256(
                    json.dumps(focused_payload, sort_keys=True, separators=(",", ":")).encode()
                ).hexdigest(),
                "payload": focused_payload,
            },
        ],
    }
    envelope["envelopeSha256"] = deploy_q9.canonical_digest(envelope)
    envelope_path = tmp_path / "envelope.json"
    envelope_path.write_text(json.dumps(envelope) + "\n", encoding="utf-8")
    artifacts = tmp_path / "artifacts"
    contract = {
        "artifactRoot": str(artifacts),
        "releaseId": "q9-supervisor-test",
        "sourceCommit": source_commit,
        "sourceTree": source_tree,
        "envelope": str(envelope_path),
        "releaseSourceRoot": str(source),
        "surfaceMatrix": str(matrix_path),
        "surfaceEvidence": [],
        "supervisorRunId": "supervisor-test",
    }
    monkeypatch.setattr(
        deploy_q9,
        "resolve_remote_accepted_ref",
        lambda _contract: (_ for _ in ()).throw(RuntimeError("accepted ref missing")),
    )
    assert deploy_q9.supervise(contract, artifacts) is False
    terminal = json.loads((artifacts / "state.json").read_text(encoding="utf-8"))
    report = json.loads((artifacts / "supervisor-report.json").read_text(encoding="utf-8"))
    assert terminal["schemaVersion"] == "cortex.detached-job-terminal.v2"
    assert terminal["producer"] == "cortex.release-supervisor.v1"
    assert terminal["status"] == "blocked"
    assert terminal["verificationPassed"] is False
    assert terminal["artifactManifest"]["sha256"] == hashlib.sha256(
        (artifacts / "supervisor-report.json").read_bytes()
    ).hexdigest()
    assert {row["id"] for row in report["surfaces"]} == {
        "PROV-1", "PROV-2", "QUAL-1", "BROWSER-1", "OPS-2"
    }
    assert next(row for row in report["surfaces"] if row["id"] == "BROWSER-1")["outcome"] == "green"
    assert next(row for row in report["surfaces"] if row["id"] == "PROV-1")["outcome"] == "red"
    assert report["checks"]["releaseEnvelopeIntegrity"]["outcome"] == "green"


def test_q9_canary_accepts_only_safe_public_browser_status_contract():
    payload = {
        "success": True,
        "available": True,
        "level": 2,
        "name": "Ghost (Browser)",
        "status": "active",
        "mode": "read_only_safe_mode",
        "capabilities": ["web_search", "web_browse"],
        "restricted_capabilities": ["screenshot"],
        "unmounted_capabilities": ["screenshot"],
        "mounted_routes": ["/browser/search", "/browser/browse", "/browser/status"],
        "egress": {
            "mode": "public_read",
            "allowed_hosts_count": 0,
            "public_read_enabled": True,
        },
        "honesty": "Capabilities reflect mounted routes and policy.",
        "engine": "pinned_http_broker",
    }

    assert run_q9_canary.browser_status_is_public_redacted(payload) is True

    leaked = dict(payload)
    leaked["egress"] = {**payload["egress"], "allowed_hosts": ["internal.example"]}
    assert run_q9_canary.browser_status_is_public_redacted(leaked) is False

    secret = dict(payload)
    secret["debug"] = {"token": "must-not-leak"}
    assert run_q9_canary.browser_status_is_public_redacted(secret) is False

    missing_route = dict(payload)
    missing_route["mounted_routes"] = ["/browser/search", "/browser/browse"]
    assert run_q9_canary.browser_status_is_public_redacted(missing_route) is False
