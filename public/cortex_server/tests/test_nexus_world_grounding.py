from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware


def _client(monkeypatch):
    monkeypatch.setattr(
        nexus,
        "analyze_intent_with_oracle",
        lambda q: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"},
    )
    monkeypatch.setattr(nexus, "_architect_healthy", lambda: True)
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    return TestClient(app)


def test_world_grounding_forces_live_path(monkeypatch):
    monkeypatch.setattr(
        nexus,
        "gather_live_evidence",
        lambda query, **kwargs: {
            "required": True,
            "engaged": True,
            "mode": "live_grounded",
            "evidence_count": 2,
            "degraded": False,
            "evidence": [
                {"title": "A", "url": "https://example.com/a", "domain": "example.com"},
                {"title": "B", "url": "https://example.com/b", "domain": "example.com"},
            ],
        },
    )
    client = _client(monkeypatch)

    r = client.get("/nexus/orchestrate", params={"query": "What is the latest bitcoin price right now?"})
    assert r.status_code == 200
    body = r.json()
    assert body["world_grounding"]["required"] is True
    assert body["routing_markers"]["world_grounding_required"] is True
    assert body["routing_markers"]["world_grounding_mode"] == "live_grounded"

    levels = {int(x.get("level", -1)) for x in body.get("recommended_levels", [])}
    assert 2 in levels
    assert 34 in levels


def test_world_grounding_not_required(monkeypatch):
    monkeypatch.setattr(
        nexus,
        "gather_live_evidence",
        lambda query, **kwargs: {
            "required": False,
            "engaged": False,
            "mode": "not_required",
            "evidence_count": 0,
            "degraded": False,
            "evidence": [],
        },
    )
    client = _client(monkeypatch)

    r = client.get("/nexus/orchestrate", params={"query": "Explain TCP in one paragraph"})
    assert r.status_code == 200
    body = r.json()
    assert body["world_grounding"]["required"] is False
    assert body["routing_markers"]["world_grounding_required"] is False
