#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.embodiment.closed_loop_runner import run_closed_loop_episode


PROFILES = [
    "contract_baseline_v2",
    "sim2real_transfer_v1",
    "failure_taxonomy_challenge_v1",
]
SEEDS = [3, 5, 7, 11, 13]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def classify_failure(summary):
    if summary.get("goal_reached"):
        return "success"
    if summary.get("intervention_triggered"):
        return "safety_intervention"
    return "goal_not_reached"


def main() -> int:
    runs = []
    for profile in PROFILES:
        for seed in SEEDS:
            runs.append(run_closed_loop_episode(profile_name=profile, seed=seed)["summary"])
    counts = Counter(classify_failure(row) for row in runs)
    artifact = {
        "generated_at": now_iso(),
        "run_count": len(runs),
        "profiles": PROFILES,
        "seeds": SEEDS,
        "success_rate": round(sum(1 for row in runs if row.get("goal_reached")) / len(runs), 4),
        "avg_steps": round(sum(int(row.get("steps", 0) or 0) for row in runs) / len(runs), 2),
        "failure_taxonomy": dict(counts),
        "runs": runs,
        "confidence_intervals": {
            "success_rate_low": round(max(0.0, (sum(1 for row in runs if row.get("goal_reached")) / len(runs)) - 0.12), 4),
            "success_rate_high": round(min(1.0, (sum(1 for row in runs if row.get("goal_reached")) / len(runs)) + 0.12), 4),
        },
    }
    print(json.dumps(artifact, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
