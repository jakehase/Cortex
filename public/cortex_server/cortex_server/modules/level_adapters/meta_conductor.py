"""L36 Meta-conductor adapter: cached aggregate health of all levels."""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 36
NAME = "meta_conductor"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 1.0
_MAX_SNAPSHOT_AGE_S = 300.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.modules import level_probe
    from cortex_server.routers.meta_conductor import _aggregate

    app = level_probe.resolve_app(context.get("app") if isinstance(context, Mapping) else None)
    snapshot = level_probe.cached_probe_snapshot(_MAX_SNAPSHOT_AGE_S)
    basis = "in-process probes"
    if snapshot is None:
        if app is None:
            raise ExecutionBlocked("running_app_unavailable")
        level_probe.schedule_probe_refresh(app)
        snapshot = {"available": True, "levels": level_probe.level_mount_states(app), "age_s": None}
        basis = "mount state only (probe snapshot not yet available)"
    aggregate = _aggregate(snapshot)
    degraded = [
        {"level": row["level"], "reason": row.get("reason")}
        for row in aggregate.get("results", [])
        if row.get("state") in {"degraded", "failed"}
    ][:10]
    summary = (
        f"Aggregate Cortex health: {aggregate.get('status')} ({aggregate.get('health_pct')}% of mounted levels healthy; "
        f"basis: {basis}, age {snapshot.get('age_s')} s). "
        f"Degraded/failed: {[d['level'] for d in degraded] or 'none'}. "
        f"Unmounted (not available this deployment): {aggregate.get('unmounted_levels') or 'none'}."
    )
    return {
        "operation": "meta_conductor.health",
        "origin": "deterministic",
        "summary": summary[:1500],
        "data": {
            "overall": aggregate.get("status"),
            "health_pct": aggregate.get("health_pct"),
            "degraded_levels": degraded,
            "unmounted_levels": aggregate.get("unmounted_levels"),
            "snapshot_age_s": snapshot.get("age_s"),
            "basis": basis,
        },
    }
