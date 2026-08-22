#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.routing.adaptive_router_policy import explain_route_decision, scoring_policy_spec
from services.routing.counterfactual_replay_evaluator import evaluate_dataset
from services.routing.route_feature_pipeline import build_route_features

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step4"
STEP6_DATASET = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step6" / "replay_dataset_latest.jsonl"
STEP1_DATASET = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step1" / "baseline_telemetry_dataset_latest.jsonl"

CASES = [
    {"query": "Explain TCP in one paragraph", "risk_flags": []},
    {"query": "Implement a python API bug fix with unit test coverage", "risk_flags": ["code_change"]},
    {"query": "Research the latest outage status with sources", "risk_flags": ["live_state"]},
    {"query": "Brainstorm novel product ideas unrelated to memory", "risk_flags": []},
    {"query": "Remind me in 20 minutes to check the deploy", "risk_flags": []},
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    explanations = []
    for case in CASES:
        features = build_route_features(case["query"], risk_flags=case.get("risk_flags") or [], historical_success=0.67)
        explanation = explain_route_decision(features)
        explanations.append(
            {
                "query": case["query"],
                "intent": features["intent"],
                "risk_tier": features["risk_tier"],
                "selected_chain": explanation["selected_chain"],
                "utility_gap_to_second": explanation["utility_gap_to_second"],
                "top_candidates": explanation["candidates"][:3],
            }
        )
    dataset_path = STEP6_DATASET if STEP6_DATASET.exists() else STEP1_DATASET
    replay = evaluate_dataset(dataset_path) if dataset_path.exists() else {"success": False, "error": "missing_dataset"}
    payload = {
        "generated_at": now_iso(),
        "policy_spec": scoring_policy_spec(),
        "dataset_path": str(dataset_path.relative_to(ROOT)) if dataset_path.exists() else None,
        "offline_gate": {
            "success": bool(replay.get("success")),
            "quality_delta_positive": bool(float(replay.get("quality_delta", 0.0) or 0.0) > 0),
            "quality_delta": replay.get("quality_delta"),
        },
        "explanations": explanations,
    }
    (ARTIFACT_DIR / "replay_probe_latest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
