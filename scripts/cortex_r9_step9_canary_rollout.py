#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.routing.canary_rollout_controller import CanaryRolloutController

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step9"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    sample_keys = [
        "qa:tcp",
        "coding:pytest-runtime",
        "creative:novel-ideas",
        "research:db-outage",
        "reminder:calendar-check",
        "qa:http-cache",
        "coding:fastapi-lifespan",
        "research:weather-evidence",
        "creative:moonshot-product",
        "reminder:standup-ping",
    ]
    stages = {}
    for percent in (5, 20):
        controller = CanaryRolloutController(rollout_percent=percent)
        decisions = [{"key": key, **controller.eligible(key)} for key in sample_keys]
        stages[f"stage_{percent}"] = {
            "rollout_percent": controller.rollout_percent,
            "decisions": decisions,
            "enabled_count": sum(1 for row in decisions if row["enabled"]),
        }
    payload = {
        "generated_at": now_iso(),
        "stages": stages,
    }
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    (ARTIFACT_DIR / "canary_probe_latest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
