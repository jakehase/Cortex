from __future__ import annotations

import json
import threading
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from cortex_server.modules import cortex_codec
from cortex_server.modules.memory_scope import (
    AuthenticatedMemoryPrincipal,
    MemoryScopeAuthError,
    authenticate_memory_principal,
    memory_scope_signature,
)
from cortex_server.routers import nexus


def _scope(tenant: str, agent: str, session: str) -> dict[str, str]:
    return {
        "tenant_id": tenant,
        "workspace_id": "workspace-shared",
        "agent_id": agent,
        "user_id": f"user-{agent}",
        "channel_id": "channel-shared",
        "session_id": session,
    }


def _credential_headers(
    scope: dict[str, str],
    *,
    credential_id: str,
    secret: str,
    outcome_token: str = "",
) -> dict[str, str]:
    headers = {
        "x-session-id": scope["session_id"],
        "x-cortex-tenant-id": scope["tenant_id"],
        "x-cortex-workspace-id": scope["workspace_id"],
        "x-cortex-agent-id": scope["agent_id"],
        "x-cortex-user-id": scope["user_id"],
        "x-cortex-channel-id": scope["channel_id"],
        "x-cortex-session-id": scope["session_id"],
        "x-cortex-scope-credential-id": credential_id,
        "x-cortex-scope-signature": memory_scope_signature(
            **scope,
            credential_id=credential_id,
            secret=secret,
        ),
    }
    if outcome_token:
        headers["x-cortex-outcome-feedback-token"] = outcome_token
    return headers


def _request(headers: dict[str, str], *, state: SimpleNamespace | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        headers=headers,
        client=SimpleNamespace(host="127.0.0.1"),
        state=state if state is not None else SimpleNamespace(),
    )


def test_signed_dynamic_session_policy_authorizes_fresh_bounded_sessions(monkeypatch):
    fixed = _scope("tenant-dynamic", "bridge-agent", "unused")
    allowed = {
        **{field: value for field, value in fixed.items() if field != "session_id"},
        "session_id": {
            "type": "signed_dynamic",
            "prefix": "openclaw-",
            "max_length": 80,
        },
    }
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps({"bridge-dynamic": {"secret": "dynamic-secret", "allowed_scopes": [allowed]}}),
    )

    principals = []
    for suffix in ("a" * 64, "b" * 64):
        scope = {**fixed, "session_id": f"openclaw-{suffix}"}
        principals.append(
            authenticate_memory_principal(
                tenant_id=scope["tenant_id"],
                workspace_id=scope["workspace_id"],
                scope=scope,
                credential_id="bridge-dynamic",
                signature=memory_scope_signature(
                    **scope,
                    credential_id="bridge-dynamic",
                    secret="dynamic-secret",
                ),
                production=True,
            )
        )

    assert [principal.session_id for principal in principals] == [
        f"openclaw-{'a' * 64}",
        f"openclaw-{'b' * 64}",
    ]
    assert principals[0].storage_workspace_id != principals[1].storage_workspace_id

    escaped = {**fixed, "session_id": "other-session"}
    with pytest.raises(MemoryScopeAuthError, match="not authorized"):
        authenticate_memory_principal(
            tenant_id=escaped["tenant_id"],
            workspace_id=escaped["workspace_id"],
            scope=escaped,
            credential_id="bridge-dynamic",
            signature=memory_scope_signature(
                **escaped,
                credential_id="bridge-dynamic",
                secret="dynamic-secret",
            ),
            production=True,
        )


@pytest.mark.asyncio
async def test_codec_and_kernel_continuity_are_principal_scoped_for_shared_session(monkeypatch, tmp_path):
    session_id = "openclaw-shared-session"
    scope_a = _scope("tenant-shared", "agent-a", session_id)
    scope_b = _scope("tenant-shared", "agent-b", session_id)
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv(
        "NEXUS_OUTCOME_FEEDBACK_SIGNING_KEY",
        "server-only-feedback-signing-key-for-continuity-test",
    )
    monkeypatch.setattr(
        nexus,
        "_REFERENT_STATE_PATH",
        tmp_path / "nexus-referent-state.json",
    )
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps(
            {
                "credential-a": {"secret": "secret-a", "allowed_scopes": [scope_a]},
                "credential-b": {"secret": "secret-b", "allowed_scopes": [scope_b]},
            }
        ),
    )
    monkeypatch.setattr(cortex_codec, "CODEC_DURABLE_ENABLED", False)

    async def direct_call(function, *args, **kwargs):
        return function(*args, **kwargs)

    monkeypatch.setattr(nexus, "run_in_threadpool", direct_call)
    principals = []
    for credential_id, secret, scope, marker in (
        ("credential-a", "secret-a", scope_a, "private-marker-a"),
        ("credential-b", "secret-b", scope_b, "private-marker-b"),
    ):
        signature = memory_scope_signature(**scope, credential_id=credential_id, secret=secret)
        principal = authenticate_memory_principal(
            tenant_id=scope["tenant_id"],
            workspace_id=scope["workspace_id"],
            scope=scope,
            credential_id=credential_id,
            signature=signature,
            production=True,
        )
        request = _request(
            _credential_headers(scope, credential_id=credential_id, secret=secret),
            state=SimpleNamespace(authenticated_memory_principal=principal),
        )
        response = await nexus.post_nexus_codec_events(
            nexus.CodecEventsRequest(
                session_key=session_id,
                events=[{"text": marker, "tags": ["continuity"]}],
                tenant_id=scope["tenant_id"],
                workspace_id=scope["workspace_id"],
                scope=scope,
                scope_credential_id=credential_id,
                scope_signature=signature,
            ),
            request,
        )
        assert response["success"] is True
        principals.append(principal)

    packet_a = nexus._codec_context_packet(
        principals[0].codec_session_key,
        tenant_id=principals[0].tenant_id,
        workspace_id=principals[0].storage_workspace_id,
        telemetry_session_key=nexus._principal_continuity_key(principals[0], session_id),
    )
    packet_b = nexus._codec_context_packet(
        principals[1].codec_session_key,
        tenant_id=principals[1].tenant_id,
        workspace_id=principals[1].storage_workspace_id,
        telemetry_session_key=nexus._principal_continuity_key(principals[1], session_id),
    )

    assert "private-marker-a" in packet_a["packet"] or "private-marker-a" in packet_a["summary"]
    assert "private-marker-b" not in packet_a["packet"] and "private-marker-b" not in packet_a["summary"]
    assert "private-marker-b" in packet_b["packet"] or "private-marker-b" in packet_b["summary"]
    assert "private-marker-a" not in packet_b["packet"] and "private-marker-a" not in packet_b["summary"]
    assert nexus._principal_continuity_key(principals[0], session_id) != nexus._principal_continuity_key(
        principals[1], session_id
    )

    original_transaction = nexus.ExecutionTransaction
    monkeypatch.setattr(
        nexus,
        "ExecutionTransaction",
        lambda **kwargs: original_transaction(**kwargs, journal_dir=tmp_path / "transactions"),
    )
    monkeypatch.setattr(
        nexus,
        "analyze_intent_with_oracle",
        lambda _query, **_kwargs: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"},
    )
    monkeypatch.setattr(
        nexus,
        "gather_live_evidence",
        lambda *_args, **_kwargs: {
            "required": False,
            "mode": "not_required",
            "evidence_count": 0,
            "degraded": False,
        },
    )
    monkeypatch.setattr(nexus, "_fetch_kernel_online_levels", lambda: None)
    monkeypatch.setattr(nexus, "_architect_healthy", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(nexus, "_persist_checkpoint", lambda _checkpoint: None)
    monkeypatch.setattr(nexus, "_refresh_context", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(nexus, "observe_outcome", lambda *_args, **_kwargs: {"autotune_enabled": True})

    def preserve_codec_context(session_key, query, _response="", **kwargs):
        return nexus._codec_context_packet(
            session_key,
            query=query,
            tenant_id=kwargs.get("tenant_id"),
            workspace_id=kwargs.get("workspace_id"),
            telemetry_session_key=kwargs.get("telemetry_session_key"),
        )

    monkeypatch.setattr(nexus, "_update_codec_context", preserve_codec_context)

    class _Tuner:
        def get_policy_hint(self, **_kwargs):
            return {
                "stage": "shadow",
                "rollout_percent": 0,
                "apply_recommendation": False,
                "recommended_policy": None,
            }

        def observe(self, _record):
            return {"decision": {"stage": "shadow"}}

    monkeypatch.setattr(nexus, "_outcome_tuner_for_scope", lambda _scope: _Tuner())

    def observed_codec_outcome(**kwargs):
        metrics = nexus._execution_flow_metrics(
            kwargs["execution_transaction"],
            kwargs["validator_result"],
            kwargs["fastlane"],
        )
        return {"recorded": True, "execution_metrics": metrics}

    monkeypatch.setattr(nexus, "_observe_codec_execution_outcome", observed_codec_outcome)
    original_prepare = nexus.cortex_kernel_v2.prepare_request
    kernel_session_keys = []

    def capture_kernel_session(*args, **kwargs):
        kernel_session_keys.append(kwargs.get("session_key"))
        return original_prepare(*args, **kwargs)

    monkeypatch.setattr(nexus.cortex_kernel_v2, "prepare_request", capture_kernel_session)
    nexus.cortex_kernel_v2.reset_state()

    orchestration_packets = []
    for credential_id, secret, scope in (
        ("credential-a", "secret-a", scope_a),
        ("credential-b", "secret-b", scope_b),
    ):
        result = await nexus.orchestrate_query(
            query="Plan principal-scoped continuity isolation.",
            request=SimpleNamespace(
                headers=_credential_headers(scope, credential_id=credential_id, secret=secret),
                client=SimpleNamespace(host="127.0.0.1"),
                state=SimpleNamespace(request_id=f"request-{credential_id}"),
            ),
            payload={},
        )
        assert result["success"] is True
        orchestration_packets.append(result["codec_context"]["packet"] or result["codec_context"]["summary"])

    assert "private-marker-a" in orchestration_packets[0]
    assert "private-marker-b" not in orchestration_packets[0]
    assert "private-marker-b" in orchestration_packets[1]
    assert "private-marker-a" not in orchestration_packets[1]
    assert len(set(kernel_session_keys)) == 2
    assert all(key and key.startswith("principal:") for key in kernel_session_keys)


@pytest.mark.asyncio
async def test_codec_lifecycle_replay_returns_durable_result_without_reapplying(
    monkeypatch,
    tmp_path,
):
    session_id = "openclaw-codec-idempotency"
    scope = _scope("tenant-codec", "bridge-agent", session_id)
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps(
            {
                "codec-bridge": {
                    "secret": "codec-bridge-secret",
                    "allowed_scopes": [scope],
                }
            }
        ),
    )
    monkeypatch.setattr(
        nexus,
        "_CODEC_EVENTS_IDEMPOTENCY_STATE_PATH",
        tmp_path / "codec-idempotency.sqlite3",
    )
    update_calls = []
    packet_state = {}

    def update_state(_session_key, events, **_scope):
        update_calls.append(list(events))
        packet_state["source_refs"] = [
            {"event_id": events[0]["event_id"], "event_kind": "codec_lifecycle"}
        ]
        return {"state_revision": 8, "durable_write": {"fingerprint": "codec-fp-8"}}

    def get_packet(_session_key, **_scope):
        return {
            "available": True,
            "packet": "bounded packet",
            "summary": "bounded packet",
            "state": dict(packet_state),
            "durable": {"fingerprint": "codec-fp-8"},
        }

    monkeypatch.setattr(nexus, "update_codec_state_for_session", update_state)
    monkeypatch.setattr(nexus, "get_codec_packet_for_session", get_packet)
    signature = memory_scope_signature(
        **scope,
        credential_id="codec-bridge",
        secret="codec-bridge-secret",
    )
    principal = authenticate_memory_principal(
        tenant_id=scope["tenant_id"],
        workspace_id=scope["workspace_id"],
        scope=scope,
        credential_id="codec-bridge",
        signature=signature,
        production=False,
    )
    request = _request(
        _credential_headers(
            scope,
            credential_id="codec-bridge",
            secret="codec-bridge-secret",
        ),
        state=SimpleNamespace(authenticated_memory_principal=principal),
    )

    def payload(text):
        return nexus.CodecEventsRequest(
            session_key=session_id,
            events=[{"text": text}],
            idempotency_key="bridge-lifecycle-0001",
            tenant_id=scope["tenant_id"],
            workspace_id=scope["workspace_id"],
            scope=scope,
            scope_credential_id="codec-bridge",
            scope_signature=signature,
        )

    first = await nexus.post_nexus_codec_events(payload("remember durable cobalt"), request)
    replay = await nexus.post_nexus_codec_events(payload("remember durable cobalt"), request)

    assert replay == first
    assert len(update_calls) == 1
    with pytest.raises(HTTPException) as reused:
        await nexus.post_nexus_codec_events(payload("different lifecycle payload"), request)
    assert reused.value.status_code == 409
    assert len(update_calls) == 1


@pytest.mark.asyncio
async def test_codec_incomplete_reservation_recovers_from_durable_source_ref(
    monkeypatch,
    tmp_path,
):
    session_id = "openclaw-codec-recovery"
    scope = _scope("tenant-codec", "bridge-agent", session_id)
    secret = "codec-recovery-secret"
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps(
            {
                "codec-bridge": {
                    "secret": secret,
                    "allowed_scopes": [scope],
                }
            }
        ),
    )
    state_path = tmp_path / "codec-recovery.sqlite3"
    monkeypatch.setattr(nexus, "_CODEC_EVENTS_IDEMPOTENCY_STATE_PATH", state_path)
    signature = memory_scope_signature(
        **scope,
        credential_id="codec-bridge",
        secret=secret,
    )
    principal = authenticate_memory_principal(
        tenant_id=scope["tenant_id"],
        workspace_id=scope["workspace_id"],
        scope=scope,
        credential_id="codec-bridge",
        signature=signature,
        production=False,
    )
    normalized_events = [
        {
            "text": "recover durable lifecycle",
            "tags": [],
            "metadata": dict(principal.storage_metadata),
        }
    ]
    request_fingerprint = nexus._codec_events_request_fingerprint(
        session_key=principal.codec_session_key,
        events=normalized_events,
        max_chars=420,
    )
    idempotency_key = "bridge-lifecycle-recovery"
    lifecycle_ref = nexus.hashlib.sha256(
        (
            "nexus.codec-events.lifecycle.v1\0"
            + idempotency_key
            + "\0"
            + request_fingerprint
        ).encode("utf-8")
    ).hexdigest()
    nexus.reserve_assurance_receipt(
        state_path,
        scope=nexus._codec_events_idempotency_scope(
            principal, principal.codec_session_key
        ),
        jti=idempotency_key,
        expires_at=nexus._CODEC_EVENTS_IDEMPOTENCY_EXPIRES_AT,
    )

    def should_not_update(*_args, **_kwargs):
        pytest.fail("recovery replay invoked the Codec updater")

    monkeypatch.setattr(nexus, "update_codec_state_for_session", should_not_update)
    monkeypatch.setattr(
        nexus,
        "get_codec_packet_for_session",
        lambda *_args, **_kwargs: {
            "available": True,
            "packet": "recovered packet",
            "summary": "recovered packet",
            "state": {
                "source_refs": [
                    {"event_id": lifecycle_ref, "event_kind": "codec_lifecycle"}
                ]
            },
            "durable": {"fingerprint": "codec-fp-recovered"},
        },
    )
    request = _request(
        _credential_headers(scope, credential_id="codec-bridge", secret=secret),
        state=SimpleNamespace(authenticated_memory_principal=principal),
    )
    response = await nexus.post_nexus_codec_events(
        nexus.CodecEventsRequest(
            session_key=session_id,
            events=[{"text": "recover durable lifecycle"}],
            idempotency_key=idempotency_key,
            tenant_id=scope["tenant_id"],
            workspace_id=scope["workspace_id"],
            scope=scope,
            scope_credential_id="codec-bridge",
            scope_signature=signature,
        ),
        request,
    )

    assert response["state_fingerprint"] == "codec-fp-recovered"
    assert nexus.assurance_receipt_status(
        state_path,
        scope=nexus._codec_events_idempotency_scope(
            principal, principal.codec_session_key
        ),
        jti=idempotency_key,
    ) == "consumed"


def test_orchestration_principal_authentication_fails_closed_in_production(monkeypatch):
    scope = _scope("tenant-auth", "agent-auth", "openclaw-auth-session")
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps({"credential-auth": {"secret": "secret-auth", "allowed_scopes": [scope]}}),
    )

    with pytest.raises(HTTPException, match="full principal"):
        nexus._authenticated_nexus_principal(
            _request({"x-session-id": scope["session_id"]}),
            session_hint=scope["session_id"],
        )

    headers = _credential_headers(scope, credential_id="credential-auth", secret="secret-auth")
    principal, session_id = nexus._authenticated_nexus_principal(
        _request(headers),
        session_hint=scope["session_id"],
    )
    assert principal.scope == scope
    assert session_id == scope["session_id"]

    mismatched = {**headers, "x-session-id": "openclaw-other-session"}
    with pytest.raises(HTTPException, match="transport session"):
        nexus._authenticated_nexus_principal(
            _request(mismatched),
            session_hint=scope["session_id"],
        )


@pytest.mark.asyncio
async def test_outcome_feedback_requires_provenance_control_replay_and_rate_limits(monkeypatch, tmp_path):
    scope = _scope("tenant-feedback", "agent-feedback", "openclaw-feedback-session")
    other_scope = _scope("tenant-other", "agent-other", "openclaw-feedback-session")
    credentials = {
        "credential-feedback": {"secret": "secret-feedback", "allowed_scopes": [scope]},
        "credential-other": {"secret": "secret-other", "allowed_scopes": [other_scope]},
    }
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", json.dumps(credentials))
    monkeypatch.setenv("NEXUS_OUTCOME_FEEDBACK_TOKEN", "feedback-control")
    monkeypatch.setenv(
        "NEXUS_OUTCOME_FEEDBACK_SIGNING_KEY",
        "server-only-feedback-signing-key-for-receipt-test",
    )
    monkeypatch.setenv("NEXUS_OUTCOME_FEEDBACK_RATE_LIMIT", "1")
    monkeypatch.setattr(nexus, "_OUTCOME_FEEDBACK_RECEIPT_STATE_PATH", tmp_path / "receipts.json")

    headers = _credential_headers(
        scope,
        credential_id="credential-feedback",
        secret="secret-feedback",
        outcome_token="feedback-control",
    )
    request = _request(
        headers,
        state=SimpleNamespace(cortex_write_authorization="write_token"),
    )
    principal, _ = nexus._authenticated_nexus_principal(request, session_hint=scope["session_id"])

    observed = []

    class _Tuner:
        artifact_dir = tmp_path

        def observe(self, record):
            observed.append(dict(record))
            return {"decision": {"stage": "shadow"}}

    codec_calls = []
    monkeypatch.setattr(nexus, "_outcome_tuner_for_scope", lambda _scope: _Tuner())
    monkeypatch.setattr(
        nexus,
        "_apply_codec_outcome_projection",
        lambda scope, event, receipt_id: codec_calls.append(
            (dict(scope), dict(event), receipt_id)
        )
        or {"state_revision": 7},
    )

    issued = nexus._issue_outcome_feedback_receipt(
        scope=principal.storage_metadata,
        execution_id="executed-request-1",
        query="Plan the observed rollout.",
        task_archetype="planning",
        policy_label="server-observed-policy",
        codec_variant="referents_plus_codec",
        output="Verified final answer from causally observed execution.",
        user_outcome="accepted",
        executed_levels=[9, 24],
        selected_levels=[9, 24, 34],
        plan_digest="d" * 64,
        validator_pass=True,
        recovery_needed=False,
        latency_ms=321,
        outcome_confidence=0.91,
    )

    with pytest.raises(ValidationError):
        nexus.OutcomeFeedbackReceiptRequest(
            receipt=issued["receipt"],
            policy_label="caller-forged-policy",
        )

    unauthorized = _request(
        {**headers, "x-cortex-outcome-feedback-token": ""},
        state=request.state,
    )
    with pytest.raises(HTTPException) as denied:
        await nexus.outcome_feedback(nexus.OutcomeFeedbackReceiptRequest(receipt=issued["receipt"]), unauthorized)
    assert denied.value.status_code == 403

    body, signature = issued["receipt"].split(".", 1)
    tampered = f"{body}.{'A' if signature[0] != 'A' else 'B'}{signature[1:]}"
    with pytest.raises(HTTPException) as invalid_signature:
        await nexus.outcome_feedback(nexus.OutcomeFeedbackReceiptRequest(receipt=tampered), request)
    assert invalid_signature.value.status_code == 403

    other_request = _request(
        _credential_headers(
            other_scope,
            credential_id="credential-other",
            secret="secret-other",
            outcome_token="feedback-control",
        ),
        state=request.state,
    )
    with pytest.raises(HTTPException) as wrong_tenant:
        await nexus.outcome_feedback(nexus.OutcomeFeedbackReceiptRequest(receipt=issued["receipt"]), other_request)
    assert wrong_tenant.value.status_code == 403
    assert wrong_tenant.value.detail["reason"] == "scope_binding_mismatch"

    result = await nexus.outcome_feedback(
        nexus.OutcomeFeedbackReceiptRequest(receipt=issued["receipt"]),
        request,
    )
    assert result["recorded"] is True
    assert result["codec_policy"]["variant"] == "referents_plus_codec"
    assert observed[0]["policy_label"] == "server-observed-policy"
    assert observed[0]["validator_result"] == {"pass": True, "source": "causal_outcome_receipt"}
    assert observed[0]["executed_levels"] == [9, 24]
    assert observed[0]["user_correction"] is False
    assert codec_calls[0][0]["tenant_id"] == principal.tenant_id
    assert codec_calls[0][0]["storage_workspace_id"] == principal.storage_workspace_id
    assert codec_calls[0][2] == issued["payload"]["jti"]

    replay = await nexus.outcome_feedback(
        nexus.OutcomeFeedbackReceiptRequest(receipt=issued["receipt"]), request
    )
    assert replay == result
    assert len(observed) == 1
    assert len(codec_calls) == 1

    second = nexus._issue_outcome_feedback_receipt(
        scope=principal.storage_metadata,
        execution_id="executed-request-2",
        query="Plan the second observed rollout.",
        task_archetype="planning",
        policy_label="server-observed-policy",
        codec_variant="query_only",
        output="Observed failed execution output.",
        user_outcome="failed",
        executed_levels=[24],
        selected_levels=[24],
        plan_digest="e" * 64,
        validator_pass=False,
        recovery_needed=True,
        latency_ms=654,
        outcome_confidence=0.62,
    )
    with pytest.raises(HTTPException) as rate_limited:
        await nexus.outcome_feedback(nexus.OutcomeFeedbackReceiptRequest(receipt=second["receipt"]), request)
    assert rate_limited.value.status_code == 429
    assert rate_limited.value.detail["reason"] == "principal_rate_limit_exceeded"


@pytest.mark.asyncio
async def test_outcome_feedback_resumes_partial_projection_and_replays_exact_result(
    monkeypatch, tmp_path
):
    now = int(nexus.time.time())
    receipt = {
        "version": nexus._OUTCOME_FEEDBACK_RECEIPT_VERSION,
        "jti": "a" * 32,
        "issued_at": now,
        "expires_at": now + 300,
        "execution_id": "execution-partial",
        "query_hash": "b" * 64,
        "task_archetype": "planning",
        "policy_label": "server-policy",
        "codec_variant": "referents_plus_codec",
        "receipt_kind": "causal_outcome",
        "trainable": True,
        "plan_digest": "d" * 64,
        "selected_levels": [9, 24, 34],
        "executed_levels": [9, 24],
        "output_observed": True,
        "output_hash": "c" * 64,
        "user_outcome": "accepted",
        "activation_complete": True,
        "causal_evidence_complete": True,
        "validator_pass": True,
        "recovery_needed": False,
        "latency_ms": 123,
        "outcome_confidence": 0.9,
        "scope": {
            "tenant_id": "tenant-partial",
            "workspace_id": "workspace-partial",
            "agent_id": "agent-partial",
            "user_id": "user-partial",
            "channel_id": "channel-partial",
            "session_id": "session-partial",
            "scope_credential_id": "credential-partial",
            "storage_workspace_id": "workspace-partial",
        },
    }
    monkeypatch.setattr(
        nexus, "_OUTCOME_FEEDBACK_RECEIPT_STATE_PATH", tmp_path / "receipts.json"
    )
    monkeypatch.setattr(nexus, "_require_outcome_feedback_control", lambda _request: None)
    monkeypatch.setattr(
        nexus,
        "_verify_outcome_feedback_receipt",
        lambda _receipt, _request: dict(receipt),
    )
    tuner_calls = []
    codec_calls = []

    def project_tuner(scope, record, receipt_id):
        tuner_calls.append((dict(scope), dict(record), receipt_id))
        return {"decision": {"stage": "shadow"}, "state_path": "state"}

    def project_codec(scope, event, receipt_id):
        codec_calls.append((dict(scope), dict(event), receipt_id))
        if len(codec_calls) == 1:
            raise OSError("injected failure after tuner projection")
        return {"state_revision": 9}

    monkeypatch.setattr(nexus, "_apply_outcome_tuner_projection", project_tuner)
    monkeypatch.setattr(nexus, "_apply_codec_outcome_projection", project_codec)
    payload = nexus.OutcomeFeedbackReceiptRequest(receipt="r" * 32)

    with pytest.raises(HTTPException) as interrupted:
        await nexus.outcome_feedback(payload, object())
    assert interrupted.value.status_code == 503
    partial = json.loads((tmp_path / "receipts.json").read_text(encoding="utf-8"))
    assert partial["entries"][receipt["jti"]]["status"] == "reserved"
    assert set(partial["entries"][receipt["jti"]]["projections"]) == {"tuner"}

    # An incomplete durable reservation remains recoverable after the signed
    # receipt's ordinary admission lifetime; it cannot be re-admitted fresh.
    monkeypatch.setattr(nexus.time, "time", lambda: now + 301)
    recovered = await nexus.outcome_feedback(payload, object())
    replayed = await nexus.outcome_feedback(payload, object())

    assert recovered == replayed
    assert recovered["codec_policy"]["state_revision"] == 9
    assert len(tuner_calls) == 1
    assert len(codec_calls) == 2
    completed = json.loads((tmp_path / "receipts.json").read_text(encoding="utf-8"))
    assert completed["entries"][receipt["jti"]]["status"] == "completed"
    assert completed["entries"][receipt["jti"]]["result"] == recovered


def test_outcome_tuner_projection_is_idempotent_at_target(monkeypatch, tmp_path):
    tuner = nexus.OutcomeTuner(artifact_dir=tmp_path / "tuner")
    monkeypatch.setattr(nexus, "_outcome_tuner_for_scope", lambda _scope: tuner)
    record = {
        "receipt_id": "c" * 32,
        "query": "",
        "task_archetype": "planning",
        "policy_label": "server-policy",
        "execution_success": True,
        "validator_result": {"pass": True},
        "latency_ms": 100,
    }

    first = nexus._apply_outcome_tuner_projection({}, record, record["receipt_id"])
    second = nexus._apply_outcome_tuner_projection({}, record, record["receipt_id"])

    assert second == first
    assert tuner.state["count"] == 1
    assert tuner.state["outcome_feedback_receipt_ids"] == [record["receipt_id"]]
    assert (tmp_path / "tuner/latest.json").is_file()


def test_codec_projection_persists_idempotency_marker_with_outcome(
    monkeypatch, tmp_path
):
    codec = nexus._cortex_codec_module
    durable = {}
    apply_calls = []
    monkeypatch.setattr(
        nexus, "_OUTCOME_FEEDBACK_RECEIPT_STATE_PATH", tmp_path / "receipts.json"
    )
    scoped_calls = []
    monkeypatch.setattr(
        codec,
        "_scoped_codec_session_key",
        lambda session_key, **scope: scoped_calls.append((session_key, scope))
        or "scoped",
    )
    monkeypatch.setattr(codec, "_codec_session_update_lock", lambda _key: threading.RLock())
    monkeypatch.setattr(codec, "get_codec_state", lambda *_args, **_kwargs: dict(durable))

    def apply(previous, event):
        apply_calls.append(dict(event))
        return {**previous, "outcome_state": {"success_count": 1}}

    monkeypatch.setattr(codec, "apply_codec_outcome_feedback", apply)
    monkeypatch.setattr(
        codec, "_enrich_codec_state_with_rollups", lambda _key, state, **_kwargs: state
    )
    session_persist = {}
    monkeypatch.setattr(codec, "_SESSION_CODEC_PERSIST", session_persist)

    def persist(_key, state, **_kwargs):
        durable.clear()
        durable.update(state)
        session_persist["scoped"] = {
            "fingerprint": codec._state_fingerprint(state)
        }
        return {"status": "stored", "id": "codec-snapshot"}

    monkeypatch.setattr(codec, "_persist_codec_state_to_l22", persist)
    monkeypatch.setattr(codec, "_touch_codec_session_locked", lambda _key: None)
    monkeypatch.setattr(codec, "_SESSION_CODEC_STATE", {})
    scope = AuthenticatedMemoryPrincipal(
        credential_id="credential-codec-outcome",
        **_scope("tenant", "agent", "session"),
    ).storage_metadata
    receipt_id = "d" * 32

    first = nexus._apply_codec_outcome_projection(
        scope, {"status": "success", "text": "observed"}, receipt_id
    )
    second = nexus._apply_codec_outcome_projection(
        scope, {"status": "success", "text": "observed"}, receipt_id
    )

    assert first["state_revision"] == second["state_revision"] == 1
    assert apply_calls == [{"status": "success", "text": "observed"}]
    assert durable["outcome_feedback_receipt_ids"] == [receipt_id]
    assert all(call[0].startswith("principal:") for call in scoped_calls)
    assert all(call[1]["tenant_id"] == scope["tenant_id"] for call in scoped_calls)
    assert all(
        call[1]["workspace_id"] == scope["storage_workspace_id"]
        for call in scoped_calls
    )


def test_outcome_tuner_cache_is_principal_scoped(monkeypatch, tmp_path):
    monkeypatch.setenv("NEXUS_OUTCOME_ARTIFACT_DIR", str(tmp_path))
    nexus._PRINCIPAL_OUTCOME_TUNERS.clear()

    tenant_a = nexus._outcome_tuner_for_scope({"tenant_id": "tenant-policy-a"})
    tenant_b = nexus._outcome_tuner_for_scope({"tenant_id": "tenant-policy-b"})
    local_tenant = nexus._outcome_tuner_for_scope({"tenant_id": "cortex-local"})

    assert tenant_a is not tenant_b
    assert tenant_a.state_path != tenant_b.state_path
    assert tenant_a.artifact_dir.parent == tmp_path / "tenants"
    assert tenant_b.artifact_dir.parent == tmp_path / "tenants"
    assert local_tenant.artifact_dir.parent == tmp_path / "tenants"
    nexus._PRINCIPAL_OUTCOME_TUNERS.clear()
