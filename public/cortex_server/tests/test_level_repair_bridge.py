"""L25 Bridge: status honesty, reserved relay keys, honest module, approval-only adapter."""

from __future__ import annotations

import ast
import inspect

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.modules import bridge as bridge_module
from cortex_server.modules.execution_engine import ExecutionBlocked, ExecutionEngine
from cortex_server.modules.level_adapters import bridge as bridge_adapter
from cortex_server.routers import bridge


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(bridge.router, prefix="/bridge")
    return TestClient(app)


@pytest.fixture(autouse=True)
def _default_bridge_config(monkeypatch):
    monkeypatch.setattr(bridge, "BRIDGE_ENABLED", False)
    monkeypatch.setattr(bridge, "BRIDGE_TOKEN", "")
    monkeypatch.setattr(bridge, "BRIDGE_ALLOWLIST", [])
    bridge._connections.clear()
    bridge._relay_events.clear()
    yield
    bridge._connections.clear()
    bridge._relay_events.clear()


def test_disabled_bridge_status_claims_nothing():
    body = _client().get("/bridge/status").json()
    assert body["success"] is False
    assert body["status"] == "disabled"
    assert body["capabilities"] == []
    assert "external_ai_federation" not in body["capabilities"]
    assert body["unavailable_capabilities"]["external_ai_federation"] == "not_implemented"
    health = _client().get("/bridge/health").json()
    assert health["success"] is False and health["status"] == "disabled"


def test_enabled_but_unconfigured_bridge_is_misconfigured(monkeypatch):
    monkeypatch.setattr(bridge, "BRIDGE_ENABLED", True)
    body = _client().get("/bridge/status").json()
    assert body["success"] is False
    assert body["status"] == "misconfigured"
    assert set(body["missing_configuration"]) == {"BRIDGE_TOKEN", "BRIDGE_ALLOWLIST"}
    assert body["capabilities"] == []


def test_configured_bridge_lists_only_real_capabilities(monkeypatch):
    monkeypatch.setattr(bridge, "BRIDGE_ENABLED", True)
    monkeypatch.setattr(bridge, "BRIDGE_TOKEN", "t" * 32)
    monkeypatch.setattr(bridge, "BRIDGE_ALLOWLIST", ["api.example.com"])
    body = _client().get("/bridge/status").json()
    assert body["success"] is True and body["status"] == "active"
    assert "allowlisted_http_json_relay" in body["capabilities"]
    assert "external_ai_federation" not in body["capabilities"]
    assert "multi_agent_communication" not in body["capabilities"]


def test_disabled_relay_is_503():
    response = _client().post("/bridge/relay", json={"connection_id": "x", "query": "hi"})
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_relay_payload_cannot_override_reserved_keys(monkeypatch):
    monkeypatch.setattr(bridge, "BRIDGE_ENABLED", True)
    monkeypatch.setattr(bridge, "BRIDGE_TOKEN", "t" * 32)
    monkeypatch.setattr(bridge, "BRIDGE_ALLOWLIST", ["api.example.com"])
    bridge._connections["mock"] = {"id": "mock", "name": "mock", "url": "https://api.example.com/echo"}
    sent = {}

    class _Response:
        status_code = 200
        text = "{}"

        def json(self):
            return {"ok": True}

    async def fake_request(method, url, *, json=None, **kwargs):
        sent.update(json)
        return _Response()

    monkeypatch.setattr(bridge, "outbound_request", fake_request)
    result = await bridge.relay_query(
        bridge.RelayRequest(
            connection_id="mock",
            query="ping",
            payload={"query": "other", "source": "spoof", "extra": 1},
        ),
        x_bridge_token="t" * 32,
    )
    assert result.success is True
    assert sent == {"extra": 1, "query": "ping", "source": "cortex-bridge-l25"}


def test_module_has_no_fake_delivery_or_filesystem_side_effects(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    instance = bridge_module.Bridge()
    assert instance.status()["status"] == "disabled"
    assert instance.status()["federation"] == "not_implemented"
    with pytest.raises(NotImplementedError):
        instance.send_message("a", "b", {"x": 1})
    with pytest.raises(NotImplementedError):
        instance.register_agent("a", {})
    tree = ast.parse(inspect.getsource(bridge_module))
    identifiers = {node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)}
    identifiers |= {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
    assert "mkdir" not in identifiers and "open" not in identifiers


def test_adapter_contract_attributes():
    assert bridge_adapter.LEVEL == 25
    assert bridge_adapter.NAME == "bridge"
    assert bridge_adapter.SAFE_AUTORUN is False
    assert bridge_adapter.NEEDS_MODEL is False
    assert inspect.iscoroutinefunction(bridge_adapter.run)


@pytest.mark.asyncio
async def test_adapter_always_requires_approval_even_when_configured(monkeypatch):
    monkeypatch.setattr(bridge, "BRIDGE_ENABLED", True)
    monkeypatch.setattr(bridge, "BRIDGE_TOKEN", "t" * 32)
    monkeypatch.setattr(bridge, "BRIDGE_ALLOWLIST", ["api.example.com"])

    async def must_not_send(*args, **kwargs):
        raise AssertionError("bridge adapter must never relay")

    monkeypatch.setattr(bridge, "outbound_request", must_not_send)
    with pytest.raises(ExecutionBlocked) as raised:
        await bridge_adapter.run("send this to the partner AI", {"memory_principal_key": "principal:x"})
    assert raised.value.reason == "approval_required"
    engine = ExecutionEngine({"bridge": bridge_adapter.run})
    out = await engine.execute_stack([{"level": 25, "name": "bridge"}], "relay", context={})
    receipt = out["executionResults"]["bridge"]
    assert receipt["status"] == "blocked" and receipt["reason"] == "approval_required"
