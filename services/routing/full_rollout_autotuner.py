from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from services.routing._compat import optional_import


def runtime_policy_snapshot() -> Dict[str, Any]:
    module = optional_import("cortex_server.modules.routing_autotune")
    snapshot = getattr(module, "get_policy_snapshot", None) if module else None
    if callable(snapshot):
        try:
            return dict(snapshot())
        except Exception:
            return {}
    return {}


def runtime_outcome_hint(*, archetype: str, query: str) -> Dict[str, Any]:
    module = optional_import("cortex_server.modules.outcome_tuner")
    tuner_cls = getattr(module, "OutcomeTuner", None) if module else None
    if tuner_cls is None:
        return {}
    try:
        tuner = tuner_cls(artifact_dir=Path("/opt/clawdbot/artifacts/nexus_orchestration"))
        hint = tuner.get_policy_hint(archetype=archetype, query=query)
        return dict(hint) if isinstance(hint, dict) else {}
    except Exception:
        return {}


def runtime_health_snapshot() -> Dict[str, Any]:
    module = optional_import("cortex_server.modules.route_health")
    monitor = getattr(module, "ROUTE_HEALTH", None) if module else None
    snapshot = getattr(monitor, "snapshot", None) if monitor else None
    if callable(snapshot):
        try:
            result = snapshot()
            return dict(result) if isinstance(result, dict) else {}
        except Exception:
            return {}
    return {}


def autotune_weights(current: Dict[str, float], outcomes: List[Dict[str, Any]]) -> Dict[str, Any]:
    current = dict(current)
    if not outcomes:
        return {"weights": current, "updated": False}
    failures = sum(1 for row in outcomes if not bool(row.get("success", False)))
    avg_latency = sum(float(row.get("latency", 0.0) or 0.0) for row in outcomes) / len(outcomes)
    avg_cost = sum(float(row.get("cost", 0.0) or 0.0) for row in outcomes) / len(outcomes)
    if failures:
        current["risk"] = round(min(1.2, current.get("risk", 0.55) + 0.05), 4)
    if avg_latency > 1.5:
        current["latency"] = round(min(0.5, current.get("latency", 0.22) + 0.03), 4)
    if avg_cost > 1.4:
        current["cost"] = round(min(0.5, current.get("cost", 0.18) + 0.02), 4)
    if failures == 0 and avg_latency < 1.2:
        current["quality"] = round(min(1.2, current.get("quality", 1.0) + 0.02), 4)
    return {"weights": current, "updated": True, "failures": failures, "avg_latency": round(avg_latency, 4), "avg_cost": round(avg_cost, 4)}
