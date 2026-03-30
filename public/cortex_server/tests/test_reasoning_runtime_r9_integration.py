from __future__ import annotations

import asyncio

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator
from cortex_server.modules import reasoning_runtime_execution as runtime_execution
from cortex_server.modules.reasoning_planner import ReasoningPlanGraph
from cortex_server.modules.reasoning_runtime_explain import assemble_runtime_process_explain, assemble_runtime_policy_response



def test_workflow_policy_settings_enforces_r9_deliberate_runtime_timeout_controls():
    metadata = {
        "policy": {
            "settings": {
                "execution_mode": "parallel",
                "max_parallelism": 4,
                "same_tick_drain": True,
                "retry_max_attempts": 1,
            },
            "routing_r9": {
                "enabled": True,
                "selected_chain": "deliberate_council",
                "default_chain": "fastlane_memory",
                "allowed_chain_ids": ["fastlane_memory", "deliberate_council"],
                "coarse_choice": "deliberate",
                "utility": 0.91,
                "estimated_quality": 0.88,
            },
        }
    }

    settings = runtime_execution.workflow_policy_settings(metadata)
    routing = runtime_execution.runtime_routing_summary(metadata)

    assert settings["execution_mode"] == "parallel"
    assert settings["same_tick_drain"] is True
    assert settings["step_timeout_seconds"] == 6.0
    assert settings["routing_runtime_enforced"] is True
    assert routing["selected_chain"] == "deliberate_council"
    assert routing["runtime_controls"]["execution_mode"] == "parallel"



def test_workflow_policy_settings_enforces_r9_research_runtime_controls():
    metadata = {
        "policy": {
            "settings": {
                "execution_mode": "parallel",
                "max_parallelism": 3,
                "same_tick_drain": True,
                "retry_max_attempts": 1,
                "retry_on_timeout": False,
            },
            "routing_r9": {
                "enabled": True,
                "selected_chain": "research_grounded",
                "default_chain": "fastlane_memory",
                "allowed_chain_ids": ["fastlane_memory", "research_grounded"],
                "coarse_choice": "deliberate",
                "utility": 0.93,
                "estimated_quality": 0.9,
            },
        }
    }

    settings = runtime_execution.workflow_policy_settings(metadata)

    assert settings["execution_mode"] == "sequential"
    assert settings["same_tick_drain"] is False
    assert settings["step_timeout_seconds"] == 8.0
    assert settings["retry_on_timeout"] is True
    assert settings["retry_max_attempts"] >= 2



def test_create_and_run_plan_r9_research_forces_sequential_runtime(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    call_log = []

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        applied = runtime_execution.workflow_policy_settings(workflow_metadata)
        call_log.append((step.get("node_id"), len(results_by_node), applied.get("execution_mode"), applied.get("same_tick_drain")))
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
        name="Research the latest outage status with sources",
        metadata={
            "owner": "cortex",
            "session_key": "session:r9-runtime",
            "execution_mode": "parallel",
            "max_parallelism": 3,
            "enable_homeostasis_policy": False,
            "risk_flags": ["live_state"],
        },
        nodes=[
            {"node_id": "a", "title": "A", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "a"}},
            {"node_id": "b", "title": "B", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "b"}},
            {"node_id": "c", "title": "C", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "c"}},
        ],
    )

    result = asyncio.run(orchestrator.create_and_run_plan(graph))

    assert result["execution"]["status"] == "success"
    assert call_log[0] == ("a", 0, "sequential", False)
    assert call_log[1][1] >= 1
    assert call_log[2][1] >= 2



def test_runtime_explain_surfaces_r9_routing_summary():
    policy = {
        "settings": {
            "execution_mode": "sequential",
            "max_parallelism": 1,
            "same_tick_drain": False,
            "routing_selected_chain": "research_grounded",
            "routing_default_chain": "fastlane_memory",
            "routing_allowed_chain_ids": ["fastlane_memory", "research_grounded"],
            "routing_r9_enabled": True,
            "routing_r9_utility": 0.92,
            "routing_override_reason": None,
        },
        "routing_r9": {
            "enabled": True,
            "selected_chain": "research_grounded",
            "default_chain": "fastlane_memory",
            "allowed_chain_ids": ["fastlane_memory", "research_grounded"],
            "coarse_choice": "deliberate",
            "utility": 0.92,
            "estimated_quality": 0.89,
        },
        "decisions": [
            {
                "domain": "routing_r9",
                "chosen": "research_grounded",
                "rationale": "intent=research, utility=0.92",
                "confidence": 0.8,
                "alternatives": ["fastlane_memory", "research_grounded"],
                "inputs": {"belief_ids": [], "coarse_choice": "deliberate", "override_reason": None},
                "metrics": {},
            }
        ],
        "belief_influences": [],
        "belief_influence_ids": [],
    }
    process = {
        "process_id": "proc_r9",
        "status": "scheduled",
        "workflow": {"metadata": {"policy": policy}, "steps": [{"node_id": "step1", "title": "Step 1"}]},
        "nodes": {},
        "results_by_node": {
            "step1": {
                "success": True,
                "elapsed_ms": 1.0,
                "routing": {
                    "selected_chain": "research_grounded",
                    "override_reason": None,
                    "runtime_controls": {"step_timeout_seconds": 8.0},
                },
            }
        },
    }

    explained = assemble_runtime_process_explain(
        process_id="proc_r9",
        process=process,
        beliefs_for_task_fn=lambda task_id, limit=200: [],
        summarize_beliefs_fn=lambda **kwargs: {"count": 0},
        explain_belief_fn=lambda claim_id: None,
        get_belief_fn=lambda claim_id: None,
        select_influential_beliefs_fn=lambda **kwargs: [],
    )
    response = assemble_runtime_policy_response(
        process_id="proc_r9",
        process=process,
        explained=explained,
        explain_belief_fn=lambda claim_id: None,
        get_belief_fn=lambda claim_id: None,
    )

    assert explained["routing_r9_summary"]["selected_chain"] == "research_grounded"
    assert response["routing_r9_summary"]["selected_chain"] == "research_grounded"
    assert explained["execution_trace"][0]["routing_selected_chain"] == "research_grounded"
