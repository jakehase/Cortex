from __future__ import annotations

import asyncio

import pytest

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator
from cortex_server.modules import reasoning_runtime_execution as runtime_execution
from cortex_server.modules.reasoning_planner import ReasoningPlanGraph


PROTECTIVE_SNAPSHOT = {
    "smoothed_state_vector": {
        "urgency": 0.28,
        "risk_pressure": 0.74,
        "fatigue": 0.26,
        "timeout_pressure": 0.25,
        "error_pressure": 0.33,
        "budget_pressure": 0.21,
        "escalation_debt": 0.29,
    }
}


@pytest.fixture(autouse=True)
def _isolate_runtime_delivery_root(tmp_path, monkeypatch):
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")



def test_workflow_policy_settings_derives_protective_runtime_controls():
    metadata = {
        "policy": {
            "settings": {
                "execution_mode": "parallel",
                "max_parallelism": 4,
                "verification_mode": "basic",
                "retry_max_attempts": 1,
            },
            "homeostasis": {
                "enabled": True,
                "mode": "protective",
                "intent": "coding",
                "risk_tier": "high",
                "effort": {
                    "reasoning_depth": 4,
                    "human_review_required": True,
                    "escalation_recommended": True,
                },
                "guardrails": {
                    "prefer_chain": "deliberate_council",
                    "allowed_chains": ["deliberate_council"],
                    "block_fastlane": True,
                },
            },
        }
    }

    settings = runtime_execution.workflow_policy_settings(metadata)

    assert settings["execution_mode"] == "sequential"
    assert settings["max_parallelism"] == 1
    assert settings["same_tick_drain"] is False
    assert settings["verification_mode"] == "strict"
    assert settings["retry_max_attempts"] >= 2
    assert settings["step_timeout_seconds"] == 12.0
    assert settings["homeostasis_runtime_enforced"] is True



def test_effective_step_timeout_uses_homeostasis_overlay_when_no_explicit_timeout():
    metadata = {
        "policy": {
            "settings": {},
            "homeostasis": {
                "enabled": True,
                "mode": "protective",
                "effort": {"reasoning_depth": 5},
                "guardrails": {"prefer_chain": "deliberate_council"},
            },
        }
    }

    timeout_s = runtime_execution.effective_step_timeout(
        {"endpoint": "/oracle/chat", "method": "POST"},
        metadata,
        step_timeout_max_s=20,
    )

    assert timeout_s == 14.0



def test_orchestrator_runtime_homeostasis_protective_disables_same_tick_drain_and_records_summary(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True, "node": step.get("node_id")},
            "elapsed_ms": 1.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="protective_tick_plan",
        metadata={
            "owner": "cortex",
            "session_key": "session:protective-tick",
            "archetype": "coding",
            "homeostasis_intent": "coding",
            "homeostasis_risk_tier": "high",
            "homeostasis_state_snapshot": PROTECTIVE_SNAPSHOT,
        },
        nodes=[
            {"node_id": "a", "title": "A", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "a"}},
            {"node_id": "b", "title": "B", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "b"}},
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    process_id = scheduled["process"]["process_id"]

    first_tick = asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    second_tick = asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    process_view = asyncio.run(orchestrator.get_runtime_process_view(process_id))

    assert first_tick["executed_count"] == 1
    assert second_tick["executed_count"] == 1
    assert first_tick["executed"][0]["result"]["homeostasis"]["mode"] == "protective"
    assert first_tick["executed"][0]["result"]["homeostasis"]["runtime_controls"]["same_tick_drain"] is False
    assert process_view["process"]["status"] == "completed"
    assert process_view["homeostasis_summary"]["mode"] == "protective"



def test_create_and_run_plan_homeostasis_protective_forces_sequential_execution(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    call_log = []

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        call_log.append((step.get("node_id"), len(results_by_node), workflow_metadata.get("policy", {}).get("settings", {}).get("execution_mode")))
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True},
            "elapsed_ms": 1.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="protective_parallel_override",
        metadata={
            "owner": "cortex",
            "session_key": "session:protective-parallel",
            "archetype": "coding",
            "execution_mode": "parallel",
            "max_parallelism": 3,
            "homeostasis_intent": "coding",
            "homeostasis_risk_tier": "high",
            "homeostasis_state_snapshot": PROTECTIVE_SNAPSHOT,
        },
        nodes=[
            {"node_id": "a", "title": "A", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "a"}},
            {"node_id": "b", "title": "B", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "b"}},
            {"node_id": "c", "title": "C", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "c"}},
        ],
    )

    result = asyncio.run(orchestrator.create_and_run_plan(graph))

    assert result["execution"]["status"] == "success"
    assert call_log[0] == ("a", 0, "sequential")
    assert call_log[1][1] >= 1
    assert call_log[2][1] >= 2
