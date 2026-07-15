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
    assert body["assurance"]["validators"]["checks"]["missing_constraints"] == ["at least", "budget"]
    assert body["assurance"]["release_decision"] in {"downgrade", "repair", "block"}


def test_assurance_surfaces_missing_constraints_on_semantic_lane(monkeypatch):
    monkeypatch.setattr(nexus, "_is_simple_qa", lambda *a, **k: False)
    client = _client(monkeypatch)
    q = "How do I install this under budget 100 with at least 3 steps?"
    r = client.post("/nexus/orchestrate", json={}, params={"query": q})

    assert r.status_code == 200
    body = r.json()
    assert body["fastlane"] is None
    assert body["assurance"]["validators"]["checks"]["validation_source"] == "semantic_reasoning"
    assert body["assurance"]["validators"]["checks"]["missing_constraints"] == ["at least", "budget"]
    assert "missing_constraints" in body["assurance"]["reason_codes"]
    assert body["assurance"]["release_decision"] in {"downgrade", "repair", "block"}


def test_semantic_lane_completes_assurance_checks_without_fastlane():
    checks = nexus._complete_orchestration_checks(
        query="Configure this with at most 2 retries and without downtime",
        checks={"retrieval_hits": 0, "grounded_retrieval": False},
        fastlane=None,
        semantic_result={"reasoning": "Use the normal configuration flow."},
        reasoning=["Semantic orchestration selected."],
    )

    assert checks["validation_source"] == "semantic_reasoning"
    assert checks["missing_constraints"] == ["at most", "without"]
    assert checks["missing_constraints_count"] == 2


def test_semantic_lane_validator_uses_cognitive_quality_and_completed_checks():
    checks = {
        "required_fields_ok": True,
        "contradiction_detected": False,
        "overclaim_detected": False,
        "missing_constraints_count": 0,
        "shallow_confidence_risk": False,
    }

    assert nexus._orchestration_validator_pass(
        checks=checks,
        fastlane=None,
        cognitive_quality_pass=True,
    )
    assert not nexus._orchestration_validator_pass(
        checks=checks,
        fastlane=None,
        cognitive_quality_pass=False,
    )

    incomplete_checks = {**checks, "required_fields_ok": False}
    assert not nexus._orchestration_validator_pass(
        checks=incomplete_checks,
        fastlane={"escalated": False},
        cognitive_quality_pass=True,
    )

    contradictory_checks = {**checks, "contradiction_detected": True}
    assert not nexus._orchestration_validator_pass(
        checks=contradictory_checks,
        fastlane={"escalated": False},
        cognitive_quality_pass=True,
    )
