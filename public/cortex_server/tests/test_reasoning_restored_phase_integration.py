from __future__ import annotations

from cortex_server.modules.reasoning_explain import policy_outcome_evaluation
from cortex_server.modules.reasoning_policy import build_workflow_policy
from cortex_server.modules.reasoning_runtime_execution import workflow_policy_settings
from cortex_server.modules.reasoning_runtime_explain import assemble_runtime_policy_response, assemble_runtime_process_explain


RESTORED_METADATA = {
    "world_state_events": [
        {
            "entity_id": "service:payments",
            "kind": "service",
            "state": {"status": "degraded"},
            "confidence": 0.42,
            "provenance": [{"source": "monitor", "ts": "2026-03-30T12:00:00Z"}],
        }
    ],
    "modulation_observations": {
        "salience": 0.9,
        "uncertainty": 0.8,
        "urgency": 0.7,
        "novelty": 0.8,
    },
    "modulation_enforce_runtime": True,
    "workspace_candidates": [
        {"name": "planner", "priority": 0.95, "confidence": 0.85},
        {"name": "retriever", "priority": 0.52, "confidence": 0.6},
    ],
    "workspace_topics": [
        {"topic": "incident summary", "salience": 0.92, "confidential": False},
        {"topic": "raw customer data", "salience": 0.95, "confidential": True},
    ],
    "workspace_enforce_runtime": True,
    "truth_claims": [
        {"claim_id": "claim-1", "evidence": ["ev-1"], "contradiction_count": 2},
    ],
    "truth_raw_confidence": 0.61,
    "truth_contradiction_count": 2,
    "truth_evidence_count": 3,
    "truth_engine_enforce_runtime": True,
    "plasticity_metrics": {"retain": 0.9, "transfer": 1.04, "forget": 0.1},
    "plasticity_anchor_violation_count": 1,
    "plasticity_runtime_enforce": True,
    "embodiment_episode": {
        "episode_id": "ep-1",
        "summary": {
            "status": "intervention",
            "goal_reached": False,
            "hazard_events": 2,
            "intervention_triggered": True,
            "steps": 22,
        },
    },
    "embodiment_runtime_enforce": True,
    "enable_homeostasis_policy": False,
    "enable_r9_routing": False,
}


def _decision(policy, domain: str):
    return next(row for row in policy["decisions"] if row["domain"] == domain)



def test_build_workflow_policy_restored_phases_surface_decisions_and_settings():
    policy = build_workflow_policy(
        name="Investigate a degraded production service carefully",
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        metadata=RESTORED_METADATA,
    )

    assert policy["world_state"]["enabled"] is True
    assert policy["world_state"]["entity_count"] == 1
    assert policy["modulation"]["enabled"] is True
    assert policy["modulation"]["profile"]["reasoning_depth"] == 5
    assert policy["workspace"]["selected"] == "planner"
    assert policy["workspace"]["broadcast_count"] == 1
    assert policy["truth_engine"]["guard_action"] == "block"
    assert policy["plasticity"]["alert"] is True
    assert policy["embodiment"]["risk"] == "high"
    assert policy["settings"]["world_state_entity_count"] == 1
    assert policy["settings"]["modulation_reasoning_depth"] == 5
    assert policy["settings"]["workspace_selected_specialist"] == "planner"
    assert policy["settings"]["truth_guard_action"] == "block"
    assert policy["settings"]["plasticity_alert"] is True
    assert policy["settings"]["embodiment_pause_noncritical_work"] is True
    assert policy["settings"]["execution_mode"] == "sequential"
    assert policy["settings"]["verification_mode"] == "strict"
    assert policy["settings"]["max_parallelism"] == 1
    assert _decision(policy, "world_state")["chosen"] == "tracked"
    assert _decision(policy, "modulation")["chosen"] == "deliberate"
    assert _decision(policy, "workspace")["chosen"] == "planner"
    assert _decision(policy, "truth_engine")["chosen"] == "block"
    assert _decision(policy, "plasticity")["chosen"] == "alert"
    assert _decision(policy, "embodiment")["chosen"] == "high"



def test_workflow_policy_settings_apply_restored_phase_runtime_overlays():
    policy = build_workflow_policy(
        name="Investigate a degraded production service carefully",
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        metadata=RESTORED_METADATA,
    )

    settings = workflow_policy_settings({"policy": policy})

    assert settings["verification_mode"] == "strict"
    assert settings["same_tick_drain"] is False
    assert settings["execution_mode"] == "sequential"
    assert settings["max_parallelism"] == 1
    assert settings["step_timeout_seconds"] == 10.0
    assert settings["world_state_runtime_enforced"] is True
    assert settings["modulation_runtime_enforced"] is True
    assert settings["workspace_runtime_enforced"] is True
    assert settings["truth_engine_runtime_enforced"] is True
    assert settings["plasticity_runtime_enforced"] is True
    assert settings["embodiment_runtime_enforced"] is True



def test_runtime_explain_surfaces_restored_phase_summaries():
    policy = build_workflow_policy(
        name="Investigate a degraded production service carefully",
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        metadata=RESTORED_METADATA,
    )
    process = {
        "process_id": "proc_restored",
        "status": "scheduled",
        "workflow": {
            "metadata": {"policy": policy, "task_id": "task_restored"},
            "steps": [{"node_id": "step1", "title": "Investigate incident"}],
        },
        "nodes": {},
        "results_by_node": {},
    }

    explained = assemble_runtime_process_explain(
        process_id="proc_restored",
        process=process,
        beliefs_for_task_fn=lambda task_id, limit=200: [],
        summarize_beliefs_fn=lambda **kwargs: {"count": 0},
        explain_belief_fn=lambda claim_id: None,
        get_belief_fn=lambda claim_id: None,
        select_influential_beliefs_fn=lambda **kwargs: [],
    )
    response = assemble_runtime_policy_response(
        process_id="proc_restored",
        process=process,
        explained=explained,
        explain_belief_fn=lambda claim_id: None,
        get_belief_fn=lambda claim_id: None,
    )

    assert explained["world_state_summary"]["entity_count"] == 1
    assert explained["modulation_summary"]["tempo"] == "deliberate"
    assert explained["workspace_summary"]["selected"] == "planner"
    assert explained["truth_engine_summary"]["guard_action"] == "block"
    assert explained["plasticity_summary"]["alert"] is True
    assert explained["embodiment_summary"]["risk"] == "high"
    assert explained["control_plane_summary"]["constraint_field_owners"]["execution_mode"] == "embodiment"
    assert any(row["subsystem"] == "truth_engine" for row in explained["explain_atoms"])
    assert any(row["subsystem"] == "control_plane" for row in response["explain_atoms"])
    assert response["control_plane_summary"]["constraint_decisions"]
    assert response["truth_engine_summary"]["operator_summary"]
    assert response["plasticity_summary"]["operator_summary"]
    assert response["embodiment_summary"]["operator_summary"]



def test_policy_outcome_evaluation_includes_restored_phase_domains():
    policy = build_workflow_policy(
        name="Investigate a degraded production service carefully",
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        metadata=RESTORED_METADATA,
    )

    evaluation = policy_outcome_evaluation(
        policy=policy,
        process={"status": "running"},
        execution_trace_rows=[],
        step_influences=[],
        belief_summary={"count": 0},
    )
    by_domain = {row["domain"]: row for row in evaluation}

    assert by_domain["world_state"]["outcome"] == "match"
    assert by_domain["modulation"]["outcome"] == "match"
    assert by_domain["workspace"]["outcome"] == "match"
    assert by_domain["truth_engine"]["outcome"] == "match"
    assert by_domain["plasticity"]["outcome"] == "match"
    assert by_domain["embodiment"]["outcome"] == "match"
