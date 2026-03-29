import json
from pathlib import Path

from services.routing.adaptive_router_policy import choose_route
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
    features = build_route_features("Brainstorm novel ideas", risk_flags=[])
    candidates = {row["chain_id"]: row for row in generate_candidates(features)}
    assert candidates["fastlane_memory"]["levels"] == [5, 34, 7, 22]
    assert candidates["creative_fractal"]["levels"] == [13, 29, 32, 34]


def test_choose_route_prefers_deliberate_for_coding_and_research_for_live_research():
    coding = build_route_features("Implement a python API bug fix with unit test coverage", risk_flags=["code_change"])
    research = build_route_features("Research the latest outage status with sources", risk_flags=["live_state"])
    assert choose_route(coding)["selected"]["chain_id"] == "deliberate_council"
    assert choose_route(research)["selected"]["chain_id"] == "research_grounded"


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
