"""
Level 23: The Cartographer / Mirror — Full System Dashboard & Self-Discovery

Provides a live HTML dashboard showing all 36 Cortex levels with real-time
status checks, plus structured JSON endpoints for system introspection.
"""
from fastapi import APIRouter
from fastapi.responses import HTMLResponse, JSONResponse
from datetime import datetime
from typing import Dict, List, Any
import asyncio
import time
import httpx

router = APIRouter()

# ── Canonical Level Registry ────────────────────────────────────────────────
# Source of truth for the entire Cortex topology.

LEVEL_MAP: Dict[int, Dict[str, Any]] = {
    1:  {"name": "Kernel",       "path": "/kernel",         "category": "Foundation",     "always_on": False},
    2:  {"name": "Ghost",        "path": "/browser",        "category": "Foundation",     "always_on": False},
    3:  {"name": "Parser",       "path": "/parsers",        "category": "Foundation",     "always_on": False},
    4:  {"name": "Lab",          "path": "/lab",            "category": "Foundation",     "always_on": False},
    5:  {"name": "Oracle",       "path": "/oracle",         "category": "Foundation",     "always_on": True},
    6:  {"name": "Bard",         "path": "/bard",           "category": "Foundation",     "always_on": False},
    7:  {"name": "Librarian",    "path": "/librarian",      "category": "Foundation",     "always_on": False},
    8:  {"name": "Cron",         "path": "/cron",           "category": "Foundation",     "always_on": False},
    9:  {"name": "Architect",    "path": "/architect",      "category": "Foundation",     "always_on": False},
    10: {"name": "Listener",     "path": "/listener",       "category": "Foundation",     "always_on": False},
    11: {"name": "Catalyst",     "path": "/catalyst",       "category": "Intelligence",   "always_on": False},
    12: {"name": "Hive",         "path": "/hive",           "category": "Intelligence",   "always_on": False},
    13: {"name": "Dreamer",      "path": "/dreamer",        "category": "Intelligence",   "always_on": False},
    14: {"name": "Chronos",      "path": "/night_shift",    "category": "Intelligence",   "always_on": False},
    15: {"name": "Council",      "path": "/council",        "category": "Intelligence",   "always_on": False},
    16: {"name": "Academy",      "path": "/academy",        "category": "Intelligence",   "always_on": False},
    17: {"name": "Exoskeleton",  "path": "/tools",       "category": "Intelligence",   "always_on": True},
    18: {"name": "Diplomat",     "path": "/diplomat",       "category": "Intelligence",   "always_on": True},
    19: {"name": "Geneticist",   "path": "/geneticist",     "category": "Intelligence",   "always_on": False},
    20: {"name": "Simulator",    "path": "/simulator",      "category": "Metacognition",  "always_on": True},
    21: {"name": "Sentinel",     "path": "/sentinel",       "category": "Metacognition",  "always_on": True},
    22: {"name": "Mnemosyne",    "path": "/knowledge",         "category": "Metacognition",  "always_on": True},
    23: {"name": "Cartographer", "path": "/mirror",         "category": "Metacognition",  "always_on": True},
    24: {"name": "Nexus",        "path": "/nexus",          "category": "Metacognition",  "always_on": True},
    25: {"name": "Bridge",       "path": "/bridge",         "category": "Metacognition",  "always_on": True},
    26: {"name": "Orchestrator", "path": "/orchestrator",      "category": "Metacognition",  "always_on": False},
    27: {"name": "Forge",        "path": "/forge",          "category": "Metacognition",  "always_on": True},
    28: {"name": "Polyglot",     "path": "/polyglot",       "category": "Singularity",    "always_on": False},
    29: {"name": "Muse",         "path": "/muse",           "category": "Singularity",    "always_on": False},
    30: {"name": "Seer",         "path": "/seer",           "category": "Singularity",    "always_on": False},
    31: {"name": "Mediator",     "path": "/mediator",       "category": "Singularity",    "always_on": False},
    32: {"name": "Synthesist",   "path": "/synthesist_api", "category": "Singularity",    "always_on": True},
    33: {"name": "Ethicist",     "path": "/ethicist",       "category": "Singularity",    "always_on": True},
    34: {"name": "Validator",    "path": "/validator",      "category": "Singularity",    "always_on": True},
    35: {"name": "Singularity",  "path": "/singularity",    "category": "Singularity",    "always_on": True},
    36: {"name": "Conductor",    "path": "/meta_conductor", "category": "Singularity",    "always_on": True},
}

BASE_URL = "http://127.0.0.1:8888"

CATEGORY_COLORS = {
    "Foundation":    "#00ff41",
    "Intelligence":  "#00bfff",
    "Metacognition": "#ff6600",
    "Singularity":   "#ff00ff",
}


# ── Helpers ─────────────────────────────────────────────────────────────────

async def _probe_level(client: httpx.AsyncClient, level_num: int, info: Dict) -> Dict[str, Any]:
    """Probe a single level's /status endpoint. Returns structured result."""
    url = f"{BASE_URL}{info['path']}/status"
    start = time.monotonic()
    try:
        resp = await client.get(url, timeout=3.0)
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        if resp.status_code == 200:
            return {
                "level": level_num,
                "name": info["name"],
                "status": "online",
                "response_ms": elapsed_ms,
                "category": info["category"],
            }
        else:
            return {
                "level": level_num,
                "name": info["name"],
                "status": "degraded",
                "response_ms": elapsed_ms,
                "category": info["category"],
                "detail": f"HTTP {resp.status_code}",
            }
    except Exception as exc:
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        return {
            "level": level_num,
            "name": info["name"],
            "status": "offline",
            "response_ms": elapsed_ms,
            "category": info["category"],
            "detail": str(exc)[:120],
        }


async def _probe_all() -> List[Dict[str, Any]]:
    """Probe every level concurrently and return sorted results."""
    async with httpx.AsyncClient() as client:
        tasks = [
            _probe_level(client, num, info)
            for num, info in LEVEL_MAP.items()
        ]
        results = await asyncio.gather(*tasks)
    return sorted(results, key=lambda r: r["level"])


# ── Routes ──────────────────────────────────────────────────────────────────

@router.get("/", response_class=HTMLResponse)
async def get_dashboard():
    """Full HTML dashboard with live status for all 36 levels."""
    results = await _probe_all()

    online = sum(1 for r in results if r["status"] == "online")
    offline = sum(1 for r in results if r["status"] == "offline")
    degraded = sum(1 for r in results if r["status"] == "degraded")

    # Build level cards
    cards_html = ""
    for r in results:
        if r["status"] == "online":
            color = "#00ff41"
            border = "#00ff41"
            glow = "0 0 12px rgba(0,255,65,0.6)"
            label = "ONLINE"
        elif r["status"] == "degraded":
            color = "#ffcc00"
            border = "#ffcc00"
            glow = "0 0 12px rgba(255,204,0,0.6)"
            label = "DEGRADED"
        else:
            color = "#ff0040"
            border = "#441111"
            glow = "none"
            label = "OFFLINE"

        cat_color = CATEGORY_COLORS.get(r["category"], "#888")

        cards_html += f"""
        <div class="card" style="border-color:{border}; box-shadow:{glow};">
            <div class="card-header">
                <span class="level-num" style="color:{color};">L{r['level']:02d}</span>
                <span class="cat-badge" style="background:{cat_color}22; color:{cat_color}; border:1px solid {cat_color}55;">{r['category']}</span>
            </div>
            <div class="level-name">{r['name']}</div>
            <div class="status-row">
                <span class="status-dot" style="background:{color};"></span>
                <span style="color:{color};">{label}</span>
                <span class="latency">{r['response_ms']}ms</span>
            </div>
        </div>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>◈ THE MIRROR — Cortex Level Map ◈</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            background: #0a0a0a;
            color: #ccc;
            font-family: 'Courier New', Courier, monospace;
            min-height: 100vh;
            padding: 30px 20px;
        }}
        body::before {{
            content: "";
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: repeating-linear-gradient(0deg,
                rgba(0,0,0,0.12), rgba(0,0,0,0.12) 1px,
                transparent 1px, transparent 2px);
            pointer-events: none; z-index: 1000;
        }}
        .header {{
            text-align: center; margin-bottom: 30px;
        }}
        .header h1 {{
            font-size: 2.2rem; letter-spacing: 10px; color: #00ff41;
            text-shadow: 0 0 15px #00ff41, 0 0 30px #00ff4155;
        }}
        .summary {{
            display: flex; justify-content: center; gap: 40px;
            margin: 20px 0 30px; font-size: 14px; letter-spacing: 2px;
        }}
        .summary .s-online  {{ color: #00ff41; }}
        .summary .s-degraded {{ color: #ffcc00; }}
        .summary .s-offline  {{ color: #ff0040; }}
        .grid {{
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 16px; max-width: 1600px; margin: 0 auto;
        }}
        .card {{
            background: rgba(0,15,0,0.7);
            border: 1.5px solid #333;
            padding: 16px; border-radius: 6px;
            transition: all 0.3s ease;
        }}
        .card:hover {{
            transform: translateY(-2px);
        }}
        .card-header {{
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 6px;
        }}
        .level-num {{
            font-size: 1.4rem; font-weight: bold;
        }}
        .cat-badge {{
            font-size: 9px; padding: 2px 6px; border-radius: 3px;
            letter-spacing: 1px; text-transform: uppercase;
        }}
        .level-name {{
            font-size: 13px; color: #aaa; margin-bottom: 10px;
            letter-spacing: 2px; text-transform: uppercase;
        }}
        .status-row {{
            display: flex; align-items: center; gap: 8px;
            font-size: 11px; letter-spacing: 1px;
        }}
        .status-dot {{
            width: 8px; height: 8px; border-radius: 50%;
            display: inline-block;
        }}
        .latency {{
            margin-left: auto; color: #666; font-size: 10px;
        }}
        .footer {{
            text-align: center; margin-top: 30px; color: #333;
            font-size: 11px; letter-spacing: 3px;
        }}
        .refresh-btn {{
            display: block; margin: 20px auto;
            background: none; border: 1px solid #00ff41; color: #00ff41;
            padding: 8px 24px; cursor: pointer; font-family: inherit;
            letter-spacing: 2px; font-size: 12px; border-radius: 4px;
        }}
        .refresh-btn:hover {{ background: #00ff4122; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>◈ THE MIRROR ◈</h1>
        <p style="color:#555; letter-spacing:3px; margin-top:8px; font-size:12px;">
            CORTEX SYSTEM MAP — {len(LEVEL_MAP)} LEVELS
        </p>
    </div>
    <div class="summary">
        <span class="s-online">● ONLINE: {online}</span>
        <span class="s-degraded">● DEGRADED: {degraded}</span>
        <span class="s-offline">● OFFLINE: {offline}</span>
    </div>
    <div class="grid">
        {cards_html}
    </div>
    <button class="refresh-btn" onclick="location.reload()">⟳ REFRESH</button>
    <div class="footer">
        ◈ L23 CARTOGRAPHER — GENERATED {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ◈
    </div>
</body>
</html>"""


@router.get("/status")
async def mirror_status(deep: bool = False):
    """L23 status.

    deep=False (default): fast, non-blocking status for health checks.
    deep=True: full per-level probe breakdown.
    """
    if not deep:
        return {
            "success": True,
            "data": {
                "level": 23,
                "name": "Cartographer",
                "status": "active",
                "total_levels": len(LEVEL_MAP),
                "probe_mode": "fast",
                "timestamp": datetime.now().isoformat(),
            },
            "error": None,
        }

    results = await _probe_all()
    online = [r for r in results if r["status"] == "online"]
    offline = [r for r in results if r["status"] == "offline"]
    degraded = [r for r in results if r["status"] == "degraded"]

    return {
        "success": True,
        "data": {
            "level": 23,
            "name": "Cartographer",
            "status": "active",
            "total_levels": len(LEVEL_MAP),
            "online": len(online),
            "offline": len(offline),
            "degraded": len(degraded),
            "levels": results,
            "probe_mode": "deep",
            "timestamp": datetime.now().isoformat(),
        },
        "error": None,
    }


@router.get("/state")
async def mirror_state():
    """Structured JSON state: full probe results + summary."""
    results = await _probe_all()
    online = sum(1 for r in results if r["status"] == "online")
    offline = sum(1 for r in results if r["status"] == "offline")
    degraded = sum(1 for r in results if r["status"] == "degraded")
    return {
        "success": True,
        "data": {
            "summary": {
                "total": len(results),
                "online": online,
                "offline": offline,
                "degraded": degraded,
            },
            "levels": results,
        },
        "error": None,
        "timestamp": datetime.now().isoformat(),
    }


@router.get("/map")
async def level_map():
    """Complete level map as structured JSON with live reachability."""
    results = await _probe_all()
    reachability = {r["level"]: r["status"] for r in results}

    levels = []
    for num, info in sorted(LEVEL_MAP.items()):
        levels.append({
            "level": num,
            "name": info["name"],
            "router_path": info["path"],
            "category": info["category"],
            "always_on": info["always_on"],
            "reachable": reachability.get(num, "unknown"),
        })

    return {
        "success": True,
        "total": len(levels),
        "levels": levels,
        "generated_at": datetime.now().isoformat(),
    }
