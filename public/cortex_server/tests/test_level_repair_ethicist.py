"""L33 Ethicist repair: model-backed, no tinyllama pin, scores recomputed server-side."""

import asyncio
import inspect
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from cortex_server.modules import level_model
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_call_health import LevelCallHealth
from cortex_server.routers import ethicist


def _run(coro):
    return asyncio.run(coro)


def _empty_dims():
    return {d: {"flags": [], "reasoning": "Nothing applies."} for d in ethicist.DIMENSION_WEIGHTS}


def _ssn_export():
    dims = _empty_dims()
    dims["privacy"] = {"flags": [
        {"criterion": "collects_or_uses_personal_data", "evidence": "patient SSNs"},
        {"criterion": "sensitive_data_category", "evidence": "SSNs are government IDs"},
        {"criterion": "discloses_or_shares_data", "evidence": "public S3 bucket"},
        {"criterion": "no_minimisation_or_retention_limit", "evidence": "all patients"},
    ], "reasoning": "Publishing SSNs publicly."}
    dims["consent"] = {"flags": [{"criterion": "no_consent_obtained", "evidence": "patients not asked"}],
                       "reasoning": "No consent."}
    return {"dimensions": dims, "concerns": ["Mass PII exposure"], "mitigations": ["Do not export"],
            "summary": "Exporting SSNs to a public bucket is a severe privacy breach."}


def _ok(data):
    return {"status": "ok", "ok": True, "level": 33, "name": "ethicist", "elapsed_ms": 4, "origin": "model",
            "data": data, "model": "gpt-5.6-sol", "receipt_id": "rcpt-eth", "provider_invoked": True, "attempts": 1}


def _unavailable(status="model_unavailable"):
    return {"status": status, "ok": False, "level": 33, "name": "ethicist", "elapsed_ms": 2,
            "origin": "model_unavailable", "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL, "error": "down"}


@asynccontextmanager
async def _conscious_stub(*_a, **_k):
    yield SimpleNamespace(set_result=lambda _r: None)


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(ethicist, "_HEALTH", LevelCallHealth("ethicist"))
    monkeypatch.setattr(ethicist, "conscious_action", _conscious_stub)
    monkeypatch.setattr(ethicist, "_broadcast_ethical_alert", lambda *_a, **_k: None)
    monkeypatch.setattr(ethicist, "ethicist_state", {
        "evaluations": 0, "reviews": 0, "approvals": 0, "cautions": 0, "rejections": 0,
        "last_evaluation_ts": None,
    })


def _install(monkeypatch, results):
    calls = []
    seq = iter(results)

    async def fake(**kwargs):
        calls.append(kwargs)
        return next(seq)

    monkeypatch.setattr(level_model, "level_model_json", fake)
    return calls


def test_no_tinyllama_pin_and_no_http_self_call():
    source = inspect.getsource(ethicist)
    assert "tinyllama" not in source
    assert "/oracle/chat" not in source


def test_scoring_is_deterministic_from_criteria():
    assert ethicist.score_dimension("privacy", []) == 1
    assert ethicist.score_dimension("privacy", list(ethicist.DIMENSION_CRITERIA["privacy"])) == 10
    assert ethicist.score_dimension("privacy", ["sensitive_data_category"]) == 1 + round(9 * 3 / 10)
    assert ethicist.compute_risk({d: 1 for d in ethicist.DIMENSION_WEIGHTS}) == 0.0
    # a single severe dimension is not diluted by the weighted mean
    assert ethicist.compute_risk({"safety": 10}) == 1.0
    assert ethicist.recommendation_for(0.3) == "APPROVE"
    assert ethicist.recommendation_for(0.31) == "CAUTION"
    assert ethicist.recommendation_for(0.61) == "REJECT"


def test_model_numbers_are_not_accepted():
    data = _ssn_export()
    data["risk_score"] = 0.0
    with pytest.raises(ValidationError):
        ethicist.EthicsEvaluationOut.model_validate(data)
    unknown = _ssn_export()
    unknown["dimensions"]["privacy"]["flags"][0]["criterion"] = "made_up"
    with pytest.raises(ValidationError):
        ethicist.EthicsEvaluationOut.model_validate(unknown)
    scored = _ssn_export()
    scored["dimensions"]["safety"]["score"] = 1
    with pytest.raises(ValidationError):
        ethicist.EthicsEvaluationOut.model_validate(scored)


def test_evaluate_happy_path_recomputes_scores(monkeypatch):
    calls = _install(monkeypatch, [_ok(_ssn_export())])
    out = _run(ethicist.evaluate_action(ethicist.EvaluateRequest(
        action="Export all patient SSNs to a public S3 bucket", context="billing migration"), None))
    assert out["success"] is True and out["origin"] == "model" and out["receipt_id"] == "rcpt-eth"
    ev = out["evaluation"]
    assert ev["dimensions"]["privacy"]["score"] == 1 + round(9 * 9 / 10)
    scores = {k: v["score"] for k, v in ev["dimensions"].items()}
    assert ev["risk_score"] == ethicist.compute_risk(scores)
    assert ev["recommendation"] == "REJECT"
    assert ev["scoring"]["method"] == "server_recomputed_from_model_selected_criteria"
    assert calls[0]["schema"] is ethicist.EthicsEvaluationOut
    assert calls[0]["principal_scope_key"] != "internal-system"
    assert ethicist.ethicist_state["rejections"] == 1


def test_benign_action_is_approved(monkeypatch):
    _install(monkeypatch, [_ok({"dimensions": _empty_dims(), "concerns": [], "mitigations": [],
                                "summary": "A thank-you note is harmless."})])
    out = _run(ethicist.evaluate_action(ethicist.EvaluateRequest(action="Send a thank-you note to a client"), None))
    assert out["evaluation"]["recommendation"] == "APPROVE" and out["evaluation"]["risk_score"] == 0.0


def test_evaluate_unavailable_returns_no_scores(monkeypatch):
    _install(monkeypatch, [_unavailable("invalid_output")])
    out = _run(ethicist.evaluate_action(ethicist.EvaluateRequest(action="wipe the production DB"), None))
    assert out["success"] is False and out["mode"] == "fallback_unavailable"
    assert out["fallback"] == "manual_review_required"
    assert "evaluation" not in out and "dimensions" not in str(out)
    assert ethicist.ethicist_state["evaluations"] == 0


@pytest.mark.parametrize("kwargs", [
    {"context": "missing action"},
    {"action": "   "},
    {"action": "x", "severity": {"nested": 1}},
    {"action": "a" * 4001},
])
def test_evaluate_request_validation(kwargs):
    with pytest.raises(ValidationError):
        ethicist.EvaluateRequest(**kwargs)


def test_review_happy_and_unavailable(monkeypatch):
    review = {"issues": [{"severity": "high", "category": "privacy", "description": "Logs SSNs in plaintext.",
                          "location": 'logger.info(f"user ssn={ssn}")', "recommendation": "Do not log SSNs."}],
              "summary": "PII logged."}
    _install(monkeypatch, [_ok(review), _unavailable()])
    good = _run(ethicist.review_content(ethicist.ReviewRequest(content='logger.info(f"user ssn={ssn}")'), None))
    assert good["success"] is True and good["review"]["issue_count"] == 1
    assert good["review"]["max_severity"] == "high"
    bad = _run(ethicist.review_content(ethicist.ReviewRequest(content="x = 1"), None))
    assert bad["success"] is False and "review" not in bad


def test_status_is_measured(monkeypatch):
    _install(monkeypatch, [_unavailable()])
    assert _run(ethicist.ethicist_status())["data"]["status"] == "idle"
    _run(ethicist.evaluate_action(ethicist.EvaluateRequest(action="x"), None))
    data = _run(ethicist.ethicist_status())["data"]
    assert data["status"] == "degraded" and data["model_lane"]["model_failures"] == 1


def test_guidelines_publish_weights_summing_to_one():
    data = _run(ethicist.get_guidelines())["data"]
    assert abs(sum(d["weight"] for d in data["dimensions"]) - 1.0) < 1e-9
    assert set(data["criteria"]) == set(ethicist.DIMENSION_WEIGHTS)


def test_legacy_governance_module_never_approves_without_model(monkeypatch, tmp_path):
    from cortex_server.modules import ethicist as legacy

    e = legacy.Ethicist()
    e.ethics_path = tmp_path
    e.concerns_log = tmp_path / "concerns.jsonl"
    calls = []
    monkeypatch.setattr(level_model, "level_model_call_sync",
                        lambda **kw: calls.append(kw) or _unavailable())
    destructive = e.evaluate("delete_all_records", {"table": "users"})
    assert destructive["verdict"] == "BLOCKED" and destructive["can_proceed"] is False and calls == []
    unavailable = e.evaluate("self_modification", {"target": "x"})
    assert unavailable["verdict"] == "UNAVAILABLE" and unavailable["can_proceed"] is False
    monkeypatch.setattr(level_model, "level_model_call_sync",
                        lambda **kw: _ok({"dimensions": _empty_dims(), "concerns": [], "mitigations": [],
                                          "summary": "fine"}))
    approved = e.evaluate("self_modification", {"target": "docs"})
    assert approved["verdict"] == "APPROVED" and approved["can_proceed"] is True and approved["mode"] == "model"


def test_adapter_contract_and_run(monkeypatch):
    from cortex_server.modules.level_adapters import ethicist as adapter

    assert (adapter.LEVEL, adapter.NAME, adapter.NEEDS_MODEL, adapter.SAFE_AUTORUN) == (33, "ethicist", True, True)
    calls = _install(monkeypatch, [_ok(_ssn_export()), _unavailable("timeout")])
    out = _run(adapter.run("Export all patient SSNs to a public bucket",
                           {"principal_scope_key": "p:1", "candidate_action": "export SSNs publicly"}))
    assert out["operation"] == "ethicist.evaluate" and out["data"]["recommendation"] == "REJECT"
    assert len(out["summary"]) <= 1500
    assert "export SSNs publicly" in calls[0]["prompt"]
    with pytest.raises(ExecutionBlocked) as blocked:
        _run(adapter.run("again", {"principal_scope_key": "p:1"}))
    assert blocked.value.reason == "provider_timeout"
