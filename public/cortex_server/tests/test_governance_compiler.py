from __future__ import annotations

from cortex_server.modules.governance_compiler import compile_workflow_policy
from cortex_server.modules.reasoning_policy import build_workflow_policy
from tests.test_reasoning_restored_phase_integration import RESTORED_METADATA



def test_governance_compiler_emits_expected_policy_shape_for_restored_stack():
    policy = compile_workflow_policy(
        name="Investigate a degraded production service carefully",
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        metadata=RESTORED_METADATA,
    )

    assert policy["archetype"] in {"ops_triage", "tool_use"}
    assert policy["world_state"]["entity_count"] == 1
    assert policy["truth_engine"]["guard_action"] == "block"
    assert policy["settings"]["verification_mode"] == "strict"
    assert any(row["subsystem"] == "truth_engine" for row in policy["subsystem_activations"])
    assert any(row["domain"] == "routing" for row in policy["decisions"])



def test_reasoning_policy_wrapper_matches_governance_compiler_output():
    compiled = compile_workflow_policy(
        name="Investigate a degraded production service carefully",
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        metadata=RESTORED_METADATA,
    )
    wrapped = build_workflow_policy(
        name="Investigate a degraded production service carefully",
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        metadata=RESTORED_METADATA,
    )

    assert wrapped["settings"] == compiled["settings"]
    assert wrapped["risk_flags"] == compiled["risk_flags"]
    assert wrapped["world_state"]["entity_count"] == compiled["world_state"]["entity_count"]
    assert wrapped["world_state"]["low_confidence_entities"] == compiled["world_state"]["low_confidence_entities"]
    wrapped_activations = {row["subsystem"]: row for row in wrapped["subsystem_activations"]}
    compiled_activations = {row["subsystem"]: row for row in compiled["subsystem_activations"]}
    assert set(wrapped_activations) == set(compiled_activations)
    assert wrapped_activations["truth_engine"]["governance_signals"][0]["recommendation"] == compiled_activations["truth_engine"]["governance_signals"][0]["recommendation"]
    assert wrapped_activations["embodiment"]["governance_signals"][0]["recommendation"] == compiled_activations["embodiment"]["governance_signals"][0]["recommendation"]
