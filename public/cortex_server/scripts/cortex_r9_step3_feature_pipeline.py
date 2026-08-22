#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.routing.route_feature_pipeline import build_route_features

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step3"
DATASET_PATH = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step1" / "baseline_telemetry_dataset_latest.jsonl"

EXTRA_CASES = [
    {"query": "Plan a migration roadmap for the API gateway", "risk_flags": []},
    {"query": "Remind me in 20 minutes to check the deploy", "risk_flags": []},
]

REQUIRED_FIELDS = [
    "intent",
    "archetype",
    "risk_tier",
    "route_taxonomy_version",
    "allowed_chain_ids",
    "complexity",
    "uncertainty",
    "urgency",
    "route_context",
]

REQUIRED_ROUTE_CONTEXT_FIELDS = [
    "latency_plan",
    "runtime_policy",
    "outcome_hint",
    "health",
    "prefetch_enabled",
    "cheap_route",
    "budget_pressure_after_ms",
    "timeout_pressure",
    "recent_level_efficacy",
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
    rows = load_rows()
    features = [build_route_features(row["query"], risk_flags=row.get("risk_flags") or [], historical_success=float(row.get("historical_success", 0.5))) for row in rows]
    field_missing = []
    route_context_missing = []
    for index, feature in enumerate(features):
        missing = [name for name in REQUIRED_FIELDS if name not in feature]
        if missing:
            field_missing.append({"row": index, "missing": missing})
        route_context = feature.get("route_context") if isinstance(feature.get("route_context"), dict) else {}
        missing_context = [name for name in REQUIRED_ROUTE_CONTEXT_FIELDS if name not in route_context]
        if missing_context:
            route_context_missing.append({"row": index, "missing": missing_context})
    payload = {
        "generated_at": now_iso(),
        "row_count": len(features),
        "required_fields_present": not field_missing,
        "required_route_context_fields_present": not route_context_missing,
        "field_missing": field_missing,
        "route_context_missing": route_context_missing,
        "uses_cortex_classifier_ratio": round(sum(1 for feature in features if feature.get("uses_cortex_classifier")) / max(1, len(features)), 4),
        "intent_distribution": {
            intent: sum(1 for feature in features if feature.get("intent") == intent)
            for intent in sorted({feature.get("intent") for feature in features})
        },
        "drift_checks": {
            "complexity_in_range": all(0.0 <= float(feature.get("complexity", 0.0)) <= 1.0 for feature in features),
            "uncertainty_in_range": all(0.0 <= float(feature.get("uncertainty", 0.0)) <= 1.0 for feature in features),
            "urgency_in_range": all(0.0 <= float(feature.get("urgency", 0.0)) <= 1.0 for feature in features),
            "all_have_allowed_chain_ids": all(bool(feature.get("allowed_chain_ids")) for feature in features),
        },
        "sample_rows": features[:4],
    }
    (ARTIFACT_DIR / "feature_probe_latest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
