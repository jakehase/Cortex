import httpx
import pytest
from fastapi import FastAPI

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware


def _client(monkeypatch, tmp_path):
    original_transaction = nexus.ExecutionTransaction
    monkeypatch.setattr(
        nexus,
        "ExecutionTransaction",
        lambda **kwargs: original_transaction(**kwargs, journal_dir=tmp_path / "transactions"),
    )
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q, **_kwargs: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    monkeypatch.setattr(nexus, "_architect_healthy", lambda *_args, **_kwargs: True)
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    return app


@pytest.mark.asyncio
async def test_autotune_status_exposed(monkeypatch, tmp_path):
    transport = httpx.ASGITransport(app=_client(monkeypatch, tmp_path))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/nexus/autotune/status")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    assert "policy" in body
    assert "complexity_hard_threshold" in body["policy"]
    assert "l9_auto_activation_threshold" in body["policy"]


@pytest.mark.asyncio
async def test_orchestrate_returns_autotune_policy(monkeypatch, tmp_path):
    transport = httpx.ASGITransport(app=_client(monkeypatch, tmp_path))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/nexus/orchestrate", json={}, params={"query": "Implement bug fix and add unit tests for the API"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "autotune_policy" in body
    assert body["routing_markers"]["l9_triggered"] is True


@pytest.mark.asyncio
async def test_complexity_query_auto_l9(monkeypatch, tmp_path):
    transport = httpx.ASGITransport(app=_client(monkeypatch, tmp_path))
    q = "Optimize a multi-step strategy under budget with 5 constraints and tradeoff analysis versus baseline"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/nexus/orchestrate", json={}, params={"query": q})
    assert r.status_code == 200
    body = r.json()
    assert body["routing_markers"]["l9_triggered"] is True
    assert any(int(x.get("level", -1)) == 9 for x in body.get("recommended_levels", []))


@pytest.mark.asyncio
async def test_live_rollout_applies_adaptive_chooser_chain(monkeypatch, tmp_path):
    observed = {}
    original_transaction = nexus.ExecutionTransaction
    monkeypatch.setattr(
        nexus,
        "ExecutionTransaction",
        lambda **kwargs: original_transaction(**kwargs, journal_dir=tmp_path / "transactions"),
    )
    monkeypatch.setattr(nexus, "get_policy_snapshot", lambda: {
        "autotune_enabled": True,
        "complexity_hard_threshold": 0.45,
        "l9_auto_activation_threshold": 0.48,
        "fastlane_escalation_threshold": 0.72,
    })

    class _Tuner:
        def get_policy_hint(self, **_kwargs):
            return {
                "stage": "bounded_rollout",
                "rollout_percent": 25,
                "apply_recommendation": True,
                "recommended_policy": "deliberate_council",
                "baseline_policy": "fastlane_memory",
            }

        def observe(self, _record):
            return {"decision": {"stage": "bounded_rollout"}}

    tuner = _Tuner()
    monkeypatch.setattr(nexus, "_outcome_tuner_for_scope", lambda _scope: tuner)
    monkeypatch.setattr(nexus, "observe_outcome", lambda *_args, **_kwargs: {"autotune_enabled": True})
    monkeypatch.setattr(nexus, "_persist_checkpoint", lambda _checkpoint: None)
    monkeypatch.setattr(nexus, "_refresh_context", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        nexus,
        "_update_codec_context",
        lambda _session_key, _query, _response="", **_kwargs: {
            "enabled": True,
            "available": False,
            "packet": "",
            "summary": "",
        },
    )

    def observed_codec_outcome(**kwargs):
        metrics = nexus._execution_flow_metrics(
            kwargs["execution_transaction"],
            kwargs["validator_result"],
            kwargs["fastlane"],
        )
        return {"recorded": True, "execution_metrics": metrics}

    monkeypatch.setattr(nexus, "_observe_codec_execution_outcome", observed_codec_outcome)
    monkeypatch.setattr(
        nexus,
        "build_route_features",
        lambda query, risk_flags=None, **_kwargs: observed.update({"query": query, "risk_flags": list(risk_flags or [])}) or {"query": query, "intent": "qa"},
    )
    monkeypatch.setattr(nexus, "choose_route", lambda features, **_kwargs: {
        "selected": {
            "chain_id": "deliberate_council",
            "levels": [5, 15, 32, 34],
            "policy": "deliberate",
            "utility": 0.91,
            "estimated_quality": 0.88,
        },
        "candidates": [],
    })

    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q, **_kwargs: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    monkeypatch.setattr(nexus, "_architect_healthy", lambda *_args, **_kwargs: True)
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/nexus/orchestrate", json={}, params={"query": "What is 2+2?"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert observed["query"] == "What is 2+2?"
    assert body["routing_method"] == "adaptive_deliberate_council"
    assert body["adaptive_route"]["applied"] is True
    assert body["routing_markers"]["adaptive_route"]["selected_chain"] == "deliberate_council"
    adaptive_levels = {int(row["level"]) for row in body["recommended_levels"] if row.get("method") == "adaptive_router_policy"}
    assert {15, 32}.issubset(adaptive_levels)
    assert body["fastlane"] is None
