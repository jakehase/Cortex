from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware


def _client(monkeypatch, *, headers=None):
    monkeypatch.setattr(
        nexus,
        "analyze_intent_with_oracle",
        lambda q, **_kwargs: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"},
    )
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    return TestClient(app, headers=headers)


def test_natural_brainstorm_prompt_forces_chain(
    monkeypatch,
    configured_memory_principal,
):
    client = _client(
        monkeypatch,
        headers=configured_memory_principal().headers,
    )
    r = client.post("/nexus/orchestrate", json={}, params={"query": "Give me creative ideas for launching this product"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] == "brainstorm_chain_forced"
    assert body["routing_markers"]["brainstorm_triggered"] is True
