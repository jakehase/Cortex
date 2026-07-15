import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.routers.oracle as oracle
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.modules.cortex_codec import update_codec_state_for_session
from cortex_server.routers.oracle import _apply_codec_routing_priors, _best_effort_answer, _codec_prefix, _passive_followup_verifier, _record_oracle_turn


def test_oracle_codec_prefix_uses_shared_session_state(monkeypatch):
    monkeypatch.setattr(oracle, "get_codec_policy_for_query", lambda query: {"action": "neutral", "confidence": 0.0})
    session_key = "oracle-codec-test"
    update_codec_state_for_session(
        session_key,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Build the Cortex Codec into Nexus and OpenClaw.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    prefix = _codec_prefix(session_key, "How should we wire this into the real prompt path?")

    assert prefix.startswith("Cortex Codec state")
    assert "[Cortex]" in prefix or "Projects:" in prefix


def test_oracle_codec_prefix_respects_skip_policy(monkeypatch):
    monkeypatch.setattr(oracle, "get_codec_policy_for_query", lambda query: {"action": "skip_codec", "confidence": 0.9, "should_inject": False})
    session_key = "oracle-codec-skip-policy-test"
    update_codec_state_for_session(
        session_key,
        [{"text": "Build the Cortex Codec into Nexus and OpenClaw.", "metadata": {"project": "Cortex Codec"}}],
    )

    prefix = _codec_prefix(session_key, "Plan the architecture tradeoff for this change.")

    assert prefix == ""


def test_record_oracle_turn_registers_served_variant(monkeypatch):
    captured = {}
    monkeypatch.setattr(oracle, "register_codec_session_turn", lambda session_key, **kwargs: captured.update({"session_key": session_key, **kwargs}) or {"recorded": True})

    trace = _record_oracle_turn(
        "oracle-register-test",
        "Plan the architecture tradeoff for this change.",
        "Here is the answer.",
        lane="alive_orchestrated",
        codec_applied=True,
        referents_applied=True,
    )

    assert trace["variant"] == "referents_plus_codec"
    assert trace["policy_turn_registered"] is True
    assert captured["variant"] == "referents_plus_codec"
    assert captured["codec_applied"] is True
    assert captured["referents_applied"] is True


def test_record_oracle_turn_emits_execution_artifact(monkeypatch):
    monkeypatch.setattr(oracle, "observe_codec_outcome", lambda **kwargs: {"recorded": True, "variant": kwargs["policy_label"], "source": "oracle_execution_flow", "outcome_confidence": kwargs["outcome_confidence"], "step_summary": {"helpful": [{"name": "lane:strict_contract"}], "risky": []}})

    trace = _record_oracle_turn(
        "oracle-execution-test",
        "Plan the architecture tradeoff for this change.",
        "Here is the answer.",
        lane="strict_contract",
        codec_applied=True,
        referents_applied=True,
        used_backend="fake-model",
        fallback_reason="",
        contract_ok=True,
    )

    assert trace["execution"]["recorded"] is True
    assert trace["execution"]["source"] == "oracle_execution_flow"
    assert trace["execution"]["execution_metrics"]["lane"] == "strict_contract"
    assert trace["execution"]["execution_metrics"]["confidence"] > 0.5
    assert "step_attribution" in trace["execution"]["execution_metrics"]
    assert any(item["name"].startswith("lane:") for item in trace["execution"]["step_summary"]["helpful"])


def test_oracle_codec_prefix_uses_boosted_budget_when_policy_prefers_codec(monkeypatch):
    observed = {}
    monkeypatch.setattr(oracle, "get_codec_policy_for_query", lambda query: {"action": "prefer_codec", "confidence": 0.9, "should_inject": True, "boost_factor": 1.5})
    monkeypatch.setattr(oracle, "get_codec_packet_for_session", lambda session_key, max_chars=0: observed.update({"max_chars": max_chars}) or {"available": True, "packet": "Prefs: [Cortex]"})

    prefix = _codec_prefix("oracle-boost-test", "Plan the architecture tradeoff for this change.")

    assert prefix.startswith("Cortex Codec state")
    assert observed["max_chars"] > oracle.ORACLE_CODEC_MAX_CHARS


def test_oracle_applies_codec_routing_priors(monkeypatch):
    monkeypatch.setattr(oracle, "get_codec_routing_priors", lambda query: {"confidence": 0.7, "prefer_orchestrated": True, "avoid_fallback": True, "avoid_tinyllama": False, "quality_bias": "deeper"})

    result = _apply_codec_routing_priors(
        "Plan the architecture tradeoff for this change.",
        use_bridge=False,
        quality_mode={"mode": "shallow", "score": 0, "reasons": []},
        strict_contract=False,
    )

    assert result["use_bridge"] is True
    assert result["force_orchestrate"] is True
    assert result["quality_mode"]["mode"] == "medium"


def test_best_effort_answer_respects_avoid_tinyllama_prior(monkeypatch):
    monkeypatch.setattr(oracle, "ORACLE_FALLBACKS_ENABLED", True)
    monkeypatch.setattr(oracle, "_is_frontend_prompt", lambda text: False)
    monkeypatch.setattr(oracle, "_openclaw_rate_limited_active", lambda: True)
    monkeypatch.setattr(oracle, "_tinyllama_allowed", lambda *a, **k: True)
    monkeypatch.setattr(oracle, "_should_hedge_bridge", lambda *a, **k: False)
    monkeypatch.setattr(oracle, "call_bridge", lambda prompt: (_ for _ in ()).throw(RuntimeError("bridge down")))
    monkeypatch.setattr(oracle, "_solve_with_self_consistency", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("openclaw down")))
    monkeypatch.setattr(oracle, "ensure_ollama_ready", lambda: (_ for _ in ()).throw(AssertionError("tinyllama should be skipped")))

    try:
        _best_effort_answer(
            "Explain the architecture tradeoff here.",
            None,
            "normal",
            "medium",
            {"avoid_tinyllama": True, "avoid_fallback": True, "quality_bias": "deeper"},
        )
        assert False, "expected HTTPException"
    except Exception as e:
        from fastapi import HTTPException
        assert isinstance(e, HTTPException)
        assert "tinyllama_disabled_by_codec_policy_or_prompt_safety" in str(e.detail)


def test_best_effort_answer_can_prefer_bridge_first_from_priors(monkeypatch):
    monkeypatch.setattr(oracle, "ORACLE_FALLBACKS_ENABLED", True)
    monkeypatch.setattr(oracle, "BRIDGE_URL", "http://bridge.test")
    monkeypatch.setattr(oracle, "_is_frontend_prompt", lambda text: False)
    monkeypatch.setattr(oracle, "_bridge_cb_allows", lambda: True)
    monkeypatch.setattr(oracle, "call_bridge", lambda prompt: "bridge answer")
    monkeypatch.setattr(oracle, "_solve_with_self_consistency", lambda *a, **k: (_ for _ in ()).throw(AssertionError("openclaw should not run first")))

    text, model, reason = _best_effort_answer(
        "Explain the architecture tradeoff here.",
        None,
        "normal",
        "medium",
        {"prefer_bridge_first": True},
    )

    assert text == "bridge answer"
    assert model == oracle.BRIDGE_MODEL_LABEL
    assert reason == "codec_policy_bridge_first"


def test_best_effort_answer_can_avoid_bridge_fallback_from_priors(monkeypatch):
    monkeypatch.setattr(oracle, "ORACLE_FALLBACKS_ENABLED", True)
    monkeypatch.setattr(oracle, "_is_frontend_prompt", lambda text: False)
    monkeypatch.setattr(oracle, "_openclaw_rate_limited_active", lambda: False)
    monkeypatch.setattr(oracle, "_should_hedge_bridge", lambda *a, **k: False)
    monkeypatch.setattr(oracle, "_solve_with_self_consistency", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("openclaw down")))
    monkeypatch.setattr(oracle, "call_bridge", lambda prompt: (_ for _ in ()).throw(AssertionError("bridge fallback should be skipped")))
    monkeypatch.setattr(oracle, "_tinyllama_allowed", lambda *a, **k: False)

    try:
        _best_effort_answer(
            "Explain the architecture tradeoff here.",
            None,
            "normal",
            "medium",
            {"avoid_bridge_fallback": True, "avoid_tinyllama": True},
        )
        assert False, "expected HTTPException"
    except Exception as e:
        from fastapi import HTTPException
        assert isinstance(e, HTTPException)
        assert "tinyllama_disabled_by_codec_policy_or_prompt_safety" in str(e.detail)


def test_oracle_passive_followup_verifier_parses_json_decision(monkeypatch):
    monkeypatch.setattr(oracle, "_best_effort_answer", lambda prompt, system=None, priority=None, depth_mode=None, routing_priors=None: ('{"decision":"success","confidence":0.82,"reason":"Clear success signal."}', 'fake-model', 'test'))

    result = _passive_followup_verifier({
        "followup_query": "Bootstrap token mismatch gone on the node.",
        "prior_query": "How do I fix the bootstrap token pairing failure?",
        "prior_response": "Rotate the bootstrap token and re-pair the node so the token mismatch clears.",
        "signal": {"confidence": 0.41},
    })

    assert result["decision"] == "success"
    assert result["confidence"] == 0.82
    assert result["reason"]


def test_oracle_chat_failure_records_execution_outcome(monkeypatch):
    captured = {}
    monkeypatch.setenv("ORACLE_ROUTE_TO_AUGMENTER", "false")
    monkeypatch.setenv("ORACLE_EMERGENCY_BYPASS", "false")
    monkeypatch.setattr(oracle, "observe_codec_outcome", lambda **kwargs: captured.update(kwargs) or {"recorded": True})
    monkeypatch.setattr(oracle, "get_alive_mode", lambda loader: type("Alive", (), {"enabled": lambda self: False})())
    monkeypatch.setattr(oracle, "_strict_micro_fast_answer", lambda *a, **k: None)
    monkeypatch.setattr(oracle, "_semantic_guardrail_response", lambda *a, **k: None)
    monkeypatch.setattr(oracle, "_best_effort_answer", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(oracle.router, prefix="/oracle")
    client = TestClient(app, raise_server_exceptions=False)

    r = client.post("/oracle/chat", json={"prompt": "Explain the architecture tradeoff here.", "priority": "normal"})

    assert r.status_code == 500
    assert captured["execution_success"] is False
    assert captured["recovery_needed"] is True
    assert captured["source"] == "oracle_execution_flow"
    assert str(captured["note"]).startswith("oracle_exception:")


@pytest.mark.asyncio
async def test_oracle_emergency_bypass_is_opt_in_when_environment_is_unset(monkeypatch):
    monkeypatch.delenv("ORACLE_EMERGENCY_BYPASS", raising=False)
    monkeypatch.setenv("ORACLE_ROUTE_TO_AUGMENTER", "false")
    monkeypatch.setenv("ORACLE_KERNEL_V2_ENABLED", "true")
    monkeypatch.setenv("ORACLE_KERNEL_V2_MODE", "active")
    observed = {}

    async def _run_inline(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(oracle, "run_in_threadpool", _run_inline)
    monkeypatch.setattr(oracle, "observe_passive_codec_feedback", lambda *a, **k: {"observed": False})
    monkeypatch.setattr(oracle, "get_alive_mode", lambda loader: type("Alive", (), {"enabled": lambda self: False})())
    monkeypatch.setattr(oracle, "_strict_micro_fast_answer", lambda *a, **k: None)
    monkeypatch.setattr(oracle, "_semantic_guardrail_response", lambda *a, **k: None)
    monkeypatch.setattr(
        oracle,
        "_record_oracle_turn",
        lambda *a, **k: {"kernel_v2": {"actual_lane": "best_effort"}},
    )
    monkeypatch.setattr(
        oracle,
        "_best_effort_answer",
        lambda *args, **kwargs: observed.update({"called": True}) or ("normal path answer", "fake-model", "fake-backend"),
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(oracle.router, prefix="/oracle")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/oracle/chat",
            json={"prompt": "Plan the architecture tradeoff for this runtime rollout.", "priority": "normal"},
        )

    assert response.status_code == 200
    body = response.json()
    assert observed["called"] is True
    assert body["model"] == "fake-model"
    assert body["routing_trace"]["kernel_v2"]["result"]["actual_lane"] == "best_effort"
    assert body["routing_trace"]["path"] != "emergency_static"
