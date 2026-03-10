"""
HUD Middleware - Automated Level Activation Display

Automatically appends activation/contract metadata to successful JSON responses.
Never injects metadata into non-success responses (4xx/5xx).
"""
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse
from typing import Dict, List, Any
import json

# Track activated levels per request
_request_levels: Dict[str, List[Dict[str, Any]]] = {}

# Minimal route-to-level map used only when a router doesn't explicitly track levels.
_ROUTE_LEVEL_HINTS: Dict[str, Dict[str, Any]] = {
    "nexus": {"level": 24, "name": "nexus"},
    "conductor": {"level": 36, "name": "conductor"},
    "oracle": {"level": 5, "name": "oracle"},
    "librarian": {"level": 7, "name": "librarian"},
    "muse": {"level": 29, "name": "muse"},
    "dreamer": {"level": 13, "name": "dreamer"},
    "synthesist": {"level": 32, "name": "synthesist"},
}

CONTRACT_IDENTITY_PHRASE = "Cortex-first orchestration active"


class HUDMiddleware(BaseHTTPMiddleware):
    """Middleware to automatically add contract metadata to successful JSON responses."""

    async def dispatch(self, request: Request, call_next):
        request_id = str(id(request))
        _request_levels[request_id] = []

        request.state.hud_request_id = request_id
        request.state.activated_levels = []

        response = await call_next(request)

        # Never inject metadata on non-success responses.
        if getattr(response, "status_code", 500) >= 400:
            if hasattr(request.state, "activated_levels"):
                request.state.activated_levels = []
        else:
            explicit_levels = request.state.activated_levels if hasattr(request.state, "activated_levels") else []
            levels = self._ensure_levels_for_success_path(request, explicit_levels)
            response = await self._add_hud_to_response(response, levels)

        if request_id in _request_levels:
            del _request_levels[request_id]

        return response

    def _ensure_levels_for_success_path(self, request: Request, levels: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if levels:
            return levels

        path = (request.url.path or "").strip("/")
        root = path.split("/")[0] if path else ""
        hint = _ROUTE_LEVEL_HINTS.get(root)
        if hint:
            return [{
                "level": hint["level"],
                "name": hint["name"],
                "derived_from": "route",
                "always_on": False,
            }]
        return []

    async def _add_hud_to_response(self, response: Response, levels: List[Dict[str, Any]]) -> Response:
        content_type = (response.headers.get("content-type") or "").lower()
        if not content_type.startswith("application/json"):
            return response

        try:
            body_bytes = getattr(response, "body", None)
            if body_bytes is None and hasattr(response, "body_iterator"):
                chunks = []
                async for chunk in response.body_iterator:
                    chunks.append(chunk)
                body_bytes = b"".join(chunks)
                if not body_bytes:
                    return response

            if body_bytes is None:
                return response

            body = json.loads(body_bytes.decode())
            if not isinstance(body, dict):
                return response

            if levels:
                hud_parts = []
                for lvl in levels[:5]:
                    level_num = lvl.get("level", "?")
                    name = lvl.get("name", "Unknown").title()
                    hud_parts.append(f"🟢 L{level_num} ({name})")
                body.setdefault("hud", " | ".join(hud_parts))
                body["activated_levels"] = levels

            existing_contract = body.get("contract") if isinstance(body.get("contract"), dict) else {}
            computed_source = "explicit" if levels and not levels[0].get("derived_from") else ("derived" if levels else "none")
            source = existing_contract.get("activation_metadata_source") or computed_source
            available = bool(existing_contract.get("activation_metadata_available", True))
            if available and source == "none":
                source = computed_source if computed_source != "none" else "derived"
            body["contract"] = {
                "identity_phrase": existing_contract.get("identity_phrase", CONTRACT_IDENTITY_PHRASE),
                "activation_metadata_available": available,
                "activation_metadata_source": source,
            }

            new_body = json.dumps(body).encode()
            headers = dict(response.headers)
            headers["content-length"] = str(len(new_body))
            return StarletteResponse(content=new_body, status_code=response.status_code, headers=headers, media_type="application/json")
        except Exception:
            return response


def track_level(request: Request, level: int, name: str, always_on: bool = False):
    """Track that a level was activated during this request."""
    if hasattr(request.state, "activated_levels"):
        existing = [l for l in request.state.activated_levels if l.get("level") == level]
        if not existing:
            request.state.activated_levels.append({
                "level": level,
                "name": name,
                "always_on": always_on,
            })


def get_activated_levels(request: Request) -> List[Dict[str, Any]]:
    """Get list of activated levels for this request."""
    return getattr(request.state, "activated_levels", [])
