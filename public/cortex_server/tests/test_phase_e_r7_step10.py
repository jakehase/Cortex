from services.homeostasis.full_rollout_autotuner import tune_homeostasis_policy, validate_autotune_result


def test_r7_step10_autotuner_emits_bounded_weights_and_kill_switches():
    result = tune_homeostasis_policy()
    validation = validate_autotune_result(result)
    assert validation["valid"] is True
    assert result["intent_kill_switches"]
    for name, value in result["weights"].items():
        assert isinstance(value, float)
        assert value > 0


def test_r7_step10_autotuner_rollout_mode_is_known():
    result = tune_homeostasis_policy()
    assert result["rollout_mode"] in {"full", "hold"}
