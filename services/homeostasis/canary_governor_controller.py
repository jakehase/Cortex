from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


DEFAULT_SHADOW_PROBE = Path("artifacts/cortex_roadmap/r7_value_homeostasis/step8/shadow_governor_probe_latest.json")
STAGES = (5, 20, 50)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception:
        return {}


def _bucket(key: str) -> int:
    return int(hashlib.sha1(key.encode("utf-8")).hexdigest()[:8], 16) % 100


def _finite_number(value: Any) -> bool:
    if type(value) not in {int, float}:
        return False
    try:
        return math.isfinite(value)
    except (OverflowError, TypeError, ValueError):
        return False


def _shadow_evidence_errors(shadow: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    case_count = shadow.get("case_count")
    disagreement_rate = shadow.get("disagreement_rate")
    average_estimated_uplift = shadow.get("average_estimated_uplift")
    safety_regression_count = shadow.get("safety_regression_count")

    if type(case_count) is not int or case_count <= 0:
        errors.append("invalid_shadow_case_count")
    if not _finite_number(disagreement_rate) or not 0.0 <= disagreement_rate <= 1.0:
        errors.append("invalid_shadow_disagreement_rate")
    if not _finite_number(average_estimated_uplift):
        errors.append("invalid_shadow_uplift")
    if (
        type(safety_regression_count) is not int
        or safety_regression_count < 0
        or type(case_count) is not int
        or safety_regression_count > case_count
    ):
        errors.append("invalid_shadow_safety_regression_count")
    return errors


def _stage_decision(*, percent: int, shadow: Dict[str, Any], safety_regression_budget: int = 0) -> Dict[str, Any]:
    reasons = _shadow_evidence_errors(shadow)
    if reasons:
        return {
            "rollout_percent": percent,
            "status": "hold",
            "reasons": reasons,
            "rollout_allowed": False,
        }

    disagreement_rate = float(shadow["disagreement_rate"])
    average_estimated_uplift = float(shadow["average_estimated_uplift"])
    safety_regression_count = int(shadow["safety_regression_count"])
    rollout_allowed = True
    if safety_regression_count > safety_regression_budget:
        rollout_allowed = False
        reasons.append("safety_regression_detected")
    if average_estimated_uplift < 0.0:
        rollout_allowed = False
        reasons.append("negative_shadow_uplift")
    if percent >= 20 and disagreement_rate > 0.9:
        rollout_allowed = False
        reasons.append("disagreement_too_high_for_stage")

    status = "promote" if rollout_allowed else "hold"
    return {
        "rollout_percent": percent,
        "status": status,
        "reasons": reasons,
        "rollout_allowed": rollout_allowed,
    }


def _sample_canary_members(percent: int, *, sample_size: int = 10) -> List[Dict[str, Any]]:
    keys = [
        "qa:baseline",
        "research:live_status",
        "coding:incident_fix",
        "creative:brainstorm",
        "planning:migration",
        "reminder:lunch_ping",
        "research:comparison",
        "qa:http_502",
        "coding:test_failure",
        "reminder:calendar_check",
    ][:sample_size]
    rows = []
    for key in keys:
        bucket = _bucket(key)
        rows.append({"key": key, "bucket": bucket, "enabled": bucket < percent})
    return rows


def evaluate_canary_governor(*, shadow_probe_path: Path | str = DEFAULT_SHADOW_PROBE) -> Dict[str, Any]:
    shadow_payload = _read_json(Path(shadow_probe_path))
    shadow = shadow_payload.get("shadow") if isinstance(shadow_payload.get("shadow"), dict) else shadow_payload
    stages = {}
    for percent in STAGES:
        decision = _stage_decision(percent=percent, shadow=shadow)
        stages[f"stage_{percent}"] = {
            **decision,
            "sample_members": _sample_canary_members(percent),
            "enabled_count": sum(1 for row in _sample_canary_members(percent) if row["enabled"]),
        }

    kill_switch = {
        "supported": True,
        "triggered": any(not stage.get("rollout_allowed") for stage in stages.values()),
        "reasons": sorted({reason for stage in stages.values() for reason in stage.get("reasons", [])}),
    }
    rollout_ready = bool(stages.get("stage_20", {}).get("rollout_allowed")) and not kill_switch["triggered"]
    return {
        "generated_at": _now_iso(),
        "shadow_summary": {
            "disagreement_rate": shadow.get("disagreement_rate"),
            "average_estimated_uplift": shadow.get("average_estimated_uplift"),
            "safety_regression_count": shadow.get("safety_regression_count"),
            "case_count": shadow.get("case_count"),
        },
        "stages": stages,
        "kill_switch": kill_switch,
        "rollout_ready": rollout_ready,
    }
