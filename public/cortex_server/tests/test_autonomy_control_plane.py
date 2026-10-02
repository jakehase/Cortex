import importlib
import json
import time
from types import SimpleNamespace

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from cortex_server.modules.action_capabilities import action_capability_headers


_ACTION_SECRET = "autonomy-control-action-secret-000000000001"


def _authorized_json(client, principal, method, path, payload, *, nonce):
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    issued_at = int(time.time())
    return client.request(
        method,
        path,
        content=body,
        headers={
            "content-type": "application/json",
            **action_capability_headers(
                secret=_ACTION_SECRET,
                principal=principal,
                method=method,
                path=path,
                body=body,
                nonce=nonce,
                issued_at=issued_at,
                expires_at=issued_at + 60,
            ),
        },
    )


def _client(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_AUTONOMY_STATE_PATH", str(tmp_path / "autonomy_state.json"))
    monkeypatch.setenv("CORTEX_DECISION_LOG_PATH", str(tmp_path / "decisions.jsonl"))
    monkeypatch.setenv("CORTEX_EVENT_LEDGER_PATH", str(tmp_path / "event_ledger.jsonl"))

    import cortex_server.middleware.event_ledger_middleware as event_ledger
    import cortex_server.middleware.hud_middleware as hud
    import cortex_server.routers.autonomy as autonomy

    importlib.reload(event_ledger)
    importlib.reload(autonomy)

    app = FastAPI()
    principal = SimpleNamespace(
        role="principal",
        credential_id="autonomy-control-test",
        tenant_id="tenant-autonomy",
        workspace_id="workspace-autonomy",
        agent_id="agent-autonomy",
        user_id="user-autonomy",
        channel_id="test",
        session_id="session-autonomy",
    )
    app.state.action_capability_credentials = {
        principal.credential_id: _ACTION_SECRET,
    }
    app.state.action_capability_policies = {
        principal.credential_id: (
            "PUT:/autonomy/objectives",
            "POST:/autonomy/decision",
            "POST:/autonomy/reflection/nightly",
            "POST:/autonomy/adaptation/weekly",
        ),
    }
    app.state.action_capability_db_path = str(tmp_path / "action-capabilities.sqlite3")
    app.state.external_action_kill_switch = False
    app.add_middleware(event_ledger.EventLedgerMiddleware)
    app.add_middleware(hud.HUDMiddleware)

    @app.middleware("http")
    async def authenticated_principal(request: Request, call_next):
        request.state.cortex_principal = principal
        return await call_next(request)

    @app.get("/health")
    async def health():
        return {"status": "healthy"}

    app.include_router(autonomy.router, prefix="/autonomy")
    return TestClient(app), principal


def test_objectives_roundtrip(monkeypatch, tmp_path):
    client, principal = _client(monkeypatch, tmp_path)

    r = _authorized_json(
        client,
        principal,
        "PUT",
        "/autonomy/objectives",
        {
            "mission": "Build a cohesive autonomous brain.",
            "weekly_goals": ["reduce incidents", "reduce incidents", "stability first"],
            "constraints": ["human oversight", "reversible changes"],
        },
        nonce="autonomy_objectives_0001",
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["objectives"]["mission"] == "Build a cohesive autonomous brain."
    assert body["objectives"]["weekly_goals"] == ["reduce incidents", "stability first"]

    g = client.get("/autonomy/objectives")
    assert g.status_code == 200
    assert g.json()["objectives"]["mission"] == "Build a cohesive autonomous brain."


def test_decision_reflection_and_adaptation(monkeypatch, tmp_path):
    client, principal = _client(monkeypatch, tmp_path)

    # Generate a few events for the nervous system ledger.
    for _ in range(3):
        hr = client.get("/health")
        assert hr.status_code == 200

    d = _authorized_json(
        client,
        principal,
        "POST",
        "/autonomy/decision",
        {
            "title": "Stability-first rollout",
            "decision": "Use staged deployment with rollback",
            "rationale": "Lower blast radius and preserve uptime",
            "tags": ["stability", "deploy"],
            "persist_to_l22": False,
        },
        nonce="autonomy_decision_000001",
    )
    assert d.status_code == 200
    assert d.json()["success"] is True

    nightly = _authorized_json(
        client,
        principal,
        "POST",
        "/autonomy/reflection/nightly",
        {"window_hours": 1, "persist_to_l22": False},
        nonce="autonomy_reflection_0001",
    )
    assert nightly.status_code == 200
    nightly_body = nightly.json()
    assert nightly_body["success"] is True
    assert "summary" in nightly_body["reflection"]

    weekly = _authorized_json(
        client,
        principal,
        "POST",
        "/autonomy/adaptation/weekly",
        {"window_days": 1, "persist_to_l22": False},
        nonce="autonomy_adaptation_0001",
    )
    assert weekly.status_code == 200
    weekly_body = weekly.json()
    assert weekly_body["success"] is True
    assert isinstance(weekly_body["adaptation"]["proposals"], list)
    assert len(weekly_body["adaptation"]["proposals"]) >= 1
