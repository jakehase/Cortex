from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from services.routing._compat import optional_import
from services.routing.adaptive_router_policy import choose_route
from services.routing.route_feature_pipeline import build_route_features


def load_dataset(path: str | Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    p = Path(path)
    with p.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if isinstance(row, dict) and row.get("query"):
                rows.append(row)
    return rows


def _baseline_chain(row: Dict[str, Any]) -> str:
    live = str(row.get("live_chain") or "").strip()
    if live:
        return live
    return "fastlane_memory" if not row.get("risk_flags") else "deliberate_council"


def _bootstrap_evaluate(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    baseline_quality = 0.0
    selected_quality = 0.0
    decisions = []
    for row in rows:
        features = build_route_features(
            row["query"],
            risk_flags=row.get("risk_flags") or [],
            historical_success=float(row.get("historical_success", 0.5)),
        )
        decision = choose_route(features)
        selected = decision["selected"]
        baseline = _baseline_chain(row)
        observed = float(row.get("quality", 0.6))
        baseline_quality += observed
        lift = max(0.0, float(selected.get("estimated_quality", 0.0)) - 0.6) * 0.25
        if selected["chain_id"] != baseline:
            lift -= 0.03
        selected_quality += max(0.0, min(1.0, observed + lift))
        decisions.append(
            {
                "query": row["query"],
                "baseline_chain": baseline,
                "selected_chain": selected["chain_id"],
                "utility": selected["utility"],
            }
        )
    n = len(rows)
    return {
        "success": True,
        "rows": n,
        "baseline_avg_quality": round(baseline_quality / n, 4),
        "adaptive_avg_quality": round(selected_quality / n, 4),
        "quality_delta": round((selected_quality - baseline_quality) / n, 4),
        "decisions": decisions,
    }


def _native_replay(path: Path) -> Dict[str, Any] | None:
    level_optimizer = optional_import("cortex_server.modules.level_optimizer")
    replay_fn = getattr(level_optimizer, "run_counterfactual_replay", None) if level_optimizer else None
    if not callable(replay_fn):
        return None
    result = replay_fn(str(path), limit=500, exploration_seed=41)
    if not result.get("success"):
        return None
    delta = result.get("delta") if isinstance(result.get("delta"), dict) else {}
    result.setdefault("quality_delta", float(delta.get("quality", 0.0) or 0.0))
    result.setdefault("token_delta", int(delta.get("tokens", 0) or 0))
    return result


def evaluate_dataset(path: str | Path) -> Dict[str, Any]:
    rows = load_dataset(path)
    if not rows:
        return {"success": False, "error": "empty_dataset"}
    result = _bootstrap_evaluate(rows)
    native = _native_replay(Path(path))
    if native is not None:
        result["native_replay"] = native
    return result
