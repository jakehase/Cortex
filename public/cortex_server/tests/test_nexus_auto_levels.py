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


def _has_level(body, level):
    return any(int(x.get("level", -1)) == int(level) for x in body.get("recommended_levels", []))


def test_translation_auto_activation(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "Translate this release note to Spanish"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_markers"]["translation_triggered"] is True
    assert _has_level(body, 28)


def test_schedule_auto_activation(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "Remind me tomorrow at 9am to send the weekly report"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_markers"]["schedule_triggered"] is True
    assert _has_level(body, 14)


def test_mediation_auto_activation(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "Help mediate a conflict between product and engineering"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_markers"]["mediation_triggered"] is True
    assert _has_level(body, 31)


def test_forecast_auto_activation(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "Forecast demand for next quarter based on current trend"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_markers"]["forecast_triggered"] is True
    assert _has_level(body, 30)


def test_training_auto_activation(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "Create a training plan and learning path to onboard new backend engineers"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_markers"]["training_triggered"] is True
    assert _has_level(body, 16)


def test_ethics_auto_activation(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "Assess ethical and compliance risks for this AI rollout"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_markers"]["ethics_triggered"] is True
    assert _has_level(body, 33)


def test_rollback_planning_not_forced_incident(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "Need architecture blueprint with rollback plan for API boundary changes"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_markers"]["incident_triggered"] is False
    assert body["routing_method"] == "l9_chain_forced"
