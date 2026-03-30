from services.homeostasis.safety_envelope_overrides import evaluate_safety_envelope, run_safety_override_drills


PROTECTIVE_BAD = {"smoothed_state_vector": {"urgency": 0.74, "risk_pressure": 0.77, "fatigue": 0.42, "timeout_pressure": 0.35, "error_pressure": 0.69, "budget_pressure": 0.38, "escalation_debt": 0.46}, "signal_health": {"anomaly_tags": ["dependency_degraded", "runtime_health_warning"]}}
PROTECTIVE_SOFT = {"smoothed_state_vector": {"urgency": 0.63, "risk_pressure": 0.62, "fatigue": 0.38, "timeout_pressure": 0.61, "error_pressure": 0.41, "budget_pressure": 0.35, "escalation_debt": 0.49}, "signal_health": {"anomaly_tags": ["dependency_degraded"]}}
NORMAL_CLEAN = {"smoothed_state_vector": {"urgency": 0.24, "risk_pressure": 0.18, "fatigue": 0.28, "timeout_pressure": 0.21, "error_pressure": 0.16, "budget_pressure": 0.26, "escalation_debt": 0.22}, "signal_health": {"anomaly_tags": []}}


def test_r7_step7_freeze_and_fallback_modes_trigger_correctly():
    freeze = evaluate_safety_envelope(intent="coding", risk_tier="critical", state_snapshot=PROTECTIVE_BAD, incident_flags=["external_side_effect"])
    fallback = evaluate_safety_envelope(intent="planning", risk_tier="high", state_snapshot=PROTECTIVE_SOFT)
    normal = evaluate_safety_envelope(intent="qa", risk_tier="low", state_snapshot=NORMAL_CLEAN)
    assert freeze["override"]["mode"] == "emergency_freeze"
    assert freeze["override"]["block_side_effects"] is True
    assert fallback["override"]["mode"] == "baseline_safe_fallback"
    assert normal["override"]["mode"] == "normal"


def test_r7_step7_drill_gate_passes():
    cases = [
        {"case_id": "freeze", "intent": "coding", "risk_tier": "critical", "state_snapshot": PROTECTIVE_BAD, "incident_flags": ["external_side_effect"], "expected_mode": "emergency_freeze", "expect_block_side_effects": True, "expect_manual_ack": True, "max_reasoning_depth": 3},
        {"case_id": "fallback", "intent": "planning", "risk_tier": "high", "state_snapshot": PROTECTIVE_SOFT, "incident_flags": [], "expected_mode": "baseline_safe_fallback", "expect_block_side_effects": True, "expect_manual_ack": True, "max_reasoning_depth": 4},
        {"case_id": "normal", "intent": "qa", "risk_tier": "low", "state_snapshot": NORMAL_CLEAN, "incident_flags": [], "expected_mode": "normal", "expect_block_side_effects": False, "expect_manual_ack": False, "max_reasoning_depth": 3},
    ]
    result = run_safety_override_drills(cases)
    assert result["gate_pass"] is True
    assert result["success_rate"] >= 0.92
