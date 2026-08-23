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


def test_council_free_text_cannot_authorize_even_when_it_contains_approve(monkeypatch):
    async def fake_oracle(*_args, **_kwargs):
        return "I cannot APPROVE this unsafe action."

    monkeypatch.setattr(council, "_call_oracle", fake_oracle)
    result = _run(
        council.council_review(
            council.ReviewRequest(kind="config_change", title="unsafe action")
        )
    )

    assert result["verdict"] == "NEEDS_CHANGES"
    assert "retry_council_review" in result["required_conditions"]


def test_council_strict_json_can_still_approve(monkeypatch):
    async def valid_json(*_args, **_kwargs):
        return json.dumps(
            {
                "verdict": "APPROVE",
                "risk_score": 0.1,
                "top_concerns": [],
                "required_conditions": ["run_tests"],
                "rationale": "Bounded and reversible.",
                "suggested_changes": [],
            }
        )

    async def no_advisory(*_args, **_kwargs):
        return None

    monkeypatch.setattr(council, "_call_oracle", valid_json)
    monkeypatch.setattr(council, "_call_seer_predict", no_advisory)
    result = _run(
        council.council_review(
            council.ReviewRequest(kind="config_change", title="bounded action")
        )
    )

    assert result["verdict"] == "APPROVE"
    assert result["risk_score"] == 0.1


def test_council_incomplete_json_cannot_authorize(monkeypatch):
    async def incomplete_json(*_args, **_kwargs):
        return '{"verdict":"APPROVE"}'

    monkeypatch.setattr(council, "_call_oracle", incomplete_json)
    result = _run(
        council.council_review(
            council.ReviewRequest(kind="config_change", title="underspecified action")
        )
    )

    assert result["verdict"] == "NEEDS_CHANGES"
    assert result["risk_score"] == 0.6
    assert "retry_council_review" in result["required_conditions"]


def test_council_embedded_json_cannot_authorize(monkeypatch):
    async def wrapped_json(*_args, **_kwargs):
        return (
            "provider preface\n"
            '{"verdict":"APPROVE","risk_score":0.1,"top_concerns":[],'
            '"required_conditions":["run_tests"],"rationale":"bounded",'
            '"suggested_changes":[]}\n'
            "provider epilogue"
        )

    monkeypatch.setattr(council, "_call_oracle", wrapped_json)
    result = _run(
        council.council_review(
            council.ReviewRequest(kind="config_change", title="wrapped decision")
        )
    )

    assert result["verdict"] == "NEEDS_CHANGES"
    assert "retry_council_review" in result["required_conditions"]


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


def test_council_provider_deliberation_and_critique_preserve_receipt_identity(monkeypatch):
    deliberation_text = (
        "Technical feasibility: Score 8/10 - feasible.\n"
        "Risk/security: Score 2/10 - bounded.\n"
        "Ethical implications: Score 8/10 - acceptable.\n"
        "Resource cost: Score 7/10 - affordable.\n"
        "User impact: Score 8/10 - helpful.\n\n"
        "Overall recommendation: GO with tests."
    )
    critique_text = (
        "Feasibility: Score 8/10 - feasible.\n"
        "Risk: Score 2/10 - bounded.\n"
        "Innovation: Score 6/10 - useful.\n"
        "Alignment: Score 9/10 - aligned.\n"
        "- Concern: preserve rollback.\n"
        "Recommendation: GO."
    )
    responses = iter([_provider_text(deliberation_text), _provider_text(critique_text)])

    async def provider_response(*_args, **_kwargs):
        return next(responses)

    monkeypatch.setattr(council, "_call_oracle", provider_response)
    monkeypatch.setattr(council, "conscious_action", _conscious_action_stub)

    deliberated = _run(council.deliberate(council.DeliberationRequest(topic="safe rollout")))[
        "deliberation"
    ]
    critiqued = _run(council.critique_action(council.CritiqueRequest(action="safe rollout")))

    for result in (deliberated, critiqued):
        assert result["origin"] == "provider"
        assert result["provider_invoked"] is True
        assert result["provider"] == "openrouter"
        assert result["model"] == "test-model"
        assert result["degraded"] is False
        assert "oracle_completion_receipt" in result["validated_evidence"]


def test_council_malformed_provider_text_is_explicit_schema_repair(monkeypatch):
    responses = iter([_provider_text("hello"), _provider_text("hello")])

    async def malformed_provider_response(*_args, **_kwargs):
        return next(responses)

    monkeypatch.setattr(council, "_call_oracle", malformed_provider_response)
    monkeypatch.setattr(council, "conscious_action", _conscious_action_stub)

    deliberated = _run(council.deliberate(council.DeliberationRequest(topic="safe rollout")))[
        "deliberation"
    ]
    critiqued = _run(council.critique_action(council.CritiqueRequest(action="safe rollout")))

    for result in (deliberated, critiqued):
        assert result["origin"] == "schema_repair"
        assert result["provider_invoked"] is True
        assert result["provider"] == "openrouter"
        assert result["model"] == "test-model"
        assert result["degraded"] is True
        assert result["repair_applied"] is True
        assert result["error"] == "degraded:oracle_schema_repair"
        assert result["validated_evidence"] == ["oracle_completion_receipt"]


def test_council_deliberation_labels_deterministic_fallback(monkeypatch):
    async def unavailable(*_args, **_kwargs):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(council, "_call_oracle", unavailable)
    monkeypatch.setattr(council, "conscious_action", _conscious_action_stub)
    result = _run(council.deliberate(council.DeliberationRequest(topic="deploy safely")))
    deliberation = result["deliberation"]

    assert result["success"] is True
    assert deliberation["origin"] == "deterministic_fallback"
    assert deliberation["provider_invoked"] is False
    assert deliberation["provider"] is None
    assert deliberation["degraded"] is True
    assert deliberation["repair_applied"] is True
    assert deliberation["error"].startswith("degraded:oracle_unavailable")
    assert deliberation["validated_evidence"] == []


def test_mediator_empty_provider_object_is_explicit_schema_repair(monkeypatch):
    async def empty_object(*_args, **_kwargs):
        return _provider_text("{}")

    monkeypatch.setattr(mediator, "_call_oracle", empty_object)
    result = _run(
        mediator.mediate(
            mediator.MediateRequest(position_a="ship now", position_b="wait for tests")
        )
    )

    assert result.success is True
    assert result.origin == "schema_repair"
    assert result.degraded is True
    assert result.repair_applied is True
    assert result.error == "degraded:oracle_schema_repair"
    assert result.provider_invoked is True
    assert result.provider == "openrouter"
    assert result.model == "test-model"
    assert result.validated_evidence == ["oracle_completion_receipt"]


def test_mediator_complete_provider_schema_remains_non_degraded(monkeypatch):
    async def complete_object(*_args, **_kwargs):
        return _provider_text(json.dumps(
            {
                "common_ground": [{"area": "quality", "explanation": "both value it"}],
                "core_differences": [
                    {
                        "issue": "timing",
                        "position_a_view": "now",
                        "position_b_view": "later",
                    }
                ],
                "compromise_proposals": [
                    {
                        "proposal": "pilot",
                        "fairness_rating": "high",
                        "rationale": "limits risk",
                    }
                ],
                "recommended_resolution": "Run a bounded pilot.",
            }
        ))

    monkeypatch.setattr(mediator, "_call_oracle", complete_object)
    result = _run(
        mediator.mediate(
            mediator.MediateRequest(position_a="ship now", position_b="wait for tests")
        )
    )

    assert result.origin == "provider"
    assert result.degraded is False
    assert result.repair_applied is False
    assert result.error is None
    assert result.provider_invoked is True
    assert result.provider == "openrouter"
    assert result.model == "test-model"
    assert result.validated_evidence == [
        "oracle_completion_receipt",
        "mediation_schema_complete",
    ]


def test_mediator_json_wrapper_is_explicit_schema_repair(monkeypatch):
    wrapped = """```json
{"common_ground":[{"area":"quality","explanation":"shared"}],"core_differences":[{"issue":"timing","position_a_view":"now","position_b_view":"later"}],"compromise_proposals":[{"proposal":"pilot","fairness_rating":"high","rationale":"bounded"}],"recommended_resolution":"pilot first"}
```"""

    async def wrapped_object(*_args, **_kwargs):
        return _provider_text(wrapped)

    monkeypatch.setattr(mediator, "_call_oracle", wrapped_object)
    result = _run(
        mediator.mediate(
            mediator.MediateRequest(position_a="ship now", position_b="wait for tests")
        )
    )

    assert result.origin == "schema_repair"
    assert result.degraded is True
    assert result.repair_applied is True
    assert result.provider_invoked is True
    assert result.error == "degraded:oracle_schema_repair"


def test_mediator_resolve_tracks_complete_and_repaired_provider_results(monkeypatch):
    complete = json.dumps(
        {
            "strategies": [
                {
                    "order": 1,
                    "name": "pilot",
                    "approach": "start small",
                    "pros": ["bounded"],
                    "cons": ["slower"],
                    "best_when": "risk is uncertain",
                }
            ]
        }
    )
    empty_lists = json.dumps(
        {
            "strategies": [
                {
                    "order": 1,
                    "name": "pilot",
                    "approach": "start small",
                    "pros": [],
                    "cons": [],
                    "best_when": "risk is uncertain",
                }
            ]
        }
    )
    responses = iter(
        [_provider_text(complete), _provider_text("{}"), _provider_text(empty_lists)]
    )

    async def provider_response(*_args, **_kwargs):
        return next(responses)

    monkeypatch.setattr(mediator, "_call_oracle", provider_response)
    valid = _run(mediator.resolve(mediator.ResolveRequest(conflict="ship or wait")))
    repaired = _run(mediator.resolve(mediator.ResolveRequest(conflict="ship or wait")))
    empty_list_repair = _run(
        mediator.resolve(mediator.ResolveRequest(conflict="ship or wait"))
    )

    assert valid.origin == "provider"
    assert valid.degraded is False
    assert valid.provider == "openrouter"
    assert valid.model == "test-model"
    assert valid.validated_evidence == [
        "oracle_completion_receipt",
        "resolution_schema_complete",
    ]
    assert repaired.origin == "schema_repair"
    assert repaired.degraded is True
    assert repaired.repair_applied is True
    assert repaired.provider_invoked is True
    assert repaired.provider == "openrouter"
    assert repaired.error == "degraded:oracle_schema_repair"
    assert empty_list_repair.origin == "schema_repair"
    assert empty_list_repair.repair_applied is True
    assert empty_list_repair.error == "degraded:oracle_schema_repair"


def test_seer_empty_provider_object_is_explicit_schema_repair(monkeypatch):
    async def empty_object(*_args, **_kwargs):
        return _provider_text("{}")

    monkeypatch.setattr(seer, "_call_oracle", empty_object)
    result = _run(seer.predict(seer.PredictRequest(scenario="launch")))

    assert result.success is True
    assert result.origin == "schema_repair"
    assert result.degraded is True
    assert result.repair_applied is True
    assert result.error == "degraded:oracle_schema_repair"
    assert result.provider_invoked is True
    assert result.provider == "openrouter"
    assert result.model == "test-model"
    assert result.validated_evidence == ["oracle_completion_receipt"]


def test_seer_complete_provider_schema_remains_non_degraded(monkeypatch):
    async def complete_object(*_args, **_kwargs):
        risks = [
            {
                "risk": f"risk {index}",
                "severity": "low",
                "likelihood": "possible",
                "mitigation": "measure",
            }
            for index in range(3)
        ]
        opportunities = [
            {
                "opportunity": f"opportunity {index}",
                "impact": "medium",
                "difficulty": "easy",
                "action": "pilot",
            }
            for index in range(3)
        ]
        return _provider_text(json.dumps(
            {
                "risks": risks,
                "opportunities": opportunities,
                "overall_outlook": "neutral",
                "confidence": "medium",
                "reasoning": "Evidence is mixed.",
            }
        ))

    monkeypatch.setattr(seer, "_call_oracle", complete_object)
    result = _run(seer.predict(seer.PredictRequest(scenario="launch")))

    assert result.origin == "provider"
    assert result.degraded is False
    assert result.repair_applied is False
    assert result.error is None
    assert result.provider_invoked is True
    assert result.provider == "openrouter"
    assert result.model == "test-model"
    assert result.validated_evidence == [
        "oracle_completion_receipt",
        "prediction_schema_complete",
    ]


def test_seer_json_wrapper_is_explicit_schema_repair(monkeypatch):
    payload = {
        "risks": [
            {
                "risk": f"risk {index}",
                "severity": "low",
                "likelihood": "possible",
                "mitigation": "measure",
            }
            for index in range(3)
        ],
        "opportunities": [
            {
                "opportunity": f"opportunity {index}",
                "impact": "medium",
                "difficulty": "easy",
                "action": "pilot",
            }
            for index in range(3)
        ],
        "overall_outlook": "neutral",
        "confidence": "medium",
        "reasoning": "Evidence is mixed.",
    }

    async def wrapped_object(*_args, **_kwargs):
        return _provider_text(f"```json\n{json.dumps(payload)}\n```")

    monkeypatch.setattr(seer, "_call_oracle", wrapped_object)
    result = _run(seer.predict(seer.PredictRequest(scenario="launch")))

    assert result.origin == "schema_repair"
    assert result.degraded is True
    assert result.repair_applied is True
    assert result.provider_invoked is True
    assert result.error == "degraded:oracle_schema_repair"


def test_seer_nonempty_invalid_items_are_explicit_schema_repair(monkeypatch):
    invalid = json.dumps(
        {
            "risks": [{"risk": "", "severity": "impossible"}] * 3,
            "opportunities": [{"opportunity": "", "impact": "infinite"}] * 3,
            "overall_outlook": "unknown",
            "confidence": "certain",
            "reasoning": "",
        }
    )

    async def invalid_provider_schema(*_args, **_kwargs):
        return _provider_text(invalid)

    monkeypatch.setattr(seer, "_call_oracle", invalid_provider_schema)
    result = _run(seer.predict(seer.PredictRequest(scenario="launch")))

    assert result.success is True
    assert result.origin == "schema_repair"
    assert result.degraded is True
    assert result.repair_applied is True
    assert result.provider_invoked is True
    assert result.provider == "openrouter"
    assert result.error == "degraded:oracle_schema_repair"


def test_seer_unparseable_verified_provider_output_fails_with_provider_identity(monkeypatch):
    responses = iter([_provider_text("not json"), _provider_text("not json")])

    async def invalid_json(*_args, **_kwargs):
        return next(responses)

    monkeypatch.setattr(seer, "_call_oracle", invalid_json)
    prediction = _run(seer.predict(seer.PredictRequest(scenario="launch")))
    trends = _run(seer.trends(seer.TrendsRequest(topic="systems")))

    for result in (prediction, trends):
        assert result.success is False
        assert result.origin == "provider"
        assert result.provider_invoked is True
        assert result.provider == "openrouter"
        assert result.model == "test-model"
        assert result.degraded is True
        assert result.repair_applied is False
        assert result.error == "oracle_invalid_json"
        assert result.validated_evidence == ["oracle_completion_receipt"]


def test_seer_trends_tracks_complete_and_repaired_provider_results(monkeypatch):
    complete = json.dumps(
        {
            "emerging": [
                {"trend": f"emerging {index}", "evidence": "signal", "timeline": "soon"}
                for index in range(3)
            ],
            "declining": [
                {"trend": f"declining {index}", "evidence": "signal", "timeline": "later"}
                for index in range(2)
            ],
            "disruption": {"trend": "shift", "evidence": "signal", "timeline": "year"},
        }
    )
    responses = iter([_provider_text(complete), _provider_text("{}")])

    async def provider_response(*_args, **_kwargs):
        return next(responses)

    monkeypatch.setattr(seer, "_call_oracle", provider_response)
    valid = _run(seer.trends(seer.TrendsRequest(topic="systems")))
    repaired = _run(seer.trends(seer.TrendsRequest(topic="systems")))

    assert valid.origin == "provider"
    assert valid.degraded is False
    assert valid.provider == "openrouter"
    assert valid.model == "test-model"
    assert valid.validated_evidence == [
        "oracle_completion_receipt",
        "trends_schema_complete",
    ]
    assert repaired.origin == "schema_repair"
    assert repaired.degraded is True
    assert repaired.repair_applied is True
    assert repaired.provider_invoked is True
    assert repaired.provider == "openrouter"
    assert repaired.error == "degraded:oracle_schema_repair"


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


@pytest.mark.parametrize(
    "outcomes",
    [
        [
            {
                **item,
                "label": "best_case",
            }
            for item in _valid_outcomes()
        ],
        [
            {
                **item,
                "probability": "999%" if index == 0 else item["probability"],
            }
            for index, item in enumerate(_valid_outcomes())
        ],
        [
            {
                "label": item["label"],
                "probability": "10%",
                "key_events": item["key_events"],
                "timeline": "soon",
                "impact_assessment": item["impact_assessment"],
            }
            for item in _valid_outcomes()
        ],
    ],
)
def test_simulator_rejects_duplicate_labels_out_of_bounds_or_bad_sum(outcomes):
    with pytest.raises(ValueError, match="contract violation"):
        simulator._parse_outcomes_strict(outcomes)


def test_simulator_accepts_exact_label_set_and_probability_distribution():
    parsed = simulator._parse_outcomes_strict(_valid_outcomes())
    assert {item.label for item in parsed} == {
        "best_case",
        "most_likely",
        "worst_case",
    }


def test_simulator_transport_failure_uses_typed_oracle_fallback(monkeypatch):
    request = httpx.Request("POST", "http://augmenter.invalid/chat")

    async def connection_failure(*_args, **_kwargs):
        raise httpx.ConnectError("offline", request=request)

    async def oracle_result(*_args, **_kwargs):
        return {"response": json.dumps({"outcomes": _valid_outcomes()})}

    monkeypatch.setattr(simulator, "_call_augmenter", connection_failure)
    monkeypatch.setattr(simulator, "_call_oracle_fallback", oracle_result)
    result = _run(
        simulator.run_simulation(
            simulator.SimulatorRequest(scenario="safe rollout"),
            SimpleNamespace(state=SimpleNamespace()),
        )
    )

    assert result.success is True
    assert result.error == "degraded_path:augmenter_transport_fallback_to_oracle"
