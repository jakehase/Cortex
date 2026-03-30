from __future__ import annotations

from cortex_server.modules.explain_compiler import compile_control_plane_summary, compile_epistemic_summary_sections, compile_explain_atoms, compile_observability_sections, compile_policy_patch_history, compile_policy_surface_summaries, compile_runtime_process_sections, compile_step_belief_influences
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



def test_compile_epistemic_summary_sections_surfaces_evidence_risk_and_core():
    belief_explanations = [
        {
            "belief": {"claim_id": "claim-1", "confidence": 0.8, "freshness": 0.7, "subject": "svc", "predicate": "status"},
            "evidence_bundle": {"evidence_count": 2, "source_types": {"monitor": 2}, "weighted_confidence": 0.8, "weighted_freshness": 0.7},
            "contradiction_summary": {"conflict_count": 1, "ambiguity_score": 0.2},
            "contradiction_cluster": {"subject": "svc", "predicate": "status", "ambiguity_score": 0.2},
            "lineage_graph": {"nodes": [{"claim_id": "claim-1"}], "edges": [{"from": "claim-0", "to": "claim-1", "kind": "supersedes"}]},
            "epistemic_risk": {"risk_level": "medium", "risk_score": 0.33},
        }
    ]
    decision_explanations = [
        {
            "domain": "truth_engine",
            "decision_causality": {"rows": [{"claim_id": "claim-1", "causal_score": 0.88}]},
        }
    ]

    sections = compile_epistemic_summary_sections(
        belief_explanations=belief_explanations,
        decision_explanations=decision_explanations,
    )

    assert sections["belief_evidence_summary"]["belief_count"] == 1
    assert sections["contradiction_graph_summary"]["conflict_count"] == 1
    assert sections["decision_causality_summary"]["decision_count"] == 1
    assert sections["epistemic_risk_summary"]["belief_count"] == 1
    assert sections["epistemic_core_summary"]["operator_summary"]



def test_compile_observability_sections_surfaces_incident_postmortem_and_hooks():
    policy = compile_workflow_policy(
        name="Investigate a degraded production service carefully",
        steps=[{"node_id": "step1", "title": "Investigate incident"}],
        metadata=RESTORED_METADATA,
    )
    process = {
        "process_id": "proc_obs",
        "status": "failed",
        "nodes": {
            "step1": {
                "status": "failed",
                "last_error": "timeout:simulated",
                "last_error_code": "timeout",
            }
        },
    }
    execution_trace_rows = [{"step": 1, "success": False, "error": "timeout:simulated"}]
    policy_outcome_evaluation = [{"domain": "truth_engine", "outcome": "mismatch"}]
    drift_summary = {"changed": True, "operator_summary": "drift observed"}
    step_influences = [{"node_id": "step1", "operator_summary": "impact observed"}]
    belief_summary = {"count": 1}

    sections = compile_observability_sections(
        process=process,
        policy=policy,
        execution_trace_rows=execution_trace_rows,
        policy_outcome_evaluation=policy_outcome_evaluation,
        epistemic_drift_summary=drift_summary,
        step_influences=step_influences,
        belief_summary=belief_summary,
    )

    assert sections["incidents"][0]["node_id"] == "step1"
    assert sections["incident_report"]["incident_count"] >= 1
    assert sections["postmortem"]["title"]
    assert sections["rerun_recommendations"] is not None
    assert sections["policy_adaptation_hooks"] is not None
    assert sections["policy_patch_preview"] is not None
    assert sections["self_review"] is not None



def test_compile_policy_patch_history_and_step_belief_influences():
    history = compile_policy_patch_history(
        [
            {
                "event_id": "evt-1",
                "kind": "policy_patch_applied",
                "ts": "2026-03-30T20:00:00Z",
                "payload": {
                    "revision_id": "rev-1",
                    "settings": ["step_timeout_seconds"],
                    "applied_settings": [{"setting": "step_timeout_seconds", "after": 30.0}],
                    "operator_overrides": {"step_timeout_seconds": 30.0},
                },
            }
        ]
    )
    influences = compile_step_belief_influences(
        workflow={"steps": [{"node_id": "step1", "title": "Inspect", "metadata": {"belief_query": "service status"}}]},
        results_by_node={"step1": {"success": False, "error": "timeout", "produced_belief_ids": ["claim-2"]}},
        task_id="task-1",
        explain_belief_fn=lambda claim_id: {"belief": {"claim_id": claim_id}},
        get_belief_fn=lambda claim_id: {"claim_id": claim_id, "summary": f"belief:{claim_id}"},
        select_influential_beliefs_fn=lambda **kwargs: [{"claim_id": "claim-1"}],
    )
    sections = compile_runtime_process_sections(
        process={
            "process_id": "proc-1",
            "task_id": "task-1",
            "workflow": {
                "metadata": {"policy": compile_workflow_policy(name="Investigate a degraded production service carefully", steps=[{"node_id": "step1", "title": "Inspect"}], metadata=RESTORED_METADATA)},
                "steps": [{"node_id": "step1", "title": "Inspect", "metadata": {"belief_query": "service status"}}],
            },
            "results_by_node": {"step1": {"success": False, "error": "timeout", "produced_belief_ids": ["claim-2"]}},
            "nodes": {"step1": {"status": "failed", "last_error": "timeout", "last_error_code": "timeout"}},
            "status": "failed",
        },
        beliefs_for_task_fn=lambda task_id, limit=200: [{"claim_id": "claim-1"}],
        summarize_beliefs_fn=lambda **kwargs: {"count": 1},
        explain_belief_fn=lambda claim_id: {"belief": {"claim_id": claim_id}, "evidence_bundle": {"evidence_count": 1, "source_types": {"monitor": 1}, "weighted_confidence": 0.8, "weighted_freshness": 0.7}, "contradiction_summary": {"conflict_count": 0, "ambiguity_score": 0.0}, "contradiction_cluster": {"subject": "svc", "predicate": "status", "ambiguity_score": 0.0}, "lineage_graph": {"nodes": [{"claim_id": claim_id}], "edges": []}, "epistemic_risk": {"risk_level": "low", "risk_score": 0.1}},
        get_belief_fn=lambda claim_id: {"claim_id": claim_id, "summary": f"belief:{claim_id}"},
        select_influential_beliefs_fn=lambda **kwargs: [{"claim_id": "claim-1"}],
    )

    assert history["count"] == 1
    assert history["entries"][0]["settings"] == ["step_timeout_seconds"]
    assert influences[0]["node_id"] == "step1"
    assert influences[0]["belief_count"] == 1
    assert influences[0]["operator_summary"]
    assert sections["policy_outcome_evaluation"] is not None
    assert sections["step_belief_influences"][0]["node_id"] == "step1"
    assert sections["incident_report"]["incident_count"] >= 1
