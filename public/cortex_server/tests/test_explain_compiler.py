from __future__ import annotations

from cortex_server.modules.explain_compiler import compile_control_plane_summary, compile_explain_atoms, compile_policy_surface_summaries
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



def test_compile_explain_atoms_surfaces_domain_and_control_plane_atoms():
    policy = compile_workflow_policy(
        name="Investigate a degraded production service carefully",
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        metadata=RESTORED_METADATA,
    )
    evaluations = [
        {
            "domain": "truth_engine",
            "chosen": "block",
            "expected": {"guard_action": "block"},
            "observed": {"guard_action": "block"},
            "comparison": {"guard_action_match": True},
            "outcome": "match",
            "operator_summary": "truth_engine matched",
        },
        {
            "domain": "embodiment",
            "chosen": "high",
            "expected": {"risk": "high"},
            "observed": {"risk": "high"},
            "comparison": {"risk_match": True},
            "outcome": "match",
            "operator_summary": "embodiment matched",
        },
    ]

    atoms = compile_explain_atoms(policy, policy_outcome_evaluation=evaluations)
    by_id = {row["explain_id"]: row for row in atoms}

    assert by_id["explain_atom:truth_engine"]["subsystem"] == "truth_engine"
    assert by_id["explain_atom:truth_engine"]["outcome"] == "match"
    assert by_id["explain_atom:control_plane"]["subsystem"] == "control_plane"
    assert "constraint_decision_count" in by_id["explain_atom:control_plane"]["metadata"]
