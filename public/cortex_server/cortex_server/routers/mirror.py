"""
Level 23: The Cartographer / Mirror — measured system map and topology.

Availability is measured in-process (``modules.level_probe``): each level's
mount state comes from the running app's route table and router load report,
and its canonical status handler is invoked directly through its route object
— no unauthenticated HTTP self-calls, so auth denials can no longer masquerade
as "degraded" levels. Results are cached with timestamps; ``/mirror/status``
reports the age of the last map instead of a hard-coded "active".
"""
from datetime import datetime
from html import escape
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from cortex_server.modules import level_probe
from cortex_server.modules.cartographer import build_topology
from cortex_server.modules.level_registry import (
    LEVEL_REGISTRY_VERSION,
    get_level_registry,
)

router = APIRouter()

# ── Canonical Level Registry ────────────────────────────────────────────────

LEVEL_MAP: Dict[int, Dict[str, Any]] = {
    int(row["level"]): {**row, "path": row["route_prefix"]}
    for row in get_level_registry()
}

MAP_TTL_S = 30.0
MAP_STALE_AFTER_S = 300.0

STATUS_COLORS = {
    "online": "#00ff41",
    "restricted": "#00bfff",
    "degraded": "#ffcc00",
    "unmounted": "#8a8a8a",
    "failed": "#ff0040",
    "unknown": "#666666",
}


def _summary(levels: List[Dict[str, Any]]) -> Dict[str, int]:
    counts: Dict[str, int] = {"total": len(levels)}
    for row in levels:
        key = str(row.get("status") or "unknown")
        counts[key] = counts.get(key, 0) + 1
    return counts


def _compact(row: Dict[str, Any]) -> Dict[str, Any]:
    probe = row.get("probe") or {}
    return {
        "level": row["level"],
        "name": row["name"],
        "category": LEVEL_MAP.get(row["level"], {}).get("category"),
        "status": row["status"],
        "reason": row.get("reason"),
        "mount": row.get("mount"),
        "router_module": row.get("router_module"),
        "canonical_status": row.get("canonical_status"),
        "canonical_status_mounted": row.get("canonical_status_mounted"),
        "mounted_route_count": row.get("mounted_route_count"),
        "probe": {
            "outcome": probe.get("outcome"),
            "status_code": probe.get("status_code"),
            "latency_ms": probe.get("latency_ms"),
            "reported_status": probe.get("reported_status"),
        },
    }


async def _fresh_map(request: Request, max_age_s: float = MAP_TTL_S) -> Optional[Dict[str, Any]]:
    level_probe.remember_app(request.app)
    return await level_probe.refresh_probe_snapshot(request.app, max_age_s=max_age_s)


# ── Routes ──────────────────────────────────────────────────────────────────

@router.get("/", response_class=HTMLResponse)
async def get_dashboard(request: Request):
    """HTML dashboard rendered from the measured (cached) level map."""
    snapshot = await _fresh_map(request) or {"levels": []}
    levels = snapshot.get("levels") or []
    counts = _summary(levels)

    cards_html = ""
    for row in levels:
        status = str(row.get("status") or "unknown")
        color = STATUS_COLORS.get(status, "#666666")
        probe = row.get("probe") or {}
        latency = probe.get("latency_ms")
        cards_html += f"""
        <div class="card" style="border-color:{color};">
            <div class="card-header">
                <span class="level-num" style="color:{color};">L{int(row['level']):02d}</span>
                <span class="cat-badge">{escape(str(row.get('mount') or ''))}</span>
            </div>
            <div class="level-name">{escape(str(row.get('name') or ''))}</div>
            <div class="status-row">
                <span class="status-dot" style="background:{color};"></span>
                <span style="color:{color};">{escape(status.upper())}</span>
                <span class="latency">{escape(str(latency)) + 'ms' if latency is not None else escape(str(row.get('reason') or ''))}</span>
            </div>
        </div>"""

    summary_html = " ".join(
        f'<span style="color:{STATUS_COLORS.get(key, "#888")}">● {escape(key.upper())}: {value}</span>'
        for key, value in counts.items()
        if key != "total"
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>THE MIRROR — Cortex Level Map</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ background: #0a0a0a; color: #ccc; font-family: 'Courier New', Courier, monospace; padding: 30px 20px; }}
        .header {{ text-align: center; margin-bottom: 20px; }}
        .header h1 {{ font-size: 2rem; letter-spacing: 8px; color: #00ff41; }}
        .summary {{ display: flex; flex-wrap: wrap; justify-content: center; gap: 24px; margin: 16px 0 24px; font-size: 13px; }}
        .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; max-width: 1600px; margin: 0 auto; }}
        .card {{ background: rgba(0,15,0,0.7); border: 1.5px solid #333; padding: 14px; border-radius: 6px; }}
        .card-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }}
        .level-num {{ font-size: 1.3rem; font-weight: bold; }}
        .cat-badge {{ font-size: 9px; padding: 2px 6px; border-radius: 3px; color: #999; border: 1px solid #444; }}
        .level-name {{ font-size: 12px; color: #aaa; margin-bottom: 8px; text-transform: uppercase; }}
        .status-row {{ display: flex; align-items: center; gap: 8px; font-size: 11px; }}
        .status-dot {{ width: 8px; height: 8px; border-radius: 50%; display: inline-block; }}
        .latency {{ margin-left: auto; color: #666; font-size: 10px; }}
        .footer {{ text-align: center; margin-top: 24px; color: #444; font-size: 11px; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>THE MIRROR</h1>
        <p style="color:#555; margin-top:8px; font-size:12px;">CORTEX SYSTEM MAP — {len(LEVEL_MAP)} LEVELS — IN-PROCESS PROBES</p>
    </div>
    <div class="summary">{summary_html}</div>
    <div class="grid">{cards_html}</div>
    <div class="footer">L23 CARTOGRAPHER — MEASURED {escape(str(snapshot.get('measured_at') or 'never'))} (age {escape(str(snapshot.get('age_s')))}s)</div>
</body>
</html>"""


@router.get("/status")
async def mirror_status(request: Request, deep: bool = False):
    """L23 status derived from the freshness of the last measured map.

    deep=False (default): cached summary only (a background refresh is
    scheduled when stale). deep=True: refresh now and include per-level rows.
    """
    level_probe.remember_app(request.app)
    if deep:
        snapshot = await _fresh_map(request, max_age_s=5.0)
    else:
        snapshot = level_probe.cached_probe_snapshot(None)
        level_probe.schedule_probe_refresh(request.app, max_age_s=MAP_TTL_S)
    age = snapshot.get("age_s") if snapshot else None
    if snapshot is None and level_probe.refresh_in_progress():
        # The first map is being measured right now (this handler may itself
        # be one of the probes); report that rather than a failure.
        status, success = "measuring", True
    elif snapshot is None or not snapshot.get("available", True):
        status, success = "no_map", False
    elif age is not None and age > MAP_STALE_AFTER_S:
        status, success = "stale", False
    else:
        status, success = "active", True
    levels = (snapshot or {}).get("levels") or []
    data: Dict[str, Any] = {
        "level": 23,
        "name": "Cartographer",
        "status": status,
        "total_levels": len(LEVEL_MAP),
        "registry_version": LEVEL_REGISTRY_VERSION,
        "map_measured_at": (snapshot or {}).get("measured_at"),
        "map_age_s": age,
        "map_stale_after_s": MAP_STALE_AFTER_S,
        "probe_mode": "in_process_route_handler",
        "summary": _summary(levels) if levels else None,
        "timestamp": datetime.now().isoformat(),
    }
    if deep:
        data["levels"] = [_compact(row) for row in levels]
    return {"success": success, "status": status, "data": data, "error": None if success else status}


@router.get("/state")
async def mirror_state(request: Request):
    """Structured JSON state: measured per-level availability + summary."""
    snapshot = await _fresh_map(request)
    levels = (snapshot or {}).get("levels") or []
    return {
        "success": bool(snapshot and snapshot.get("available", True)),
        "data": {
            "summary": _summary(levels),
            "levels": [_compact(row) for row in levels],
            "measured_at": (snapshot or {}).get("measured_at"),
            "map_age_s": (snapshot or {}).get("age_s"),
        },
        "error": None if snapshot else "app_unavailable",
        "timestamp": datetime.now().isoformat(),
    }


@router.get("/map")
async def level_map(request: Request):
    """Complete level map: registry identity + mount state + measured availability."""
    snapshot = await _fresh_map(request)
    by_level = {row["level"]: row for row in (snapshot or {}).get("levels") or []}

    levels = []
    for num, info in sorted(LEVEL_MAP.items()):
        observed = by_level.get(num, {})
        levels.append({
            "level": num,
            "name": info["name"],
            "router_path": info["path"],
            "category": info["category"],
            "always_on": info["always_on"],
            "status": observed.get("status", "unknown"),
            "mount": observed.get("mount"),
            "mounted_routes": observed.get("mounted_routes", []),
            "probe_outcome": (observed.get("probe") or {}).get("outcome"),
            # Legacy field: now the measured status rather than an HTTP guess.
            "reachable": observed.get("status", "unknown"),
        })

    return {
        "success": bool(snapshot and snapshot.get("available", True)),
        "total": len(levels),
        "registry_version": LEVEL_REGISTRY_VERSION,
        "measured_at": (snapshot or {}).get("measured_at"),
        "map_age_s": (snapshot or {}).get("age_s"),
        "levels": levels,
        "generated_at": datetime.now().isoformat(),
    }


@router.get("/topology")
async def topology(request: Request):
    """Nodes (levels + external dependencies) and source-evidenced edges."""
    snapshot = await _fresh_map(request)
    graph = build_topology(probe_snapshot=snapshot)
    return {
        "success": True,
        "registry_version": LEVEL_REGISTRY_VERSION,
        "availability_measured_at": (snapshot or {}).get("measured_at"),
        **graph,
    }
