from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware


def _client(monkeypatch):
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    app = FastAPI()
    app.add_middleware(HUDMiddleware)

    @app.get("/")
    async def root():
        return {"ok": True}

    @app.get("/health")
    async def health():
        return {"status": "healthy"}

    app.include_router(nexus.router, prefix="/nexus")
    return TestClient(app)


def test_brainstorm_trigger_forces_chain(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "Brainstorm: product launch ideas"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] == "brainstorm_chain_forced"
    assert body["routing_markers"]["brainstorm_triggered"] is True
    assert body["routing_markers"]["brainstorm_chain"] == ["dreamer", "muse", "synthesist"]


def test_orchestrated_response_has_contract_and_routing_method(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "What is 2+2?"})
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body.get("routing_method"), str) and body["routing_method"]
    assert "contract" in body
    assert body["contract"]["activation_metadata_available"] is True
    assert body["contract"]["identity_phrase"]


def test_404_has_no_hud_attribution(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/does_not_exist")
    assert r.status_code == 404
    body = r.json()
    assert "hud" not in body
    assert "activated_levels" not in body


def test_contract_metadata_present_on_success_json_routes(monkeypatch):
    client = _client(monkeypatch)
    for path in ["/", "/health", "/nexus/context", "/nexus/full"]:
        r = client.get(path)
        assert r.status_code == 200
        body = r.json()
        assert "contract" in body
        assert body["contract"]["activation_metadata_available"] is True
        assert body["contract"]["identity_phrase"]
