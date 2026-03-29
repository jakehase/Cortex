from pathlib import Path
import json

from services.routing.route_feature_pipeline import build_route_features
from services.routing.route_taxonomy import allowed_chains_for_intent, canonical_route_taxonomy, classify_risk_tier, validate_route


def test_route_taxonomy_has_expected_intents_and_risk_tiers():
    schema = canonical_route_taxonomy()
    assert schema["version"] == "r9.route_taxonomy.v1"
    assert set(schema["risk_tiers"]) == {"low", "medium", "high", "critical"}
    assert {"qa", "coding", "planning", "research", "creative", "reminder"}.issubset(set(schema["intents"].keys()))


def test_risk_tier_classification_and_allowed_chain_restriction():
    assert classify_risk_tier([]) == "low"
    assert classify_risk_tier(["code_change"]) == "medium"
    assert classify_risk_tier(["security_change"]) == "high"
    assert classify_risk_tier(["destructive_action"]) == "critical"
    assert allowed_chains_for_intent("creative", risk_tier="critical") == ["deliberate_council"]


def test_feature_pipeline_includes_taxonomy_and_route_context_fields():
    features = build_route_features("Plan a migration roadmap for the API gateway", risk_flags=[])
    assert features["intent"] == "planning"
    assert features["route_taxonomy_version"] == "r9.route_taxonomy.v1"
    assert features["default_chain"] == "deliberate_council"
    assert "deliberate_council" in features["allowed_chain_ids"]
    route_context = features["route_context"]
    for key in [
        "latency_plan",
        "runtime_policy",
        "outcome_hint",
        "health",
        "prefetch_enabled",
        "cheap_route",
        "budget_pressure_after_ms",
        "timeout_pressure",
        "recent_level_efficacy",
    ]:
        assert key in route_context


def test_selected_research_route_is_taxonomy_valid():
    features = build_route_features("Research the latest outage status with sources", risk_flags=["live_state"])
    result = validate_route(features["intent"], "research_grounded", risk_tier=features["risk_tier"])
    assert result["valid"] is True


from services.routing.counterfactual_replay_evaluator import evaluate_dataset
from services.routing.replay_significance import significance_from_delta


def test_step6_replay_fixture_can_show_positive_significant_lift(tmp_path: Path):
    rows = []
    base_rows = [
        {"query": "Fix this pytest failure in orchestrator runtime analytics", "risk_flags": ["code_change"], "quality": 0.81, "historical_success": 0.71, "live_chain": "deliberate_council"},
        {"query": "Research the latest outage status with sources", "risk_flags": ["live_state"], "quality": 0.8, "historical_success": 0.72, "live_chain": "research_grounded"},
        {"query": "Brainstorm novel product ideas unrelated to memory", "risk_flags": [], "quality": 0.75, "historical_success": 0.58, "live_chain": "creative_fractal"},
        {"query": "Remind me in 20 minutes to check the deploy", "risk_flags": [], "quality": 0.71, "historical_success": 0.66, "live_chain": "safe_reminder"},
    ]
    for i in range(20):
        for row in base_rows:
            rows.append({**row, "query": f"{row['query']} [replay:{i}]"})
    dataset = tmp_path / "fixture_replay.jsonl"
    dataset.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
    result = evaluate_dataset(dataset)
    significance = significance_from_delta(result["quality_delta"], result["rows"])
    assert result["quality_delta"] > 0
    assert significance["significant"] is True


from services.routing.safety_rollback_guard import evaluate_rollback, run_rollback_drill


def test_step7_rollback_guard_trips_for_quality_latency_and_risk():
    quality = evaluate_rollback({"quality_non_regression_rate": 0.95, "p95_latency_delta": 0.01, "risk_policy_violation_count": 0}, recovery_seconds=15)
    latency = evaluate_rollback({"quality_non_regression_rate": 1.0, "p95_latency_delta": 0.09, "risk_policy_violation_count": 0}, recovery_seconds=12)
    risk = evaluate_rollback({"quality_non_regression_rate": 1.0, "p95_latency_delta": 0.01, "risk_policy_violation_count": 1}, recovery_seconds=6)
    healthy = evaluate_rollback({"quality_non_regression_rate": 1.0, "p95_latency_delta": 0.01, "risk_policy_violation_count": 0}, recovery_seconds=0)
    assert quality["rollback_required"] is True and "quality_regression" in quality["reasons"]
    assert latency["rollback_required"] is True and "latency_spike" in latency["reasons"]
    assert risk["rollback_required"] is True and "risk_violation" in risk["reasons"]
    assert healthy["rollback_required"] is False


def test_step7_rollback_drill_gate_passes_under_sla():
    drill = run_rollback_drill([
        {"name": "quality", "metrics": {"quality_non_regression_rate": 0.95, "p95_latency_delta": 0.01, "risk_policy_violation_count": 0}, "expect_rollback": True, "recovery_seconds": 15},
        {"name": "latency", "metrics": {"quality_non_regression_rate": 1.0, "p95_latency_delta": 0.08, "risk_policy_violation_count": 0}, "expect_rollback": True, "recovery_seconds": 10},
        {"name": "control", "metrics": {"quality_non_regression_rate": 1.0, "p95_latency_delta": 0.01, "risk_policy_violation_count": 0}, "expect_rollback": False, "recovery_seconds": 0},
    ])
    assert drill["all_expectations_met"] is True
    assert drill["sla_met"] is True
    assert drill["gate_pass"] is True


from services.routing.chain_candidate_generator import generate_candidates, required_core_levels, validate_candidate_constraints


def test_step5_candidate_generator_enforces_allowed_chains_for_high_risk_case():
    features = build_route_features("Implement a security change in production auth flow", risk_flags=["security_change"])
    candidates = generate_candidates(features)
    chain_ids = [row["chain_id"] for row in candidates]
    assert chain_ids == ["deliberate_council"]
    validation = validate_candidate_constraints(features, candidates)
    assert validation["valid"] is True


def test_step5_candidate_generator_enforces_core_levels_and_default_chain():
    features = build_route_features("Research the latest outage status with sources", risk_flags=["live_state"])
    candidates = generate_candidates(features)
    validation = validate_candidate_constraints(features, candidates)
    assert validation["valid"] is True
    assert features["default_chain"] in [row["chain_id"] for row in candidates]
    for row in candidates:
        required = required_core_levels(row["chain_id"])
        for level in required:
            assert level in row["levels"]


from services.routing.operator_dashboard import build_dashboard_model, render_dashboard_html, run_operator_control_runbook


def test_step11_dashboard_model_and_runbook_are_present():
    model = build_dashboard_model()
    drill = run_operator_control_runbook(model)
    html = render_dashboard_html(model)
    assert "headline" in model
    assert "sections" in model
    assert "controls" in model
    assert drill["success"] is True
    assert "R9 Operator Dashboard" in html
    assert "Freeze policy" in html
    assert "Rollback to baseline" in html


from services.routing.novelty_packager import build_claim_map, build_reproducibility_pack, render_novelty_brief


def test_step12_novelty_packager_has_claim_discipline_and_brief():
    claim_map = build_claim_map()
    repro = build_reproducibility_pack()
    brief = render_novelty_brief(claim_map, repro)
    assert claim_map["summary"]["supported"] >= 4
    assert claim_map["summary"]["not_supported"] >= 1
    assert "scripts/cortex_r9_step12_novelty_packaging.py" in repro["scripts"]
    assert "Novelty Brief" in brief
    assert "Do not overclaim" in brief
