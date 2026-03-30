from __future__ import annotations

from cortex_server.modules.reasoning_explain import policy_outcome_evaluation
from cortex_server.modules.reasoning_policy import build_workflow_policy


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



def test_r9_routing_policy_selects_deliberate_council_for_coding_work():
    policy = build_workflow_policy(
        name="Implement a python API bug fix with unit test coverage",
        steps=[{"node_id": "step1", "contracts": [{"kind": "unit_test"}]}],
        metadata={"enable_homeostasis_policy": False},
    )

    assert policy["routing_r9"]["enabled"] is True
    assert policy["routing_r9"]["selected_chain"] == "deliberate_council"
    assert policy["settings"]["routing_selected_chain"] == "deliberate_council"
    assert policy["settings"]["routing_r9_enabled"] is True
    assert _decision(policy, "routing")["chosen"] == "deliberate"
    assert _decision(policy, "routing_r9")["chosen"] == "deliberate_council"
    assert "r9_routing_active" in policy["risk_flags"]



def test_r9_routing_policy_selects_research_grounded_for_live_research():
    policy = build_workflow_policy(
        name="Research the latest outage status with sources",
        steps=[{"node_id": "step1"}],
        metadata={
            "enable_homeostasis_policy": False,
            "risk_flags": ["live_state"],
        },
    )

    assert policy["routing_r9"]["selected_chain"] == "research_grounded"
    assert policy["settings"]["routing_selected_chain"] == "research_grounded"
    assert _decision(policy, "routing")["chosen"] == "deliberate"
    assert _decision(policy, "routing_r9")["chosen"] == "research_grounded"



def test_r9_routing_policy_selects_fastlane_memory_for_simple_qa():
    policy = build_workflow_policy(
        name="Explain TCP in one paragraph",
        steps=[{"node_id": "step1"}],
        metadata={"enable_homeostasis_policy": False},
    )

    assert policy["routing_r9"]["selected_chain"] == "fastlane_memory"
    assert policy["settings"]["routing_selected_chain"] == "fastlane_memory"
    assert _decision(policy, "routing")["chosen"] == "fastlane"
    assert _decision(policy, "routing_r9")["chosen"] == "fastlane_memory"



def test_homeostasis_can_override_r9_selected_chain_when_protective():
    policy = build_workflow_policy(
        name="Answer a quick question",
        steps=[{"node_id": "step1"}],
        metadata={
            "homeostasis_intent": "qa",
            "homeostasis_risk_tier": "high",
            "homeostasis_state_snapshot": PROTECTIVE_SNAPSHOT,
        },
    )

    assert policy["routing_r9"]["enabled"] is True
    assert policy["routing_r9"]["selected_chain"] == "fastlane_memory"
    assert policy["settings"]["routing_selected_chain"] == "deliberate_council"
    assert policy["settings"]["routing_override_reason"] == "homeostasis_protective"
    assert _decision(policy, "routing")["chosen"] == "deliberate"
    assert _decision(policy, "routing_r9")["chosen"] == "deliberate_council"



def test_policy_outcome_evaluation_includes_r9_routing_domain():
    policy = build_workflow_policy(
        name="Research the latest outage status with sources",
        steps=[{"node_id": "step1"}],
        metadata={
            "enable_homeostasis_policy": False,
            "risk_flags": ["live_state"],
        },
    )

    evaluation = policy_outcome_evaluation(
        policy=policy,
        process={"status": "running"},
        execution_trace_rows=[],
        step_influences=[],
        belief_summary={"count": 0},
    )
    row = next(item for item in evaluation if item["domain"] == "routing_r9")

    assert row["chosen"] == "research_grounded"
    assert row["outcome"] == "match"
    assert row["observed"]["selected_chain"] == "research_grounded"
    assert row["comparison"]["selected_chain_match"] is True
