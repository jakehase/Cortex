from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


ARTIFACT_ROOT = Path("artifacts/cortex_roadmap/r9_adaptive_routing_brain")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception:
        return {}


def build_claim_map(*, artifact_root: Path | str = ARTIFACT_ROOT) -> Dict[str, Any]:
    root = Path(artifact_root)
    step4 = _read_json(root / "step4" / "replay_probe_latest.json")
    step5 = _read_json(root / "step5" / "chain_probe_latest.json")
    step6 = _read_json(root / "step6" / "replay_probe_latest.json")
    step7 = _read_json(root / "step7" / "rollback_probe_latest.json")
    step8 = _read_json(root / "step8" / "shadow_probe_latest.json")
    step9 = _read_json(root / "step9" / "canary_probe_latest.json")
    step10 = _read_json(root / "step10" / "full_rollout_probe_latest.json")
    step11 = _read_json(root / "step11" / "dashboard_probe_latest.json")

    claims: List[Dict[str, Any]] = [
        {
            "claim_id": "r9-claim-01",
            "title": "Dynamic multi-objective route scoring is explicit and inspectable",
            "status": "supported" if bool(step4.get("offline_gate", {}).get("success")) else "partial",
            "evidence": [
                "step4/replay_probe_latest.json#policy_spec",
                "services/routing/adaptive_router_policy.py",
            ],
            "notes": "Weights, objectives, utility formula, and per-candidate utility terms are exposed directly.",
        },
        {
            "claim_id": "r9-claim-02",
            "title": "Candidate generation enforces risk- and taxonomy-aware hard constraints",
            "status": "supported" if bool(step5.get("all_constraints_valid")) else "partial",
            "evidence": [
                "step5/chain_probe_latest.json",
                "services/routing/chain_candidate_generator.py",
            ],
            "notes": "Allowed chains and required core levels are validated per case.",
        },
        {
            "claim_id": "r9-claim-03",
            "title": "Bootstrap routing policy shows positive replay lift on reproducible fixture data",
            "status": "supported" if bool(step6.get("gate_pass")) else "partial",
            "evidence": [
                "step6/replay_dataset_latest.jsonl",
                "step6/replay_probe_latest.json",
            ],
            "notes": "Primary replay score is bootstrap-scored; native bandit replay is supplemental only.",
        },
        {
            "claim_id": "r9-claim-04",
            "title": "Rollback envelope triggers correctly under synthetic failure drills",
            "status": "supported" if bool(step7.get("summary", {}).get("gate_pass")) else "partial",
            "evidence": [
                "step7/rollback_probe_latest.json",
                "services/routing/safety_rollback_guard.py",
            ],
            "notes": "Quality regression, latency spike, and risk violation all trigger rollback under SLA in the drill suite.",
        },
        {
            "claim_id": "r9-claim-05",
            "title": "Operator-facing control plane exists for local observability and runbook drills",
            "status": "supported" if bool(step11.get("gate_pass")) else "partial",
            "evidence": [
                "step11/dashboard_live_local.html",
                "step11/dashboard_probe_latest.json",
                "services/routing/operator_dashboard.py",
            ],
            "notes": "Controls are local stubs, so this supports observability/runbook claims rather than production control claims.",
        },
        {
            "claim_id": "r9-claim-06",
            "title": "Production rollout is complete and proven on live traffic",
            "status": "not_supported",
            "evidence": [
                "step9/canary_probe_latest.json",
                "step10/full_rollout_probe_latest.json",
            ],
            "notes": "Current repo evidence supports a bootstrap/controlled rollout slice, not a strong claim of mature live production deployment.",
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
        },
    }


def build_reproducibility_pack(*, artifact_root: Path | str = ARTIFACT_ROOT) -> Dict[str, Any]:
    root = Path(artifact_root)
    scripts = [
        "scripts/cortex_r9_step1_baseline_telemetry.py",
        "scripts/cortex_r9_step2_route_taxonomy.py",
        "scripts/cortex_r9_step3_feature_pipeline.py",
        "scripts/cortex_r9_step4_scoring_policy.py",
        "scripts/cortex_r9_step5_candidate_generator.py",
        "scripts/cortex_r9_step6_counterfactual_replay.py",
        "scripts/cortex_r9_step7_safety_rollback.py",
        "scripts/cortex_r9_step8_shadow_mode.py",
        "scripts/cortex_r9_step9_canary_rollout.py",
        "scripts/cortex_r9_step10_full_rollout_autotune.py",
        "scripts/cortex_r9_step11_operator_dashboard.py",
        "scripts/cortex_r9_step12_novelty_packaging.py",
        "scripts/cortex_r9_adaptive_routing_brain.py",
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
            "Several probes operate on synthetic or fixture data; claims should be phrased accordingly.",
        ],
    }


def render_novelty_brief(claim_map: Dict[str, Any], reproducibility_pack: Dict[str, Any]) -> str:
    summary = claim_map.get("summary", {})
    lines = [
        "# R9 Adaptive Routing Brain — Novelty Brief",
        "",
        "## Framing",
        "This package argues for a practical novelty slice: dynamic multi-objective routing under explicit risk constraints with rollback and operator observability.",
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
            "- Do not overclaim live production maturity beyond the committed artifacts.",
            "",
            "## Reproducibility",
            "- The routing package includes executable scripts for baseline telemetry, taxonomy, feature extraction, scoring, candidate generation, replay, rollback drills, shadow, canary, rollout probe, and dashboard generation.",
            f"- Artifact count in pack: {len(reproducibility_pack.get('artifacts', []))}",
            "",
            "## Suggested claim language",
            "- Safe: 'We implemented a local adaptive routing stack that combines explicit multi-objective scoring, risk-aware chain filtering, replay evaluation, rollback drills, and operator-facing observability.'",
            "- Safe: 'The repo demonstrates a reproducible bootstrap routing system rather than a fully proven live-production optimizer.'",
            "- Avoid: 'This is already proven at scale on live production traffic.'",
        ]
    )
    return "\n".join(lines) + "\n"
