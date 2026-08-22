#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.routing.counterfactual_replay_evaluator import evaluate_dataset
from services.routing.replay_significance import significance_from_delta

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step6"
DATASET_PATH = ARTIFACT_DIR / "replay_dataset_latest.jsonl"

BASE_CASES = [
    {"query": "Fix this pytest failure in orchestrator runtime analytics", "risk_flags": ["code_change"], "quality": 0.81, "historical_success": 0.71, "live_chain": "deliberate_council"},
    {"query": "Implement a python API bug fix with unit test coverage", "risk_flags": ["code_change"], "quality": 0.8, "historical_success": 0.7, "live_chain": "deliberate_council"},
    {"query": "Refactor the auth middleware and preserve test coverage", "risk_flags": ["code_change"], "quality": 0.79, "historical_success": 0.68, "live_chain": "deliberate_council"},
    {"query": "Research current database outage status and likely mitigation", "risk_flags": ["live_state"], "quality": 0.79, "historical_success": 0.69, "live_chain": "research_grounded"},
    {"query": "Research the latest outage status with sources", "risk_flags": ["live_state"], "quality": 0.8, "historical_success": 0.72, "live_chain": "research_grounded"},
    {"query": "Compare current vendor pricing with sources", "risk_flags": ["live_state"], "quality": 0.78, "historical_success": 0.67, "live_chain": "research_grounded"},
    {"query": "Brainstorm novel product ideas unrelated to memory", "risk_flags": [], "quality": 0.75, "historical_success": 0.58, "live_chain": "creative_fractal"},
    {"query": "Brainstorm three weird but plausible startup concepts", "risk_flags": [], "quality": 0.76, "historical_success": 0.6, "live_chain": "creative_fractal"},
    {"query": "Come up with creative names for a devtool", "risk_flags": [], "quality": 0.74, "historical_success": 0.57, "live_chain": "creative_fractal"},
    {"query": "Remind me in 20 minutes to check the deploy", "risk_flags": [], "quality": 0.71, "historical_success": 0.66, "live_chain": "safe_reminder"},
    {"query": "Remind me tomorrow morning to email the vendor", "risk_flags": [], "quality": 0.72, "historical_success": 0.67, "live_chain": "safe_reminder"},
    {"query": "Set a reminder for lunch to call the contractor", "risk_flags": [], "quality": 0.7, "historical_success": 0.64, "live_chain": "safe_reminder"},
    {"query": "Explain TCP in one paragraph", "risk_flags": [], "quality": 0.72, "historical_success": 0.62, "live_chain": "fastlane_memory"},
    {"query": "Summarize what Redis is for in simple terms", "risk_flags": [], "quality": 0.71, "historical_success": 0.61, "live_chain": "fastlane_memory"},
    {"query": "What does HTTP 502 mean?", "risk_flags": [], "quality": 0.7, "historical_success": 0.6, "live_chain": "fastlane_memory"},
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_dataset() -> list[dict]:
    rows = []
    quality_offsets = [0.0, 0.015, -0.01, 0.02, 0.012, -0.005]
    success_offsets = [0.0, 0.03, -0.02, 0.01, 0.02, -0.01]
    for idx, base in enumerate(BASE_CASES):
        for variant in range(len(quality_offsets)):
            row = dict(base)
            row["query"] = f"{base['query']} [fixture:{idx:02d}:{variant}]"
            row["quality"] = round(max(0.55, min(0.92, float(base["quality"]) + quality_offsets[variant])), 4)
            row["historical_success"] = round(max(0.45, min(0.9, float(base["historical_success"]) + success_offsets[variant])), 4)
            rows.append(row)
    return rows


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    rows = build_dataset()
    with DATASET_PATH.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")
    replay = evaluate_dataset(DATASET_PATH)
    significance = significance_from_delta(float(replay.get("quality_delta", 0.0) or 0.0), int(replay.get("rows", 0) or 0))
    payload = {
        "generated_at": now_iso(),
        "dataset_path": str(DATASET_PATH.relative_to(ROOT)),
        "rows": len(rows),
        "replay": replay,
        "significance": significance,
        "gate_pass": bool(replay.get("quality_delta", 0.0) > 0 and significance.get("significant", False)),
        "notes": [
            "Fixture replay dataset is synthetic but reproducible.",
            "Native bandit replay, when available, is reported only as supplemental evidence.",
        ],
    }
    (ARTIFACT_DIR / "replay_probe_latest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
