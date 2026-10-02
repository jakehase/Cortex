from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.routers.nexus as nexus
from cortex_server.routers import contract, guard
from cortex_server.middleware.hud_middleware import HUDMiddleware


def _client(monkeypatch, *, headers=None):
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q, **_kwargs: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    app = FastAPI()
    app.add_middleware(HUDMiddleware)

    @app.get("/")
    async def root():
        return {"ok": True}

    @app.get("/health")
    async def health():
        return {"status": "healthy"}

    app.include_router(nexus.router, prefix="/nexus")
    return TestClient(app, headers=headers)


def test_brainstorm_trigger_forces_chain(monkeypatch, configured_memory_principal):
    client = _client(
        monkeypatch,
        headers=configured_memory_principal().headers,
    )
    r = client.post("/nexus/orchestrate", json={}, params={"query": "Brainstorm: product launch ideas"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] == "brainstorm_chain_forced"
    assert body["routing_markers"]["brainstorm_triggered"] is True
    assert body["routing_markers"]["brainstorm_chain"] == ["dreamer", "muse", "synthesist"]


def test_orchestrated_response_has_contract_and_routing_method(
    monkeypatch,
    configured_memory_principal,
):
    client = _client(
        monkeypatch,
        headers=configured_memory_principal().headers,
    )
    r = client.post("/nexus/orchestrate", json={}, params={"query": "What is 2+2?"})
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body.get("routing_method"), str) and body["routing_method"]
    assert "contract" in body
    assert body["contract"]["activation_metadata_available"] is False
    assert body["contract"]["activation_metadata_source"] == "selection_only"
    assert body["activation_receipt"]["complete"] is False
    assert body["contract"]["identity_phrase"]
    assert "assurance" in body
    assert body["contract"]["assurance_version"] == body["assurance"]["version"]


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


def test_contract_self_test_default_is_lightweight_and_guard_uses_it():
    app = FastAPI()
    app.include_router(contract.router, prefix="/contract")
    app.include_router(guard.router, prefix="/guard")
    client = TestClient(app)

    r = client.get("/contract/self-test")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "lightweight"
    assert body["success"] is True
    assert body["checks"]["nexus_orchestrate_route_registered"]["pass"] is True

    guard_r = client.get("/guard/status")
    assert guard_r.status_code == 200
    guard_body = guard_r.json()
    assert guard_body["guard_active"] is True
    assert guard_body["all_passed"] is True
