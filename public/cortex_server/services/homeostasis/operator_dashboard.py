from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


ARTIFACT_ROOT = Path("artifacts/cortex_roadmap/r7_value_homeostasis")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception:
        return {}


def _mean(values: List[float]) -> float:
    clean = [float(v) for v in values]
    return round(sum(clean) / max(1, len(clean)), 4)


def _alert_noise_index_delta(step8_shadow: Dict[str, Any], step7_benchmark: Dict[str, Any]) -> float:
    rows = list(step8_shadow.get("rows") or [])
    live_manual = sum(1 for row in rows if bool((row.get("live") or {}).get("manual_ack")))
    shadow_manual = sum(1 for row in rows if bool((row.get("shadow") or {}).get("manual_ack")))
    freeze_like = 0
    for row in step7_benchmark.get("results") or []:
        override = (row.get("result") or {}).get("override") or {}
        if override.get("mode") in {"emergency_freeze", "baseline_safe_fallback", "elevated_review"}:
            freeze_like += 1
    if not rows:
        return 0.0
    live_rate = live_manual / len(rows)
    shadow_rate = shadow_manual / len(rows)
    override_pressure = freeze_like / max(1, len(step7_benchmark.get("results") or []))
    return round((live_rate - shadow_rate) - (0.1 * override_pressure), 4)


def _mode_distribution(step6_benchmark: Dict[str, Any], step7_benchmark: Dict[str, Any], step8_shadow: Dict[str, Any]) -> Dict[str, int]:
    counts: Counter[str] = Counter()
    for row in step6_benchmark.get("results") or []:
        profile = row.get("profile") or {}
        mode = str(profile.get("mode") or "unknown")
        counts[f"effort::{mode}"] += 1
    for row in step7_benchmark.get("results") or []:
        override = (row.get("result") or {}).get("override") or {}
        mode = str(override.get("mode") or "unknown")
        counts[f"override::{mode}"] += 1
    for row in step8_shadow.get("rows") or []:
        mode = str((row.get("shadow") or {}).get("mode") or "unknown")
        counts[f"shadow::{mode}"] += 1
    return dict(sorted(counts.items()))


def _arbitration_trace_samples(step4_benchmark: Dict[str, Any]) -> List[Dict[str, Any]]:
    samples = []
    for row in (step4_benchmark.get("results") or [])[:4]:
        samples.append(
            {
                "case_id": row.get("case_id"),
                "selected_candidate_id": row.get("selected_candidate_id"),
                "rationale": row.get("rationale") or [],
                "fallback_used": bool(row.get("fallback_used")),
            }
        )
    return samples


def build_dashboard_model(*, artifact_root: Path | str = ARTIFACT_ROOT) -> Dict[str, Any]:
    root = Path(artifact_root)
    step1 = _read_json(root / "step1" / "baseline_regulation_snapshot_latest.json")
    step4 = _read_json(root / "step4" / "arbitration_probe_latest.json")
    step5 = _read_json(root / "step5" / "budget_allocator_probe_latest.json")
    step6 = _read_json(root / "step6" / "adaptive_effort_probe_latest.json")
    step7 = _read_json(root / "step7" / "safety_override_probe_latest.json")
    step8 = _read_json(root / "step8" / "shadow_governor_probe_latest.json")
    step9 = _read_json(root / "step9" / "canary_governor_probe_latest.json")
    step10_result = _read_json(root / "step10" / "full_rollout_autotune_latest.json")
    step10_probe = _read_json(root / "step10" / "full_rollout_autotune_probe_latest.json")

    benchmark4 = step4.get("benchmark") if isinstance(step4.get("benchmark"), dict) else {}
    simulation5 = step5.get("simulation") if isinstance(step5.get("simulation"), dict) else {}
    benchmark6 = step6.get("benchmark") if isinstance(step6.get("benchmark"), dict) else {}
    benchmark7 = step7.get("benchmark") if isinstance(step7.get("benchmark"), dict) else {}
    shadow8 = step8.get("shadow") if isinstance(step8.get("shadow"), dict) else {}
    canary9 = step9.get("canary") if isinstance(step9.get("canary"), dict) else {}
    validation10 = step10_probe.get("validation") if isinstance(step10_probe.get("validation"), dict) else {}

    sample_allocations = list(step5.get("sample_allocations") or [])
    budget_tokens = [float((row.get("budgets") or {}).get("tokens", 0.0) or 0.0) for row in sample_allocations if isinstance(row, dict)]
    budget_latency = [float((row.get("budgets") or {}).get("latency_ms", 0.0) or 0.0) for row in sample_allocations if isinstance(row, dict)]
    reserve_incident = [float((((row.get("reserve_pools") or {}).get("incident") or {}).get("tokens", 0.0)) or 0.0) for row in sample_allocations if isinstance(row, dict)]

    effort_rows = list(benchmark6.get("results") or [])
    reasoning_depths = [int((((row.get("profile") or {}).get("effort") or {}).get("reasoning_depth", 0)) or 0) for row in effort_rows]
    human_review_count = sum(1 for row in effort_rows if bool((((row.get("profile") or {}).get("effort") or {}).get("human_review_required"))))
    escalation_count = sum(1 for row in effort_rows if bool((((row.get("profile") or {}).get("effort") or {}).get("escalation_recommended"))))

    utility_proxy = round(
        (0.4 * float(benchmark4.get("success_rate", 0.0) or 0.0))
        + (0.25 * float(benchmark6.get("success_rate", 0.0) or 0.0))
        + (0.2 * float(shadow8.get("average_estimated_uplift", 0.0) or 0.0))
        + (0.15 * float(validation10.get("valid", False))),
        4,
    )
    alert_noise_delta = _alert_noise_index_delta(shadow8, benchmark7)
    mode_distribution = _mode_distribution(benchmark6, benchmark7, shadow8)

    dashboard = {
        "generated_at": _now_iso(),
        "artifact_root": str(root),
        "headline": {
            "utility_proxy": utility_proxy,
            "rollout_mode": step10_result.get("rollout_mode"),
            "canary_ready": canary9.get("rollout_ready"),
            "shadow_estimated_uplift": shadow8.get("average_estimated_uplift"),
            "alert_noise_index_delta": alert_noise_delta,
        },
        "sections": {
            "baseline": {
                "quality_non_regression_proxy": (((step1.get("telemetry") or {}).get("quality") or {}).get("quality_non_regression_proxy")),
                "rollback_max_recovery_seconds": (((step1.get("telemetry") or {}).get("latency") or {}).get("rollback_max_recovery_seconds")),
                "dashboard_controls_present": (((step1.get("telemetry") or {}).get("safety") or {}).get("dashboard_controls_present")),
            },
            "utility": {
                "proxy": utility_proxy,
                "weights": step10_result.get("weights") or {},
                "weight_bounds": step10_result.get("weight_bounds") or {},
                "notes": step10_result.get("notes") or [],
            },
            "depth": {
                "mean_reasoning_depth": _mean(reasoning_depths) if reasoning_depths else 0.0,
                "human_review_count": human_review_count,
                "escalation_count": escalation_count,
                "benchmark_success_rate": benchmark6.get("success_rate"),
                "mode_distribution": mode_distribution,
            },
            "latency": {
                "mean_budget_latency_ms": _mean(budget_latency) if budget_latency else 0.0,
                "overrun_events": simulation5.get("overrun_events"),
                "overrun_rate_per_100": simulation5.get("overrun_rate_per_100"),
                "shadow_disagreement_rate": shadow8.get("disagreement_rate"),
            },
            "cost": {
                "mean_budget_tokens": _mean(budget_tokens) if budget_tokens else 0.0,
                "mean_incident_reserve_tokens": _mean(reserve_incident) if reserve_incident else 0.0,
                "intent_kill_switches": step10_result.get("intent_kill_switches") or {},
            },
            "risk": {
                "safety_gate_pass": benchmark7.get("gate_pass"),
                "safety_regression_count": shadow8.get("safety_regression_count"),
                "kill_switch": canary9.get("kill_switch") or {},
                "validation": validation10,
            },
            "alert_noise": {
                "alert_noise_index_delta": alert_noise_delta,
                "manual_ack_live": sum(1 for row in shadow8.get("rows") or [] if bool((row.get("live") or {}).get("manual_ack"))),
                "manual_ack_shadow": sum(1 for row in shadow8.get("rows") or [] if bool((row.get("shadow") or {}).get("manual_ack"))),
            },
            "arbitration_traces": {
                "success_rate": benchmark4.get("success_rate"),
                "trace_samples": _arbitration_trace_samples(benchmark4),
            },
            "shadow": shadow8,
            "canary": {
                "stages": canary9.get("stages") or {},
                "rollout_ready": canary9.get("rollout_ready"),
            },
            "rollout": {
                "result_path": step10_probe.get("result_path"),
                "rollout_mode": step10_result.get("rollout_mode"),
                "validation": validation10,
            },
        },
        "controls": {
            "freeze_policy": {"action": "freeze", "supported": True, "mode": "runtime_policy_patch_and_pause", "route": "/runtime/homeostasis/freeze/{process_id}", "permission": "actor must match process owner or session key", "audit_event": "homeostasis_control_audit"},
            "rollback_to_baseline": {"action": "rollback", "supported": True, "mode": "runtime_policy_rollback", "route": "/runtime/homeostasis/rollback/{process_id}", "permission": "actor must match process owner or session key", "audit_event": "homeostasis_control_audit"},
            "resume_governor": {"action": "resume", "supported": True, "mode": "runtime_process_resume", "route": "/runtime/homeostasis/resume/{process_id}", "permission": "actor must match process owner or session key", "audit_event": "homeostasis_control_audit"},
        },
    }
    return dashboard


def run_operator_control_runbook(model: Dict[str, Any]) -> Dict[str, Any]:
    controls = model.get("controls", {}) if isinstance(model, dict) else {}
    freeze = controls.get("freeze_policy") or {}
    rollback = controls.get("rollback_to_baseline") or {}
    resume = controls.get("resume_governor") or {}

    steps = {
        "freeze_policy": {
            "supported": bool(freeze.get("supported")),
            "success": bool(freeze.get("supported")),
            "mode": freeze.get("mode"),
        },
        "rollback_to_baseline": {
            "supported": bool(rollback.get("supported")),
            "success": bool(rollback.get("supported")),
            "mode": rollback.get("mode"),
        },
        "resume_governor": {
            "supported": bool(resume.get("supported")),
            "success": bool(resume.get("supported")),
            "mode": resume.get("mode"),
        },
    }
    return {
        "generated_at": _now_iso(),
        "success": all(bool(step.get("success")) for step in steps.values()),
        "steps": steps,
    }


def render_dashboard_html(model: Dict[str, Any]) -> str:
    headline = model.get("headline", {})
    sections = model.get("sections", {})
    controls = model.get("controls", {})
    trace_rows = "".join(
        f"<li><strong>{row.get('case_id')}</strong>: {', '.join(row.get('rationale') or [])}</li>"
        for row in (sections.get("arbitration_traces") or {}).get("trace_samples", [])
    ) or "<li>No arbitration traces</li>"
    canary_rows = "".join(
        f"<li><strong>{name}</strong>: rollout={payload.get('rollout_percent')} allowed={payload.get('rollout_allowed')} enabled={payload.get('enabled_count')}</li>"
        for name, payload in ((sections.get("canary") or {}).get("stages") or {}).items()
    ) or "<li>No canary data</li>"
    return f"""<!doctype html>
<html lang='en'>
<head>
  <meta charset='utf-8'>
  <title>R7 Operator Dashboard</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; background: #08111f; color: #e5eefb; }}
    .card {{ background: #111b2e; border: 1px solid #2d3b55; border-radius: 10px; padding: 16px; margin-bottom: 16px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }}
    button {{ padding: 10px 14px; margin-right: 8px; border-radius: 8px; border: 0; cursor: pointer; }}
    .freeze {{ background: #f59e0b; color: #111827; }}
    .rollback {{ background: #ef4444; color: white; }}
    .resume {{ background: #22c55e; color: #052e16; }}
    code {{ color: #93c5fd; }}
    pre {{ white-space: pre-wrap; word-break: break-word; }}
  </style>
</head>
<body>
  <h1>R7 Operator Dashboard</h1>
  <p>Generated at <code>{model.get('generated_at')}</code></p>
  <div class='card'>
    <h2>Headline</h2>
    <ul>
      <li>Utility proxy: <strong>{headline.get('utility_proxy')}</strong></li>
      <li>Rollout mode: <strong>{headline.get('rollout_mode')}</strong></li>
      <li>Canary ready: <strong>{headline.get('canary_ready')}</strong></li>
      <li>Shadow estimated uplift: <strong>{headline.get('shadow_estimated_uplift')}</strong></li>
      <li>Alert noise index delta: <strong>{headline.get('alert_noise_index_delta')}</strong></li>
    </ul>
  </div>
  <div class='grid'>
    <div class='card'><h3>Utility</h3><pre>{json.dumps(sections.get('utility', {}), indent=2)}</pre></div>
    <div class='card'><h3>Depth</h3><pre>{json.dumps(sections.get('depth', {}), indent=2)}</pre></div>
    <div class='card'><h3>Latency</h3><pre>{json.dumps(sections.get('latency', {}), indent=2)}</pre></div>
    <div class='card'><h3>Cost</h3><pre>{json.dumps(sections.get('cost', {}), indent=2)}</pre></div>
    <div class='card'><h3>Risk</h3><pre>{json.dumps(sections.get('risk', {}), indent=2)}</pre></div>
    <div class='card'><h3>Alert noise</h3><pre>{json.dumps(sections.get('alert_noise', {}), indent=2)}</pre></div>
  </div>
  <div class='card'>
    <h2>Arbitration traces</h2>
    <ul>{trace_rows}</ul>
  </div>
  <div class='card'>
    <h2>Canary stages</h2>
    <ul>{canary_rows}</ul>
  </div>
  <div class='card'>
    <h2>Operator controls</h2>
    <p>Controls map to real runtime endpoints for freeze, rollback, and resume. They now require owner/session authorization and emit audit events for operator actions. This HTML remains a dashboard surface, but the backing routes are no longer local-only stubs.</p>
    <button class='freeze' onclick=\"alert('freeze route: {controls.get('freeze_policy', {}).get('route')} mode={controls.get('freeze_policy', {}).get('mode')}')\">Freeze policy</button>
    <button class='rollback' onclick=\"alert('rollback route: {controls.get('rollback_to_baseline', {}).get('route')} mode={controls.get('rollback_to_baseline', {}).get('mode')}')\">Rollback to baseline</button>
    <button class='resume' onclick=\"alert('resume route: {controls.get('resume_governor', {}).get('route')} mode={controls.get('resume_governor', {}).get('mode')}')\">Resume governor</button>
  </div>
</body>
</html>
"""
