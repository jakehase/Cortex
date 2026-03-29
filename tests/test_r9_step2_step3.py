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
