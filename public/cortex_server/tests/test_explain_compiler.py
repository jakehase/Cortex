from __future__ import annotations

from cortex_server.modules.explain_compiler import compile_control_plane_summary, compile_policy_surface_summaries
from cortex_server.modules.governance_compiler import compile_workflow_policy
from tests.test_reasoning_restored_phase_integration import RESTORED_METADATA



def test_compile_policy_surface_summaries_emits_restored_phase_operator_views():
    policy = compile_workflow_policy(
        name="Investigate a degraded production service carefully",
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        metadata=RESTORED_METADATA,
    )

    summaries = compile_policy_surface_summaries(policy)

    assert summaries["world_state_summary"]["entity_count"] == 1
    assert summaries["modulation_summary"]["tempo"] == "deliberate"
    assert summaries["workspace_summary"]["selected"] == "planner"
    assert summaries["truth_engine_summary"]["guard_action"] == "block"
    assert summaries["plasticity_summary"]["alert"] is True
    assert summaries["embodiment_summary"]["risk"] == "high"



def test_compile_control_plane_summary_surfaces_precedence_and_active_subsystems():
    policy = compile_workflow_policy(
        name="Investigate a degraded production service carefully",
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        metadata=RESTORED_METADATA,
    )

    summary = compile_control_plane_summary(policy)

    assert "routing_r9" in summary["constraint_precedence"]
    assert "homeostasis" in summary["constraint_precedence"]
    assert "truth_engine" in summary["active_subsystems"]
    assert "embodiment" in summary["active_subsystems"]
    assert summary["constraint_field_owners"]["execution_mode"] == "embodiment"
    assert summary["constraint_field_owners"]["max_parallelism"] in {"truth_engine", "embodiment"}
    assert summary["constraint_decisions"]
    assert summary["operator_summary"]
