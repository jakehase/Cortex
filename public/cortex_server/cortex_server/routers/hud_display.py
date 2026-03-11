"""
HUD Display Router — Live level-activation display

Pulls real state from the middleware's recent-activation store and from
the always-on list so the HUD always reflects what's actually happening.
"""
from fastapi import APIRouter, Request
from datetime import datetime
from typing import List, Dict

router = APIRouter()

# Canonical always-on levels
ALWAYS_ON_LEVELS = [5, 17, 18, 20, 21, 22, 23, 24, 25, 27, 32, 33, 34, 35, 36]

LEVEL_NAMES = {
    1: "Kernel", 2: "Ghost", 3: "Parser", 4: "Lab", 5: "Oracle",
    6: "Bard", 7: "Librarian", 8: "Cron", 9: "Architect", 10: "Listener",
    11: "Catalyst", 12: "Hive", 13: "Dreamer", 14: "Chronos", 15: "Council",
    16: "Academy", 17: "Exoskeleton", 18: "Diplomat", 19: "Geneticist", 20: "Simulator",
    21: "Ouroboros", 22: "Mnemosyne", 23: "Cartographer", 24: "Nexus", 25: "Bridge",
    26: "Orchestrator", 27: "Forge", 28: "Polyglot", 29: "Muse", 30: "Seer",
    31: "Mediator", 32: "Synthesist", 33: "Ethicist", 34: "Validator", 35: "Singularity",
    36: "Conductor",
}


def _format_hud(always_on: List[int], activated: List[Dict]) -> str:
    """Build the ASCII HUD box."""
    lines = [
        "╔══════════════════════════════════════════════════════════╗",
        "║     ◈ THE CORTEX — ACTIVE LEVELS ◈                      ║",
        "╠══════════════════════════════════════════════════════════╣",
    ]

    # Always-on row(s) — up to 2 lines
    ao_tags = [f"L{l}" for l in always_on]
    row1 = ", ".join(ao_tags[:8])
    lines.append(f"║  ALWAYS ON: {row1:<45}║")
    if len(ao_tags) > 8:
        row2 = ", ".join(ao_tags[8:])
        lines.append(f"║             {row2:<45}║")

    # Dynamically activated (non-always-on)
    extra = [a for a in activated if a["level"] not in set(always_on)]
    if extra:
        tags = [f"L{a['level']} ({a['name']})" for a in extra[:8]]
        act_str = ", ".join(tags)
        lines.append(f"║  ACTIVATED: {act_str:<45}║")
    else:
        lines.append("║  ACTIVATED: —                                            ║")

    lines.append("║                                                          ║")
    lines.append("╚══════════════════════════════════════════════════════════╝")
    return "\n".join(lines)


@router.get("/status")
async def hud_status():
    """HUD subsystem status."""
    return {
        "success": True,
        "name": "HUD Display",
        "status": "active",
        "always_on_count": len(ALWAYS_ON_LEVELS),
        "capabilities": [
            "level_visualization",
            "ascii_display",
            "activation_tracking",
            "recent_history",
        ],
    }


@router.get("/display")
async def get_hud_display():
    """Get live HUD — pulls recent activations from middleware store."""
    from cortex_server.middleware.hud_middleware import get_unique_recent_levels

    recent = get_unique_recent_levels(seconds=300)  # last 5 min

    return {
        "success": True,
        "hud": _format_hud(ALWAYS_ON_LEVELS, recent),
        "always_on": ALWAYS_ON_LEVELS,
        "recently_activated": [
            {"level": a["level"], "name": a["name"], "timestamp": a.get("timestamp")}
            for a in recent
        ],
        "total_levels": 36,
        "timestamp": datetime.now().isoformat(),
    }


@router.get("/history")
async def hud_history(seconds: int = 300):
    """Get raw activation history for the last N seconds (default 5 min)."""
    from cortex_server.middleware.hud_middleware import get_recent_activations

    activations = get_recent_activations(seconds=seconds)
    return {
        "success": True,
        "window_seconds": seconds,
        "total": len(activations),
        "activations": activations,
        "history": activations,
    }




@router.get("/traces")
async def hud_traces(seconds: int = 300):
    """Get per-request activation traces (groups of levels activated together)."""
    try:
        from cortex_server.middleware.hud_middleware import get_recent_traces
        traces = get_recent_traces(seconds=seconds)
        return {
            "success": True,
            "window_seconds": seconds,
            "total": len(traces),
            "traces": traces,
        }
    except Exception as e:
        return {
            "success": True,
            "window_seconds": seconds,
            "total": 0,
            "traces": [],
            "degraded": True,
            "error": str(e),
        }
@router.post("/track")
async def track_activation(request: Request):
    """Manually register level activations (for external callers)."""
    from cortex_server.middleware.hud_middleware import track_level

    payload = await request.json()
    levels = payload if isinstance(payload, list) else payload.get("levels", [])
    tracked = []
    for lvl in levels:
        num = lvl if isinstance(lvl, int) else lvl.get("level")
        name = LEVEL_NAMES.get(num, "Unknown") if isinstance(lvl, int) else lvl.get("name", LEVEL_NAMES.get(num, "Unknown"))
        is_ao = num in set(ALWAYS_ON_LEVELS)
        track_level(request, num, name, always_on=is_ao)
        tracked.append({"level": num, "name": name})

    return {
        "success": True,
        "tracked": tracked,
        "hud": _format_hud(ALWAYS_ON_LEVELS, tracked),
    }


@router.get("/activation_history")
async def hud_activation_history(seconds: int = 300, hours: int = 0):
    """Backward-compatible alias for /history used by legacy watchdogs."""
    from cortex_server.middleware.hud_middleware import get_recent_activations

    sec = max(1, int(seconds))
    if hours and hours > 0:
        sec = max(sec, int(hours) * 3600)

    activations = get_recent_activations(seconds=sec)
    return {
        "success": True,
        "window_seconds": sec,
        "total": len(activations),
        "activations": activations,
        "history": activations,
    }
