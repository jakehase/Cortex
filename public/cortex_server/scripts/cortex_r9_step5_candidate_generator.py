#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.routing.chain_candidate_generator import generate_candidates, validate_candidate_constraints
from services.routing.route_feature_pipeline import build_route_features

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step5"

CASES = [
    {"query": "Explain TCP in one paragraph", "risk_flags": []},
    {"query": "Fix this pytest failure in orchestrator runtime analytics", "risk_flags": ["code_change"]},
    {"query": "Plan a migration roadmap for the API gateway", "risk_flags": []},
    {"query": "Research the latest outage status with sources", "risk_flags": ["live_state"]},
    {"query": "Brainstorm novel product ideas unrelated to memory", "risk_flags": []},
    {"query": "Remind me in 20 minutes to check the deploy", "risk_flags": []},
    {"query": "Implement a security change in production auth flow", "risk_flags": ["security_change"]},
    {"query": "Draft creative branding for a bank product", "risk_flags": ["financial"]},
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for case in CASES:
        features = build_route_features(case["query"], risk_flags=case.get("risk_flags") or [], historical_success=0.65)
        candidates = generate_candidates(features)
        validation = validate_candidate_constraints(features, candidates)
        rows.append(
            {
                "query": case["query"],
                "intent": features["intent"],
                "risk_tier": features["risk_tier"],
                "default_chain": features["default_chain"],
                "candidate_chain_ids": [row["chain_id"] for row in candidates],
                "validation": validation,
            }
        )
    payload = {
        "generated_at": now_iso(),
        "case_count": len(rows),
        "total_candidates": sum(len(row["candidate_chain_ids"]) for row in rows),
        "all_constraints_valid": all(bool(row["validation"]["valid"]) for row in rows),
        "rows": rows,
    }
    (ARTIFACT_DIR / "chain_probe_latest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
