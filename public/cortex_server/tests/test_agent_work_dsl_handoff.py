from __future__ import annotations

import asyncio

import pytest

import cortex_server.routers.orchestrator as orchestrator
from cortex_server.runtime.agent_work_dsl import (
    AGENT_WORK_SPEC_SCHEMA,
    CORTEX_AGENT_WORK_HANDOFF_SCHEMA,
    AgentWorkSurface,
    CortexAgentWorkHandoff,
    compile_handoff_to_agent_work_spec,
)


def test_cortex_agent_work_handoff_compiles_to_js_dsl_shape():
    handoff = CortexAgentWorkHandoff(
        goalId="agent_work_dsl_cortex_integration",
        objective="Integrate Agent Work DSL as the Cortex orchestration handoff",
        repoPath="/tmp/large-project-capability-stack",
        fidelity="production_slice",
        requestedAgentCount=4,
        permissions={"allow": ["read_repo", "run_tests"], "forbid": ["external_send", "relaunch_benchmark"]},
        doneWhen=["runner_ingestion_passes", "no_truth_layer_overclaim"],
        routeLevels=["L5 oracle", "L7 librarian"],
        memoryCitations=["cortex:agent-work-dsl"],
        surfaces=[
            AgentWorkSurface(
                id="runner_ingestion",
                files=["apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs"],
                verify=["node --test tests/agent-work-dsl.test.mjs"],
            )
        ],
    )

    spec = compile_handoff_to_agent_work_spec(handoff)

    assert handoff.schemaVersion == CORTEX_AGENT_WORK_HANDOFF_SCHEMA
    assert spec["schemaVersion"] == AGENT_WORK_SPEC_SCHEMA
    assert spec["goalId"] == "agent_work_dsl_cortex_integration"
    assert spec["surfaces"][0]["id"] == "runner_ingestion"
    assert spec["surfaces"][0]["metadata"]["cortexSurface"] is True
    assert spec["metadata"]["cortex"]["routeLevels"] == ["L5 oracle", "L7 librarian"]
    assert spec["permissions"]["forbid"] == ["external_send", "relaunch_benchmark"]


def test_cortex_agent_work_handoff_rejects_missing_surface_verifier():
    with pytest.raises(ValueError):
        CortexAgentWorkHandoff(
            goalId="bad",
            objective="bad",
            repoPath="/tmp/repo",
            surfaces=[{"id": "surface", "files": ["src/a.mjs"], "verify": []}],
        )


def test_cortex_agent_work_handoff_rejects_empty_surface_list():
    with pytest.raises(ValueError):
        CortexAgentWorkHandoff(
            goalId="bad",
            objective="bad",
            repoPath="/tmp/repo",
            surfaces=[],
        )


def test_orchestrator_plan_agent_work_route_returns_handoff_and_spec():
    graph = {
        "name": "agent_work_route_canary",
        "goal": "Route Cortex plan into Agent Work DSL",
        "metadata": {"owner": "cortex", "session_key": "session:agent-work-route"},
        "nodes": [
            {
                "node_id": "route_surface",
                "title": "Route surface",
                "endpoint": "/orchestrator/plan/agent-work",
                "metadata": {
                    "files": ["public/cortex_server/cortex_server/routers/orchestrator.py"],
                    "verify": ["PYTHONPATH=/root/clawd/public/cortex_server pytest -q tests/test_agent_work_dsl_handoff.py"],
                },
            }
        ],
    }

    result = asyncio.run(
        orchestrator.create_agent_work_handoff(
            orchestrator.AgentWorkPlanRequest(
                graph=orchestrator.ReasoningPlanGraph(**graph),
                repo_path="/root/clawd/large-project-capability-stack",
                run_id="route-canary-test",
                permissions={"forbid": ["external_send", "relaunch_benchmark"]},
                route_levels=["L5 oracle", "L7 librarian"],
            )
        )
    )

    assert result["success"] is True
    assert result["schemaVersion"] == CORTEX_AGENT_WORK_HANDOFF_SCHEMA
    assert result["handoff"]["runId"] == "route-canary-test"
    assert result["agent_work_spec"]["schemaVersion"] == AGENT_WORK_SPEC_SCHEMA
    assert result["agent_work_spec"]["surfaces"][0]["id"] == "route_surface"
