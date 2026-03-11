from fastapi import APIRouter
from cortex_server.routers import sentinel

router = APIRouter()


@router.get('/status')
async def fallback_status():
    events = getattr(sentinel, '_self_heal_events', [])
    return {
        'success': True,
        'fallback_enabled': True,
        'self_heal_available': True,
        'events_total': len(events),
        'latest_event': events[-1] if events else None,
    }


@router.post('/heal')
async def fallback_heal_now():
    scan = await sentinel.scan_now()
    return {'success': True, 'trigger': 'sentinel_scan_now', 'scan': scan.get('scan')}


@router.get('/self_heal/status')
async def self_heal_status(limit: int = 20):
    return await sentinel.self_heal_status(limit=limit)
