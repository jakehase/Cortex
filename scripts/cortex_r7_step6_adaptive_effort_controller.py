#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.homeostasis.adaptive_effort_controller import run_effort_controller_benchmark

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r7_value_homeostasis" / "step6"

PROTECTIVE = {"smoothed_state_vector": {"urgency": 0.72, "risk_pressure": 0.74, "fatigue": 0.41, "timeout_pressure": 0.33, "error_pressure": 0.66, "budget_pressure": 0.38, "escalation_debt": 0.44}}
CONSERVE = {"smoothed_state_vector": {"urgency": 0.32, "risk_pressure": 0.28, "fatigue": 0.61, "timeout_pressure": 0.59, "error_pressure": 0.21, "budget_pressure": 0.66, "escalation_debt": 0.57}}
NORMAL = {"smoothed_state_vector": {"urgency": 0.24, "risk_pressure": 0.18, "fatigue": 0.28, "timeout_pressure": 0.21, "error_pressure": 0.16, "budget_pressure": 0.26, "escalation_debt": 0.22}}

CASES = [
    {"case_id": "protective_research", "intent": "research", "risk_tier": "high", "state_snapshot": PROTECTIVE, "observed_load": {"token_pressure": 0.55, "depth_pressure": 0.4, "latency_pressure": 0.45}, "expected_mode": "protective", "expected_prefer_chain": "research_grounded", "min_reasoning_depth": 5, "expect_human_review": True, "expect_escalation": True},
    {"case_id": "protective_coding", "intent": "coding", "risk_tier": "critical", "state_snapshot": PROTECTIVE, "observed_load": {"token_pressure": 0.52, "depth_pressure": 0.55, "latency_pressure": 0.42}, "expected_mode": "protective", "expected_prefer_chain": "deliberate_council", "min_reasoning_depth": 5, "expect_human_review": True, "expect_escalation": True},
    {"case_id": "conserve_qa", "intent": "qa", "risk_tier": "low", "state_snapshot": CONSERVE, "observed_load": {"token_pressure": 0.2, "depth_pressure": 0.15, "latency_pressure": 0.18}, "expected_mode": "conserve", "expected_prefer_chain": "fastlane_memory", "max_reasoning_depth": 2, "expect_human_review": False, "expect_escalation": False},
    {"case_id": "conserve_research", "intent": "research", "risk_tier": "medium", "state_snapshot": CONSERVE, "observed_load": {"token_pressure": 0.44, "depth_pressure": 0.3, "latency_pressure": 0.41}, "expected_mode": "conserve", "expected_prefer_chain": "research_grounded", "max_reasoning_depth": 4, "expect_human_review": False, "expect_escalation": False},
    {"case_id": "normal_planning", "intent": "planning", "risk_tier": "medium", "state_snapshot": NORMAL, "observed_load": {"token_pressure": 0.3, "depth_pressure": 0.28, "latency_pressure": 0.22}, "expected_mode": "normal", "expected_prefer_chain": "deliberate_council", "min_reasoning_depth": 4, "expect_human_review": False, "expect_escalation": False},
    {"case_id": "normal_creative", "intent": "creative", "risk_tier": "low", "state_snapshot": NORMAL, "observed_load": {"token_pressure": 0.25, "depth_pressure": 0.2, "latency_pressure": 0.2}, "expected_mode": "normal", "expected_prefer_chain": "creative_fractal", "min_reasoning_depth": 3, "expect_human_review": False, "expect_escalation": False},
    {"case_id": "high_risk_reminder", "intent": "reminder", "risk_tier": "high", "state_snapshot": NORMAL, "observed_load": {"token_pressure": 0.08, "depth_pressure": 0.05, "latency_pressure": 0.08}, "expected_mode": "normal", "expected_prefer_chain": "deliberate_council", "min_reasoning_depth": 2, "expect_human_review": True, "expect_escalation": True},
    {"case_id": "critical_research_overrides_mode", "intent": "research", "risk_tier": "critical", "state_snapshot": NORMAL, "observed_load": {"token_pressure": 0.35, "depth_pressure": 0.3, "latency_pressure": 0.26}, "expected_mode": "normal", "expected_prefer_chain": "research_grounded", "min_reasoning_depth": 5, "expect_human_review": True, "expect_escalation": True},
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    benchmark = run_effort_controller_benchmark(CASES)
    probe_path = ARTIFACT_DIR / "adaptive_effort_probe_latest.json"
    payload = {
        "generated_at": now_iso(),
        "benchmark": benchmark,
        "gate_pass": bool(benchmark.get("gate_pass")),
    }
    probe_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
