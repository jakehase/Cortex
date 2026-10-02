"""Chronos compatibility router (L14)."""
from cortex_server.routers.night_shift import night_shift_status, trigger_night_shift
from fastapi import APIRouter, Depends
from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    require_action_capability,
)

router = APIRouter()

@router.get('/status')
async def chronos_status():
    return await night_shift_status()

@router.post('/trigger')
async def chronos_trigger(
    authorization: ActionAuthorization = Depends(require_action_capability),
):
    return await trigger_night_shift(authorization=authorization)
