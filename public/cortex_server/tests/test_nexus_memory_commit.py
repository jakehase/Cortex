import httpx
import pytest
from fastapi import FastAPI
import sys
import types

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware


class _Recorder:
    def __init__(self):
        self.calls = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return {"id": "mem-123", "status": "stored", "metadata": kwargs.get("metadata", {})}


def _app(monkeypatch, recorder):
    fake_l22 = types.ModuleType("cortex_server.routers.l22")
    fake_l22.store_memory_record = recorder
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", fake_l22)
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    return app


async def _receipt(client, payload, headers=None):
    response = await client.post("/nexus/assurance/receipt", json=payload, headers=headers or {})
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
                    "validator_result": {"pass": False, "checks": {"overclaim_detected": True}},
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
    assert recorder.calls[0]["idempotency_key"] == stored_metadata["assurance"]["receipt_id"]
    assert stored_metadata["client_note"] == "keep this non-reserved field"


@pytest.mark.asyncio
async def test_commit_rejects_caller_self_attestation_without_server_receipt(monkeypatch):
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
                    "validator_result": {"pass": False, "checks": {"overclaim_detected": True}},
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
            json={**interaction, "response": "A tampered response that was never assured by the server.", "assurance_receipt": receipt},
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
