from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


DEFAULT_R9_ROOT = Path("artifacts/cortex_roadmap/r9_adaptive_routing_brain")
DEFAULT_R7_ROOT = Path("artifacts/cortex_roadmap/r7_value_homeostasis")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception:
        return {}


def build_baseline_regulation_snapshot(
    *,
    r9_root: Path | str = DEFAULT_R9_ROOT,
    r7_root: Path | str = DEFAULT_R7_ROOT,
) -> Dict[str, Any]:
    r9_root = Path(r9_root)
    r7_root = Path(r7_root)

    step6 = _read_json(r9_root / "step6" / "replay_probe_latest.json")
    step7 = _read_json(r9_root / "step7" / "rollback_probe_latest.json")
    step10 = _read_json(r9_root / "step10" / "full_rollout_probe_latest.json")
    step11 = _read_json(r9_root / "step11" / "dashboard_probe_latest.json")
    step12 = _read_json(r9_root / "step12" / "novelty_probe_latest.json")

    replay = step10.get("replay", {}) if isinstance(step10.get("replay"), dict) else {}
    rollback = step10.get("rollback", {}) if isinstance(step10.get("rollback"), dict) else {}
    runtime_health = step10.get("runtime_health", {}) if isinstance(step10.get("runtime_health"), dict) else {}
    dashboard_headline = step11.get("headline", {}) if isinstance(step11.get("headline"), dict) else {}
    drill_summary = step7.get("summary", {}) if isinstance(step7.get("summary"), dict) else {}

    snapshot = {
        "generated_at": _now_iso(),
        "phase": "phase_e_r7_step1",
        "artifact_root": str(r7_root),
        "source_artifacts": {
            "r9_step6": str((r9_root / "step6" / "replay_probe_latest.json")),
            "r9_step7": str((r9_root / "step7" / "rollback_probe_latest.json")),
            "r9_step10": str((r9_root / "step10" / "full_rollout_probe_latest.json")),
            "r9_step11": str((r9_root / "step11" / "dashboard_probe_latest.json")),
            "r9_step12": str((r9_root / "step12" / "novelty_probe_latest.json")),
        },
        "baseline_window": {
            "mode": "artifact_derived_bootstrap_lock",
            "note": "This is a local baseline lock from current landed R9 artifacts, not a 14-day live telemetry window.",
        },
        "telemetry": {
            "quality": {
                "replay_quality_delta": replay.get("quality_delta", step6.get("replay", {}).get("quality_delta")),
                "scoring_supported_claims": step12.get("summary", {}).get("supported"),
                "quality_non_regression_proxy": 1.0 if not rollback.get("rollback_required") else 0.0,
            },
            "latency": {
                "rollback_recovery_sla_met": drill_summary.get("sla_met"),
                "rollback_max_recovery_seconds": drill_summary.get("max_recovery_seconds"),
                "shadow_disagreement_rate": dashboard_headline.get("shadow_disagreement_rate"),
            },
            "reliability": {
                "rollback_required": rollback.get("rollback_required"),
                "runtime_health_unhealthy_dependencies": runtime_health.get("unhealthy_dependencies", []),
                "novelty_gate_pass": step12.get("gate_pass"),
            },
            "cost": {
                "autotuned_weights": step10.get("autotuned", {}).get("weights", {}),
                "runtime_policy": step10.get("runtime_policy", {}),
            },
            "safety": {
                "rollback_gate_pass": drill_summary.get("gate_pass"),
                "risk_reasons": rollback.get("reasons", []),
                "dashboard_controls_present": bool(step11.get("controls")),
            },
            "operator": {
                "dashboard_gate_pass": step11.get("gate_pass"),
                "dashboard_path": step11.get("dashboard_path"),
                "runbook_success": step11.get("runbook_drill", {}).get("success"),
            },
        },
    }
    return snapshot


def validate_baseline_regulation_snapshot(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    required_top = ["generated_at", "phase", "source_artifacts", "baseline_window", "telemetry"]
    missing_top = [name for name in required_top if name not in snapshot]
    telemetry = snapshot.get("telemetry") if isinstance(snapshot.get("telemetry"), dict) else {}
    required_sections = ["quality", "latency", "reliability", "cost", "safety", "operator"]
    missing_sections = [name for name in required_sections if name not in telemetry]
    drift_flags: List[str] = []
    if telemetry.get("reliability", {}).get("rollback_required") and telemetry.get("quality", {}).get("quality_non_regression_proxy") == 1.0:
        drift_flags.append("rollback_quality_proxy_mismatch")
    if telemetry.get("operator", {}).get("dashboard_gate_pass") and not telemetry.get("operator", {}).get("dashboard_path"):
        drift_flags.append("dashboard_path_missing")
    valid = not missing_top and not missing_sections and not drift_flags
    return {
        "generated_at": _now_iso(),
        "valid": valid,
        "missing_top_level_fields": missing_top,
        "missing_telemetry_sections": missing_sections,
        "drift_flags": drift_flags,
        "drift_stable": not drift_flags,
    }
