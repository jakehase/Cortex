from __future__ import annotations

from statistics import mean
from typing import Any, Dict, List

from services.embodiment.scenario_profiles import get_profile
from services.embodiment.sim_safety_sandbox import GOAL_TOLERANCE, SimSafetySandbox


def _policy(observation: Dict[str, Any], *, gain: float = 0.35) -> float:
    position = observation.get("position")
    goal = float(observation.get("goal", 0.0) or 0.0)
    if position is None:
        position = 0.0
    error = goal - float(position)
    return error * gain


def run_closed_loop_episode(*, profile_name: str = "contract_baseline_v2", seed: int = 7, policy_gain: float = 0.35) -> Dict[str, Any]:
    profile = get_profile(profile_name)
    profile["seed"] = seed
    sandbox = SimSafetySandbox(seed=seed, profile=profile)
    traces: List[Dict[str, Any]] = []
    while True:
        observation = sandbox.observe()
        action = _policy(observation, gain=policy_gain)
        row = sandbox.step(action)
        traces.append(row)
        if row["done"]:
            break

    distances = [float(row.get("distance_to_goal", 0.0) or 0.0) for row in traces]
    bounded = all(abs(float(row.get("bounded_action", 0.0) or 0.0)) <= 1.0001 for row in traces)
    summary = {
        "status": "completed" if distances and distances[-1] <= GOAL_TOLERANCE else "stopped",
        "goal_reached": bool(distances and distances[-1] <= GOAL_TOLERANCE),
        "steps": len(traces),
        "hazard_events": sum(1 for row in traces if bool(row.get("intervention_active"))),
        "intervention_triggered": any(bool(row.get("intervention_active")) for row in traces),
        "bounded_actions": bounded,
        "avg_distance": round(mean(distances), 4) if distances else None,
        "final_distance": round(distances[-1], 4) if distances else None,
        "profile_name": profile_name,
        "seed": seed,
    }
    return {
        "episode_id": f"episode_{profile_name}_{seed}",
        "profile": profile,
        "summary": summary,
        "trace": traces,
    }
