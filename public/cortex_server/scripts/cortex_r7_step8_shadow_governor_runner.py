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
from services.homeostasis.shadow_governor_runner import run_shadow_governor

R7_ROOT = resolve_r7_root()
ARTIFACT_DIR = R7_ROOT / "step8"

PROTECTIVE_BAD = {"smoothed_state_vector": {"urgency": 0.74, "risk_pressure": 0.77, "fatigue": 0.42, "timeout_pressure": 0.35, "error_pressure": 0.69, "budget_pressure": 0.38, "escalation_debt": 0.46}, "signal_health": {"anomaly_tags": ["dependency_degraded", "runtime_health_warning"]}}
PROTECTIVE_SOFT = {"smoothed_state_vector": {"urgency": 0.63, "risk_pressure": 0.62, "fatigue": 0.38, "timeout_pressure": 0.61, "error_pressure": 0.41, "budget_pressure": 0.35, "escalation_debt": 0.49}, "signal_health": {"anomaly_tags": ["dependency_degraded"]}}
CONSERVE = {"smoothed_state_vector": {"urgency": 0.32, "risk_pressure": 0.28, "fatigue": 0.61, "timeout_pressure": 0.59, "error_pressure": 0.21, "budget_pressure": 0.66, "escalation_debt": 0.57}, "signal_health": {"anomaly_tags": []}}
NORMAL = {"smoothed_state_vector": {"urgency": 0.24, "risk_pressure": 0.18, "fatigue": 0.28, "timeout_pressure": 0.21, "error_pressure": 0.16, "budget_pressure": 0.26, "escalation_debt": 0.22}, "signal_health": {"anomaly_tags": []}}

CASES = [
    {"case_id": "critical_code_incident", "intent": "coding", "risk_tier": "critical", "state_snapshot": PROTECTIVE_BAD, "incident_flags": ["external_side_effect"]},
    {"case_id": "high_research_dependency_issue", "intent": "research", "risk_tier": "high", "state_snapshot": PROTECTIVE_SOFT, "incident_flags": []},
    {"case_id": "normal_qa", "intent": "qa", "risk_tier": "low", "state_snapshot": NORMAL, "incident_flags": []},
    {"case_id": "conserve_research", "intent": "research", "risk_tier": "medium", "state_snapshot": CONSERVE, "incident_flags": []},
    {"case_id": "creative_normal", "intent": "creative", "risk_tier": "low", "state_snapshot": NORMAL, "incident_flags": []},
    {"case_id": "high_reminder", "intent": "reminder", "risk_tier": "high", "state_snapshot": NORMAL, "incident_flags": []},
    {"case_id": "rollback_research", "intent": "research", "risk_tier": "medium", "state_snapshot": PROTECTIVE_SOFT, "incident_flags": ["rollback_required"]},
    {"case_id": "planning_medium", "intent": "planning", "risk_tier": "medium", "state_snapshot": NORMAL, "incident_flags": []},
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    shadow = run_shadow_governor(CASES)
    probe_path = ARTIFACT_DIR / "shadow_governor_probe_latest.json"
    payload = {
        "generated_at": now_iso(),
        "shadow": shadow,
        "gate_pass": bool(shadow.get("gate_pass")),
    }
    probe_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
