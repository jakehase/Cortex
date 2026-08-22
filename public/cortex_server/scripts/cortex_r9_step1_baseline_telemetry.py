#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.routing.route_feature_pipeline import build_route_features

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step1"

SAMPLE_ROWS = [
    {"query": "Explain TCP in one paragraph", "risk_flags": [], "quality": 0.72, "historical_success": 0.62, "live_chain": "fastlane_memory"},
    {"query": "Fix this pytest failure in orchestrator runtime analytics", "risk_flags": ["code_change"], "quality": 0.81, "historical_success": 0.71, "live_chain": "deliberate_council"},
    {"query": "Brainstorm novel product ideas unrelated to memory", "risk_flags": [], "quality": 0.75, "historical_success": 0.58, "live_chain": "creative_fractal"},
    {"query": "Research current database outage status and likely mitigation", "risk_flags": ["live_state"], "quality": 0.79, "historical_success": 0.69, "live_chain": "research_grounded"}
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    dataset_path = ARTIFACT_DIR / "baseline_telemetry_dataset_latest.jsonl"
    with dataset_path.open("w", encoding="utf-8") as handle:
        for row in SAMPLE_ROWS:
            handle.write(json.dumps(row) + "\n")
    probe = {
        "generated_at": now_iso(),
        "rows": len(SAMPLE_ROWS),
        "intents": [build_route_features(row["query"], risk_flags=row["risk_flags"])["intent"] for row in SAMPLE_ROWS],
        "dataset_path": str(dataset_path.relative_to(ROOT)),
        "complete": True,
    }
    (ARTIFACT_DIR / "baseline_telemetry_probe_latest.json").write_text(json.dumps(probe, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(probe, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
