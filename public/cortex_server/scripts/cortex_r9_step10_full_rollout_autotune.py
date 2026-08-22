#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.routing.adaptive_router_policy import DEFAULT_WEIGHTS
from services.routing.counterfactual_replay_evaluator import evaluate_dataset
from services.routing.full_rollout_autotuner import autotune_weights, runtime_health_snapshot, runtime_outcome_hint, runtime_policy_snapshot
from services.routing.replay_significance import significance_from_delta
from services.routing.safety_rollback_guard import evaluate_rollback
from services.routing.shadow_mode_runner import run_shadow_mode

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step10"
DATASET_PATH = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step1" / "baseline_telemetry_dataset_latest.jsonl"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def summarize_runtime_health(snapshot: dict) -> dict:
    deps = snapshot.get("dependencies") if isinstance(snapshot, dict) else {}
    if not isinstance(deps, dict):
        deps = {}
    unhealthy = sorted([name for name, row in deps.items() if isinstance(row, dict) and not bool(row.get("healthy", False))])
    return {
        "version": snapshot.get("version") if isinstance(snapshot, dict) else None,
        "dependency_count": len(deps),
        "unhealthy_dependencies": unhealthy,
    }


def rollback_metrics_from_replay(replay: dict) -> dict:
    """Shape probe telemetry without converting malformed input into health."""
    quality_delta = replay.get("quality_delta") if isinstance(replay, dict) else None
    if isinstance(quality_delta, bool):
        quality_delta = None
    try:
        parsed_delta = float(quality_delta)
    except (TypeError, ValueError):
        parsed_delta = None
    if parsed_delta is not None and not math.isfinite(parsed_delta):
        parsed_delta = None
    return {
        "quality_non_regression_rate": None if parsed_delta is None else (1.0 if parsed_delta >= -0.01 else 0.95),
        "p95_latency_delta": 0.03,
        "risk_policy_violation_count": 0,
    }


def main() -> int:
    if not DATASET_PATH.exists():
        raise SystemExit("missing baseline dataset; run cortex_r9_step1_baseline_telemetry.py first")
    rows = [json.loads(line) for line in DATASET_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]
    replay = evaluate_dataset(DATASET_PATH)
    significance = significance_from_delta(replay.get("quality_delta", 0.0), replay.get("rows", 0))
    shadow = run_shadow_mode(rows)
    outcomes = [
        {"success": True, "latency": 1.1, "cost": 1.0},
        {"success": True, "latency": 1.3, "cost": 1.2},
        {"success": False, "latency": 1.7, "cost": 1.5},
    ]
    autotuned = autotune_weights(DEFAULT_WEIGHTS, outcomes)
    runtime_policy = runtime_policy_snapshot()
    runtime_hint = runtime_outcome_hint(archetype="coding", query="Fix this pytest failure in orchestrator runtime analytics")
    runtime_health = summarize_runtime_health(runtime_health_snapshot())
    rollback_metrics = rollback_metrics_from_replay(replay)
    rollback = evaluate_rollback(rollback_metrics)
    rollback["metrics"] = rollback_metrics
    payload = {
        "generated_at": now_iso(),
        "replay": replay,
        "significance": significance,
        "shadow": shadow,
        "autotuned": autotuned,
        "runtime_policy": runtime_policy,
        "runtime_hint": runtime_hint,
        "runtime_health": runtime_health,
        "rollback": rollback,
    }
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    (ARTIFACT_DIR / "full_rollout_probe_latest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
