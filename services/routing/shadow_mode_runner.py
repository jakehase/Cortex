from __future__ import annotations

from typing import Any, Dict, List

from services.routing.adaptive_router_policy import choose_route
from services.routing.route_feature_pipeline import build_route_features


def run_shadow_mode(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    disagreements = 0
    decisions = []
    for row in rows:
        features = build_route_features(row["query"], risk_flags=row.get("risk_flags") or [])
        selected = choose_route(features)["selected"]["chain_id"]
        live = str(row.get("live_chain") or "fastlane_memory")
        if live != selected:
            disagreements += 1
        decisions.append({"query": row["query"], "live": live, "shadow": selected})
    total = max(1, len(rows))
    return {
        "rows": len(rows),
        "disagreement_rate": round(disagreements / total, 4),
        "decisions": decisions,
    }
