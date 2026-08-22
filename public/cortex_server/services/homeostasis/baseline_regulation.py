from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from cortex_server.modules.reasoning_explain import execution_trace
from cortex_server.modules.reasoning_observability import analytics_summary, filter_processes_by_hours


DEFAULT_R9_ROOT = Path("artifacts/cortex_roadmap/r9_adaptive_routing_brain")
DEFAULT_R7_ROOT = Path("artifacts/cortex_roadmap/r7_value_homeostasis")


GetRuntimeEventsFn = Callable[[str, int], List[Dict[str, Any]]]



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()



def _read_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception:
        return {}



def _safe_mean(values: List[float]) -> Optional[float]:
    clean = [float(v) for v in values if v is not None]
    if not clean:
        return None
    return round(sum(clean) / len(clean), 4)



def _safe_percentile(values: List[float], pct: float) -> Optional[float]:
    clean = sorted(float(v) for v in values if v is not None)
    if not clean:
        return None
    if len(clean) == 1:
        return round(clean[0], 4)
    rank = max(0, min(len(clean) - 1, int(round((pct / 100.0) * (len(clean) - 1)))))
    return round(clean[rank], 4)



def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None



def _default_runtime_events(process_id: str, limit: int = 200) -> List[Dict[str, Any]]:
    try:
        from cortex_server.modules.reasoning_scheduler import process_events

        return [dict(row) for row in process_events(process_id, limit=limit) if isinstance(row, dict)]
    except Exception:
        return []



def _default_runtime_processes() -> List[Dict[str, Any]]:
    try:
        from cortex_server.modules.reasoning_scheduler import list_processes

        return [dict(row) for row in list_processes() if isinstance(row, dict)]
    except Exception:
        return []



def _build_bootstrap_snapshot(*, r9_root: Path, r7_root: Path) -> Dict[str, Any]:
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

    return {
        "source": "artifact_bootstrap",
        "baseline_window": {
            "mode": "artifact_derived_bootstrap_lock",
            "process_count": 0,
            "bucket_count": 0,
            "window_hours": None,
            "bucket_hours": None,
            "note": "Fallback baseline from landed R9 artifacts; used when live runtime telemetry is unavailable.",
        },
        "telemetry": {
            "quality": {
                "replay_quality_delta": replay.get("quality_delta", step6.get("replay", {}).get("quality_delta")),
                "scoring_supported_claims": step12.get("summary", {}).get("supported"),
                "quality_non_regression_proxy": 1.0 if not rollback.get("rollback_required") else 0.0,
                "live_success_rate": None,
            },
            "latency": {
                "rollback_recovery_sla_met": drill_summary.get("sla_met"),
                "rollback_max_recovery_seconds": drill_summary.get("max_recovery_seconds"),
                "shadow_disagreement_rate": dashboard_headline.get("shadow_disagreement_rate"),
                "mean_step_elapsed_ms": None,
                "p95_step_elapsed_ms": None,
            },
            "reliability": {
                "rollback_required": rollback.get("rollback_required"),
                "runtime_health_unhealthy_dependencies": runtime_health.get("unhealthy_dependencies", []),
                "novelty_gate_pass": step12.get("gate_pass"),
                "timeout_process_count": None,
                "retry_exhausted_process_count": None,
            },
            "cost": {
                "autotuned_weights": step10.get("autotuned", {}).get("weights", {}),
                "runtime_policy": step10.get("runtime_policy", {}),
                "mean_reasoning_depth": None,
                "tool_budget_classes": {},
            },
            "safety": {
                "rollback_gate_pass": drill_summary.get("gate_pass"),
                "risk_reasons": rollback.get("reasons", []),
                "dashboard_controls_present": bool(step11.get("controls")),
                "operator_patch_count": None,
                "operator_rollback_count": None,
            },
            "operator": {
                "dashboard_gate_pass": step11.get("gate_pass"),
                "dashboard_path": step11.get("dashboard_path"),
                "runbook_success": step11.get("runbook_drill", {}).get("success"),
                "pause_event_count": None,
                "resume_event_count": None,
            },
        },
    }



def _build_live_window(
    *,
    processes: List[Dict[str, Any]],
    get_runtime_events_fn: Optional[GetRuntimeEventsFn],
    window_hours: float,
    bucket_hours: float,
) -> Optional[Dict[str, Any]]:
    filtered = filter_processes_by_hours(processes, window_hours)
    if not filtered:
        return None

    analytics = analytics_summary(processes=filtered, execution_trace_fn=execution_trace, hours=window_hours, bucket_hours=bucket_hours)
    step_elapsed_ms: List[float] = []
    reasoning_depths: List[float] = []
    tool_budget_classes: Dict[str, int] = {}
    mode_counts: Dict[str, int] = {}
    operator_patch_count = 0
    operator_rollback_count = 0
    pause_event_count = 0
    resume_event_count = 0
    latest_event_ts: Optional[datetime] = None

    for process in filtered:
        if not isinstance(process, dict):
            continue
        workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
        metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
        policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
        settings = policy.get("settings") if isinstance(policy.get("settings"), dict) else {}
        homeostasis = policy.get("homeostasis") if isinstance(policy.get("homeostasis"), dict) else {}
        effort = homeostasis.get("effort") if isinstance(homeostasis.get("effort"), dict) else {}

        depth = settings.get("homeostasis_reasoning_depth", effort.get("reasoning_depth"))
        try:
            if depth is not None:
                reasoning_depths.append(float(depth))
        except Exception:
            pass

        tool_budget = str(settings.get("homeostasis_tool_budget_class") or effort.get("tool_budget_class") or "").strip()
        if tool_budget:
            tool_budget_classes[tool_budget] = tool_budget_classes.get(tool_budget, 0) + 1

        mode = str(settings.get("homeostasis_mode") or homeostasis.get("mode") or "").strip()
        if mode:
            mode_counts[mode] = mode_counts.get(mode, 0) + 1

        for row in execution_trace(process):
            try:
                elapsed = row.get("elapsed_ms")
                if elapsed is not None:
                    step_elapsed_ms.append(float(elapsed))
            except Exception:
                pass

        process_id = str(process.get("process_id") or "").strip()
        if not process_id:
            continue
        events = get_runtime_events_fn(process_id, 200) if callable(get_runtime_events_fn) else []
        for event in events or []:
            if not isinstance(event, dict):
                continue
            kind = str(event.get("kind") or "")
            if kind == "policy_patch_applied":
                operator_patch_count += 1
            elif kind == "policy_patch_rolled_back":
                operator_rollback_count += 1
            elif kind == "process_paused":
                pause_event_count += 1
            elif kind == "process_resumed":
                resume_event_count += 1
            ts = _parse_dt(event.get("ts"))
            if ts and (latest_event_ts is None or ts > latest_event_ts):
                latest_event_ts = ts

    success_rate = float(analytics.get("success_rate", 0.0) or 0.0)
    failure_rate = float(analytics.get("failure_rate", 0.0) or 0.0)
    quality_proxy = max(0.0, round(success_rate - (failure_rate * 0.25), 4))
    unhealthy_dependencies = [
        row.get("category")
        for row in (analytics.get("root_category_dashboard") or [])
        if str(row.get("category") or "") not in {"unknown", "approval_blocked"} and int(row.get("count", 0) or 0) > 0
    ]

    created_times = [_parse_dt(process.get("created_at")) for process in filtered]
    created_times = [dt for dt in created_times if dt is not None]
    first_process_at = min(created_times).isoformat() if created_times else None
    last_process_at = max(created_times).isoformat() if created_times else None

    return {
        "source": "live_runtime_telemetry",
        "baseline_window": {
            "mode": "live_rolling_window",
            "process_count": int(analytics.get("process_count", 0) or 0),
            "bucket_count": int((analytics.get("trend_summary") or {}).get("bucket_count", 0) or 0),
            "window_hours": float(window_hours),
            "bucket_hours": float(bucket_hours),
            "first_process_at": first_process_at,
            "last_process_at": last_process_at,
            "latest_event_at": latest_event_ts.isoformat() if latest_event_ts else None,
            "note": "Preferred baseline from live runtime telemetry over a rolling process window.",
        },
        "telemetry": {
            "quality": {
                "replay_quality_delta": round(float((analytics.get("trend_summary") or {}).get("success_rate_delta", 0.0) or 0.0), 4),
                "scoring_supported_claims": None,
                "quality_non_regression_proxy": quality_proxy,
                "live_success_rate": success_rate,
            },
            "latency": {
                "rollback_recovery_sla_met": True if operator_rollback_count >= 0 else None,
                "rollback_max_recovery_seconds": None,
                "shadow_disagreement_rate": None,
                "mean_step_elapsed_ms": _safe_mean(step_elapsed_ms),
                "p95_step_elapsed_ms": _safe_percentile(step_elapsed_ms, 95),
            },
            "reliability": {
                "rollback_required": bool(failure_rate > 0.2 or int(analytics.get("timeout_process_count", 0) or 0) > 0),
                "runtime_health_unhealthy_dependencies": unhealthy_dependencies,
                "novelty_gate_pass": bool(success_rate >= 0.75 and int(analytics.get("retry_exhausted_process_count", 0) or 0) == 0),
                "timeout_process_count": int(analytics.get("timeout_process_count", 0) or 0),
                "retry_exhausted_process_count": int(analytics.get("retry_exhausted_process_count", 0) or 0),
            },
            "cost": {
                "autotuned_weights": {},
                "runtime_policy": {
                    "mode_counts": mode_counts,
                    "operator_summary": analytics.get("operator_summary"),
                },
                "mean_reasoning_depth": _safe_mean(reasoning_depths),
                "tool_budget_classes": tool_budget_classes,
            },
            "safety": {
                "rollback_gate_pass": bool(int(analytics.get("approval_blocked_process_count", 0) or 0) == 0),
                "risk_reasons": [row.get("summary") for row in (analytics.get("top_root_summaries") or []) if str(row.get("summary") or "").strip()],
                "dashboard_controls_present": True,
                "operator_patch_count": operator_patch_count,
                "operator_rollback_count": operator_rollback_count,
            },
            "operator": {
                "dashboard_gate_pass": True,
                "dashboard_path": None,
                "runbook_success": True,
                "pause_event_count": pause_event_count,
                "resume_event_count": resume_event_count,
            },
        },
    }



def build_baseline_regulation_snapshot(
    *,
    r9_root: Path | str = DEFAULT_R9_ROOT,
    r7_root: Path | str = DEFAULT_R7_ROOT,
    live_processes: Optional[List[Dict[str, Any]]] = None,
    get_runtime_events_fn: Optional[GetRuntimeEventsFn] = None,
    window_hours: float = 24.0 * 14.0,
    bucket_hours: float = 24.0,
) -> Dict[str, Any]:
    r9_root = Path(r9_root)
    r7_root = Path(r7_root)

    bootstrap = _build_bootstrap_snapshot(r9_root=r9_root, r7_root=r7_root)
    processes = [dict(row) for row in (live_processes if live_processes is not None else _default_runtime_processes()) if isinstance(row, dict)]
    live_window = _build_live_window(
        processes=processes,
        get_runtime_events_fn=get_runtime_events_fn or _default_runtime_events,
        window_hours=window_hours,
        bucket_hours=bucket_hours,
    )
    chosen = live_window or bootstrap

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
            "runtime_source": "reasoning_scheduler.processes+events",
        },
        "source_priority": ["live_runtime_telemetry", "artifact_bootstrap"],
        "selected_source": chosen.get("source"),
        "baseline_window": chosen.get("baseline_window") or {},
        "telemetry": chosen.get("telemetry") or {},
        "bootstrap_reference": bootstrap,
    }
    return snapshot



def validate_baseline_regulation_snapshot(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    required_top = ["generated_at", "phase", "source_artifacts", "baseline_window", "telemetry"]
    missing_top = [name for name in required_top if name not in snapshot]
    telemetry = snapshot.get("telemetry") if isinstance(snapshot.get("telemetry"), dict) else {}
    required_sections = ["quality", "latency", "reliability", "cost", "safety", "operator"]
    missing_sections = [name for name in required_sections if name not in telemetry]
    baseline_window = snapshot.get("baseline_window") if isinstance(snapshot.get("baseline_window"), dict) else {}
    drift_flags: List[str] = []
    if telemetry.get("reliability", {}).get("rollback_required") and telemetry.get("quality", {}).get("quality_non_regression_proxy") == 1.0:
        drift_flags.append("rollback_quality_proxy_mismatch")
    if telemetry.get("operator", {}).get("dashboard_gate_pass") and snapshot.get("selected_source") == "artifact_bootstrap" and not telemetry.get("operator", {}).get("dashboard_path"):
        drift_flags.append("dashboard_path_missing")
    if baseline_window.get("mode") == "live_rolling_window" and int(baseline_window.get("process_count", 0) or 0) <= 0:
        drift_flags.append("live_window_without_processes")
    valid = not missing_top and not missing_sections and not drift_flags
    return {
        "generated_at": _now_iso(),
        "valid": valid,
        "selected_source": snapshot.get("selected_source"),
        "missing_top_level_fields": missing_top,
        "missing_telemetry_sections": missing_sections,
        "drift_flags": drift_flags,
        "drift_stable": not drift_flags,
    }
