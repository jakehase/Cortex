from __future__ import annotations

import copy
import hashlib
import json
import multiprocessing
import os
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

os.environ["CORTEX_CHROMA_DIR"] = "/tmp/cortex-fanout-review-chroma"
os.environ["LIBRARIAN_FALLBACK_LOG_PATH"] = "/tmp/cortex-fanout-review-chroma/fallback.jsonl"

from cortex_server.middleware.write_authorization import WriteAuthorizationMiddleware
from cortex_server.middleware import event_ledger_middleware
from cortex_server.main import create_app
from cortex_server.modules.memory_scope import memory_scope_signature
from cortex_server.routers import autonomy, knowledge, librarian, nexus
from cortex_server.runtime import RuntimeSoakHarness, agent_acknowledgement_signature
from cortex_server.runtime.production_build_loop import (
    ProductionBuildContract,
    ProductionStageGate,
    _stage_gate_for,
)
from cortex_server.runtime.release_workflow import (
    ReleaseArtifactReceipt,
    ReleaseWorkflowState,
    create_release_artifact_receipt,
    evaluate_release_promotion_gate,
    record_release_artifact_receipt,
    release_artifact_attestation_signature,
)
from cortex_server.runtime.shared_process_state import (
    SharedProcessState,
    SharedProcessStateStore,
    SharedStateConflictError,
)


IMAGE_DIGEST = "sha256:" + "d" * 64
IMAGE_REF = f"registry.example/cortex@{IMAGE_DIGEST}"


class _ScopedCollection:
    def __init__(self):
        self.rows = {}

    def add(self, ids, documents, metadatas):
        for row_id, document, metadata in zip(ids, documents, metadatas):
            self.rows[row_id] = {"document": document, "metadata": copy.deepcopy(metadata)}

    def get(self, ids=None, where=None, where_document=None, **_kwargs):
        selected = list(self.rows)
        if ids is not None:
            selected = [row_id for row_id in ids if row_id in self.rows]
        if where:
            selected = [
                row_id for row_id in selected
                if all(self.rows[row_id]["metadata"].get(key) == value for key, value in where.items())
            ]
        if where_document:
            needle = str(where_document.get("$contains") or "")
            selected = [row_id for row_id in selected if needle in self.rows[row_id]["document"]]
        return {
            "ids": selected,
            "documents": [self.rows[row_id]["document"] for row_id in selected],
            "metadatas": [copy.deepcopy(self.rows[row_id]["metadata"]) for row_id in selected],
        }

    def query(self, **kwargs):
        rows = self.get(where=kwargs.get("where"))
        return {
            "ids": [rows["ids"]],
            "documents": [rows["documents"]],
            "metadatas": [rows["metadatas"]],
            "distances": [[0.1 for _ in rows["ids"]]],
        }


def _principal(agent: str, session: str) -> dict[str, str]:
    return {
        "tenant_id": "tenant-shared",
        "workspace_id": "workspace-shared",
        "agent_id": agent,
        "user_id": f"user-{agent}",
        "channel_id": "channel-shared",
        "session_id": session,
    }


def _shared_state_cas_writer(store_path: str, start_fd: int, revision: str, result_path: str) -> None:
    os.read(start_fd, 1)
    store = SharedProcessStateStore(store_path)
    try:
        store.save(
            SharedProcessState(process_id="proc-cas", revision_id=revision),
            expected_revision_id="rev-1",
        )
        outcome = "saved"
    except SharedStateConflictError:
        outcome = "conflict"
    Path(result_path).write_text(outcome, encoding="utf-8")


@pytest.mark.asyncio
async def test_knowledge_to_librarian_enforces_every_principal_dimension(monkeypatch, tmp_path):
    scope_a = _principal("agent-a", "session-a")
    scope_b = _principal("agent-b", "session-b")
    credentials = {
        "credential-a": {"secret": "secret-a", "allowed_scopes": [scope_a]},
        "credential-b": {"secret": "secret-b", "allowed_scopes": [scope_b]},
    }
    monkeypatch.setenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", json.dumps(credentials))
    monkeypatch.setenv("CORTEX_FACT_SUPERSESSION_JOURNAL_DIR", str(tmp_path / "journals"))
    fake = _ScopedCollection()
    monkeypatch.setattr(librarian, "collection", fake)

    principals = []
    for credential_id, secret, scope, row_id in (
        ("credential-a", "secret-a", scope_a, "memory-a"),
        ("credential-b", "secret-b", scope_b, "memory-b"),
    ):
        signature = memory_scope_signature(**scope, credential_id=credential_id, secret=secret)
        principal = librarian._authenticated_memory_principal_scope(
            scope["tenant_id"],
            scope["workspace_id"],
            signature,
            scope=scope,
            scope_credential_id=credential_id,
        )
        principals.append((principal, signature, credential_id, scope))
        fake.add(
            [row_id],
            [f"private marker owned by {scope['agent_id']}"],
            [librarian._normalize_memory_metadata(principal.storage_metadata, tenant_id=principal.tenant_id, workspace_id=principal.storage_workspace_id)],
        )

    principal_a, signature_a, credential_a, _ = principals[0]
    response = await knowledge.search_knowledge(
        knowledge.KnowledgeSearchRequest(
            query="private marker",
            tenant_id=scope_a["tenant_id"],
            workspace_id=scope_a["workspace_id"],
            scope=scope_a,
            scope_credential_id=credential_a,
            scope_signature=signature_a,
            n_results=10,
        )
    )

    assert [row["id"] for row in response["results"]] == ["memory-a"]
    assert response["results"][0]["metadata"]["agent_id"] == "agent-a"
    assert principal_a.storage_workspace_id != principals[1][0].storage_workspace_id


def test_scope_credential_cannot_escape_its_allowed_principal(monkeypatch):
    allowed = _principal("agent-a", "session-a")
    escaped = {**allowed, "agent_id": "agent-b"}
    monkeypatch.setenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", json.dumps({
        "credential-a": {"secret": "secret-a", "allowed_scopes": [allowed]},
    }))
    forged = memory_scope_signature(**escaped, credential_id="credential-a", secret="secret-a")
    with pytest.raises(Exception, match="not authorized"):
        librarian._authenticated_memory_principal_scope(
            escaped["tenant_id"],
            escaped["workspace_id"],
            forged,
            scope=escaped,
            scope_credential_id="credential-a",
        )


@pytest.mark.asyncio
async def test_codec_control_plane_requires_admin_even_for_get():
    middleware = WriteAuthorizationMiddleware(
        lambda *_args, **_kwargs: None,
        mode="disabled",
        sensitive_prefixes=("/nexus/codec",),
        sensitive_token="codec-admin",
    )

    async def allowed(_request):
        return "allowed"

    denied_request = SimpleNamespace(
        url=SimpleNamespace(path="/nexus/codec/status"),
        method="GET",
        headers={},
        state=SimpleNamespace(),
    )
    denied = await middleware.dispatch(denied_request, allowed)
    assert denied.status_code == 403

    authorized_request = SimpleNamespace(
        url=SimpleNamespace(path="/nexus/codec/status"),
        method="GET",
        headers={"x-cortex-codec-admin-token": "codec-admin"},
        state=SimpleNamespace(),
    )
    assert await middleware.dispatch(authorized_request, allowed) == "allowed"


@pytest.mark.asyncio
async def test_independent_handoff_hmac_routes_do_not_require_global_write_token():
    middleware = WriteAuthorizationMiddleware(
        lambda *_args, **_kwargs: None,
        mode="token_required",
        token="global-write-token",
        exempt_prefixes=("/orchestrator/runtime/delivery/handoffs",),
    )

    async def allowed(_request):
        return "recipient-hmac-handler"

    request = SimpleNamespace(
        url=SimpleNamespace(path="/orchestrator/runtime/delivery/handoffs/claim-next"),
        method="POST",
        headers={},
        state=SimpleNamespace(),
        client=SimpleNamespace(host="10.0.0.8"),
    )
    assert await middleware.dispatch(request, allowed) == "recipient-hmac-handler"


def test_codec_execution_and_evaluation_routes_are_post_only():
    methods = {route.path: set(route.methods or ()) for route in nexus.router.routes}
    for path in (
        "/codec/evaluate",
        "/codec/corpus-replay/reexecute",
        "/codec/corpus-replay/live-reexecute",
        "/codec/corpus-replay/live-reexecute/compare",
        "/codec/corpus-replay/scheduler",
    ):
        assert methods[path] == {"POST"}


@pytest.mark.asyncio
async def test_codec_events_hydrate_the_same_live_nexus_session(monkeypatch):
    session_key = f"openclaw-{hashlib.sha256(b'codec-e2e-session').hexdigest()}"
    scope = _principal("codec-agent", session_key)
    stored = {}

    def update_state(key, events, **scope_kwargs):
        stored[(scope_kwargs.get("tenant_id"), scope_kwargs.get("workspace_id"), key)] = list(events)
        return {"durable_write": {"fingerprint": "test-fingerprint"}}

    def get_packet(key, **scope_kwargs):
        events = stored.get((scope_kwargs.get("tenant_id"), scope_kwargs.get("workspace_id"), key), [])
        packet = "\n".join(str(event.get("text") or "") for event in events)
        return {"available": bool(packet), "packet": packet, "summary": packet, "durable": {}}

    async def direct_call(function, *args, **kwargs):
        return function(*args, **kwargs)

    monkeypatch.setenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", json.dumps({
        "codec-bridge": {"secret": "codec-secret", "allowed_scopes": [scope]},
    }))
    monkeypatch.setattr(nexus, "update_codec_state_for_session", update_state)
    monkeypatch.setattr(nexus, "get_codec_packet_for_session", get_packet)
    monkeypatch.setattr(nexus, "get_codec_session_telemetry", lambda key: {"session_key": key})
    monkeypatch.setattr(nexus, "run_in_threadpool", direct_call)
    signature = memory_scope_signature(
        **scope,
        credential_id="codec-bridge",
        secret="codec-secret",
    )
    request = SimpleNamespace(headers={"x-session-id": session_key}, client=SimpleNamespace(host="127.0.0.1"))
    response = await nexus.post_nexus_codec_events(
        nexus.CodecEventsRequest(
            session_key=session_key,
            events=[{"text": "continuity codeword cobalt-river-731"}],
            tenant_id=scope["tenant_id"],
            workspace_id=scope["workspace_id"],
            scope=scope,
            scope_credential_id="codec-bridge",
            scope_signature=signature,
        ),
        request,
    )
    principal = librarian._authenticated_memory_principal_scope(
        scope["tenant_id"],
        scope["workspace_id"],
        signature,
        scope=scope,
        scope_credential_id="codec-bridge",
    )
    live_packet = nexus._codec_context_packet(
        session_key,
        query="cobalt river",
        tenant_id=principal.tenant_id,
        workspace_id=principal.storage_workspace_id,
        telemetry_session_key=nexus._principal_continuity_key(principal, session_key),
    )

    assert response["success"] is True
    assert live_packet["available"] is True
    assert "cobalt-river-731" in live_packet["packet"] or "cobalt-river-731" in live_packet["summary"]


def test_release_gates_cannot_remove_mandatory_evidence():
    contract = ProductionBuildContract(
        process_id="proc-gates",
        objective="ship",
        dependability_profile="24h",
        stage_gates=[
            ProductionStageGate(
                stage="production",
                required_fencepost_stages=[],
                required_artifacts=[],
                required_handoff_count=0,
                require_dependability=False,
            )
        ],
    )
    gate = _stage_gate_for(contract, "production")
    assert gate.require_dependability is True
    assert gate.required_handoff_count == 1
    assert "canary_verified" in gate.required_fencepost_stages
    assert f"artifact_release_bundle:{contract.process_id}" in gate.required_artifacts
    assert f"artifact_smoke_report:{contract.process_id}" in gate.required_artifacts


def test_release_gate_rejects_bare_and_stale_artifact_ids(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    seeded = harness._seed_waiting_process(
        process_id="proc-artifacts", revision_id="rev-1", node_id="build", agent_id="builder"
    )
    artifact_id = "artifact_release_bundle:proc-artifacts"
    seeded["snapshot"].artifact_refs.append(artifact_id)
    state = ReleaseWorkflowState(
        process_id="proc-artifacts",
        candidate_ref="candidate:new",
        target_environment="production",
        revision_id="rev-1",
    )
    stale = {
        "artifact_id": artifact_id,
        "content_hash": f"sha256:{hashlib.sha256(b'stale').hexdigest()}",
        "candidate_ref": "candidate:old",
        "release_id": state.release_id,
        "revision_id": "rev-1",
        "producer": "builder",
        "validation_outcome": "passed",
        "created_at": state.updated_at,
    }
    state.metadata["release_artifacts"] = [stale]
    blocked = evaluate_release_promotion_gate(
        state=state,
        snapshot=seeded["snapshot"],
        shared_state=seeded["shared_state"],
        target_stage="canary_verified",
        dependability_report={"success": True},
        required_artifacts=[artifact_id],
    )
    assert blocked["checks"]["artifacts_ready"] is False

    artifact_store = harness.release_store.artifact_store()
    receipt = create_release_artifact_receipt(
        state.model_copy(update={"metadata": {}}),
        artifact_store=artifact_store,
        artifact_id=artifact_id,
        payload=b"current immutable build output",
        artifact_kind="release_bundle",
        producer="builder",
        verifier="independent-verifier",
        verifier_secret="verifier-secret",
        claims={"image_ref": IMAGE_REF, "image_digest": IMAGE_DIGEST},
    )
    state = record_release_artifact_receipt(
        state.model_copy(update={"metadata": {}}),
        receipt,
        artifact_store=artifact_store,
        verifier_credentials={"independent-verifier": "verifier-secret"},
    )
    ready = evaluate_release_promotion_gate(
        state=state,
        snapshot=seeded["snapshot"],
        shared_state=seeded["shared_state"],
        target_stage="canary_verified",
        dependability_report={"success": True},
        required_artifacts=[artifact_id],
        artifact_store=artifact_store,
        verifier_credentials={"independent-verifier": "verifier-secret"},
    )
    assert ready["checks"]["artifacts_ready"] is True


def test_release_receipt_recomputes_signed_hash_from_immutable_output(tmp_path):
    state = ReleaseWorkflowState(
        process_id="proc-forged-artifact",
        candidate_ref="candidate:forged",
        target_environment="production",
        revision_id="rev-1",
    )
    artifact_store = RuntimeSoakHarness(tmp_path / "soak").release_store.artifact_store()
    fabricated_hash = f"sha256:{hashlib.sha256(b'fabricated').hexdigest()}"
    unsigned = {
        "artifact_id": "artifact_release_bundle:proc-forged-artifact",
        "artifact_ref": fabricated_hash,
        "content_hash": fabricated_hash,
        "artifact_kind": "release_bundle",
        "target_stage": None,
        "candidate_ref": state.candidate_ref,
        "release_id": state.release_id,
        "revision_id": state.revision_id,
        "producer": "builder",
        "verifier": "independent-verifier",
        "validation_outcome": "passed",
        "claims": {},
        "created_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }
    receipt = ReleaseArtifactReceipt(
        **unsigned,
        attestation_signature=release_artifact_attestation_signature(unsigned, secret="verifier-secret"),
    )

    with pytest.raises(FileNotFoundError, match="immutable release artifact not found"):
        record_release_artifact_receipt(
            state,
            receipt,
            artifact_store=artifact_store,
            verifier_credentials={"independent-verifier": "verifier-secret"},
        )

    self_attested = create_release_artifact_receipt(
        state,
        artifact_store=artifact_store,
        artifact_id="artifact_smoke_report:proc-forged-artifact",
        payload={"result": "passed"},
        artifact_kind="smoke_report",
        producer="builder",
        verifier="builder",
        verifier_secret="builder-secret",
    )
    with pytest.raises(PermissionError, match="cannot self-verify"):
        record_release_artifact_receipt(
            state,
            self_attested,
            artifact_store=artifact_store,
            verifier_credentials={"builder": "builder-secret"},
        )


def test_release_ack_requires_intended_recipient_and_bound_evidence(monkeypatch, tmp_path):
    mailbox = RuntimeSoakHarness(tmp_path / "soak").mailbox
    message = mailbox.send(
        process_id="proc-ack",
        from_agent="controller",
        to_agent="release-manager",
        revision_id="rev-1",
        metadata={"target_stage": "production", "candidate_ref": "candidate", "release_id": "release"},
    )
    mailbox.receive(to_agent="release-manager", process_id="proc-ack")
    with pytest.raises(PermissionError):
        mailbox.acknowledge(message.message_id, actor="controller")
    with pytest.raises(ValueError, match="evidence"):
        mailbox.acknowledge(
            message.message_id,
            actor="release-manager",
            result_receipt={
                "candidate_ref": "candidate", "release_id": "release", "revision_id": "rev-1", "result": "approved",
            },
        )
    receipt = {
        "candidate_ref": "candidate",
        "release_id": "release",
        "revision_id": "rev-1",
        "result": "approved",
        "evidence_receipts": ["evidence:recipient-verification"],
    }
    monkeypatch.setenv("CORTEX_ENV", "production")
    recipient_secret = "recipient-secret-00000000000000000001"
    monkeypatch.setenv("CORTEX_AGENT_ACK_CREDENTIALS", json.dumps({"release-manager": recipient_secret}))
    with pytest.raises(PermissionError, match="authenticated recipient signature"):
        mailbox.acknowledge(message.message_id, actor="release-manager", result_receipt=receipt)
    signature = agent_acknowledgement_signature(
        message,
        actor="release-manager",
        result_receipt=receipt,
        secret=recipient_secret,
    )
    acknowledged = mailbox.acknowledge(
        message.message_id,
        actor="release-manager",
        result_receipt=receipt,
        actor_signature=signature,
    )
    assert acknowledged.ack_receipt["authentication"] == "hmac-sha256"


@pytest.mark.asyncio
async def test_autonomy_status_fails_closed_on_unknown_or_dropped_durability(monkeypatch):
    monkeypatch.setattr(autonomy, "_load_state", lambda: autonomy._default_state())
    monkeypatch.setattr(autonomy, "get_event_health", lambda **_kwargs: {
        "status": "degraded",
        "durable": {"status": "degraded", "writes_succeeded": 2, "write_failures": 0, "records_dropped": 1},
    })
    status = await autonomy.autonomy_status()
    assert status["success"] is False
    assert status["status"] == "degraded"
    assert status["pillars"]["one_nervous_system"] is False


@pytest.mark.asyncio
async def test_readiness_and_health_fail_when_memory_durability_probe_fails(monkeypatch):
    monkeypatch.setattr(event_ledger_middleware, "probe_event_ledger_durability", lambda: {"ok": True, "status": "healthy"})
    monkeypatch.setattr(librarian, "probe_memory_backend_readiness", lambda: {"ok": False, "status": "degraded", "error": "disk unavailable"})
    app = create_app()
    endpoints = {route.path: route.endpoint for route in app.routes if hasattr(route, "endpoint")}

    ready_response = await endpoints["/ready"]()
    ready_payload = json.loads(ready_response.body)
    health_response = await endpoints["/health"]()
    health_payload = json.loads(health_response.body)

    assert ready_response.status_code == 503
    assert ready_payload["checks"]["eventLedgerDurability"]["ok"] is True
    assert ready_payload["checks"]["memoryBackendDurability"]["ok"] is False
    assert health_response.status_code == 503
    assert health_payload["one_brain"]["memory_backend"] is False


def test_memory_readiness_actively_rejects_unwritable_chroma(monkeypatch):
    class UnwritableProbeCollection:
        def upsert(self, **_kwargs):
            raise PermissionError("database is read-only")

        def delete(self, **_kwargs):
            return None

    monkeypatch.setattr(librarian, "_validate_chroma_storage", lambda _path: None)
    monkeypatch.setattr(librarian, "collection", SimpleNamespace(count=lambda: 1))
    monkeypatch.setattr(
        librarian,
        "client",
        SimpleNamespace(get_or_create_collection=lambda **_kwargs: UnwritableProbeCollection()),
    )

    readiness = librarian.probe_memory_backend_readiness()
    assert readiness["ok"] is False
    assert readiness["status"] == "degraded"
    assert "read-only" in readiness["error"]


def test_shared_state_cas_is_serialized_across_worker_processes(tmp_path):
    store_path = tmp_path / "state"
    store = SharedProcessStateStore(store_path)
    store.save(SharedProcessState(process_id="proc-cas", revision_id="rev-1"))
    context = multiprocessing.get_context("fork")
    start_fd, release_fd = os.pipe()
    result_paths = [tmp_path / f"{revision}.result" for revision in ("rev-2a", "rev-2b")]
    processes = [
        context.Process(
            target=_shared_state_cas_writer,
            args=(str(store_path), start_fd, revision, str(result_path)),
        )
        for revision, result_path in zip(("rev-2a", "rev-2b"), result_paths)
    ]
    for process in processes:
        process.start()
    os.write(release_fd, b"xx")
    os.close(release_fd)
    os.close(start_fd)
    for process in processes:
        process.join(timeout=5)
        assert process.exitcode == 0

    outcomes = [result_path.read_text(encoding="utf-8") for result_path in result_paths]

    assert sorted(outcomes) == ["conflict", "saved"]
    assert len(store.history("proc-cas")) == 2
    json.loads(store._target("proc-cas").read_text())
