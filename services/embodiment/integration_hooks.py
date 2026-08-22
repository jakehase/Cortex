from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class WorldStateModel:
    episodes: List[Dict[str, Any]] = field(default_factory=list)

    def merge_embodiment_episode(self, episode: Dict[str, Any]) -> Dict[str, Any]:
        self.episodes.append({
            "episode_id": episode.get("episode_id"),
            "status": episode.get("summary", {}).get("status"),
            "goal_reached": bool(episode.get("summary", {}).get("goal_reached", False)),
            "hazard_events": int(episode.get("summary", {}).get("hazard_events", 0)),
        })
        return {
            "merged": True,
            "episode_count": len(self.episodes),
            "latest_status": self.episodes[-1]["status"],
        }


@dataclass
class ArbitrationEngine:
    decisions: List[Dict[str, Any]] = field(default_factory=list)

    def arbitrate_embodiment_episode(self, episode: Dict[str, Any]) -> Dict[str, Any]:
        summary = episode.get("summary", {}) if isinstance(episode.get("summary"), dict) else {}
        risk = "high" if summary.get("intervention_triggered") else "medium" if summary.get("hazard_events") else "low"
        decision = {
            "risk": risk,
            "priority": "safety" if risk == "high" else "execution",
            "pause_noncritical_work": risk == "high",
        }
        self.decisions.append(decision)
        return decision


@dataclass
class BroadcastPolicy:
    selected_messages: List[Dict[str, Any]] = field(default_factory=list)

    def select_from_embodiment_episode(self, episode: Dict[str, Any], arbitration: Dict[str, Any]) -> Dict[str, Any]:
        summary = episode.get("summary", {}) if isinstance(episode.get("summary"), dict) else {}
        signal = {
            "channel": "operator",
            "kind": "embodiment_status",
            "severity": arbitration.get("risk", "low"),
            "message": (
                "Embodiment safety intervention triggered"
                if summary.get("intervention_triggered")
                else "Embodiment episode completed nominally"
            ),
        }
        self.selected_messages.append(signal)
        return signal


@dataclass
class AdaptiveRegulator:
    updates: List[Dict[str, Any]] = field(default_factory=list)

    def regulate_with_embodiment_hooks(self, episode: Dict[str, Any]) -> Dict[str, Any]:
        summary = episode.get("summary", {}) if isinstance(episode.get("summary"), dict) else {}
        regulation = {
            "mode": "conservative" if summary.get("intervention_triggered") else "nominal",
            "policy_gain_multiplier": 0.8 if summary.get("intervention_triggered") else 1.0,
            "watchdog_override": int(summary.get("steps", 0) or 0) > 20,
        }
        self.updates.append(regulation)
        return regulation
