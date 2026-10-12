"""L18 Diplomat repair: draft-only model path, held delivery that does not burn
the action nonce, and a status that does not claim send/broadcast."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from cortex_server.modules import level_model
from cortex_server.modules.action_capabilities import require_action_capability
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import diplomat as diplomat_adapter
from cortex_server.routers import diplomat


def _run(coro):
    return asyncio.run(coro)


def _draft():
    return {
        "subject": "Annual renewal",
        "draft_message": "Hi [Name], we'd like to renew annually and are hoping for a 10% discount...",
        "tone": "warm, firm",
        "key_points": ["multi-year commitment"],
        "negotiation_position": {"anchor": "15% off", "target": "10% off", "walk_away": "5% off",
                                 "concessions": ["2-year term"]},
        "risks": ["Vendor may push back on timing"],
        "alternatives": [],
        "follow_up": "Follow up in 3 business days",
    }


def _ok(data):
    return {"status": "ok", "ok": True, "level": 18, "name": "diplomat", "elapsed_ms": 4, "origin": "model",
            "data": data, "model": "gpt-5.6-sol", "receipt_id": "rcpt-dip", "provider_invoked": True, "attempts": 1}


def _unavailable():
    return {"status": "model_unavailable", "ok": False, "level": 18, "name": "diplomat", "elapsed_ms": 2,
            "origin": "model_unavailable", "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL, "error": "down"}


@pytest.fixture(autouse=True)
def _no_egress(monkeypatch):
    async def no_outbound(*_a, **_k):
        raise AssertionError("diplomat must not perform egress")

    monkeypatch.setattr(diplomat, "outbound_request", no_outbound)


def _model(monkeypatch, result):
    calls = []

    async def fake(**kwargs):
        calls.append(kwargs)
        return result

    monkeypatch.setattr(level_model, "level_model_json", fake)
    return calls


def test_draft_happy_path_never_sends(monkeypatch):
    calls = _model(monkeypatch, _ok(_draft()))
    out = _run(diplomat.diplomat_draft(diplomat.DraftRequest(
        goal="get a 10% discount on annual renewal", counterparty="SaaS vendor AE", channel="email",
        negotiation=True), SimpleNamespace(state=SimpleNamespace())))
    assert out["success"] is True and out["sent"] is False and out["requires_user_to_send"] is True
    assert out["receipt_id"] == "rcpt-dip"
    assert out["draft"]["negotiation_position"]["walk_away"] == "5% off"
    assert "Counterparty: SaaS vendor AE" in calls[0]["prompt"]
    assert calls[0]["schema"] is diplomat.DraftOut


def test_draft_without_negotiation_drops_position(monkeypatch):
    _model(monkeypatch, _ok(_draft()))
    out = _run(diplomat.diplomat_draft(diplomat.DraftRequest(goal="thank the team"), None))
    assert out["draft"]["negotiation_position"] is None


def test_draft_model_unavailable_has_no_canned_text(monkeypatch):
    _model(monkeypatch, _unavailable())
    out = _run(diplomat.diplomat_draft(diplomat.DraftRequest(goal="ask for an extension"), None))
    assert out["success"] is False and out["draft"] is None and out["sent"] is False
    assert out["origin"] == "model_unavailable"


def test_draft_rejects_malformed_input():
    with pytest.raises(ValidationError):
        diplomat.DraftRequest(goal="")
    with pytest.raises(ValidationError):
        diplomat.DraftRequest(goal="x", channel="carrier-pigeon")


def test_held_delivery_refuses_before_the_action_capability():
    with pytest.raises(HTTPException) as held:
        _run(diplomat._require_delivery_enabled())
    assert held.value.status_code == 503
    assert held.value.detail["action_capability_consumed"] is False
    for path in ("/send", "/broadcast"):
        route = next(r for r in diplomat.router.routes if getattr(r, "path", None) == path)
        dependant = getattr(route, "dependant", None)
        if dependant is None:  # lightweight router stand-ins in some environments
            continue
        calls = [d.call for d in dependant.dependencies]
        assert calls.index(diplomat._require_delivery_enabled) < calls.index(require_action_capability)


def test_deliver_stays_fail_closed():
    with pytest.raises(HTTPException) as held:
        _run(diplomat._deliver("https://hooks.example/x", "hi", "POST", None, 5, object()))
    assert held.value.status_code == 503


def test_status_never_claims_send_while_held():
    request = SimpleNamespace(app=SimpleNamespace(routes=[
        SimpleNamespace(path="/diplomat/status", methods={"GET"}),
        SimpleNamespace(path="/diplomat/draft", methods={"POST"}),
    ]))
    status = _run(diplomat.diplomat_status(request))["data"]
    assert status["capabilities"] == ["draft"]
    assert "send" not in status["capabilities"] and "broadcast" not in status["capabilities"]
    assert status["status"] == "draft_only" and status["delivery"]["enabled"] is False


def test_adapter_contract(monkeypatch):
    with pytest.raises(ExecutionBlocked) as no_intent:
        _run(diplomat_adapter.run("what is the capital of France?", {"principal_scope_key": "p:1"}))
    assert no_intent.value.reason == "no_outbound_message_intent"

    _model(monkeypatch, _ok(_draft()))
    out = _run(diplomat_adapter.run("Draft an email to my SaaS vendor negotiating a 10% discount",
                                    {"principal_scope_key": "p:1"}))
    assert out["operation"] == "diplomat.draft" and out["origin"] == "model"
    assert out["data"]["sent"] is False and out["data"]["channel"] == "email"
    assert "NOT sent" in out["summary"]
    json.dumps(out)

    _model(monkeypatch, _unavailable())
    with pytest.raises(ExecutionBlocked):
        _run(diplomat_adapter.run("write a reply to my landlord", {"principal_scope_key": "p:1"}))
