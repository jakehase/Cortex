#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.routing.adaptive_router_policy import choose_route
from services.routing.route_feature_pipeline import build_route_features
from services.routing.route_taxonomy import canonical_route_taxonomy, validate_route

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step2"
DATASET_PATH = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step1" / "baseline_telemetry_dataset_latest.jsonl"

EXTRA_CASES = [
    {"query": "Plan a migration roadmap for the API gateway", "risk_flags": []},
    {"query": "Remind me in 20 minutes to check the deploy", "risk_flags": []},
    {"query": "Research the latest outage status with sources", "risk_flags": ["live_state"]},
    {"query": "Implement a security change in production auth flow", "risk_flags": ["security_change"]},
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_rows():
    rows = []
    if DATASET_PATH.exists():
        rows.extend(json.loads(line) for line in DATASET_PATH.read_text(encoding="utf-8").splitlines() if line.strip())
    rows.extend(EXTRA_CASES)
    return rows


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    schema = canonical_route_taxonomy()
    rows = load_rows()
    validations = []
    intents_seen = set()
    for row in rows:
        features = build_route_features(row["query"], risk_flags=row.get("risk_flags") or [], historical_success=float(row.get("historical_success", 0.5)))
        choice = choose_route(features)
        check = validate_route(features["intent"], choice["selected"]["chain_id"], risk_tier=features["risk_tier"])
        validations.append(
            {
                "query": row["query"],
                "intent": features["intent"],
                "risk_tier": features["risk_tier"],
                "selected_chain": choice["selected"]["chain_id"],
                "allowed_chains": check["allowed_chains"],
                "valid": check["valid"],
            }
        )
        intents_seen.add(features["intent"])
    payload = {
        "generated_at": now_iso(),
        "taxonomy_version": schema["version"],
        "case_count": len(validations),
        "intents_seen": sorted(intents_seen),
        "all_routes_taxonomy_compliant": all(bool(row["valid"]) for row in validations),
        "validation_rows": validations,
    }
    (ARTIFACT_DIR / "route_taxonomy_schema_latest.json").write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    (ARTIFACT_DIR / "route_taxonomy_validation_latest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
