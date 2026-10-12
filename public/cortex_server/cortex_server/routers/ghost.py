"""Ghost compatibility router (alias to the active Browser contract)."""
from fastapi import APIRouter, Request

from cortex_server.routers.browser import browser_status_payload

router = APIRouter()


@router.get('/status')
async def ghost_status(request: Request):
    # Same body as /browser/status: derived from mounted routes and the real
    # egress configuration, never a literal "active".
    payload = browser_status_payload(request.app)
    payload['alias_of'] = '/browser/status'
    return payload
