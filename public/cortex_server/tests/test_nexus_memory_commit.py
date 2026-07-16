import asyncio
from concurrent.futures import ThreadPoolExecutor
import httpx
import multiprocessing
from pathlib import Path
import pytest
from fastapi import FastAPI
import sys
import threading
import time
import types

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.runtime.assurance_receipt_ledger import reserve_assurance_receipt


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
    fake_l22.store_memory_record = recorder
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
    assert replay.status_code == 403
    assert replay.json()["detail"]["reason"] == "receipt_already_consumed"
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
    assert replay.status_code == 403
    assert replay.json()["detail"]["reason"] == "receipt_already_consumed"
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

    def fail_finalization(*_args, **_kwargs):
        raise nexus.AssuranceReceiptLedgerUnavailable("simulated_finalization_failure")

    monkeypatch.setattr(nexus, "finalize_assurance_receipt", fail_finalization)
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
    assert replay.status_code == 403
    assert replay.json()["detail"]["reason"] == "receipt_already_consumed"
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

    assert sorted(status for status, _body in results) == [200, 403]
    rejected = next(body for status, body in results if status == 403)
    assert rejected["detail"]["reason"] == "receipt_already_consumed"
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

    assert sorted(outcomes) == ["receipt_already_consumed", "reserved"]


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
    assert replay.status_code == 403
    assert replay.json()["detail"]["reason"] == "receipt_already_consumed"
    assert len(recorder.calls) == 1


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
