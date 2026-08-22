from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator
from cortex_server.modules.reasoning_planner import ReasoningPlanGraph


@pytest.fixture(autouse=True)
def _isolate_runtime_delivery_root(tmp_path, monkeypatch):
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")


def _graph() -> ReasoningPlanGraph:
    return ReasoningPlanGraph(
        name="operator_control_plan",
        metadata={
            "owner": "cortex",
            "session_key": "session:operator-control",
            "archetype": "coding",
        },
        nodes=[
            {"node_id": "step1", "title": "Step1", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "ok"}},
            {"node_id": "step2", "title": "Step2", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "ok2"}},
        ],
    )



def _audit_events(process_id: str):
    return [row for row in orchestrator.get_runtime_events(process_id, limit=200) if row.get("kind") == "homeostasis_control_audit"]



def test_runtime_homeostasis_freeze_route_applies_patch_pauses_and_records_audit(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=_graph())))
    process_id = scheduled["process"]["process_id"]
    baseline_settings = dict(scheduled["process"]["workflow"]["metadata"]["policy"]["settings"])

    frozen = asyncio.run(
        orchestrator.freeze_runtime_homeostasis(
            process_id,
            orchestrator.RuntimeHomeostasisControlRequest(actor_id="cortex", reason="freeze for audit"),
        )
    )
    history = asyncio.run(orchestrator.get_runtime_policy_history(process_id))
    frozen_settings = dict(frozen["process"]["workflow"]["metadata"]["policy"]["settings"])
    audit_events = _audit_events(process_id)

    assert frozen["success"] is True
    assert frozen["control"] == "freeze_policy"
    assert frozen["authorization"]["authorized"] is True
    assert frozen["authorization"]["basis"] in {"owner_match", "system_default"}
    assert frozen["frozen"] is True
    assert frozen["process"]["status"] == "paused"
    assert frozen["process"]["workflow"]["metadata"]["same_tick_drain"] is False
    assert frozen_settings["execution_mode"] == "sequential"
    assert frozen_settings["max_parallelism"] == 1
    assert frozen_settings["retry_max_attempts"] == 2
    assert history["policy_patch_history"]["entries"][0]["kind"] == "policy_patch_applied"
    assert history["policy_patch_history"]["entries"][0]["audit"]["control"] == "freeze_policy"
    changed = {
        key for key in ["execution_mode", "max_parallelism", "same_tick_drain", "verification_mode", "retry_on_timeout", "retry_max_attempts"]
        if baseline_settings.get(key) != frozen_settings.get(key)
    }
    assert set(history["policy_patch_history"]["entries"][0]["settings"]) == changed
    assert audit_events[0]["payload"]["status"] == "requested"
    assert audit_events[-1]["payload"]["status"] == "completed"
    assert audit_events[-1]["payload"]["actor"]["actor_id"] == "cortex"
    assert audit_events[-1]["payload"]["authorization"]["authorized"] is True



def test_runtime_homeostasis_rollback_route_reverts_latest_patch_and_records_audit(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=_graph())))
    process_id = scheduled["process"]["process_id"]
    baseline_settings = dict(scheduled["process"]["workflow"]["metadata"]["policy"]["settings"])

    frozen = asyncio.run(orchestrator.freeze_runtime_homeostasis(process_id, orchestrator.RuntimeHomeostasisControlRequest(actor_id="cortex")))
    rolled_back = asyncio.run(orchestrator.rollback_runtime_homeostasis(process_id, orchestrator.RuntimeHomeostasisControlRequest(actor_id="cortex", reason="restore baseline")))
    history = asyncio.run(orchestrator.get_runtime_policy_history(process_id))
    rolled_settings = dict(rolled_back["process"]["workflow"]["metadata"]["policy"]["settings"])
    audit_events = _audit_events(process_id)

    assert rolled_back["success"] is True
    assert rolled_back["control"] == "rollback_to_baseline"
    assert rolled_back["authorization"]["authorized"] is True
    assert rolled_back["rolled_back"] is True
    assert rolled_back["rolled_back_from_revision_id"] == frozen["revision_id"]
    assert "verification_mode" not in rolled_back["process"]["workflow"]["metadata"]
    assert "same_tick_drain" not in rolled_back["process"]["workflow"]["metadata"]
    assert rolled_settings["execution_mode"] == baseline_settings["execution_mode"]
    assert rolled_settings["max_parallelism"] == baseline_settings["max_parallelism"]
    assert rolled_settings["verification_mode"] == baseline_settings["verification_mode"]
    assert rolled_settings["same_tick_drain"] == baseline_settings["same_tick_drain"]
    assert rolled_settings["retry_max_attempts"] == baseline_settings["retry_max_attempts"]
    assert rolled_back["process"]["status"] == "paused"
    assert history["policy_patch_history"]["entries"][1]["kind"] == "policy_patch_rolled_back"
    assert history["policy_patch_history"]["entries"][1]["audit"]["control"] == "rollback_to_baseline"
    assert audit_events[-1]["payload"]["status"] == "completed"
    assert audit_events[-1]["payload"]["control"] == "rollback_to_baseline"



def test_runtime_homeostasis_resume_route_unpauses_process_and_records_audit(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=_graph())))
    process_id = scheduled["process"]["process_id"]

    asyncio.run(orchestrator.freeze_runtime_homeostasis(process_id, orchestrator.RuntimeHomeostasisControlRequest(actor_id="cortex")))
    resumed = asyncio.run(orchestrator.resume_runtime_homeostasis(process_id, orchestrator.RuntimeHomeostasisControlRequest(actor_id="cortex", reason="resume after review")))
    audit_events = _audit_events(process_id)

    assert resumed["success"] is True
    assert resumed["control"] == "resume_governor"
    assert resumed["authorization"]["authorized"] is True
    assert resumed["resumed"] is True
    assert resumed["process"]["enabled"] is True
    assert resumed["process"]["status"] != "paused"
    assert audit_events[-1]["payload"]["control"] == "resume_governor"
    assert audit_events[-1]["payload"]["status"] == "completed"



def test_runtime_homeostasis_controls_deny_unauthorized_actor_and_audit_denial(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=_graph())))
    process_id = scheduled["process"]["process_id"]

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            orchestrator.freeze_runtime_homeostasis(
                process_id,
                orchestrator.RuntimeHomeostasisControlRequest(actor_id="outsider", actor_session_key="session:not-owner", reason="unauthorized probe"),
            )
        )
    audit_events = _audit_events(process_id)

    assert exc.value.status_code == 403
    assert audit_events[-1]["payload"]["status"] == "denied"
    assert audit_events[-1]["payload"]["actor"]["actor_id"] == "outsider"
    assert audit_events[-1]["payload"]["authorization"]["authorized"] is False
