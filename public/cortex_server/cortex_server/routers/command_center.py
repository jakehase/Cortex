"""Command Center Router - Premium sci-fi connectome HUD.

Mass Effect-grade visual command center (Option B):
- Connectome mesh with stable kNN links driven by real co-activation traces
  from /hud_display/traces (fallback: /command_center/state synthetic)
- Faint aesthetic wiring layer (low-opacity long-range links)
- Traveling pulses + persistent afterglow on edges
- Premium UI polish: restrained palette + angular glass panels
- Safe controls panel (POST /command_center/action):
    - status_sweep (GET /health, /conductor/status, /oracle/status)
    - orchestrator_list (GET /conductor/workflows)
    - ping_oracle (GET /oracle/status)

Endpoints:
- GET  /command_center/              -> HTML HUD (alias: /command_center/ui)
- GET  /command_center/ui           -> HTML HUD
- GET  /command_center/three.min.js  -> local Three.js build
- GET  /command_center/state         -> lightweight synthetic activity feed (fallback)
- POST /command_center/action        -> safe non-destructive actions

Notes:
- No external CDN. Three.js is served from routers/_assets/three.min.js
- Avoid heavy postprocessing; visuals rely on palette + additive blending.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from pydantic import BaseModel
from pathlib import Path
from typing import Any, Dict, Optional
import random
import time

import httpx

router = APIRouter()

_ASSETS_DIR = Path(__file__).parent / "_assets"
_THREE_PATH = _ASSETS_DIR / "three.min.js"


# 37-level naming map (1..37). Used by /command_center/ui.
LEVEL_NAMES = {
  "1": {
    "name": "kernel",
    "layer": "Foundation",
    "purpose": "System core"
  },
  "2": {
    "name": "ghost",
    "layer": "Foundation",
    "purpose": "External intelligence (web search/browse)"
  },
  "3": {
    "name": "hive",
    "layer": "Foundation",
    "purpose": "Parallelism / distributed execution"
  },
  "4": {
    "name": "lab",
    "layer": "Foundation",
    "purpose": "Code execution"
  },
  "5": {
    "name": "oracle",
    "layer": "Foundation",
    "purpose": "Reasoning / analysis"
  },
  "6": {
    "name": "bard",
    "layer": "Foundation",
    "purpose": "Writing / TTS"
  },
  "7": {
    "name": "librarian",
    "layer": "Foundation",
    "purpose": "Memory / recall"
  },
  "8": {
    "name": "sentinel",
    "layer": "Foundation",
    "purpose": "Security"
  },
  "9": {
    "name": "architect",
    "layer": "Foundation",
    "purpose": "System design"
  },
  "10": {
    "name": "listener",
    "layer": "Foundation",
    "purpose": "Intent recognition"
  },
  "11": {
    "name": "catalyst",
    "layer": "Intelligence",
    "purpose": "Optimization"
  },
  "12": {
    "name": "darwin",
    "layer": "Intelligence",
    "purpose": "Evolution / adaptation"
  },
  "13": {
    "name": "dreamer",
    "layer": "Intelligence",
    "purpose": "Creativity / scenarios"
  },
  "14": {
    "name": "chronos",
    "layer": "Intelligence",
    "purpose": "Scheduling"
  },
  "15": {
    "name": "council",
    "layer": "Intelligence",
    "purpose": "Multi-perspective critique"
  },
  "16": {
    "name": "academy",
    "layer": "Intelligence",
    "purpose": "Training / patterns"
  },
  "17": {
    "name": "exoskeleton",
    "layer": "Intelligence",
    "purpose": "Tool integration"
  },
  "18": {
    "name": "diplomat",
    "layer": "Intelligence",
    "purpose": "Messaging / comms"
  },
  "19": {
    "name": "geneticist",
    "layer": "Intelligence",
    "purpose": "Solution optimization"
  },
  "20": {
    "name": "simulator",
    "layer": "Intelligence",
    "purpose": "What-if simulation"
  },
  "21": {
    "name": "ouroboros",
    "layer": "Meta",
    "purpose": "Self-monitoring"
  },
  "22": {
    "name": "mnemosyne",
    "layer": "Meta",
    "purpose": "Long-term memory"
  },
  "23": {
    "name": "cartographer",
    "layer": "Meta",
    "purpose": "Self-mapping"
  },
  "24": {
    "name": "nexus",
    "layer": "Meta",
    "purpose": "Orchestration"
  },
  "25": {
    "name": "bridge",
    "layer": "Meta",
    "purpose": "External AI federation"
  },
  "26": {
    "name": "conductor",
    "layer": "Meta",
    "purpose": "Workflow orchestration"
  },
  "27": {
    "name": "forge",
    "layer": "Meta",
    "purpose": "Module generation"
  },
  "28": {
    "name": "polyglot",
    "layer": "Meta",
    "purpose": "Translation"
  },
  "29": {
    "name": "muse",
    "layer": "Meta",
    "purpose": "Inspiration"
  },
  "30": {
    "name": "seer",
    "layer": "Meta",
    "purpose": "Forecasting"
  },
  "31": {
    "name": "mediator",
    "layer": "Apex",
    "purpose": "Conflict resolution"
  },
  "32": {
    "name": "synthesist",
    "layer": "Apex",
    "purpose": "Cross-level synthesis"
  },
  "33": {
    "name": "ethicist",
    "layer": "Apex",
    "purpose": "Governance"
  },
  "34": {
    "name": "validator",
    "layer": "Apex",
    "purpose": "Testing / verification"
  },
  "35": {
    "name": "singularity",
    "layer": "Apex",
    "purpose": "Self-improvement"
  },
  "36": {
    "name": "conductor_prime",
    "layer": "Apex",
    "purpose": "Meta-orchestration"
  },
  "37": {
    "name": "command",
    "layer": "Apex",
    "purpose": "Command center / UI"
  }
}

# Purpose map: easy to tweak (edges are level numbers, 1-based).
PURPOSE_MAP = {
  "Research": {
    "description": "External intelligence, synthesis, and knowledge capture.",
    "edges": [
      [
        2,
        5
      ],
      [
        2,
        7
      ],
      [
        5,
        7
      ],
      [
        5,
        23
      ],
      [
        23,
        7
      ],
      [
        30,
        5
      ],
      [
        13,
        5
      ],
      [
        29,
        13
      ]
    ]
  },
  "Coding": {
    "description": "Build, test, validate, and ship code.",
    "edges": [
      [
        4,
        11
      ],
      [
        4,
        27
      ],
      [
        27,
        34
      ],
      [
        34,
        5
      ],
      [
        11,
        5
      ],
      [
        28,
        4
      ],
      [
        9,
        4
      ],
      [
        26,
        27
      ]
    ]
  },
  "Ops": {
    "description": "Reliability, automation, monitoring, security.",
    "edges": [
      [
        21,
        26
      ],
      [
        21,
        8
      ],
      [
        8,
        26
      ],
      [
        14,
        26
      ],
      [
        14,
        21
      ],
      [
        26,
        24
      ],
      [
        24,
        17
      ],
      [
        17,
        18
      ]
    ]
  },
  "Governance": {
    "description": "Safety, policy, arbitration, and oversight.",
    "edges": [
      [
        33,
        8
      ],
      [
        33,
        31
      ],
      [
        31,
        24
      ],
      [
        33,
        24
      ],
      [
        34,
        33
      ],
      [
        15,
        33
      ],
      [
        22,
        33
      ]
    ]
  }
}


class ActionRequest(BaseModel):
    action: str
    params: Dict[str, Any] = {}


@router.get("/three.min.js")
async def three_min_js():
    """Serve vendored Three.js (no external CDN)."""
    return FileResponse(str(_THREE_PATH), media_type="application/javascript")


@router.get("/state")
async def command_center_state(seed: int | None = None):
    """Lightweight synthetic activity feed (fallback).

    Real co-activation traces are expected at /hud_display/traces.
    Client uses this endpoint only if that isn't present.

    Returns a few node-pairs and a timestamp. Client can map indices → nodes.
    """
    now = time.time()
    rng = random.Random(seed if seed is not None else int(now))
    bursts = []
    for _ in range(rng.randint(1, 3)):
        a = rng.randint(0, 36)
        b = rng.randint(0, 36)
        if a == b:
            b = (b + 1) % 64
        strength = rng.random() * 0.75 + 0.25
        bursts.append({"a": a, "b": b, "strength": strength})

    return JSONResponse({"ok": True, "t": now, "bursts": bursts})


@router.post("/action")
async def command_center_action(payload: ActionRequest, request: Request):
    """Safe, non-destructive command center actions.

    All actions are read-only sweeps/pings.
    """

    action = (payload.action or "").strip().lower()

    # Build base URL for *this* server (works behind reverse proxies too)
    scheme = request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if not host:
        # Fallback (shouldn't happen in normal FastAPI deployment)
        host = request.url.netloc
    base = f"{scheme}://{host}".rstrip("/")

    async def _get(path: str):
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(base + path)
            r.raise_for_status()
            return r.json()

    try:
        if action in {"status_sweep", "status", "sweep"}:
            health, conductor, oracle = await _get("/health"), await _get("/conductor/status"), await _get("/oracle/status")
            return {
                "ok": True,
                "action": "status_sweep",
                "results": {"health": health, "conductor": conductor, "oracle": oracle},
            }

        if action in {"orchestrator_list", "orchestrators", "workflow_list", "workflows"}:
            workflows = await _get("/conductor/workflows")
            return {"ok": True, "action": "orchestrator_list", "results": workflows}

        if action in {"ping_oracle", "oracle"}:
            oracle = await _get("/oracle/status")
            return {"ok": True, "action": "ping_oracle", "results": oracle}

        raise HTTPException(status_code=400, detail=f"Unknown action: {payload.action}")

    except httpx.HTTPError as e:
        # Keep errors visible to UI without crashing.
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {str(e)}") from e


@router.get("/ui", response_class=HTMLResponse)
async def command_center_ui():
    return await command_center_page()


@router.get("/", response_class=HTMLResponse)
async def command_center_page():
    if not _THREE_PATH.exists():
        # Soft failure: return a helpful message rather than 500.
        return HTMLResponse(
            "<pre>command_center: missing _assets/three.min.js. "
            "Download a Three.js build to cortex_server/routers/_assets/three.min.js</pre>",
            status_code=200,
        )

    html = r"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, height=device-height, initial-scale=1\" />
  <title>Cortex • Command Center</title>
  <style>
    :root{
      --bg0:#05070b;
      --panel: rgba(10,18,26,.62);
      --line: rgba(140, 210, 255, .14);
      --lineHi: rgba(140, 210, 255, .55);
      --pulse: rgba(120, 255, 236, .90);
      --pulse2: rgba(110, 170, 255, .85);
      --text: rgba(233, 246, 255, .88);
      --muted: rgba(233, 246, 255, .55);
      --warn: rgba(255, 196, 99, .85);
      --border: rgba(120, 190, 255, .18);
      --border2: rgba(120, 190, 255, .08);
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace;
      --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    }
    *{ box-sizing:border-box; }
    html,body{ height:100%; margin:0; background: radial-gradient(1400px 900px at 70% 10%, #0a1624 0%, var(--bg0) 50%, #020307 100%); overflow:hidden; }
    #stage{ position:fixed; inset:0; }

    #fx{
      pointer-events:none;
      position:fixed; inset:0;
      background:
        radial-gradient(1200px 700px at 55% 35%, rgba(80,160,255,.07) 0%, rgba(0,0,0,0) 55%),
        radial-gradient(1400px 900px at 50% 70%, rgba(0,0,0,.65) 0%, rgba(0,0,0,.82) 60%, rgba(0,0,0,.93) 100%),
        repeating-linear-gradient( to bottom, rgba(255,255,255,.02), rgba(255,255,255,.02) 1px, rgba(0,0,0,0) 3px, rgba(0,0,0,0) 6px);
      mix-blend-mode: overlay;
      opacity:.55;
    }

    #hud{ position:fixed; inset:0; pointer-events:none; font-family:var(--sans); color:var(--text); }

    .panel{
      pointer-events:auto;
      position:absolute;
      background: linear-gradient(135deg, rgba(18,30,44,.66), rgba(8,12,18,.72));
      border: 1px solid var(--border);
      box-shadow: 0 0 0 1px rgba(0,0,0,.25) inset, 0 18px 65px rgba(0,0,0,.45);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      clip-path: polygon(0 10px, 10px 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 18px 100%, 0 calc(100% - 18px));
    }
    .panel .inner{ position:relative; padding:14px 14px 12px 14px; }

    .title{ font-weight:650; letter-spacing:.14em; font-size:12px; text-transform:uppercase; color:rgba(210,245,255,.92); }
    .sub{ margin-top:6px; font-family:var(--mono); font-size:12px; color:var(--muted); line-height:1.35; white-space:pre-line; }
    .rule{ margin:12px 0 10px; height:1px; background: linear-gradient(90deg, rgba(120,190,255,.0), rgba(120,190,255,.35), rgba(120,190,255,.0)); }

    /* Left sidebar */
    #side{ left:18px; top:18px; bottom:18px; width:380px; }
    #side .inner{ height:100%; display:flex; flex-direction:column; gap:10px; }

    .tabs{ display:flex; gap:8px; }
    .tab{
      font-family:var(--mono);
      font-size:12px;
      letter-spacing:.06em;
      text-transform:uppercase;
      background: rgba(0,0,0,.18);
      color: rgba(210,245,255,.76);
      border: 1px solid rgba(120,190,255,.20);
      padding:8px 10px;
      cursor:pointer;
      clip-path: polygon(0 8px, 8px 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
      user-select:none;
      flex:1;
      text-align:center;
    }
    .tab.active{ border-color: rgba(135,255,244,.34); color: rgba(210,255,250,.92); background: rgba(0,0,0,.26); }

    .filters{ display:flex; flex-wrap:wrap; gap:8px; }
    .chip{
      font-family:var(--mono);
      font-size:11px;
      letter-spacing:.06em;
      text-transform:uppercase;
      padding:6px 9px;
      border:1px solid rgba(120,190,255,.18);
      background: rgba(0,0,0,.14);
      color: rgba(210,245,255,.72);
      cursor:pointer;
      clip-path: polygon(0 8px, 8px 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
      user-select:none;
    }
    .chip.active{ border-color: rgba(135,255,244,.34); color: rgba(210,255,250,.92); background: rgba(0,0,0,.24); }

    .list{ flex:1; min-height:0; overflow:auto; padding-right:6px; }
    .list::-webkit-scrollbar{ width:10px; }
    .list::-webkit-scrollbar-thumb{ background: rgba(120,190,255,.12); border-radius: 999px; }

    .row{ display:flex; gap:10px; align-items:center; padding:8px 8px; border:1px solid rgba(120,190,255,.10); background: rgba(0,0,0,.14);
      clip-path: polygon(0 10px, 10px 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px));
      margin-bottom:8px;
      cursor:pointer;
      user-select:none;
    }
    .row:hover{ border-color: rgba(135,255,244,.22); }
    .row.active{ border-color: rgba(135,255,244,.34); background: rgba(0,0,0,.22); }
    .row .id{ width:52px; color: rgba(210,245,255,.64); font-family:var(--mono); font-size:12px; }
    .row .nm{ flex:1; color: rgba(233,246,255,.86); font-family:var(--mono); font-size:12px; }
    .row .meta{ color: rgba(233,246,255,.45); font-family:var(--mono); font-size:11px; }

    /* Right panels */
    #tr{ right:18px; top:18px; width:420px; }
    #br{ right:18px; bottom:18px; width:520px; }

    .kpiRow{ display:flex; gap:12px; margin-top:10px; }
    .kpi{ flex:1; padding:10px 10px 9px; background: rgba(0,0,0,.18); border: 1px solid var(--border2);
      clip-path: polygon(0 8px, 8px 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px));
    }
    .kpi .label{ font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:rgba(210,245,255,.62); }
    .kpi .value{ margin-top:4px; font-family:var(--mono); font-size:16px; color:rgba(210,245,255,.92); }

    /* Safe controls */
    .btnRow{ display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    button.btn{
      font-family:var(--mono);
      font-size:12px;
      letter-spacing:.06em;
      text-transform:uppercase;
      background: rgba(0,0,0,.22);
      color: rgba(210,245,255,.86);
      border: 1px solid rgba(120,190,255,.20);
      padding:8px 10px;
      cursor:pointer;
      clip-path: polygon(0 8px, 8px 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
    }
    button.btn:hover{ border-color: rgba(135,255,244,.30); color: rgba(210,255,250,.92); }
    button.btn:active{ transform: translateY(1px); }
    button.btn[disabled]{ opacity:.5; cursor:not-allowed; }

    #tooltip{
      position:fixed; transform:translate(-50%, -120%);
      padding:8px 10px;
      background: rgba(0,0,0,.45);
      border:1px solid rgba(120,190,255,.22);
      clip-path: polygon(0 8px, 8px 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
      font-family:var(--mono);
      font-size:12px;
      color: rgba(233,246,255,.86);
      pointer-events:none;
      display:none;
      white-space:nowrap;
    }

    /* Mobile bottom sheet for sidebar */
    #sheet_grip{ display:none; }

    @media (max-width: 700px){
      html,body{ overflow:hidden; }

      /* Hide right panels on mobile; use bottom sheet instead */
      #tr, #br{ display:none; }

      /* Sidebar becomes a bottom sheet */
      #side{
        left:10px; right:10px;
        width:auto;
        top:auto;
        bottom:10px;
        height:min(78vh, 620px);
        transform: translateY(calc(100% - 64px));
        transition: transform 180ms ease;
        will-change: transform;
      }
      #side.expanded{ transform: translateY(0); }

      #sheet_grip{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        padding:10px 12px 8px 12px;
        margin:-14px -14px 10px -14px; /* counter inner padding */
        border-bottom: 1px solid rgba(120,190,255,.10);
        background: linear-gradient(180deg, rgba(0,0,0,.10), rgba(0,0,0,.0));
        touch-action:none;
        user-select:none;
      }
      #sheet_grip .bar{
        height:4px;
        width:56px;
        border-radius:999px;
        background: rgba(210,245,255,.35);
        box-shadow: 0 0 0 1px rgba(0,0,0,.25) inset;
      }
      #sheet_toggle{
        padding:7px 10px;
        font-size:11px;
      }

      /* No hover tooltips on mobile */
      #tooltip{ display:none !important; }
    }

  </style>
</head>
<body>
  <div id=\"stage\"></div>
  <div id=\"fx\"></div>

  <div id=\"hud\">
    <div class=\"panel\" id=\"side\"><div class=\"inner\">
      <div id=\"sheet_grip\" aria-hidden=\"true\">
        <div class=\"bar\"></div>
        <button class=\"btn\" id=\"sheet_toggle\" type=\"button\">Expand</button>
      </div>
      <div>
        <div class=\"title\">CORTEX COMMAND CENTER <span style=\"opacity:.7\">• 37 LEVELS</span></div>
        <div class=\"sub\">Telemetry: /hud_display/traces (NEW request_ids only)\nBaseline: purpose map (Research/Coding/Ops/Governance/All)</div>
        <div class=\"kpiRow\">
          <div class=\"kpi\"><div class=\"label\">Nodes</div><div class=\"value\" id=\"k_nodes\">—</div></div>
          <div class=\"kpi\"><div class=\"label\">Links</div><div class=\"value\" id=\"k_links\">—</div></div>
          <div class=\"kpi\"><div class=\"label\">Pulses</div><div class=\"value\" id=\"k_pulses\">—</div></div>
        </div>
      </div>

      <div class=\"rule\"></div>

      <div class=\"tabs\">
        <div class=\"tab active\" id=\"tab_nodes\">Nodes</div>
        <div class=\"tab\" id=\"tab_links\">Links</div>
      </div>

      <div class=\"filters\" id=\"purpose_filters\"></div>

      <div class=\"list\" id=\"list_nodes\"></div>
      <div class=\"list\" id=\"list_links\" style=\"display:none\"></div>

      <div class=\"rule\"></div>
      <div class=\"sub\" id=\"details\">Select a purpose, node, or link.</div>
    </div></div>

    <div class=\"panel\" id=\"tr\"><div class=\"inner\">
      <div class=\"title\">FOCUS</div>
      <div class=\"sub\" id=\"focus\">Hover a node to inspect. Click a node in the sidebar to focus/highlight.</div>
      <div class=\"rule\"></div>
      <div class=\"sub\" id=\"net\">Idle rotation + camera bias toward recent activity. Live pulses render only for NEW request_ids.</div>
    </div></div>

    <div class=\"panel\" id=\"br\"><div class=\"inner\">
      <div class=\"title\">TELEMETRY + CONTROLS</div>
      <div class=\"sub\">Safe actions (non-destructive): status sweep, list orchestrators, ping oracle.</div>
      <div class=\"btnRow\">
        <button class=\"btn\" id=\"btn_sweep\">Status Sweep</button>
        <button class=\"btn\" id=\"btn_orch\">Orchestrator List</button>
        <button class=\"btn\" id=\"btn_oracle\">Ping Oracle</button>
      </div>
      <div class=\"rule\"></div>
      <div class=\"sub\" style=\"margin-top:6px\">Vibrance</div>
      <input id=\"vib\" type=\"range\" min=\"0.6\" max=\"3.0\" step=\"0.1\" value=\"1.8\" style=\"width:100%\"/>
      <div class=\"sub\" style=\"margin-top:10px\">Baseline</div>
      <div class=\"btnRow\">
        <button class=\"btn\" id=\"base_rich\">Rich</button>
        <button class=\"btn\" id=\"base_clean\">Clean</button>
      </div>
      <div class=\"sub\" id=\"log\"></div>
    </div></div>

    <div id=\"tooltip\"></div>
  </div>

  <script src=\"./three.min.js\"></script>
  <script>
  (() => {
    const LEVELS = {"1": {"name": "kernel", "layer": "Foundation", "purpose": "System core"}, "2": {"name": "ghost", "layer": "Foundation", "purpose": "External intelligence (web search/browse)"}, "3": {"name": "hive", "layer": "Foundation", "purpose": "Parallelism / distributed execution"}, "4": {"name": "lab", "layer": "Foundation", "purpose": "Code execution"}, "5": {"name": "oracle", "layer": "Foundation", "purpose": "Reasoning / analysis"}, "6": {"name": "bard", "layer": "Foundation", "purpose": "Writing / TTS"}, "7": {"name": "librarian", "layer": "Foundation", "purpose": "Memory / recall"}, "8": {"name": "sentinel", "layer": "Foundation", "purpose": "Security"}, "9": {"name": "architect", "layer": "Foundation", "purpose": "System design"}, "10": {"name": "listener", "layer": "Foundation", "purpose": "Intent recognition"}, "11": {"name": "catalyst", "layer": "Intelligence", "purpose": "Optimization"}, "12": {"name": "darwin", "layer": "Intelligence", "purpose": "Evolution / adaptation"}, "13": {"name": "dreamer", "layer": "Intelligence", "purpose": "Creativity / scenarios"}, "14": {"name": "chronos", "layer": "Intelligence", "purpose": "Scheduling"}, "15": {"name": "council", "layer": "Intelligence", "purpose": "Multi-perspective critique"}, "16": {"name": "academy", "layer": "Intelligence", "purpose": "Training / patterns"}, "17": {"name": "exoskeleton", "layer": "Intelligence", "purpose": "Tool integration"}, "18": {"name": "diplomat", "layer": "Intelligence", "purpose": "Messaging / comms"}, "19": {"name": "geneticist", "layer": "Intelligence", "purpose": "Solution optimization"}, "20": {"name": "simulator", "layer": "Intelligence", "purpose": "What-if simulation"}, "21": {"name": "ouroboros", "layer": "Meta", "purpose": "Self-monitoring"}, "22": {"name": "mnemosyne", "layer": "Meta", "purpose": "Long-term memory"}, "23": {"name": "cartographer", "layer": "Meta", "purpose": "Self-mapping"}, "24": {"name": "nexus", "layer": "Meta", "purpose": "Orchestration"}, "25": {"name": "bridge", "layer": "Meta", "purpose": "External AI federation"}, "26": {"name": "conductor", "layer": "Meta", "purpose": "Workflow orchestration"}, "27": {"name": "forge", "layer": "Meta", "purpose": "Module generation"}, "28": {"name": "polyglot", "layer": "Meta", "purpose": "Translation"}, "29": {"name": "muse", "layer": "Meta", "purpose": "Inspiration"}, "30": {"name": "seer", "layer": "Meta", "purpose": "Forecasting"}, "31": {"name": "mediator", "layer": "Apex", "purpose": "Conflict resolution"}, "32": {"name": "synthesist", "layer": "Apex", "purpose": "Cross-level synthesis"}, "33": {"name": "ethicist", "layer": "Apex", "purpose": "Governance"}, "34": {"name": "validator", "layer": "Apex", "purpose": "Testing / verification"}, "35": {"name": "singularity", "layer": "Apex", "purpose": "Self-improvement"}, "36": {"name": "conductor_prime", "layer": "Apex", "purpose": "Meta-orchestration"}, "37": {"name": "command", "layer": "Apex", "purpose": "Command center / UI"}};
    const PURPOSE_MAP = {"Research": {"description": "External intelligence, synthesis, and knowledge capture.", "edges": [[2, 5], [2, 7], [5, 7], [5, 23], [23, 7], [30, 5], [13, 5], [29, 13]]}, "Coding": {"description": "Build, test, validate, and ship code.", "edges": [[4, 11], [4, 27], [27, 34], [34, 5], [11, 5], [28, 4], [9, 4], [26, 27]]}, "Ops": {"description": "Reliability, automation, monitoring, security.", "edges": [[21, 26], [21, 8], [8, 26], [14, 26], [14, 21], [26, 24], [24, 17], [17, 18]]}, "Governance": {"description": "Safety, policy, arbitration, and oversight.", "edges": [[33, 8], [33, 31], [31, 24], [33, 24], [34, 33], [15, 33], [22, 33]]}};

    const stage = document.getElementById('stage');
    const tooltip = document.getElementById('tooltip');

    const kNodesEl = document.getElementById('k_nodes');
    const kLinksEl = document.getElementById('k_links');
    const kPulsesEl = document.getElementById('k_pulses');
    const focusEl = document.getElementById('focus');
    const logEl = document.getElementById('log');
    const detailsEl = document.getElementById('details');

    const tabNodes = document.getElementById('tab_nodes');
    const tabLinks = document.getElementById('tab_links');
    const listNodes = document.getElementById('list_nodes');
    const listLinks = document.getElementById('list_links');

    const purposeFilters = document.getElementById('purpose_filters');

    const btnSweep = document.getElementById('btn_sweep');
    const btnOrch = document.getElementById('btn_orch');
    const btnOracle = document.getElementById('btn_oracle');

    const clamp=(v,a,b)=>Math.max(a, Math.min(b,v));

    const mqlMobile = window.matchMedia('(max-width: 700px)');
    const isCoarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    let IS_MOBILE = !!(mqlMobile && mqlMobile.matches) || isCoarsePointer;

    const sidePanel = document.getElementById('side');
    const sheetGrip = document.getElementById('sheet_grip');
    const sheetToggle = document.getElementById('sheet_toggle');

    function setSheetExpanded(expanded){
      if(!sidePanel) return;
      if(expanded) sidePanel.classList.add('expanded');
      else sidePanel.classList.remove('expanded');
      if(sheetToggle) sheetToggle.textContent = expanded ? 'Collapse' : 'Expand';
    }

    // Default collapsed on mobile.
    if(IS_MOBILE) setSheetExpanded(false);

    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'high-performance' });
    function applyRendererPerfTuning(){
      const dpr = window.devicePixelRatio || 1;
      const cap = IS_MOBILE ? 1.5 : 2.0;
      renderer.setPixelRatio(Math.min(cap, dpr));
    }
    applyRendererPerfTuning();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, window.innerWidth/window.innerHeight, 0.1, 160);
    camera.position.set(0.0, 0.2, 10.2);

    const key = new THREE.DirectionalLight(0x9fdcff, 0.45);
    key.position.set(2.8, 4.2, 5.6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x55d7cf, 0.18);
    fill.position.set(-3.5, -2.0, 4.0);
    scene.add(fill);

    scene.fog = new THREE.FogExp2(0x04070c, 0.092);

    // Starfield / background particles (lighter on mobile)
    const starCount = IS_MOBILE ? 650 : 1800;
    const starPos = new Float32Array(starCount*3);
    for(let i=0;i<starCount;i++){
      const a = Math.random()*Math.PI*2;
      const b = Math.acos(2*Math.random()-1);
      const r = 22 + Math.random()*38;
      starPos[i*3+0] = r*Math.sin(b)*Math.cos(a);
      starPos[i*3+1] = (r*Math.cos(b))*0.85;
      starPos[i*3+2] = r*Math.sin(b)*Math.sin(a);
    }
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color:0x8bdcff, transparent:true, opacity: IS_MOBILE?0.16:0.20, size: IS_MOBILE?0.035:0.030, sizeAttenuation:true, depthWrite:false, blending: THREE.AdditiveBlending });
    const stars = new THREE.Points(starGeom, starMat);
    stars.renderOrder = -10;
    scene.add(stars);

    let isDown=false, lx=0, ly=0;
    let yaw=0.5, pitch=0.2, dist=10.2;
    let lastInteract=performance.now();

    function onDown(e){ isDown=true; lx=e.clientX; ly=e.clientY; lastInteract=performance.now(); }
    function onUp(){ isDown=false; lastInteract=performance.now(); }
    function onMove(e){
      if(isDown){
        const dx=(e.clientX-lx), dy=(e.clientY-ly);
        lx=e.clientX; ly=e.clientY;
        yaw += dx*0.005;
        pitch += dy*0.004;
        pitch = clamp(pitch, -1.15, 1.15);
        lastInteract=performance.now();
      }
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
      pointer.px = e.clientX; pointer.py = e.clientY;
    }
    function onWheel(e){ dist = clamp(dist + e.deltaY*0.004, 5.2, 18.0); lastInteract=performance.now(); }
    window.addEventListener('pointerdown', onDown, {passive:true});
    window.addEventListener('pointerup', onUp, {passive:true});
    window.addEventListener('pointermove', onMove, {passive:true});
    window.addEventListener('wheel', onWheel, {passive:true});

    // Bottom-sheet (mobile): tap to expand/collapse + drag handle.
    if(sheetToggle){
      sheetToggle.addEventListener('click', ()=>{
        const expanded = sidePanel && sidePanel.classList.contains('expanded');
        setSheetExpanded(!expanded);
      });
    }

    if(sheetGrip && sidePanel){
      let dragActive=false;
      let startY=0;
      let startTranslate=0;
      const expandedTranslate = 0;
      const collapsedTranslate = () => {
        // Mirror CSS: translateY(calc(100% - 64px))
        const h = sidePanel.getBoundingClientRect().height;
        return Math.max(0, h - 64);
      };

      function getCurrentTranslate(){
        const m = new DOMMatrixReadOnly(getComputedStyle(sidePanel).transform);
        return m.m42 || 0;
      }

      function setTranslate(px){
        sidePanel.style.transition = 'none';
        sidePanel.style.transform = `translateY(${px}px)`;
      }

      function clearTranslate(){
        sidePanel.style.transition = '';
        sidePanel.style.transform = '';
      }

      sheetGrip.addEventListener('pointerdown', (e)=>{
        if(!IS_MOBILE) return;
        dragActive=true;
        startY = e.clientY;
        startTranslate = getCurrentTranslate();
        sheetGrip.setPointerCapture(e.pointerId);
      });
      sheetGrip.addEventListener('pointermove', (e)=>{
        if(!dragActive) return;
        const dy = e.clientY - startY;
        const t = clamp(startTranslate + dy, expandedTranslate, collapsedTranslate());
        setTranslate(t);
      });
      sheetGrip.addEventListener('pointerup', ()=>{
        if(!dragActive) return;
        dragActive=false;
        const t = getCurrentTranslate();
        clearTranslate();
        const shouldExpand = t < collapsedTranslate()*0.55;
        setSheetExpanded(shouldExpand);
      });
      sheetGrip.addEventListener('pointercancel', ()=>{ dragActive=false; clearTranslate(); });
    }

    // Pinch zoom for touch devices (two-finger pinch => camera distance).
    let pinchStart=null;
    let pinchStartDist=0;
    let pinchStartZoom=0;

    function touchDist(t0, t1){
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      return Math.sqrt(dx*dx + dy*dy);
    }

    renderer.domElement.addEventListener('touchstart', (e)=>{
      if(e.touches && e.touches.length===2){
        pinchStart=true;
        pinchStartDist = touchDist(e.touches[0], e.touches[1]);
        pinchStartZoom = dist;
      }
    }, {passive:true});

    renderer.domElement.addEventListener('touchmove', (e)=>{
      if(!(e.touches && e.touches.length===2 && pinchStart)) return;
      e.preventDefault();
      const d = touchDist(e.touches[0], e.touches[1]);
      if(d > 5){
        const ratio = pinchStartDist / d;
        dist = clamp(pinchStartZoom * ratio, 5.2, 18.0);
        lastInteract=performance.now();
      }
    }, {passive:false});

    renderer.domElement.addEventListener('touchend', (e)=>{
      if(!(e.touches && e.touches.length>=2)) pinchStart=null;
    }, {passive:true});

    const N = 37;
    const rng = mulberry32(0xC0FFEE);

    const nodes = [];
    const nodePos = new Float32Array(N*3);
    for(let i=0;i<N;i++){
      const u=rng(), v=rng();
      const theta = 2*Math.PI*u;
      const phi = Math.acos(2*v-1);
      const r = 2.9 + (rng()-0.5)*0.30;
      const x = r*Math.sin(phi)*Math.cos(theta);
      const y = r*Math.cos(phi)*0.80 + (rng()-0.5)*0.18;
      const z = r*Math.sin(phi)*Math.sin(theta);
      nodePos[i*3+0]=x; nodePos[i*3+1]=y; nodePos[i*3+2]=z;
      const lvl = i+1;
      const info = LEVELS[String(lvl)] || LEVELS[lvl] || {name:`L${lvl}`, layer:'', purpose:''};
      nodes.push({
        id:i,
        level:lvl,
        name: `L${String(lvl).padStart(2,'0')} • ${info.name}`,
        layer: info.layer||'',
        purpose: info.purpose||'',
        pos: new THREE.Vector3(x,y,z),
      });
    }

    function edgesForPurpose(p){
      if(p==='All'){
        const all=[];
        for(const k of Object.keys(PURPOSE_MAP)) for(const e of (PURPOSE_MAP[k].edges||[])) all.push(e);
        return all;
      }
      return (PURPOSE_MAP[p] && PURPOSE_MAP[p].edges) ? PURPOSE_MAP[p].edges : [];
    }

    let selectedPurpose = 'All';
    let selectedNode = -1;
    let selectedLink = null;

    const PURPOSES = ['All','Research','Coding','Ops','Governance'];
    function renderPurposeFilters(){
      purposeFilters.innerHTML='';
      for(const p of PURPOSES){
        const el=document.createElement('div');
        el.className='chip'+(p===selectedPurpose?' active':'');
        el.textContent=p;
        el.addEventListener('click', ()=>{
          selectedPurpose=p;
          selectedLink=null;
          renderPurposeFilters();
          rebuildBaseline();
          renderLinksList();
          setDetailsFromPurpose();
        });
        purposeFilters.appendChild(el);
      }
    }

    let lastPathText = '';
    function setDetailsFromPurpose(){
      if(selectedPurpose==='All'){
        detailsEl.textContent = 'Purpose: All\nDescription: Combined baseline map\nLast path: ' + (lastPathText||'—');
        return;
      }
      const d = PURPOSE_MAP[selectedPurpose]?.description || '—';
      detailsEl.textContent = `Purpose: ${selectedPurpose}\nDescription: ${d}\nLast path: ${lastPathText||'—'}`;
    }

    let baseGeom=null, baseLines=null;
    const baseMat = new THREE.LineBasicMaterial({ color: 0x86d9ff, transparent:true, opacity: (IS_MOBILE?0.08:0.12), depthWrite:false, depthTest:true, blending: THREE.AdditiveBlending });

    const edgeIndex = new Map();
    let baselineEdges = [];

    let glowLines=null, glowGeom=null, glowCol=null, glow=null;
    const glowMat = new THREE.LineBasicMaterial({ vertexColors:true, transparent:true, opacity: (IS_MOBILE?0.75:0.85), depthWrite:false, blending: THREE.AdditiveBlending });

    function rebuildBaseline(){
      if(baseLines){ scene.remove(baseLines); baseGeom.dispose(); }
      if(glowLines){ scene.remove(glowLines); glowGeom.dispose(); }
      edgeIndex.clear();

      const raw = edgesForPurpose(selectedPurpose);
      baselineEdges = raw.map(([la,lb])=>({a:clamp((la|0)-1,0,N-1), b:clamp((lb|0)-1,0,N-1)})).filter(e=>e.a!==e.b);
      const seen=new Set();
      baselineEdges = baselineEdges.filter(e=>{
        const k=`${Math.min(e.a,e.b)}-${Math.max(e.a,e.b)}`;
        if(seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const basePos = new Float32Array(baselineEdges.length*2*3);
      for(let i=0;i<baselineEdges.length;i++){
        const {a,b}=baselineEdges[i];
        basePos[i*6+0]=nodePos[a*3+0];
        basePos[i*6+1]=nodePos[a*3+1];
        basePos[i*6+2]=nodePos[a*3+2];
        basePos[i*6+3]=nodePos[b*3+0];
        basePos[i*6+4]=nodePos[b*3+1];
        basePos[i*6+5]=nodePos[b*3+2];
        edgeIndex.set(`${Math.min(a,b)}-${Math.max(a,b)}`, i);
      }
      baseGeom = new THREE.BufferGeometry();
      baseGeom.setAttribute('position', new THREE.BufferAttribute(basePos, 3));
      baseLines = new THREE.LineSegments(baseGeom, baseMat);
      baseLines.renderOrder=0;
      scene.add(baseLines);

      glow = new Float32Array(baselineEdges.length);
      glowGeom = new THREE.BufferGeometry();
      glowGeom.setAttribute('position', new THREE.BufferAttribute(basePos.slice(), 3));
      glowCol = new Float32Array(baselineEdges.length*2*3);
      glowGeom.setAttribute('color', new THREE.BufferAttribute(glowCol, 3));
      glowLines = new THREE.LineSegments(glowGeom, glowMat);
      glowLines.renderOrder=1;
      scene.add(glowLines);

      kNodesEl.textContent = String(N);
      kLinksEl.textContent = String(baselineEdges.length);
    }

    function bumpGlow(edgeIdx, strength){
      if(!glow || edgeIdx==null || edgeIdx<0 || edgeIdx>=glow.length) return;
      glow[edgeIdx] = Math.min(1.85, glow[edgeIdx] + strength);
    }

    const nodeGeom = new THREE.BufferGeometry();
    nodeGeom.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
    const nodeMat = new THREE.PointsMaterial({ color: 0xcdf2ff, size: 0.065, sizeAttenuation:true, transparent:true, opacity: 0.92, depthWrite:false, blending: THREE.AdditiveBlending });
    const nodePoints = new THREE.Points(nodeGeom, nodeMat);
    scene.add(nodePoints);

    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 16), new THREE.MeshBasicMaterial({ color: 0x7cffef, transparent:true, opacity: 0.88 }));
    marker.visible=false;
    marker.renderOrder=5;
    scene.add(marker);

    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.55, 2), new THREE.MeshStandardMaterial({ color: 0x0a1b2c, emissive: 0x061522, emissiveIntensity: 0.85, metalness: 0.35, roughness: 0.35, transparent:true, opacity: 0.24 }));
    scene.add(core);

    const pulses = [];
    const pulseMatA = new THREE.LineBasicMaterial({ color: 0x7cffef, transparent:true, opacity: 0.85, depthWrite:false, blending: THREE.AdditiveBlending });
    const pulseMatB = new THREE.LineBasicMaterial({ color: 0x77a8ff, transparent:true, opacity: 0.72, depthWrite:false, blending: THREE.AdditiveBlending });

    function spawnPulseByEdge(edgeIdx, strength=0.65){
      if(edgeIdx==null || edgeIdx<0 || edgeIdx>=baselineEdges.length) return;
      const speed = 0.55 + strength*0.75;
      const useAlt = (rng() > 0.62);
      const geom = new THREE.BufferGeometry();
      const pos = new Float32Array(2*3);
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const line = new THREE.Line(geom, useAlt? pulseMatB : pulseMatA);
      line.renderOrder=3;
      scene.add(line);
      pulses.push({ edgeIndex: edgeIdx, t:0, speed, strength, line, geom, pos, useAlt });
      bumpGlow(edgeIdx, 0.70*strength + 0.15);
      while(pulses.length>(IS_MOBILE?40:64)){
        const p=pulses.shift();
        scene.remove(p.line);
        p.geom.dispose();
      }
    }

    function spawnPulseBetween(a,b,strength=0.65){
      const idx = edgeIndex.get(`${Math.min(a,b)}-${Math.max(a,b)}`);
      if(idx!=null) spawnPulseByEdge(idx, strength);
    }

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = IS_MOBILE ? 0.18 : 0.11;
    const pointer = {x:0,y:0,px:0,py:0};
    let hovered=-1;

    function pickNodeAt(clientX, clientY){
      pointer.x = (clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(clientY / window.innerHeight) * 2 + 1;
      pointer.px = clientX; pointer.py = clientY;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(nodePoints, false);
      return (hits && hits.length) ? hits[0].index : -1;
    }

    // Tap/click selection (better on mobile where hover is not available).
    renderer.domElement.addEventListener('pointerup', (e)=>{
      if(e.pointerType === 'mouse' && !IS_MOBILE) return; // desktop uses hover + sidebar clicks
      const idx = pickNodeAt(e.clientX, e.clientY);
      if(idx < 0) return;
      selectedNode = idx;
      selectedLink = null;
      marker.visible = true;
      marker.position.copy(nodes[idx].pos);
      renderNodesList();
      setDetailsFromNode(idx);
      biasToNode(idx);
      // quick glow to confirm selection
      for(let i=0;i<baselineEdges.length;i++){
        const be = baselineEdges[i];
        if(be.a===idx || be.b===idx) bumpGlow(i, 0.55);
      }
      // Expand bottom sheet briefly if collapsed (mobile discoverability)
      if(IS_MOBILE && sidePanel && !sidePanel.classList.contains('expanded')) setSheetExpanded(true);
      lastInteract=performance.now();
    }, {passive:true});

    function updateHover(){
      if(IS_MOBILE){
        hovered=-1;
        if(tooltip) tooltip.style.display='none';
        return;
      }
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(nodePoints, false);
      if(hits && hits.length){
        const idx = hits[0].index;
        if(idx !== hovered){
          hovered = idx;
          focusEl.textContent = `Focus: ${nodes[idx].name} — ${nodes[idx].purpose}`;
        }
        tooltip.style.display='block';
        tooltip.textContent = nodes[idx].name;
        tooltip.style.left = `${pointer.px}px`;
        tooltip.style.top = `${pointer.py}px`;
      } else {
        hovered=-1;
        tooltip.style.display='none';
      }
    }

    function renderNodesList(){
      listNodes.innerHTML='';
      for(const n of nodes){
        const row=document.createElement('div');
        row.className='row'+(n.id===selectedNode?' active':'');
        row.innerHTML = `<div class='id'>L${String(n.level).padStart(2,'0')}</div><div class='nm'>${n.name.split(' • ')[1]}</div><div class='meta'>${n.layer}</div>`;
        row.addEventListener('click', ()=>{
          selectedNode=n.id;
          selectedLink=null;
          marker.visible=true;
          marker.position.copy(n.pos);
          renderNodesList();
          setDetailsFromNode(n.id);
          biasToNode(n.id);
          for(let i=0;i<baselineEdges.length;i++){
            const e=baselineEdges[i];
            if(e.a===n.id || e.b===n.id) bumpGlow(i, 0.55);
          }
        });
        listNodes.appendChild(row);
      }
    }

    function renderLinksList(){
      listLinks.innerHTML='';
      const desc = (selectedPurpose==='All') ? 'Combined' : (PURPOSE_MAP[selectedPurpose]?.description||'—');
      const head=document.createElement('div');
      head.className='sub';
      head.textContent = `Purpose: ${selectedPurpose}\n${desc}`;
      listLinks.appendChild(head);

      for(let i=0;i<baselineEdges.length;i++){
        const e=baselineEdges[i];
        const a=nodes[e.a], b=nodes[e.b];
        const row=document.createElement('div');
        const active = selectedLink && selectedLink.idx===i;
        row.className='row'+(active?' active':'');
        row.innerHTML = `<div class='id'>${String(i+1).padStart(2,'0')}</div><div class='nm'>${a.name.split(' • ')[1]} ↔ ${b.name.split(' • ')[1]}</div><div class='meta'>${selectedPurpose}</div>`;
        row.addEventListener('click', ()=>{
          selectedLink={idx:i, a:e.a, b:e.b, purpose:selectedPurpose};
          bumpGlow(i, 1.15);
          renderLinksList();
          setDetailsFromLink(i);
          biasToEdge(e.a,e.b);
        });
        listLinks.appendChild(row);
      }
    }

    function setDetailsFromNode(idx){
      const n=nodes[idx];
      detailsEl.textContent = `Node: ${n.name}\nLayer: ${n.layer||'—'}\nPurpose: ${n.purpose||'—'}\nSelected baseline: ${selectedPurpose}\nLast path: ${lastPathText||'—'}`;
    }
    function setDetailsFromLink(i){
      const e=baselineEdges[i];
      const a=nodes[e.a], b=nodes[e.b];
      const d=(selectedPurpose==='All') ? 'Combined baseline map' : (PURPOSE_MAP[selectedPurpose]?.description||'—');
      detailsEl.textContent = `Purpose: ${selectedPurpose}\nDescription: ${d}\nLink: ${a.name} ↔ ${b.name}\nLast path: ${lastPathText||'—'}`;
    }

    tabNodes.addEventListener('click', ()=>{
      tabNodes.classList.add('active'); tabLinks.classList.remove('active');
      listNodes.style.display='block'; listLinks.style.display='none';
    });
    tabLinks.addEventListener('click', ()=>{
      tabLinks.classList.add('active'); tabNodes.classList.remove('active');
      listLinks.style.display='block'; listNodes.style.display='none';
    });

    const lookAt = new THREE.Vector3(0,0,0);
    let biasTarget = new THREE.Vector3(0,0,0);
    function biasToNode(idx){ biasTarget = nodes[idx].pos.clone().multiplyScalar(0.18); }
    function biasToEdge(a,b){
      const mid = nodes[a].pos.clone().add(nodes[b].pos).multiplyScalar(0.5);
      biasTarget = mid.multiplyScalar(0.14);
    }

    const seenRequests = new Set();

    function normalizeHudTraces(j){
      const arr = j?.traces || j?.events || [];
      if(!Array.isArray(arr)) return [];
      const out=[];
      for(const x of arr){
        const rid = x.request_id || x.requestId || x.id || null;
        const acts = x.activated || x.path || x.levels || [];
        if(!rid || !Array.isArray(acts) || !acts.length) continue;
        const lvls = acts.map(a => (a.level ?? a.lvl ?? a.id ?? a)).map(v => (v|0)).filter(v => v>=1 && v<=37);
        if(!lvls.length) continue;
        out.push({request_id:String(rid), levels:lvls});
      }
      return out;
    }

    async function pollTraces(){
      let j=null;
      try{
        const r = await fetch('/hud_display/traces', {cache:'no-store'});
        if(r.ok) j = await r.json();
      }catch(e){}

      if(!j){
        try{
          const r2 = await fetch('./state', {cache:'no-store'});
          if(r2.ok){
            const f = await r2.json();
            const bursts = Array.isArray(f?.bursts) ? f.bursts : [];
            const rid = 'fallback:' + String(f?.t||Date.now());
            const levels=[];
            for(const b of bursts){
              levels.push(clamp((b.a|0),0,N-1)+1, clamp((b.b|0),0,N-1)+1);
            }
            j = {traces:[{request_id:rid, activated: levels.map(l=>({level:l}))}]};
          }
        }catch(e){}
      }
      if(!j) return;

      const evs = normalizeHudTraces(j);
      let newCount=0;
      for(const ev of evs){
        if(seenRequests.has(ev.request_id)) continue;
        seenRequests.add(ev.request_id);
        newCount++;

        const idxs = ev.levels.map(l=>l-1);
        for(let i=1;i<idxs.length;i++){
          const a=idxs[i-1], b=idxs[i];
          if(a===b) continue;
          spawnPulseBetween(a,b,0.75);
        }
        const lastIdx = idxs[idxs.length-1];
        if(lastIdx!=null){
          biasToNode(lastIdx);
          for(let i=0;i<baselineEdges.length;i++){
            const e=baselineEdges[i];
            if(e.a===lastIdx || e.b===lastIdx) bumpGlow(i, 0.45);
          }
        }
        lastPathText = ev.levels.map(l=>`L${String(l).padStart(2,'0')}`).join(' → ');
        setDetailsFromPurpose();
      }
      if(newCount) log(`hud_display: +${newCount} new request_id(s)`);
    }

    setInterval(pollTraces, 1200);
    pollTraces();

    async function doAction(action){
      const btns=[btnSweep, btnOrch, btnOracle];
      btns.forEach(b=>b.disabled=true);
      try{
        const res = await fetch('./action', { method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action}) });
        const j = await res.json().catch(()=>({}));
        if(!res.ok){ log(`action ${action}: ERROR ${res.status} ${(j && (j.detail||j.error)) || ''}`.trim()); return; }
        log(`action ${action}: OK`);
        if(action==='orchestrator_list'){
          const total = j?.results?.total ?? j?.results?.workflows?.length;
          if(total!=null) log(`workflows: ${total}`);
        }
        if(action==='status_sweep'){
          const ok = j?.results?.health?.status || j?.results?.health?.ok;
          if(ok!=null) log(`health: ${String(ok)}`);
        }
      }catch(e){
        log(`action ${action}: FAILED`);
      } finally {
        btns.forEach(b=>b.disabled=false);
      }
    }
    btnSweep.addEventListener('click', ()=>doAction('status_sweep'));
    btnOrch.addEventListener('click', ()=>doAction('orchestrator_list'));
    btnOracle.addEventListener('click', ()=>doAction('ping_oracle'));

    let last = performance.now();
    function animate(now){
      requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now-last)/1000); last=now;

      const idle = (now - lastInteract) > 2800;
      if(!isDown && idle){ yaw += dt*0.10; pitch += Math.sin(now*0.00035)*dt*0.02; }
      lookAt.lerp(biasTarget, 1 - Math.pow(0.02, dt));

      const cx = Math.sin(yaw)*Math.cos(pitch)*dist;
      const cz = Math.cos(yaw)*Math.cos(pitch)*dist;
      const cy = Math.sin(pitch)*dist*0.62;
      camera.position.set(cx, cy, cz);
      camera.lookAt(lookAt);

      core.rotation.y += dt*0.22;
      core.rotation.x += dt*0.10;
      core.material.opacity = 0.19 + 0.06*Math.sin(now*0.0012);

      baseMat.opacity = (hovered>=0) ? 0.14 : 0.12;

      if(glow){
        const decay = Math.pow(0.075, dt);
        for(let i=0;i<glow.length;i++){
          glow[i] *= decay;
          const g = clamp(glow[i], 0, 1.0);
          const r = 0.25*g, gg = 0.75*g, b = 1.00*g;
          const off = i*6;
          glowCol[off+0]=r; glowCol[off+1]=gg; glowCol[off+2]=b;
          glowCol[off+3]=r; glowCol[off+4]=gg; glowCol[off+5]=b;
        }
        glowGeom.attributes.color.needsUpdate = true;
      }

      for(let i=pulses.length-1;i>=0;i--){
        const p = pulses[i];
        p.t += dt * p.speed;
        const e = baselineEdges[p.edgeIndex];
        const ax=nodePos[e.a*3+0], ay=nodePos[e.a*3+1], az=nodePos[e.a*3+2];
        const bx=nodePos[e.b*3+0], by=nodePos[e.b*3+1], bz=nodePos[e.b*3+2];

        const len = 0.18 + 0.22*p.strength;
        const t0 = clamp(p.t - len, 0, 1);
        const t1 = clamp(p.t, 0, 1);
        const u0 = smoothstep(0,1,t0);
        const u1 = smoothstep(0,1,t1);

        p.pos[0] = ax + (bx-ax)*u0;
        p.pos[1] = ay + (by-ay)*u0;
        p.pos[2] = az + (bz-az)*u0;
        p.pos[3] = ax + (bx-ax)*u1;
        p.pos[4] = ay + (by-ay)*u1;
        p.pos[5] = az + (bz-az)*u1;
        p.geom.attributes.position.needsUpdate = true;

        const fade = 1 - clamp((p.t-0.75)/0.25, 0, 1);
        p.line.material.opacity = (p.useAlt?0.66:0.78) * fade;

        if(p.t >= 1.05){
          scene.remove(p.line);
          p.geom.dispose();
          pulses.splice(i,1);
        }
      }

      kPulsesEl.textContent = String(pulses.length);

      // subtle background motion
      if(typeof stars !== 'undefined' && stars){
        stars.rotation.y += IS_MOBILE ? 0.0004 : 0.0007;
        stars.rotation.x += IS_MOBILE ? 0.00015 : 0.00025;
      }

      updateHover();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(animate);

    function log(msg){
      const t = new Date().toLocaleTimeString();
      const line = `[${t}] ${msg}`;
      const prev = logEl.textContent.split('\n').filter(Boolean);
      prev.unshift(line);
      logEl.textContent = prev.slice(0,9).join('\n');
    }

    function onResize(){
      IS_MOBILE = !!(mqlMobile && mqlMobile.matches) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      applyRendererPerfTuning();
      raycaster.params.Points.threshold = IS_MOBILE ? 0.18 : 0.11;
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth/window.innerHeight;
      camera.updateProjectionMatrix();

      // keep sheet state coherent across rotations
      if(IS_MOBILE){
        if(sidePanel && !sidePanel.classList.contains('expanded')) setSheetExpanded(false);
      } else {
        // desktop: ensure sidebar is not transformed
        if(sidePanel){ sidePanel.classList.remove('expanded'); sidePanel.style.transform=''; }
      }
    }
    window.addEventListener('resize', onResize, {passive:true});

    function mulberry32(a){
      return function(){
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function smoothstep(a,b,x){
      x = clamp((x-a)/(b-a), 0, 1);
      return x*x*(3 - 2*x);
    }

    renderPurposeFilters();
    rebuildBaseline();
    renderNodesList();
    renderLinksList();
    setDetailsFromPurpose();

  })();
  </script>
</body>
</html>"""

    return HTMLResponse(html)
