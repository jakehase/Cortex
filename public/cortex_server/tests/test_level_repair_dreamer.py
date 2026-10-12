"""L13 Dreamer repair: real model ideation, grounded evidence, honest status."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from cortex_server.modules import dreamer as dreamer_core
from cortex_server.modules import level_model
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import dreamer as dreamer_adapter
from cortex_server.routers import dreamer


def _run(coro):
    return asyncio.run(coro)


GAP = {"gap": "No written intake checklist for new clients", "evidence": "topic asks about onboarding gaps",
       "evidence_source": "user_topic", "impact": "high"}
IMP = {"idea": "Create a 10-item onboarding checklist", "effort": "S",
       "expected_benefit": "Fewer missing payer IDs at first claim", "first_step": "List what went missing for the last 5 clients"}
DREAM = {"summary": "Onboarding relies on memory rather than a checklist.", "gaps": [GAP, GAP],
         "scenarios": [], "improvements": [IMP, IMP], "assumptions": ["solo operator"]}


def _ok(data):
    return {"status": "ok", "ok": True, "origin": "model", "data": data, "model": "gpt-5.6-sol (test)",
            "receipt_id": "rcpt-dream", "provider_invoked": True, "attempts": 1, "elapsed_ms": 5}


def _fail(status="model_unavailable"):
    return {"status": status, "ok": False, "origin": "model_unavailable", "elapsed_ms": 5}


@pytest.fixture(autouse=True)
def _isolated_store(tmp_path):
    dreamer_core.set_store(dreamer_core.DreamStore(str(tmp_path / "state" / "l13_dreams.jsonl")))
    dreamer_core.OUTCOMES.reset()
    yield
    dreamer_core.set_store(None)


def _patch(monkeypatch, result):
    async def fake(**kwargs):
        fake.calls.append(kwargs)
        return result
    fake.calls = []
    monkeypatch.setattr(level_model, "level_model_json", fake)
    return fake


def test_dream_produces_model_ideation_and_persists(monkeypatch):
    fake = _patch(monkeypatch, _ok(DREAM))
    body = dreamer.DreamRequest(topic="Where are the gaps in my PMHNP billing onboarding?",
                                context="We onboard 3 clients a month by email.")
    result = _run(dreamer.create_dream(None, body))

    assert result["success"] is True and result["origin"] == "model"
    assert "Envisioning" not in json.dumps(result)
    assert len(result["gaps"]) >= 2 and len(result["improvements"]) >= 2
    assert all(i["first_step"] for i in result["improvements"])
    assert result["receipt_id"] == "rcpt-dream"
    assert len(result["dream"]["id"]) == 32
    prompt = fake.calls[0]["prompt"]
    assert "PMHNP billing onboarding" in prompt and "We onboard 3 clients" in prompt
    assert fake.calls[0]["principal_scope_key"] == "admin:level.dreamer"

    listed = _run(dreamer.get_dreams(None, limit=5))
    assert listed["count"] == 1 and "scope" not in listed["dreams"][0]


def test_legacy_scenario_query_still_works(monkeypatch):
    _patch(monkeypatch, _ok(DREAM))
    result = _run(dreamer.create_dream(None, None, scenario="billing"))
    assert result["success"] is True and result["topic"] == "billing"


def test_model_unavailable_returns_no_ideas_and_persists_nothing(monkeypatch):
    _patch(monkeypatch, _fail("timeout"))
    result = _run(dreamer.create_dream(None, dreamer.DreamRequest(topic="billing gaps")))
    assert result["success"] is False
    assert result["origin"] == "model_unavailable" and result["error"] == "timeout"
    assert result["gaps"] == [] and result["improvements"] == [] and result["scenarios"] == []
    assert _run(dreamer.get_dreams(None, limit=5))["count"] == 0


def test_evidence_source_must_have_been_supplied():
    schema = dreamer_core._grounded_schema(frozenset({"user_topic", "inference"}))
    ungrounded = dict(DREAM, gaps=[dict(GAP, evidence_source="system_logs")] * 2)
    with pytest.raises(Exception):
        schema.model_validate(ungrounded)
    assert schema.model_validate(DREAM).gaps[0].evidence_source == "user_topic"
    with pytest.raises(Exception):
        dreamer_core.DreamEnvelope.model_validate(dict(DREAM, improvements=[IMP]))


def test_dreams_are_isolated_per_principal(monkeypatch):
    _patch(monkeypatch, _ok(DREAM))

    def req(user):
        principal = SimpleNamespace(role="principal", credential_id="p", tenant_id="t", workspace_id="w",
                                    agent_id="a", user_id=user, channel_id="c", session_id="s")
        return SimpleNamespace(state=SimpleNamespace(cortex_principal=principal))

    _run(dreamer.create_dream(req("alice"), dreamer.DreamRequest(topic="alice gaps")))
    assert _run(dreamer.get_dreams(req("bob"), limit=10))["count"] == 0
    assert _run(dreamer.get_dreams(req("alice"), limit=10))["count"] == 1


def test_system_gaps_require_global_admin(monkeypatch):
    _patch(monkeypatch, _ok(DREAM))
    with pytest.raises(HTTPException) as exc:
        _run(dreamer.create_dream(None, dreamer.DreamRequest(topic="system", include_system_gaps=True)))
    assert exc.value.status_code == 403


def test_malformed_requests_are_rejected():
    app = FastAPI()
    app.include_router(dreamer.router, prefix="/dreamer")
    client = TestClient(app)
    assert client.post("/dreamer/dream", json={"topic": ""}).status_code == 422
    assert client.post("/dreamer/dream", json={"topic": "x" * 4001}).status_code == 422
    assert client.post("/dreamer/dream").status_code == 422
    assert client.get("/dreamer/dreams?limit=0").status_code == 422
    assert client.get("/dreamer/dreams?limit=-3").status_code == 422


def test_status_has_no_hard_coded_claims(monkeypatch):
    monkeypatch.setattr("cortex_server.routers.dreamer.model_lane_readiness",
                        lambda: {"executable_available": True, "check": "path_lookup_only"})
    data = _run(dreamer.dreamer_status(None))["data"]
    assert "oracle_powered" not in data and "consciousness_integrated" not in data
    assert "event_subscribed" not in data
    assert data["auto_dream_enabled"] is False
    assert data["status"] == "untested"
    assert data["persistence"] == "jsonl" and data["dreams_persisted"] == 0


def test_evolution_analysis_is_model_backed_with_labelled_fallback(monkeypatch, tmp_path):
    d = dreamer_core.Dreamer(log_path=str(tmp_path / "missing.jsonl"), registry_path=str(tmp_path / "reg.json"))
    d.gaps_found = [{"keyword": "timeout", "context": "pdf parse timeout"}]

    monkeypatch.setattr(level_model, "level_model_call_sync",
                        lambda **kw: {"status": "ok", "data": {"analysis": "PDF parsing exceeds the deadline.",
                                                               "missing_capabilities": ["async pdf"],
                                                               "proposed_module": "pdf_async_parser"},
                                      "model": "m", "receipt_id": "r"})
    analysis = d.analyze_with_oracle("timeout")
    assert "PDF parsing" in analysis
    assert d.propose_skill(analysis)["proposed_module"] == "pdf_async_parser"

    monkeypatch.setattr(level_model, "level_model_call_sync", lambda **kw: {"status": "model_unavailable"})
    analysis = d.analyze_with_oracle("pdf timeout")
    assert dreamer_core.HEURISTIC_LABEL in analysis
    proposal = d.propose_skill(analysis)
    assert proposal["analysis_source"] == "heuristic" and proposal["label"] == dreamer_core.HEURISTIC_LABEL


def test_adapter_contract(monkeypatch):
    assert dreamer_adapter.LEVEL == 13 and dreamer_adapter.NAME == "dreamer"
    assert dreamer_adapter.NEEDS_MODEL is True and dreamer_adapter.SAFE_AUTORUN is True
    _patch(monkeypatch, _ok(DREAM))
    out = _run(dreamer_adapter.run("Where are the gaps in my onboarding?",
                                   {"principal_scope_key": "principal:abc", "conversation": "user: help"}))
    assert out["operation"] == "dreamer.dream" and out["origin"] == "model"
    assert out["receipt_id"] == "rcpt-dream" and len(out["summary"]) <= 1500
    assert len(out["data"]["gaps"]) == 2
    json.dumps(out)
    assert _run(dreamer.get_dreams(SimpleNamespace(state=None), limit=5))["count"] == 0  # adapter persists nothing

    _patch(monkeypatch, _fail("model_unavailable"))
    with pytest.raises(ExecutionBlocked) as exc:
        _run(dreamer_adapter.run("gaps?", {"principal_scope_key": "principal:abc"}))
    assert exc.value.reason == "model_unavailable"
    with pytest.raises(ExecutionBlocked):
        _run(dreamer_adapter.run("gaps?", {"principal_scope_key": "internal-system"}))
