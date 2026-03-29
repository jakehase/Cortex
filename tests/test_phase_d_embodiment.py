from services.embodiment.closed_loop_runner import run_closed_loop_episode
from services.embodiment.episode_orchestrator import run_orchestrated_episode
from services.embodiment.integration_hooks import AdaptiveRegulator, ArbitrationEngine, BroadcastPolicy, WorldStateModel


def test_closed_loop_baseline_reaches_goal():
    episode = run_closed_loop_episode(profile_name="contract_baseline_v2", seed=7)
    assert episode["summary"]["goal_reached"] is True
    assert episode["summary"]["bounded_actions"] is True
    assert episode["summary"]["steps"] > 0


def test_orchestrated_episode_calls_hooks_and_returns_integration():
    world = WorldStateModel()
    arbitration = ArbitrationEngine()
    broadcast = BroadcastPolicy()
    regulator = AdaptiveRegulator()
    result = run_orchestrated_episode(
        profile_name="contract_baseline_v2",
        seed=7,
        world_state=world,
        arbitration=arbitration,
        broadcaster=broadcast,
        regulator=regulator,
    )
    assert result["success"] is True
    assert result["integration"]["world_state"]["merged"] is True
    assert result["integration"]["arbitration"]["risk"] in {"low", "medium", "high"}
    assert result["integration"]["signal"]["kind"] == "embodiment_status"
    assert len(world.episodes) == 1
    assert len(arbitration.decisions) == 1
    assert len(broadcast.selected_messages) == 1
    assert len(regulator.updates) == 1


def test_failure_taxonomy_profile_triggers_intervention():
    episode = run_closed_loop_episode(profile_name="failure_taxonomy_challenge_v1", seed=11)
    assert episode["summary"]["goal_reached"] is False
    assert episode["summary"]["intervention_triggered"] is True
    assert episode["summary"]["hazard_events"] >= 1
