import asyncio
from concurrent.futures import ThreadPoolExecutor
import httpx
import multiprocessing
import json
from pathlib import Path
import pytest
from fastapi import FastAPI
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import types
import uvicorn

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.runtime.assurance_receipt_ledger import (
    AssuranceReceiptLedgerUnavailable,
    assurance_receipt_status,
    consumed_assurance_receipt_result,
    finalize_assurance_receipt,
    recover_assurance_receipt,
    reserve_assurance_receipt,
)
import cortex_server.runtime.assurance_receipt_ledger as assurance_ledger


class _Recorder:
    def __init__(self):
        self.calls = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "id": "mem-123",
            "status": "stored",
            "metadata": kwargs.get("metadata", {}),
        }


@pytest.fixture(autouse=True)
def _isolated_assurance_receipt_ledger(monkeypatch, tmp_path):
    monkeypatch.setattr(
        nexus, "_ASSURANCE_RECEIPT_STATE_PATH", tmp_path / "assurance-receipts.sqlite3"
    )


def _concurrent_commit(app, payload, barrier):
    barrier.wait(timeout=5)

    async def send():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            response = await client.post("/nexus/commit", json=payload)
            return response.status_code, response.json()

    return asyncio.run(send())


def _reserve_in_worker(state_path, start_event, results):
    start_event.wait(timeout=5)
    try:
        reserve_assurance_receipt(
            Path(state_path),
            scope={
                "tenant_id": "tenant",
                "workspace_id": "workspace",
                "user_id": "user",
            },
            jti="a" * 32,
            expires_at=int(time.time()) + 60,
        )
        results.put("reserved")
    except Exception as exc:  # pragma: no branch - result is asserted by the parent
        results.put(str(exc))


def _app(monkeypatch, recorder):
    fake_l22 = types.ModuleType("cortex_server.routers.l22")
    committed = {}

    def store_memory_record(**kwargs):
        result = recorder(**kwargs)
        if str((result or {}).get("status") or "") in {"stored", "stored_below_threshold"}:
            committed[str(kwargs.get("idempotency_key") or "")] = (kwargs, dict(result))
        return result

    def lookup_idempotent_memory_record(**kwargs):
        prior = committed.get(str(kwargs.get("idempotency_key") or ""))
        if prior is None:
            return None
        prior_request, prior_result = prior
        assert prior_request == kwargs
        return {**prior_result, "idempotent_replay": True}

    fake_l22.store_memory_record = store_memory_record
    fake_l22.lookup_idempotent_memory_record = lookup_idempotent_memory_record
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", fake_l22)
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    return app


async def _receipt(client, payload, headers=None):
    response = await client.post(
        "/nexus/assurance/receipt", json=payload, headers=headers or {}
    )
    assert response.status_code == 200, response.text
    return response.json()["receipt"]


@pytest.mark.asyncio
async def test_commit_writes_to_l22_when_assurance_allows(monkeypatch):
    recorder = _Recorder()
    app = _app(monkeypatch, recorder)
    interaction = {
        "query": "Remember this deployment decision",
        "response": "Use the safe rollback path and preserve the backup branch.",
        "levels_used": [7, 22],
    }
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        receipt = await _receipt(client, interaction)
        r = await client.post(
            "/nexus/commit",
            json={
                **interaction,
                "assurance_receipt": receipt,
                "metadata": {
                    "validator_result": {
                        "pass": False,
                        "checks": {"overclaim_detected": True},
                    },
                    "risk_flags": ["legal"],
                    "query": "forged query",
                    "source": "caller.forged",
                    "assurance": {"validator_pass": False},
                    "client_note": "keep this non-reserved field",
                },
            },
        )
        replay = await client.post(
            "/nexus/commit",
            json={**interaction, "assurance_receipt": receipt},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["committed"] is True
    assert body["durable_write"]["status"] == "stored"
    assert body["assurance"]["memory_commit"]["eligible"] is True
    assert replay.status_code == 200
    assert replay.json() == body
    assert len(recorder.calls) == 1
    assert recorder.calls[0]["tenant_id"] == "cortex-local"
    assert recorder.calls[0]["workspace_id"] == "default"
    assert recorder.calls[0]["idempotency_key"]
    stored_metadata = recorder.calls[0]["metadata"]
    assert stored_metadata["query"] == interaction["query"]
    assert stored_metadata["source"] == "nexus.commit"
    assert stored_metadata["assurance"]["validator_pass"] is True
    assert stored_metadata["assurance"]["receipt_version"] == "nexus.commit-receipt.v1"
    assert (
        recorder.calls[0]["idempotency_key"]
        == stored_metadata["assurance"]["receipt_id"]
    )
    assert (
        recorder.calls[0]["idempotency_key"]
        == nexus._decode_assurance_receipt(receipt)["jti"]
    )
    assert stored_metadata["client_note"] == "keep this non-reserved field"


@pytest.mark.asyncio
async def test_commit_rejects_alternate_idempotency_identity_without_consuming_receipt(
    monkeypatch,
):
    recorder = _Recorder()
    app = _app(monkeypatch, recorder)
    interaction = {
        "query": "Remember this deployment decision",
        "response": "Use the safe rollback path and preserve the backup branch.",
        "levels_used": [7, 22],
    }
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        receipt = await _receipt(client, interaction)
        forged = await client.post(
            "/nexus/commit",
            json={
                **interaction,
                "assurance_receipt": receipt,
                "metadata": {"idempotency_key": "caller-selected-durable-identity"},
            },
        )
        valid = await client.post(
            "/nexus/commit",
            json={**interaction, "assurance_receipt": receipt},
        )

    assert forged.status_code == 422
    assert (
        forged.json()["detail"]["error"] == "signed_receipt_identity_override_forbidden"
    )
    assert valid.status_code == 200
    assert len(recorder.calls) == 1
    signed_jti = nexus._decode_assurance_receipt(receipt)["jti"]
    assert recorder.calls[0]["idempotency_key"] == signed_jti
    assert recorder.calls[0]["metadata"]["assurance"]["receipt_id"] == signed_jti


@pytest.mark.asyncio
async def test_failed_durable_write_releases_only_its_receipt_reservation(monkeypatch):
    class _FailThenStore(_Recorder):
        def __call__(self, **kwargs):
            self.calls.append(kwargs)
            if len(self.calls) == 1:
                return {"status": "write_failed", "error": "temporary storage outage"}
            return {
                "id": "mem-retry",
                "status": "stored",
                "metadata": kwargs.get("metadata", {}),
            }

    recorder = _FailThenStore()
    app = _app(monkeypatch, recorder)
    interaction = {
        "query": "Remember this deployment decision",
        "response": "Use the safe rollback path and preserve the backup branch.",
        "levels_used": [7, 22],
    }
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        receipt = await _receipt(client, interaction)
        first = await client.post(
            "/nexus/commit", json={**interaction, "assurance_receipt": receipt}
        )
        retry = await client.post(
            "/nexus/commit", json={**interaction, "assurance_receipt": receipt}
        )
        replay = await client.post(
            "/nexus/commit", json={**interaction, "assurance_receipt": receipt}
        )

    assert first.status_code == 200
    assert first.json()["committed"] is False
    assert retry.status_code == 200
    assert retry.json()["committed"] is True
    assert replay.status_code == 200
    assert replay.json() == retry.json()
    assert len(recorder.calls) == 2
    assert recorder.calls[0]["idempotency_key"] == recorder.calls[1]["idempotency_key"]


@pytest.mark.asyncio
async def test_finalization_failure_retains_reservation_after_durable_write(
    monkeypatch,
):
    recorder = _Recorder()
    app = _app(monkeypatch, recorder)
    interaction = {
        "query": "Remember this deployment decision",
        "response": "Use the safe rollback path and preserve the backup branch.",
        "levels_used": [7, 22],
    }

    original_finalize = nexus.finalize_assurance_receipt
    failures = {"remaining": 1}

    def fail_finalization_once(*args, **kwargs):
        if failures["remaining"]:
            failures["remaining"] -= 1
            raise nexus.AssuranceReceiptLedgerUnavailable("simulated_finalization_failure")
        return original_finalize(*args, **kwargs)

    monkeypatch.setattr(nexus, "finalize_assurance_receipt", fail_finalization_once)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        receipt = await _receipt(client, interaction)
        first = await client.post(
            "/nexus/commit", json={**interaction, "assurance_receipt": receipt}
        )
        replay = await client.post(
            "/nexus/commit", json={**interaction, "assurance_receipt": receipt}
        )

    assert first.status_code == 503
    assert first.json()["detail"]["error"] == "assurance_receipt_finalization_failed"
    assert replay.status_code == 200
    assert replay.json()["committed"] is True
    assert replay.json()["durable_write"]["idempotent_replay"] is False
    assert len(recorder.calls) == 1


@pytest.mark.asyncio
async def test_concurrent_commit_reserves_signed_jti_before_durable_write(monkeypatch):
    class _SlowRecorder(_Recorder):
        def __call__(self, **kwargs):
            self.calls.append(kwargs)
            time.sleep(0.1)
            return {
                "id": "mem-concurrent",
                "status": "stored",
                "metadata": kwargs.get("metadata", {}),
            }

    recorder = _SlowRecorder()
    app = _app(monkeypatch, recorder)
    interaction = {
        "query": "Remember this deployment decision",
        "response": "Use the safe rollback path and preserve the backup branch.",
        "levels_used": [7, 22],
    }
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        receipt = await _receipt(client, interaction)
    payload = {**interaction, "assurance_receipt": receipt}
    barrier = threading.Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(lambda _: _concurrent_commit(app, payload, barrier), range(2))
        )

    assert sorted(status for status, _body in results) == [200, 409]
    rejected = next(body for status, body in results if status == 409)
    assert rejected["detail"]["reason"] == "receipt_commit_in_progress"
    assert len(recorder.calls) == 1


def test_receipt_reservation_is_atomic_across_worker_processes(tmp_path):
    context = multiprocessing.get_context("spawn")
    start_event = context.Event()
    results = context.Queue()
    state_path = tmp_path / "multi-worker-assurance-receipts.sqlite3"
    workers = [
        context.Process(
            target=_reserve_in_worker, args=(str(state_path), start_event, results)
        )
        for _ in range(2)
    ]
    for worker in workers:
        worker.start()
    start_event.set()
    outcomes = [results.get(timeout=10) for _ in workers]
    for worker in workers:
        worker.join(timeout=10)
        assert worker.exitcode == 0

    assert sorted(outcomes) == ["receipt_commit_in_progress", "reserved"]


def test_ledger_compacts_expired_consumed_results_and_enforces_multi_tenant_quota(tmp_path, monkeypatch):
    state_path = tmp_path / "bounded-assurance-receipts.sqlite3"
    scope_a = {"tenant_id": "tenant-a", "workspace_id": "workspace", "user_id": "user"}
    scope_b = {"tenant_id": "tenant-b", "workspace_id": "workspace", "user_id": "user"}
    first = reserve_assurance_receipt(
        state_path,
        scope=scope_a,
        jti="a" * 32,
        expires_at=100,
        now=90,
    )
    finalize_assurance_receipt(state_path, first, result={"committed": True}, now=91)
    monkeypatch.setattr(assurance_ledger, "_CONSUMED_RETENTION_AFTER_EXPIRY_SECONDS", 0)
    monkeypatch.setattr(assurance_ledger, "_MAX_LEDGER_ROWS", 2)
    reserve_assurance_receipt(
        state_path,
        scope=scope_a,
        jti="b" * 32,
        expires_at=1_000,
        now=101,
    )
    reserve_assurance_receipt(
        state_path,
        scope=scope_b,
        jti="c" * 32,
        expires_at=1_000,
        now=101,
    )
    with pytest.raises(AssuranceReceiptLedgerUnavailable, match="global_quota"):
        reserve_assurance_receipt(
            state_path,
            scope={"tenant_id": "tenant-c", "workspace_id": "workspace", "user_id": "user"},
            jti="d" * 32,
            expires_at=1_000,
            now=101,
        )
    with sqlite3.connect(state_path) as connection:
        rows = connection.execute(
            "SELECT jti, status FROM assurance_receipt_ledger ORDER BY jti"
        ).fetchall()
    assert rows == [("b" * 32, "reserved"), ("c" * 32, "reserved")]


def test_receipt_admission_reserves_result_bytes_and_recovery_uses_separate_capacity(
    tmp_path,
    monkeypatch,
):
    state_path = tmp_path / "result-capacity-assurance-receipts.sqlite3"
    scope = {"tenant_id": "tenant", "workspace_id": "workspace", "user_id": "user"}
    monkeypatch.setattr(assurance_ledger, "_MAX_RESULT_BYTES", 100)
    monkeypatch.setattr(assurance_ledger, "_MAX_RESULT_STORAGE_BYTES", 150)
    monkeypatch.setattr(assurance_ledger, "_MAX_RECOVERY_RESULT_STORAGE_BYTES", 100)

    first = reserve_assurance_receipt(
        state_path,
        scope=scope,
        jti="result-capacity-1",
        expires_at=1_000,
        now=100,
    )
    with pytest.raises(AssuranceReceiptLedgerUnavailable, match="result_quota"):
        reserve_assurance_receipt(
            state_path,
            scope=scope,
            jti="result-capacity-2",
            expires_at=1_000,
            now=100,
        )

    exact_result = {"committed": True, "receipt": "x" * 50}
    finalize_assurance_receipt(state_path, first, result=exact_result, now=101)
    restored = recover_assurance_receipt(
        state_path,
        scope=scope,
        jti="result-capacity-2",
        restore_expires_at=1_000,
        now=102,
    )
    finalize_assurance_receipt(state_path, restored, result=exact_result, now=103)

    assert consumed_assurance_receipt_result(
        state_path,
        scope=scope,
        jti="result-capacity-1",
    ) == exact_result
    assert consumed_assurance_receipt_result(
        state_path,
        scope=scope,
        jti="result-capacity-2",
    ) == exact_result
    with sqlite3.connect(state_path) as connection:
        rows = connection.execute(
            "SELECT jti, status, result_capacity_bytes, result_capacity_pool "
            "FROM assurance_receipt_ledger ORDER BY jti"
        ).fetchall()
    assert rows == [
        ("result-capacity-1", "consumed", 0, "normal"),
        ("result-capacity-2", "consumed", 0, "recovery"),
    ]


@pytest.mark.parametrize("changed_field", ("session_id", "channel_id"))
def test_adaptive_retrieval_state_isolated_by_full_principal_across_restart(
    tmp_path,
    monkeypatch,
    changed_field,
):
    adaptive_root = tmp_path / "adaptive"
    monkeypatch.setattr(nexus, "_ADAPTIVE_STATE_ROOT", adaptive_root)
    monkeypatch.setattr(nexus, "_ADAPTIVE_POLICY_STATES", {})
    scope_a = {
        "scope_credential_id": "principal-reader-v1",
        "tenant_id": "tenant-a",
        "workspace_id": "workspace-a",
        "agent_id": "agent-a",
        "user_id": "user-a",
        "channel_id": "channel-a",
        "session_id": "session-a",
        "storage_workspace_id": "principal-a",
    }
    scope_b = {
        **scope_a,
        changed_field: f"{changed_field}-b",
        "storage_workspace_id": "principal-b",
    }
    query = "private deployment rollback evidence"
    private_retrieval = [{"content": "session A private retrieval"}]

    legacy_key = nexus._legacy_adaptive_scope_key(scope_a)
    assert legacy_key == nexus._legacy_adaptive_scope_key(scope_b)
    legacy_policies = nexus._PrincipalAdaptivePolicies(legacy_key, adaptive_root)
    legacy_policies.delta.update(query, private_retrieval)

    policies_a = nexus._adaptive_policies_for_scope(scope_a)
    policies_a.delta.update(query, private_retrieval)
    policies_b = nexus._adaptive_policies_for_scope(scope_b)

    assert policies_a.scope_key != policies_b.scope_key
    assert policies_a.root != policies_b.root
    assert policies_b.delta.maybe_reuse_retrieval(query, min_similarity=1.0) == []
    assert not (adaptive_root / legacy_key).exists()
    quarantine = adaptive_root / nexus._ADAPTIVE_LEGACY_QUARANTINE_DIR
    assert any(quarantine.iterdir())

    nexus._ADAPTIVE_POLICY_STATES.clear()
    restarted_b = nexus._adaptive_policies_for_scope(scope_b)
    restarted_a = nexus._adaptive_policies_for_scope(scope_a)
    assert restarted_b.delta.maybe_reuse_retrieval(query, min_similarity=1.0) == []
    assert restarted_a.delta.maybe_reuse_retrieval(query, min_similarity=1.0) == private_retrieval

    rotated_scope_a = {**scope_a, "scope_credential_id": "principal-reader-v2"}
    assert nexus._adaptive_scope_key(rotated_scope_a) == policies_a.scope_key

    monkeypatch.setattr(nexus, "_ADAPTIVE_OBSERVATION_RATES", {})
    monkeypatch.setenv("NEXUS_ADAPTIVE_OBSERVATION_RATE_LIMIT", "1")
    monkeypatch.setenv("NEXUS_ADAPTIVE_GLOBAL_OBSERVATION_RATE_LIMIT", "100")
    assert nexus._adaptive_observation_allowed(scope_a) is True
    assert nexus._adaptive_observation_allowed(scope_b) is False


def test_compacted_stale_reservation_can_restore_and_finalize_exact_durable_outcome(tmp_path, monkeypatch):
    state_path = tmp_path / "restored-assurance-receipts.sqlite3"
    scope = {"tenant_id": "tenant-restore", "workspace_id": "workspace", "user_id": "user"}
    reserve_assurance_receipt(
        state_path,
        scope=scope,
        jti="restore-jti",
        expires_at=100,
        now=90,
    )
    monkeypatch.setattr(assurance_ledger, "_ABANDONED_RETENTION_AFTER_EXPIRY_SECONDS", 0)
    reserve_assurance_receipt(
        state_path,
        scope={"tenant_id": "maintenance", "workspace_id": "workspace", "user_id": "user"},
        jti="maintenance-jti",
        expires_at=1000,
        now=101,
    )
    assert assurance_receipt_status(state_path, scope=scope, jti="restore-jti") is None

    restored = recover_assurance_receipt(
        state_path,
        scope=scope,
        jti="restore-jti",
        restore_expires_at=100,
        now=102,
    )
    exact_result = {"committed": True, "durable_write": {"id": "memory-restored", "status": "stored"}}
    finalize_assurance_receipt(state_path, restored, result=exact_result, now=103)
    assert consumed_assurance_receipt_result(state_path, scope=scope, jti="restore-jti") == exact_result


def test_expired_unknown_reservation_is_never_pruned_into_false_noncommit_proof(tmp_path):
    state_path = tmp_path / "assurance-receipts.sqlite3"
    scope = {
        "tenant_id": "tenant",
        "workspace_id": "workspace",
        "user_id": "user",
    }
    reserve_assurance_receipt(
        state_path,
        scope=scope,
        jti="a" * 32,
        expires_at=100,
        now=50,
    )

    # Reserving a later receipt after the first has expired must not erase the
    # unknown outcome of a potentially committed durable L22 write.
    reserve_assurance_receipt(
        state_path,
        scope=scope,
        jti="b" * 32,
        expires_at=300,
        now=200,
    )
    assert assurance_receipt_status(
        state_path,
        scope=scope,
        jti="a" * 32,
    ) == "reserved"


@pytest.mark.asyncio
async def test_consumed_receipt_survives_router_recreation(monkeypatch):
    recorder = _Recorder()
    first_app = _app(monkeypatch, recorder)
    interaction = {
        "query": "Remember this deployment decision",
        "response": "Use the safe rollback path and preserve the backup branch.",
        "levels_used": [7, 22],
    }
    first_transport = httpx.ASGITransport(app=first_app)
    async with httpx.AsyncClient(
        transport=first_transport, base_url="http://test"
    ) as client:
        receipt = await _receipt(client, interaction)
        committed = await client.post(
            "/nexus/commit", json={**interaction, "assurance_receipt": receipt}
        )
    second_app = _app(monkeypatch, recorder)
    second_transport = httpx.ASGITransport(app=second_app)
    async with httpx.AsyncClient(
        transport=second_transport, base_url="http://test"
    ) as client:
        replay = await client.post(
            "/nexus/commit", json={**interaction, "assurance_receipt": receipt}
        )

    assert committed.status_code == 200
    assert replay.status_code == 200
    assert replay.json() == committed.json()
    assert len(recorder.calls) == 1


@pytest.mark.asyncio
async def test_assurance_receipt_key_id_survives_rotation_and_lost_response(monkeypatch):
    recorder = _Recorder()
    app = _app(monkeypatch, recorder)
    old_key = "old-assurance-signing-key-material-00000001"
    new_key = "new-assurance-signing-key-material-00000002"
    monkeypatch.setenv("NEXUS_ASSURANCE_SIGNING_KEY_ID", "assurance-2026-01")
    monkeypatch.setenv("NEXUS_ASSURANCE_SIGNING_KEY", old_key)
    interaction = {
        "query": "Remember this rotation-safe deployment decision",
        "response": "Retain verify-only keys until every durable memory spool has drained.",
        "levels_used": [7, 22],
    }
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        receipt = await _receipt(client, interaction)
        assert nexus._decode_assurance_receipt(receipt)["signing_key_id"] == "assurance-2026-01"

        monkeypatch.setenv("NEXUS_ASSURANCE_SIGNING_KEY_ID", "assurance-2026-07")
        monkeypatch.setenv("NEXUS_ASSURANCE_SIGNING_KEY", new_key)
        monkeypatch.setenv(
            "NEXUS_ASSURANCE_VERIFY_KEYS",
            json.dumps({"assurance-2026-01": old_key}),
        )
        committed = await client.post(
            "/nexus/commit", json={**interaction, "assurance_receipt": receipt}
        )
        replay = await client.post(
            "/nexus/commit", json={**interaction, "assurance_receipt": receipt}
        )

    assert committed.status_code == 200
    assert replay.json() == committed.json()
    assert len(recorder.calls) == 1


def test_memory_bridge_reuses_durable_nexus_receipt_after_response_loss_and_restart(
    monkeypatch,
    tmp_path,
):
    recorder = _Recorder()
    app = _app(monkeypatch, recorder)
    state_dir = tmp_path / "bridge-state"
    scope_secret = "bridge-integration-scope-secret"
    session_secret = "bridge-integration-session-secret"
    monkeypatch.setenv("NEXUS_ASSURANCE_SIGNING_KEY", "nexus-integration-assurance-signing-key")
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps(
            {
                "bridge-integration": {
                    "secret": scope_secret,
                    "allowed_scopes": [
                        {
                            "tenant_id": "tenant-integration",
                            "workspace_id": "workspace-integration",
                            "agent_id": "main",
                            "user_id": "local-user",
                            "channel_id": "local-channel",
                            "session_id": {
                                "type": "signed_dynamic",
                                "prefix": "openclaw-",
                                "max_length": 128,
                            },
                        }
                    ],
                }
            }
        ),
    )

    class DropFirstCommitResponse:
        def __init__(self, downstream):
            self.downstream = downstream
            self.dropped = False

        async def __call__(self, scope, receive, send):
            if scope.get("path") == "/nexus/commit" and not self.dropped:
                self.dropped = True

                async def discard(_message):
                    return None

                await self.downstream(scope, receive, discard)
                return
            await self.downstream(scope, receive, send)

    wrapped = DropFirstCommitResponse(app)
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    port = listener.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(wrapped, log_level="critical", lifespan="off")
    )
    thread = threading.Thread(
        target=server.run,
        kwargs={"sockets": [listener]},
        daemon=True,
    )
    thread.start()
    deadline = time.monotonic() + 5
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.01)
    assert server.started

    plugin_url = (Path(__file__).resolve().parents[3] / "plugins" / "cortex-memory-bridge" / "index.ts").as_uri()
    config = {
        "baseUrl": f"http://127.0.0.1:{port}",
        "stateDir": str(state_dir),
        "tenantId": "tenant-integration",
        "workspaceId": "workspace-integration",
        "scopeCredentialId": "bridge-integration",
        "scopeHmacSecret": scope_secret,
        "sessionIdentityHmacSecret": session_secret,
        "writeToken": "transport-token-unused-by-test-app",
        "enabledWriteThrough": True,
        "enabledCodecContinuity": False,
        "minDurabilityScore": 0,
        "retryCount": 0,
        "timeoutMs": 2000,
    }
    first_script = f"""
        import plugin from {json.dumps(plugin_url)};
        const handlers = new Map();
        plugin.register({{
          pluginConfig: {json.dumps(config)}, logger: {{ info() {{}}, warn() {{}} }},
          on(name, handler) {{ handlers.set(name, handler); }}, registerMemoryRuntime() {{}}, registerTool() {{}},
        }});
        const context = {{ sessionKey: 'integration-session' }};
        handlers.get('llm_output')({{ content: 'We decided to use the safe rollback path and preserve the verified deployment.' }}, context);
        try {{
          await handlers.get('agent_end')({{ messages: [{{ role: 'user', content: 'Remember this verified deployment decision.' }}] }}, context);
          process.exit(2);
        }} catch (error) {{
          if (!String(error).includes('output retained for retry')) process.exit(3);
        }}
    """
    second_script = f"""
        import fs from 'node:fs'; import path from 'node:path';
        import plugin from {json.dumps(plugin_url)};
        plugin.register({{
          pluginConfig: {json.dumps(config)}, logger: {{ info() {{}}, warn() {{}} }},
          on() {{}}, registerMemoryRuntime() {{}}, registerTool() {{}},
        }});
        const root = path.join({json.dumps(str(state_dir))}, 'lifecycle-principals-v2');
        const pending = () => fs.existsSync(root) && fs.readdirSync(root).some((entry) => fs.existsSync(path.join(root, entry, 'lifecycle-spool.json')));
        const deadline = Date.now() + 4000;
        while (pending() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
        if (pending()) process.exit(4);
    """
    try:
        first = subprocess.run(
            ["node", "--input-type=module", "--eval", first_script],
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        assert first.returncode == 0, first.stderr
        second = subprocess.run(
            ["node", "--input-type=module", "--eval", second_script],
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        assert second.returncode == 0, second.stderr
        assert wrapped.dropped is True
        assert len(recorder.calls) == 1
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        listener.close()


@pytest.mark.asyncio
async def test_commit_rejects_caller_self_attestation_without_server_receipt(
    monkeypatch,
):
    recorder = _Recorder()
    app = _app(monkeypatch, recorder)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post(
            "/nexus/commit",
            json={
                "query": "Remember this",
                "response": "Guaranteed zero-risk legal strategy.",
                "levels_used": [7, 22],
                "metadata": {
                    "validator_result": {
                        "pass": False,
                        "checks": {"overclaim_detected": True},
                    },
                    "risk_flags": ["legal"],
                },
            },
        )
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "valid_server_assurance_receipt_required"
    assert len(recorder.calls) == 0


@pytest.mark.asyncio
async def test_commit_receipt_is_bound_to_response(monkeypatch):
    recorder = _Recorder()
    app = _app(monkeypatch, recorder)
    interaction = {
        "query": "Remember this deployment decision",
        "response": "Use the safe rollback path and preserve the backup branch.",
        "levels_used": [7, 22],
    }
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        receipt = await _receipt(client, interaction)
        response = await client.post(
            "/nexus/commit",
            json={
                **interaction,
                "response": "A tampered response that was never assured by the server.",
                "assurance_receipt": receipt,
            },
        )

    assert response.status_code == 403
    assert response.json()["detail"]["reason"] == "response_binding_mismatch"
    assert recorder.calls == []


@pytest.mark.asyncio
async def test_high_risk_interaction_cannot_receive_commit_receipt(monkeypatch):
    recorder = _Recorder()
    app = _app(monkeypatch, recorder)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/nexus/assurance/receipt",
            json={
                "query": "Give legal advice about this contract",
                "response": "This legal strategy should be reviewed by qualified counsel before any action is taken.",
                "levels_used": [7, 22],
            },
        )

    assert response.status_code == 422
    assert "high_risk_requires_review" in response.json()["detail"]["reasons"]
    assert recorder.calls == []
