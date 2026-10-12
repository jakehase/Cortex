"""L31 Mediator repair: model-backed, principal-scoped, no canned release fallback."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from cortex_server.modules import level_model
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_call_health import LevelCallHealth
from cortex_server.routers import mediator


def _run(coro):
    return asyncio.run(coro)


def _mediation():
    return {
        "common_ground": [{"area": "Kids' wellbeing", "explanation": "Both want the children settled."}],
        "core_differences": [{
            "issue": "Schedule shape",
            "position_a_view": "Wants every weekend because of weekday work.",
            "position_b_view": "Wants alternating weeks for the kids' stability.",
        }],
        "compromise_proposals": [{
            "proposal": "Alternating weeks plus two extra weekend days per month for parent A.",
            "fairness_rating": "high",
            "rationale": "Keeps stability while giving A weekend time.",
        }],
        "recommended_resolution": "Trial alternating weeks with extra weekend days for three months, then review.",
    }


def _ok(data):
    return {"status": "ok", "ok": True, "level": 31, "name": "mediator", "elapsed_ms": 7, "origin": "model",
            "data": data, "model": "gpt-5.6-sol", "receipt_id": "rcpt-med", "provider_invoked": True, "attempts": 1}


def _unavailable(status="model_unavailable"):
    return {"status": status, "ok": False, "level": 31, "name": "mediator", "elapsed_ms": 2,
            "origin": "model_unavailable", "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL, "error": "down"}


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(mediator, "_HEALTH", LevelCallHealth("mediator"))
    monkeypatch.setattr(mediator, "_mediations_count", 0)


def _install(monkeypatch, results):
    calls = []
    seq = iter(results)

    async def fake(**kwargs):
        calls.append(kwargs)
        return next(seq)

    monkeypatch.setattr(level_model, "level_model_json", fake)
    return calls


_CUSTODY = dict(
    position_a="I want the kids every weekend because I work weekdays",
    position_b="I want alternating weeks so the kids have stability",
    context="co-parenting schedule",
)


def test_mediate_happy_path(monkeypatch):
    calls = _install(monkeypatch, [_ok(_mediation())])
    out = _run(mediator.mediate(mediator.MediateRequest(**_CUSTODY), None))
    assert out.success is True and out.origin == "model" and out.receipt_id == "rcpt-med"
    assert out.degraded is False and out.provider_invoked is True
    assert out.recommended_resolution.startswith("Trial alternating weeks")
    assert out.grounding["rows_grounded_a"] == 1 and out.grounding["rows_grounded_b"] == 1
    assert calls[0]["schema"] is mediator.MediationOut
    assert "co-parenting" in calls[0]["prompt"]
    assert mediator._mediations_count == 1


def test_mediate_uses_caller_principal_scope_never_internal_system(monkeypatch):
    calls = _install(monkeypatch, [_ok(_mediation()), _ok(_mediation())])

    class Principal:
        def isolation_key(self, namespace):
            return f"principal-7:{namespace}"

    req = SimpleNamespace(state=SimpleNamespace(authenticated_memory_principal=Principal()))
    _run(mediator.mediate(mediator.MediateRequest(**_CUSTODY), req))
    _run(mediator.mediate(mediator.MediateRequest(**_CUSTODY), None))
    assert calls[0]["principal_scope_key"] == "principal-7:level.mediator.v1"
    assert calls[1]["principal_scope_key"] == "admin:level.mediator"
    assert all(c["principal_scope_key"] != "internal-system" for c in calls)


def test_mediate_model_unavailable_has_no_canned_content(monkeypatch):
    _install(monkeypatch, [_unavailable("timeout")])
    out = _run(mediator.mediate(mediator.MediateRequest(**_CUSTODY), None))
    assert out.success is False and out.origin == "model_unavailable"
    assert out.common_ground == [] and out.core_differences == [] and out.compromise_proposals == []
    assert out.recommended_resolution == ""
    assert out.fallback["kind"] == "structure_only"
    text = out.model_dump_json().lower()
    for word in ("release", "rollout", "rollback", "ship"):
        assert word not in text
    assert mediator._mediations_count == 0


def test_empty_provider_object_fails_schema():
    with pytest.raises(ValidationError):
        mediator.MediationOut.model_validate({})
    bad = _mediation()
    bad["compromise_proposals"][0]["fairness_rating"] = "excellent"
    with pytest.raises(ValidationError):
        mediator.MediationOut.model_validate(bad)


def test_invalid_output_is_reported_not_repaired_with_templates(monkeypatch):
    _install(monkeypatch, [_unavailable("invalid_output")])
    out = _run(mediator.mediate(mediator.MediateRequest(position_a="ship now", position_b="wait for tests"), None))
    assert out.success is False and out.status == "invalid_output"
    assert out.compromise_proposals == []


@pytest.mark.parametrize("kwargs", [
    dict(position_a="", position_b="x"),
    dict(position_a="x", position_b="   "),
    dict(position_a="a" * 3001, position_b="x"),
    dict(position_a="x", position_b="y", context="c" * 5001),
])
def test_mediate_validation(monkeypatch, kwargs):
    _install(monkeypatch, [])
    with pytest.raises(HTTPException) as exc:
        _run(mediator.mediate(mediator.MediateRequest(**kwargs), None))
    assert exc.value.status_code == 400


def test_resolve_happy_and_unavailable(monkeypatch):
    strategies = {"strategies": [
        {"order": 2, "name": "Usage-based split", "approach": "Split by metered usage.", "pros": ["fair"],
         "cons": ["needs meter"], "best_when": "usage differs a lot"},
        {"order": 1, "name": "Flat surcharge", "approach": "Home worker pays a fixed extra.", "pros": ["simple"],
         "cons": ["approximate"], "best_when": "both want simplicity"},
    ]}
    _install(monkeypatch, [_ok(strategies), _unavailable()])
    good = _run(mediator.resolve(mediator.ResolveRequest(conflict="Roommates disagree on utility bills"), None))
    assert good.success is True and [s["order"] for s in good.strategies] == [1, 2]
    bad = _run(mediator.resolve(mediator.ResolveRequest(conflict="Roommates disagree on utility bills"), None))
    assert bad.success is False and bad.strategies == []
    with pytest.raises(HTTPException):
        _run(mediator.resolve(mediator.ResolveRequest(conflict="   "), None))


def test_status_is_measured(monkeypatch):
    _install(monkeypatch, [_unavailable()])
    assert _run(mediator.mediator_status())["status"] == "idle"
    _run(mediator.mediate(mediator.MediateRequest(**_CUSTODY), None))
    status = _run(mediator.mediator_status())
    assert status["status"] == "degraded" and status["mediations_count"] == 0
    assert status["allow_degraded_fallback"] is False


def test_legacy_module_delegates(monkeypatch):
    from cortex_server.modules.mediator import Mediator

    _install(monkeypatch, [_ok(_mediation())])
    out = _run(Mediator().mediate([_CUSTODY["position_a"], _CUSTODY["position_b"]], "custody",
                                  principal_scope_key="p:1"))
    assert out["success"] is True
    with pytest.raises(ValueError):
        _run(Mediator().mediate(["only one"], "x", principal_scope_key="p:1"))


def test_adapter_contract_applicable_and_not(monkeypatch):
    from cortex_server.modules.level_adapters import mediator as adapter

    assert (adapter.LEVEL, adapter.NAME, adapter.NEEDS_MODEL, adapter.SAFE_AUTORUN) == (31, "mediator", True, True)
    applicable = {
        "applicable": True,
        "parties": [{"party": "Me", "position": "every weekend"}, {"party": "Ex", "position": "alternating weeks"}],
        "common_ground": [{"area": "Kids", "explanation": "Both want stability."}],
        "core_differences": [{"issue": "Schedule", "views": [{"party": "Me", "view": "weekends"},
                                                              {"party": "Ex", "view": "weeks"}]}],
        "compromise_proposals": [{"proposal": "Alternating weeks plus extra weekends", "fairness_rating": "high",
                                  "rationale": "balances both"}],
        "recommended_resolution": "Trial the hybrid for three months.",
    }
    _install(monkeypatch, [_ok(applicable), _ok({"applicable": False}), _unavailable()])
    out = _run(adapter.run("My ex and I disagree about the custody schedule", {"principal_scope_key": "p:1"}))
    assert out["operation"] == "mediator.mediate" and out["data"]["applicable"] is True
    assert len(out["summary"]) <= 1500
    na = _run(adapter.run("What's the weather?", {"principal_scope_key": "p:1"}))
    assert na["data"] == {"applicable": False}
    with pytest.raises(ExecutionBlocked):
        _run(adapter.run("again", {"principal_scope_key": "p:1"}))
    with pytest.raises(ValidationError):
        mediator.MessageMediationOut.model_validate({"applicable": True, "parties": []})
