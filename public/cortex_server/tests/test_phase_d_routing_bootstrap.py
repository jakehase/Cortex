import json
from pathlib import Path

from services.routing.adaptive_router_policy import choose_route, explain_route_decision, scoring_policy_spec
from services.routing.chain_candidate_generator import generate_candidates
from services.routing.counterfactual_replay_evaluator import evaluate_dataset
from services.routing.full_rollout_autotuner import runtime_health_snapshot, runtime_outcome_hint, runtime_policy_snapshot
from services.routing.route_feature_pipeline import build_route_features


def test_route_features_use_cortex_classifier_for_coding_prompt():
    features = build_route_features("Implement a python API bug fix with unit test coverage", risk_flags=["code_change"])
    assert features["intent"] == "coding"
    assert features["archetype"] == "coding"
    assert features["uses_cortex_classifier"] is True


def test_candidate_generator_reuses_real_arm_library_levels():
    qa_features = build_route_features("Explain TCP in one paragraph", risk_flags=[])
    creative_features = build_route_features("Brainstorm novel ideas", risk_flags=[])
    qa_candidates = {row["chain_id"]: row for row in generate_candidates(qa_features)}
    creative_candidates = {row["chain_id"]: row for row in generate_candidates(creative_features)}
    assert qa_candidates["fastlane_memory"]["levels"] == [5, 34, 7, 22]
    assert creative_candidates["creative_fractal"]["levels"] == [13, 29, 32, 34]
    assert "fastlane_memory" not in creative_candidates


def test_choose_route_prefers_deliberate_for_coding_and_research_for_live_research():
    coding = build_route_features("Implement a python API bug fix with unit test coverage", risk_flags=["code_change"])
    research = build_route_features("Research the latest outage status with sources", risk_flags=["live_state"])
    assert choose_route(coding)["selected"]["chain_id"] == "deliberate_council"
    assert choose_route(research)["selected"]["chain_id"] == "research_grounded"


def test_adaptive_route_inputs_are_explicit_and_principal_noninterfering():
    class Governor:
        def __init__(self, cheap_route):
            self.cheap_route = cheap_route

        def plan(self, *_args, **_kwargs):
            return {
                "archetype": "simple_qa",
                "cheap_route": self.cheap_route,
                "max_latency_ms": 2200,
                "max_context_tokens": 1200,
                "prefetch_enabled": False,
                "prefetch_targets": [],
                "escalate_on": {},
            }

    class Tuner:
        def __init__(self, recommendation):
            self.recommendation = recommendation

        def get_policy_hint(self, **_kwargs):
            return {"stage": "recommend", "recommended_policy": self.recommendation, "decision_confidence": 0.99}

    features_a = build_route_features(
        "Explain TCP in one paragraph",
        latency_governor=Governor("tenant-a-route"),
        runtime_policy={"complexity_hard_threshold": 0.1},
        outcome_tuner=Tuner("deliberate_council"),
        route_health={"dependencies": {"tenant-a": {"healthy": False}}},
    )
    features_b = build_route_features(
        "Explain TCP in one paragraph",
        latency_governor=Governor("tenant-b-route"),
        runtime_policy={"complexity_hard_threshold": 0.9},
        outcome_tuner=Tuner("fastlane_memory"),
        route_health={"dependencies": {"tenant-b": {"healthy": True}}},
    )
    decision_a = choose_route(
        features_a,
        runtime_policy={"complexity_hard_threshold": 0.1},
        policy_hint={"stage": "recommend", "recommended_policy": "deliberate_council"},
    )
    decision_b = choose_route(
        features_b,
        runtime_policy={"complexity_hard_threshold": 0.9},
        policy_hint={"stage": "recommend", "recommended_policy": "fastlane_memory"},
    )

    assert features_a["route_context"]["cheap_route"] == "tenant-a-route"
    assert features_b["route_context"]["cheap_route"] == "tenant-b-route"
    assert features_a["route_context"]["health"]["unhealthy_dependencies"] == ["tenant-a"]
    assert features_b["route_context"]["health"]["unhealthy_dependencies"] == []
    assert decision_a["runtime_policy"] != decision_b["runtime_policy"]
    assert decision_a["policy_hint"] != decision_b["policy_hint"]


def test_counterfactual_replay_evaluator_uses_real_harness_shape(tmp_path: Path):
    rows = [
        {"query": "Explain TCP", "risk_flags": [], "complexity_hard": False, "quality": 0.72, "tokens": 200},
        {"query": "Brainstorm novel product ideas", "risk_flags": [], "complexity_hard": False, "quality": 0.75, "tokens": 260},
    ]
    dataset = tmp_path / "replay.jsonl"
    dataset.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
    result = evaluate_dataset(dataset)
    assert result["success"] is True
    assert "baseline_avg_quality" in result
    assert "adaptive_avg_quality" in result
    assert "quality_delta" in result
    assert isinstance(result.get("decisions"), list)


def test_runtime_snapshots_available_without_mutation():
    policy = runtime_policy_snapshot()
    health = runtime_health_snapshot()
    hint = runtime_outcome_hint(archetype="coding", query="Implement a fix")
    assert isinstance(policy, dict)
    assert isinstance(health, dict)
    assert isinstance(hint, dict)


def test_step4_scoring_policy_spec_and_explanation_are_explicit():
    features = build_route_features("Research the latest outage status with sources", risk_flags=["live_state"])
    spec = scoring_policy_spec()
    explanation = explain_route_decision(features)
    assert spec["version"] == "r9.scoring_policy.v1"
    assert set(spec["weights"].keys()) == {"quality", "latency", "cost", "risk"}
    assert explanation["selected_chain"] == "research_grounded"
    assert explanation["utility_gap_to_second"] >= 0
    top = explanation["candidates"][0]
    assert "quality_components" in top
    assert "utility_terms" in top
    assert set(top["utility_terms"].keys()) == {"weighted_quality", "weighted_latency", "weighted_cost", "weighted_risk"}
