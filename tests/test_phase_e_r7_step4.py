from services.homeostasis.conflict_arbitration_v2 import arbitrate_conflict, determine_regulation_mode, run_conflict_arbitration_benchmark
from services.homeostasis.value_hierarchy_compiler import compile_value_hierarchy, load_hierarchy_spec


def test_r7_step4_mode_selection_prefers_protective_under_high_risk():
    mode = determine_regulation_mode({
        "urgency": 0.7,
        "risk_pressure": 0.72,
        "fatigue": 0.3,
        "timeout_pressure": 0.2,
        "error_pressure": 0.4,
        "budget_pressure": 0.2,
        "escalation_debt": 0.2,
    })
    assert mode["mode"] == "protective"
    assert "high_risk_pressure" in mode["reasons"]


def test_r7_step4_arbitration_emits_rationale_and_expected_choice():
    compiled = compile_value_hierarchy(load_hierarchy_spec())
    state = {"smoothed_state_vector": {"urgency": 0.25, "risk_pressure": 0.2, "fatigue": 0.2, "timeout_pressure": 0.2, "error_pressure": 0.2, "budget_pressure": 0.25, "escalation_debt": 0.2}}
    case = {
        "case_id": "normal_case",
        "candidates": [
            {"candidate_id": "aligned", "scores": {"safety": 0.91, "truth": 0.88, "user_intent": 0.9, "reliability": 0.8, "efficiency": 0.72}, "traits": {"intent_alignment": 0.95, "truth_margin": 0.8, "safety_margin": 0.75, "reliability_margin": 0.7, "efficiency_margin": 0.72}},
            {"candidate_id": "reliable", "scores": {"safety": 0.91, "truth": 0.88, "user_intent": 0.76, "reliability": 0.91, "efficiency": 0.74}, "traits": {"intent_alignment": 0.72, "truth_margin": 0.8, "safety_margin": 0.75, "reliability_margin": 0.92, "efficiency_margin": 0.75}},
        ],
    }
    result = arbitrate_conflict(case, compiled, state_snapshot=state)
    assert result["selected_candidate_id"] == "aligned"
    assert result["rationale"]
    assert result["mode"] == "normal"


def test_r7_step4_benchmark_gate_passes_on_fixture_suite():
    compiled = compile_value_hierarchy(load_hierarchy_spec())
    cases = [
        {
            "case_id": "protective",
            "state_snapshot": {"smoothed_state_vector": {"urgency": 0.72, "risk_pressure": 0.74, "fatigue": 0.41, "timeout_pressure": 0.33, "error_pressure": 0.66, "budget_pressure": 0.38, "escalation_debt": 0.44}},
            "expected_candidate_id": "safe",
            "candidates": [
                {"candidate_id": "safe", "scores": {"safety": 0.95, "truth": 0.88, "user_intent": 0.74, "reliability": 0.9, "efficiency": 0.56}, "traits": {"safety_margin": 0.9, "truth_margin": 0.7, "intent_alignment": 0.7, "reliability_margin": 0.9, "efficiency_margin": 0.5}},
                {"candidate_id": "fast", "scores": {"safety": 0.87, "truth": 0.86, "user_intent": 0.82, "reliability": 0.78, "efficiency": 0.91}, "traits": {"safety_margin": 0.4, "truth_margin": 0.6, "intent_alignment": 0.9, "reliability_margin": 0.5, "efficiency_margin": 0.9}},
            ],
        },
        {
            "case_id": "conserve",
            "state_snapshot": {"smoothed_state_vector": {"urgency": 0.32, "risk_pressure": 0.28, "fatigue": 0.61, "timeout_pressure": 0.59, "error_pressure": 0.21, "budget_pressure": 0.66, "escalation_debt": 0.57}},
            "expected_candidate_id": "efficient",
            "candidates": [
                {"candidate_id": "efficient", "scores": {"safety": 0.91, "truth": 0.87, "user_intent": 0.82, "reliability": 0.84, "efficiency": 0.88}, "traits": {"safety_margin": 0.7, "truth_margin": 0.7, "intent_alignment": 0.86, "reliability_margin": 0.8, "efficiency_margin": 0.95}},
                {"candidate_id": "depth", "scores": {"safety": 0.91, "truth": 0.87, "user_intent": 0.8, "reliability": 0.82, "efficiency": 0.58}, "traits": {"safety_margin": 0.8, "truth_margin": 0.8, "intent_alignment": 0.85, "reliability_margin": 0.7, "efficiency_margin": 0.4}},
            ],
        },
    ]
    benchmark = run_conflict_arbitration_benchmark(compiled, cases)
    assert benchmark["gate_pass"] is True
    assert benchmark["success_rate"] >= 0.92
