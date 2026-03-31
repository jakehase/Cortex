#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.homeostasis.artifact_paths import resolve_r7_root
from services.homeostasis.safety_envelope_overrides import run_safety_override_drills

R7_ROOT = resolve_r7_root()
ARTIFACT_DIR = R7_ROOT / "step7"

PROTECTIVE_BAD = {"smoothed_state_vector": {"urgency": 0.74, "risk_pressure": 0.77, "fatigue": 0.42, "timeout_pressure": 0.35, "error_pressure": 0.69, "budget_pressure": 0.38, "escalation_debt": 0.46}, "signal_health": {"anomaly_tags": ["dependency_degraded", "runtime_health_warning"]}}
PROTECTIVE_SOFT = {"smoothed_state_vector": {"urgency": 0.63, "risk_pressure": 0.62, "fatigue": 0.38, "timeout_pressure": 0.61, "error_pressure": 0.41, "budget_pressure": 0.35, "escalation_debt": 0.49}, "signal_health": {"anomaly_tags": ["dependency_degraded"]}}
NORMAL_CLEAN = {"smoothed_state_vector": {"urgency": 0.24, "risk_pressure": 0.18, "fatigue": 0.28, "timeout_pressure": 0.21, "error_pressure": 0.16, "budget_pressure": 0.26, "escalation_debt": 0.22}, "signal_health": {"anomaly_tags": []}}

CASES = [
    {"case_id": "critical_freeze", "intent": "coding", "risk_tier": "critical", "state_snapshot": PROTECTIVE_BAD, "incident_flags": ["external_side_effect"], "expected_mode": "emergency_freeze", "expect_block_side_effects": True, "expect_manual_ack": True, "max_reasoning_depth": 3},
    {"case_id": "explicit_freeze_flag", "intent": "research", "risk_tier": "high", "state_snapshot": PROTECTIVE_SOFT, "incident_flags": ["emergency_freeze"], "expected_mode": "emergency_freeze", "expect_block_side_effects": True, "expect_manual_ack": True, "max_reasoning_depth": 3},
    {"case_id": "fallback_on_timeout_and_dependency", "intent": "planning", "risk_tier": "high", "state_snapshot": PROTECTIVE_SOFT, "incident_flags": [], "expected_mode": "baseline_safe_fallback", "expect_block_side_effects": True, "expect_manual_ack": True, "max_reasoning_depth": 4},
    {"case_id": "elevated_review_high_risk", "intent": "reminder", "risk_tier": "high", "state_snapshot": NORMAL_CLEAN, "incident_flags": [], "expected_mode": "elevated_review", "expect_block_side_effects": True, "expect_manual_ack": True, "max_reasoning_depth": 3},
    {"case_id": "normal_low_risk", "intent": "qa", "risk_tier": "low", "state_snapshot": NORMAL_CLEAN, "incident_flags": [], "expected_mode": "normal", "expect_block_side_effects": False, "expect_manual_ack": False, "max_reasoning_depth": 3},
    {"case_id": "rollback_flag_forces_fallback", "intent": "research", "risk_tier": "medium", "state_snapshot": PROTECTIVE_SOFT, "incident_flags": ["rollback_required"], "expected_mode": "baseline_safe_fallback", "expect_block_side_effects": True, "expect_manual_ack": True, "max_reasoning_depth": 4},
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    benchmark = run_safety_override_drills(CASES)
    probe_path = ARTIFACT_DIR / "safety_override_probe_latest.json"
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
