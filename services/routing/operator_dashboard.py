from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict


ARTIFACT_ROOT = Path("artifacts/cortex_roadmap/r9_adaptive_routing_brain")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception:
        return {}


def _chain_distribution(step1_payload: Dict[str, Any], step5_payload: Dict[str, Any]) -> Dict[str, int]:
    counts = Counter()
    dataset_path = step1_payload.get("dataset_path")
    if dataset_path:
        path = Path(dataset_path)
        if not path.is_absolute():
            path = Path.cwd() / path
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                chain = str(row.get("live_chain") or "").strip()
                if chain:
                    counts[chain] += 1
    for row in step5_payload.get("rows") or []:
        for chain in row.get("candidate_chain_ids") or []:
            counts[f"candidate::{chain}"] += 1
    return dict(sorted(counts.items()))


def build_dashboard_model(*, artifact_root: Path | str = ARTIFACT_ROOT) -> Dict[str, Any]:
    root = Path(artifact_root)
    step1 = _read_json(root / "step1" / "baseline_telemetry_probe_latest.json")
    step4 = _read_json(root / "step4" / "replay_probe_latest.json")
    step5 = _read_json(root / "step5" / "chain_probe_latest.json")
    step6 = _read_json(root / "step6" / "replay_probe_latest.json")
    step7 = _read_json(root / "step7" / "rollback_probe_latest.json")
    step8 = _read_json(root / "step8" / "shadow_probe_latest.json")
    step9 = _read_json(root / "step9" / "canary_probe_latest.json")
    step10 = _read_json(root / "step10" / "full_rollout_probe_latest.json")

    chain_distribution = _chain_distribution(step1, step5)
    dashboard = {
        "generated_at": _now_iso(),
        "artifact_root": str(root),
        "headline": {
            "quality_delta": step10.get("replay", {}).get("quality_delta", step6.get("replay", {}).get("quality_delta")),
            "rollback_required": step10.get("rollback", {}).get("rollback_required"),
            "shadow_disagreement_rate": step8.get("shadow", {}).get("disagreement_rate"),
            "canary_stage_20_enabled": step9.get("stages", {}).get("stage_20", {}).get("enabled_count"),
        },
        "sections": {
            "scoring": {
                "weights": step4.get("policy_spec", {}).get("weights", {}),
                "quality_delta_positive": step4.get("offline_gate", {}).get("quality_delta_positive"),
                "quality_delta": step4.get("offline_gate", {}).get("quality_delta"),
            },
            "candidates": {
                "case_count": step5.get("case_count"),
                "all_constraints_valid": step5.get("all_constraints_valid"),
                "total_candidates": step5.get("total_candidates"),
            },
            "replay": {
                "rows": step6.get("rows"),
                "quality_delta": step6.get("replay", {}).get("quality_delta"),
                "significant": step6.get("significance", {}).get("significant"),
                "gate_pass": step6.get("gate_pass"),
            },
            "rollback": {
                "gate_pass": step7.get("summary", {}).get("gate_pass"),
                "max_recovery_seconds": step7.get("summary", {}).get("max_recovery_seconds"),
                "sla_met": step7.get("summary", {}).get("sla_met"),
            },
            "shadow": {
                "rows": step8.get("shadow", {}).get("rows"),
                "disagreement_rate": step8.get("shadow", {}).get("disagreement_rate"),
            },
            "canary": step9.get("stages", {}),
            "rollout": {
                "quality_delta": step10.get("replay", {}).get("quality_delta"),
                "rollback_required": step10.get("rollback", {}).get("rollback_required"),
                "runtime_health": step10.get("runtime_health", {}),
                "runtime_hint": step10.get("runtime_hint", {}),
            },
        },
        "chain_distribution": chain_distribution,
        "controls": {
            "freeze_policy": {"action": "freeze", "supported": True, "mode": "local_stub"},
            "rollback_to_baseline": {"action": "rollback", "supported": True, "mode": "local_stub"},
        },
    }
    return dashboard


def run_operator_control_runbook(model: Dict[str, Any]) -> Dict[str, Any]:
    controls = model.get("controls", {}) if isinstance(model, dict) else {}
    freeze_supported = bool((controls.get("freeze_policy") or {}).get("supported"))
    rollback_supported = bool((controls.get("rollback_to_baseline") or {}).get("supported"))
    drill = {
        "freeze_policy": {"supported": freeze_supported, "success": freeze_supported, "mode": (controls.get("freeze_policy") or {}).get("mode")},
        "rollback_to_baseline": {"supported": rollback_supported, "success": rollback_supported, "mode": (controls.get("rollback_to_baseline") or {}).get("mode")},
    }
    return {
        "generated_at": _now_iso(),
        "success": all(item.get("success") for item in drill.values()),
        "steps": drill,
    }


def render_dashboard_html(model: Dict[str, Any]) -> str:
    headline = model.get("headline", {})
    sections = model.get("sections", {})
    chain_distribution = model.get("chain_distribution", {})
    controls = model.get("controls", {})
    chain_rows = "".join(f"<li><strong>{name}</strong>: {count}</li>" for name, count in chain_distribution.items()) or "<li>No chain data</li>"
    canary_rows = "".join(
        f"<li><strong>{name}</strong>: enabled={payload.get('enabled_count')} rollout={payload.get('rollout_percent')}</li>"
        for name, payload in (sections.get("canary") or {}).items()
    ) or "<li>No canary data</li>"
    return f"""<!doctype html>
<html lang='en'>
<head>
  <meta charset='utf-8'>
  <title>R9 Operator Dashboard</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; background: #0f172a; color: #e2e8f0; }}
    .card {{ background: #111827; border: 1px solid #334155; border-radius: 10px; padding: 16px; margin-bottom: 16px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }}
    button {{ padding: 10px 14px; margin-right: 8px; border-radius: 8px; border: 0; cursor: pointer; }}
    .freeze {{ background: #f59e0b; color: #111827; }}
    .rollback {{ background: #ef4444; color: white; }}
    code {{ color: #93c5fd; }}
  </style>
</head>
<body>
  <h1>R9 Operator Dashboard</h1>
  <p>Generated at <code>{model.get('generated_at')}</code></p>
  <div class='card'>
    <h2>Headline</h2>
    <ul>
      <li>Quality delta: <strong>{headline.get('quality_delta')}</strong></li>
      <li>Rollback required: <strong>{headline.get('rollback_required')}</strong></li>
      <li>Shadow disagreement rate: <strong>{headline.get('shadow_disagreement_rate')}</strong></li>
      <li>Canary stage 20 enabled: <strong>{headline.get('canary_stage_20_enabled')}</strong></li>
    </ul>
  </div>
  <div class='grid'>
    <div class='card'><h3>Scoring</h3><pre>{json.dumps(sections.get('scoring', {}), indent=2)}</pre></div>
    <div class='card'><h3>Candidates</h3><pre>{json.dumps(sections.get('candidates', {}), indent=2)}</pre></div>
    <div class='card'><h3>Replay</h3><pre>{json.dumps(sections.get('replay', {}), indent=2)}</pre></div>
    <div class='card'><h3>Rollback</h3><pre>{json.dumps(sections.get('rollback', {}), indent=2)}</pre></div>
    <div class='card'><h3>Shadow</h3><pre>{json.dumps(sections.get('shadow', {}), indent=2)}</pre></div>
    <div class='card'><h3>Rollout</h3><pre>{json.dumps(sections.get('rollout', {}), indent=2)}</pre></div>
  </div>
  <div class='card'>
    <h2>Chain distribution</h2>
    <ul>{chain_rows}</ul>
  </div>
  <div class='card'>
    <h2>Canary stages</h2>
    <ul>{canary_rows}</ul>
  </div>
  <div class='card'>
    <h2>Operator controls</h2>
    <p>Controls are local stubs for drill/testing, not live production mutations.</p>
    <button class='freeze' onclick="alert('freeze policy stub: {controls.get('freeze_policy', {}).get('mode')}')">Freeze policy</button>
    <button class='rollback' onclick="alert('rollback stub: {controls.get('rollback_to_baseline', {}).get('mode')}')">Rollback to baseline</button>
  </div>
</body>
</html>
"""
