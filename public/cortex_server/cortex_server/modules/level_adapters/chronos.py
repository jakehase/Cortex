"""L14 Chronos adapter: read-only view of the maintenance schedule and receipts."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 14
NAME = "chronos"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 2.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.modules.chronos import get_chronos

    try:
        view = await asyncio.to_thread(get_chronos().schedule_view)
    except Exception as exc:
        raise ExecutionBlocked("chronos_state_unavailable") from exc

    last = view.get("last_completed_run")
    recent = [
        {k: run.get(k) for k in ("job", "trigger", "started_at", "status", "error_type")}
        for run in view.get("recent_runs") or ()
    ]
    held = [p.get("name") for p in view.get("held_pipelines") or ()]
    summary = (
        f"Chronos scheduler {'running' if view.get('scheduler_running') else 'not running'}; "
        f"next maintenance window {view.get('next_fire')} (local {view.get('run_at_local')}). "
        f"Safe jobs enabled: {', '.join(view.get('enabled_jobs') or []) or 'none'}. "
        + (
            f"Last completed run: {last['job']} at {last['started_at']}. "
            if last
            else "No maintenance run has completed yet. "
        )
        + f"Held (never auto-run): {', '.join(held) or 'none'}. "
        "Chronos does not schedule user reminders or arbitrary tasks (that is L8 Cron)."
    )
    return {
        "operation": "chronos.schedule_view",
        "origin": "deterministic",
        "summary": summary[:1500],
        "data": {
            "scheduler_running": view.get("scheduler_running"),
            "next_fire": view.get("next_fire"),
            "enabled_jobs": view.get("enabled_jobs"),
            "held_pipelines": held,
            "last_run_date": view.get("last_run_date"),
            "recent_runs": recent,
        },
    }
