from __future__ import annotations

from cortex_server.modules.reasoning_policy import build_workflow_policy
from cortex_server.modules.reasoning_subsystem_adapters import collect_subsystem_activations, collect_subsystem_bundles
from tests.test_reasoning_restored_phase_integration import RESTORED_METADATA



def test_collect_subsystem_bundles_returns_expected_live_bundles():
    bundles = collect_subsystem_bundles(
        archetype="ops_triage",
        query="Investigate a degraded production service carefully",
        metadata=RESTORED_METADATA,
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        belief_ids=["belief-1", "belief-2"],
        dependency_density=0.0,
        has_contracts=False,
        long_running=False,
    )

    assert bundles["world_state"]["enabled"] is True
    assert bundles["world_state"]["entity_count"] == 1
    assert bundles["modulation"]["enabled"] is True
    assert bundles["workspace"]["selected"] == "planner"
    assert bundles["truth_engine"]["guard_action"] == "block"
    assert bundles["plasticity"]["alert"] is True
    assert bundles["embodiment"]["risk"] == "high"



def test_collect_subsystem_activations_emits_contract_shaped_rows():
    bundles = collect_subsystem_bundles(
        archetype="ops_triage",
        query="Investigate a degraded production service carefully",
        metadata=RESTORED_METADATA,
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        belief_ids=["belief-1", "belief-2"],
        dependency_density=0.0,
        has_contracts=False,
        long_running=False,
    )
    activations = collect_subsystem_activations(bundles=bundles)
    by_name = {row.subsystem: row for row in activations}

    assert by_name["world_state"].active is True
    assert by_name["world_state"].epistemic_contexts[0].entity_ids == ["service:payments"]
    assert by_name["truth_engine"].governance_signals[0].recommendation == "block"
    assert by_name["embodiment"].governance_signals[0].recommendation == "pause"
    assert by_name["plasticity"].governance_signals[0].recommendation == "rollback"



def test_build_workflow_policy_surfaces_subsystem_activations_from_adapters():
    policy = build_workflow_policy(
        name="Investigate a degraded production service carefully",
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        metadata=RESTORED_METADATA,
    )

    activations = {row["subsystem"]: row for row in policy["subsystem_activations"]}

    assert activations["world_state"]["active"] is True
    assert activations["workspace"]["summary"] == "planner"
    assert activations["truth_engine"]["governance_signals"][0]["recommendation"] == "block"
