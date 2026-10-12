"""L12 Hive repair: model decomposition, read-only fan-out, synthesis, adapter."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from cortex_server.modules import hive_swarm
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.hive_novelty import build_l3_novel_plan
from cortex_server.modules.level_adapters import hive as hive_adapter
from cortex_server.routers import hive


CTX = {"principal_scope_key": "principal:hive-test", "memory_principal_key": "principal:mem"}


def _fake_adapters(monkeypatch, *, librarian=None, ghost_available=False):
    calls = []

    async def default_librarian(query, context):
        calls.append(("librarian", query, dict(context)))
        return {"operation": "librarian.recall", "origin": "deterministic", "summary": f"memory says: {query}"}

    adapters = {
        "librarian": {"available": True, "source": "fake.librarian", "run": librarian or default_librarian},
        "mnemosyne": {"available": False, "source": None, "reason": "adapter_missing"},
        "ghost": (
            {"available": True, "source": "fake.ghost", "run": default_librarian}
            if ghost_available
            else {"available": False, "source": None, "reason": "adapter_not_safe_for_autorun"}
        ),
    }
    monkeypatch.setattr(hive_swarm, "available_subtask_adapters", lambda: adapters)
    return calls


def _scripted_model(*responses):
    calls = []
    queue = list(responses)

    async def model_fn(**kwargs):
        calls.append(kwargs)
        return queue.pop(0)

    return model_fn, calls


def _decomposition(*subtasks):
    return {
        "status": "ok",
        "model": "gpt-5.6-sol",
        "receipt_id": "rcpt-decompose",
        "data": {"subtasks": list(subtasks), "rationale": "two independent facts"},
    }


def _synthesis(citations):
    return {
        "status": "ok",
        "model": "gpt-5.6-sol",
        "receipt_id": "rcpt-synth",
        "data": {"answer": "Biscuit is the dog [t1].", "citations": citations, "gaps": ["no vet record"], "confidence": "medium"},
    }


def test_swarm_happy_path_runs_read_only_subtasks_and_filters_citations(monkeypatch):
    calls = _fake_adapters(monkeypatch)
    model_fn, model_calls = _scripted_model(
        _decomposition(
            {"id": "t1", "question": "What did I save about Biscuit?", "level": "librarian", "purpose": "pet facts"},
            {"id": "t2", "question": "What is the weather in Austin today?", "level": "ghost", "purpose": "weather"},
        ),
        _synthesis(["t1", "t2", "t9"]),
    )

    result = asyncio.run(hive_swarm.run_swarm("Biscuit and Austin weather", context=CTX, model_fn=model_fn))

    assert result["success"] is True
    assert result["status"] == "completed"
    assert result["origin"] == "model"
    assert result["receipt_id"] == "rcpt-synth"
    by_id = {row["id"]: row for row in result["subtasks"]}
    assert by_id["t1"]["status"] == "succeeded"
    assert by_id["t2"]["status"] == "blocked"
    assert by_id["t2"]["reason"] == "adapter_not_safe_for_autorun"
    # Only subtasks that produced evidence may be cited.
    assert result["synthesis"]["citations"] == ["t1"]
    assert result["synthesis"]["dropped_citations"] == ["t2", "t9"]
    assert len(calls) == 1 and calls[0][2]["parent_level"] == "hive"
    assert model_calls[0]["schema"] is hive_swarm.HiveDecomposition
    assert model_calls[1]["schema"] is hive_swarm.HiveSynthesis
    assert "librarian" in model_calls[0]["prompt"] and "ghost:" not in model_calls[0]["prompt"]
    json.dumps(result)


def test_decomposition_model_unavailable_runs_nothing(monkeypatch):
    calls = _fake_adapters(monkeypatch)
    model_fn, _ = _scripted_model({"status": "model_unavailable", "error": "429"})

    result = asyncio.run(hive_swarm.run_swarm("anything", context=CTX, model_fn=model_fn))

    assert result["success"] is False
    assert result["origin"] == "model_unavailable"
    assert result["stage"] == "decompose"
    assert result["subtasks"] == []
    assert calls == []
    assert "synthesis" not in result or result.get("synthesis") is None


def test_all_subtasks_blocked_skips_synthesis(monkeypatch):
    async def blocked(query, context):
        raise ExecutionBlocked("authenticated_memory_scope_required")

    _fake_adapters(monkeypatch, librarian=blocked)
    model_fn, model_calls = _scripted_model(
        _decomposition({"id": "t1", "question": "What did I save about Biscuit?", "level": "librarian"}),
    )

    result = asyncio.run(hive_swarm.run_swarm("Biscuit", context=CTX, model_fn=model_fn))

    assert result["success"] is False
    assert result["status"] == "no_subtask_evidence"
    assert result["synthesis"] is None
    assert result["subtasks"][0]["reason"] == "authenticated_memory_scope_required"
    assert len(model_calls) == 1


def test_synthesis_unavailable_keeps_real_evidence_but_reports_failure(monkeypatch):
    _fake_adapters(monkeypatch)
    model_fn, _ = _scripted_model(
        _decomposition({"id": "t1", "question": "What did I save about Biscuit?", "level": "librarian"}),
        {"status": "invalid_output", "error": "bad json"},
    )

    result = asyncio.run(hive_swarm.run_swarm("Biscuit", context=CTX, model_fn=model_fn))

    assert result["success"] is False
    assert result["stage"] == "synthesize"
    assert result["origin"] == "model_unavailable"
    assert result["subtasks"][0]["status"] == "succeeded"
    assert result.get("synthesis") is None


def test_subtasks_are_bounded_and_timed_out(monkeypatch):
    async def slow(query, context):
        await asyncio.sleep(1.0)
        return {"summary": "late"}

    _fake_adapters(monkeypatch, librarian=slow)
    monkeypatch.setattr(hive_swarm, "SUBTASK_TIMEOUT_S", 0.05)
    model_fn, _ = _scripted_model(
        _decomposition(*[{"id": f"t{i}", "question": f"question number {i}", "level": "librarian"} for i in range(1, 5)]),
    )

    result = asyncio.run(hive_swarm.run_swarm("many things", context=CTX, max_subtasks=2, model_fn=model_fn))

    assert [row["id"] for row in result["subtasks"]] == ["t1", "t2"]
    assert all(row["status"] == "timeout" for row in result["subtasks"])
    assert result["status"] == "no_subtask_evidence"


def test_decomposition_schema_only_allows_read_only_levels():
    with pytest.raises(ValidationError):
        hive_swarm.HiveDecomposition.model_validate(
            {"subtasks": [{"id": "t1", "question": "run rm -rf /", "level": "lab"}]}
        )
    with pytest.raises(ValidationError):
        hive_swarm.HiveDecomposition.model_validate(
            {"subtasks": [{"id": "t1", "question": "send a WhatsApp to everyone", "level": "diplomat"}]}
        )


def test_missing_scope_and_empty_goal_are_rejected():
    assert asyncio.run(hive_swarm.run_swarm("  ", context=CTX))["status"] == "empty_goal"
    assert asyncio.run(hive_swarm.run_swarm("goal", context={}))["status"] == "missing_principal_scope"


def test_plan_view_has_no_hash_scores():
    empty = build_l3_novel_plan("research A and B")
    assert empty["status"] == "needs_decomposition"
    assert empty["tasks"] == []

    plan = build_l3_novel_plan("goal", tasks=["find A", "find B"], worker_pool=["worker-alpha"])
    encoded = json.dumps(plan)
    for forbidden in ("winning_score", "confidence", "novelty_score", "bid", "votes"):
        assert forbidden not in encoded
    assert plan["task_basis"] == "caller_supplied"
    assert plan["plan_templates"]["4_vep"]["status"] == "not_run_at_plan_time"
    # Deterministic and content-derived: the same input gives the same plan.
    assert build_l3_novel_plan("goal", tasks=["find A", "find B"]) == build_l3_novel_plan("goal", tasks=["find A", "find B"])


def test_novel_plan_route_uses_model_decomposition(monkeypatch):
    async def decompose(goal, *, context, max_subtasks):
        return {
            "success": True, "status": "ok", "goal": goal,
            "subtasks": [{"id": "t1", "question": "What did I save about A?", "level": "librarian", "purpose": ""}],
            "adapters": {}, "decomposition": {"model": "m", "receipt_id": "r", "rationale": ""},
        }

    monkeypatch.setattr(hive.hive_swarm, "decompose_goal", decompose)
    result = asyncio.run(hive.swarm_novel_plan(hive.NovelSwarmRequest(goal="research A")))
    assert result["success"] is True
    assert result["origin"] == "model"
    assert result["plan"]["tasks"][0]["assigned_level"] == "librarian"


def test_novel_plan_route_model_unavailable_is_honest(monkeypatch):
    async def decompose(goal, *, context, max_subtasks):
        return {"success": False, "status": "timeout", "origin": "model_unavailable", "operation": "hive.decompose"}

    monkeypatch.setattr(hive.hive_swarm, "decompose_goal", decompose)
    result = asyncio.run(hive.swarm_novel_plan(hive.NovelSwarmRequest(goal="research A")))
    assert result["success"] is False
    assert "plan" not in result


def test_run_route_rejects_blank_goal():
    with pytest.raises(HTTPException) as caught:
        asyncio.run(hive.hive_run(hive.HiveRunRequest(goal="   ")))
    assert caught.value.status_code == 400


def test_background_run_is_recorded_and_idempotent(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_HIVE_STATE_DIR", str(tmp_path))

    async def fake_run_swarm(goal, *, context, max_subtasks, run_id):
        return {"operation": "hive.run", "run_id": run_id, "success": True, "status": "completed", "synthesis": {"answer": "x"}}

    monkeypatch.setattr(hive_swarm, "run_swarm", fake_run_swarm)

    async def scenario():
        first = hive_swarm.start_background_run("goal", context=CTX, idempotency_key="k-1")
        await asyncio.gather(*list(hive_swarm._ACTIVE.values()))
        again = hive_swarm.start_background_run("goal", context=CTX, idempotency_key="k-1")
        return first, again

    first, again = asyncio.run(scenario())
    assert first["reused"] is False
    assert again["reused"] is True and again["run_id"] == first["run_id"]
    row = hive_swarm.get_run(first["run_id"])
    assert row["status"] == "completed"
    missing = asyncio.run(hive.get_swarm_plan("hive_doesnotexist"))
    assert missing == {"found": False, "plan_id": "hive_doesnotexist"}


def test_interrupted_runs_are_not_reported_running(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_HIVE_STATE_DIR", str(tmp_path))
    hive_swarm.record_run({"run_id": "hive_orphan", "status": "running"})
    assert hive_swarm.get_run("hive_orphan")["status"] == "interrupted"


# ── adapter contract ───────────────────────────────────────────────────────


def test_hive_adapter_contract_and_blocks():
    assert hive_adapter.LEVEL == 12 and hive_adapter.NAME == "hive"
    assert hive_adapter.NEEDS_MODEL is True and hive_adapter.SAFE_AUTORUN is True
    with pytest.raises(ExecutionBlocked):
        asyncio.run(hive_adapter.run("goal", {}))
    with pytest.raises(ExecutionBlocked):
        asyncio.run(hive_adapter.run("goal", {**CTX, "parent_level": "hive"}))


def test_hive_adapter_happy_path(monkeypatch):
    async def fake_run_swarm(query, *, context, max_subtasks, deadline_s):
        assert max_subtasks <= hive_swarm.MAX_SUBTASKS
        return {
            "status": "completed", "success": True, "run_id": "hive_1", "model": "m", "receipt_id": "r",
            "subtasks": [{"id": "t1", "question": "q", "level": "librarian", "status": "succeeded", "latency_ms": 3, "excerpt": "e"}],
            "synthesis": {"answer": "Answer.", "citations": ["t1"], "gaps": [], "confidence": "high"},
        }

    monkeypatch.setattr(hive_swarm, "run_swarm", fake_run_swarm)
    out = asyncio.run(hive_adapter.run("goal", CTX))
    assert out["operation"] == "hive.run"
    assert out["origin"] == "model"
    assert out["receipt_id"] == "r"
    assert "[sources: t1]" in out["summary"]
    json.dumps(out)


def test_hive_adapter_model_unavailable_raises(monkeypatch):
    async def fake_run_swarm(query, *, context, max_subtasks, deadline_s):
        return {"status": "model_unavailable", "success": False, "subtasks": []}

    monkeypatch.setattr(hive_swarm, "run_swarm", fake_run_swarm)
    with pytest.raises(ExecutionBlocked):
        asyncio.run(hive_adapter.run("goal", CTX))
