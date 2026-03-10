from cortex_server.modules.outcome_tuner import OutcomeTuner


def test_outcome_tuner_promotes_after_shadow_evidence(tmp_path):
    tuner = OutcomeTuner(artifact_dir=tmp_path)
    for i in range(5):
        tuner.observe(
            {
                "query": f"What is 2+2? {i}",
                "task_archetype": "simple_qa",
                "policy_label": "fastlane_memory",
                "execution_success": True,
                "validator_result": {"pass": True},
                "latency_ms": 1500,
            }
        )
    for i in range(8):
        tuner.observe(
            {
                "query": f"What is 2+2 with sources {i}",
                "task_archetype": "simple_qa",
                "policy_label": "fastlane_minimal",
                "execution_success": True,
                "validator_result": {"pass": True},
                "latency_ms": 700,
            }
        )
    hint = tuner.get_policy_hint(archetype="simple_qa", query="What is 2+2?")
    assert hint["stage"] in {"recommend", "bounded_rollout"}
    assert hint["recommended_policy"] == "fastlane_minimal"
