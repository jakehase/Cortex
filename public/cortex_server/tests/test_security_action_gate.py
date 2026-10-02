from __future__ import annotations

import json
import inspect
from types import SimpleNamespace
import time

import httpx
import pytest
from fastapi import Depends, FastAPI, Request

from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    DELEGATED_ACTION_CAPABILITY_HEADER,
    action_capability_headers,
    assert_action_authorized,
    cancel_deferred_action_capability,
    consume_deferred_action_capability,
    deferred_action_owner,
    mint_deferred_action_capability,
    normalize_action_policy_rules,
    require_action_capability,
)


SECRET = "principal-action-secret-0000000000000001"
DELEGATION_SECRET = "deferred-action-secret-00000000000000000001"


def _principal(*, user_id: str = "alice"):
    return SimpleNamespace(
        role="principal",
        credential_id="action-test",
        tenant_id="tenant-a",
        workspace_id="workspace-a",
        agent_id="agent-a",
        user_id=user_id,
        channel_id="channel-a",
        session_id="session-a",
    )


def _admin():
    return SimpleNamespace(
        role="admin",
        credential_id="cortex-admin",
        tenant_id="",
        workspace_id="",
        agent_id="",
        user_id="",
        channel_id="",
        session_id="",
    )


def _app(tmp_path, *, principal=None, policies=None):
    app = FastAPI()
    selected_principal = principal or _principal()
    app.state.action_capability_credentials = {
        "action-test": SECRET,
        "cortex-admin": SECRET,
    }
    app.state.action_capability_policies = (
        {"action-test": ("POST:/act/*",)} if policies is None else policies
    )
    app.state.action_capability_db_path = str(tmp_path / "action-replay.sqlite3")
    app.state.external_action_kill_switch = False
    app.state.authorized = []

    @app.middleware("http")
    async def trusted_principal(request: Request, call_next):
        request.state.cortex_principal = selected_principal
        return await call_next(request)

    @app.post("/act/{target}")
    async def act(
        target: str,
        request: Request,
        authorization: ActionAuthorization = Depends(require_action_capability),
    ):
        assert_action_authorized(authorization)
        app.state.authorized.append((target, await request.json(), authorization))
        return {"ok": True}

    return app, selected_principal


async def _receipt(
    tmp_path,
    *,
    principal=None,
    nonce="nonce_receipt_123456789",
    path="/act/device-a",
    payload=None,
):
    selected_principal = principal or _principal()
    credential_id = selected_principal.credential_id
    app, selected_principal = _app(
        tmp_path,
        principal=selected_principal,
        policies={credential_id: (f"POST:{path}",)},
    )
    if path != "/act/device-a":
        @app.post(path)
        async def capture_custom_receipt(
            authorization: ActionAuthorization = Depends(require_action_capability),
        ):
            app.state.authorized.append((path, payload or {"receipt": True}, authorization))
            return {"ok": True}

    body = _body(payload or {"receipt": True})
    headers = _headers(selected_principal, body, path=path, nonce=nonce)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post(path, content=body, headers=headers)
    assert response.status_code == 200
    return app.state.authorized[-1][2]


def _body(payload) -> bytes:
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def _headers(principal, body: bytes, *, path="/act/device-a", nonce="nonce_1234567890abcdef", now=None):
    issued_at = int(time.time() if now is None else now)
    return action_capability_headers(
        secret=SECRET,
        principal=principal,
        method="POST",
        path=path,
        body=body,
        nonce=nonce,
        issued_at=issued_at,
        expires_at=issued_at + 60,
    )


@pytest.mark.asyncio
async def test_exact_action_capability_is_one_use_and_payload_path_bound(tmp_path):
    app, principal = _app(tmp_path)
    body = _body({"command": "turn_on", "target": "lamp"})
    headers = _headers(principal, body)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        missing = await client.post("/act/device-a", content=body)
        tampered = await client.post(
            "/act/device-a",
            content=_body({"command": "turn_off", "target": "lamp"}),
            headers=headers,
        )
        wrong_path = await client.post("/act/device-b", content=body, headers=headers)
        valid = await client.post("/act/device-a", content=body, headers=headers)
        replay = await client.post("/act/device-a", content=body, headers=headers)

    assert [missing.status_code, tampered.status_code, wrong_path.status_code] == [403, 403, 403]
    assert valid.status_code == 200
    assert replay.status_code == 409
    assert [(target, payload) for target, payload, _auth in app.state.authorized] == [
        ("device-a", {"command": "turn_on", "target": "lamp"})
    ]


@pytest.mark.asyncio
async def test_principal_action_policy_defaults_deny_and_matches_exact_or_prefix(tmp_path):
    body = _body({"command": "turn_on"})

    denied_app, denied_principal = _app(tmp_path / "denied", policies={})
    denied_headers = _headers(denied_principal, body, nonce="nonce_policy_denied_1234")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=denied_app), base_url="http://test"
    ) as client:
        denied = await client.post("/act/device-a", content=body, headers=denied_headers)
    assert denied.status_code == 403
    assert denied_app.state.authorized == []

    exact_app, exact_principal = _app(
        tmp_path / "exact",
        policies={"action-test": ("POST:/act/device-a",)},
    )
    exact_headers = _headers(exact_principal, body, nonce="nonce_policy_exact_12345")
    wrong_headers = _headers(
        exact_principal,
        body,
        path="/act/device-b",
        nonce="nonce_policy_wrong_12345",
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=exact_app), base_url="http://test"
    ) as client:
        exact = await client.post("/act/device-a", content=body, headers=exact_headers)
        wrong = await client.post("/act/device-b", content=body, headers=wrong_headers)
    assert exact.status_code == 200
    assert wrong.status_code == 403

    assert normalize_action_policy_rules(
        ["post:/act/*", "DELETE:/act/device-a"]
    ) == ("DELETE:/act/device-a", "POST:/act/*")
    with pytest.raises(ValueError, match="invalid allowed action rule"):
        normalize_action_policy_rules(["POST:/act/*/nested"])


def test_principal_credential_parser_owns_allowed_action_policy():
    from cortex_server.main import _parse_read_scope_credentials

    scope = {
        "tenant_id": "tenant-a",
        "workspace_id": "workspace-a",
        "agent_id": "agent-a",
        "user_id": "alice",
        "channel_id": "channel-a",
        "session_id": "session-a",
    }
    parsed = _parse_read_scope_credentials(
        json.dumps(
            {
                "action-test": {
                    "secret": SECRET,
                    "allowed_scopes": [scope],
                    "allowed_actions": ["POST:/homeassistant/*", "DELETE:/cron/jobs/*"],
                }
            }
        )
    )
    assert parsed[0].allowed_actions == (
        "DELETE:/cron/jobs/*",
        "POST:/homeassistant/*",
    )
    with pytest.raises(ValueError, match="invalid allowed action rule"):
        _parse_read_scope_credentials(
            json.dumps(
                {
                    "action-test": {
                        "secret": SECRET,
                        "allowed_scopes": [scope],
                        "allowed_actions": ["GET:/homeassistant/states"],
                    }
                }
            )
        )


def test_real_app_requires_principal_policy_and_exact_action_capability(
    monkeypatch, tmp_path
):
    from fastapi.testclient import TestClient

    from cortex_server.main import create_app
    from cortex_server.modules.memory_scope import memory_scope_signature

    scope = {
        "tenant_id": "tenant-a",
        "workspace_id": "workspace-a",
        "agent_id": "agent-a",
        "user_id": "alice",
        "channel_id": "channel-a",
        "session_id": "session-a",
    }
    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "token_required")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "transport-token")
    # This real-app exercise targets a Home Assistant action route. Opt into
    # the unsafe-action router without changing the fail-closed safe-mode default.
    monkeypatch.setenv("CORTEX_SAFE_MODE", "false")
    monkeypatch.setenv("CORTEX_ACTION_CAPABILITY_DB_PATH", str(tmp_path / "actions.sqlite3"))
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps(
            {
                "action-test": {
                    "secret": SECRET,
                    "allowed_scopes": [scope],
                    "allowed_actions": ["POST:/homeassistant/events/*"],
                }
            }
        ),
    )
    app = create_app()
    body = _body({"data": {"value": 1}, "confirm": False})
    principal = _principal()
    principal_headers = {
        "content-type": "application/json",
        "x-cortex-write-token": "transport-token",
        "x-cortex-tenant-id": scope["tenant_id"],
        "x-cortex-workspace-id": scope["workspace_id"],
        "x-cortex-agent-id": scope["agent_id"],
        "x-cortex-user-id": scope["user_id"],
        "x-cortex-channel-id": scope["channel_id"],
        "x-cortex-session-id": scope["session_id"],
        "x-cortex-scope-credential-id": "action-test",
        "x-cortex-scope-signature": memory_scope_signature(
            **scope,
            credential_id="action-test",
            secret=SECRET,
        ),
    }
    with TestClient(app) as client:
        missing = client.post(
            "/homeassistant/events/security_test",
            content=body,
            headers=principal_headers,
        )
        admitted = client.post(
            "/homeassistant/events/security_test",
            content=body,
            headers={
                **principal_headers,
                **_headers(
                    principal,
                    body,
                    path="/homeassistant/events/security_test",
                    nonce="nonce_real_app_123456789",
                ),
            },
        )
    assert missing.status_code == 403
    assert admitted.status_code == 200, admitted.text
    assert admitted.json()["reason"] == "explicit_confirmation_required"


@pytest.mark.asyncio
async def test_sink_rechecks_action_receipt_expiry(monkeypatch, tmp_path):
    from cortex_server.modules import action_capabilities

    receipt = await _receipt(tmp_path)
    monkeypatch.setattr(action_capabilities.time, "time", lambda: receipt.expires_at)
    with pytest.raises(Exception) as expired:
        assert_action_authorized(receipt)
    assert getattr(expired.value, "status_code", None) == 403


@pytest.mark.asyncio
async def test_action_capability_rejects_wrong_principal_expiry_and_kill_switch(tmp_path):
    body = _body({"command": "send", "target": "recipient"})

    wrong_app, wrong_principal = _app(tmp_path / "wrong", principal=_principal(user_id="mallory"))
    alice_headers = _headers(_principal(), body, nonce="nonce_wrongprincipal_1234")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=wrong_app), base_url="http://test") as client:
        wrong = await client.post("/act/device-a", content=body, headers=alice_headers)

    expired_app, expired_principal = _app(tmp_path / "expired")
    expired_headers = _headers(
        expired_principal,
        body,
        nonce="nonce_expired_123456789",
        now=int(time.time()) - 180,
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=expired_app), base_url="http://test") as client:
        expired = await client.post("/act/device-a", content=body, headers=expired_headers)

    killed_app, killed_principal = _app(tmp_path / "killed")
    killed_app.state.external_action_kill_switch = True
    killed_headers = _headers(killed_principal, body, nonce="nonce_killswitch_123456")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=killed_app), base_url="http://test") as client:
        killed = await client.post("/act/device-a", content=body, headers=killed_headers)

    assert wrong.status_code == 403
    assert expired.status_code == 403
    assert killed.status_code == 503
    assert not wrong_app.state.authorized
    assert not expired_app.state.authorized
    assert not killed_app.state.authorized


@pytest.mark.asyncio
async def test_replay_nonce_is_scoped_to_principal(tmp_path):
    body = _body({"command": "send"})
    nonce = "shared_nonce_1234567890"
    alice_app, alice = _app(tmp_path)
    bob_app, bob = _app(tmp_path, principal=_principal(user_id="bob"))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=alice_app), base_url="http://test"
    ) as client:
        alice_response = await client.post(
            "/act/device-a",
            content=body,
            headers=_headers(alice, body, nonce=nonce),
        )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=bob_app), base_url="http://test"
    ) as client:
        bob_response = await client.post(
            "/act/device-a",
            content=body,
            headers=_headers(bob, body, nonce=nonce),
        )
    assert alice_response.status_code == 200
    assert bob_response.status_code == 200


@pytest.mark.asyncio
async def test_deferred_capability_binds_principal_task_args_expiry_runs_and_cancel(tmp_path):
    app, principal = _app(tmp_path / "parent")
    body = _body({"task": "safe.task", "args": ["one"]})
    headers = _headers(principal, body, nonce="nonce_parent_12345678901")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/act/device-a", content=body, headers=headers)
    assert response.status_code == 200
    parent = app.state.authorized[0][2]

    delegated_db = tmp_path / "delegated.sqlite3"
    capability = mint_deferred_action_capability(
        parent,
        task="safe.task",
        args=["one"],
        secret=DELEGATION_SECRET,
        ttl_seconds=300,
        max_runs=2,
    )
    wrong_args = consume_deferred_action_capability(
        capability,
        task="safe.task",
        args=["two"],
        secret=DELEGATION_SECRET,
        db_path=delegated_db,
    )
    first = consume_deferred_action_capability(
        capability,
        task="safe.task",
        args=["one"],
        secret=DELEGATION_SECRET,
        db_path=delegated_db,
    )
    second = consume_deferred_action_capability(
        capability,
        task="safe.task",
        args=["one"],
        secret=DELEGATION_SECRET,
        db_path=delegated_db,
    )
    exhausted = consume_deferred_action_capability(
        capability,
        task="safe.task",
        args=["one"],
        secret=DELEGATION_SECRET,
        db_path=delegated_db,
    )

    assert wrong_args == {"consumed": False, "reason": "args_mismatch"}
    assert (first["consumed"], first["run"], second["run"]) == (True, 1, 2)
    assert exhausted == {"consumed": False, "reason": "max_runs_exhausted"}

    other = mint_deferred_action_capability(
        parent,
        task="safe.task",
        args=["one"],
        secret=DELEGATION_SECRET,
        ttl_seconds=300,
        max_runs=1,
    )
    assert cancel_deferred_action_capability(
        other,
        principal_id="wrong-principal",
        db_path=delegated_db,
        secret=DELEGATION_SECRET,
    ) is False
    forged = dict(other)
    forged["signature"] = "0" * 64
    assert cancel_deferred_action_capability(
        forged,
        principal_id=parent.principal_id,
        db_path=delegated_db,
        secret=DELEGATION_SECRET,
    ) is False
    assert cancel_deferred_action_capability(
        other,
        principal_id=parent.principal_id,
        db_path=delegated_db,
        secret=DELEGATION_SECRET,
    ) is True
    cancelled = consume_deferred_action_capability(
        other,
        task="safe.task",
        args=["one"],
        secret=DELEGATION_SECRET,
        db_path=delegated_db,
    )
    assert cancelled == {"consumed": False, "reason": "cancelled"}


def test_direct_sinks_refuse_calls_without_verifier_receipt(monkeypatch, tmp_path):
    from cortex_server.modules.diplomat import TheDiplomat
    from cortex_server.routers import autonomy_governor, homeassistant

    reached = []
    diplomat = TheDiplomat(state_dir=tmp_path / "diplomat")
    monkeypatch.setattr(diplomat, "_send_to_whatsapp", lambda _message: reached.append("send") or True)
    with pytest.raises(Exception) as diplomat_denied:
        diplomat.send_briefing("message")
    assert getattr(diplomat_denied.value, "status_code", None) == 403

    monkeypatch.setattr(autonomy_governor.subprocess, "run", lambda *_a, **_k: reached.append("governor"))
    with pytest.raises(Exception) as governor_denied:
        autonomy_governor._run_engine(["execute"], action_required=True)
    assert getattr(governor_denied.value, "status_code", None) == 403

    monkeypatch.setenv("HOME_ASSISTANT_URL", "https://ha.example")
    monkeypatch.setenv("HOME_ASSISTANT_TOKEN", "ha-secret")
    monkeypatch.setattr(homeassistant, "urlopen", lambda *_a, **_k: reached.append("ha"))
    with pytest.raises(Exception) as ha_denied:
        homeassistant._ha_request("POST", "/api/services/light/turn_on", body={})
    assert getattr(ha_denied.value, "status_code", None) == 403
    assert reached == []


def test_autonomy_governor_never_exposes_raw_tool_output_or_errors(monkeypatch):
    from cortex_server.routers import autonomy_governor

    opaque = "opaque-tool-output-clinical-record-1234567890"
    monkeypatch.setattr(
        autonomy_governor.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"status": "GREEN", "diagnostic": opaque}),
            stderr="",
        ),
    )
    result = autonomy_governor._run_engine(["status"])
    assert result["status"] == "GREEN"
    assert result["diagnostic"] == "[REDACTED]"
    assert opaque not in json.dumps(result)

    monkeypatch.setattr(
        autonomy_governor.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=2,
            stdout="",
            stderr=opaque,
        ),
    )
    with pytest.raises(Exception) as failed:
        autonomy_governor._run_engine(["status"])
    assert opaque not in str(getattr(failed.value, "detail", failed.value))


@pytest.mark.asyncio
async def test_scheduler_revalidates_delegation_but_holds_before_unauthorized_worker(monkeypatch, tmp_path):
    from cortex_server import scheduler, worker

    app, principal = _app(tmp_path / "parent-scheduler")
    body = _body({"task": "safe.task", "args": ["one"]})
    headers = _headers(principal, body, nonce="nonce_scheduler_parent_123")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/act/device-a", content=body, headers=headers)
    assert response.status_code == 200
    parent = app.state.authorized[0][2]

    replay_db = tmp_path / "scheduler-replay.sqlite3"
    monkeypatch.setenv("CORTEX_ACTION_DELEGATION_SECRET", DELEGATION_SECRET)
    monkeypatch.setenv("CORTEX_ACTION_CAPABILITY_DB_PATH", str(replay_db))
    monkeypatch.setattr(scheduler, "_TRIGGER_LEDGER_PATH", tmp_path / "trigger.jsonl")
    monkeypatch.setattr(scheduler, "_NOTARY_LEDGER_PATH", tmp_path / "notary.jsonl")
    sent = []

    class Result:
        id = "task-result-id"

    def capture_send(task, *, args, kwargs, headers, **options):
        sent.append((task, args, kwargs, headers, options))
        return Result()

    monkeypatch.setattr(scheduler.celery_app, "send_task", capture_send)
    capability = mint_deferred_action_capability(
        parent,
        task="safe.task",
        args=["one"],
        secret=DELEGATION_SECRET,
        ttl_seconds=300,
        max_runs=1,
    )
    policy = {"action_capability": capability, "voi_enabled": False}

    first = scheduler.trigger_celery_task(
        "safe.task",
        args=["one"],
        source="scheduled",
        job_id="job-a",
        policy_override=policy,
    )
    replay = scheduler.trigger_celery_task(
        "safe.task",
        args=["one"],
        source="scheduled",
        job_id="job-a",
        policy_override=policy,
    )
    missing = scheduler.trigger_celery_task(
        "safe.task",
        args=["one"],
        source="scheduled",
        job_id="job-b",
        policy_override={"voi_enabled": False},
    )

    assert first is None
    assert replay is None
    assert missing is None
    assert sent == []

    with pytest.raises(Exception) as direct_denied:
        scheduler.trigger_celery_task("safe.task", args=["one"], source="manual_api")
    assert getattr(direct_denied.value, "status_code", None) == 403
    held_direct = scheduler.trigger_celery_task(
        "safe.task",
        args=["one"],
        source="manual_api",
        action_authorization=parent,
    )
    assert held_direct is None
    assert sent == []

    # A capability-aware target receives a distinct one-shot worker proof.
    # The scheduler consumes the persisted run, while the task body can run
    # only after the worker consumes the child proof.
    worker_parent = mint_deferred_action_capability(
        parent,
        task="cortex_tasks.add",
        args=[1, 2],
        secret=DELEGATION_SECRET,
        ttl_seconds=300,
        max_runs=1,
    )
    dispatched = scheduler.trigger_celery_task(
        "cortex_tasks.add",
        args=[1, 2],
        source="scheduled",
        job_id="job-worker-capable",
        policy_override={
            "action_capability": worker_parent,
            "voi_enabled": False,
        },
    )
    assert dispatched == "task-result-id"
    assert len(sent) == 1
    sent_task, sent_args, sent_kwargs, sent_headers, sent_options = sent[0]
    assert (sent_task, sent_args, sent_kwargs, sent_options) == (
        "cortex_tasks.add",
        [1, 2],
        {},
        {},
    )
    worker_capability = sent_headers[DELEGATED_ACTION_CAPABILITY_HEADER]
    add_task = worker.app.tasks["cortex_tasks.add"]

    assert add_task.apply(args=[1, 2], headers={}, throw=True).state == "REJECTED"
    forged_headers = {
        DELEGATED_ACTION_CAPABILITY_HEADER: {
            **worker_capability,
            "signature": "0" * 64,
        }
    }
    assert (
        add_task.apply(args=[1, 2], headers=forged_headers, throw=True).state
        == "REJECTED"
    )
    assert (
        add_task.apply(args=[2, 3], headers=sent_headers, throw=True).state
        == "REJECTED"
    )

    assert add_task.apply(
        args=[1, 2],
        headers=sent_headers,
        throw=True,
    ).get() == 3
    assert (
        add_task.apply(args=[1, 2], headers=sent_headers, throw=True).state
        == "REJECTED"
    )

    # The persisted scheduled run is exhausted too, so retry never publishes
    # another worker message.
    assert scheduler.trigger_celery_task(
        "cortex_tasks.add",
        args=[1, 2],
        source="scheduled",
        job_id="job-worker-capable",
        policy_override={
            "action_capability": worker_parent,
            "voi_enabled": False,
        },
    ) is None
    assert len(sent) == 1

    events = [json.loads(line) for line in (tmp_path / "trigger.jsonl").read_text().splitlines()]
    assert any(event["status"] == "held_worker_action_authorization" for event in events)

    opaque = "patient-name-secret-Authorization-Bearer-abc123"
    assert scheduler.trigger_celery_task(
        f"private.task.{opaque}",
        args=[opaque],
        kwargs={f"secret-key-{opaque}": opaque},
        source="manual_api",
        job_id=f"/private/jobs/{opaque}",
        job_name=f"job-{opaque}",
        action_authorization=parent,
    ) is None
    assert len(sent) == 1
    retained = (tmp_path / "trigger.jsonl").read_text() + (
        tmp_path / "notary.jsonl"
    ).read_text()
    assert opaque not in retained
    assert str(tmp_path) not in retained
    latest_event = json.loads((tmp_path / "trigger.jsonl").read_text().splitlines()[-1])
    latest_packet = json.loads((tmp_path / "notary.jsonl").read_text().splitlines()[-1])
    assert latest_event["task"] == "[REDACTED]"
    assert len(latest_event["task_sha256"]) == 64
    assert latest_event["kwargs_count"] == 1
    assert latest_packet["evidence"] == ["cron_trigger_ledger", "cron_notary_ledger"]


@pytest.mark.asyncio
async def test_generic_queue_and_cron_dispatch_fail_closed_without_worker_proof(monkeypatch, tmp_path):
    from cortex_server.routers import cron, night_shift, queue

    receipt = await _receipt(tmp_path / "receipt")
    sent = []
    monkeypatch.setattr(
        queue.celery_app,
        "send_task",
        lambda *_args, **_kwargs: sent.append("queue"),
    )
    monkeypatch.delenv("CORTEX_ACTION_DELEGATION_SECRET", raising=False)
    monkeypatch.delenv("CORTEX_ACTION_CAPABILITY_DB_PATH", raising=False)

    # Even a capability-aware target is never published when no one-shot
    # worker proof can be minted and durably consumed.
    with pytest.raises(Exception) as queue_unconfigured:
        await queue.schedule_task(
            queue.ScheduleRequest(
                task="cortex_tasks.add",
                args=[1, 2],
                idempotency_key="missing-worker-proof",
            ),
            receipt,
        )
    assert getattr(queue_unconfigured.value, "status_code", None) == 503
    with pytest.raises(Exception) as trigger_unconfigured:
        await cron.trigger_webhook(
            cron.WebhookTriggerRequest(task="cortex_tasks.add", args=[1, 2]),
            receipt,
        )
    assert getattr(trigger_unconfigured.value, "status_code", None) == 503
    assert sent == []

    with pytest.raises(Exception) as queue_held:
        await queue.schedule_task(queue.ScheduleRequest(task="unknown.task", args=[]), receipt)
    assert getattr(queue_held.value, "status_code", None) == 503

    monkeypatch.setattr(cron, "get_scheduled_jobs", lambda: [])
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
    with pytest.raises(Exception) as cron_held:
        await cron.schedule_cron(
            cron.CronScheduleRequest(
                job_name="job-a",
                cron="* * * * *",
                task="unknown.task",
            ),
            request,
            receipt,
        )
    assert getattr(cron_held.value, "status_code", None) == 503
    with pytest.raises(Exception) as trigger_held:
        await cron.trigger_webhook(cron.WebhookTriggerRequest(task="unknown.task"), receipt)
    assert getattr(trigger_held.value, "status_code", None) == 503
    with pytest.raises(Exception) as night_shift_held:
        await night_shift.trigger_night_shift(
            night_shift.TriggerRequest(dry_run=False),
            receipt,
        )
    assert getattr(night_shift_held.value, "status_code", None) == 503
    assert sent == []


@pytest.mark.asyncio
async def test_cron_replacement_and_deletion_enforce_authenticated_job_owner(monkeypatch, tmp_path):
    from cortex_server.routers import cron

    alice = await _receipt(tmp_path / "alice", nonce="nonce_cron_alice_123456")
    bob = await _receipt(
        tmp_path / "bob",
        principal=_principal(user_id="bob"),
        nonce="nonce_cron_bob_12345678",
    )
    capability = mint_deferred_action_capability(
        alice,
        task="safe.task",
        args=["one"],
        secret=DELEGATION_SECRET,
        ttl_seconds=300,
        max_runs=1,
    )
    monkeypatch.setattr(
        cron,
        "get_scheduled_jobs",
        lambda: [SimpleNamespace(id="job-a", name="job-a")],
    )
    monkeypatch.setattr(cron, "get_job_policy", lambda _job_id: {"action_capability": capability})
    removed = []
    monkeypatch.setattr(cron, "remove_job", lambda job_id: removed.append(job_id) or True)
    http_request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                action_delegation_secret=DELEGATION_SECRET,
                action_capability_db_path=str(tmp_path / "cron-capabilities.sqlite3"),
            )
        )
    )
    assert deferred_action_owner(capability, secret=DELEGATION_SECRET) == alice.principal_id

    with pytest.raises(Exception) as replacement_denied:
        await cron.schedule_cron(
            cron.CronScheduleRequest(
                job_name="job-a",
                cron="* * * * *",
                task="safe.task",
                args=["one"],
            ),
            http_request,
            bob,
        )
    assert getattr(replacement_denied.value, "status_code", None) == 403
    assert deferred_action_owner(capability, secret=DELEGATION_SECRET) == alice.principal_id

    with pytest.raises(Exception) as delete_denied:
        await cron.delete_cron_job("job-a", http_request, bob)
    assert getattr(delete_denied.value, "status_code", None) == 403
    assert deferred_action_owner(capability, secret=DELEGATION_SECRET) == alice.principal_id
    assert removed == []

    deleted = await cron.delete_cron_job("job-a", http_request, alice)
    assert deleted == {"status": "removed", "job_id": "job-a"}
    assert removed == ["job-a"]
    assert consume_deferred_action_capability(
        capability,
        task="safe.task",
        args=["one"],
        secret=DELEGATION_SECRET,
        db_path=tmp_path / "cron-capabilities.sqlite3",
    ) == {"consumed": False, "reason": "cancelled"}


@pytest.mark.asyncio
async def test_ha_confirmation_bound_idempotency_admin_policy_and_one_shot_transport(
    monkeypatch, tmp_path
):
    from cortex_server.routers import homeassistant

    principal_receipt = await _receipt(
        tmp_path / "principal",
        nonce="nonce_ha_principal_123456",
    )
    blocked_event_receipt = await _receipt(
        tmp_path / "blocked-event",
        nonce="nonce_ha_blocked_event_12345",
        path="/homeassistant/events/unsafe_event",
        payload={"data": {"value": 1}},
    )
    event_receipt = await _receipt(
        tmp_path / "event",
        nonce="nonce_ha_event_123456789",
        path="/homeassistant/events/confirmed_event",
        payload={
            "data": {"value": 1},
            "confirm": True,
            "idempotency_key": "caller-retry-key-0001",
        },
    )
    missing_idempotency_receipt = await _receipt(
        tmp_path / "event-missing-idempotency",
        nonce="nonce_ha_event_missing_idemp_1234",
        path="/homeassistant/events/confirmed_event",
        payload={"data": {"value": 1}, "confirm": True},
    )
    transport_receipt = await _receipt(
        tmp_path / "event-transport",
        nonce="nonce_ha_event_transport_12345",
        path="/homeassistant/events/confirmed_event",
        payload={
            "data": {"value": 9},
            "confirm": True,
            "idempotency_key": "caller-retry-key-0002",
        },
    )
    principal_policy_receipt = await _receipt(
        tmp_path / "principal-policy",
        nonce="nonce_ha_principal_policy_1234",
        path="/homeassistant/policy",
        payload={"mode": "confirm"},
    )
    admin_policy_receipt = await _receipt(
        tmp_path / "admin-policy",
        principal=_admin(),
        nonce="nonce_ha_admin_123456789",
        path="/homeassistant/policy",
        payload={"mode": "confirm"},
    )
    policy = {**homeassistant.DEFAULT_POLICY, "kill_switch": False}
    monkeypatch.setattr(homeassistant, "_load_policy_cfg", lambda: policy)
    monkeypatch.setattr(homeassistant, "_append_audit", lambda _event: None)
    monkeypatch.setenv("HA_IDEMP_DB_PATH", str(tmp_path / "ha-idempotency.sqlite3"))
    homeassistant._HA_IDEMP_CACHE.clear()

    writes = []
    original_write = homeassistant._ha_write_request
    original_ha_request = homeassistant._ha_request
    monkeypatch.setattr(
        homeassistant,
        "_ha_write_request",
        lambda *args, **kwargs: writes.append((args, kwargs)) or {"success": True},
    )
    blocked_event = await homeassistant.ha_fire_event(
        "unsafe_event",
        homeassistant.EventFireRequest(data={"value": 1}),
        blocked_event_receipt,
    )
    assert blocked_event["reason"] == "explicit_confirmation_required"
    with pytest.raises(Exception) as blocked_esp:
        await homeassistant.ha_voice_activate_esp32(
            homeassistant.ESP32VoiceActivateRequest(),
            principal_receipt,
        )
    assert getattr(blocked_esp.value, "status_code", None) == 503
    assert writes == []
    monkeypatch.setattr(homeassistant, "_ha_write_request", original_write)

    with pytest.raises(Exception) as missing_idempotency:
        await homeassistant.ha_fire_event(
            "confirmed_event",
            homeassistant.EventFireRequest(data={"value": 1}, confirm=True),
            missing_idempotency_receipt,
        )
    assert getattr(missing_idempotency.value, "status_code", None) == 400

    downstream = []
    monkeypatch.setattr(
        homeassistant,
        "_ha_request",
        lambda *args, **kwargs: downstream.append((args, kwargs))
        or {
            "success": True,
            "status": 200,
            "data": {"opaque": "opaque-upstream-response-1234567890"},
        },
    )
    first = original_write(
        "/api/events/confirmed_event",
        body={"value": 1},
        supplied_idempotency_key="caller-retry-key-0001",
        authorization=event_receipt,
        action_path="/homeassistant/events/confirmed_event",
    )
    replay = original_write(
        "/api/events/confirmed_event",
        body={"value": 1},
        supplied_idempotency_key="caller-retry-key-0001",
        authorization=event_receipt,
        action_path="/homeassistant/events/confirmed_event",
    )
    with pytest.raises(Exception) as changed:
        original_write(
            "/api/events/confirmed_event",
            body={"value": 2},
            supplied_idempotency_key="caller-retry-key-0001",
            authorization=event_receipt,
            action_path="/homeassistant/events/confirmed_event",
        )
    assert first["success"] is True
    assert replay["idempotent_replay"] is True
    assert getattr(changed.value, "status_code", None) == 403
    assert len(downstream) == 1
    durable_replay = (tmp_path / "ha-idempotency.sqlite3").read_bytes()
    assert b"opaque-upstream-response-1234567890" not in durable_replay

    policy["kill_switch"] = True
    with pytest.raises(Exception) as killed_at_sink:
        original_write(
            "/api/events/another_event",
            body={"value": 3},
            supplied_idempotency_key="caller-retry-key-0003",
            authorization=event_receipt,
            action_path="/homeassistant/events/confirmed_event",
        )
    assert getattr(killed_at_sink.value, "status_code", None) == 503
    assert len(downstream) == 1
    policy["kill_switch"] = False

    saved = []
    monkeypatch.setattr(homeassistant, "_save_policy_cfg", lambda value: saved.append(value))
    with pytest.raises(Exception) as non_admin:
        await homeassistant.ha_policy_update(
            homeassistant.PolicyUpdateRequest(mode="confirm"),
            principal_policy_receipt,
        )
    assert getattr(non_admin.value, "status_code", None) == 403
    assert saved == []
    updated = await homeassistant.ha_policy_update(
        homeassistant.PolicyUpdateRequest(mode="confirm"),
        admin_policy_receipt,
    )
    assert updated["policy"]["mode"] == "confirm"
    assert len(saved) == 1

    calls = []
    monkeypatch.setattr(
        homeassistant,
        "_ha_cfg",
        lambda: {
            "configured": True,
            "url": "https://ha.example",
            "token": "configured-token",
            "verify_ssl": True,
        },
    )
    monkeypatch.setattr(
        homeassistant,
        "urlopen",
        lambda *_args, **_kwargs: calls.append("attempt")
        or (_ for _ in ()).throw(homeassistant.URLError("ambiguous")),
    )
    bound_key = homeassistant._bound_ha_idempotency_key(
        "caller-retry-key-0002",
        authorization=transport_receipt,
        action_path="/homeassistant/events/confirmed_event",
        path="/api/events/confirmed_event",
        body={"value": 9},
    )
    result = original_ha_request(
        "POST",
        "/api/events/confirmed_event",
        body={"value": 9},
        retries=2,
        idempotency_key=bound_key,
        authorization=transport_receipt,
        action_path="/homeassistant/events/confirmed_event",
    )
    assert result["success"] is False
    assert calls == ["attempt"]


@pytest.mark.asyncio
async def test_ha_corrupt_policy_fails_closed_and_chronos_remains_disabled(
    monkeypatch, tmp_path
):
    from cortex_server.modules.chronos import Chronos
    from cortex_server.routers import homeassistant

    receipt = await _receipt(
        tmp_path / "receipt",
        nonce="nonce_policy_corrupt_123456",
    )
    policy_path = tmp_path / "homeassistant-policy.json"
    policy_path.write_bytes(b"{torn-policy")
    monkeypatch.setattr(homeassistant, "POLICY_CFG_PATHS", [policy_path])
    homeassistant._POLICY_STORES.clear()

    policy = homeassistant._load_policy_cfg()
    assert policy["kill_switch"] is True
    assert policy["mode"] == "shadow"
    assert policy["persistence_degraded"] is True
    with pytest.raises(Exception) as disabled:
        homeassistant._assert_ha_actuation_enabled(receipt)
    assert getattr(disabled.value, "status_code", None) == 503
    assert policy_path.read_bytes() == b"{torn-policy"
    assert list(tmp_path.glob("homeassistant-policy.json.corrupt.*"))

    chronos = Chronos(changelog_path=str(tmp_path / "chronos.log"))
    monkeypatch.setenv(
        "CORTEX_CHRONOS_DELEGATED_CAPABILITY",
        '{"synthetic":"must-not-enable-automatic-mutation"}',
    )
    assert chronos._scheduled_authorization("2026-08-23") is None
    assert not hasattr(chronos, "_materialize_skill")
    assert not hasattr(chronos, "_get_changelog_summary")
    with pytest.raises(RuntimeError, match="every final sink"):
        await chronos.run_night_shift(authorization=receipt)


def test_chronos_changelog_retains_metadata_not_raw_event_content(tmp_path, capsys):
    from cortex_server.modules.chronos import Chronos

    secret = "Authorization: Bearer chronos-secret patient@example.test"
    changelog = tmp_path / "chronos.log"
    chronos = Chronos(changelog_path=str(changelog))

    chronos._log(secret)

    persisted = changelog.read_text()
    console = capsys.readouterr().out
    assert secret not in persisted
    assert secret not in console
    assert "chronos-secret" not in persisted
    assert "patient@example.test" not in console
    assert "event_sha256=" in persisted
    assert "event_bytes=" in console


def test_diplomat_has_no_embedded_contact_and_redacts_persisted_console_data(
    monkeypatch, tmp_path, capsys
):
    from cortex_server.modules.diplomat import TheDiplomat

    monkeypatch.delenv("CORTEX_DIPLOMAT_OWNER_NUMBER", raising=False)
    diplomat = TheDiplomat(state_dir=tmp_path / "diplomat")
    assert diplomat.owner_number == ""
    sensitive = "Authorization: Bearer secret-value-123 patient_email=patient@example.test"
    diplomat._log_message("TEST", sensitive, False)
    persisted = diplomat.message_log.read_text()
    console = capsys.readouterr().out
    assert "secret-value-123" not in persisted
    assert "patient@example.test" not in persisted
    assert "secret-value-123" not in console
    assert "patient@example.test" not in console
    assert "content_sha256=" in persisted

    sending = TheDiplomat(
        owner_number="+15550000000",
        state_dir=tmp_path / "sending",
    )
    assert sending._send_to_whatsapp("opaque-message-secret-1234567890") is False
    assert "requests" not in inspect.getsource(TheDiplomat._send_to_whatsapp)
    assert "cortex_outbox" not in inspect.getsource(TheDiplomat._send_to_whatsapp)
