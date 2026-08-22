import copy
import multiprocessing
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

import cortex_server.modules.codec_policy as codec_policy


def _write_policy_observations_in_process(state_path: str, count: int) -> None:
    codec_policy._STATE_PATH = Path(state_path)
    for _ in range(count):
        codec_policy.observe_codec_evaluation(
            query="Plan the concurrent policy persistence architecture.",
            winner="referents_plus_codec",
            judge_method="heuristic",
        )


def test_codec_policy_prefers_codec_with_rollout_and_boost(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))
    monkeypatch.setattr(codec_policy, "_rollout_bucket", lambda query: 0)

    for _ in range(6):
        codec_policy.observe_codec_evaluation(
            query="Plan the architecture tradeoff for this change.",
            winner="referents_plus_codec",
            judge_method="oracle_judge",
            judge_confidence=0.9,
        )

    policy = codec_policy.get_codec_policy_for_query("Plan the architecture tradeoff for this change.")

    assert policy["action"] == "prefer_codec"
    assert policy["rollout_percent"] >= 25
    assert policy["should_inject"] is True
    assert policy["boost_factor"] > 1.0
    assert policy["weighted_wins"]["referents_plus_codec"] > 0


def test_codec_policy_can_learn_to_skip_codec(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))
    monkeypatch.setattr(codec_policy, "_rollout_bucket", lambda query: 0)

    for _ in range(6):
        codec_policy.observe_codec_evaluation(
            query="Implement a python api bug fix with unit test.",
            winner="query_only",
            judge_method="heuristic",
            judge_confidence=0.7,
        )

    policy = codec_policy.get_codec_policy_for_query("Implement a python api bug fix with unit test.")

    assert policy["action"] == "skip_codec"
    assert policy["rollout_percent"] >= 25
    assert policy["should_inject"] is False
    assert policy["weighted_wins"]["query_only"] > 0


def test_codec_policy_learns_from_real_outcomes(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))
    monkeypatch.setattr(codec_policy, "_rollout_bucket", lambda query: 0)

    for _ in range(4):
        codec_policy.observe_codec_outcome(
            query="Plan the architecture tradeoff for this change.",
            policy_label="codec",
            execution_success=True,
            user_correction=False,
            recovery_needed=False,
            validator_pass=True,
        )

    policy = codec_policy.get_codec_policy_for_query("Plan the architecture tradeoff for this change.")

    assert policy["action"] == "prefer_codec"
    assert policy["should_inject"] is True
    assert policy["weighted_wins"]["referents_plus_codec"] >= 0


def test_codec_policy_outcome_inference_can_skip_codec(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))
    monkeypatch.setattr(codec_policy, "_rollout_bucket", lambda query: 0)

    for _ in range(4):
        codec_policy.observe_codec_outcome(
            query="Implement a python api bug fix with unit test.",
            policy_label="query_only",
            execution_success=True,
            user_correction=False,
            recovery_needed=False,
            validator_pass=True,
        )

    policy = codec_policy.get_codec_policy_for_query("Implement a python api bug fix with unit test.")

    assert policy["action"] == "skip_codec"
    assert policy["should_inject"] is False


def test_codec_policy_passive_followup_can_record_correction(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    codec_policy.register_codec_session_turn(
        "sess-passive-correction",
        query="Plan the architecture tradeoff for this change.",
        response="You should separate the reveal transform from the scroll transform.",
        variant="referents_plus_codec",
        codec_applied=True,
        referents_applied=True,
        lane="alive_orchestrated",
    )
    result = codec_policy.observe_passive_codec_feedback("sess-passive-correction", "Actually that's wrong, try again.")

    assert result["recorded"] is True
    assert result["variant"] == "referents_plus_codec"
    assert result["passive"] is True
    assert state["last_observation"]["source"] == "passive_followup"
    assert state["last_observation"]["user_correction"] is True



def test_codec_policy_passive_followup_can_record_success(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "passive_feedback_recorded": 0, "passive_feedback_ignored": 0, "stale_turns": 0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    codec_policy.register_codec_session_turn(
        "sess-passive-success",
        query="Plan the architecture tradeoff for this change.",
        response="I split the reveal transform from the scroll transform and the tests passed.",
        variant="referents_plus_codec",
        codec_applied=True,
        referents_applied=True,
        lane="alive_orchestrated",
    )
    result = codec_policy.observe_passive_codec_feedback("sess-passive-success", "That worked — the tests passed and the scroll transform is fixed.")

    assert result["recorded"] is True
    assert result["variant"] == "referents_plus_codec"
    assert result["reward"] > 0.0
    assert result["outcome_confidence"] >= 0.9
    assert result["passive"] is True
    assert state["totals"]["passive_feedback_recorded"] >= 1



def test_codec_policy_passive_followup_ignores_low_confidence_signal(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "passive_feedback_recorded": 0, "passive_feedback_ignored": 0, "stale_turns": 0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    codec_policy.register_codec_session_turn(
        "sess-passive-low",
        query="Plan the architecture tradeoff for this change.",
        response="You should separate the reveal transform from the scroll transform.",
        variant="referents_plus_codec",
        codec_applied=True,
        referents_applied=True,
        lane="alive_orchestrated",
    )
    result = codec_policy.observe_passive_codec_feedback("sess-passive-low", "Thanks")

    assert result["recorded"] is False
    assert result["reason"] == "low_confidence_or_no_signal"
    assert float(result["signal"]["confidence"]) < codec_policy.PASSIVE_SIGNAL_MIN_CONFIDENCE
    assert state["totals"]["passive_feedback_ignored"] >= 1



def test_codec_policy_passive_followup_ignores_stale_turn(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "passive_feedback_recorded": 0, "passive_feedback_ignored": 0, "stale_turns": 0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    codec_policy.register_codec_session_turn(
        "sess-passive-stale",
        query="Plan the architecture tradeoff for this change.",
        response="You should separate the reveal transform from the scroll transform.",
        variant="referents_plus_codec",
        codec_applied=True,
        referents_applied=True,
        lane="alive_orchestrated",
    )
    codec_policy._SESSION_LAST_TURN["sess-passive-stale"]["recorded_at"] = "2000-01-01T00:00:00+00:00"
    result = codec_policy.observe_passive_codec_feedback("sess-passive-stale", "That worked, thanks.")

    assert result["recorded"] is False
    assert result["reason"] == "stale_turn"
    assert state["totals"]["stale_turns"] >= 1



def test_codec_policy_semantic_passive_followup_can_promote_success(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "passive_feedback_recorded": 0, "passive_feedback_ignored": 0, "passive_verifier_used": 0, "passive_verifier_promoted": 0, "stale_turns": 0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    codec_policy.register_codec_session_turn(
        "sess-semantic-success",
        query="How do I fix the bootstrap token pairing failure?",
        response="Rotate the bootstrap token and re-pair the node so the token mismatch clears.",
        variant="referents_plus_codec",
        codec_applied=True,
        referents_applied=True,
        lane="alive_orchestrated",
    )
    result = codec_policy.observe_passive_codec_feedback(
        "sess-semantic-success",
        "That solved the pairing token mismatch and the node is stable now.",
    )

    assert result["recorded"] is True
    assert result["signal"]["semantic_response_similarity"] > 0
    assert "solved" in result["signal"]["verifier_positive_hits"]



def test_codec_policy_uses_verifier_for_ambiguous_passive_signal(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "passive_feedback_recorded": 0, "passive_feedback_ignored": 0, "passive_verifier_used": 0, "passive_verifier_promoted": 0, "stale_turns": 0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    codec_policy.register_codec_session_turn(
        "sess-verifier-ambiguous",
        query="How do I fix the bootstrap token pairing failure?",
        response="Rotate the bootstrap token and re-pair the node so the token mismatch clears.",
        variant="referents_plus_codec",
        codec_applied=True,
        referents_applied=True,
        lane="alive_orchestrated",
    )
    result = codec_policy.observe_passive_codec_feedback(
        "sess-verifier-ambiguous",
        "Bootstrap token mismatch gone on the node.",
        verifier=lambda payload: {"decision": "success", "confidence": 0.81, "reason": "Verifier saw clear resolution."},
    )

    assert result["recorded"] is True
    assert result["signal"]["verifier_model_decision"] == "success"
    assert result["verifier"]["decision"] == "success"
    assert state["totals"]["passive_verifier_used"] >= 1
    assert state["totals"]["passive_verifier_promoted"] >= 1



def test_codec_policy_step_attribution_is_stored_and_surfaced(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "passive_feedback_recorded": 0, "passive_feedback_ignored": 0, "passive_verifier_used": 0, "passive_verifier_promoted": 0, "stale_turns": 0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    artifact = codec_policy.observe_codec_outcome(
        query="Plan the architecture tradeoff for this change.",
        policy_label="referents_plus_codec",
        execution_success=True,
        user_correction=False,
        recovery_needed=False,
        validator_pass=True,
        outcome_confidence=0.9,
        source="execution_flow",
        step_attribution={"step:route_oracle": 1.0, "pattern:validator_pass": 0.8},
    )
    policy = codec_policy.get_codec_policy_for_query("Plan the architecture tradeoff for this change.")

    assert artifact["step_summary"]["helpful"]
    assert any(item["name"] == "step:route_oracle" for item in policy["step_patterns"]["helpful"])



def test_codec_policy_derives_routing_priors_from_step_patterns(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "passive_feedback_recorded": 0, "passive_feedback_ignored": 0, "passive_verifier_used": 0, "passive_verifier_promoted": 0, "stale_turns": 0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))
    for _ in range(4):
        codec_policy.observe_codec_evaluation(
            query="Plan the architecture tradeoff for this change.",
            winner="referents_plus_codec",
            judge_method="oracle_judge",
            judge_confidence=0.9,
        )
    codec_policy.observe_codec_outcome(
        query="Plan the architecture tradeoff for this change.",
        policy_label="referents_plus_codec",
        execution_success=False,
        user_correction=False,
        recovery_needed=True,
        validator_pass=False,
        outcome_confidence=0.8,
        source="oracle_execution_flow",
        step_attribution={"lane:alive_orchestrated": 1.0, "fallback:last_resort": 1.0},
    )
    priors = codec_policy.get_codec_routing_priors("Plan the architecture tradeoff for this change.")

    assert priors["confidence"] >= 0.35
    assert priors["prefer_orchestrated"] is True
    assert priors["avoid_fallback"] is True
    assert priors["prefer_openclaw_primary"] is True
    assert priors["quality_bias"] == "deeper"



def test_codec_policy_derives_backend_policy(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "passive_feedback_recorded": 0, "passive_feedback_ignored": 0, "passive_verifier_used": 0, "passive_verifier_promoted": 0, "stale_turns": 0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))
    for _ in range(4):
        codec_policy.observe_codec_evaluation(
            query="Plan the architecture tradeoff for this change.",
            winner="referents_plus_codec",
            judge_method="oracle_judge",
            judge_confidence=0.9,
        )
    codec_policy.observe_codec_outcome(
        query="Plan the architecture tradeoff for this change.",
        policy_label="referents_plus_codec",
        execution_success=False,
        user_correction=False,
        recovery_needed=True,
        validator_pass=False,
        outcome_confidence=0.8,
        source="oracle_execution_flow",
        step_attribution={"fallback:bridge_fallback_after_openclaw_error": 1.0, "backend:tinyllama": 1.0, "lane:alive_orchestrated": 1.0},
    )
    backend_policy = codec_policy.get_codec_backend_policy(
        "Plan the architecture tradeoff for this change.",
        runtime_state={"fallbacks_enabled": True, "bridge_available": True, "bridge_cb_allows": True, "openclaw_rate_limited": False},
    )

    assert backend_policy["prefer_openclaw_primary"] is True
    assert backend_policy["allow_bridge_fallback"] is False
    assert backend_policy["allow_tinyllama"] is False
    assert backend_policy["backend_order"][0] == "openclaw"



def test_codec_policy_session_telemetry_exposes_turn_context(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "passive_feedback_recorded": 0, "passive_feedback_ignored": 0, "passive_verifier_used": 0, "passive_verifier_promoted": 0, "stale_turns": 0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))

    codec_policy.register_codec_session_turn(
        "sess-telemetry",
        query="Plan the architecture tradeoff for this change.",
        response="I split the reveal transform from the scroll transform and the tests passed.",
        variant="referents_plus_codec",
        codec_applied=True,
        referents_applied=True,
        lane="alive_orchestrated",
    )
    telemetry = codec_policy.get_codec_session_telemetry("sess-telemetry")

    assert telemetry["available"] is True
    assert telemetry["variant"] == "referents_plus_codec"
    assert telemetry["response_excerpt_chars"] > 0
    assert telemetry["query_hash"]
    assert telemetry["response_hash"]


def test_codec_policy_autotune_can_increase_rollout_from_eval_history(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "autotune_updates": 0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))
    monkeypatch.setattr(codec_policy, "_rollout_bucket", lambda query: 0)

    for _ in range(3):
        codec_policy.observe_codec_evaluation(
            query="Plan the architecture tradeoff for this change.",
            winner="referents_plus_codec",
            judge_method="oracle_judge",
            judge_confidence=0.9,
        )
        codec_policy.observe_codec_eval_history(
            query="Plan the architecture tradeoff for this change.",
            acceptance_gates={
                "summary": {"overall_pass": True},
                "judge_margin": 0.08,
                "codec_margin_vs_best_non_codec": 0.12,
            },
            winner="referents_plus_codec",
        )

    policy = codec_policy.get_codec_policy_for_query("Plan the architecture tradeoff for this change.")

    assert policy["autotune"]["action"] == "increase_rollout"
    assert policy["rollout_delta"] > 0
    assert state["totals"]["autotune_updates"] >= 3


def test_codec_policy_autotune_can_reduce_rollout_from_eval_history(monkeypatch):
    state = {
        "version": "cortex.codec.policy.v1",
        "enabled": True,
        "last_updated": "",
        "totals": {"evaluations": 0, "codec_wins": 0, "non_codec_wins": 0, "codec_weighted_wins": 0.0, "non_codec_weighted_wins": 0.0, "autotune_updates": 0},
        "archetypes": {},
        "last_observation": None,
    }
    monkeypatch.setattr(codec_policy, "load_state", lambda: state)
    monkeypatch.setattr(codec_policy, "save_state", lambda new_state: state.update(new_state))
    monkeypatch.setattr(codec_policy, "_rollout_bucket", lambda query: 0)

    for _ in range(3):
        codec_policy.observe_codec_evaluation(
            query="Implement a python api bug fix with unit test.",
            winner="query_only",
            judge_method="heuristic",
            judge_confidence=0.7,
        )
        codec_policy.observe_codec_eval_history(
            query="Implement a python api bug fix with unit test.",
            acceptance_gates={
                "summary": {"overall_pass": False},
                "judge_margin": 0.01,
                "codec_margin_vs_best_non_codec": -0.14,
            },
            winner="query_only",
        )

    policy = codec_policy.get_codec_policy_for_query("Implement a python api bug fix with unit test.")

    assert policy["autotune"]["action"] == "decrease_rollout"
    assert policy["rollout_delta"] < 0


def test_codec_policy_threaded_observations_use_one_read_modify_write_transaction(monkeypatch):
    holder = {"state": codec_policy._default_state()}

    def load_state():
        snapshot = copy.deepcopy(holder["state"])
        time.sleep(0.005)
        return snapshot

    def save_state(state):
        holder["state"] = copy.deepcopy(state)

    monkeypatch.setattr(codec_policy, "load_state", load_state)
    monkeypatch.setattr(codec_policy, "save_state", save_state)

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(
            lambda _: codec_policy.observe_codec_evaluation(
                query="Plan the concurrent policy persistence architecture.",
                winner="referents_plus_codec",
                judge_method="heuristic",
            ),
            range(24),
        ))

    state = holder["state"]
    row = next(iter(state["archetypes"].values()))
    assert state["totals"]["evaluations"] == 24
    assert row["evaluations"] == 24
    assert row["variants"]["referents_plus_codec"]["wins"] == 24


def test_codec_policy_interprocess_writers_preserve_all_observations(monkeypatch, tmp_path):
    state_path = tmp_path / "codec-policy.json"
    monkeypatch.setattr(codec_policy, "_STATE_PATH", state_path)
    codec_policy.save_state(codec_policy._default_state())
    context = multiprocessing.get_context("fork")
    processes = [
        context.Process(target=_write_policy_observations_in_process, args=(str(state_path), 8))
        for _ in range(3)
    ]

    for process in processes:
        process.start()
    for process in processes:
        process.join(timeout=15)

    assert [process.exitcode for process in processes] == [0, 0, 0]
    state = codec_policy.load_state()
    row = next(iter(state["archetypes"].values()))
    assert state["version"] == "cortex.codec.policy.v1"
    assert state["state_revision"] == 25
    assert state["totals"]["evaluations"] == 24
    assert row["evaluations"] == 24


def test_codec_policy_atomic_replace_preserves_previous_version_on_failure(monkeypatch, tmp_path):
    state_path = tmp_path / "codec-policy.json"
    monkeypatch.setattr(codec_policy, "_STATE_PATH", state_path)
    codec_policy.save_state(codec_policy._default_state())
    previous_bytes = state_path.read_bytes()
    state = codec_policy.load_state()
    state["totals"]["evaluations"] = 99

    def interrupted_replace(*args, **kwargs):
        raise OSError("simulated interrupted replace")

    monkeypatch.setattr(codec_policy.os, "replace", interrupted_replace)
    with pytest.raises(OSError, match="simulated interrupted replace"):
        codec_policy.save_state(state)

    assert state_path.read_bytes() == previous_bytes
    assert codec_policy.load_state()["state_revision"] == 1
    assert not list(tmp_path.glob(".codec-policy.json.*.tmp"))


def test_codec_policy_read_falls_back_when_lock_directory_is_unavailable(monkeypatch):
    monkeypatch.setattr(codec_policy, "_STATE_PATH", Path("/proc/cortex-codec-policy.json"))

    state = codec_policy.load_state()

    assert state["version"] == "cortex.codec.policy.v1"
    assert state["state_revision"] == 0
