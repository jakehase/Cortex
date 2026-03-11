"""
Night Shift Router - API endpoints for L14 Chronos night shift scheduler.

Exposes the Chronos module's nightly evolution pipeline:
Dream → Council → Materialize → Diplomat → Geneticist
"""

from datetime import datetime
from pathlib import Path
import re
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class TriggerRequest(BaseModel):
    """Optional parameters for manually triggering the night shift."""
    dry_run: bool = False
    skip_geneticist: bool = False


class TriggerResponse(BaseModel):
    triggered: bool
    message: str
    timestamp: str


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
            detail=f"Chronos module unavailable: {exc}",
        )


def _derive_last_run_date() -> Optional[str]:
    path = Path('/app/cortex_server/knowledge/evolution/changelog.txt')
    if not path.exists():
        return None
    try:
        lines = path.read_text(errors='ignore').splitlines()[-400:]
        for line in reversed(lines):
            if 'NIGHT SHIFT STARTED' in line or 'NIGHT SHIFT COMPLETE' in line:
                m = re.search(r'(\d{4}-\d{2}-\d{2})', line)
                if m:
                    return m.group(1)
    except Exception:
        return None
    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/status")
async def night_shift_status():
    """Return Chronos scheduler state, level, and next scheduled run."""
    chronos = _get_chronos()

    now = datetime.now()
    # Chronos runs at 03:00 daily
    next_run = now.replace(hour=3, minute=0, second=0, microsecond=0)
    if now >= next_run:
        # Already past 03:00 today — next run is tomorrow
        from datetime import timedelta
        next_run += timedelta(days=1)

    return {
        "success": True,
        "level": 14,
        "name": "Chronos (Night Shift)",
        "status": "running" if chronos.running else "idle",
        "last_run_date": chronos.last_run_date or _derive_last_run_date(),
        "next_scheduled_run": next_run.isoformat(),
        "capabilities": [
            "nightly_evolution_cycle",
            "dream_gap_detection",
            "council_review",
            "skill_materialization",
            "diplomat_briefing",
            "geneticist_dna_evolution",
        ],
    }


@router.post("/trigger", response_model=TriggerResponse)
async def trigger_night_shift(request: Optional[TriggerRequest] = None):
    """Manually trigger the night shift evolution cycle.

    Use ``dry_run=true`` to validate without executing side-effects.
    """
    chronos = _get_chronos()
    req = request or TriggerRequest()

    if req.dry_run:
        return TriggerResponse(
            triggered=False,
            message="Dry-run: night shift would execute but was not started.",
            timestamp=datetime.now().isoformat(),
        )

    try:
        import asyncio
        # run_night_shift is an async method on Chronos
        asyncio.ensure_future(chronos.run_night_shift())
        return TriggerResponse(
            triggered=True,
            message="Night shift cycle triggered. Check /status or changelog for progress.",
            timestamp=datetime.now().isoformat(),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to trigger night shift: {exc}")
