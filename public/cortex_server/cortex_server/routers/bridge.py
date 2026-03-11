"""Bridge Router — L25 external federation / connection (safe-by-default)

Minimal safe remediation:
- Allowlist destinations (domains + optional explicit IPs)
- Auth token for connect/relay
- Timeout caps + basic rate limiting
- Optional persistence of connections

Design goal: This should be safe enough to be callable by Nexus/Orchestrator/Oracle *behind feature flags*.
"""

from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional, Any
import os
import json
import time
from collections import deque
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, HttpUrl

router = APIRouter()

# ---------------------------------------------------------------------------
# Config (env)
# ---------------------------------------------------------------------------

BRIDGE_ENABLED = os.getenv("BRIDGE_ENABLED", "false").lower() in ("1", "true", "yes")
BRIDGE_TOKEN = os.getenv("BRIDGE_TOKEN", "")
BRIDGE_ALLOWLIST = [h.strip().lower() for h in os.getenv("BRIDGE_ALLOWLIST", "").split(",") if h.strip()]
BRIDGE_PERSIST_ENABLED = os.getenv("BRIDGE_PERSIST_ENABLED", "false").lower() in ("1", "true", "yes")
BRIDGE_PERSIST_PATH = os.getenv("BRIDGE_PERSIST_PATH", "/app/config/bridge_connections.json")

# rate limiting (very simple sliding window)
RATE_LIMIT_WINDOW_S = float(os.getenv("BRIDGE_RATE_WINDOW_S", "60"))
RATE_LIMIT_MAX = int(os.getenv("BRIDGE_RATE_MAX", "30"))

# timeout caps
TIMEOUT_MIN_S = float(os.getenv("BRIDGE_TIMEOUT_MIN_S", "1"))
TIMEOUT_MAX_S = float(os.getenv("BRIDGE_TIMEOUT_MAX_S", "12"))

# response size cap (bytes)
RESPONSE_MAX_CHARS = int(os.getenv("BRIDGE_RESPONSE_MAX_CHARS", "8000"))

# ---------------------------------------------------------------------------
# In-memory connection registry + stats
# ---------------------------------------------------------------------------

_connections: Dict[str, dict] = {}
_relay_events: deque = deque(maxlen=500)  # timestamps


def _require_enabled():
    if not BRIDGE_ENABLED:
        raise HTTPException(status_code=503, detail="Bridge disabled (set BRIDGE_ENABLED=true)")


def _require_token(x_bridge_token: Optional[str]):
    # If token isn't configured, treat as disabled for safety.
    if not BRIDGE_TOKEN:
        raise HTTPException(status_code=503, detail="Bridge token not configured")
    if not x_bridge_token or x_bridge_token != BRIDGE_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid bridge token")


def _persist_save():
    if not BRIDGE_PERSIST_ENABLED:
        return
    try:
        Path(BRIDGE_PERSIST_PATH).parent.mkdir(parents=True, exist_ok=True)
        Path(BRIDGE_PERSIST_PATH).write_text(json.dumps({"connections": list(_connections.values())}, indent=2), encoding="utf-8")
    except Exception:
        pass


def _persist_load():
    if not BRIDGE_PERSIST_ENABLED:
        return
    try:
        p = Path(BRIDGE_PERSIST_PATH)
        if not p.exists():
            return
        data = json.loads(p.read_text(encoding="utf-8"))
        items = data.get("connections") or []
        if isinstance(items, list):
            for c in items:
                if isinstance(c, dict) and c.get("id") and c.get("url"):
                    _connections[c["id"]] = c
    except Exception:
        pass


def _rate_limit_ok() -> bool:
    now = time.time()
    # drop old
    while _relay_events and (now - _relay_events[0]) > RATE_LIMIT_WINDOW_S:
        _relay_events.popleft()
    return len(_relay_events) < RATE_LIMIT_MAX


def _allowlisted(url: str) -> bool:
    if not BRIDGE_ALLOWLIST:
        return False
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    # exact match or subdomain match
    for allowed in BRIDGE_ALLOWLIST:
        if host == allowed or host.endswith("." + allowed):
            return True
    return False


def _clamp_timeout(t: float) -> float:
    try:
        t = float(t)
    except Exception:
        t = TIMEOUT_MAX_S
    return max(TIMEOUT_MIN_S, min(TIMEOUT_MAX_S, t))


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ConnectRequest(BaseModel):
    name: str
    url: HttpUrl
    capabilities: List[str] = []
    description: Optional[str] = None


class ConnectResponse(BaseModel):
    success: bool
    connection_id: str
    message: str


class RelayRequest(BaseModel):
    connection_id: str
    query: str
    payload: Optional[dict] = None
    timeout_seconds: float = 8.0


class RelayResponse(BaseModel):
    success: bool
    connection_id: str
    response: Optional[Any] = None
    error: Optional[str] = None
    latency_ms: float


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

@router.on_event("startup")
async def _startup():
    _persist_load()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/status")
async def bridge_status():
    return {
        "success": True,
        "level": 25,
        "name": "Bridge",
        "status": "active" if BRIDGE_ENABLED else "disabled",
        "enabled": BRIDGE_ENABLED,
        "registered_connections": len(_connections),
        "persist_enabled": BRIDGE_PERSIST_ENABLED,
        "allowlist": BRIDGE_ALLOWLIST,
        "caps": {
            "timeout_min_s": TIMEOUT_MIN_S,
            "timeout_max_s": TIMEOUT_MAX_S,
            "rate_window_s": RATE_LIMIT_WINDOW_S,
            "rate_max": RATE_LIMIT_MAX,
        },
        "capabilities": [
            "external_ai_federation",
            "endpoint_registration",
            "query_relay",
            "multi_agent_communication",
            "allowlist",
            "token_auth",
            "rate_limit",
        ],
    }


@router.get("/health")
async def bridge_health():
    return {
        "success": True,
        "enabled": BRIDGE_ENABLED,
        "connections": len(_connections),
        "timestamp": datetime.now().isoformat(),
    }


@router.post("/connect", response_model=ConnectResponse)
async def register_connection(request: ConnectRequest, x_bridge_token: Optional[str] = Header(default=None)):
    _require_enabled()
    _require_token(x_bridge_token)

    connection_id = request.name.lower().replace(" ", "_")
    url = str(request.url)

    if not _allowlisted(url):
        raise HTTPException(status_code=403, detail="URL not allowlisted")

    _connections[connection_id] = {
        "id": connection_id,
        "name": request.name,
        "url": url,
        "capabilities": request.capabilities,
        "description": request.description,
        "registered_at": datetime.now().isoformat(),
        "relay_count": int(_connections.get(connection_id, {}).get("relay_count", 0)),
        "last_relay": _connections.get(connection_id, {}).get("last_relay"),
        "last_error": _connections.get(connection_id, {}).get("last_error"),
    }

    _persist_save()

    return ConnectResponse(
        success=True,
        connection_id=connection_id,
        message=f"Connection '{request.name}' registered",
    )


@router.get("/connections")
async def list_connections():
    # Read-only list; still require enabled.
    _require_enabled()
    return {
        "success": True,
        "count": len(_connections),
        "connections": list(_connections.values()),
    }


@router.post("/relay", response_model=RelayResponse)
async def relay_query(request: RelayRequest, x_bridge_token: Optional[str] = Header(default=None)):
    _require_enabled()
    _require_token(x_bridge_token)

    if not _rate_limit_ok():
        raise HTTPException(status_code=429, detail="Bridge rate limit exceeded")

    conn = _connections.get(request.connection_id)
    if conn is None:
        raise HTTPException(status_code=404, detail=f"Unknown connection: {request.connection_id}.")

    if not _allowlisted(conn.get("url", "")):
        raise HTTPException(status_code=403, detail="Connection URL not allowlisted")

    timeout_s = _clamp_timeout(request.timeout_seconds)

    start = time.time()
    payload = {
        "query": request.query,
        "source": "cortex-bridge-l25",
        **(request.payload or {}),
    }

    _relay_events.append(time.time())

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(conn["url"], json=payload)
            resp.raise_for_status()
            # try json, else text
            try:
                data = resp.json()
            except Exception:
                data = (resp.text or "")[:RESPONSE_MAX_CHARS]
    except httpx.HTTPStatusError as exc:
        latency = (time.time() - start) * 1000
        err = f"HTTP {exc.response.status_code}: {exc.response.text[:200]}"
        conn["last_error"] = err
        return RelayResponse(success=False, connection_id=request.connection_id, error=err, latency_ms=round(latency, 2))
    except Exception as exc:
        latency = (time.time() - start) * 1000
        err = str(exc)
        conn["last_error"] = err
        return RelayResponse(success=False, connection_id=request.connection_id, error=err, latency_ms=round(latency, 2))

    latency = (time.time() - start) * 1000

    conn["relay_count"] = int(conn.get("relay_count", 0)) + 1
    conn["last_relay"] = datetime.now().isoformat()
    conn["last_error"] = None
    _persist_save()

    return RelayResponse(success=True, connection_id=request.connection_id, response=data, latency_ms=round(latency, 2))
