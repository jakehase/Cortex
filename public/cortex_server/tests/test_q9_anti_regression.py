from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import stat
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.routers import system as system_router


class _Storage:
    def quota_status(self):
        return {
            "status": "green",
            "ledgerComplete": True,
            "sourceRows": 10,
            "global": {"rows": 10, "rowHeadroom": 1_899_990, "rowUsagePercent": 0.001},
            "legacyUnscoped": {"rows": 8, "classification": "global_only"},
            "topPrincipalScopes": [{"rows": 2, "rowHeadroom": 99_998}],
        }


class _Graph:
    storage = _Storage()


class _ProviderResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _maximum):
        return json.dumps({"models": [{"name": "tinyllama:latest"}]}).encode()


def _write_receipt(path: Path, *, age_seconds: int = 0):
    when = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=age_seconds)
    path.write_text(
        json.dumps(
            {
                "schemaVersion": "test.receipt.v1",
                "outcome": "green",
                "releaseId": "cortex-q9-test",
                "verifiedAt": when.isoformat().replace("+00:00", "Z"),
            }
        )
        + "\n",
        encoding="utf-8",
    )


def _release(root: Path, envelope: Path):
    target = root / "app.txt"
    target.write_text("q9\n", encoding="utf-8")
    os.chmod(target, 0o644)
    payload = {
        "schemaVersion": "cortex.release-envelope.v1",
        "releaseId": "q9-test",
        "sourceCommit": "a" * 40,
        "sourceTree": "b" * 40,
        "parentCommit": "c" * 40,
        "fileCount": 1,
        "files": [
            {
                "path": "app.txt",
                "mode": 0o644,
                "bytes": target.stat().st_size,
                "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            }
        ],
        "runtimeSurfaceContract": None,
        "mutableStatePolicy": {
            "releaseSourceReadOnly": True,
            "allowedRoots": ["/var/lib/cortex"],
            "sourceTreeWritesAllowed": False,
        },
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    payload["envelopeSha256"] = system_router._canonical_digest(payload)
    envelope.write_text(json.dumps(payload) + "\n", encoding="utf-8")


def _client(tmp_path, monkeypatch, *, evidence_age=0):
    root = tmp_path / "release"
    root.mkdir()
    envelope = tmp_path / "envelope.json"
    _release(root, envelope)
    receipts = {}
    for name in ("aios", "canary", "rollback", "remote"):
        path = tmp_path / f"{name}.json"
        _write_receipt(path, age_seconds=evidence_age if name == "aios" else 0)
        receipts[name] = path
    monkeypatch.setenv("CORTEX_ADMIN_TOKEN", "admin-token-for-q9-tests-0000000000")
    monkeypatch.setenv("CORTEX_RELEASE_ROOT", str(root))
    monkeypatch.setenv("CORTEX_RELEASE_ID", "cortex-q9-test")
    monkeypatch.setenv("CORTEX_RELEASE_ENVELOPE_PATH", str(envelope))
    monkeypatch.setenv("CORTEX_AIOS_ATTESTATION_PATH", str(receipts["aios"]))
    monkeypatch.setenv("CORTEX_CANARY_RECEIPT_PATH", str(receipts["canary"]))
    monkeypatch.setenv("CORTEX_ROLLBACK_RECEIPT_PATH", str(receipts["rollback"]))
    monkeypatch.setenv("CORTEX_REMOTE_PERSISTENCE_RECEIPT_PATH", str(receipts["remote"]))
    monkeypatch.setenv("CORTEX_SAFE_MODE", "true")
    monkeypatch.setenv("CORTEX_MEMORY_SCOPE_STRICT", "true")
    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "token_required")
    monkeypatch.setenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", json.dumps({"credential": {}}))
    monkeypatch.setenv("ORACLE_OLLAMA_ENABLED", "true")
    monkeypatch.setenv("ORACLE_OLLAMA_URL", "http://127.0.0.1:11434")
    monkeypatch.setattr(system_router.knowledge_service, "_graph", _Graph())
    monkeypatch.setattr(system_router.urllib.request, "urlopen", lambda *_a, **_k: _ProviderResponse())
    system_router._RELEASE_CACHE.clear()
    app = FastAPI()
    app.state.router_load_report = {"failed": [], "safeModeSkipped": ["browser", "tools"]}
    app.include_router(system_router.router, prefix="/system")
    return TestClient(app)


def test_system_attestation_requires_administrator(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    assert client.get("/system/attestation").status_code == 403


def test_system_attestation_separates_functional_and_evidence_truth(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    response = client.get(
        "/system/attestation",
        headers={"x-cortex-admin-token": "admin-token-for-q9-tests-0000000000"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "green"
    assert payload["functionalStatus"] == "green"
    assert payload["attestationStatus"] == "green"
    assert payload["evidenceAgeStatus"] == "current"
    assert payload["layers"]["capacity"]["legacyUnscoped"]["classification"] == "global_only"
    assert payload["layers"]["sourceIntegrity"]["mismatchCount"] == 0
    assert payload["layers"]["security"]["secretValuesExposed"] is False


def test_expired_evidence_does_not_masquerade_as_runtime_outage(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch, evidence_age=901)
    payload = client.get(
        "/system/attestation",
        headers={"x-cortex-admin-token": "admin-token-for-q9-tests-0000000000"},
    ).json()
    assert payload["status"] == "green"
    assert payload["functionalStatus"] == "green"
    assert payload["attestationStatus"] == "green"
    assert payload["evidenceAgeStatus"] == "aged"
    assert payload["layers"]["evidenceFreshness"]["status"] == "green"
    assert payload["layers"]["evidenceFreshness"]["freshnessStatus"] == "aged"
    assert payload["layers"]["evidenceFreshness"]["lastVerifiedAt"] is not None
    assert payload["layers"]["evidenceFreshness"]["stale"] is True
    assert payload["layers"]["capacity"]["status"] == "green"
