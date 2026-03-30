from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from services.embodiment.closed_loop_runner import run_closed_loop_episode
from services.embodiment.integration_hooks import AdaptiveRegulator, ArbitrationEngine, BroadcastPolicy, WorldStateModel


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_orchestrated_episode(
    *,
    profile_name: str = "contract_baseline_v2",
    seed: int = 7,
    policy_gain: float = 0.35,
    world_state: Optional[WorldStateModel] = None,
    arbitration: Optional[ArbitrationEngine] = None,
    broadcaster: Optional[BroadcastPolicy] = None,
    regulator: Optional[AdaptiveRegulator] = None,
) -> Dict[str, Any]:
    episode = run_closed_loop_episode(profile_name=profile_name, seed=seed, policy_gain=policy_gain)
    world_state = world_state or WorldStateModel()
    arbitration = arbitration or ArbitrationEngine()
    broadcaster = broadcaster or BroadcastPolicy()
    regulator = regulator or AdaptiveRegulator()

    world_merge = world_state.merge_embodiment_episode(episode)
    arbitration_decision = arbitration.arbitrate_embodiment_episode(episode)
    signal = broadcaster.select_from_embodiment_episode(episode, arbitration_decision)
    regulation = regulator.regulate_with_embodiment_hooks(episode)

    return {
        "success": True,
        "run_at": _now_iso(),
        "episode": episode,
        "integration": {
            "world_state": world_merge,
            "arbitration": arbitration_decision,
            "signal": signal,
            "regulation": regulation,
        },
        "operator_summary": (
            f"embodiment orchestration: status={episode['summary']['status']}, "
            f"goal_reached={episode['summary']['goal_reached']}, risk={arbitration_decision['risk']}"
        ),
    }
