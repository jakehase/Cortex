from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware


def _client(monkeypatch):
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    monkeypatch.setattr(nexus.ROUTE_HEALTH, "snapshot", lambda dependency=None: {"version": "route_health.v1", "dependencies": {}} if dependency is None else {"state": "closed", "healthy": True, "successes": 0, "failures": 0})
    monkeypatch.setattr(nexus.ROUTE_HEALTH, "record_success", lambda *a, **k: {"state": "closed", "healthy": True})
    monkeypatch.setattr(nexus.ROUTE_HEALTH, "record_failure", lambda *a, **k: {"state": "open", "healthy": False})
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    return TestClient(app)


def test_orchestrate_returns_assurance_contract(monkeypatch):
    client = _client(monkeypatch)
    r = client.post("/nexus/orchestrate", json={}, params={"query": "What is 2+2?"})
    assert r.status_code == 200
    body = r.json()
    assert "assurance" in body
    assert body["assurance"]["version"] == "nexus.assurance.v1"
    assert body["assurance"]["summary"]["routing_method"] == body["routing_method"]
    assert body["contract"]["assurance_version"] == "nexus.assurance.v1"
    assert body["contract"]["assurance_verdict"] == body["assurance"]["verdict"]


def test_assurance_surfaces_missing_constraints(monkeypatch):
    client = _client(monkeypatch)
    q = "How do I install this under budget 100 with at least 3 steps?"
    r = client.post("/nexus/orchestrate", json={}, params={"query": q})
    assert r.status_code == 200
    body = r.json()
    assert "missing_constraints" in body["assurance"]["reason_codes"]
    assert body["assurance"]["release_decision"] in {"downgrade", "repair", "block"}
