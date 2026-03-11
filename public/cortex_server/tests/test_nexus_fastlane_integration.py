from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.routers.nexus import _is_simple_qa, _detect_risk_flags


def test_simple_qa_gate():
    assert _is_simple_qa("What is the capital of Texas?") is True
    assert _is_simple_qa("Design a multi-step plan for enterprise architecture migration with risk matrix") is False


def test_risk_flags():
    flags = _detect_risk_flags("Give legal advice about contract breach")
    assert "legal" in flags


def test_cognitive_wave_slice_present(monkeypatch):
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app)
    r = client.get("/nexus/orchestrate", params={"query": "What is 2+2?"})
    assert r.status_code == 200
    body = r.json()
    assert "cognitive_wave" in body
    assert body["cognitive_wave"]["deliverable"].startswith("gate-c-slice-")
    assert body["cognitive_wave"]["stage"] in {"shadow", "canary", "active"}
