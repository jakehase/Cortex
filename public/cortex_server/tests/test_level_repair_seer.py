"""L30 Seer repair: model-backed forecasts, no fabricated fallback content."""

import asyncio
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.modules import level_model
from cortex_server.modules import seer as seer_core
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import seer as seer_adapter
from cortex_server.routers import seer

TEMPLATE_STRINGS = (
    "Execution risk #",
    "Opportunity #",
    "Monitor leading indicators",
    "Run a small pilot and measure outcome",
    "Observed in recent operating patterns",
    "Seer normalized output",
)


def _run(coro):
    return asyncio.run(coro)


def _prediction():
    return {
        "risks": [
            {"risk": f"Payer pushback {i}", "severity": "high", "likelihood": "possible", "mitigation": "grandfather"}
            for i in range(3)
        ],
        "opportunities": [
            {"opportunity": f"Premium tier {i}", "impact": "medium", "difficulty": "easy", "action": "pilot"}
            for i in range(3)
        ],
        "overall_outlook": "neutral",
        "confidence": "medium",
        "reasoning": "Demand is inelastic for existing clients but new sales slow.",
        "assumptions": ["no competitor price cut"],
        "evidence_basis": "model_knowledge",
    }


def _ok(data, attempts=1):
    return {"status": "ok", "ok": True, "origin": "model", "data": data, "model": "gpt-5.6-sol (test)",
            "receipt_id": "rcpt-seer", "provider_invoked": True, "attempts": attempts, "elapsed_ms": 5}


def _fail(status):
    return {"status": status, "ok": False, "origin": "model_unavailable", "elapsed_ms": 5,
            "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL}


def test_predict_happy_path_uses_principal_scope_and_returns_receipt(monkeypatch):
    seen = {}

    async def fake(**kwargs):
        seen.update(kwargs)
        return _ok(_prediction())

    monkeypatch.setattr(level_model, "level_model_json", fake)
    result = _run(seer.predict(seer.PredictRequest(scenario="A billing service raises prices 15%", time_horizon="6 months")))

    assert result.success is True
    assert result.origin == "model"
    assert result.receipt_id == "rcpt-seer"
    assert result.model == "gpt-5.6-sol (test)"
    assert len(result.risks) == 3 and len(result.opportunities) == 3
    assert result.assumptions == ["no competitor price cut"]
    assert result.evidence_basis == "model_knowledge"
    assert seen["schema"] is seer_core.PredictEnvelope
    assert seen["principal_scope_key"] == "admin:level.seer"
    assert seen["principal_scope_key"] != "internal-system"
    assert "raises prices 15%" in seen["prompt"]


@pytest.mark.parametrize("status", ["model_unavailable", "timeout", "invalid_output", "model_unverified", "busy"])
def test_predict_and_trends_failures_carry_no_content(monkeypatch, status):
    async def fake(**_kwargs):
        return _fail(status)

    monkeypatch.setattr(level_model, "level_model_json", fake)
    prediction = _run(seer.predict(seer.PredictRequest(scenario="launch")))
    trends = _run(seer.trends(seer.TrendsRequest(topic="telehealth billing")))

    for result in (prediction, trends):
        assert result.success is False
        assert result.origin == "model_unavailable"
        assert result.error == status
        assert result.label == level_model.LEVEL_MODEL_UNAVAILABLE_LABEL
        dumped = result.model_dump_json()
        for template in TEMPLATE_STRINGS:
            assert template not in dumped
    assert prediction.risks == [] and prediction.opportunities == [] and prediction.reasoning == ""
    assert trends.emerging == [] and trends.declining == [] and trends.disruption is None


def test_strict_schema_rejects_out_of_enum_and_short_lists():
    bad_enum = _prediction()
    bad_enum["risks"][0]["severity"] = "severe"
    with pytest.raises(Exception):
        seer_core.PredictEnvelope.model_validate(bad_enum)
    short = _prediction()
    short["risks"] = short["risks"][:2]
    with pytest.raises(Exception):
        seer_core.PredictEnvelope.model_validate(short)
    with pytest.raises(Exception):
        seer_core.PredictEnvelope.model_validate({})


def test_real_level_model_parsing_repairs_once_then_fails_closed(monkeypatch):
    """Exercise level_model's schema/repair loop with a fake provider call."""
    replies = iter(["```json\n{\"risks\": []}\n```", "still not valid"])
    prompts = []

    def fake_call_once(prompt, system, scope, lane):
        prompts.append(prompt)
        return {
            "text": next(replies),
            "model": "gpt-5.6-sol (test)",
            "completion": {"done": True, "provider_invoked": True, "degraded": False,
                           "completion_receipt": {"receipt_id": "rcpt"}},
        }

    monkeypatch.setattr(level_model, "_call_once", fake_call_once)
    result = _run(seer.predict(seer.PredictRequest(scenario="launch")))

    assert len(prompts) == 2  # one original + one repair attempt
    assert "not valid JSON for the required schema" in prompts[1]
    assert result.success is False
    assert result.error == "invalid_output"
    assert result.risks == []


def test_real_level_model_parsing_accepts_fenced_valid_json(monkeypatch):
    text = "```json\n" + json.dumps(_prediction()) + "\n```"

    def fake_call_once(prompt, system, scope, lane):
        return {"text": text, "model": "m", "completion": {"done": True, "provider_invoked": True,
                "degraded": False, "completion_receipt": {"receipt_id": "rcpt-2"}}}

    monkeypatch.setattr(level_model, "_call_once", fake_call_once)
    result = _run(seer.predict(seer.PredictRequest(scenario="launch")))
    assert result.success is True and result.receipt_id == "rcpt-2"


def test_malformed_requests_are_rejected():
    app = FastAPI()
    app.include_router(seer.router, prefix="/seer")
    client = TestClient(app)
    assert client.post("/seer/predict", json={}).status_code == 422
    assert client.post("/seer/predict", json={"scenario": 123}).status_code == 422
    assert client.post("/seer/predict", json={"scenario": "x" * 5000}).status_code == 422
    assert client.post("/seer/predict", json={"scenario": "ok", "time_horizon": "y" * 65}).status_code == 422
    assert client.post("/seer/trends", json={"topic": ""}).status_code == 422


def test_status_reflects_measured_outcomes(monkeypatch):
    seer_core.OUTCOMES.reset()
    monkeypatch.setattr(
        "cortex_server.routers.seer.model_lane_readiness",
        lambda: {"executable_available": True, "check": "path_lookup_only"},
    )
    assert _run(seer.seer_status())["status"] == "untested"

    async def fake(**_kwargs):
        return _fail("model_unavailable")

    monkeypatch.setattr(level_model, "level_model_json", fake)
    _run(seer.predict(seer.PredictRequest(scenario="launch")))
    status = _run(seer.seer_status())
    assert status["status"] == "degraded"
    assert "allow_degraded_fallback" not in status


def test_adapter_contract_success_and_blocked(monkeypatch):
    assert seer_adapter.LEVEL == 30 and seer_adapter.NAME == "seer"
    assert seer_adapter.NEEDS_MODEL is True and seer_adapter.SAFE_AUTORUN is True

    async def fake(**kwargs):
        return _ok(_prediction())

    monkeypatch.setattr(level_model, "level_model_json", fake)
    out = _run(seer_adapter.run("What happens if I raise prices within 3 months?",
                                {"principal_scope_key": "principal:abc"}))
    assert out["operation"] == "seer.predict" and out["origin"] == "model"
    assert out["receipt_id"] == "rcpt-seer"
    assert out["data"]["time_horizon"] == "3 months"
    assert len(out["summary"]) <= 1500
    json.dumps(out)

    async def down(**_kwargs):
        return _fail("model_unavailable")

    monkeypatch.setattr(level_model, "level_model_json", down)
    with pytest.raises(ExecutionBlocked) as exc:
        _run(seer_adapter.run("forecast churn", {"principal_scope_key": "principal:abc"}))
    assert exc.value.reason == "model_unavailable"
    with pytest.raises(ExecutionBlocked):
        _run(seer_adapter.run("forecast churn", {"principal_scope_key": "internal-system"}))
    with pytest.raises(ExecutionBlocked):
        _run(seer_adapter.run("forecast churn", {}))


def test_legacy_stub_class_no_longer_returns_templates():
    with pytest.raises(NotImplementedError):
        seer_core.Seer().predict("x")
