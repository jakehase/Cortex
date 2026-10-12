import asyncio

import httpx
import pytest
from fastapi import FastAPI

import cortex_server.routers.oracle as oracle
from cortex_server.middleware.hud_middleware import HUDMiddleware


@pytest.fixture(autouse=True)
def _run_oracle_threadpool_inline(monkeypatch):
    async def run_inline(function, *args, **kwargs):
        return function(*args, **kwargs)

    monkeypatch.setattr(oracle, "run_in_threadpool", run_inline)


def _app():
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(oracle.router, prefix="/oracle")
    return app


def _post(auth, payload):
    async def _go():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=_app()),
            base_url="http://test",
            headers={**auth.headers, "x-cortex-oracle-consult": "1"},
        ) as client:
            return await client.post("/oracle/chat", json=payload)

    return asyncio.run(_go())


def test_consult_header_sends_prompt_and_system_verbatim_and_returns_raw_output(
    monkeypatch,
    configured_memory_principal,
):
    calls = []
    brief = "NEEDS: a ui build checklist\nCONFIDENCE: 0.82\nSTAKES: low - drafting"

    def fake_call(prompt, system=None, *, principal_scope_key="internal-system", ephemeral_session=False):
        calls.append({"prompt": prompt, "system": system, "ephemeral": ephemeral_session})
        return brief

    monkeypatch.setattr(oracle, "call_openclaw_local", fake_call)
    monkeypatch.setattr(oracle, "_best_effort_answer", lambda *a, **k: pytest.fail("normal lane must not run"))
    monkeypatch.setattr(oracle, "_semantic_guardrail_response", lambda *a, **k: pytest.fail("guardrails must not run"))

    # Prompt contains words that used to trip keyword lanes (ui/build/json/status).
    prompt = "User asked: quick ui build for the status page, reply in json? Write the brief."
    auth = configured_memory_principal("oracle-consult-lane")
    response = _post(auth, {"prompt": prompt, "system": "You are Oracle consult.", "priority": "normal"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(calls) == 1
    assert calls[0]["prompt"] == prompt
    assert calls[0]["system"] == "You are Oracle consult."
    assert calls[0]["ephemeral"] is True
    assert body["response"].strip() == brief
    assert "Confidence: Medium" not in body["response"]
    assert body["routing_trace"]["path"] == "consult_direct"
    assert oracle._INFLIGHT_CHATS == 0


def test_consult_provider_failure_is_503_and_releases_inflight(
    monkeypatch,
    configured_memory_principal,
):
    def failing_call(*a, **k):
        raise RuntimeError("openclaw_capacity_busy")

    monkeypatch.setattr(oracle, "call_openclaw_local", failing_call)
    auth = configured_memory_principal("oracle-consult-lane-fail")
    response = _post(auth, {"prompt": "brief please", "priority": "normal"})

    assert response.status_code == 503
    assert oracle._INFLIGHT_CHATS == 0


def test_consult_codec_header_prepends_principal_codec_packet(monkeypatch, configured_memory_principal):
    calls = []
    queries = []

    def fake_call(prompt, system=None, *, principal_scope_key="internal-system", ephemeral_session=False):
        calls.append(prompt)
        return "NEEDS: x"

    def fake_packet(session_key, prompt, *, max_chars, tenant_id=None, workspace_id=None):
        queries.append((session_key, prompt, max_chars))
        return {"available": True, "packet": "Prior decision: weekly billing summary on Fridays."}

    monkeypatch.setattr(oracle, "call_openclaw_local", fake_call)
    monkeypatch.setattr(oracle, "_codec_packet_with_query", fake_packet)
    auth = configured_memory_principal("oracle-consult-codec")
    prompt = "SYSTEM TEXT\nRECENT CONVERSATION:\nUSER: hi\n\nLATEST USER MESSAGE:\nwhen is that summary due?"

    async def _go(headers):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=_app()), base_url="http://test", headers={**auth.headers, **headers},
        ) as client:
            return await client.post("/oracle/chat", json={"prompt": prompt, "priority": "normal"})

    with_codec = asyncio.run(_go({"x-cortex-oracle-consult": "1", "x-cortex-oracle-codec": "1"}))
    assert with_codec.status_code == 200, with_codec.text
    assert calls[0].startswith("SESSION CONTINUITY")
    assert "weekly billing summary" in calls[0]
    assert calls[0].endswith(prompt)
    assert queries[0][0] == auth.principal.codec_session_key
    assert queries[0][1] == "when is that summary due?"
    assert with_codec.json()["routing_trace"]["codec_chars"] > 0

    without = asyncio.run(_go({"x-cortex-oracle-consult": "1"}))
    assert without.status_code == 200
    assert calls[1] == prompt
    assert without.json()["routing_trace"]["codec_chars"] == 0
