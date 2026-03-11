from __future__ import annotations

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from pydantic import BaseModel
from pathlib import Path
from typing import Any, Dict
import random
import time

import httpx

router = APIRouter()

_ASSETS_DIR = Path(__file__).parent / "_assets"
_THREE_PATH = _ASSETS_DIR / "three.min.js"


class ActionRequest(BaseModel):
    action: str
    params: Dict[str, Any] = {}


@router.get("/three.min.js")
async def three_min_js():
    return FileResponse(str(_THREE_PATH), media_type="application/javascript")


@router.get("/node_core.svg")
async def node_core_svg():
    return FileResponse(str(_ASSETS_DIR / "node_core.svg"), media_type="image/svg+xml")


@router.get("/node_ring.svg")
async def node_ring_svg():
    return FileResponse(str(_ASSETS_DIR / "node_ring.svg"), media_type="image/svg+xml")


@router.get("/node_arc.svg")
async def node_arc_svg():
    return FileResponse(str(_ASSETS_DIR / "node_arc.svg"), media_type="image/svg+xml")


@router.get("/state")
async def command_center_state(seed: int | None = None):
    now = time.time()
    rng = random.Random(seed if seed is not None else int(now))
    return JSONResponse({"ok": True, "t": now, "strength": rng.random() * 0.7 + 0.3})


@router.post("/action")
async def command_center_action(payload: ActionRequest, request: Request):
    action = (payload.action or "").strip().lower()
    scheme = request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    base = f"{scheme}://{host}".rstrip("/")

    async def _get(path: str):
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(base + path)
            r.raise_for_status()
            return r.json()

    try:
        if action in {"status_sweep", "status", "sweep"}:
            health = await _get("/health")
            return {"ok": True, "action": "status_sweep", "results": {"health": health}}
        if action in {"ping_oracle", "oracle"}:
            oracle = await _get("/oracle/status")
            return {"ok": True, "action": "ping_oracle", "results": oracle}
        raise HTTPException(status_code=400, detail=f"Unknown action: {payload.action}")
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {str(e)}") from e


@router.get("/ui", response_class=HTMLResponse)
async def command_center_ui():
    return await command_center_page()


@router.get("/", response_class=HTMLResponse)
async def command_center_page():
    for req in [_THREE_PATH, _ASSETS_DIR / "node_core.svg", _ASSETS_DIR / "node_ring.svg", _ASSETS_DIR / "node_arc.svg"]:
        if not req.exists():
            return HTMLResponse(f"<pre>command_center missing asset: {req.name}</pre>", status_code=200)

    html = r'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Command Center • Core + Levels</title>
<style>
html,body{margin:0;height:100%;overflow:hidden;background:radial-gradient(1200px 700px at 50% 30%, #0a1e36 0%, #020913 58%, #01050c 100%)}
#stage{position:fixed;inset:0}
#badge{position:fixed;left:12px;top:10px;font:12px ui-monospace,monospace;color:#b8f6ff;opacity:.72;letter-spacing:.04em}
#tooltip{position:fixed;display:none;pointer-events:none;padding:6px 8px;border:1px solid rgba(127,243,255,.35);background:rgba(2,12,20,.82);color:#bdf6ff;font:12px ui-monospace,monospace;border-radius:6px;white-space:nowrap;z-index:20}

/* REALTIME_OVERLAY_V1 */
.panel{position:fixed;z-index:18;border:1px solid rgba(127,243,255,.25);background:rgba(4,14,24,.74);backdrop-filter:blur(6px);border-radius:10px;box-shadow:0 0 22px rgba(58,213,255,.14), inset 0 0 20px rgba(76,216,255,.08);color:#c7f7ff;font:11px ui-monospace,monospace;letter-spacing:.02em}
#telemetry{top:10px;right:10px;min-width:250px;padding:8px 10px}
#telemetry .h{font-size:10px;opacity:.78;text-transform:uppercase;letter-spacing:.12em;margin-bottom:5px}
#telemetry .r{display:flex;justify-content:space-between;gap:10px;margin:2px 0}
#telemetry .k{opacity:.72}
#telemetry .v{color:#e3fbff}
#kpi{left:12px;top:34px;display:flex;gap:8px;padding:6px 8px}
#kpi .chip{padding:4px 8px;border-radius:999px;border:1px solid rgba(130,241,255,.22);background:rgba(0,0,0,.22)}
#activity{left:12px;bottom:12px;max-width:420px;max-height:162px;overflow:hidden;padding:8px 10px}
#activity .h{font-size:10px;opacity:.8;text-transform:uppercase;letter-spacing:.12em;margin-bottom:5px}
#activityLog{margin:0;padding-left:16px}
#activityLog li{line-height:1.35;margin:2px 0;color:#bceeff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.status-real{color:#7dffc2}.status-sim{color:#ffd58c}.status-unavail{color:#ff9ea9}
</style>
</head>
<body>
<div id="stage"></div>
<div id="badge">CORE_PLUS_LEVELS_V2 • 38 LEVELS</div>
<div id="tooltip"></div>

<div id="kpi" class="panel">
  <div class="chip">nodes <span id="kpiNodes">0</span></div>
  <div class="chip">links <span id="kpiLinks">0</span></div>
  <div class="chip">active pulses <span id="kpiPulses">0</span></div>
</div>
<div id="telemetry" class="panel">
  <div class="h">telemetry</div>
  <div class="r"><span class="k">trace source</span><span id="traceSource" class="v status-unavail">UNAVAILABLE</span></div>
  <div class="r"><span class="k">mode</span><span id="traceMode" class="v">both</span></div>
  <div class="r"><span class="k">last request</span><span id="lastReq" class="v">-</span></div>
  <div class="r"><span class="k">last time</span><span id="lastTime" class="v">-</span></div>
</div>
<div id="activity" class="panel">
  <div class="h">recent activations</div>
  <ol id="activityLog"></ol>
</div>

<script src="./three.min.js"></script>
<script>
(()=>{
  // REALTIME_OVERLAY_V1
  // ACTIVATION_ROUTE_LOOP_V1
  const stage=document.getElementById('stage');
  const tooltip=document.getElementById('tooltip');
  const LEVEL_DEFS=[
    {lvl:1,name:'Kernel',group:'Foundation',hot:true},{lvl:2,name:'Ghost',group:'Reasoning Mesh',hot:true},
    {lvl:3,name:'Parser',group:'Foundation',hot:false},{lvl:4,name:'Lab',group:'Build Chain',hot:true},
    {lvl:5,name:'Oracle',group:'Reasoning Mesh',hot:true},{lvl:6,name:'Bard',group:'Creative',hot:false},
    {lvl:7,name:'Librarian',group:'Memory',hot:true},{lvl:8,name:'Cron',group:'Ops Mesh',hot:true},
    {lvl:9,name:'Architect',group:'Build Chain',hot:false},{lvl:10,name:'Listener',group:'Reasoning Mesh',hot:false},
    {lvl:11,name:'Catalyst',group:'Build Chain',hot:false},{lvl:12,name:'Hive/Darwin',group:'Ops Mesh',hot:false},
    {lvl:13,name:'Dreamer',group:'Creative',hot:false},{lvl:14,name:'Chronos',group:'Ops Mesh',hot:false},
    {lvl:15,name:'Council',group:'Governance',hot:false},{lvl:16,name:'Academy',group:'Governance',hot:false},
    {lvl:17,name:'Exoskeleton/Tools',group:'Ops Mesh',hot:true},{lvl:18,name:'Diplomat',group:'Governance',hot:false},
    {lvl:19,name:'Geneticist',group:'Creative',hot:false},{lvl:20,name:'Simulator',group:'Reasoning Mesh',hot:false},
    {lvl:21,name:'Ouroboros/Sentinel',group:'Governance',hot:true},{lvl:22,name:'Mnemosyne/Knowledge',group:'Memory',hot:true},
    {lvl:23,name:'Cartographer/Mirror',group:'Memory',hot:false},{lvl:24,name:'Nexus',group:'Ops Mesh',hot:true},
    {lvl:25,name:'Bridge',group:'Ops Mesh',hot:true},{lvl:26,name:'Orchestrator/Conductor',group:'Ops Mesh',hot:true},
    {lvl:27,name:'Forge',group:'Build Chain',hot:true},{lvl:28,name:'Polyglot',group:'Creative',hot:false},
    {lvl:29,name:'Muse',group:'Creative',hot:false},{lvl:30,name:'Seer',group:'Reasoning Mesh',hot:false},
    {lvl:31,name:'Mediator',group:'Governance',hot:false},{lvl:32,name:'Synthesist',group:'Reasoning Mesh',hot:true},
    {lvl:33,name:'Ethicist',group:'Governance',hot:true},{lvl:34,name:'Validator',group:'Governance',hot:true},
    {lvl:35,name:'Singularity',group:'Reasoning Mesh',hot:false},{lvl:36,name:'Conductor (Meta)',group:'Ops Mesh',hot:true},
    {lvl:37,name:'Awareness',group:'Foundation',hot:true},{lvl:38,name:'Core',group:'Foundation',hot:true}
  ];
  const GROUP_ANCHORS={'Reasoning Mesh':{x:0.0,y:2.6},'Ops Mesh':{x:3.5,y:0.6},'Memory':{x:-3.2,y:1.0},'Governance':{x:2.2,y:-2.0},'Build Chain':{x:-2.2,y:-2.0},'Creative':{x:0.0,y:-2.7},'Foundation':{x:0.0,y:0.4}};
  const LAY_PURPOSE={1:'Keeps the whole system running.',2:'Finds outside info fast.',3:'Breaks messy input into structure.',4:'Runs code and calculations safely.',5:'Reasoning and decision support.',6:'Turns ideas into human-friendly output.',7:'Remembers useful context.',8:'Schedules and recurring tasks.',9:'Designs system structure.',10:'Listens for intent and signals.',11:'Improves speed and efficiency.',12:'Adapts behavior over time.',13:'Explores creative possibilities.',14:'Time coordination and timing logic.',15:'Brings multiple viewpoints together.',16:'Learns patterns and training loops.',17:'Uses tools and integrations.',18:'Handles communication and diplomacy.',19:'Searches for better variants.',20:'Simulates what-if outcomes.',21:'Watches health and safety.',22:'Long-term memory and knowledge.',23:'Maps capabilities and context.',24:'Orchestrates which levels should run.',25:'Bridges external systems/models.',26:'Coordinates workflows.',27:'Builds and assembles new pieces.',28:'Language translation/normalization.',29:'Creative guidance and ideas.',30:'Forecasting and foresight.',31:'Resolves conflicts and tradeoffs.',32:'Combines signals into one answer.',33:'Ethics and policy checks.',34:'Validates and tests outputs.',35:'Self-improvement planning.',36:'Meta-orchestration oversight.',37:'Self-awareness and internal state.',38:'Augmenter/control surface.'};

  const els={
    src:document.getElementById('traceSource'), mode:document.getElementById('traceMode'), req:document.getElementById('lastReq'), time:document.getElementById('lastTime'),
    n:document.getElementById('kpiNodes'), l:document.getElementById('kpiLinks'), p:document.getElementById('kpiPulses'), log:document.getElementById('activityLog')
  };
  const queryMode=((new URLSearchParams(location.search)).get('mode')||'both').toLowerCase();
  const seenReq=new Set();
  const lvlToNode=new Map();
  const nodeBloom=new Map();
  const routeAnims=[];
  let activePulseCount=0;

  function addLog(text){
    const li=document.createElement('li'); li.textContent=text; els.log.prepend(li);
    while(els.log.children.length>8) els.log.removeChild(els.log.lastChild);
  }
  function setSource(kind){
    els.src.textContent=kind;
    els.src.className='v ' + (kind==='REAL'?'status-real':(kind==='SIMULATED'?'status-sim':'status-unavail'));
  }
  function levelNumbersFrom(any){
    if(any==null) return [];
    if(Array.isArray(any)) return any.flatMap(levelNumbersFrom).map(Number).filter(n=>n>=1&&n<=38);
    if(typeof any==='number') return (any>=1&&any<=38)?[any]:[];
    if(typeof any==='string'){
      const m=[...any.matchAll(/(?:\bL(?:evel)?\s*|\blvl\s*|\blevel\s*|\b)(\d{1,2})\b/gi)].map(x=>Number(x[1])).filter(n=>n>=1&&n<=38);
      return m;
    }
    if(typeof any==='object'){
      return [
        ...levelNumbersFrom(any.level), ...levelNumbersFrom(any.activated), ...levelNumbersFrom(any.activated_levels), ...levelNumbersFrom(any.levels), ...levelNumbersFrom(any.path),
        ...levelNumbersFrom(any.trace_path), ...levelNumbersFrom(any.route), ...levelNumbersFrom(any.sequence)
      ].filter(Boolean);
    }
    return [];
  }

  function queueRoute(levelPath, reqId, ts){
    const uniq=[];
    for(const lv of levelPath){ if(!uniq.length || uniq[uniq.length-1]!==lv) uniq.push(lv); }
    if(uniq.length<1) return;
    const nodes=uniq.map(lv=>lvlToNode.get(lv)).filter(Boolean);
    if(!nodes.length) return;

    const now=performance.now()/1000;
    const seq=[];
    for(let i=0;i<nodes.length-1;i++) seq.push([nodes[i], nodes[i+1], uniq[i+1]]);
    seq.push([nodes[nodes.length-1], core.position, null]);
    seq.push([core.position, nodes[0], uniq[0]]);

    seq.forEach((s,idx)=>{
      const [a,b,targetLv]=s;
      const g=new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
      const m=new THREE.LineBasicMaterial({color:0x9ef9ff,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false});
      const line=new THREE.Line(g,m); scene.add(line);
      const spr=new THREE.Sprite(new THREE.SpriteMaterial({map:txCore,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
      spr.scale.set(0.34,0.34,1); scene.add(spr);
      routeAnims.push({line,spr,a:a.clone(),b:b.clone(),t0:now+idx*0.20,dur:0.48,end:now+idx*0.20+1.3,targetLv});
    });

    els.req.textContent=reqId||'-';
    els.time.textContent=ts?new Date(ts*1000).toLocaleTimeString():new Date().toLocaleTimeString();
    addLog(`${reqId||'trace'}: ${uniq.map(n=>{ const nm=(LEVEL_DEFS.find(x=>x.lvl===n)?.name||'').split(' • ').pop()||'unknown'; return `L${n}(${nm})`; }).join('→')}`);
  }

  async function pullTraces(){
    let payload=null, source='UNAVAILABLE';
    els.mode.textContent=queryMode;
    try{
      const r=await fetch('/hud_display/traces',{cache:'no-store'});
      if(r.ok){ payload=await r.json(); source='REAL'; }
    }catch(e){}
    if(!payload){
      try{
        const r2=await fetch('/hud_display/history?seconds=120',{cache:'no-store'});
        if(r2.ok){ const h=await r2.json(); const acts=Array.isArray(h?.activations)?h.activations:[]; const grouped={}; for(const a of acts){ const rid=String(a?.request_id||a?.requestId||('history:'+Date.now())); const lvl=Number(a?.level); if(!(lvl>=1&&lvl<=37)) continue; if(!grouped[rid]) grouped[rid]=[]; grouped[rid].push({level:lvl}); } const traces=Object.entries(grouped).map(([request_id,activated])=>({request_id,activated})); if(traces.length){ payload={traces}; source='REAL'; } }
      }catch(e){}
    }
    if(!payload && queryMode==='both'){
      try{ await fetch('./state',{cache:'no-store'}); }catch(e){}
    }
    setSource(source);
    if(!payload) return;

    const events=[];
    const traces = payload.traces || payload.requests || payload.items || [];
    if(Array.isArray(traces)){
      for(const t of traces){
        const reqId=t.request_id||t.id||t.trace_id||`${t.ts||Date.now()}-${Math.random().toString(36).slice(2,6)}`;
        const lv=levelNumbersFrom(t);
        if(lv.length) events.push({reqId,ts:t.ts||Date.now()/1000,lv});
      }
    }
    const acts = payload.activations || payload.history || [];
    if(Array.isArray(acts)){
      for(const a of acts){
        const reqId=a.request_id||a.id||a.path||`${a.ts||Date.now()}-${Math.random().toString(36).slice(2,6)}`;
        const lv=levelNumbersFrom(a.path||a);
        if(lv.length) events.push({reqId,ts:a.ts||Date.now()/1000,lv});
      }
    }

    events.sort((a,b)=>a.ts-b.ts);
    const latest = events.length ? events[events.length-1] : null;
    if(latest){
      els.req.textContent = latest.reqId || '-';
      els.time.textContent = latest.ts ? new Date(latest.ts*1000).toLocaleTimeString() : new Date().toLocaleTimeString();
    }
    for(const ev of events.slice(-12)){
      if(seenReq.has(ev.reqId)) continue;
      seenReq.add(ev.reqId);
      queueRoute(ev.lv, ev.reqId, ev.ts);
      if(seenReq.size>220){ const first=seenReq.values().next().value; seenReq.delete(first); }
    }
  }

  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
  renderer.setSize(innerWidth,innerHeight);
  stage.appendChild(renderer.domElement);

  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,0.1,100);
  camera.position.set(0,0,11.5);

  const loader=new THREE.TextureLoader();
  const txCore=loader.load('./node_core.svg');
  const txRing=loader.load('./node_ring.svg');
  const txArc=loader.load('./node_arc.svg');
  [txCore,txRing,txArc].forEach(t=>{ t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; });

  const core=new THREE.Group();
  core.position.set(0,1.15,0);
  scene.add(core);
  const c0=new THREE.Sprite(new THREE.SpriteMaterial({map:txCore,transparent:true,opacity:0.95,depthWrite:false,blending:THREE.AdditiveBlending})); c0.scale.set(2.8,2.8,1); core.add(c0);
  const c1=new THREE.Sprite(new THREE.SpriteMaterial({map:txRing,transparent:true,opacity:0.75,depthWrite:false,blending:THREE.AdditiveBlending})); c1.scale.set(3.8,3.8,1); core.add(c1);
  const c2=new THREE.Sprite(new THREE.SpriteMaterial({map:txRing,transparent:true,opacity:0.48,depthWrite:false,blending:THREE.AdditiveBlending})); c2.scale.set(4.8,4.8,1); core.add(c2);
  const c3=new THREE.Sprite(new THREE.SpriteMaterial({map:txArc,transparent:true,opacity:0.55,depthWrite:false,blending:THREE.AdditiveBlending})); c3.scale.set(4.5,4.5,1); core.add(c3);

  const squiggles=[];
  function makeSquiggle(radius, amp, turns, phase, opacity){
    const pts=[], n=220;
    for(let i=0;i<=n;i++){ const t=i/n,a=t*Math.PI*2*turns+phase,r=radius+Math.sin(t*Math.PI*8+phase)*amp; pts.push(new THREE.Vector3(Math.cos(a)*r,Math.sin(a)*r*0.55,0)); }
    const g=new THREE.BufferGeometry().setFromPoints(pts);
    const m=new THREE.LineBasicMaterial({color:0x7ef0ff,transparent:true,opacity,blending:THREE.AdditiveBlending,depthWrite:false});
    const l=new THREE.Line(g,m); core.add(l); squiggles.push(l);
  }
  makeSquiggle(2.4,0.18,1.15,0.0,0.28); makeSquiggle(2.85,0.22,1.00,1.6,0.24); makeSquiggle(3.15,0.20,1.25,3.1,0.18);

  const levels=[], L=38;
  for(let i=0;i<L;i++){
    const x=(Math.random()-0.5)*13.8, y=(Math.random()-0.5)*8.2 - 0.3, z=(Math.random()-0.5)*1.0;
    if(Math.hypot(x,y-1.15)<2.15){ i--; continue; }
    const g=new THREE.Group(); g.position.set(x,y,z);
    const nCore=new THREE.Sprite(new THREE.SpriteMaterial({map:txCore,transparent:true,opacity:0.82,depthWrite:false,blending:THREE.AdditiveBlending})); nCore.scale.set(0.44,0.44,1); g.add(nCore);
    const nRing=new THREE.Sprite(new THREE.SpriteMaterial({map:txRing,transparent:true,opacity:0.42,depthWrite:false,blending:THREE.AdditiveBlending})); nRing.scale.set(0.66,0.66,1); g.add(nRing);
    scene.add(g);
    levels.push({g,nCore,nRing,baseY:y,phase:i*0.47,lvl:i+1,name:`Level ${i+1}`,group:'Unassigned',hot:false});
  }

  const groupedDefs={}; for(const d of LEVEL_DEFS){ if(!groupedDefs[d.group]) groupedDefs[d.group]=[]; groupedDefs[d.group].push(d); }
  for(const gk of Object.keys(groupedDefs)) groupedDefs[gk].sort((a,b)=>Number(b.hot)-Number(a.hot));
  const unassigned = new Set(levels.map((_,i)=>i));
  for(const group of Object.keys(groupedDefs)){
    const defs = groupedDefs[group], anchor = GROUP_ANCHORS[group] || {x:0,y:0};
    const candidates = [...unassigned].sort((ia,ib)=>{ const a=levels[ia].g.position,b=levels[ib].g.position; const da=(a.x-anchor.x)**2+(a.y-anchor.y)**2, db=(b.x-anchor.x)**2+(b.y-anchor.y)**2; return da-db; });
    for(let k=0;k<defs.length;k++){
      const idx=candidates[k]; if(idx==null) continue; unassigned.delete(idx); const d=defs[k];
      levels[idx].lvl=d.lvl; levels[idx].name=d.name; levels[idx].group=d.group; levels[idx].hot=d.hot;
      lvlToNode.set(d.lvl, levels[idx].g.position);
    }
  }

  const linkPos = new Float32Array(L*6);
  for(let i=0;i<L;i++){ const o=i*6; linkPos[o]=core.position.x; linkPos[o+1]=core.position.y; linkPos[o+2]=0; linkPos[o+3]=levels[i].g.position.x; linkPos[o+4]=levels[i].g.position.y; linkPos[o+5]=levels[i].g.position.z; }
  const lg=new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(linkPos,3));
  const lm=new THREE.LineBasicMaterial({color:0x78dfff,transparent:true,opacity:0.12,blending:THREE.AdditiveBlending,depthWrite:false});
  const links=new THREE.LineSegments(lg,lm); scene.add(links);

  const nnPairs=[], pairSeen=new Set();
  for(let i=0;i<L;i++){
    const a=levels[i].g.position; let b1=-1,b2=-1,d1=1e9,d2=1e9;
    for(let j=0;j<L;j++){ if(i===j) continue; const b=levels[j].g.position; const d=(a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2; if(d<d1){d2=d1;b2=b1;d1=d;b1=j;} else if(d<d2){d2=d;b2=j;} }
    for(const j of [b1,b2]){ if(j<0) continue; const k=i<j?`${i}-${j}`:`${j}-${i}`; if(pairSeen.has(k)) continue; pairSeen.add(k); nnPairs.push([Math.min(i,j),Math.max(i,j)]); }
  }
  const netPos = new Float32Array(nnPairs.length*6);
  for(let i=0;i<nnPairs.length;i++){ const [a,b]=nnPairs[i], o=i*6, pa=levels[a].g.position, pb=levels[b].g.position; netPos[o]=pa.x; netPos[o+1]=pa.y; netPos[o+2]=pa.z; netPos[o+3]=pb.x; netPos[o+4]=pb.y; netPos[o+5]=pb.z; }
  const ng=new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.BufferAttribute(netPos,3));
  const nm=new THREE.LineBasicMaterial({color:0x7de7ff,transparent:true,opacity:0.14,blending:THREE.AdditiveBlending,depthWrite:false});
  const netLines=new THREE.LineSegments(ng,nm); scene.add(netLines);

  const tandemPairs=[];
  const groupNodeIds={};
  levels.forEach((lv,idx)=>{ if(!groupNodeIds[lv.group]) groupNodeIds[lv.group]=[]; groupNodeIds[lv.group].push(idx); });
  for(const group of Object.keys(groupNodeIds)){
    const ids=(groupNodeIds[group]||[]).filter(i=>levels[i].hot); if(ids.length<2) continue;
    for(let i=0;i<ids.length-1;i++) tandemPairs.push([ids[i],ids[i+1]]);
  }
  const tandemPos = new Float32Array(tandemPairs.length*6);
  for(let i=0;i<tandemPairs.length;i++){ const [a,b]=tandemPairs[i], o=i*6, pa=levels[a].g.position, pb=levels[b].g.position; tandemPos[o]=pa.x; tandemPos[o+1]=pa.y; tandemPos[o+2]=pa.z; tandemPos[o+3]=pb.x; tandemPos[o+4]=pb.y; tandemPos[o+5]=pb.z; }
  const tg=new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(tandemPos,3));
  const tm=new THREE.LineBasicMaterial({color:0x9fffff,transparent:true,opacity:0.28,blending:THREE.AdditiveBlending,depthWrite:false});
  const tandemLines=new THREE.LineSegments(tg,tm); scene.add(tandemLines);

  els.n.textContent=String(L);
  els.l.textContent=String(L + nnPairs.length + tandemPairs.length);

  const hoverTargets = levels.map(l=>l.nCore), coreHoverTarget=c0, allHoverTargets=[coreHoverTarget, ...hoverTargets];
  const raycaster = new THREE.Raycaster(), pointer=new THREE.Vector2(2,2);
  let hovered=-1, hoveredCore=false, boost=0.0;
  addEventListener('pointermove',(e)=>{ pointer.x=(e.clientX/innerWidth)*2-1; pointer.y=-(e.clientY/innerHeight)*2+1; },{passive:true});
  addEventListener('click',()=>{
    if(hovered>=0){
      const lv=levels[hovered]?.lvl;
      const nm=levels[hovered]?.name||`L${lv}`;
      const why=LAY_PURPOSE[lv]||'General system support.';
      addLog(`L${lv}(${nm}): ${why}`);
    }
  },{passive:true});

  async function poll(){ try{ await pullTraces(); boost=Math.min(1.0, boost+0.10);}catch(e){} }
  setInterval(poll, 1300); poll();

  let last=performance.now();
  function anim(nowMs){
    requestAnimationFrame(anim);
    const now=nowMs/1000, dt=Math.min(0.05,(nowMs-last)/1000); last=nowMs;
    boost=Math.max(0, boost-dt*0.2);

    const beat=0.5+0.5*Math.sin(nowMs*0.00108), life=beat*(0.7+0.3*boost);
    const coreHoverBoost = hoveredCore ? 0.35 : 0.0;
    c0.material.opacity = 0.76 + 0.20*life + 0.10*coreHoverBoost;
    c0.scale.setScalar(2.72 + 0.22*life + 0.38*coreHoverBoost);
    c1.material.rotation += dt*0.24; c2.material.rotation -= dt*0.16; c3.material.rotation += dt*0.10;
    c1.material.opacity=0.3+0.42*life + 0.08*coreHoverBoost; c2.material.opacity=0.18+0.3*life + 0.06*coreHoverBoost; c3.material.opacity=0.2+0.28*(0.5+0.5*Math.sin(nowMs*0.0017)) + 0.06*coreHoverBoost;
    core.scale.setScalar(1.0 + 0.08*coreHoverBoost);

    for(let i=0;i<squiggles.length;i++){ squiggles[i].material.opacity = 0.12 + 0.20*(0.5+0.5*Math.sin(nowMs*0.0012 + i*1.3)); squiggles[i].rotation.z += dt*(0.03 + i*0.015); }

    for(let i=0;i<levels.length;i++){
      const n=levels[i], t=nowMs*0.00095 + n.phase;
      n.g.position.y = n.baseY + Math.sin(t)*0.05;
      const hoverB=(hovered===i)?0.45:0.0;
      const bloom=nodeBloom.get(i)||0.0;
      n.nCore.material.opacity = 0.62 + 0.26*(0.5+0.5*Math.sin(t*2.1)) + 0.14*hoverB + bloom*0.35;
      n.nRing.material.opacity = 0.24 + 0.25*(0.5+0.5*Math.sin(t*1.7+1.3)) + 0.12*hoverB + bloom*0.28;
      n.nCore.scale.setScalar(0.44 + 0.11*hoverB + bloom*0.25);
      n.nRing.scale.setScalar(0.66 + 0.15*hoverB + bloom*0.32);
      n.nRing.material.rotation += dt*0.18;
      if(bloom>0.001) nodeBloom.set(i, bloom*0.93); else nodeBloom.delete(i);
    }

    for(let i=0;i<L;i++){ const o=i*6; linkPos[o+3]=levels[i].g.position.x; linkPos[o+4]=levels[i].g.position.y; linkPos[o+5]=levels[i].g.position.z; }
    lg.attributes.position.needsUpdate=true;
    for(let i=0;i<nnPairs.length;i++){ const [a,b]=nnPairs[i], o=i*6, pa=levels[a].g.position, pb=levels[b].g.position; netPos[o]=pa.x; netPos[o+1]=pa.y; netPos[o+2]=pa.z; netPos[o+3]=pb.x; netPos[o+4]=pb.y; netPos[o+5]=pb.z; }
    ng.attributes.position.needsUpdate=true;
    for(let i=0;i<tandemPairs.length;i++){ const [a,b]=tandemPairs[i], o=i*6, pa=levels[a].g.position, pb=levels[b].g.position; tandemPos[o]=pa.x; tandemPos[o+1]=pa.y; tandemPos[o+2]=pa.z; tandemPos[o+3]=pb.x; tandemPos[o+4]=pb.y; tandemPos[o+5]=pb.z; }
    tg.attributes.position.needsUpdate=true;

    activePulseCount=0;
    for(let i=routeAnims.length-1;i>=0;i--){
      const r=routeAnims[i];
      if(now<r.t0){ r.line.material.opacity=0; r.spr.material.opacity=0; continue; }
      const p=Math.min(1,(now-r.t0)/r.dur);
      if(p>=0&&p<=1){
        const pulse=Math.sin(p*Math.PI);
        r.line.material.opacity=Math.max(r.line.material.opacity*0.92, 0.18 + pulse*0.72);
        r.spr.material.opacity=0.25 + pulse*0.85;
        r.spr.position.copy(r.a.clone().lerp(r.b,p));
        activePulseCount++;
        if(p>0.84 && r.targetLv){
          const idx=levels.findIndex(x=>x.lvl===r.targetLv);
          if(idx>=0) nodeBloom.set(idx, Math.max(nodeBloom.get(idx)||0, 0.85));
        }
      } else {
        r.spr.material.opacity=0;
        r.line.material.opacity*=0.94;
      }
      if(now>r.end){ scene.remove(r.line); scene.remove(r.spr); routeAnims.splice(i,1); }
    }
    els.p.textContent=String(activePulseCount);

    hoveredCore=false;
    raycaster.setFromCamera(pointer, camera);
    const hits=raycaster.intersectObjects(allHoverTargets, false);
    if(hits.length){
      const obj=hits[0].object;
      if(obj===coreHoverTarget){ hovered=-1; hoveredCore=true; tooltip.style.display='block'; tooltip.textContent='Cortex'; }
      else {
        const idx=hoverTargets.indexOf(obj);
        if(idx>=0){ hovered=idx; const lv=levels[idx]; tooltip.style.display='block'; tooltip.textContent=`L${String(lv.lvl).padStart(2,'0')} — ${lv.name}  [${lv.group}]`; }
      }
    } else { hovered=-1; hoveredCore=false; tooltip.style.display='none'; }

    if(hovered>=0 || hoveredCore){ const wp=hoveredCore?core.position:levels[hovered].g.position; const p=wp.clone().project(camera); tooltip.style.left=`${(p.x*0.5+0.5)*innerWidth+10}px`; tooltip.style.top=`${(-p.y*0.5+0.5)*innerHeight-10}px`; }
    renderer.render(scene,camera);
  }
  requestAnimationFrame(anim);

  addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight); camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();});
})();
</script>
</body>
</html>'''
    return HTMLResponse(html)
