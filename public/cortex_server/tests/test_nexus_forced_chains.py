from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware


def _client(monkeypatch):
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    return TestClient(app)


def test_coding_chain_forced(monkeypatch):
    monkeypatch.setattr(nexus, "_architect_healthy", lambda: True)
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "Implement bug fix and add unit tests for this API"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] == "coding_chain_forced"
    assert body["routing_markers"]["coding_triggered"] is True
    assert body["routing_markers"]["coding_chain"] == ["lab", "architect", "validator", "forge", "council"]


def test_incident_chain_forced(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "SEV1 incident: service down, rollback now"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] == "incident_chain_forced"
    assert body["routing_markers"]["incident_triggered"] is True
    assert body["routing_markers"]["incident_chain"] == ["sentinel", "seer", "council", "diplomat", "chronos"]


def test_research_chain_forced(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "Research this topic with sources and evidence"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] == "research_chain_forced"
    assert body["routing_markers"]["research_triggered"] is True
    assert body["routing_markers"]["research_chain"] == ["ghost", "librarian", "mnemosyne", "oracle", "validator"]


def test_architecture_chain_forced(monkeypatch):
    monkeypatch.setattr(nexus, "_architect_healthy", lambda: True)
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "Draft a system design blueprint for multi-tenant API boundaries"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] == "l9_chain_forced"
    assert body["routing_markers"]["l9_triggered"] is True
    assert body["routing_markers"]["l9_chain"] == ["architect", "council", "synthesist", "validator"]


def test_complexity_auto_activates_l9(monkeypatch):
    monkeypatch.setattr(nexus, "_architect_healthy", lambda: True)
    client = _client(monkeypatch)
    q = "Optimize a multi-step strategy under budget with 5 constraints and tradeoff analysis versus baseline"
    r = client.get("/nexus/orchestrate", params={"query": q})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] == "semantic_orchestration"
    assert body["routing_markers"]["l9_triggered"] is True
    assert body["routing_markers"]["l9_chain"] == ["architect"]
    assert any(int(x.get("level", -1)) == 9 for x in body.get("recommended_levels", []))
