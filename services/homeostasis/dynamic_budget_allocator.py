from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from services.homeostasis.conflict_arbitration_v2 import determine_regulation_mode
from services.homeostasis.state_signal_model import build_state_signal_snapshot


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clip(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, round(float(value), 4)))


_BASE_BUDGETS = {
    "qa": {"tokens": 900, "depth": 3, "latency_ms": 1600},
    "coding": {"tokens": 1700, "depth": 4, "latency_ms": 2800},
    "planning": {"tokens": 1500, "depth": 4, "latency_ms": 2600},
    "research": {"tokens": 1800, "depth": 4, "latency_ms": 3000},
    "creative": {"tokens": 1400, "depth": 3, "latency_ms": 2200},
    "reminder": {"tokens": 1020, "depth": 2, "latency_ms": 1500},
}

_MODE_MULTIPLIERS = {
    "normal": {"tokens": 1.0, "depth": 1.0, "latency_ms": 1.0},
    "conserve": {"tokens": 0.82, "depth": 0.85, "latency_ms": 0.88},
    "protective": {"tokens": 1.12, "depth": 1.05, "latency_ms": 1.08},
}

_RISK_BONUS = {
    "low": {"tokens": 0, "depth": 0, "latency_ms": 0},
    "medium": {"tokens": 120, "depth": 0.4, "latency_ms": 180},
    "high": {"tokens": 260, "depth": 0.8, "latency_ms": 380},
    "critical": {"tokens": 420, "depth": 1.0, "latency_ms": 520},
}


def _intent_base(intent: str) -> Dict[str, float]:
    return dict(_BASE_BUDGETS.get(str(intent or "qa"), _BASE_BUDGETS["qa"]))


def _reserve_pools(mode: str, risk_tier: str, state_vector: Dict[str, float]) -> Dict[str, Any]:
    risk_pressure = float(state_vector.get("risk_pressure", 0.0) or 0.0)
    timeout_pressure = float(state_vector.get("timeout_pressure", 0.0) or 0.0)
    escalation_debt = float(state_vector.get("escalation_debt", 0.0) or 0.0)
    incident_scale = 0.08 if mode == "normal" else 0.16 if mode == "conserve" else 0.22
    recovery_scale = 0.06 if mode == "normal" else 0.12 if mode == "conserve" else 0.14
    risk_boost = 0.1 if risk_tier in {"high", "critical"} else 0.0
    incident_ratio = _clip(incident_scale + 0.12 * risk_pressure + risk_boost, 0.06, 0.35)
    recovery_ratio = _clip(recovery_scale + 0.1 * timeout_pressure + 0.08 * escalation_debt, 0.04, 0.28)
    return {
        "incident_ratio": incident_ratio,
        "recovery_ratio": recovery_ratio,
    }


def allocate_dynamic_budget(
    *,
    intent: str,
    risk_tier: str,
    state_snapshot: Dict[str, Any] | None = None,
    observed_load: Dict[str, float] | None = None,
) -> Dict[str, Any]:
    if state_snapshot is None:
        state_snapshot = build_state_signal_snapshot()
    state_vector = state_snapshot.get("smoothed_state_vector") if isinstance(state_snapshot.get("smoothed_state_vector"), dict) else {}
    mode_info = determine_regulation_mode(state_vector)
    mode = str(mode_info.get("mode") or "normal")
    base = _intent_base(intent)
    multipliers = dict(_MODE_MULTIPLIERS.get(mode, _MODE_MULTIPLIERS["normal"]))
    risk_bonus = dict(_RISK_BONUS.get(str(risk_tier or "low"), _RISK_BONUS["low"]))
    reserve = _reserve_pools(mode, risk_tier, state_vector)
    load = dict(observed_load or {})

    token_budget = int(round(base["tokens"] * multipliers["tokens"] + risk_bonus["tokens"] + float(load.get("token_pressure", 0.0) or 0.0) * 220))
    depth_budget = int(round(base["depth"] * multipliers["depth"] + risk_bonus["depth"] + float(load.get("depth_pressure", 0.0) or 0.0) * 1.2))
    latency_budget_ms = int(round(base["latency_ms"] * multipliers["latency_ms"] + risk_bonus["latency_ms"] + float(load.get("latency_pressure", 0.0) or 0.0) * 350))

    incident_tokens = int(round(token_budget * reserve["incident_ratio"]))
    recovery_tokens = int(round(token_budget * reserve["recovery_ratio"]))
    incident_latency_ms = int(round(latency_budget_ms * reserve["incident_ratio"]))
    recovery_latency_ms = int(round(latency_budget_ms * reserve["recovery_ratio"]))
    incident_depth = max(1 if depth_budget >= 2 else 0, int(round(depth_budget * reserve["incident_ratio"])))
    recovery_depth = max(1 if depth_budget >= 2 else 0, int(round(depth_budget * reserve["recovery_ratio"])))

    plan = {
        "generated_at": _now_iso(),
        "intent": intent,
        "risk_tier": risk_tier,
        "mode": mode,
        "mode_reasons": mode_info.get("reasons") or [],
        "budgets": {
            "tokens": token_budget,
            "depth": max(1, depth_budget),
            "latency_ms": latency_budget_ms,
        },
        "reserve_pools": {
            "incident": {"tokens": incident_tokens, "depth": incident_depth, "latency_ms": incident_latency_ms},
            "recovery": {"tokens": recovery_tokens, "depth": recovery_depth, "latency_ms": recovery_latency_ms},
        },
        "observed_load": load,
    }
    return plan


def _synthetic_turns() -> List[Dict[str, Any]]:
    intents = ["qa", "coding", "planning", "research", "creative", "reminder"]
    risk_tiers = ["low", "medium", "high", "critical"]
    turns: List[Dict[str, Any]] = []
    for i in range(100):
        intent = intents[i % len(intents)]
        risk_tier = risk_tiers[(i // 5) % len(risk_tiers)]
        phase = i % 10
        turns.append(
            {
                "turn_id": f"turn_{i:03d}",
                "intent": intent,
                "risk_tier": risk_tier,
                "observed_load": {
                    "token_pressure": 0.15 + (phase / 12.0),
                    "depth_pressure": 0.08 + ((i % 7) / 10.0),
                    "latency_pressure": 0.1 + ((i % 9) / 12.0),
                },
                "demand": {
                    "tokens": int(350 + (i % 6) * 180 + (120 if intent in {"coding", "research", "planning"} else 0) + (160 if risk_tier in {"high", "critical"} else 0)),
                    "depth": int(1 + (i % 4) + (1 if intent in {"coding", "research", "planning"} else 0)),
                    "latency_ms": int(700 + (i % 8) * 180 + (220 if risk_tier in {"high", "critical"} else 0)),
                },
            }
        )
    return turns


def run_budget_allocator_simulation(*, state_snapshot: Dict[str, Any] | None = None) -> Dict[str, Any]:
    if state_snapshot is None:
        state_snapshot = build_state_signal_snapshot()
    turns = _synthetic_turns()
    results = []
    overrun_events = 0
    for turn in turns:
        plan = allocate_dynamic_budget(
            intent=turn["intent"],
            risk_tier=turn["risk_tier"],
            state_snapshot=state_snapshot,
            observed_load=turn["observed_load"],
        )
        demand = turn["demand"]
        effective_tokens = plan["budgets"]["tokens"] + plan["reserve_pools"]["incident"]["tokens"] + plan["reserve_pools"]["recovery"]["tokens"]
        effective_depth = plan["budgets"]["depth"] + plan["reserve_pools"]["incident"]["depth"] + plan["reserve_pools"]["recovery"]["depth"]
        effective_latency = plan["budgets"]["latency_ms"] + plan["reserve_pools"]["incident"]["latency_ms"] + plan["reserve_pools"]["recovery"]["latency_ms"]
        overrun_reasons = []
        if int(demand["tokens"]) > int(effective_tokens):
            overrun_reasons.append("tokens")
        if int(demand["depth"]) > int(effective_depth):
            overrun_reasons.append("depth")
        if int(demand["latency_ms"]) > int(effective_latency):
            overrun_reasons.append("latency_ms")
        if overrun_reasons:
            overrun_events += 1
        results.append(
            {
                "turn_id": turn["turn_id"],
                "intent": turn["intent"],
                "risk_tier": turn["risk_tier"],
                "mode": plan["mode"],
                "overrun": bool(overrun_reasons),
                "overrun_reasons": overrun_reasons,
            }
        )
    overrun_rate = round((overrun_events / max(1, len(turns))) * 100, 4)
    return {
        "generated_at": _now_iso(),
        "turn_count": len(turns),
        "overrun_events": overrun_events,
        "overrun_rate_per_100": overrun_rate,
        "gate_pass": overrun_events <= 2,
        "results": results,
    }
