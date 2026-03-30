from __future__ import annotations

import json
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


def build_claim_map(*, artifact_root: Path | str = ARTIFACT_ROOT) -> Dict[str, Any]:
    root = Path(artifact_root)
    step3 = _read_json(root / "step3" / "value_hierarchy_probe_latest.json")
    step4 = _read_json(root / "step4" / "arbitration_probe_latest.json")
    step5 = _read_json(root / "step5" / "budget_allocator_probe_latest.json")
    step6 = _read_json(root / "step6" / "adaptive_effort_probe_latest.json")
    step7 = _read_json(root / "step7" / "safety_override_probe_latest.json")
    step8 = _read_json(root / "step8" / "shadow_governor_probe_latest.json")
    step9 = _read_json(root / "step9" / "canary_governor_probe_latest.json")
    step10 = _read_json(root / "step10" / "full_rollout_autotune_probe_latest.json")
    step11 = _read_json(root / "step11" / "dashboard_probe_latest.json")

    benchmark3 = step3.get("benchmark") if isinstance(step3.get("benchmark"), dict) else {}
    benchmark4 = step4.get("benchmark") if isinstance(step4.get("benchmark"), dict) else {}
    simulation5 = step5.get("simulation") if isinstance(step5.get("simulation"), dict) else {}
    benchmark6 = step6.get("benchmark") if isinstance(step6.get("benchmark"), dict) else {}
    benchmark7 = step7.get("benchmark") if isinstance(step7.get("benchmark"), dict) else {}
    shadow8 = step8.get("shadow") if isinstance(step8.get("shadow"), dict) else {}
    canary9 = step9.get("canary") if isinstance(step9.get("canary"), dict) else {}
    validation10 = step10.get("validation") if isinstance(step10.get("validation"), dict) else {}

    claims: List[Dict[str, Any]] = [
        {
            "claim_id": "r7-claim-01",
            "title": "Value hierarchy is explicit and enforceable in replayed decisions",
            "status": "supported" if bool(benchmark3.get("gate_pass")) else "partial",
            "evidence": [
                "step3/value_hierarchy_probe_latest.json",
                "services/homeostasis/value_hierarchy_compiler.py",
                "services/homeostasis/objective_hierarchy.json",
            ],
            "notes": "Safety-first ordering and tie-break behavior are exposed as reproducible artifacts rather than hidden weights.",
        },
        {
            "claim_id": "r7-claim-02",
            "title": "Conflict arbitration emits explainable tradeoff traces",
            "status": "supported" if bool(benchmark4.get("gate_pass")) else "partial",
            "evidence": [
                "step4/arbitration_probe_latest.json",
                "services/homeostasis/conflict_arbitration_v2.py",
            ],
            "notes": "Case-level rationale traces show why a safe or truthful option won under the current mode.",
        },
        {
            "claim_id": "r7-claim-03",
            "title": "Dynamic budget allocation keeps overruns bounded while reserving incident capacity",
            "status": "supported" if bool(simulation5.get("gate_pass")) and int(simulation5.get("overrun_events", 999) if simulation5.get("overrun_events") is not None else 999) <= 2 else "partial",
            "evidence": [
                "step5/budget_allocator_probe_latest.json",
                "services/homeostasis/dynamic_budget_allocator.py",
            ],
            "notes": "The probe includes per-intent sample budgets plus reserve pools for incident and recovery modes.",
        },
        {
            "claim_id": "r7-claim-04",
            "title": "Adaptive effort control couples regulation mode to depth and route guardrails",
            "status": "supported" if bool(benchmark6.get("success_rate", 0.0) >= 0.85) else "partial",
            "evidence": [
                "step6/adaptive_effort_probe_latest.json",
                "services/homeostasis/adaptive_effort_controller.py",
            ],
            "notes": "Mode selection, reasoning depth, escalation, and preferred chains are all emitted in the benchmark payload.",
        },
        {
            "claim_id": "r7-claim-05",
            "title": "Safety overrides and fallback paths are drillable and operator-visible",
            "status": "supported" if bool(benchmark7.get("gate_pass")) and bool(step11.get("gate_pass")) else "partial",
            "evidence": [
                "step7/safety_override_probe_latest.json",
                "step11/dashboard_probe_latest.json",
                "services/homeostasis/safety_envelope_overrides.py",
                "services/homeostasis/operator_dashboard.py",
            ],
            "notes": "Freeze, rollback, and resume are represented as local runbook drills rather than hidden operational assumptions.",
        },
        {
            "claim_id": "r7-claim-06",
            "title": "The governor has been fully proven on long-horizon live production traffic",
            "status": "not_supported",
            "evidence": [
                "step8/shadow_governor_probe_latest.json",
                "step9/canary_governor_probe_latest.json",
                "step10/full_rollout_autotune_probe_latest.json",
            ],
            "notes": "Current evidence demonstrates a reproducible rollout slice with bounded self-tuning, not mature long-horizon production validation.",
        },
        {
            "claim_id": "r7-claim-07",
            "title": "Shadow-to-rollout evidence is coherent enough for internal novelty review",
            "status": "supported" if bool(shadow8.get("gate_pass")) and bool(validation10.get("valid")) else "partial",
            "evidence": [
                "step8/shadow_governor_probe_latest.json",
                "step9/canary_governor_probe_latest.json",
                "step10/full_rollout_autotune_probe_latest.json",
            ],
            "notes": "Shadow uplift, canary readiness state, and bounded autotune validation can be traced through committed artifacts.",
        },
    ]

    return {
        "generated_at": _now_iso(),
        "artifact_root": str(root),
        "claims": claims,
        "summary": {
            "supported": sum(1 for claim in claims if claim["status"] == "supported"),
            "partial": sum(1 for claim in claims if claim["status"] == "partial"),
            "not_supported": sum(1 for claim in claims if claim["status"] == "not_supported"),
            "canary_ready": bool(canary9.get("rollout_ready")),
        },
    }


def build_reproducibility_pack(*, artifact_root: Path | str = ARTIFACT_ROOT) -> Dict[str, Any]:
    root = Path(artifact_root)
    scripts = [
        "scripts/cortex_r7_step1_baseline_regulation.py",
        "scripts/cortex_r7_step2_state_signal_model.py",
        "scripts/cortex_r7_step3_value_hierarchy_compiler.py",
        "scripts/cortex_r7_step4_conflict_arbitration.py",
        "scripts/cortex_r7_step5_dynamic_budget_allocator.py",
        "scripts/cortex_r7_step6_adaptive_effort_controller.py",
        "scripts/cortex_r7_step7_safety_envelope_overrides.py",
        "scripts/cortex_r7_step8_shadow_governor_runner.py",
        "scripts/cortex_r7_step9_canary_governor_controller.py",
        "scripts/cortex_r7_step10_full_rollout_autotuner.py",
        "scripts/cortex_r7_step11_operator_dashboard.py",
        "scripts/cortex_r7_step12_novelty_packaging.py",
        "scripts/cortex_r7_value_homeostasis.py",
    ]
    artifacts = sorted(str(path.relative_to(root.parent.parent.parent)) for path in root.rglob("*") if path.is_file())
    return {
        "generated_at": _now_iso(),
        "artifact_root": str(root),
        "scripts": scripts,
        "artifacts": artifacts,
        "commands": [f"python3 {script}" for script in scripts],
        "notes": [
            "Artifacts are locally reproducible from committed scripts.",
            "Step 11 uses local-stub controls for drill verification rather than live production mutations.",
            "Claim language should stay disciplined about synthetic, replay, shadow, and canary evidence.",
        ],
    }


def render_novelty_brief(claim_map: Dict[str, Any], reproducibility_pack: Dict[str, Any]) -> str:
    summary = claim_map.get("summary", {})
    lines = [
        "# R7 Value/Homeostasis Governor — Novelty Brief",
        "",
        "## Framing",
        "This package argues for a practical novelty slice: an explicit value hierarchy and adaptive homeostasis loop that balances quality, depth, latency, cost, and safety under hard override rules.",
        "",
        "## Strongest supported claims",
    ]
    for claim in claim_map.get("claims", []):
        if claim.get("status") == "supported":
            lines.append(f"- **{claim.get('title')}** — {claim.get('notes')}")
    lines.extend(
        [
            "",
            "## Claim discipline",
            f"- Supported claims: {summary.get('supported', 0)}",
            f"- Partial claims: {summary.get('partial', 0)}",
            f"- Not-supported claims: {summary.get('not_supported', 0)}",
            "- Do not overclaim long-horizon live-production maturity beyond the committed artifacts.",
            "",
            "## Reproducibility",
            "- The homeostasis package includes executable scripts for baseline locking, state signals, hierarchy compilation, arbitration, budget allocation, effort control, safety overrides, shadow evaluation, canary control, rollout autotuning, dashboard generation, and novelty packaging.",
            f"- Artifact count in pack: {len(reproducibility_pack.get('artifacts', []))}",
            "",
            "## Suggested claim language",
            "- Safe: 'We implemented a reproducible homeostasis stack that combines explicit value ordering, explainable arbitration, dynamic budget allocation, bounded self-tuning, and operator drill surfaces.'",
            "- Safe: 'The repo demonstrates a disciplined rollout slice with shadow, canary, and bounded autotune evidence rather than mature long-horizon production proof.'",
            "- Avoid: 'The governor is already fully validated at scale on live production traffic.'",
        ]
    )
    return "\n".join(lines) + "\n"
