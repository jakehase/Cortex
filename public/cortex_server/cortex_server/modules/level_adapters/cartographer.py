"""L23 Cartographer adapter: measured level map (cached probes or mount state)."""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 23
NAME = "cartographer"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 1.0
_MAX_PROBE_AGE_S = 300.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.modules import level_probe

    app = level_probe.resolve_app(context.get("app") if isinstance(context, Mapping) else None)
    if app is None:
        raise ExecutionBlocked("running_app_unavailable")
    snapshot = level_probe.cached_probe_snapshot(_MAX_PROBE_AGE_S)
    if snapshot is not None:
        rows = snapshot.get("levels") or []
        basis = f"in-process probes {snapshot.get('age_s')} s old"
    else:
        rows = level_probe.level_mount_states(app)
        basis = "mount state only (no fresh probe snapshot)"
        level_probe.schedule_probe_refresh(app)

    by_status: Dict[str, list] = {}
    for row in rows:
        by_status.setdefault(str(row.get("status")), []).append(int(row["level"]))
    unavailable = sorted(by_status.get("unmounted", []) + by_status.get("failed", []))
    degraded = sorted(by_status.get("degraded", []))
    restricted = sorted(by_status.get("restricted", []))
    summary = (
        f"Cortex level map ({basis}): {len(by_status.get('online', []))} online, "
        f"restricted {restricted or 'none'}, degraded {degraded or 'none'}, "
        f"unavailable {unavailable or 'none'}. Do not claim a capability from an unavailable or degraded level."
    )
    return {
        "operation": "cartographer.map",
        "origin": "deterministic",
        "summary": summary[:1500],
        "data": {
            "basis": basis,
            "levels": [
                {
                    "level": row["level"],
                    "status": row.get("status"),
                    "mount": row.get("mount"),
                    "probe": (row.get("probe") or {}).get("outcome"),
                }
                for row in rows
            ],
            "unavailable": unavailable,
            "degraded": degraded,
            "restricted": restricted,
        },
    }
