"""
Night Shift Router - API endpoints for L14 Chronos.

Chronos runs a registry of safe in-process maintenance jobs on a daily
schedule and records a durable receipt for every run. The legacy autonomous
evolution pipeline (Dream -> Council -> Materialize -> Diplomat -> Geneticist)
is reported as *held*: it is never executed and never advertised as a
capability.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    assert_action_authorized,
    require_action_capability_unless_dry_run,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class TriggerRequest(BaseModel):
    """Parameters for manually triggering Chronos.

    ``job`` names one safe maintenance job (or ``"all_safe"``). Without a job
    the request targets the legacy evolution pipeline, which is held.
    """

    model_config = ConfigDict(extra="forbid")
    dry_run: bool = Field(default=False, strict=True)
    skip_geneticist: bool = False
    job: Optional[str] = Field(default=None, max_length=64)


class TriggerResponse(BaseModel):
    triggered: bool
    message: str
    timestamp: str
    would_execute: Optional[bool] = None
    reason: Optional[str] = None
    jobs: Optional[List[str]] = None
    runs: Optional[List[Dict[str, Any]]] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_chronos():
    """Lazy import to avoid circular deps at module load time."""
    try:
        from cortex_server.modules.chronos import get_chronos
        return get_chronos()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Chronos module unavailable: {type(exc).__name__}",
        )


def _resolve_jobs(job: str) -> List[str]:
    from cortex_server.modules.chronos import enabled_jobs

    enabled = enabled_jobs()
    if job == "all_safe":
        return enabled
    if job not in enabled:
        raise HTTPException(
            status_code=400,
            detail={"error": "unknown_or_disabled_job", "job": job, "enabled_jobs": enabled},
        )
    return [job]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/status")
async def night_shift_status():
    """Return Chronos scheduler state, enabled safe jobs and real run receipts."""
    chronos = _get_chronos()
    view = chronos.schedule_view()
    last = view.get("last_completed_run")
    return {
        "success": True,
        "level": 14,
        "name": "Chronos (Night Shift)",
        "status": "running" if chronos.running else "idle",
        "scheduler_running": chronos.running,
        "last_run_date": view.get("last_run_date"),
        "last_completed_run": last,
        "last_scheduled_attempt_at": getattr(chronos, "last_scheduled_attempt_at", None),
        "next_scheduled_run": view.get("next_fire"),
        "run_at_local": view.get("run_at_local"),
        # Only jobs that /night_shift/trigger will actually run.
        "capabilities": view.get("enabled_jobs"),
        "held_pipelines": view.get("held_pipelines"),
        "recent_runs": view.get("recent_runs"),
    }


@router.get("/runs")
async def night_shift_runs(limit: int = 20):
    """Durable run receipts (most recent first)."""
    chronos = _get_chronos()
    bounded = max(1, min(int(limit), 200))
    runs = chronos.recent_runs(bounded)
    return {"success": True, "count": len(runs), "runs": runs}


@router.post("/trigger", response_model=TriggerResponse)
async def trigger_night_shift(
    request: Optional[TriggerRequest] = None,
    authorization: ActionAuthorization = Depends(
        require_action_capability_unless_dry_run
    ),
):
    """Run safe maintenance jobs, or report that the legacy pipeline is held.

    Use ``dry_run=true`` to see what would run without executing anything.
    """
    req = request or TriggerRequest()

    if req.job:
        jobs = _resolve_jobs(req.job.strip())
        if req.dry_run:
            assert_action_authorized(authorization, allow_dry_run=True)
            return TriggerResponse(
                triggered=False,
                message="Dry-run: these safe maintenance jobs would run; nothing was executed.",
                timestamp=datetime.now().isoformat(),
                would_execute=True,
                reason="safe_jobs",
                jobs=jobs,
            )
        assert_action_authorized(authorization)
        chronos = _get_chronos()
        runs = await chronos.run_safe_jobs(jobs, trigger="manual")
        succeeded = sum(1 for run in runs if run["status"] == "succeeded")
        return TriggerResponse(
            triggered=succeeded > 0,
            message=f"{succeeded}/{len(runs)} safe maintenance jobs succeeded.",
            timestamp=datetime.now().isoformat(),
            would_execute=True,
            reason="safe_jobs",
            jobs=jobs,
            runs=runs,
        )

    if req.dry_run:
        assert_action_authorized(authorization, allow_dry_run=True)
        return TriggerResponse(
            triggered=False,
            message="Dry-run: the legacy night-shift pipeline is held and would NOT execute.",
            timestamp=datetime.now().isoformat(),
            would_execute=False,
            reason="pipeline_held",
        )

    assert_action_authorized(authorization)
    # An HTTP receipt expires within two minutes and cannot safely escape into
    # an unbounded background coroutine.  The legacy multi-sink pipeline stays
    # closed until each sink consumes its own delegated capability.
    raise HTTPException(
        status_code=503,
        detail=(
            "manual night shift execution is disabled until background work "
            "consumes a delegated action capability"
        ),
    )
