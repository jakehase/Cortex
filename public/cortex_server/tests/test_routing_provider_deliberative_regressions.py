import asyncio
import hashlib
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest

from cortex_server.routers import council, mediator, seer, simulator, synthesist_api
from cortex_server.modules.provider_result import (
    provider_text_fields,
    validated_oracle_provider_text,
)


def _run(coro):
    return asyncio.run(coro)


def _provider_text(
    text: str,
    *,
    provider: str = "openrouter",
    model: str = "test-model",
):
    receipt = {
        "version": "cortex.oracle.completion.v1",
        "receipt_id": "receipt-test-provider",
        "kind": "provider_response",
        "source": f"{provider}:{model}",
        "completed_at": "2026-08-23T05:00:00+00:00",
        "response_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "evidence": {
            "provider": provider,
            "model": model,
            "identity_source": "test_completion_receipt",
        },
    }
    return validated_oracle_provider_text(
        {
            "response": text,
            "model": model,
            "done": True,
            "lane": "gated_direct",
            "origin": "openclaw_subprocess",
            "provider_invoked": True,
            "degraded": False,
            "completion_receipt": receipt,
        }
    )


@asynccontextmanager
async def _conscious_action_stub(*_args, **_kwargs):
    yield SimpleNamespace(set_result=lambda _result: None)


def _valid_outcomes():
    return [
        {
            "label": "best_case",
            "probability": "25%",
            "key_events": ["pilot succeeds"],
            "timeline": "one month",
            "impact_assessment": "positive",
        },
        {
            "label": "most_likely",
            "probability": "50%",
            "key_events": ["pilot is mixed"],
            "timeline": "two months",
            "impact_assessment": "neutral",
        },
        {
            "label": "worst_case",
            "probability": "25%",
            "key_events": ["pilot is rolled back"],
            "timeline": "one week",
            "impact_assessment": "negative",
        },
    ]


def test_receiptless_or_mismatched_provider_text_cannot_claim_provider_provenance():
    with pytest.raises(ValueError, match="unverified"):
        provider_text_fields("plain provider-looking text", origin="provider")

    validated = _provider_text("bound bytes")
    validated.completion_receipt["response_sha256"] = hashlib.sha256(
        b"different bytes"
    ).hexdigest()
    with pytest.raises(ValueError, match="unbound"):
        provider_text_fields(validated, origin="provider")

    spoofed = _provider_text("receipt identity wins")
    spoofed.provider = "spoofed-provider"
    fields = provider_text_fields(spoofed, origin="provider")
    assert fields["provider"] == "openrouter"
    assert fields["model"] == "test-model"


def _seer_model_result(data=None, *, status="ok", attempts=1):
    """Shape of cortex_server.modules.level_model results for Seer tests."""
    if status != "ok":
        return {"status": status, "ok": False, "origin": "model_unavailable", "elapsed_ms": 3}
    return {
        "status": "ok",
        "ok": True,
        "origin": "model",
        "data": data,
        "model": "test-model",
        "receipt_id": "receipt-test-provider",
        "provider_invoked": True,
        "attempts": attempts,
        "elapsed_ms": 3,
    }


def _seer_complete_prediction():
    return {
        "risks": [
            {"risk": f"risk {index}", "severity": "low", "likelihood": "possible", "mitigation": "measure"}
            for index in range(3)
        ],
        "opportunities": [
            {"opportunity": f"opportunity {index}", "impact": "medium", "difficulty": "easy", "action": "pilot"}
            for index in range(3)
        ],
        "overall_outlook": "neutral",
        "confidence": "medium",
        "reasoning": "Evidence is mixed.",
        "assumptions": [],
        "evidence_basis": "model_knowledge",
    }


def test_seer_empty_provider_object_fails_closed_without_padding(monkeypatch):
    # An empty/incomplete provider object is invalid output after level_model's
    # one repair attempt: Seer must not pad it with templated risks.
    from cortex_server.modules import level_model

    async def invalid(**_kwargs):
        return _seer_model_result(status="invalid_output")

    monkeypatch.setattr(level_model, "level_model_json", invalid)
    result = _run(seer.predict(seer.PredictRequest(scenario="launch")))

    assert result.success is False
    assert result.risks == []
    assert result.opportunities == []
    assert result.origin == "model_unavailable"
    assert result.provider_invoked is False
    assert result.degraded is True
    assert result.error == "invalid_output"
    assert "Execution risk" not in result.model_dump_json()


def test_seer_complete_provider_schema_remains_non_degraded(monkeypatch):
    from cortex_server.modules import level_model

    async def complete(**_kwargs):
        return _seer_model_result(_seer_complete_prediction())

    monkeypatch.setattr(level_model, "level_model_json", complete)
    result = _run(seer.predict(seer.PredictRequest(scenario="launch")))

    assert result.success is True
    assert result.origin == "model"
    assert result.degraded is False
    assert result.repair_applied is False
    assert result.error is None
    assert result.provider_invoked is True
    assert result.model == "test-model"
    assert result.receipt_id == "receipt-test-provider"
    assert result.validated_evidence == [
        "level_model_completion_receipt",
        "prediction_schema_complete",
    ]


def test_seer_second_model_attempt_is_reported_as_repair(monkeypatch):
    from cortex_server.modules import level_model

    async def repaired(**_kwargs):
        return _seer_model_result(_seer_complete_prediction(), attempts=2)

    monkeypatch.setattr(level_model, "level_model_json", repaired)
    result = _run(seer.predict(seer.PredictRequest(scenario="launch")))

    assert result.success is True
    assert result.repair_applied is True
    assert result.degraded is False


def test_seer_timeout_returns_no_fabricated_forecast(monkeypatch):
    from cortex_server.modules import level_model

    async def timeout(**_kwargs):
        return _seer_model_result(status="timeout")

    monkeypatch.setattr(level_model, "level_model_json", timeout)
    prediction = _run(seer.predict(seer.PredictRequest(scenario="launch")))
    trends = _run(seer.trends(seer.TrendsRequest(topic="systems")))

    for result in (prediction, trends):
        assert result.success is False
        assert result.origin == "model_unavailable"
        assert result.error == "timeout"
        dumped = result.model_dump_json()
        assert "Observed in recent operating patterns" not in dumped
        assert "Monitor leading indicators" not in dumped
    assert trends.emerging == [] and trends.declining == [] and trends.disruption is None


def test_seer_trends_tracks_complete_provider_results(monkeypatch):
    from cortex_server.modules import level_model

    complete = {
        "emerging": [{"trend": f"emerging {index}", "evidence": "signal", "timeline": "soon"} for index in range(3)],
        "declining": [{"trend": f"declining {index}", "evidence": "signal", "timeline": "later"} for index in range(2)],
        "disruption": {"trend": "shift", "evidence": "signal", "timeline": "year"},
        "assumptions": [],
        "evidence_basis": "model_knowledge",
    }

    async def provider_response(**_kwargs):
        return _seer_model_result(complete)

    monkeypatch.setattr(level_model, "level_model_json", provider_response)
    valid = _run(seer.trends(seer.TrendsRequest(topic="systems")))

    assert valid.success is True
    assert valid.origin == "model"
    assert valid.degraded is False
    assert valid.model == "test-model"
    assert valid.disruption.trend == "shift"
    assert valid.validated_evidence == [
        "level_model_completion_receipt",
        "trends_schema_complete",
    ]


def test_synthesist_identifies_local_heuristic_origin(monkeypatch):
    class FakeSynthesist:
        def synthesize(self, query_context=None):
            return {
                "success": True,
                "insights_generated": 1,
                "meta_patterns_discovered": 0,
                "levels_contributing": 2,
                "insights": [{"confidence": 0.9, "insight": "local heuristic"}],
            }

    monkeypatch.setattr(synthesist_api, "_get_synthesist", lambda: FakeSynthesist())
    result = _run(synthesist_api.run_synthesis())

    assert result["origin"] == "heuristic"
    assert result["provider_invoked"] is False
    assert result["provider"] is None
    assert result["validated_evidence"] == [
        "local_level_knowledge",
        "local_cross_references",
    ]


