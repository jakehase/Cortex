from services.homeostasis.shadow_governor_runner import run_shadow_governor


PROTECTIVE_BAD = {"smoothed_state_vector": {"urgency": 0.74, "risk_pressure": 0.77, "fatigue": 0.42, "timeout_pressure": 0.35, "error_pressure": 0.69, "budget_pressure": 0.38, "escalation_debt": 0.46}, "signal_health": {"anomaly_tags": ["dependency_degraded", "runtime_health_warning"]}}
NORMAL = {"smoothed_state_vector": {"urgency": 0.24, "risk_pressure": 0.18, "fatigue": 0.28, "timeout_pressure": 0.21, "error_pressure": 0.16, "budget_pressure": 0.26, "escalation_debt": 0.22}, "signal_health": {"anomaly_tags": []}}


def test_r7_step8_shadow_runner_reports_uplift_and_no_safety_regression():
    cases = [
        {"case_id": "critical_code", "intent": "coding", "risk_tier": "critical", "state_snapshot": PROTECTIVE_BAD, "incident_flags": ["external_side_effect"]},
        {"case_id": "normal_qa", "intent": "qa", "risk_tier": "low", "state_snapshot": NORMAL, "incident_flags": []},
    ]
    result = run_shadow_governor(cases)
    assert result["case_count"] == 2
    assert result["safety_regression_count"] == 0
    assert result["average_estimated_uplift"] >= 0.0
    assert result["gate_pass"] is True
