from __future__ import annotations

from cortex_server.modules.reasoning_explain import policy_outcome_evaluation
from cortex_server.modules.reasoning_policy import build_workflow_policy
from cortex_server.modules.reasoning_runtime_explain import assemble_runtime_policy_response, assemble_runtime_process_explain


NORMAL_SNAPSHOT = {
    "smoothed_state_vector": {
        "urgency": 0.12,
        "risk_pressure": 0.14,
        "fatigue": 0.18,
        "timeout_pressure": 0.16,
        "error_pressure": 0.12,
        "budget_pressure": 0.18,
        "escalation_debt": 0.1,
    }
}

CONSERVE_SNAPSHOT = {
    "smoothed_state_vector": {
        "urgency": 0.22,
        "risk_pressure": 0.24,
        "fatigue": 0.71,
        "timeout_pressure": 0.58,
        "error_pressure": 0.2,
        "budget_pressure": 0.64,
        "escalation_debt": 0.34,
    }
}

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


def _decision(policy, domain: str):
    return next(row for row in policy["decisions"] if row["domain"] == domain)



def test_build_workflow_policy_homeostasis_normal_mode_prefers_fastlane_for_low_risk_qa():
    policy = build_workflow_policy(
        name="answer a quick question",
        steps=[{"node_id": "step1"}],
        metadata={
            "homeostasis_intent": "qa",
            "homeostasis_risk_tier": "low",
            "homeostasis_state_snapshot": NORMAL_SNAPSHOT,
        },
    )

    assert policy["homeostasis"]["enabled"] is True
    assert policy["homeostasis"]["mode"] == "normal"
    assert policy["settings"]["homeostasis_mode"] == "normal"
    assert policy["settings"]["homeostasis_prefer_chain"] == "fastlane_memory"
    assert _decision(policy, "routing")["chosen"] == "fastlane"
    assert _decision(policy, "homeostasis")["chosen"] == "normal"



def test_build_workflow_policy_homeostasis_conserve_mode_caps_parallelism():
    policy = build_workflow_policy(
        name="triage repeated lightweight questions",
        steps=[{"node_id": "a"}, {"node_id": "b"}, {"node_id": "c"}],
        metadata={
            "homeostasis_intent": "qa",
            "homeostasis_risk_tier": "low",
            "homeostasis_state_snapshot": CONSERVE_SNAPSHOT,
        },
    )

    assert policy["homeostasis"]["mode"] == "conserve"
    assert policy["settings"]["homeostasis_mode"] == "conserve"
    assert policy["settings"]["max_parallelism"] == 2
    assert "homeostasis_conserve" in policy["risk_flags"]
    assert _decision(policy, "homeostasis")["chosen"] == "conserve"



def test_build_workflow_policy_homeostasis_protective_mode_tightens_runtime_settings():
    policy = build_workflow_policy(
        name="ship a risky code change",
        steps=[{"node_id": "a"}, {"node_id": "b"}],
        metadata={
            "homeostasis_intent": "coding",
            "homeostasis_risk_tier": "high",
            "homeostasis_state_snapshot": PROTECTIVE_SNAPSHOT,
        },
    )

    assert policy["homeostasis"]["mode"] == "protective"
    assert policy["settings"]["execution_mode"] == "sequential"
    assert policy["settings"]["max_parallelism"] == 1
    assert policy["settings"]["verification_mode"] == "strict"
    assert policy["settings"]["homeostasis_human_review_required"] is True
    assert _decision(policy, "routing")["chosen"] == "deliberate"
    assert _decision(policy, "homeostasis")["chosen"] == "protective"



def test_runtime_explain_surfaces_homeostasis_summary_and_matching_outcome():
    policy = build_workflow_policy(
        name="review a risky plan",
        steps=[{"node_id": "step1", "title": "Step 1"}],
        metadata={
            "homeostasis_intent": "planning",
            "homeostasis_risk_tier": "high",
            "homeostasis_state_snapshot": PROTECTIVE_SNAPSHOT,
        },
    )
    process = {
        "process_id": "proc_demo",
        "status": "scheduled",
        "workflow": {
            "metadata": {"policy": policy, "task_id": "task_demo"},
            "steps": [{"node_id": "step1", "title": "Step 1"}],
        },
        "nodes": {},
        "results_by_node": {},
    }

    explained = assemble_runtime_process_explain(
        process_id="proc_demo",
        process=process,
        beliefs_for_task_fn=lambda task_id, limit=200: [],
        summarize_beliefs_fn=lambda **kwargs: {"count": 0},
        explain_belief_fn=lambda claim_id: None,
        get_belief_fn=lambda claim_id: None,
        select_influential_beliefs_fn=lambda **kwargs: [],
    )
    homeostasis_eval = next(row for row in explained["policy_outcome_evaluation"] if row["domain"] == "homeostasis")
    response = assemble_runtime_policy_response(
        process_id="proc_demo",
        process=process,
        explained=explained,
        explain_belief_fn=lambda claim_id: None,
        get_belief_fn=lambda claim_id: None,
    )

    assert explained["homeostasis_summary"]["mode"] == "protective"
    assert explained["homeostasis_summary"]["prefer_chain"] == "deliberate_council"
    assert homeostasis_eval["outcome"] == "match"
    assert homeostasis_eval["comparison"]["mode_match"] is True
    assert response["homeostasis"]["mode"] == "protective"
    assert response["homeostasis_summary"]["operator_summary"]



def test_policy_outcome_evaluation_includes_homeostasis_domain():
    policy = build_workflow_policy(
        name="do research carefully",
        steps=[{"node_id": "step1"}],
        metadata={
            "homeostasis_intent": "research",
            "homeostasis_risk_tier": "high",
            "homeostasis_state_snapshot": PROTECTIVE_SNAPSHOT,
        },
    )

    evaluation = policy_outcome_evaluation(
        policy=policy,
        process={"status": "running"},
        execution_trace_rows=[],
        step_influences=[],
        belief_summary={"count": 0},
    )
    row = next(item for item in evaluation if item["domain"] == "homeostasis")

    assert row["chosen"] == "protective"
    assert row["observed"]["prefer_chain"] == "research_grounded"
    assert row["comparison"]["mode_match"] is True
