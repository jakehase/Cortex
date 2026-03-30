from services.homeostasis.adaptive_effort_controller import choose_effort_profile, run_effort_controller_benchmark


PROTECTIVE = {"smoothed_state_vector": {"urgency": 0.72, "risk_pressure": 0.74, "fatigue": 0.41, "timeout_pressure": 0.33, "error_pressure": 0.66, "budget_pressure": 0.38, "escalation_debt": 0.44}}
CONSERVE = {"smoothed_state_vector": {"urgency": 0.32, "risk_pressure": 0.28, "fatigue": 0.61, "timeout_pressure": 0.59, "error_pressure": 0.21, "budget_pressure": 0.66, "escalation_debt": 0.57}}


def test_r7_step6_effort_profile_emits_mode_depth_and_guardrails():
    profile = choose_effort_profile(
        intent="research",
        risk_tier="high",
        state_snapshot=PROTECTIVE,
        observed_load={"token_pressure": 0.55, "depth_pressure": 0.4, "latency_pressure": 0.45},
    )
    assert profile["mode"] == "protective"
    assert profile["effort"]["reasoning_depth"] >= 5
    assert profile["guardrails"]["prefer_chain"] == "research_grounded"
    assert profile["effort"]["human_review_required"] is True


def test_r7_step6_benchmark_gate_passes():
    cases = [
        {"case_id": "protective_research", "intent": "research", "risk_tier": "high", "state_snapshot": PROTECTIVE, "observed_load": {"token_pressure": 0.55, "depth_pressure": 0.4, "latency_pressure": 0.45}, "expected_mode": "protective", "expected_prefer_chain": "research_grounded", "min_reasoning_depth": 5, "expect_human_review": True, "expect_escalation": True},
        {"case_id": "conserve_qa", "intent": "qa", "risk_tier": "low", "state_snapshot": CONSERVE, "observed_load": {"token_pressure": 0.2, "depth_pressure": 0.15, "latency_pressure": 0.18}, "expected_mode": "conserve", "expected_prefer_chain": "fastlane_memory", "max_reasoning_depth": 2, "expect_human_review": False, "expect_escalation": False},
    ]
    result = run_effort_controller_benchmark(cases)
    assert result["gate_pass"] is True
    assert result["success_rate"] >= 0.92
