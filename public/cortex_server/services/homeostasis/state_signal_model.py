from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


DEFAULT_R7_ROOT = Path("artifacts/cortex_roadmap/r7_value_homeostasis")
DEFAULT_R9_ROOT = Path("artifacts/cortex_roadmap/r9_adaptive_routing_brain")
SMOOTHING_ALPHA = 0.6
_CANONICAL_FIELDS = [
    "urgency",
    "risk_pressure",
    "fatigue",
    "timeout_pressure",
    "error_pressure",
    "budget_pressure",
    "escalation_debt",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception:
        return {}


def _clip(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, round(float(value), 4)))


def _smooth(current: float, previous: float | None, *, alpha: float = SMOOTHING_ALPHA) -> float:
    if previous is None:
        return _clip(current)
    return _clip(alpha * float(current) + (1.0 - alpha) * float(previous))


def _previous_smoothed(r7_root: Path) -> Dict[str, float]:
    prev = _read_json(r7_root / "step2" / "state_signal_snapshot_latest.json")
    smoothed = prev.get("smoothed_state_vector") if isinstance(prev.get("smoothed_state_vector"), dict) else {}
    return {key: float(value) for key, value in smoothed.items() if key in _CANONICAL_FIELDS}


def _raw_state_vector(step1: Dict[str, Any], r9_step10: Dict[str, Any]) -> Dict[str, float]:
    telemetry = step1.get("telemetry") if isinstance(step1.get("telemetry"), dict) else {}
    reliability = telemetry.get("reliability") if isinstance(telemetry.get("reliability"), dict) else {}
    latency = telemetry.get("latency") if isinstance(telemetry.get("latency"), dict) else {}
    safety = telemetry.get("safety") if isinstance(telemetry.get("safety"), dict) else {}
    cost = telemetry.get("cost") if isinstance(telemetry.get("cost"), dict) else {}
    quality = telemetry.get("quality") if isinstance(telemetry.get("quality"), dict) else {}
    operator = telemetry.get("operator") if isinstance(telemetry.get("operator"), dict) else {}

    unhealthy = list(reliability.get("runtime_health_unhealthy_dependencies") or [])
    risk_reasons = list(safety.get("risk_reasons") or [])
    rollback_required = 1.0 if reliability.get("rollback_required") else 0.0
    shadow_disagreement = float(latency.get("shadow_disagreement_rate", 0.0) or 0.0)
    recovery_seconds = float(latency.get("rollback_max_recovery_seconds", 0.0) or 0.0)
    autotuned = r9_step10.get("autotuned", {}) if isinstance(r9_step10.get("autotuned"), dict) else {}
    weights = autotuned.get("weights", {}) if isinstance(autotuned.get("weights"), dict) else {}
    runtime_hint = r9_step10.get("runtime_hint", {}) if isinstance(r9_step10.get("runtime_hint"), dict) else {}
    decision_confidence = float(runtime_hint.get("decision_confidence", 0.0) or 0.0)
    candidate_evidence = runtime_hint.get("evidence", {}) if isinstance(runtime_hint.get("evidence"), dict) else {}
    candidate_count = float(candidate_evidence.get("candidate_count", 0.0) or 0.0)

    urgency = _clip(0.08 + 0.18 * len(unhealthy) + 0.22 * rollback_required + 0.35 * shadow_disagreement)
    risk_pressure = _clip(0.1 + 0.18 * len(risk_reasons) + 0.16 * len(unhealthy) + 0.2 * (0.0 if safety.get("rollback_gate_pass") else 1.0))
    fatigue = _clip(0.12 + max(0.0, float(weights.get("risk", 0.18) or 0.18) - 0.18) * 1.5 + 0.08 * len(unhealthy))
    timeout_pressure = _clip(0.1 + (recovery_seconds / 60.0) * 0.7 + 0.2 * shadow_disagreement)
    error_pressure = _clip(0.05 + 0.22 * rollback_required + 0.16 * len(unhealthy) + 0.18 * (0.0 if reliability.get("novelty_gate_pass") else 1.0))
    budget_pressure = _clip(
        0.08
        + float(weights.get("latency", 0.08) or 0.08)
        + float(weights.get("cost", 0.06) or 0.06)
        + float(weights.get("risk", 0.18) or 0.18)
        + max(0.0, 1.0 - float(quality.get("quality_non_regression_proxy", 1.0) or 1.0)) * 0.4
    )
    escalation_debt = _clip(0.08 + 0.14 * len(unhealthy) + 0.1 * (0.0 if operator.get("runbook_success") else 1.0) + min(0.2, candidate_count / 2000.0) + (1.0 - decision_confidence) * 0.08)

    return {
        "urgency": urgency,
        "risk_pressure": risk_pressure,
        "fatigue": fatigue,
        "timeout_pressure": timeout_pressure,
        "error_pressure": error_pressure,
        "budget_pressure": budget_pressure,
        "escalation_debt": escalation_debt,
    }


def _anomaly_tags(raw_state: Dict[str, float], step1: Dict[str, Any], r9_step10: Dict[str, Any]) -> List[str]:
    tags: List[str] = []
    reliability = (step1.get("telemetry") or {}).get("reliability") or {}
    unhealthy = list(reliability.get("runtime_health_unhealthy_dependencies") or [])
    if unhealthy:
        tags.append("dependency_degraded")
        tags.extend(f"dependency:{name}" for name in unhealthy)
    for name, threshold in {
        "urgency": 0.65,
        "risk_pressure": 0.6,
        "fatigue": 0.55,
        "timeout_pressure": 0.55,
        "error_pressure": 0.5,
        "budget_pressure": 0.5,
        "escalation_debt": 0.45,
    }.items():
        if float(raw_state.get(name, 0.0)) >= threshold:
            tags.append(f"high_{name}")
    runtime_health = r9_step10.get("runtime_health", {}) if isinstance(r9_step10.get("runtime_health"), dict) else {}
    if list(runtime_health.get("unhealthy_dependencies") or []):
        tags.append("runtime_health_warning")
    return sorted(set(tags))


def build_state_signal_snapshot(*, r7_root: Path | str = DEFAULT_R7_ROOT, r9_root: Path | str = DEFAULT_R9_ROOT) -> Dict[str, Any]:
    r7_root = Path(r7_root)
    r9_root = Path(r9_root)
    step1 = _read_json(r7_root / "step1" / "baseline_regulation_snapshot_latest.json")
    r9_step10 = _read_json(r9_root / "step10" / "full_rollout_probe_latest.json")
    previous = _previous_smoothed(r7_root)
    raw_state = _raw_state_vector(step1, r9_step10)
    smoothed = {name: _smooth(value, previous.get(name)) for name, value in raw_state.items()}
    snapshot = {
        "generated_at": _now_iso(),
        "phase": "phase_e_r7_step2",
        "source_step1_snapshot": str((r7_root / "step1" / "baseline_regulation_snapshot_latest.json")),
        "source_r9_step10": str((r9_root / "step10" / "full_rollout_probe_latest.json")),
        "state_vector_version": "r7.state_signal.v1",
        "state_vector_fields": list(_CANONICAL_FIELDS),
        "raw_state_vector": raw_state,
        "smoothed_state_vector": smoothed,
        "smoothing": {
            "alpha": SMOOTHING_ALPHA,
            "previous_state_loaded": bool(previous),
        },
        "signal_health": {
            "anomaly_tags": _anomaly_tags(raw_state, step1, r9_step10),
            "completeness_ratio": round(sum(1 for field in _CANONICAL_FIELDS if field in raw_state) / len(_CANONICAL_FIELDS), 4),
        },
    }
    return snapshot


def validate_state_signal_snapshot(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    raw_state = snapshot.get("raw_state_vector") if isinstance(snapshot.get("raw_state_vector"), dict) else {}
    smoothed = snapshot.get("smoothed_state_vector") if isinstance(snapshot.get("smoothed_state_vector"), dict) else {}
    missing_fields = [field for field in _CANONICAL_FIELDS if field not in raw_state or field not in smoothed]
    out_of_range = [field for field in _CANONICAL_FIELDS if field in smoothed and not (0.0 <= float(smoothed[field]) <= 1.0)]
    drift_flags: List[str] = []
    for field in _CANONICAL_FIELDS:
        if field in raw_state and field in smoothed and abs(float(raw_state[field]) - float(smoothed[field])) > 0.35:
            drift_flags.append(f"smoothing_jump:{field}")
    signal_health = snapshot.get("signal_health") if isinstance(snapshot.get("signal_health"), dict) else {}
    completeness_ratio = float(signal_health.get("completeness_ratio", 0.0) or 0.0)
    valid = not missing_fields and not out_of_range and not drift_flags and completeness_ratio >= 1.0
    return {
        "generated_at": _now_iso(),
        "valid": valid,
        "signal_complete": not missing_fields and completeness_ratio >= 1.0,
        "signal_stable": not drift_flags,
        "missing_fields": missing_fields,
        "out_of_range_fields": out_of_range,
        "drift_flags": drift_flags,
        "anomaly_tags": list(signal_health.get("anomaly_tags") or []),
    }
