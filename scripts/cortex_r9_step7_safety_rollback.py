#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.routing.safety_rollback_guard import DEFAULT_SLA_SECONDS, run_rollback_drill

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step7"


DRILL_CASES = [
    {
        "name": "quality_collapse",
        "metrics": {"quality_non_regression_rate": 0.94, "p95_latency_delta": 0.01, "risk_policy_violation_count": 0},
        "expect_rollback": True,
        "recovery_seconds": 18,
    },
    {
        "name": "latency_spike",
        "metrics": {"quality_non_regression_rate": 1.0, "p95_latency_delta": 0.11, "risk_policy_violation_count": 0},
        "expect_rollback": True,
        "recovery_seconds": 12,
    },
    {
        "name": "risk_violation",
        "metrics": {"quality_non_regression_rate": 1.0, "p95_latency_delta": 0.02, "risk_policy_violation_count": 2},
        "expect_rollback": True,
        "recovery_seconds": 4,
    },
    {
        "name": "combined_failure",
        "metrics": {"quality_non_regression_rate": 0.96, "p95_latency_delta": 0.09, "risk_policy_violation_count": 1},
        "expect_rollback": True,
        "recovery_seconds": 27,
    },
    {
        "name": "healthy_control",
        "metrics": {"quality_non_regression_rate": 1.0, "p95_latency_delta": 0.01, "risk_policy_violation_count": 0},
        "expect_rollback": False,
        "recovery_seconds": 0,
    },
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    drill = run_rollback_drill(DRILL_CASES, sla_seconds=DEFAULT_SLA_SECONDS)
    payload = {
        "generated_at": now_iso(),
        "drill": drill,
        "summary": {
            "scenario_count": drill["scenario_count"],
            "gate_pass": drill["gate_pass"],
            "sla_met": drill["sla_met"],
            "max_recovery_seconds": drill["max_recovery_seconds"],
        },
    }
    (ARTIFACT_DIR / "rollback_probe_latest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
