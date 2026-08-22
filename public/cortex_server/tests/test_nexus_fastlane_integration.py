import httpx
import pytest
from fastapi import FastAPI

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.middleware.write_authorization import WriteAuthorizationMiddleware
from cortex_server.routers.nexus import _is_simple_qa, _detect_risk_flags


def test_simple_qa_gate():
    assert _is_simple_qa("What is the capital of Texas?") is True
    assert _is_simple_qa("Design a multi-step plan for enterprise architecture migration with risk matrix") is False


def test_risk_flags():
    flags = _detect_risk_flags("Give legal advice about contract breach")
    assert "legal" in flags


@pytest.mark.asyncio
async def test_cognitive_wave_slice_present(monkeypatch, configured_memory_principal):
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q, **_kwargs: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    transport = httpx.ASGITransport(app=app)
    auth = configured_memory_principal("nexus-fastlane-wave")
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers=auth.headers,
    ) as client:
        r = await client.post("/nexus/orchestrate", json={}, params={"query": "What is 2+2?"})
    assert r.status_code == 200
    body = r.json()
    assert "cognitive_wave" in body
    assert body["cognitive_wave"]["deliverable"].startswith("gate-c-slice-")
    assert body["cognitive_wave"]["stage"] in {"shadow", "canary", "active"}
    assert body["fastlane"]["retrieval"] == []
    assert body["fastlane"]["verification"]["grounded_retrieval"] is False
    assert body["fastlane"]["confidence"] == 0.0
    assert body["fastlane"]["escalated"] is True
    assert body["fastlane"]["answer"] is None


@pytest.mark.asyncio
async def test_orchestrate_get_cannot_mutate_and_post_requires_write_authorization(
    monkeypatch,
    configured_memory_principal,
):
    codec_updates = []
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q, **_kwargs: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    monkeypatch.setattr(nexus, "gather_live_evidence", lambda *a, **k: {"required": False, "mode": "not_required", "evidence_count": 0, "degraded": False, "evidence": []})
    monkeypatch.setattr(nexus, "_update_codec_context", lambda *a, **k: codec_updates.append((a, k)) or {"enabled": True, "available": False, "packet": "", "summary": ""})

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.add_middleware(
        WriteAuthorizationMiddleware,
        mode="token_required",
        token="nexus-write-secret",
        header_name="x-test-write-token",
    )
    app.include_router(nexus.router, prefix="/nexus")
    transport = httpx.ASGITransport(app=app, client=("198.51.100.20", 41000))
    auth = configured_memory_principal("nexus-write-boundary")
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers=auth.headers,
    ) as client:
        get_response = await client.get("/nexus/orchestrate", params={"query": "What is 2+2?"})
        unauthorized_post = await client.post("/nexus/orchestrate", json={"query": "What is 2+2?"})

        assert get_response.status_code == 405
        assert unauthorized_post.status_code == 403
        assert codec_updates == []

        authorized_post = await client.post(
            "/nexus/orchestrate",
            json={"query": "What is 2+2?"},
            headers={"x-test-write-token": "nexus-write-secret"},
        )
        assert authorized_post.status_code == 200
        assert len(codec_updates) == 1
