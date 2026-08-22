"""Ghost compatibility router (alias to browser)."""
from fastapi import APIRouter

router = APIRouter()

@router.get('/status')
async def ghost_status():
    return {
        'success': True,
        'level': 2,
        'name': 'Ghost (Browser)',
        'status': 'active',
        'capabilities': ['web_search','web_browse','screenshot'],
        'alias_of': 'browser/status'
    }
