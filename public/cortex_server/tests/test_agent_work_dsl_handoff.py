from __future__ import annotations

import asyncio

import pytest

import cortex_server.routers.orchestrator as orchestrator
from cortex_server.runtime.agent_work_dsl import (
    AGENT_WORK_DEFAULT_RUNTIME,
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
        budgets={"token_cap": 500000, "worker_prompt_tokens": 6000},
        wavePolicy={"max_waves": 4, "full_context_waves": 0},
        expansionPolicy={"triggers": ["objective_red", "graph_exhausted"], "max_cycles": 2},
        evidenceSchemas=[{"id": "handoff_integrity", "gates": ["verified_surface_count >= 1"]}],
        routeLevels=["L5 oracle", "L7 librarian"],
        memoryCitations=["cortex:agent-work-dsl"],
        surfaces=[
            AgentWorkSurface(
                id="runner_ingestion",
                files=["apps/system-benchmark/run-agent-work-objective-controller.mjs"],
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
    assert spec["metadata"]["runtime"]["defaultRunner"] == "objective_controller"
    assert spec["metadata"]["runtime"]["defaultRunnerScript"] == AGENT_WORK_DEFAULT_RUNTIME["defaultRunnerScript"]
    assert spec["permissions"]["forbid"] == ["external_send", "relaunch_benchmark"]
    assert spec["budgets"]["token_cap"] == 500000
    assert spec["wavePolicy"]["full_context_waves"] == 0
    assert spec["expansionPolicy"]["max_cycles"] == 2
    assert spec["evidenceSchemas"][0]["id"] == "handoff_integrity"


def test_cortex_agent_work_handoff_allows_template_only_surface_references():
    handoff = CortexAgentWorkHandoff(
        goalId="templated_surface",
        objective="Compile templated Agent Work surface",
        repoPath="/tmp/repo",
        templates=[{"id": "node_test_surface", "files": ["src/{{id}}.mjs"], "verify": ["node --test {{metadata.test_path}}"]}],
        surfaces=[{"id": "runner", "templateIds": ["node_test_surface"], "metadata": {"test_path": "tests/runner.test.mjs"}}],
    )

    spec = compile_handoff_to_agent_work_spec(handoff)

    assert spec["templates"][0]["id"] == "node_test_surface"
    assert spec["surfaces"][0]["files"] == []
    assert spec["surfaces"][0]["verify"] == []
    assert spec["surfaces"][0]["templateIds"] == ["node_test_surface"]


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
                    "budget": {"token_cap": 500000},
                    "wave_policy": {"max_waves": 2},
                    "expansion_policy": {"triggers": ["objective_red"], "max_cycles": 1},
                    "evidence_schemas": [{"id": "route_integrity", "gates": ["verified_surface_count >= 1"]}],
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
                budgets={"token_cap": 500000},
                wave_policy={"max_waves": 2},
                expansion_policy={"triggers": ["objective_red"], "max_cycles": 1},
                evidence_schemas=[{"id": "route_integrity", "gates": ["verified_surface_count >= 1"]}],
                route_levels=["L5 oracle", "L7 librarian"],
            )
        )
    )

    assert result["success"] is True
    assert result["schemaVersion"] == CORTEX_AGENT_WORK_HANDOFF_SCHEMA
    assert result["handoff"]["runId"] == "route-canary-test"
    assert result["agent_work_spec"]["schemaVersion"] == AGENT_WORK_SPEC_SCHEMA
    assert result["agent_work_spec"]["surfaces"][0]["id"] == "route_surface"
    assert result["agent_work_spec"]["budgets"]["token_cap"] == 500000
    assert result["agent_work_spec"]["wavePolicy"]["max_waves"] == 2
    assert result["agent_work_spec"]["expansionPolicy"]["max_cycles"] == 1
    assert result["agent_work_spec"]["evidenceSchemas"][0]["id"] == "route_integrity"
    assert result["agent_work_spec"]["metadata"]["runtime"]["defaultRunner"] == "objective_controller"
