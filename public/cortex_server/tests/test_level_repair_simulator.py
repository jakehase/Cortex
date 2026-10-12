"""L20 Simulator repair: model-backed, bounded input, honest status."""

import asyncio
import copy

import pytest
from pydantic import ValidationError

from cortex_server.modules import level_model
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_call_health import LevelCallHealth
from cortex_server.routers import simulator


def _run(coro):
    return asyncio.run(coro)


def _valid_outcomes():
    return [
        {"label": "best_case", "probability": "25%", "key_events": ["pilot succeeds"],
         "timeline": "one month", "impact_assessment": "positive"},
        {"label": "most_likely", "probability": "50%", "key_events": ["pilot is mixed"],
         "timeline": "two months", "impact_assessment": "neutral"},
        {"label": "worst_case", "probability": "25%", "key_events": ["pilot is rolled back"],
         "timeline": "one week", "impact_assessment": "negative"},
    ]


def _model_data():
    return {
        "outcomes": [
            {"label": "worst_case", "probability": "20%", "key_events": ["8% of SMBs churn", "support overload"],
             "timeline": "months 1-2", "impact_assessment": "Revenue flat after churn.",
             "leading_indicators": ["cancellation tickets spike"]},
            {"label": "best_case", "probability": "25%", "key_events": ["churn under 2%", "ARPU +13%"],
             "timeline": "month 1", "impact_assessment": "Revenue up ~13%.",
             "leading_indicators": ["renewals unchanged"]},
            {"label": "most_likely", "probability": "55%", "key_events": ["4% churn", "some downgrades"],
             "timeline": "months 1-3", "impact_assessment": "Revenue up ~9%.",
             "leading_indicators": ["downgrade requests"]},
        ],
        "assumptions": ["No competitor price cut", "Price change announced 30 days ahead"],
        "key_uncertainties": ["Price elasticity of the SMB segment"],
    }


def _ok(data):
    return {"status": "ok", "ok": True, "level": 20, "name": "simulator", "elapsed_ms": 9, "origin": "model",
            "data": data, "model": "gpt-5.6-sol", "receipt_id": "rcpt-sim", "provider_invoked": True, "attempts": 1}


def _unavailable(status="model_unavailable"):
    return {"status": status, "ok": False, "level": 20, "name": "simulator", "elapsed_ms": 3,
            "origin": "model_unavailable", "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL, "error": "down"}


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(simulator, "_HEALTH", LevelCallHealth("simulator"))
    monkeypatch.setattr(simulator, "_scenarios_history", [])
    monkeypatch.setattr(simulator, "_simulations_run", 0)


def _install(monkeypatch, results):
    calls = []
    seq = iter(results)

    async def fake(**kwargs):
        calls.append(kwargs)
        return next(seq)

    monkeypatch.setattr(level_model, "level_model_json", fake)
    return calls


def test_run_happy_path_returns_model_outcomes_with_receipt(monkeypatch):
    calls = _install(monkeypatch, [_ok(_model_data())])
    out = _run(simulator.run_simulation(
        simulator.SimulatorRequest(scenario="Raise prices 15% for 1,200 SMB customers", time_horizon="6 months"),
        None,
    ))
    assert out.success is True and out.origin == "model" and out.receipt_id == "rcpt-sim"
    assert [o.label for o in out.outcomes] == ["best_case", "most_likely", "worst_case"]
    assert out.assumptions and out.key_uncertainties
    assert out.probability_basis == "model_estimate"
    assert calls[0]["schema"] is simulator.SimulationOut
    assert calls[0]["principal_scope_key"] != "internal-system"
    assert "1,200 SMB" in calls[0]["prompt"]
    assert simulator._simulations_run == 1


def test_scenario_is_truncated_before_prompt_construction(monkeypatch):
    calls = _install(monkeypatch, [_ok(_model_data())])
    out = _run(simulator.run_simulation(simulator.SimulatorRequest(scenario="a" * 10000), None))
    assert out.scenario_truncated is True
    assert len(calls[0]["prompt"]) < 2600


@pytest.mark.parametrize("payload", [
    {"scenario": ""},
    {"scenario": "   "},
    {"scenario": "a" * 10001},
    {"scenario": "x", "mode": "ultra"},
    {"scenario": "x", "risk_tolerance": "yolo"},
    {"scenario": "x", "time_horizon": "y" * 61},
])
def test_malformed_requests_are_rejected(payload):
    with pytest.raises(ValidationError):
        simulator.SimulatorRequest(**payload)


def test_medium_tolerance_alias_is_accepted():
    assert simulator.SimulatorRequest(scenario="x", risk_tolerance="Medium").risk_tolerance == "moderate"


def test_model_unavailable_returns_no_outcomes(monkeypatch):
    _install(monkeypatch, [_unavailable("timeout")])
    out = _run(simulator.run_simulation(simulator.SimulatorRequest(scenario="Our only on-call engineer quits"), None))
    assert out.success is False and out.outcomes == []
    assert out.origin == "model_unavailable" and out.status == "timeout"
    assert simulator._simulations_run == 0 and simulator._scenarios_history == []


def test_model_schema_enforces_labels_and_distribution():
    dup = _model_data()
    dup["outcomes"][0]["label"] = "best_case"
    with pytest.raises(ValidationError):
        simulator.SimulationOut.model_validate(dup)
    bad_sum = copy.deepcopy(_model_data())
    for o in bad_sum["outcomes"]:
        o["probability"] = "50%"
    with pytest.raises(ValidationError):
        simulator.SimulationOut.model_validate(bad_sum)
    missing = copy.deepcopy(_model_data())
    del missing["outcomes"][0]["leading_indicators"]
    with pytest.raises(ValidationError):
        simulator.SimulationOut.model_validate(missing)
    simulator.SimulationOut.model_validate(_model_data())


@pytest.mark.parametrize(
    "outcomes",
    [
        [{**item, "label": "best_case"} for item in _valid_outcomes()],
        [{**item, "probability": "999%" if i == 0 else item["probability"]} for i, item in enumerate(_valid_outcomes())],
        [{**item, "probability": "10%"} for item in _valid_outcomes()],
    ],
)
def test_parse_outcomes_strict_rejects_bad_contracts(outcomes):
    with pytest.raises(ValueError, match="contract violation"):
        simulator._parse_outcomes_strict(outcomes)


def test_parse_outcomes_strict_accepts_valid_distribution():
    parsed = simulator._parse_outcomes_strict(_valid_outcomes())
    assert {item.label for item in parsed} == {"best_case", "most_likely", "worst_case"}


def test_status_is_derived_from_measured_outcomes(monkeypatch):
    _install(monkeypatch, [_unavailable(), _ok(_model_data())])
    assert _run(simulator.simulator_status())["data"]["status"] == "idle"
    _run(simulator.run_simulation(simulator.SimulatorRequest(scenario="x"), None))
    assert _run(simulator.simulator_status())["data"]["status"] == "degraded"
    _run(simulator.run_simulation(simulator.SimulatorRequest(scenario="x"), None))
    data = _run(simulator.simulator_status())["data"]
    assert data["status"] == "active" and data["scenarios_run"] == 1


def test_legacy_persona_simulator_never_invents_a_score(monkeypatch):
    from cortex_server.modules import simulator as legacy

    monkeypatch.setattr(level_model, "level_model_call_sync", lambda **kw: _unavailable())
    result = legacy.TheSimulator().run_scenario("You are terse.", "User asks a technical question")
    assert result["score"] == 0 and result["passed"] is False and result["origin"] == "model_unavailable"

    replies = iter([
        {"ok": True, "status": "ok", "text": "Short answer."},
        {"ok": True, "status": "ok", "text": "Longer answer."},
        {"ok": True, "status": "ok", "data": {"helpfulness": 3, "clarity": 2, "conciseness": 2, "safety": 2,
                                               "rationale": "clear"}, "model": "m", "receipt_id": "r"},
    ])
    monkeypatch.setattr(level_model, "level_model_call_sync", lambda **kw: next(replies))
    good = legacy.TheSimulator().run_scenario("You are terse.", "User asks a technical question")
    assert good["score"] == 9 and good["passed"] is True and "technical question" in good["test_scenario"]


def test_adapter_contract_and_run(monkeypatch):
    from cortex_server.modules.level_adapters import simulator as adapter

    assert (adapter.LEVEL, adapter.NAME, adapter.NEEDS_MODEL, adapter.SAFE_AUTORUN) == (20, "simulator", True, True)
    _install(monkeypatch, [_ok(_model_data()), _unavailable()])
    out = _run(adapter.run("What happens if we raise prices 15%?", {"principal_scope_key": "p:1"}))
    assert out["operation"] == "simulator.run" and out["origin"] == "model"
    assert len(out["summary"]) <= 1500 and len(out["data"]["outcomes"]) == 3
    with pytest.raises(ExecutionBlocked):
        _run(adapter.run("again", {"principal_scope_key": "p:1"}))
    with pytest.raises(ExecutionBlocked):
        _run(adapter.run("x", {}))
