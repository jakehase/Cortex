from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware


def _client(monkeypatch):
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    monkeypatch.setattr(nexus, "_architect_healthy", lambda: True)
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    return TestClient(app)


def test_autotune_status_exposed(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/autotune/status")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert "policy" in body
    assert "complexity_hard_threshold" in body["policy"]
    assert "l9_auto_activation_threshold" in body["policy"]


def test_orchestrate_returns_autotune_policy(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "Implement bug fix and add unit tests for the API"})
    assert r.status_code == 200
    body = r.json()
    assert "autotune_policy" in body
    assert body["routing_markers"]["l9_triggered"] is True


def test_complexity_query_auto_l9(monkeypatch):
    client = _client(monkeypatch)
    q = "Optimize a multi-step strategy under budget with 5 constraints and tradeoff analysis versus baseline"
    r = client.get("/nexus/orchestrate", params={"query": q})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_markers"]["l9_triggered"] is True
    assert any(int(x.get("level", -1)) == 9 for x in body.get("recommended_levels", []))
