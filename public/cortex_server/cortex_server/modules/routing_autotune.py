from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict


_LOCK = threading.Lock()
_STATE_PATH = Path(os.getenv("NEXUS_AUTOTUNE_STATE_PATH", "/opt/clawdbot/state/nexus_autotune_state.json"))


def _truthy(v: str) -> bool:
    return str(v or "").strip().lower() in {"1", "true", "yes", "on"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(x)))


def _default_state() -> Dict[str, Any]:
    return {
        "version": "nexus.autotune.v2",
        "enabled": _truthy(os.getenv("NEXUS_AUTOTUNE_ENABLED", "true")),
        "last_updated": "",
        "policy": {
            "complexity_hard_threshold": float(os.getenv("NEXUS_COMPLEXITY_HARD_THRESHOLD", "0.42")),
            "l9_auto_activation_threshold": float(os.getenv("NEXUS_L9_AUTO_THRESHOLD", "0.48")),
            "fastlane_escalation_threshold": float(os.getenv("NEXUS_FASTLANE_ESCALATION_THRESHOLD", "0.72")),
            "repair_pass_enabled": _truthy(os.getenv("NEXUS_REPAIR_PASS_ENABLED", "true")),
        },
        "stats": {
            "total": 0,
            "routes": {},
            "l9_used": 0,
            "l9_ema_quality": 0.0,
            "high_complexity_total": 0,
            "high_complexity_without_l9": 0,
            "intent_counts": {
                "architecture": 0,
                "coding": 0,
                "incident": 0,
                "research": 0,
                "training": 0,
                "ethics": 0,
            },
        },
    }


def _safe_float(x: Any, default: float = 0.0) -> float:
    try:
        return float(x)
    except Exception:
        return float(default)


def load_state() -> Dict[str, Any]:
    with _LOCK:
        st = _default_state()
        try:
            if _STATE_PATH.exists():
                raw = json.loads(_STATE_PATH.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    st.update({k: v for k, v in raw.items() if k in st})
                    if isinstance(raw.get("policy"), dict):
                        st["policy"].update(raw["policy"])
                    if isinstance(raw.get("stats"), dict):
                        st["stats"].update(raw["stats"])
        except Exception:
            pass
        return st


def save_state(state: Dict[str, Any]) -> None:
    with _LOCK:
        _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        state["last_updated"] = _now_iso()
        _STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def get_policy_snapshot() -> Dict[str, Any]:
    state = load_state()
    policy = dict(state.get("policy") or {})
    policy["autotune_enabled"] = bool(state.get("enabled", True))
    policy["autotune_version"] = str(state.get("version", "nexus.autotune.v2"))
    return policy


def _route_stats(stats: Dict[str, Any], route_method: str) -> Dict[str, Any]:
    routes = stats.setdefault("routes", {})
    route = routes.setdefault(route_method, {"count": 0, "ema_quality": 0.0})
    if not isinstance(route, dict):
        route = {"count": 0, "ema_quality": 0.0}
        routes[route_method] = route
    return route


def _auto_tune(state: Dict[str, Any]) -> None:
    if not bool(state.get("enabled", True)):
        return

    policy = state.setdefault("policy", {})
    stats = state.setdefault("stats", {})
    total = int(stats.get("total", 0))
    if total < 8:
        return

    routes = stats.get("routes", {}) if isinstance(stats.get("routes"), dict) else {}
    fastlane_q = _safe_float((routes.get("qa_fastlane") or {}).get("ema_quality"), 0.0)
    semantic_q = _safe_float((routes.get("semantic_orchestration") or {}).get("ema_quality"), 0.0)

    c_thr = _safe_float(policy.get("complexity_hard_threshold"), 0.45)
    l9_thr = _safe_float(policy.get("l9_auto_activation_threshold"), 0.55)
    f_thr = _safe_float(policy.get("fastlane_escalation_threshold"), 0.72)

    if 0 < fastlane_q < 0.72:
        f_thr += 0.02
        c_thr -= 0.02

    if fastlane_q >= 0.84 and semantic_q >= 0.8:
        f_thr -= 0.01
        c_thr += 0.01

    intent_counts = stats.get("intent_counts", {}) if isinstance(stats.get("intent_counts"), dict) else {}
    architectureish = int(intent_counts.get("architecture", 0)) + int(intent_counts.get("coding", 0))
    l9_used = int(stats.get("l9_used", 0))
    l9_rate = (l9_used / total) if total > 0 else 0.0
    l9_q = _safe_float(stats.get("l9_ema_quality"), 0.0)
    high_complexity_total = int(stats.get("high_complexity_total", 0))
    high_complexity_without_l9 = int(stats.get("high_complexity_without_l9", 0))
    hc_miss_rate = (high_complexity_without_l9 / high_complexity_total) if high_complexity_total > 0 else 0.0

    if architectureish >= 3 and l9_rate < 0.20:
        l9_thr -= 0.04
    if high_complexity_total >= 5 and hc_miss_rate > 0.35:
        l9_thr -= 0.03
    if 0 < l9_q < 0.45:
        l9_thr += 0.01
    elif l9_q >= 0.84 and l9_rate < 0.40:
        l9_thr -= 0.02

    policy["complexity_hard_threshold"] = round(_clamp(c_thr, 0.30, 0.70), 2)
    policy["l9_auto_activation_threshold"] = round(_clamp(l9_thr, 0.30, 0.80), 2)
    policy["fastlane_escalation_threshold"] = round(_clamp(f_thr, 0.65, 0.90), 2)


def observe_outcome(
    route_method: str,
    quality_score: float,
    *,
    l9_used: bool,
    complexity_score: float,
    intent_flags: Dict[str, bool] | None = None,
) -> Dict[str, Any]:
    state = load_state()
    stats = state.setdefault("stats", {})

    total = int(stats.get("total", 0)) + 1
    stats["total"] = total

    route = _route_stats(stats, str(route_method or "unknown"))
    prev_q = _safe_float(route.get("ema_quality"), 0.0)
    q = _clamp(quality_score, 0.0, 1.0)
    route["count"] = int(route.get("count", 0)) + 1
    route["ema_quality"] = round((0.8 * prev_q) + (0.2 * q), 4)

    if l9_used:
        stats["l9_used"] = int(stats.get("l9_used", 0)) + 1
        prev_l9 = _safe_float(stats.get("l9_ema_quality"), 0.0)
        stats["l9_ema_quality"] = round((0.8 * prev_l9) + (0.2 * q), 4)

    if float(complexity_score) >= float(get_policy_snapshot().get("complexity_hard_threshold", 0.42)):
        stats["high_complexity_total"] = int(stats.get("high_complexity_total", 0)) + 1
        if not l9_used:
            stats["high_complexity_without_l9"] = int(stats.get("high_complexity_without_l9", 0)) + 1

    ic = stats.setdefault("intent_counts", {"architecture": 0, "coding": 0, "incident": 0, "research": 0, "training": 0, "ethics": 0})
    flags = intent_flags or {}
    for key in ["architecture", "coding", "incident", "research", "training", "ethics"]:
        if bool(flags.get(key)):
            ic[key] = int(ic.get(key, 0)) + 1

    tune_every = int(os.getenv("NEXUS_AUTOTUNE_TUNE_EVERY", "20"))
    if total % max(5, tune_every) == 0:
        _auto_tune(state)

    save_state(state)
    return get_policy_snapshot()
