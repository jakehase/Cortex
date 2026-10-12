"""L37 Awareness repair: honest predictions, in-process health, model calls off by default."""

import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from cortex_server.modules import level_model, level_probe
from cortex_server.modules.level_adapters import awareness as awareness_adapter
from cortex_server.routers import awareness


@pytest.fixture
def wm(tmp_path, monkeypatch):
    monkeypatch.setattr(awareness, "WORKING_MEMORY_PATH", tmp_path / "working-memory.json")
    monkeypatch.setattr(
        awareness, "get_consciousness_core", lambda: SimpleNamespace(_think_sync=lambda *_a, **_k: None)
    )
    monkeypatch.delenv("CORTEX_AWARENESS_MODEL_CALLS", raising=False)
    monkeypatch.delenv("CORTEX_AWARENESS_CROSS_LEVEL_CHAINS", raising=False)
    memory = awareness.WorkingMemory()
    monkeypatch.setattr(awareness, "_memory", memory)

    async def no_http(*_args, **_kwargs):
        raise AssertionError("awareness must not make HTTP self-calls here")

    monkeypatch.setattr(awareness, "chain_to", no_http)
    return memory


def _meta(memory):
    return memory.get_state()["meta"]


def test_unrelated_event_never_confirms_a_prediction(wm):
    wm.predict("the moon turns green", confidence=0.9, basis="manual")
    awareness._on_bus_event("oracle", "action_complete", {"x": 1})
    assert _meta(wm)["predictions_correct"] == 0
    assert wm.get_active_predictions()[0]["outcome"] is None


def test_prediction_with_matching_criterion_is_confirmed(wm):
    wm.predict("an error will be reported", basis="manual", event_type_hint="action_error", deadline_s=60)
    awareness._on_bus_event("oracle", "action_complete", {})
    assert _meta(wm)["predictions_correct"] == 0
    awareness._on_bus_event("oracle", "action_error", {"error": "x"})
    assert _meta(wm)["predictions_correct"] == 1
    assert wm.get_prediction_accuracy() == 1.0


def test_deadline_passing_counts_wrong_and_no_criterion_expires(wm):
    wm.predict("checkable", basis="manual", event_type_hint="chain_error", deadline_s=60)
    wm.predict("uncheckable", basis="manual")
    past = (datetime.now() - timedelta(seconds=5)).isoformat()
    for row in wm._state["predictions"]:
        row["resolution"]["deadline_at"] = past
    wm.tick()
    meta = _meta(wm)
    assert meta["predictions_wrong"] == 1
    assert meta["predictions_expired_total"] == 1
    assert meta["predictions_correct"] == 0


def test_bootstrap_never_fabricates_an_oracle_prediction(wm, monkeypatch):
    async def must_not_call(**_kwargs):
        raise AssertionError("model calls are disabled by default")

    monkeypatch.setattr(level_model, "level_model_json", must_not_call)
    asyncio.run(awareness._bootstrap_autonomous_cognition(wm))
    meta = _meta(wm)
    assert meta["oracle_predictions_made"] == 0
    assert not [p for p in wm._state["predictions"] if p["basis"] == "oracle_semantic"]


def test_semantic_prediction_uses_level_model_when_enabled(wm, monkeypatch):
    monkeypatch.setenv("CORTEX_AWARENESS_MODEL_CALLS", "1")
    wm.observe({"from_level": "oracle", "event_type": "action_start", "data_keys": []})

    async def fake_model(**kwargs):
        assert kwargs["principal_scope_key"] != "internal-system"
        return {"ok": True, "status": "ok", "model": "gpt-5.6-sol", "receipt_id": "r1",
                "data": {"prediction": "oracle completes", "observable_event_type": "action_complete",
                         "deadline_seconds": 120}}

    monkeypatch.setattr(level_model, "level_model_json", fake_model)
    asyncio.run(awareness._semantic_predict(wm))
    oracle_preds = [p for p in wm._state["predictions"] if p["basis"] == "oracle_semantic"]
    assert len(oracle_preds) == 1
    assert oracle_preds[0]["resolution"]["kind"] == "event_type"
    assert _meta(wm)["oracle_predictions_made"] == 1


def test_semantic_prediction_model_unavailable_records_nothing(wm, monkeypatch):
    monkeypatch.setenv("CORTEX_AWARENESS_MODEL_CALLS", "1")
    wm.observe({"from_level": "oracle", "event_type": "action_start", "data_keys": []})

    async def unavailable(**_kwargs):
        return {"ok": False, "status": "model_unavailable"}

    monkeypatch.setattr(level_model, "level_model_json", unavailable)
    asyncio.run(awareness._semantic_predict(wm))
    assert _meta(wm)["oracle_predictions_made"] == 0
    assert not [p for p in wm._state["predictions"] if p["basis"] == "oracle_semantic"]


def test_health_probe_is_in_process(wm):
    health = asyncio.run(awareness._probe_health())
    assert "kernel" in health["active"]
    assert "kernel_non_operational" not in health["degraded"]


def test_status_capabilities_are_derived_and_disabled_ones_are_listed(wm):
    status = asyncio.run(awareness.awareness_status())
    assert "emergence_detection" not in status["capabilities"]
    assert "wonder_loop" not in status["capabilities"]
    assert "oracle_semantic_predictions" not in status["capabilities"]
    assert {"emergence_detection", "wonder_loop"} <= set(status["disabled_capabilities"])
    assert status["model_calls_enabled"] is False
    assert status["capability_checks"]["persistent_working_memory"]["working"] is True


def test_pending_insights_get_is_non_destructive_and_claim_drains(wm, monkeypatch):
    monkeypatch.setattr(awareness, "_pending_insights", [{"message": "m", "question": "q", "timestamp": "t"}])
    first = asyncio.run(awareness.get_pending_insights())
    second = asyncio.run(awareness.get_pending_insights())
    assert first["count"] == second["count"] == 1
    assert first["producer_enabled"] is False
    claimed = asyncio.run(awareness.claim_pending_insights())
    assert claimed["count"] == 1
    assert asyncio.run(awareness.get_pending_insights())["count"] == 0


def test_wonder_loop_is_honestly_disabled(wm, monkeypatch):
    monkeypatch.setattr(awareness, "_wonder_state", {
        "active_wonder": "stale", "wonder_ticks": 3, "wonder_max_ticks": 10, "wonder_chain": [], "wonder_findings": [],
    })
    asyncio.run(awareness._continue_wondering(wm))
    assert awareness._is_wondering() is False
    assert awareness._pick_new_wonder(wm) is None  # no canned random topics


def test_resource_uncertainty_is_investigated_with_measurements_not_resolved_blindly(wm):
    wm.register_uncertainty("memory pressure on host", level="kernel", confidence=0.4)
    asyncio.run(awareness._investigate_uncertainties(wm))
    item = wm.get_active_uncertainties()[0]
    assert str(item["investigation_result"]).startswith("Measured:")
    assert _meta(wm)["investigations_run"] == 1


def test_uncertainty_dedupes_by_stable_id_after_redaction(wm):
    wm.register_uncertainty("L7 recall returning empty results", level="librarian")
    assert wm._save() is True
    recovered = awareness.WorkingMemory()
    recovered.register_uncertainty("L7 recall returning empty results", level="librarian")
    assert len(recovered.get_active_uncertainties()) == 1


def test_awareness_adapter_is_read_only(monkeypatch):
    monkeypatch.setattr(awareness, "_memory", None)
    monkeypatch.setattr(level_probe, "resolve_app", lambda app=None: None)
    out = asyncio.run(awareness_adapter.run("how are you doing?", {}))
    assert out["operation"] == "awareness.self_report"
    assert out["origin"] == "deterministic"
    assert awareness._memory is None  # adapter never constructs/loads working memory
    assert "Level availability could not be measured" in out["summary"]


def test_awareness_adapter_reports_open_problems(wm):
    wm.register_uncertainty("Error in oracle: timeout", level="oracle")
    out = asyncio.run(awareness_adapter.run("status", {}))
    assert out["data"]["open_problems"][0]["source"] == "oracle"
    assert len(out["summary"]) <= 1500
