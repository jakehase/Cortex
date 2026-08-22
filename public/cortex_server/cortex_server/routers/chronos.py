"""Chronos compatibility router (L14)."""
from cortex_server.routers.night_shift import night_shift_status, trigger_night_shift
from fastapi import APIRouter

router = APIRouter()

@router.get('/status')
async def chronos_status():
    return await night_shift_status()

@router.post('/trigger')
async def chronos_trigger():
    return await trigger_night_shift()
