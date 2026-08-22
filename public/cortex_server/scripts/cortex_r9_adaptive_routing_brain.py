#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_json(script: str):
    proc = subprocess.run(["python3", str(ROOT / script)], capture_output=True, text=True, check=True)
    return json.loads(proc.stdout)


def main() -> int:
    baseline = run_json("scripts/cortex_r9_step1_baseline_telemetry.py")
    taxonomy = run_json("scripts/cortex_r9_step2_route_taxonomy.py")
    features = run_json("scripts/cortex_r9_step3_feature_pipeline.py")
    scoring = run_json("scripts/cortex_r9_step4_scoring_policy.py")
    candidates = run_json("scripts/cortex_r9_step5_candidate_generator.py")
    replay = run_json("scripts/cortex_r9_step6_counterfactual_replay.py")
    rollback = run_json("scripts/cortex_r9_step7_safety_rollback.py")
    shadow = run_json("scripts/cortex_r9_step8_shadow_mode.py")
    canary = run_json("scripts/cortex_r9_step9_canary_rollout.py")
    full_rollout = run_json("scripts/cortex_r9_step10_full_rollout_autotune.py")
    dashboard = run_json("scripts/cortex_r9_step11_operator_dashboard.py")
    novelty = run_json("scripts/cortex_r9_step12_novelty_packaging.py")
    print(json.dumps({"success": True, "baseline": baseline, "taxonomy": taxonomy, "features": features, "scoring": scoring, "candidates": candidates, "replay": replay, "rollback": rollback, "shadow": shadow, "canary": canary, "full_rollout": full_rollout, "dashboard": dashboard, "novelty": novelty}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
