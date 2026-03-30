from __future__ import annotations

import random
import time
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional


MAX_ABS_ACTION = 1.0
HAZARD_INTERVENTION_THRESHOLD = 0.82
GOAL_TOLERANCE = 0.35
WATCHDOG_STEP_LIMIT = 40


@dataclass
class SandboxState:
    step_index: int
    position: float
    velocity: float
    goal: float
    hazard: float
    intervention_active: bool = False
    last_command: float = 0.0


class SimSafetySandbox:
    def __init__(self, *, seed: int = 7, profile: Optional[Dict[str, Any]] = None):
        self.rng = random.Random(seed)
        self.profile = dict(profile or {})
        self.state = SandboxState(step_index=0, position=0.0, velocity=0.0, goal=float(self.profile.get("goal", 5.0)), hazard=0.0)
        self.trace: List[Dict[str, Any]] = []

    def _hazard_value(self) -> float:
        pattern = list(self.profile.get("hazard_pattern") or [])
        if pattern:
            base = float(pattern[min(self.state.step_index, len(pattern) - 1)])
        else:
            base = 0.05 + 0.02 * self.state.step_index
        if self.profile.get("fault_mode") == "hazard_stuck_high":
            return 0.95
        return max(0.0, min(1.0, base + self.rng.uniform(-0.03, 0.03)))

    def observe(self) -> Dict[str, Any]:
        position = self.state.position
        if self.profile.get("partial_observability"):
            position = round(position, 1)
        position += self.rng.uniform(-float(self.profile.get("noise_std", 0.02)), float(self.profile.get("noise_std", 0.02)))
        position += self.rng.uniform(-float(self.profile.get("adversarial_sensor_noise", 0.0)), float(self.profile.get("adversarial_sensor_noise", 0.0)))
        if self.profile.get("fault_mode") == "sensor_dropout" and self.state.step_index % 3 == 2:
            position = None
        return {
            "position": position,
            "velocity": round(self.state.velocity, 4),
            "goal": self.state.goal,
            "hazard": round(self.state.hazard, 4),
            "intervention_active": self.state.intervention_active,
        }

    def step(self, requested_action: float) -> Dict[str, Any]:
        self.state.step_index += 1
        self.state.hazard = self._hazard_value()
        raw_action = float(requested_action)
        bounded_action = max(-MAX_ABS_ACTION, min(MAX_ABS_ACTION, raw_action))
        if self.profile.get("fault_mode") == "actuator_stuck":
            applied_action = self.state.last_command
        elif self.profile.get("fault_mode") == "actuator_command_lag":
            applied_action = 0.5 * self.state.last_command + 0.5 * bounded_action
        else:
            applied_action = bounded_action

        if self.state.hazard >= HAZARD_INTERVENTION_THRESHOLD:
            self.state.intervention_active = True
            applied_action = min(0.0, applied_action)
        else:
            self.state.intervention_active = False

        if int(self.profile.get("step_delay_ms", 0) or 0) > 0:
            time.sleep(min(0.02, int(self.profile.get("step_delay_ms", 0)) / 1000.0))

        self.state.velocity = max(-3.0, min(3.0, 0.6 * self.state.velocity + applied_action))
        self.state.position = max(-10.0, min(10.0, self.state.position + self.state.velocity))
        self.state.last_command = applied_action
        distance = abs(self.state.goal - self.state.position)
        done = distance <= GOAL_TOLERANCE or self.state.step_index >= int(self.profile.get("steps", WATCHDOG_STEP_LIMIT))
        row = {
            "step": self.state.step_index,
            "observation": self.observe(),
            "raw_action": round(raw_action, 4),
            "bounded_action": round(bounded_action, 4),
            "applied_action": round(applied_action, 4),
            "distance_to_goal": round(distance, 4),
            "intervention_active": self.state.intervention_active,
            "done": done,
        }
        self.trace.append(row)
        return row

    def snapshot(self) -> Dict[str, Any]:
        return asdict(self.state)
