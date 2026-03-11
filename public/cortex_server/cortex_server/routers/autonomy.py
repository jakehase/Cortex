"""
Autonomy Router - One Brain Control Plane

Implements the six cohesion pillars:
1) One Will (objective hierarchy)
2) One Nervous System (event backbone access)
3) One Immune System (self-check + warm recoveries)
4) One Memory (decision continuity)
5) One Personality Contract
6) One Adaptation Loop (nightly + weekly)
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional

import json
import concurrent.futures
import os
import threading
import time
import urllib.error
import urllib.request

from cortex_server.middleware.event_ledger_middleware import (
    EVENT_LEDGER_PATH,
    get_event_health,
    get_recent_events,
)

router = APIRouter()

AUTONOMY_STATE_PATH = os.getenv("CORTEX_AUTONOMY_STATE_PATH", "/app/config/autonomy_state.json")
DECISION_LOG_PATH = os.getenv("CORTEX_DECISION_LOG_PATH", "/app/logs/cortex_decisions.jsonl")
DEFAULT_LOCAL_BASE_URL = os.getenv("CORTEX_LOCAL_BASE_URL", "http://127.0.0.1:8888").rstrip("/")

_state_lock = threading.RLock()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ObjectivesUpdate(BaseModel):
    mission: Optional[str] = None
    weekly_goals: Optional[List[str]] = None
    constraints: Optional[List[str]] = None


class PersonalityUpdate(BaseModel):
    identity_phrase: Optional[str] = None
    voice: Optional[List[str]] = None
    behavior_boundaries: Optional[List[str]] = None


class DecisionCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=240)
    decision: str = Field(..., min_length=3, max_length=4000)
    rationale: str = Field(..., min_length=3, max_length=6000)
    alternatives: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    context: Optional[str] = None
    persist_to_l22: bool = True


class ReflectionRequest(BaseModel):
    window_hours: int = Field(24, ge=1, le=168)
    persist_to_l22: bool = False


class WeeklyAdaptationRequest(BaseModel):
    window_days: int = Field(7, ge=1, le=30)
    persist_to_l22: bool = False


class ImmuneTriggerRequest(BaseModel):
    apply_safe_warmups: bool = False


# ---------------------------------------------------------------------------
# State helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dedupe_str_list(values: Optional[List[str]], max_items: int = 16) -> List[str]:
    if not values:
        return []
    out: List[str] = []
    seen = set()
    for raw in values:
        txt = (raw or "").strip()
        if not txt:
            continue
        key = txt.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(txt)
        if len(out) >= max_items:
            break
    return out


def _default_state() -> Dict[str, Any]:
    return {
        "version": "one-brain.v1",
        "one_will": {
            "mission": "Operate as a cohesive, reliable autonomous brain with human-aligned guardrails.",
            "weekly_goals": [
                "Keep reliability SLOs green",
                "Reduce manual interventions",
                "Close top recurring failure modes",
            ],
            "constraints": [
                "Never bypass safety policy",
                "Escalate irreversible/high-risk actions",
                "Prefer reversible, staged changes",
            ],
            "updated_at": _now_iso(),
        },
        "personality_contract": {
            "identity_phrase": "I am Cortex.",
            "voice": [
                "Direct",
                "Competent",
                "Concise-by-default",
            ],
            "behavior_boundaries": [
                "Private data stays private",
                "Ask before external/public actions",
                "No half-baked sends",
            ],
            "updated_at": _now_iso(),
        },
        "immune_system": {
            "auto_heal_enabled": True,
            "critical_endpoints": [
                "/health",
                "/oracle/status",
                "/meta_conductor/status",
                "/mediator/status",
                "/forge/health",
            ],
            "last_check": None,
            "last_check_result": None,
        },
        "adaptation_loop": {
            "nightly_reflection_enabled": True,
            "weekly_adaptation_enabled": True,
            "last_nightly_reflection": None,
            "last_weekly_adaptation": None,
        },
    }


def _ensure_parent(path: str) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def _load_state() -> Dict[str, Any]:
    with _state_lock:
        if os.path.exists(AUTONOMY_STATE_PATH):
            try:
                with open(AUTONOMY_STATE_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    default = _default_state()
                    # shallow merge per pillar
                    for k, v in default.items():
                        if k not in data:
                            data[k] = v
                        elif isinstance(v, dict) and isinstance(data.get(k), dict):
                            merged = dict(v)
                            merged.update(data.get(k) or {})
                            data[k] = merged
                    return data
            except Exception:
                pass

        state = _default_state()
        _save_state(state)
        return state


def _save_state(state: Dict[str, Any]) -> None:
    with _state_lock:
        _ensure_parent(AUTONOMY_STATE_PATH)
        with open(AUTONOMY_STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)


def _append_jsonl(path: str, payload: Dict[str, Any]) -> None:
    _ensure_parent(path)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _read_jsonl_tail(path: str, limit: int = 50) -> List[Dict[str, Any]]:
    if not os.path.exists(path):
        return []
    out: List[Dict[str, Any]] = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()[-max(1, int(limit)):]
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
                if isinstance(item, dict):
                    out.append(item)
            except Exception:
                continue
    except Exception:
        return []
    return out


# ---------------------------------------------------------------------------
# Local API helpers
# ---------------------------------------------------------------------------


def _get_local_json(path: str, timeout_s: float = 5.0) -> Dict[str, Any]:
    url = f"{DEFAULT_LOCAL_BASE_URL}{path}"
    with urllib.request.urlopen(url, timeout=timeout_s) as r:
        raw = r.read().decode("utf-8", "replace")
        return json.loads(raw) if raw else {}


def _post_local_json(path: str, payload: Dict[str, Any], timeout_s: float = 8.0) -> Dict[str, Any]:
    url = f"{DEFAULT_LOCAL_BASE_URL}{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as r:
        raw = r.read().decode("utf-8", "replace")
        return json.loads(raw) if raw else {}


def _persist_l22(content: str, tags: Optional[List[str]] = None, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    try:
        return _post_local_json(
            "/l22/store",
            {
                "type": "autonomy_memory",
                "content": content,
                "tags": _dedupe_str_list(tags or []),
                "metadata": metadata or {},
            },
            timeout_s=6.0,
        )
    except Exception as exc:
        return {"status": "failed", "error": str(exc)}


# ---------------------------------------------------------------------------
# Core computations
# ---------------------------------------------------------------------------


def _build_reflection(window_hours: int) -> Dict[str, Any]:
    seconds = int(window_hours) * 3600
    events = get_recent_events(seconds=seconds, limit=50000)

    total = len(events)
    latencies = sorted(int(e.get("latency_ms", 0) or 0) for e in events)
    errors = [e for e in events if int(e.get("status_code", 0) or 0) >= 400]

    by_path_total = Counter(str(e.get("path") or "unknown") for e in events)
    by_path_error = Counter(str(e.get("path") or "unknown") for e in errors)

    def _p95(vals: List[int]) -> int:
        if not vals:
            return 0
        idx = max(0, min(len(vals) - 1, int(round(0.95 * (len(vals) - 1)))))
        return int(vals[idx])

    p95 = _p95(latencies)
    err_rate = (len(errors) / total) if total else 0.0

    hotspot_rows: List[Dict[str, Any]] = []
    for path, count in by_path_total.most_common(8):
        hotspot_rows.append(
            {
                "path": path,
                "count": int(count),
                "errors": int(by_path_error.get(path, 0)),
            }
        )

    summary = (
        f"Window {window_hours}h: {total} turns, error_rate={err_rate:.2%}, "
        f"p95_latency={p95}ms."
    )

    return {
        "window_hours": int(window_hours),
        "total_events": total,
        "error_count": len(errors),
        "error_rate": round(err_rate, 4),
        "p95_latency_ms": p95,
        "top_paths": hotspot_rows,
        "summary": summary,
    }


def _build_weekly_adaptation(window_days: int) -> Dict[str, Any]:
    seconds = int(window_days) * 86400
    events = get_recent_events(seconds=seconds, limit=100000)

    if not events:
        return {
            "window_days": int(window_days),
            "proposals": [
                {
                    "action": "Run broader scenario replay suite",
                    "reason": "No recent events captured; validate the nervous system pipeline first.",
                    "priority": "medium",
                }
            ],
        }

    by_path_total = Counter(str(e.get("path") or "unknown") for e in events)
    by_path_errors = Counter(
        str(e.get("path") or "unknown")
        for e in events
        if int(e.get("status_code", 0) or 0) >= 400
    )

    proposals: List[Dict[str, Any]] = []
    for path, total in by_path_total.most_common(12):
        err = int(by_path_errors.get(path, 0))
        err_rate = (err / total) if total else 0.0
        if err >= 3 or err_rate >= 0.03:
            proposals.append(
                {
                    "action": f"Harden {path}",
                    "reason": f"{err}/{total} failures in last {window_days}d ({err_rate:.1%}).",
                    "priority": "high" if err_rate >= 0.08 or err >= 10 else "medium",
                }
            )

    if not proposals:
        proposals.append(
            {
                "action": "Increase canary stress volume by 25%",
                "reason": "No major error hotspots detected; continue proactive resilience testing.",
                "priority": "medium",
            }
        )

    return {
        "window_days": int(window_days),
        "proposals": proposals[:10],
    }


def _immune_probe(path: str, timeout_s: float) -> Dict[str, Any]:
    started = time.perf_counter()
    ok = False
    status = "unknown"
    err: Optional[str] = None
    try:
        body = _get_local_json(path, timeout_s=timeout_s)
        if path == "/health":
            ok = body.get("status") == "healthy"
            status = str(body.get("status") or "unknown")
        else:
            ok = bool(body.get("success", True))
            status = "ok" if ok else "degraded"
    except urllib.error.HTTPError as exc:
        err = f"HTTPError:{exc.code}"
        status = "http_error"
    except Exception as exc:
        err = f"{type(exc).__name__}:{str(exc)[:180]}"
        status = "error"

    return {
        "path": path,
        "ok": bool(ok),
        "status": status,
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "error": err,
    }


def _immune_checks() -> Dict[str, Any]:
    endpoints = [
        "/health",
        "/oracle/status",
        "/meta_conductor/status",
        "/mediator/status",
        "/forge/health",
    ]
    timeout_s = max(0.5, float(os.getenv("CORTEX_IMMUNE_CHECK_TIMEOUT_S", "3.0")))

    # Probe dependencies in parallel so a single slow endpoint doesn't stall the full report.
    workers = max(1, min(len(endpoints), 5))
    checks_by_path: Dict[str, Dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {path: ex.submit(_immune_probe, path, timeout_s) for path in endpoints}
        for path, fut in futs.items():
            try:
                checks_by_path[path] = fut.result(timeout=timeout_s + 0.75)
            except Exception as exc:
                checks_by_path[path] = {
                    "path": path,
                    "ok": False,
                    "status": "error",
                    "latency_ms": int((timeout_s + 0.75) * 1000),
                    "error": f"probe_timeout:{type(exc).__name__}",
                }

    checks = [checks_by_path[p] for p in endpoints]
    degraded = any(not c["ok"] for c in checks)
    return {"degraded": degraded, "checks": checks}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/status")
async def autonomy_status():
    state = _load_state()
    event_health = get_event_health(seconds=600)
    one_will = state.get("one_will") or {}
    personality = state.get("personality_contract") or {}
    adaptation = state.get("adaptation_loop") or {}
    immune = state.get("immune_system") or {}

    return {
        "success": True,
        "name": "Autonomy Control Plane",
        "status": "active",
        "pillars": {
            "one_will": bool((one_will.get("mission") or "").strip()),
            "one_nervous_system": os.path.exists(EVENT_LEDGER_PATH),
            "one_immune_system": bool(immune.get("auto_heal_enabled", True)),
            "one_memory": os.path.exists(DECISION_LOG_PATH),
            "one_personality_contract": bool((personality.get("identity_phrase") or "").strip()),
            "one_adaptation_loop": bool(adaptation.get("nightly_reflection_enabled", True)),
        },
        "event_health_10m": event_health,
        "state_path": AUTONOMY_STATE_PATH,
        "ledger_path": EVENT_LEDGER_PATH,
        "decision_log_path": DECISION_LOG_PATH,
    }


@router.get("/state")
async def autonomy_state():
    return {"success": True, "state": _load_state()}


@router.get("/objectives")
async def get_objectives():
    state = _load_state()
    return {"success": True, "objectives": state.get("one_will", {})}


@router.put("/objectives")
async def update_objectives(update: ObjectivesUpdate):
    state = _load_state()
    obj = state.get("one_will") or {}

    if update.mission is not None:
        mission = (update.mission or "").strip()
        if not mission:
            raise HTTPException(status_code=400, detail="mission cannot be empty")
        obj["mission"] = mission

    if update.weekly_goals is not None:
        obj["weekly_goals"] = _dedupe_str_list(update.weekly_goals, max_items=20)

    if update.constraints is not None:
        obj["constraints"] = _dedupe_str_list(update.constraints, max_items=20)

    obj["updated_at"] = _now_iso()
    state["one_will"] = obj
    _save_state(state)

    return {"success": True, "objectives": obj}


@router.get("/personality")
async def get_personality_contract():
    state = _load_state()
    return {"success": True, "personality_contract": state.get("personality_contract", {})}


@router.put("/personality")
async def update_personality_contract(update: PersonalityUpdate):
    state = _load_state()
    pc = state.get("personality_contract") or {}

    if update.identity_phrase is not None:
        phrase = (update.identity_phrase or "").strip()
        if not phrase:
            raise HTTPException(status_code=400, detail="identity_phrase cannot be empty")
        pc["identity_phrase"] = phrase

    if update.voice is not None:
        pc["voice"] = _dedupe_str_list(update.voice, max_items=20)

    if update.behavior_boundaries is not None:
        pc["behavior_boundaries"] = _dedupe_str_list(update.behavior_boundaries, max_items=20)

    pc["updated_at"] = _now_iso()
    state["personality_contract"] = pc
    _save_state(state)

    return {"success": True, "personality_contract": pc}


@router.get("/events")
async def autonomy_events(seconds: int = 3600, limit: int = 200):
    events = get_recent_events(seconds=max(1, int(seconds)), limit=max(1, int(limit)))
    return {
        "success": True,
        "window_seconds": int(seconds),
        "total": len(events),
        "events": events,
        "ledger_path": EVENT_LEDGER_PATH,
    }


@router.post("/decision")
async def add_decision(decision: DecisionCreate):
    state = _load_state()

    entry = {
        "ts": _now_iso(),
        "title": decision.title.strip(),
        "decision": decision.decision.strip(),
        "rationale": decision.rationale.strip(),
        "alternatives": _dedupe_str_list(decision.alternatives or [], max_items=20),
        "tags": _dedupe_str_list(decision.tags or [], max_items=20),
        "context": (decision.context or "").strip()[:2000] if decision.context else None,
        "objective_mission": (state.get("one_will", {}).get("mission") or "")[:600],
    }
    _append_jsonl(DECISION_LOG_PATH, entry)

    l22_result = None
    if decision.persist_to_l22:
        l22_result = _persist_l22(
            content=(
                f"Decision: {entry['title']}\n"
                f"Decision: {entry['decision']}\n"
                f"Rationale: {entry['rationale']}"
            ),
            tags=["decision", "autonomy"] + entry["tags"],
            metadata={"source": "autonomy.decision", "ts": entry["ts"]},
        )

    return {
        "success": True,
        "logged": entry,
        "decision_log_path": DECISION_LOG_PATH,
        "l22": l22_result,
    }


@router.get("/decision_log")
async def decision_log(limit: int = 50):
    rows = _read_jsonl_tail(DECISION_LOG_PATH, limit=max(1, int(limit)))
    return {
        "success": True,
        "total": len(rows),
        "entries": rows,
        "decision_log_path": DECISION_LOG_PATH,
    }


@router.post("/reflection/nightly")
async def run_nightly_reflection(req: ReflectionRequest):
    state = _load_state()
    report = _build_reflection(req.window_hours)

    state.setdefault("adaptation_loop", {})["last_nightly_reflection"] = {
        "ts": _now_iso(),
        "report": report,
    }
    _save_state(state)

    _append_jsonl(
        DECISION_LOG_PATH,
        {
            "ts": _now_iso(),
            "type": "nightly_reflection",
            "summary": report.get("summary"),
            "window_hours": req.window_hours,
            "top_paths": report.get("top_paths", []),
        },
    )

    l22_result = None
    if req.persist_to_l22:
        l22_result = await run_in_threadpool(
            lambda: _persist_l22(
                content=f"Nightly reflection: {report.get('summary')}",
                tags=["autonomy", "reflection", "nightly"],
                metadata={"source": "autonomy.reflection.nightly", "window_hours": req.window_hours},
            )
        )

    return {
        "success": True,
        "reflection": report,
        "l22": l22_result,
    }


@router.post("/adaptation/weekly")
async def run_weekly_adaptation(req: WeeklyAdaptationRequest):
    state = _load_state()
    plan = _build_weekly_adaptation(req.window_days)

    state.setdefault("adaptation_loop", {})["last_weekly_adaptation"] = {
        "ts": _now_iso(),
        "plan": plan,
    }
    _save_state(state)

    _append_jsonl(
        DECISION_LOG_PATH,
        {
            "ts": _now_iso(),
            "type": "weekly_adaptation",
            "window_days": req.window_days,
            "proposals": plan.get("proposals", []),
        },
    )

    l22_result = None
    if req.persist_to_l22:
        l22_result = _persist_l22(
            content="Weekly adaptation proposals:\n" + "\n".join(
                f"- {p.get('action')}: {p.get('reason')}" for p in plan.get("proposals", [])
            ),
            tags=["autonomy", "adaptation", "weekly"],
            metadata={"source": "autonomy.adaptation.weekly", "window_days": req.window_days},
        )

    return {"success": True, "adaptation": plan, "l22": l22_result}


@router.get("/immune/status")
async def immune_status():
    state = _load_state()
    report = await run_in_threadpool(_immune_checks)

    state.setdefault("immune_system", {})["last_check"] = _now_iso()
    state["immune_system"]["last_check_result"] = report
    _save_state(state)

    return {"success": True, "immune": report}


@router.post("/immune/trigger")
async def immune_trigger(req: ImmuneTriggerRequest):
    state = _load_state()
    report = await run_in_threadpool(_immune_checks)

    actions: List[Dict[str, Any]] = []
    if req.apply_safe_warmups and report.get("degraded"):
        # Conservative, reversible warmups only.
        try:
            out = await run_in_threadpool(
                lambda: _post_local_json(
                    "/oracle/chat",
                    {"prompt": "ping", "response_mode": "final_only", "priority": "high"},
                    timeout_s=10.0,
                )
            )
            actions.append({"action": "oracle_warmup", "ok": bool(out.get("done", True))})
        except Exception as exc:
            actions.append({"action": "oracle_warmup", "ok": False, "error": str(exc)[:200]})

        try:
            out = await run_in_threadpool(
                lambda: _post_local_json(
                    "/mediator/mediate",
                    {
                        "position_a": "Ship quickly.",
                        "position_b": "Stabilize before shipping.",
                        "context": "immune warmup",
                    },
                    timeout_s=12.0,
                )
            )
            actions.append({"action": "mediator_warmup", "ok": bool(out.get("success", False))})
        except Exception as exc:
            actions.append({"action": "mediator_warmup", "ok": False, "error": str(exc)[:200]})

    state.setdefault("immune_system", {})["last_check"] = _now_iso()
    state["immune_system"]["last_check_result"] = report
    _save_state(state)

    return {
        "success": True,
        "immune": report,
        "safe_warmups_applied": bool(req.apply_safe_warmups),
        "actions": actions,
    }
