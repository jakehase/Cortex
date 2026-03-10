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
    assert body["cognitive_wave"]["deliverable"] == "gate-c-slice-2-executable"
    assert body["cognitive_wave"]["stage"] in {"shadow", "canary", "active"}
    assert "active_inference" in body["cognitive_wave"]
    assert "quality_gates" in body["cognitive_wave"]


def test_fastlane_kill_switch_disables_fastlane(monkeypatch):
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    monkeypatch.setattr(nexus, "_load_fastlane_config", lambda: {
        "enabled": True,
        "kill_switch": True,
        "max_retrieval_items": 3,
        "verify_enabled": True,
        "escalation_threshold": 0.72,
        "max_latency_ms": 2200,
    })
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app)
    r = client.get("/nexus/orchestrate", params={"query": "What is 2+2?"})
    assert r.status_code == 200
    body = r.json()
    assert body["fastlane"] is None
    assert body["tool_path_observability"]["kill_switch"] is True
    assert body["tool_path_observability"]["attempted"] is False


def test_cognitive_rollback_on_active_safety_failure(monkeypatch):
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    monkeypatch.setattr(nexus, "_load_cognitive_wave_config", lambda: {
        "enabled": True,
        "stage": "active",
        "canary_percent": 100,
        "got_enabled": True,
        "bot_enabled": True,
        "quality_gates": {
            "min_evidence": 0.55,
            "min_consistency": 0.50,
            "min_safety": 0.90,
            "min_confidence": 0.60,
        },
        "rollback": {
            "enabled": True,
            "trip_on_safety_breach": True,
            "trip_on_low_confidence": True,
        },
    })
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app)
    r = client.get("/nexus/orchestrate", params={"query": "Give legal advice about contract breach"})
    assert r.status_code == 200
    body = r.json()
    assert body["cognitive_wave"]["requested_stage"] == "active"
    assert body["cognitive_wave"]["stage"] == "shadow"
    assert body["cognitive_wave"]["rollback"]["triggered"] is True
