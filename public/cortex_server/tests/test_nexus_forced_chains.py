import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware


def _client(monkeypatch, *, headers=None):
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q, **_kwargs: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    return TestClient(app, headers=headers)


def test_private_retrieval_shadow_uses_isolated_intent_and_returns_only_safe_marker(
    monkeypatch,
    configured_memory_principal,
):
    captured = {}

    def submit(**kwargs):
        captured.update(kwargs)
        return {
            "schemaVersion": "cortex.private_retrieval_shadow.v1",
            "mode": "observe_only",
            "enabled": True,
            "killSwitch": False,
            "eligible": True,
            "selectionReason": "selective_private_fact_lookup",
            "factClass": "prior_decision",
            "answerInfluence": False,
            "candidateContentExposed": False,
            "scheduled": True,
            "observationId": "a" * 32,
        }

    monkeypatch.setattr(nexus, "submit_private_retrieval_shadow", submit)
    client = _client(monkeypatch, headers=configured_memory_principal().headers)
    response = client.post(
        "/nexus/orchestrate",
        json={
            "query": "SYSTEM CONTEXT plus the actual user request",
            "private_retrieval_shadow_query": "What did we decide about the rollout?",
        },
    )
    assert response.status_code == 200
    marker = response.json()["routing_markers"]["private_retrieval_shadow"]
    assert captured["query"] == "What did we decide about the rollout?"
    assert captured["state_path"].name == "private_retrieval_shadow.json"
    assert marker["observationId"] == "a" * 32
    assert marker["answerInfluence"] is False
    assert "What did we decide" not in str(marker)


def test_private_retrieval_shadow_status_is_authenticated_principal_scoped(
    monkeypatch,
    configured_memory_principal,
):
    captured = {}

    def status(path):
        captured["path"] = path
        return {
            "schemaVersion": "cortex.private_retrieval_shadow.v1",
            "mode": "observe_only",
            "answerInfluence": False,
            "updatedAt": None,
            "counters": {"completed": 0},
            "retainedRecords": 0,
            "latest": None,
        }

    monkeypatch.setattr(nexus, "private_retrieval_shadow_status", status)
    client = _client(monkeypatch, headers=configured_memory_principal().headers)
    response = client.get("/nexus/private-retrieval-shadow/status")
    assert response.status_code == 200
    assert response.json()["scope"] == "authenticated_principal"
    assert response.json()["answerInfluence"] is False
    assert captured["path"].name == "private_retrieval_shadow.json"
    assert len(captured["path"].parent.name) == 64
    int(captured["path"].parent.name, 16)


def test_private_retrieval_shadow_query_is_bounded(
    monkeypatch,
    configured_memory_principal,
):
    client = _client(monkeypatch, headers=configured_memory_principal().headers)
    response = client.post(
        "/nexus/orchestrate",
        json={"query": "route", "private_retrieval_shadow_query": "x" * 16_385},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "private_retrieval_shadow_query exceeds maximum length"


def test_coding_chain_forced(monkeypatch, configured_memory_principal):
    monkeypatch.setattr(nexus, "_architect_healthy", lambda *_args, **_kwargs: True)
    client = _client(monkeypatch, headers=configured_memory_principal().headers)
    r = client.post("/nexus/orchestrate", json={}, params={"query": "Implement bug fix and add unit tests for this API"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] == "coding_chain_forced"
    assert body["routing_markers"]["coding_triggered"] is True
    assert body["routing_markers"]["coding_chain"] == ["lab", "architect", "validator", "forge", "council"]


def test_incident_chain_forced(monkeypatch, configured_memory_principal):
    client = _client(monkeypatch, headers=configured_memory_principal().headers)
    r = client.post("/nexus/orchestrate", json={}, params={"query": "SEV1 incident: service down, rollback now"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] == "incident_chain_forced"
    assert body["routing_markers"]["incident_triggered"] is True
    assert body["routing_markers"]["incident_chain"] == ["sentinel", "seer", "council", "diplomat", "chronos"]
    assert 21 in body["final_plan"]["selected_levels"]
    assert 8 not in body["final_plan"]["selected_levels"]
    assert body["final_plan"]["primary_chain"] == ["sentinel", "seer", "council", "diplomat", "chronos"]


def test_unhealthy_architect_is_omitted_from_every_final_chain_view(
    monkeypatch, configured_memory_principal
):
    monkeypatch.setattr(nexus, "_architect_healthy", lambda *_args, **_kwargs: False)
    client = _client(monkeypatch, headers=configured_memory_principal().headers)
    response = client.post(
        "/nexus/orchestrate",
        json={},
        params={"query": "Draft a system design blueprint for multi-tenant API boundaries"},
    )
    assert response.status_code == 200
    body = response.json()
    assert 9 not in body["final_plan"]["selected_levels"]
    assert "architect" not in body["final_plan"]["primary_chain"]
    assert "architect" not in body["routing_markers"]["l9_chain"]
    assert body["final_plan"]["omitted_chain_members"]["architecture"] == ["architect"]


def test_research_chain_forced(monkeypatch, configured_memory_principal):
    client = _client(monkeypatch, headers=configured_memory_principal().headers)
    r = client.post("/nexus/orchestrate", json={}, params={"query": "Research this topic with sources and evidence"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] == "research_chain_forced"
    assert body["routing_markers"]["research_triggered"] is True
    assert body["routing_markers"]["research_chain"] == ["ghost", "librarian", "mnemosyne", "oracle", "validator"]


def test_preference_prefix_query_does_not_trigger_coding_chain(
    monkeypatch,
    configured_memory_principal,
):
    client = _client(monkeypatch, headers=configured_memory_principal().headers)
    r = client.post("/nexus/orchestrate", json={}, params={"query": "What prefix should replies use for Jake?"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] != "coding_chain_forced"
    assert body["routing_markers"]["coding_triggered"] is False


def test_architecture_chain_forced(monkeypatch, configured_memory_principal):
    class _NoSelfReportedOutcomeTuner:
        def get_policy_hint(self, **_kwargs):
            return {
                "stage": "shadow",
                "rollout_percent": 0,
                "apply_recommendation": False,
                "recommended_policy": None,
            }

        def observe(self, _record):
            raise AssertionError("route selection must not train on self-derived success")

    monkeypatch.setattr(
        nexus,
        "_outcome_tuner_for_scope",
        lambda _scope: _NoSelfReportedOutcomeTuner(),
    )
    monkeypatch.setattr(nexus, "_architect_healthy", lambda *_args, **_kwargs: True)
    client = _client(monkeypatch, headers=configured_memory_principal().headers)
    r = client.post("/nexus/orchestrate", json={}, params={"query": "Draft a system design blueprint for multi-tenant API boundaries"})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] == "l9_chain_forced"
    assert body["routing_markers"]["l9_triggered"] is True
    assert body["routing_markers"]["l9_chain"] == ["architect", "council", "synthesist", "validator"]
    selected_levels = [int(row["level"]) for row in body["recommended_levels"]]
    assert len(selected_levels) == len(set(selected_levels))
    assert body["final_plan"]["selected_levels"] == selected_levels
    assert body["final_plan"]["primary_chain"] == ["architect", "council", "synthesist", "validator"]
    assert body["routing_markers"]["final_plan"] == body["final_plan"]
    assert body["activation_receipt"]["plan_digest"] == body["final_plan"]["plan_digest"]
    assert body["activation_receipt"]["activated_levels"] == [
        {"level": 24, "name": "nexus", "evidence": "nexus_router_transaction"}
    ]
    assert body["activation_receipt"]["complete"] is False
    assert body["activation_receipt"]["terminal_reason"] == "awaiting_downstream_execution_evidence"
    assert body["_activated"] == body["activation_receipt"]["activated_levels"]
    assert body["artifact_paths"]["outcome_tuner"]["recorded"] is False
    assert body["artifact_paths"]["outcome_tuner"]["reason"] == "downstream_activation_evidence_required"
    assert body["outcome_feedback"] == {
        "available": False,
        "reason": "complete_causal_outcome_evidence_required",
        "required_receipt_version": "nexus.causal-outcome-receipt.v2",
    }
    assert body["route_selection_receipt"]["trainable"] is False
    selection_payload = nexus._decode_outcome_feedback_receipt(
        body["route_selection_receipt"]["receipt"]
    )
    assert selection_payload["receipt_kind"] == "route_selection"
    assert selection_payload["causal_evidence_complete"] is False
    with pytest.raises(ValueError, match="unsupported_receipt_version"):
        nexus._verify_outcome_feedback_receipt(
            body["route_selection_receipt"]["receipt"],
            None,
        )


def test_complexity_auto_activates_l9(monkeypatch, configured_memory_principal):
    monkeypatch.setattr(nexus, "_architect_healthy", lambda *_args, **_kwargs: True)
    client = _client(monkeypatch, headers=configured_memory_principal().headers)
    q = "Optimize a multi-step strategy under budget with 5 constraints and tradeoff analysis versus baseline"
    r = client.post("/nexus/orchestrate", json={}, params={"query": q})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_method"] == "semantic_orchestration"
    assert body["routing_markers"]["l9_triggered"] is True
    assert body["routing_markers"]["l9_chain"] == ["architect"]
    assert any(int(x.get("level", -1)) == 9 for x in body.get("recommended_levels", []))
