"""L29 Muse repair: model-backed creative output, honest failure, no canned text."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.modules import level_model
from cortex_server.modules import muse as muse_core
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import muse as muse_adapter
from cortex_server.routers import muse


def _run(coro):
    return asyncio.run(coro)


def _ok(data):
    return {"status": "ok", "ok": True, "origin": "model", "data": data, "model": "gpt-5.6-sol (test)",
            "receipt_id": "rcpt-muse", "provider_invoked": True, "attempts": 1, "elapsed_ms": 5}


def _fail(status):
    return {"status": status, "ok": False, "origin": "model_unavailable", "elapsed_ms": 5}


ITEM = {"idea": "Two-way SMS confirmation 48h before each appointment", "why_it_works": "Patients reschedule instead of no-showing"}


def test_inspire_happy_path(monkeypatch):
    seen = {}

    async def fake(**kwargs):
        seen.update(kwargs)
        return _ok({"title": "Stone Arch, October", "content": "Maple light pours over the Stone Arch Bridge..."})

    monkeypatch.setattr(level_model, "level_model_json", fake)
    result = _run(muse.inspire(muse.InspireRequest(topic="autumn in Minneapolis", style="poem")))

    assert result.success is True
    assert result.content.startswith("Maple light")
    assert result.title == "Stone Arch, October"
    assert result.origin == "model" and result.receipt_id == "rcpt-muse"
    assert seen["schema"] is muse_core.InspireEnvelope
    assert "autumn in Minneapolis" in seen["prompt"]
    assert seen["principal_scope_key"].startswith("admin:level.muse")


def test_brainstorm_happy_path_exact_counts(monkeypatch):
    async def fake(**kwargs):
        assert kwargs["schema"] is muse_core.BrainstormEnvelope
        return _ok({"conventional": [ITEM] * 5, "unconventional": [ITEM] * 3, "moonshot": ITEM})

    monkeypatch.setattr(level_model, "level_model_json", fake)
    result = _run(muse.brainstorm(muse.BrainstormRequest(problem="Reduce no-show rate for a solo PMHNP practice")))
    assert result.success is True
    assert len(result.conventional) == 5 and len(result.unconventional) == 3
    assert result.moonshot["idea"]


@pytest.mark.parametrize("status", ["model_unavailable", "timeout", "invalid_output", "model_unverified"])
def test_failures_return_no_creative_content(monkeypatch, status):
    async def fake(**_kwargs):
        return _fail(status)

    monkeypatch.setattr(level_model, "level_model_json", fake)
    inspired = _run(muse.inspire(muse.InspireRequest(topic="autumn", style="story")))
    storm = _run(muse.brainstorm(muse.BrainstormRequest(problem="no-shows")))

    assert inspired.success is False and inspired.content == "" and inspired.error == status
    assert inspired.origin == "model_unavailable"
    assert storm.success is False and storm.conventional == [] and storm.unconventional == []
    assert storm.moonshot is None and storm.error == status
    assert "[L29 Muse]" not in inspired.model_dump_json() + storm.model_dump_json()


def test_brainstorm_schema_requires_exact_counts():
    with pytest.raises(Exception):
        muse_core.BrainstormEnvelope.model_validate({"conventional": [ITEM] * 4, "unconventional": [ITEM] * 3, "moonshot": ITEM})
    with pytest.raises(Exception):
        muse_core.InspireEnvelope.model_validate({"content": ""})


def test_principal_scope_is_used_when_authenticated(monkeypatch):
    seen = {}

    async def fake(**kwargs):
        seen.update(kwargs)
        return _fail("model_unavailable")

    monkeypatch.setattr(level_model, "level_model_json", fake)
    principal = SimpleNamespace(role="principal", credential_id="p1", tenant_id="t", workspace_id="w",
                                agent_id="a", user_id="u", channel_id="c", session_id="s")
    request = SimpleNamespace(state=SimpleNamespace(cortex_principal=principal))
    _run(muse.inspire(muse.InspireRequest(topic="x"), request))
    assert seen["principal_scope_key"].startswith("principal:")


def test_malformed_requests_are_rejected():
    app = FastAPI()
    app.include_router(muse.router, prefix="/muse")
    client = TestClient(app)
    assert client.post("/muse/inspire", json={"topic": "x", "style": "limerick"}).status_code == 422
    assert client.post("/muse/inspire", json={"topic": ""}).status_code == 422
    assert client.post("/muse/inspire", json={"topic": "x" * 501}).status_code == 422
    assert client.post("/muse/brainstorm", json={"problem": "x" * 1201}).status_code == 422


def test_status_is_measured_not_hard_coded(monkeypatch):
    muse_core.OUTCOMES.reset()
    monkeypatch.setattr("cortex_server.routers.muse.model_lane_readiness",
                        lambda: {"executable_available": False, "check": "path_lookup_only"})
    assert _run(muse.muse_status())["status"] == "unavailable"


def test_adapter_contract(monkeypatch):
    assert muse_adapter.LEVEL == 29 and muse_adapter.NAME == "muse"
    assert muse_adapter.NEEDS_MODEL is True and muse_adapter.SAFE_AUTORUN is True

    async def fake(**kwargs):
        return _ok({"conventional": [ITEM] * 5, "unconventional": [ITEM] * 3, "moonshot": ITEM})

    monkeypatch.setattr(level_model, "level_model_json", fake)
    out = _run(muse_adapter.run("Give me ideas to cut no-shows", {"principal_scope_key": "principal:abc"}))
    assert out["operation"] == "muse.brainstorm" and out["origin"] == "model"
    assert len(out["data"]["items"]) == 9 and out["receipt_id"] == "rcpt-muse"
    assert len(out["summary"]) <= 1500
    json.dumps(out)

    async def down(**_kwargs):
        return _fail("timeout")

    monkeypatch.setattr(level_model, "level_model_json", down)
    with pytest.raises(ExecutionBlocked) as exc:
        _run(muse_adapter.run("write a poem about rain", {"principal_scope_key": "principal:abc"}))
    assert exc.value.reason == "timeout"
    with pytest.raises(ExecutionBlocked):
        _run(muse_adapter.run("ideas", {}))
    assert muse_adapter.select_mode("write a short story about a lighthouse") == ("inspire", "story")


def test_legacy_stub_class_no_longer_returns_templates():
    with pytest.raises(NotImplementedError):
        muse_core.Muse().inspire("x")
