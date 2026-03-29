from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict


_BASE = {
    "name": "contract_baseline_v2",
    "seed": 7,
    "steps": 18,
    "goal": 5.0,
    "noise_std": 0.02,
    "hazard_pattern": [0.05, 0.1, 0.12, 0.15],
    "fault_mode": None,
    "partial_observability": False,
    "adversarial_sensor_noise": 0.0,
    "step_delay_ms": 0,
}


def contract_baseline_v2() -> Dict[str, Any]:
    return deepcopy(_BASE)


def sim2real_transfer_v1() -> Dict[str, Any]:
    out = contract_baseline_v2()
    out.update(
        {
            "name": "sim2real_transfer_v1",
            "noise_std": 0.08,
            "partial_observability": True,
            "adversarial_sensor_noise": 0.15,
            "hazard_pattern": [0.08, 0.18, 0.28, 0.4, 0.22],
        }
    )
    return out


def failure_taxonomy_challenge_v1() -> Dict[str, Any]:
    out = contract_baseline_v2()
    out.update(
        {
            "name": "failure_taxonomy_challenge_v1",
            "fault_mode": "hazard_stuck_high",
            "hazard_pattern": [0.9, 0.92, 0.95, 0.91],
            "step_delay_ms": 5,
        }
    )
    return out


def get_profile(name: str) -> Dict[str, Any]:
    mapping = {
        "contract_baseline_v2": contract_baseline_v2,
        "sim2real_transfer_v1": sim2real_transfer_v1,
        "failure_taxonomy_challenge_v1": failure_taxonomy_challenge_v1,
    }
    if name not in mapping:
        raise KeyError(f"unknown profile: {name}")
    return mapping[name]()
