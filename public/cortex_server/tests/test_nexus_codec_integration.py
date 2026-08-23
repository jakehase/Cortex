import asyncio
import threading

import httpx
import pytest
from fastapi import FastAPI

import cortex_server.modules.codec_policy as codec_policy
import cortex_server.modules.cortex_codec as codec_module
from cortex_server.modules import async_offload
import cortex_server.routers.nexus as nexus
import cortex_server.routers.oracle as oracle
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.modules.cortex_codec import update_codec_state_for_session


class _ASGIClient:
    """Synchronous facade over HTTPX's supported ASGI transport."""

    def __init__(self, app, *, raise_server_exceptions=True, headers=None):
        self.app = app
        self.raise_server_exceptions = raise_server_exceptions
        self.headers = httpx.Headers(headers or {})

    def request(self, method, path, **kwargs):
        async def send():
            transport = httpx.ASGITransport(app=self.app, raise_app_exceptions=self.raise_server_exceptions)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://test",
                headers=self.headers,
            ) as client:
                return await client.request(method, path, **kwargs)

        return asyncio.run(send())

    def get(self, path, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path, **kwargs):
        return self.request("POST", path, **kwargs)


def TestClient(app, *, raise_server_exceptions=True, headers=None):
    return _ASGIClient(
        app,
        raise_server_exceptions=raise_server_exceptions,
        headers=headers,
    )


def _seed_principal_codec_state(auth, events):
    return update_codec_state_for_session(
        auth.principal.codec_session_key,
        events,
        tenant_id=auth.principal.tenant_id,
        workspace_id=auth.principal.storage_workspace_id,
    )


@pytest.fixture(autouse=True)
def _isolate_nexus_runtime_state(tmp_path, monkeypatch):
    original_transaction = nexus.ExecutionTransaction
    monkeypatch.setattr(
        nexus,
        "ExecutionTransaction",
        lambda **kwargs: original_transaction(**kwargs, journal_dir=tmp_path / "transactions"),
    )
    monkeypatch.setattr(nexus, "_ADAPTIVE_STATE_ROOT", tmp_path / "adaptive")
    nexus._ADAPTIVE_POLICY_STATES.clear()
    async def run_inline(function, *args, **kwargs):
        return function(*args, **kwargs)

    monkeypatch.setattr(nexus, "run_in_threadpool", run_inline)


def test_nexus_orchestrate_surfaces_codec_context(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q, **_kwargs: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    monkeypatch.setattr(nexus, "gather_live_evidence", lambda *a, **k: {"required": False, "mode": "not_required", "evidence_count": 0, "degraded": False})
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)

    session_key = "nexus-codec-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [{"text": "Build the Cortex Codec and keep [Cortex] at the start of replies.", "metadata": {"project": "Cortex Codec"}}],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    r = client.post(
        "/nexus/orchestrate",
        json={},
        params={"query": "How should we wire Codec into the real path?"},
        headers={"x-session-id": session_key},
    )
    assert r.status_code == 200
    body = r.json()
    assert "codec_context" in body
    assert body["codec_context"]["enabled"] is True
    assert body["codec_context"]["available"] is True
    assert "durable" in body["codec_context"]
    assert "Cortex Codec" in body["codec_context"]["summary"] or body["codec_context"]["packet"]


@pytest.mark.asyncio
async def test_nexus_slow_provider_times_out_without_blocking_event_loop(
    monkeypatch,
    configured_memory_principal,
):
    entered = threading.Event()
    release = threading.Event()

    def slow_provider(_query, **_kwargs):
        entered.set()
        release.wait(timeout=2)
        return {
            "confidence": 0.0,
            "levels": [],
            "reasoning": "late provider result",
            "method": "stub",
        }

    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", slow_provider)
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
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)

    real_remaining_seconds = nexus.remaining_seconds

    def focused_deadline(deadline, *, ceiling):
        if ceiling == 10.0:
            return 0.03
        return real_remaining_seconds(deadline, ceiling=ceiling)

    monkeypatch.setattr(nexus, "remaining_seconds", focused_deadline)

    session_key = "nexus-slow-provider-timeout"
    auth = configured_memory_principal(session_key)
    app = FastAPI()
    app.include_router(nexus.router, prefix="/nexus")

    try:
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers=auth.headers,
        ) as client:
            response_task = asyncio.create_task(
                client.post(
                    "/nexus/orchestrate",
                    json={},
                    params={"query": "Design a complex multi-stage migration plan."},
                    headers={"x-session-id": session_key},
                )
            )
            for _ in range(200):
                if entered.is_set():
                    break
                await asyncio.sleep(0.01)
            assert entered.is_set()

            # This timer must continue to run while the synchronous provider is
            # retained in a worker after the endpoint deadline expires.
            await asyncio.wait_for(asyncio.sleep(0.01), timeout=0.03)
            response = await asyncio.wait_for(response_task, timeout=1)

        assert response.status_code == 504
        assert "nexus.semantic_analysis" in response.text
        status = async_offload.blocking_operation_status()
        assert "nexus.semantic_analysis" in status["detached_operations"]
    finally:
        release.set()

    for _ in range(100):
        if "nexus.semantic_analysis" not in async_offload.blocking_operation_status()[
            "operations"
        ]:
            break
        await asyncio.sleep(0.01)
    assert "nexus.semantic_analysis" not in async_offload.blocking_operation_status()[
        "operations"
    ]


def test_nexus_orchestrate_codec_probe_exposes_hydrated_packet_without_semantic_calls(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)

    session_key = "nexus-codec-recovery-probe"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [{"text": "Recovery canary codeword cedar-lantern-7291.", "tags": ["recovery", "canary"]}],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    response = client.post(
        "/nexus/orchestrate",
        json={},
        params={"query": "Expose the recovered Codec canary.", "codec_probe": "true"},
        headers={"x-session-id": session_key},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["routing_method"] == "codec_recovery_probe"
    assert body["contract"]["codec_probe"] is True
    assert body["codec_context"]["available"] is True
    assert "cedar-lantern-7291" in body["codec_context"]["packet"] or "cedar-lantern-7291" in body["codec_context"]["summary"]


def test_nexus_orchestrate_records_codec_execution_artifact(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q, **_kwargs: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    monkeypatch.setattr(nexus, "gather_live_evidence", lambda *a, **k: {"required": False, "mode": "not_required", "evidence_count": 0, "degraded": False})
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    monkeypatch.setattr(nexus, "_observe_codec_execution_outcome", lambda **kwargs: {"recorded": True, "variant": "referents_plus_codec", "source": "execution_flow", "execution_metrics": {"confidence": 0.91}})

    session_key = "nexus-codec-execution-success"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [{"text": "Build the Cortex Codec and keep [Cortex] at the start of replies.", "metadata": {"project": "Cortex Codec"}}],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    r = client.post(
        "/nexus/orchestrate",
        json={},
        params={"query": "How should we wire Codec into the real path?"},
        headers={"x-session-id": session_key},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["artifact_paths"]["codec_execution"]["recorded"] is True
    assert body["artifact_paths"]["codec_execution"]["source"] == "execution_flow"
    assert "execution_metrics" in body["artifact_paths"]["codec_execution"]



def test_codec_execution_outcome_shapes_confidence_from_transaction(monkeypatch):
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    success = nexus._observe_codec_execution_outcome(
        query="How should we wire Codec into the real path?",
        session_key="nexus-exec-shape-success",
        codec_context={"available": True},
        referent_info={"resolved": True},
        execution_transaction={
            "status": "completed",
            "step_attempts_total": 3,
            "rollback_attempts_total": 0,
            "steps": [
                {"name": "a", "status": "completed"},
                {"name": "b", "status": "completed"},
                {"name": "c", "status": "completed"},
            ],
        },
        validator_result={"pass": True},
        fastlane={"escalated": False},
        note="success-path",
    )
    degraded = nexus._observe_codec_execution_outcome(
        query="How should we wire Codec into the real path?",
        session_key="nexus-exec-shape-failure",
        codec_context={"available": True},
        referent_info={"resolved": True},
        execution_transaction={
            "status": "failed",
            "step_attempts_total": 5,
            "rollback_attempts_total": 1,
            "steps": [
                {"name": "a", "status": "completed"},
                {"name": "b", "status": "failed"},
                {"name": "c", "status": "retrying"},
            ],
        },
        validator_result={"pass": False},
        fastlane={"escalated": True},
        note="failure-path",
        explicit_success=False,
    )

    assert success["execution_metrics"]["confidence"] > degraded["execution_metrics"]["confidence"]
    assert success["execution_metrics"]["tx_completed"] is True
    assert degraded["execution_metrics"]["tx_completed"] is False
    assert degraded["execution_metrics"]["failed_steps"] >= 1
    assert degraded["outcome_confidence"] == degraded["execution_metrics"]["confidence"]
    assert "step_attribution" in success["execution_metrics"]
    assert success["step_summary"]["helpful"]



def test_nexus_orchestrate_failure_records_codec_execution_failure(
    monkeypatch,
    configured_memory_principal,
):
    captured = {}
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q, **_kwargs: (_ for _ in ()).throw(RuntimeError("semantic failure")))
    monkeypatch.setattr(nexus, "_observe_codec_execution_outcome", lambda **kwargs: captured.update(kwargs) or {"recorded": True})

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    session_key = "nexus-codec-execution-failure"
    auth = configured_memory_principal(session_key)
    client = TestClient(app, headers=auth.headers)

    r = client.post("/nexus/orchestrate", json={}, params={"query": "How should we wire Codec into the real path?"}, headers={"x-session-id": session_key})
    assert r.status_code == 500
    assert captured["explicit_success"] is False
    assert captured["note"].startswith("nexus_orchestrate_exception:")



def test_nexus_codec_status_endpoint_exposes_debug_view(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)

    session_key = "nexus-codec-status-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Build the Cortex Codec visibility endpoint with savings stats.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    r = client.get("/nexus/codec/status", headers={"x-session-id": session_key})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["codec"]["available"] is True
    assert body["codec"]["compression"]["prompt_characters"] >= 0
    assert body["codec"]["schema_version"] == "cortex.codec.schema.v1"
    assert body["codec"]["schema"]["identity"]["preferences"]["count"] >= 1
    assert body["codec"]["promotion"]["summary"]["promoted_count"] >= 1
    assert body["codec"]["utility"]["retention_priority"] > 0
    assert body["codec"]["retention_policy"]["max_snapshots"] >= 1
    assert "persisted_snapshots" in body["codec"]


def test_nexus_codec_events_endpoint_validates_and_writes_low_latency_state(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    session_key = "codec-events-endpoint-test"
    auth = configured_memory_principal(
        session_key,
        agent_id="codec-test-agent",
        user_id="codec-test-user",
        channel_id="codec-test-channel",
    )
    scope = auth.scope

    app = FastAPI()
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    response = client.post("/nexus/codec/events", json={
        "session_key": session_key,
        "events": [{"text": "Begin replies with [Cortex].", "tags": ["preference"], "metadata": {"source": "test"}}],
        "max_chars": 500,
        "scope": scope,
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True
    assert body["event_count"] == 1
    assert body["codec"]["available"] is True
    assert "[Cortex]" in body["codec"]["packet"] or "[Cortex]" in body["codec"]["summary"]

    invalid = client.post("/nexus/codec/events", json={"session_key": session_key, "events": []})
    assert invalid.status_code == 400


def test_nexus_codec_benchmark_endpoint_exposes_comparison_view(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)

    session_key = "nexus-codec-benchmark-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Build the Cortex Codec benchmark endpoint.", "metadata": {"project": "Cortex Codec"}},
            {"text": "Need to compare raw source size versus packed prompt size."},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    r = client.get(
        "/nexus/codec/benchmark",
        headers={"x-session-id": session_key},
        params={"benchmark_query": "What should I remember from this conversation?"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["codec"]["benchmark"]["codec_packet_chars"] >= 0
    assert body["codec"]["benchmark"]["raw_state_source_chars"] >= 0
    assert "prompt_comparison" in body["codec"]["benchmark"]
    assert "timeline" in body["codec"]["benchmark"]
    assert body["codec"]["benchmark"]["acceptance_gates"]["policy"]["min_ratio_vs_raw_state"] >= 1.0
    assert body["codec"]["benchmark"]["acceptance_gates"]["summary"]["required_total"] >= 2


def test_nexus_codec_evaluate_endpoint_exposes_variants(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    monkeypatch.setattr(codec_policy, "load_state", lambda: {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0}, "archetypes": {}, "last_observation": None})
    monkeypatch.setattr(codec_policy, "save_state", lambda state: None)

    session_key = "nexus-codec-evaluate-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Build the Cortex Codec evaluation hooks.", "metadata": {"project": "Cortex Codec"}},
            {"text": "Need side-by-side prompt variants for A/B comparison."},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    r = client.post(
        "/nexus/codec/evaluate",
        headers={"x-session-id": session_key},
        params={"eval_query": "How should I answer this with memory?"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["codec"]["evaluation"]["variant_count"] == 3
    assert len(body["codec"]["evaluation"]["variants"]) == 3
    assert body["codec"]["evaluation"]["oracle_run"]["requested"] is False
    assert body["codec"]["evaluation"]["judge"]["winner"] in {"query_only", "referents_only", "referents_plus_codec"}
    assert body["codec"]["evaluation"]["acceptance_gates"]["policy"]["min_variants"] == 3
    assert body["codec"]["evaluation"]["acceptance_gates"]["summary"]["required_total"] >= 3


def test_nexus_codec_evaluate_endpoint_can_run_oracle_variants(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))
    monkeypatch.setattr(oracle, "_quality_depth_controller", lambda prompt, priority="": {"mode": "medium"})
    monkeypatch.setattr(oracle, "_best_effort_answer", lambda prompt, system=None, priority=None, depth_mode=None: (f"OUT::{prompt[:24]}", "fake-model", "test-hook"))

    session_key = "nexus-codec-evaluate-oracle-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Build the Cortex Codec evaluation hooks.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    r = client.post(
        "/nexus/codec/evaluate",
        headers={"x-session-id": session_key},
        params={"eval_query": "What should I remember?", "run_oracle": "true"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["codec"]["evaluation"]["oracle_run"]["completed"] is True
    assert any(gate["name"] == "oracle_variant_coverage" for gate in body["codec"]["evaluation"]["acceptance_gates"]["gates"])
    for variant in body["codec"]["evaluation"]["variants"]:
        assert variant["oracle_model"] == "fake-model"
        assert variant["oracle_fallback_reason"] == "test-hook"
        assert variant["oracle_output"].startswith("OUT::")


def test_nexus_codec_evaluate_endpoint_can_oracle_judge_variants(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))
    monkeypatch.setattr(oracle, "_quality_depth_controller", lambda prompt, priority="": {"mode": "medium"})

    def _fake_best_effort(prompt, system=None, priority=None, depth_mode=None):
        if "Compare the candidate variants" in prompt:
            return ('{"winner":"referents_plus_codec","rationale":"Best balance of context and relevance.","confidence":0.88}', "fake-judge", "judge-test")
        return (f"OUT::{prompt[:24]}", "fake-model", "test-hook")

    monkeypatch.setattr(oracle, "_best_effort_answer", _fake_best_effort)

    session_key = "nexus-codec-evaluate-judge-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Build the Cortex Codec judge hooks.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    r = client.post(
        "/nexus/codec/evaluate",
        headers={"x-session-id": session_key},
        params={"eval_query": "What should I remember?", "run_oracle": "true", "judge_with_oracle": "true"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["codec"]["evaluation"]["oracle_judge"]["completed"] is True
    assert body["codec"]["evaluation"]["oracle_judge"]["winner"] == "referents_plus_codec"


def test_nexus_codec_evaluate_persists_history_and_returns_trends(
    monkeypatch,
    tmp_path,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    monkeypatch.setattr(nexus, "_CODEC_EVAL_HISTORY_PATH", tmp_path / "codec_eval_history.jsonl")
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    session_key = "nexus-codec-history-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Need side-by-side prompt variants for A/B comparison.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    r1 = client.post(
        "/nexus/codec/evaluate",
        headers={"x-session-id": session_key},
        params={"eval_query": "How should I answer this with memory?"},
    )
    assert r1.status_code == 200

    r2 = client.post(
        "/nexus/codec/evaluate",
        headers={"x-session-id": session_key},
        params={"eval_query": "How should I answer this with memory?"},
    )
    assert r2.status_code == 200
    body = r2.json()
    assert body["codec"]["evaluation"]["history"]["history_available"] is True
    assert body["codec"]["evaluation"]["history"]["summary"]["total_runs"] >= 2
    assert len(body["codec"]["evaluation"]["history"]["runs"]) >= 2
    assert body["codec"]["evaluation"]["history"]["sweep"]["available"] is True
    assert body["codec"]["evaluation"]["history"]["sweep"]["candidate_count"] >= 1
    assert body["codec"]["evaluation"]["history"]["sweep"]["best_candidate"]["policy"]["min_variants"] == 3
    assert body["codec"]["evaluation"]["history"]["rollup_sweep"]["available"] is True
    assert body["codec"]["evaluation"]["history"]["rollup_sweep"]["candidate_count"] >= 1
    assert "match_min_overlap" in body["codec"]["evaluation"]["history"]["rollup_sweep"]["best_candidate"]["policy"]
    assert body["codec"]["evaluation"]["history"]["corpus_replay"]["available"] is True
    assert body["codec"]["evaluation"]["history"]["corpus_replay"]["summary"]["replay_ready_runs"] >= 2
    assert body["codec"]["evaluation"]["history"]["corpus_replay"]["summary"]["variant_snapshot_count"] >= 2
    assert "query_only" in body["codec"]["evaluation"]["history"]["corpus_replay"]["variants"]
    assert body["codec"]["evaluation"]["history"]["corpus_replay"]["sweep"]["available"] is True
    assert body["codec"]["evaluation"]["history"]["corpus_replay"]["sweep"]["candidate_count"] >= 1
    assert "overlap_weight" in body["codec"]["evaluation"]["history"]["corpus_replay"]["sweep"]["best_candidate"]["policy"]
    assert body["codec"]["evaluation"]["history"]["corpus_replay"]["summary"]["archetype_count"] >= 1
    assert len(body["codec"]["evaluation"]["history"]["corpus_replay"]["sample_excerpts"]) >= 1
    assert body["codec"]["evaluation"]["history"]["recommendations"]["acceptance_policy"]
    assert body["codec"]["evaluation"]["history"]["recommendations"]["rollup_policy"]
    assert body["codec"]["evaluation"]["history"]["recommendations"]["corpus_policy"]
    assert body["codec"]["evaluation"]["recommendations"]["acceptance_policy"]
    assert body["codec"]["evaluation"]["recommendations"]["rollup_policy"]
    assert body["codec"]["evaluation"]["recommendations"]["corpus_policy"]
    assert body["codec"]["evaluation"]["history"]["corpus_replay"]["bucket_sweeps"]["available"] is True
    assert body["codec"]["evaluation"]["history"]["corpus_replay"]["bucket_sweeps"]["bucket_count"] >= 1
    assert body["codec"]["evaluation"]["history"]["recommendations"]["bucket_policies"]


def test_nexus_codec_corpus_replay_endpoint_returns_report_and_can_persist(
    monkeypatch,
    tmp_path,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    monkeypatch.setattr(nexus, "_CODEC_EVAL_HISTORY_PATH", tmp_path / "codec_eval_history.jsonl")
    monkeypatch.setattr(nexus, "_CODEC_REPLAY_REPORTS_PATH", tmp_path / "codec_replay_reports.jsonl")
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "autotune_updates": 0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    session_key = "nexus-codec-corpus-replay-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Need side-by-side prompt variants for A/B comparison.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    for _ in range(2):
        r = client.post(
            "/nexus/codec/evaluate",
            headers={"x-session-id": session_key},
            params={"eval_query": "How should I answer this with memory?"},
        )
        assert r.status_code == 200

    replay = client.post(
        "/nexus/codec/corpus-replay",
        headers={"x-session-id": session_key},
        params={"persist_report": True},
    )
    assert replay.status_code == 200
    body = replay.json()
    assert body["success"] is True
    assert body["codec"]["report_persisted"] is True
    assert body["codec"]["corpus_replay"]["corpus"]["available"] is True
    assert body["codec"]["corpus_replay"]["corpus"]["corpus_version"]
    assert body["codec"]["corpus_replay"]["report_id"]
    assert body["codec"]["corpus_replay"]["history"]["corpus_replay"]["available"] is True
    assert body["codec"]["corpus_replay"]["recommendations"]["acceptance_policy"]
    assert nexus._CODEC_REPLAY_REPORTS_PATH.exists() is True

    reports = client.get(
        "/nexus/codec/corpus-replay/reports",
        headers={"x-session-id": session_key},
    )
    assert reports.status_code == 200
    report_body = reports.json()
    assert report_body["codec"]["reports"]["available"] is True
    assert report_body["codec"]["reports"]["count"] >= 1
    assert report_body["codec"]["reports"]["items"][0]["corpus_version"]

    reexecute = client.post(
        "/nexus/codec/corpus-replay/reexecute",
        headers={"x-session-id": session_key},
    )
    assert reexecute.status_code == 200
    reexecute_body = reexecute.json()
    assert reexecute_body["codec"]["true_reexecution"]["available"] is True
    assert reexecute_body["codec"]["true_reexecution"]["summary"]["reexecuted_runs"] >= 1


def test_nexus_codec_evaluate_records_policy_learning_and_policy_endpoint(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    session_key = "nexus-codec-policy-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Need side-by-side prompt variants for A/B comparison.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    r = client.post(
        "/nexus/codec/evaluate",
        headers={"x-session-id": session_key},
        params={"eval_query": "How should I answer this with memory?"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["codec"]["evaluation"]["policy_learning"]["recorded"] is True
    assert body["codec"]["evaluation"]["policy"]["archetype"]

    r2 = client.get("/nexus/codec/policy", headers={"x-session-id": session_key}, params={"query": "How should I answer this with memory?"})
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["success"] is True
    assert "query_policy" in body2["codec_policy"]
    assert "session_telemetry" in body2["codec_policy"]
    assert "passive_config" in body2["codec_policy"]
    assert body2["codec_policy"]["totals"]["evaluations"] >= 1


@pytest.mark.asyncio
async def test_nexus_outcome_feedback_updates_codec_policy(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    transport = httpx.ASGITransport(app=app)
    auth = configured_memory_principal("nexus-codec-feedback")
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers=auth.headers,
    ) as client:
        r = await client.post(
            "/nexus/outcome/feedback",
            json={
                "query": "Plan the architecture tradeoff for this change.",
                "policy_label": "codec",
                "user_correction": False,
                "recovery_needed": False,
                "validator_pass": True,
            },
        )
    assert r.status_code == 422
    assert state["totals"]["evaluations"] == 0
    assert state["last_observation"] is None


def test_nexus_codec_outcome_endpoint_requires_server_observed_receipt(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    auth = configured_memory_principal("nexus-codec-outcome")
    client = TestClient(app, headers=auth.headers)

    r = client.post(
        "/nexus/codec/outcome",
        json={
            "query": "Implement a python api bug fix with unit test.",
            "codec_variant": "query_only",
            "user_correction": False,
            "recovery_needed": False,
            "validator_pass": True,
        },
    )
    assert r.status_code == 403
    body = r.json()
    assert body["detail"]["error"] == "server_observed_outcome_receipt_required"
    assert state["totals"]["evaluations"] == 0


def test_nexus_codec_evaluate_returns_autotune_and_updates_query_policy(
    monkeypatch,
    tmp_path,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    monkeypatch.setattr(nexus, "_CODEC_EVAL_HISTORY_PATH", tmp_path / "codec_eval_history.jsonl")
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "autotune_updates": 0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    session_key = "nexus-codec-autotune-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Need side-by-side prompt variants for A/B comparison.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    for _ in range(3):
        r = client.post(
            "/nexus/codec/evaluate",
            headers={"x-session-id": session_key},
            params={"eval_query": "How should I answer this with memory?"},
        )
        assert r.status_code == 200

    body = r.json()
    assert body["codec"]["evaluation"]["autotune"]["recorded"] is True
    assert "autotune" in body["codec"]["evaluation"]["policy"]
    assert state["totals"]["autotune_updates"] >= 3


def test_nexus_codec_evaluate_advances_rollup_autotune(
    monkeypatch,
    tmp_path,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    monkeypatch.setattr(codec_module, "_ROLLUP_AUTOTUNE_STATE_PATH", tmp_path / "rollup_policy.json")
    monkeypatch.setattr(codec_module, "_ROLLUP_AUTOTUNE_STATE", None)
    monkeypatch.setattr(nexus, "_CODEC_EVAL_HISTORY_PATH", tmp_path / "codec_eval_history.jsonl")
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "autotune_updates": 0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    session_key = "nexus-codec-rollup-autotune-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Need side-by-side prompt variants for A/B comparison.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    for _ in range(3):
        r = client.post(
            "/nexus/codec/evaluate",
            headers={"x-session-id": session_key},
            params={"eval_query": "How should I answer this with memory?"},
        )
        assert r.status_code == 200

    body = r.json()
    assert body["codec"]["evaluation"]["rollup_autotune"]["recorded"] is True
    assert body["codec"]["evaluation"]["rollup_autotune"]["runs"] >= 3
    policies = nexus._adaptive_policies_for_scope(auth.principal.storage_metadata)
    scoped_rollup = nexus._scoped_codec_rollup_call(policies, codec_module._codec_rollup_policy)
    assert scoped_rollup["autotune"]["runs"] >= 3


def test_nexus_codec_evaluate_surfaces_archetype_rollup_autotune_scope(
    monkeypatch,
    tmp_path,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    monkeypatch.setattr(codec_module, "_ROLLUP_AUTOTUNE_STATE_PATH", tmp_path / "rollup_policy.json")
    monkeypatch.setattr(codec_module, "_ROLLUP_AUTOTUNE_STATE", None)
    monkeypatch.setattr(nexus, "_CODEC_EVAL_HISTORY_PATH", tmp_path / "codec_eval_history.jsonl")
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "autotune_updates": 0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    session_key = "nexus-codec-rollup-archetype-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Need architecture tradeoff memory handling.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    for _ in range(3):
        r = client.post(
            "/nexus/codec/evaluate",
            headers={"x-session-id": session_key},
            params={"eval_query": "Plan the architecture tradeoff for this change."},
        )
        assert r.status_code == 200

    body = r.json()
    assert body["codec"]["evaluation"]["rollup_autotune"]["autotune"]["scope"] == "archetype"
    assert body["codec"]["evaluation"]["rollup_autotune"]["autotune"]["archetype"]


def test_nexus_codec_corpus_replay_diff_promote_and_plan_endpoints(
    monkeypatch,
    tmp_path,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    monkeypatch.setattr(nexus, "_CODEC_EVAL_HISTORY_PATH", tmp_path / "codec_eval_history.jsonl")
    monkeypatch.setattr(nexus, "_CODEC_REPLAY_REPORTS_PATH", tmp_path / "codec_replay_reports.jsonl")
    monkeypatch.setattr(nexus, "_CODEC_ACTIVE_POLICY_PATH", tmp_path / "codec_active_policy.json")
    monkeypatch.setattr(nexus, "_CODEC_REPLAY_PLANS_PATH", tmp_path / "codec_replay_plans.jsonl")
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "autotune_updates": 0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    session_key = "nexus-codec-replay-diff-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Need replay diff + promotion coverage.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    for _ in range(2):
        r = client.post(
            "/nexus/codec/evaluate",
            headers={"x-session-id": session_key},
            params={"eval_query": "How should I answer this with memory?"},
        )
        assert r.status_code == 200
        replay = client.post(
            "/nexus/codec/corpus-replay",
            headers={"x-session-id": session_key},
            params={"persist_report": True},
        )
        assert replay.status_code == 200

    diff = client.get(
        "/nexus/codec/corpus-replay/diff",
        headers={"x-session-id": session_key},
    )
    assert diff.status_code == 200
    diff_body = diff.json()
    assert diff_body["codec"]["report_diff"]["available"] is True
    assert "overall_pass_rate_delta" in diff_body["codec"]["report_diff"]["summary"]

    promote = client.post(
        "/nexus/codec/corpus-replay/promote-best",
        headers={"x-session-id": session_key},
    )
    assert promote.status_code == 200
    promote_body = promote.json()
    assert promote_body["codec"]["active_policy"]["policies"]

    active = client.get("/nexus/codec/corpus-replay/active-policy")
    assert active.status_code == 200
    active_body = active.json()
    assert active_body["codec"]["active_policy"]["report_id"]

    plan = client.post(
        "/nexus/codec/corpus-replay/plan",
        headers={"x-session-id": session_key},
        params={"cadence_minutes": 60, "note": "Hourly replay benchmark", "auto_promote_on_success": True},
    )
    assert plan.status_code == 200
    plan_body = plan.json()
    assert plan_body["codec"]["replay_plan"]["plan_id"]

    plans = client.get(
        "/nexus/codec/corpus-replay/plans",
        headers={"x-session-id": session_key},
    )
    assert plans.status_code == 200
    plans_body = plans.json()
    assert plans_body["codec"]["replay_plans"]["available"] is True
    assert plans_body["codec"]["replay_plans"]["count"] >= 1
    plan_id = plans_body["codec"]["replay_plans"]["items"][0]["plan_id"]

    run_one = client.post(
        "/nexus/codec/corpus-replay/plan/run",
        headers={"x-session-id": session_key},
        params={"plan_id": plan_id},
    )
    assert run_one.status_code == 200
    run_one_body = run_one.json()
    assert run_one_body["codec"]["replay_plan_run"]["executed"] is True
    assert run_one_body["codec"]["replay_plan_run"]["plan"]["run_count"] >= 1
    assert run_one_body["codec"]["replay_plan_run"]["autopromoted"] is True

    plan_due = client.post(
        "/nexus/codec/corpus-replay/plan",
        headers={"x-session-id": session_key},
        params={"cadence_minutes": 60, "note": "Due replay benchmark", "start_immediately": True},
    )
    assert plan_due.status_code == 200

    scheduler = client.post("/nexus/codec/corpus-replay/scheduler")
    assert scheduler.status_code == 200
    scheduler_body = scheduler.json()
    scheduler_policy = scheduler_body["codec"]["scheduler"]
    assert scheduler_policy["enabled"] is False
    assert scheduler_policy["automatic_execution"] is False
    assert scheduler_policy["authenticated_tick_required"] is True
    assert "cross-principal replay is disabled" in scheduler_policy["reason"]

    tick = client.post(
        "/nexus/codec/corpus-replay/scheduler/tick",
        headers={"x-session-id": session_key},
    )
    assert tick.status_code == 200
    tick_body = tick.json()
    assert tick_body["codec"]["scheduler_tick"]["executed_count"] >= 0

    run_due = client.post(
        "/nexus/codec/corpus-replay/plans/run-due",
        headers={"x-session-id": session_key},
    )
    assert run_due.status_code == 200
    run_due_body = run_due.json()
    assert (
        tick_body["codec"]["scheduler_tick"]["executed_count"] >= 1
        or run_due_body["codec"]["due_replay_runs"]["count"] >= 1
    )


def test_nexus_codec_corpus_replay_live_reexecute_endpoint(
    monkeypatch,
    tmp_path,
    configured_memory_principal,
):
    from cortex_server.routers import oracle as oracle_router

    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    monkeypatch.setattr(nexus, "_CODEC_EVAL_HISTORY_PATH", tmp_path / "codec_eval_history.jsonl")
    monkeypatch.setattr(nexus, "_CODEC_LIVE_REEXEC_REPORTS_PATH", tmp_path / "codec_live_reexec_reports.jsonl")
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "autotune_updates": 0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))
    monkeypatch.setattr(oracle_router, "call_openclaw_local", lambda prompt, system=None, **_kwargs: f"LIVE::{prompt[:24]}")

    session_key = "nexus-codec-live-reexecute-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Need live replay execution coverage.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    r = client.post(
        "/nexus/codec/evaluate",
        headers={"x-session-id": session_key},
        params={"eval_query": "How should I answer this with memory?"},
    )
    assert r.status_code == 200

    live = client.post(
        "/nexus/codec/corpus-replay/live-reexecute",
        headers={"x-session-id": session_key},
        params={"limit": 3, "max_variants": 3, "backend": "openclaw_local", "persist_report": True},
    )
    assert live.status_code == 200
    body = live.json()
    assert body["codec"]["live_reexecution"]["available"] is True
    assert body["codec"]["live_reexecution"]["summary"]["reexecuted_runs"] >= 1
    assert "avg_semantic_similarity" in body["codec"]["live_reexecution"]["summary"]
    assert body["codec"]["report_persisted"] is True
    assert len(body["codec"]["live_reexecution"]["runs"][0]["variants"]) >= 1

    backends = client.get("/nexus/codec/corpus-replay/live-reexecute/backends")
    assert backends.status_code == 200
    backends_body = backends.json()
    assert backends_body["codec"]["live_reexecution_backends"]["available"] is True
    assert backends_body["codec"]["live_reexecution_backends"]["count"] >= 2

    compare = client.post(
        "/nexus/codec/corpus-replay/live-reexecute/compare",
        headers={"x-session-id": session_key},
        params={"backends": "recorded,openclaw_local", "limit": 3, "max_variants": 3},
    )
    assert compare.status_code == 200
    compare_body = compare.json()
    assert "recorded" in compare_body["codec"]["live_reexecution_compare"]["backends"]
    assert "openclaw_local" in compare_body["codec"]["live_reexecution_compare"]["backends"]

    reports = client.get(
        "/nexus/codec/corpus-replay/live-reexecute/reports",
        headers={"x-session-id": session_key},
    )
    assert reports.status_code == 200
    report_body = reports.json()
    assert report_body["codec"]["live_reexecution_reports"]["available"] is True
    assert report_body["codec"]["live_reexecution_reports"]["count"] >= 1


def test_nexus_codec_corpus_governance_endpoints(
    monkeypatch,
    tmp_path,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    monkeypatch.setattr(nexus, "_CODEC_EVAL_HISTORY_PATH", tmp_path / "codec_eval_history.jsonl")
    monkeypatch.setattr(nexus, "_CODEC_REPLAY_REPORTS_PATH", tmp_path / "codec_replay_reports.jsonl")
    monkeypatch.setattr(nexus, "_CODEC_ACTIVE_POLICY_PATH", tmp_path / "codec_active_policy.json")
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "autotune_updates": 0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    session_key = "nexus-codec-governance-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Need corpus governance coverage.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    for _ in range(2):
        r = client.post(
            "/nexus/codec/evaluate",
            headers={"x-session-id": session_key},
            params={"eval_query": "How should I answer this with memory?"},
        )
        assert r.status_code == 200
        replay = client.post(
            "/nexus/codec/corpus-replay",
            headers={"x-session-id": session_key},
            params={"persist_report": True},
        )
        assert replay.status_code == 200

    versions = client.get(
        "/nexus/codec/corpus-replay/corpus-versions",
        headers={"x-session-id": session_key},
    )
    assert versions.status_code == 200
    versions_body = versions.json()
    assert versions_body["codec"]["corpus_versions"]["available"] is True
    assert versions_body["codec"]["corpus_versions"]["count"] >= 1

    retention = client.get(
        "/nexus/codec/corpus-replay/retention",
        headers={"x-session-id": session_key},
    )
    assert retention.status_code == 200
    retention_body = retention.json()
    assert retention_body["codec"]["retention"]["available"] is True
    assert retention_body["codec"]["retention"]["keep_count"] >= 1


def test_nexus_codec_corpus_replay_export_endpoint(
    monkeypatch,
    tmp_path,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    monkeypatch.setattr(nexus, "_CODEC_EVAL_HISTORY_PATH", tmp_path / "codec_eval_history.jsonl")
    monkeypatch.setattr(nexus, "_CODEC_CORPUS_EXPORTS_PATH", tmp_path / "codec_corpus_exports.jsonl")
    state = {"version": "cortex.codec.policy.v1", "enabled": True, "last_updated": "", "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "autotune_updates": 0}, "archetypes": {}, "last_observation": None}
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    session_key = "nexus-codec-export-test"
    auth = configured_memory_principal(session_key)
    _seed_principal_codec_state(
        auth,
        [
            {"text": "Need benchmark corpus export coverage.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    r = client.post(
        "/nexus/codec/evaluate",
        headers={"x-session-id": session_key},
        params={"eval_query": "How should I answer this with memory?"},
    )
    assert r.status_code == 200

    export = client.post(
        "/nexus/codec/corpus-replay/export",
        headers={"x-session-id": session_key},
        params={"persist_export": True},
    )
    assert export.status_code == 200
    body = export.json()
    assert body["codec"]["corpus_export"]["export_version"] == "cortex.codec.benchmark_corpus.v1"
    assert body["codec"]["corpus_export"]["manifest"]["available"] is True
    assert body["codec"]["corpus_export"]["recommendations"]
    assert body["codec"]["export_persisted"] is True
