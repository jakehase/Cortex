from pathlib import Path

from cortex_server.modules.outcome_tuner import OutcomeTuner


def _record(query: str, policy: str, latency_ms: int, ok: bool = True):
    return {
        "query": query,
        "task_archetype": "simple_qa",
        "policy_label": policy,
        "routing_method": policy,
        "execution_success": ok,
        "validator_result": {"pass": ok},
        "latency_ms": latency_ms,
        "user_correction": False,
        "recovery_needed": False,
    }


def test_outcome_tuner_reaches_active_rollout(tmp_path: Path):
    tuner = OutcomeTuner(artifact_dir=tmp_path)

    # Baseline evidence
    for i in range(18):
        tuner.observe(_record(f"baseline-{i}", "fastlane_memory", latency_ms=2600, ok=True))

    # Candidate policy wins on reward + latency while staying safe.
    for i in range(34):
        tuner.observe(_record(f"candidate-{i}", "deliberate_council", latency_ms=700, ok=True))

    hint = tuner.get_policy_hint(archetype="simple_qa", query="latest policy probe")
    assert hint["recommended_policy"] == "deliberate_council"
    assert hint["stage"] in {"bounded_rollout", "active_rollout"}
    assert int(hint["rollout_percent"]) >= 25
    assert float(hint["decision_confidence"]) > 0.2


def test_outcome_tuner_rolls_back_on_regression(tmp_path: Path):
    tuner = OutcomeTuner(artifact_dir=tmp_path)

    # Strong baseline
    for i in range(12):
        tuner.observe(_record(f"baseline-{i}", "fastlane_memory", latency_ms=900, ok=True))

    # Candidate underperforms and fails validator often.
    for i in range(12):
        tuner.observe(_record(f"candidate-bad-{i}", "deliberate_council", latency_ms=2900, ok=False))

    hint = tuner.get_policy_hint(archetype="simple_qa", query="rollback probe")
    assert hint["stage"] == "shadow"
    assert hint["recommended_policy"] is None
