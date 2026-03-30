from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict


DEFAULT_R7_ROOT = Path("artifacts/cortex_roadmap/r7_value_homeostasis")
BASE_WEIGHTS = {
    "safety": 1.0,
    "truth": 0.92,
    "user_intent": 0.82,
    "reliability": 0.72,
    "efficiency": 0.48,
}
WEIGHT_BOUNDS = {
    "safety": (0.9, 1.2),
    "truth": (0.8, 1.1),
    "user_intent": (0.7, 1.0),
    "reliability": (0.6, 0.95),
    "efficiency": (0.3, 0.7),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception:
        return {}


def _clip(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, round(float(value), 4)))


def _bounded(weights: Dict[str, float]) -> Dict[str, float]:
    out = {}
    for key, value in weights.items():
        lo, hi = WEIGHT_BOUNDS[key]
        out[key] = _clip(value, lo, hi)
    return out


def tune_homeostasis_policy(*, r7_root: Path | str = DEFAULT_R7_ROOT) -> Dict[str, Any]:
    r7_root = Path(r7_root)
    step5 = _read_json(r7_root / "step5" / "budget_allocator_probe_latest.json")
    step7 = _read_json(r7_root / "step7" / "safety_override_probe_latest.json")
    step8 = _read_json(r7_root / "step8" / "shadow_governor_probe_latest.json")
    step9 = _read_json(r7_root / "step9" / "canary_governor_probe_latest.json")

    shadow = step8.get("shadow") if isinstance(step8.get("shadow"), dict) else {}
    canary = step9.get("canary") if isinstance(step9.get("canary"), dict) else {}
    benchmark7 = step7.get("benchmark") if isinstance(step7.get("benchmark"), dict) else {}
    simulation5 = step5.get("simulation") if isinstance(step5.get("simulation"), dict) else {}

    disagreement_rate = float(shadow.get("disagreement_rate", 1.0) if shadow.get("disagreement_rate") is not None else 1.0)
    avg_uplift = float(shadow.get("average_estimated_uplift", -1.0) if shadow.get("average_estimated_uplift") is not None else -1.0)
    safety_regressions = int(shadow.get("safety_regression_count", 999) if shadow.get("safety_regression_count") is not None else 999)
    overrun_events = int(simulation5.get("overrun_events", 999) if simulation5.get("overrun_events") is not None else 999)
    canary_ready = bool(canary.get("rollout_ready"))
    kill_reasons = list((canary.get("kill_switch") or {}).get("reasons") or [])

    weights = dict(BASE_WEIGHTS)
    notes = []

    if safety_regressions > 0:
        weights["safety"] += 0.12
        weights["reliability"] += 0.06
        weights["efficiency"] -= 0.08
        notes.append("raised safety/reliability due to shadow safety regressions")
    if avg_uplift > 0.02:
        weights["user_intent"] += 0.04
        notes.append("raised user_intent due to positive shadow uplift")
    elif avg_uplift < 0.0:
        weights["user_intent"] -= 0.05
        weights["truth"] += 0.03
        notes.append("reduced user_intent due to negative shadow uplift")
    if disagreement_rate > 0.75:
        weights["reliability"] += 0.05
        weights["efficiency"] -= 0.04
        notes.append("raised reliability due to high shadow disagreement")
    if overrun_events > 0:
        weights["efficiency"] += 0.05
        notes.append("raised efficiency due to budget overruns")
    if not canary_ready:
        weights["safety"] += 0.05
        weights["truth"] += 0.04
        notes.append("tilted toward safety/truth because canary is not rollout-ready")
    if benchmark7 and not bool(benchmark7.get("gate_pass", True)):
        weights["safety"] += 0.08
        notes.append("safety override drills not green; extra safety weight")

    weights = _bounded(weights)

    intent_kill_switches = {
        "coding": safety_regressions > 0 or "safety_regression_detected" in kill_reasons,
        "research": not canary_ready and disagreement_rate > 0.8,
        "creative": avg_uplift < 0.0,
        "reminder": overrun_events > 2,
    }
    rollout_mode = "full" if canary_ready and safety_regressions == 0 else "hold"

    return {
        "generated_at": _now_iso(),
        "weights": weights,
        "weight_bounds": WEIGHT_BOUNDS,
        "intent_kill_switches": intent_kill_switches,
        "rollout_mode": rollout_mode,
        "inputs": {
            "disagreement_rate": disagreement_rate,
            "average_estimated_uplift": avg_uplift,
            "safety_regressions": safety_regressions,
            "overrun_events": overrun_events,
            "canary_ready": canary_ready,
            "kill_reasons": kill_reasons,
        },
        "notes": notes,
    }


def validate_autotune_result(result: Dict[str, Any]) -> Dict[str, Any]:
    weights = result.get("weights") if isinstance(result.get("weights"), dict) else {}
    missing = [name for name in BASE_WEIGHTS if name not in weights]
    out_of_bounds = []
    for name, (lo, hi) in WEIGHT_BOUNDS.items():
        if name in weights and not (lo <= float(weights[name]) <= hi):
            out_of_bounds.append(name)
    kill_switches = result.get("intent_kill_switches") if isinstance(result.get("intent_kill_switches"), dict) else {}
    valid = not missing and not out_of_bounds and bool(kill_switches)
    return {
        "generated_at": _now_iso(),
        "valid": valid,
        "missing_weights": missing,
        "out_of_bounds_weights": out_of_bounds,
        "has_intent_kill_switches": bool(kill_switches),
    }
