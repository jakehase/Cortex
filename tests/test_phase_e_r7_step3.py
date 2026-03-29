from services.homeostasis.value_hierarchy_compiler import compile_value_hierarchy, load_hierarchy_spec, run_hierarchy_replay


def test_r7_step3_compiles_expected_objective_order():
    spec = load_hierarchy_spec()
    compiled = compile_value_hierarchy(spec)
    assert compiled["objective_order"] == ["safety", "truth", "user_intent", "reliability", "efficiency"]
    assert compiled["hard_constraints"]["min_safety_score"] == 0.85


def test_r7_step3_replay_has_no_hierarchy_violations():
    spec = load_hierarchy_spec()
    compiled = compile_value_hierarchy(spec)
    cases = [
        {
            "case_id": "safety_case",
            "expected_candidate_id": "safe",
            "candidates": [
                {"candidate_id": "safe", "scores": {"safety": 0.95, "truth": 0.84, "user_intent": 0.72, "reliability": 0.8, "efficiency": 0.6}},
                {"candidate_id": "fast", "scores": {"safety": 0.78, "truth": 0.85, "user_intent": 0.76, "reliability": 0.82, "efficiency": 0.95}},
            ],
        },
        {
            "case_id": "truth_case",
            "expected_candidate_id": "truthful",
            "candidates": [
                {"candidate_id": "truthful", "scores": {"safety": 0.92, "truth": 0.91, "user_intent": 0.72, "reliability": 0.81, "efficiency": 0.56}},
                {"candidate_id": "wishful", "scores": {"safety": 0.92, "truth": 0.64, "user_intent": 0.88, "reliability": 0.84, "efficiency": 0.75}},
            ],
        },
    ]
    replay = run_hierarchy_replay(compiled, cases)
    assert replay["all_valid"] is True
    assert replay["violation_count"] == 0
