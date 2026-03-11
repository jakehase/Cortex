"""Unified automation observability endpoint."""
from datetime import datetime
from typing import Any, Dict

import httpx
from fastapi import APIRouter

router = APIRouter()


async def _safe_get(client: httpx.AsyncClient, path: str) -> Dict[str, Any]:
    try:
        r = await client.get(f"http://127.0.0.1:8888{path}", timeout=4.5)
        return {"ok": r.status_code == 200, "status": r.status_code, "body": (r.json() if r.content else {})}
    except Exception as e:
        return {"ok": False, "status": 0, "error": f"{type(e).__name__}:{e}"}


@router.get('/status')
async def automation_status():
    async with httpx.AsyncClient() as client:
        cron = await _safe_get(client, '/cron/status')
        jobs = await _safe_get(client, '/cron/jobs')
        sentinel = await _safe_get(client, '/sentinel/scheduler/status')
        awareness = await _safe_get(client, '/awareness/status')
        night_shift = await _safe_get(client, '/night_shift/status')

    cron_jobs_count = len((jobs.get("body", {}) or [])) if isinstance(jobs.get("body"), list) else len((jobs.get("body", {}).get("jobs", []) if isinstance(jobs.get("body", {}), dict) else []))
    sentinel_running = bool(((sentinel.get("body") or {}).get("running")) if isinstance(sentinel.get("body"), dict) else False)
    awareness_running = bool(((awareness.get("body") or {}).get("loop_running")) if isinstance(awareness.get("body"), dict) else False)
    night_shift_running = str(((night_shift.get("body") or {}).get("status", "")).lower()) in {"running", "active"}

    return {
        "success": True,
        "level": 36,
        "name": "Automation Observability",
        "timestamp": datetime.now().isoformat(),
        "overall": "healthy" if all([cron.get("ok"), sentinel.get("ok"), awareness.get("ok"), night_shift.get("ok")]) else "degraded",
        "automation": {
            "cron_api": {"reachable": cron.get("ok"), "scheduled_jobs": ((cron.get("body") or {}).get("scheduled_jobs") if isinstance(cron.get("body"), dict) else None), "jobs_list_count": cron_jobs_count},
            "sentinel_scheduler": {"reachable": sentinel.get("ok"), "running": sentinel_running},
            "awareness_loop": {"reachable": awareness.get("ok"), "running": awareness_running, "tick_interval": ((awareness.get("body") or {}).get("tick_interval") if isinstance(awareness.get("body"), dict) else None)},
            "night_shift": {"reachable": night_shift.get("ok"), "running": night_shift_running, "next_scheduled_run": ((night_shift.get("body") or {}).get("next_scheduled_run") if isinstance(night_shift.get("body"), dict) else None)},
        },
        "sources": {
            "cron": cron,
            "cron_jobs": jobs,
            "sentinel_scheduler": sentinel,
            "awareness": awareness,
            "night_shift": night_shift,
        },
        "notes": [
            "Host-level cron/systemd timers may still exist outside container visibility.",
            "Use this endpoint as canonical in-app automation inventory.",
        ],
    }
