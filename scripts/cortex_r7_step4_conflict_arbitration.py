#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.homeostasis.conflict_arbitration_v2 import run_conflict_arbitration_benchmark
from services.homeostasis.state_signal_model import build_state_signal_snapshot
from services.homeostasis.value_hierarchy_compiler import compile_value_hierarchy, load_hierarchy_spec

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r7_value_homeostasis" / "step4"

PROTECTIVE_STATE = {
    "smoothed_state_vector": {
        "urgency": 0.72,
        "risk_pressure": 0.74,
        "fatigue": 0.41,
        "timeout_pressure": 0.33,
        "error_pressure": 0.66,
        "budget_pressure": 0.38,
        "escalation_debt": 0.44,
    }
}

CONSERVE_STATE = {
    "smoothed_state_vector": {
        "urgency": 0.32,
        "risk_pressure": 0.28,
        "fatigue": 0.61,
        "timeout_pressure": 0.59,
        "error_pressure": 0.21,
        "budget_pressure": 0.66,
        "escalation_debt": 0.57,
    }
}

NORMAL_STATE = {
    "smoothed_state_vector": {
        "urgency": 0.24,
        "risk_pressure": 0.18,
        "fatigue": 0.28,
        "timeout_pressure": 0.21,
        "error_pressure": 0.16,
        "budget_pressure": 0.26,
        "escalation_debt": 0.22,
    }
}

BENCHMARK_CASES = [
    {
        "case_id": "protective_prefers_safe_reliable",
        "state_snapshot": PROTECTIVE_STATE,
        "expected_candidate_id": "safe_reliable",
        "candidates": [
            {"candidate_id": "safe_reliable", "scores": {"safety": 0.95, "truth": 0.88, "user_intent": 0.74, "reliability": 0.9, "efficiency": 0.56}, "traits": {"safety_margin": 0.9, "truth_margin": 0.7, "intent_alignment": 0.7, "reliability_margin": 0.9, "efficiency_margin": 0.5}},
            {"candidate_id": "aggressive_fast", "scores": {"safety": 0.87, "truth": 0.86, "user_intent": 0.82, "reliability": 0.78, "efficiency": 0.91}, "traits": {"safety_margin": 0.4, "truth_margin": 0.6, "intent_alignment": 0.9, "reliability_margin": 0.5, "efficiency_margin": 0.9}},
        ],
    },
    {
        "case_id": "protective_truth_over_intent",
        "state_snapshot": PROTECTIVE_STATE,
        "expected_candidate_id": "truthful_guarded",
        "candidates": [
            {"candidate_id": "truthful_guarded", "scores": {"safety": 0.93, "truth": 0.92, "user_intent": 0.68, "reliability": 0.84, "efficiency": 0.57}, "traits": {"safety_margin": 0.8, "truth_margin": 0.9, "intent_alignment": 0.6, "reliability_margin": 0.8, "efficiency_margin": 0.5}},
            {"candidate_id": "wishful_push", "scores": {"safety": 0.91, "truth": 0.76, "user_intent": 0.88, "reliability": 0.8, "efficiency": 0.72}, "traits": {"safety_margin": 0.7, "truth_margin": 0.2, "intent_alignment": 0.95, "reliability_margin": 0.6, "efficiency_margin": 0.7}},
        ],
    },
    {
        "case_id": "conserve_prefers_efficient_stable",
        "state_snapshot": CONSERVE_STATE,
        "expected_candidate_id": "efficient_stable",
        "candidates": [
            {"candidate_id": "efficient_stable", "scores": {"safety": 0.91, "truth": 0.87, "user_intent": 0.82, "reliability": 0.84, "efficiency": 0.88}, "traits": {"safety_margin": 0.7, "truth_margin": 0.7, "intent_alignment": 0.86, "reliability_margin": 0.8, "efficiency_margin": 0.95}},
            {"candidate_id": "maximal_depth", "scores": {"safety": 0.91, "truth": 0.87, "user_intent": 0.8, "reliability": 0.82, "efficiency": 0.58}, "traits": {"safety_margin": 0.8, "truth_margin": 0.8, "intent_alignment": 0.85, "reliability_margin": 0.7, "efficiency_margin": 0.4}},
        ],
    },
    {
        "case_id": "conserve_keeps_truth_floor",
        "state_snapshot": CONSERVE_STATE,
        "expected_candidate_id": "truthful_efficient",
        "candidates": [
            {"candidate_id": "truthful_efficient", "scores": {"safety": 0.9, "truth": 0.88, "user_intent": 0.81, "reliability": 0.81, "efficiency": 0.83}, "traits": {"safety_margin": 0.7, "truth_margin": 0.85, "intent_alignment": 0.84, "reliability_margin": 0.75, "efficiency_margin": 0.88}},
            {"candidate_id": "efficient_but_thin", "scores": {"safety": 0.9, "truth": 0.72, "user_intent": 0.79, "reliability": 0.79, "efficiency": 0.92}, "traits": {"safety_margin": 0.7, "truth_margin": 0.15, "intent_alignment": 0.82, "reliability_margin": 0.7, "efficiency_margin": 0.96}},
        ],
    },
    {
        "case_id": "normal_prefers_intent_when_safe_and_true",
        "state_snapshot": NORMAL_STATE,
        "expected_candidate_id": "best_aligned",
        "candidates": [
            {"candidate_id": "best_aligned", "scores": {"safety": 0.91, "truth": 0.88, "user_intent": 0.9, "reliability": 0.8, "efficiency": 0.72}, "traits": {"safety_margin": 0.75, "truth_margin": 0.8, "intent_alignment": 0.95, "reliability_margin": 0.7, "efficiency_margin": 0.72}},
            {"candidate_id": "more_reliable", "scores": {"safety": 0.91, "truth": 0.88, "user_intent": 0.76, "reliability": 0.91, "efficiency": 0.74}, "traits": {"safety_margin": 0.75, "truth_margin": 0.8, "intent_alignment": 0.72, "reliability_margin": 0.92, "efficiency_margin": 0.75}},
        ],
    },
    {
        "case_id": "normal_prefers_reliability_over_efficiency_on_tie",
        "state_snapshot": NORMAL_STATE,
        "expected_candidate_id": "reliable_tie_break",
        "candidates": [
            {"candidate_id": "reliable_tie_break", "scores": {"safety": 0.9, "truth": 0.85, "user_intent": 0.77, "reliability": 0.88, "efficiency": 0.66}, "traits": {"safety_margin": 0.7, "truth_margin": 0.7, "intent_alignment": 0.77, "reliability_margin": 0.9, "efficiency_margin": 0.68}},
            {"candidate_id": "efficient_tie_break", "scores": {"safety": 0.9, "truth": 0.85, "user_intent": 0.77, "reliability": 0.74, "efficiency": 0.9}, "traits": {"safety_margin": 0.7, "truth_margin": 0.7, "intent_alignment": 0.77, "reliability_margin": 0.72, "efficiency_margin": 0.94}},
        ],
    },
    {
        "case_id": "protective_filters_unsafe_candidate",
        "state_snapshot": PROTECTIVE_STATE,
        "expected_candidate_id": "safe_floor_pass",
        "candidates": [
            {"candidate_id": "safe_floor_pass", "scores": {"safety": 0.88, "truth": 0.82, "user_intent": 0.7, "reliability": 0.8, "efficiency": 0.65}, "traits": {"safety_margin": 0.8, "truth_margin": 0.7, "intent_alignment": 0.7, "reliability_margin": 0.8, "efficiency_margin": 0.7}},
            {"candidate_id": "unsafe_floor_fail", "scores": {"safety": 0.72, "truth": 0.84, "user_intent": 0.84, "reliability": 0.82, "efficiency": 0.9}, "traits": {"safety_margin": 0.2, "truth_margin": 0.7, "intent_alignment": 0.9, "reliability_margin": 0.7, "efficiency_margin": 0.95}},
        ],
    },
    {
        "case_id": "fallback_to_highest_safety_when_all_fail",
        "state_snapshot": PROTECTIVE_STATE,
        "expected_candidate_id": "least_bad_safe",
        "candidates": [
            {"candidate_id": "least_bad_safe", "scores": {"safety": 0.83, "truth": 0.69, "user_intent": 0.6, "reliability": 0.71, "efficiency": 0.61}, "traits": {"safety_margin": 0.65, "truth_margin": 0.55, "intent_alignment": 0.65, "reliability_margin": 0.7, "efficiency_margin": 0.62}},
            {"candidate_id": "unsafe_fast", "scores": {"safety": 0.62, "truth": 0.74, "user_intent": 0.82, "reliability": 0.77, "efficiency": 0.94}, "traits": {"safety_margin": 0.2, "truth_margin": 0.65, "intent_alignment": 0.9, "reliability_margin": 0.75, "efficiency_margin": 0.95}},
        ],
    },
    {
        "case_id": "live_state_context_uses_current_signal_profile",
        "expected_candidate_id": "live_safe_balanced",
        "candidates": [
            {"candidate_id": "live_safe_balanced", "scores": {"safety": 0.9, "truth": 0.85, "user_intent": 0.76, "reliability": 0.83, "efficiency": 0.68}, "traits": {"safety_margin": 0.8, "truth_margin": 0.75, "intent_alignment": 0.8, "reliability_margin": 0.82, "efficiency_margin": 0.7}},
            {"candidate_id": "live_fast_thin", "scores": {"safety": 0.88, "truth": 0.82, "user_intent": 0.79, "reliability": 0.77, "efficiency": 0.88}, "traits": {"safety_margin": 0.65, "truth_margin": 0.6, "intent_alignment": 0.84, "reliability_margin": 0.7, "efficiency_margin": 0.92}},
        ],
    },
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    spec = load_hierarchy_spec(ROOT / "services" / "homeostasis" / "objective_hierarchy.json")
    compiled = compile_value_hierarchy(spec)
    live_state = build_state_signal_snapshot(
        r7_root=ROOT / "artifacts" / "cortex_roadmap" / "r7_value_homeostasis",
        r9_root=ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain",
    )
    cases = [dict(case, state_snapshot=live_state if case.get("case_id") == "live_state_context_uses_current_signal_profile" else case.get("state_snapshot")) for case in BENCHMARK_CASES]
    benchmark = run_conflict_arbitration_benchmark(compiled, cases, state_snapshot=live_state)
    probe_path = ARTIFACT_DIR / "arbitration_probe_latest.json"
    payload = {
        "generated_at": now_iso(),
        "objective_order": compiled.get("objective_order", []),
        "benchmark": benchmark,
        "gate_pass": bool(benchmark.get("gate_pass")),
    }
    probe_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
