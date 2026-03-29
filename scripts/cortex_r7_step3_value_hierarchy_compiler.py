#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.homeostasis.value_hierarchy_compiler import compile_value_hierarchy, load_hierarchy_spec, run_hierarchy_replay

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r7_value_homeostasis" / "step3"

REPLAY_CASES = [
    {
        "case_id": "safety_over_efficiency",
        "expected_candidate_id": "safe_slow",
        "candidates": [
            {"candidate_id": "safe_slow", "scores": {"safety": 0.96, "truth": 0.84, "user_intent": 0.74, "reliability": 0.86, "efficiency": 0.55}},
            {"candidate_id": "fast_risky", "scores": {"safety": 0.8, "truth": 0.82, "user_intent": 0.78, "reliability": 0.8, "efficiency": 0.92}},
        ],
    },
    {
        "case_id": "truth_over_user_intent",
        "expected_candidate_id": "truthful_cautious",
        "candidates": [
            {"candidate_id": "truthful_cautious", "scores": {"safety": 0.93, "truth": 0.9, "user_intent": 0.72, "reliability": 0.84, "efficiency": 0.58}},
            {"candidate_id": "wishful_answer", "scores": {"safety": 0.93, "truth": 0.62, "user_intent": 0.88, "reliability": 0.82, "efficiency": 0.71}},
        ],
    },
    {
        "case_id": "user_intent_over_reliability",
        "expected_candidate_id": "aligned_plan",
        "candidates": [
            {"candidate_id": "aligned_plan", "scores": {"safety": 0.91, "truth": 0.87, "user_intent": 0.89, "reliability": 0.79, "efficiency": 0.65}},
            {"candidate_id": "safer_but_misaligned", "scores": {"safety": 0.91, "truth": 0.87, "user_intent": 0.61, "reliability": 0.91, "efficiency": 0.74}},
        ],
    },
    {
        "case_id": "reliability_over_efficiency",
        "expected_candidate_id": "reliable_path",
        "candidates": [
            {"candidate_id": "reliable_path", "scores": {"safety": 0.92, "truth": 0.86, "user_intent": 0.77, "reliability": 0.91, "efficiency": 0.63}},
            {"candidate_id": "cheap_fast", "scores": {"safety": 0.92, "truth": 0.86, "user_intent": 0.77, "reliability": 0.73, "efficiency": 0.92}},
        ],
    },
    {
        "case_id": "all_fail_floor_fallback",
        "expected_candidate_id": "least_bad_safe",
        "candidates": [
            {"candidate_id": "least_bad_safe", "scores": {"safety": 0.83, "truth": 0.69, "user_intent": 0.52, "reliability": 0.71, "efficiency": 0.62}},
            {"candidate_id": "unsafe_fast", "scores": {"safety": 0.58, "truth": 0.7, "user_intent": 0.79, "reliability": 0.74, "efficiency": 0.95}},
        ],
    },
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    spec = load_hierarchy_spec(ROOT / "services" / "homeostasis" / "objective_hierarchy.json")
    compiled = compile_value_hierarchy(spec)
    replay = run_hierarchy_replay(compiled, REPLAY_CASES)
    compiled_path = ARTIFACT_DIR / "value_hierarchy_compiled_latest.json"
    probe_path = ARTIFACT_DIR / "value_hierarchy_probe_latest.json"
    compiled_path.write_text(json.dumps(compiled, indent=2) + "\n", encoding="utf-8")
    payload = {
        "generated_at": now_iso(),
        "compiled_path": str(compiled_path.relative_to(ROOT)),
        "objective_order": compiled.get("objective_order", []),
        "replay": replay,
        "gate_pass": bool(replay.get("all_valid")),
    }
    probe_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
