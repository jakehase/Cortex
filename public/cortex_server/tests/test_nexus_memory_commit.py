from fastapi import FastAPI
from fastapi.testclient import TestClient
import sys
import types

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware


class _Recorder:
    def __init__(self):
        self.calls = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return {"id": "mem-123", "status": "stored", "metadata": kwargs.get("metadata", {})}


def _client(monkeypatch, recorder):
    fake_l22 = types.ModuleType("cortex_server.routers.l22")
    fake_l22.store_memory_record = recorder
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", fake_l22)
    monkeypatch.setattr(nexus.ROUTE_HEALTH, "snapshot", lambda dependency=None: {"state": "closed", "healthy": True, "successes": 1, "failures": 0})
    monkeypatch.setattr(nexus.ROUTE_HEALTH, "record_success", lambda *a, **k: {"state": "closed", "healthy": True})
    monkeypatch.setattr(nexus.ROUTE_HEALTH, "record_failure", lambda *a, **k: {"state": "open", "healthy": False})
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    return TestClient(app)


def test_commit_writes_to_l22_when_assurance_allows(monkeypatch):
    recorder = _Recorder()
    client = _client(monkeypatch, recorder)
    r = client.post(
        "/nexus/commit",
        json={
            "query": "Remember this deployment decision",
            "response": "Use the safe rollback path and preserve the backup branch.",
            "levels_used": [7, 22],
            "metadata": {"validator_result": {"pass": True, "checks": {}}, "risk_flags": []},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["committed"] is True
    assert body["durable_write"]["status"] == "stored"
    assert body["assurance"]["memory_commit"]["eligible"] is True
    assert len(recorder.calls) == 1


def test_commit_skips_when_assurance_blocks(monkeypatch):
    recorder = _Recorder()
    client = _client(monkeypatch, recorder)
    r = client.post(
        "/nexus/commit",
        json={
            "query": "Remember this",
            "response": "Guaranteed zero-risk legal strategy.",
            "levels_used": [7, 22],
            "metadata": {
                "validator_result": {"pass": False, "checks": {"overclaim_detected": True}},
                "risk_flags": ["legal"],
            },
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is False
    assert body["committed"] is False
    assert body["durable_write"]["status"] == "skipped"
    assert body["assurance"]["memory_commit"]["eligible"] is False
    assert len(recorder.calls) == 0
