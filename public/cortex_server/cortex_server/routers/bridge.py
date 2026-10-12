"""Bridge Router — L25 external federation / connection (safe-by-default)

Minimal safe remediation:
- Allowlist destinations (domains + optional explicit IPs)
- Auth token for connect/relay
- Timeout caps + basic rate limiting
- Optional persistence of connections

Design goal: This should be safe enough to be callable by Nexus/Orchestrator/Oracle *behind feature flags*.

Honesty: disabled by default (BRIDGE_ENABLED=false).  /bridge/status reports
``disabled``/``misconfigured`` with an empty capability list unless the relay is
actually usable, and never claims AI federation: the relay is a plain
allowlisted JSON POST.  Relaying user content is an external disclosure, so the
ExecutionEngine adapter (modules/level_adapters/bridge.py) never auto-runs it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional, Any
import os
import json
import secrets
import time
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, HttpUrl

from cortex_server.outbound_egress import (
    EgressError,
    EgressPolicy,
    request as outbound_request,
)


@asynccontextmanager
async def _bridge_lifespan(_app):
    _persist_load()
    yield


router = APIRouter(lifespan=_bridge_lifespan)

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
_RESERVED_RELAY_KEYS = frozenset({"query", "source"})


def _require_enabled():
    if not BRIDGE_ENABLED:
        raise HTTPException(status_code=503, detail="Bridge disabled (set BRIDGE_ENABLED=true)")


def _require_token(x_bridge_token: Optional[str]):
    # If token isn't configured, treat as disabled for safety.
    if not BRIDGE_TOKEN:
        raise HTTPException(status_code=503, detail="Bridge token not configured")
    if not x_bridge_token or not secrets.compare_digest(x_bridge_token, BRIDGE_TOKEN):
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
    try:
        return EgressPolicy(
            capability="bridge",
            allowed_hosts=tuple(BRIDGE_ALLOWLIST),
        ).permits_hostname(host)
    except EgressError:
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
# Endpoints
# ---------------------------------------------------------------------------

def bridge_configuration_state() -> Dict[str, Any]:
    """Derive Bridge readiness from real configuration (never a literal)."""

    missing: List[str] = []
    if not BRIDGE_TOKEN:
        missing.append("BRIDGE_TOKEN")
    if not BRIDGE_ALLOWLIST:
        missing.append("BRIDGE_ALLOWLIST")
    if not BRIDGE_ENABLED:
        status, reason = "disabled", "BRIDGE_ENABLED is false"
    elif missing:
        status, reason = "misconfigured", "missing " + ", ".join(missing)
    else:
        status, reason = "active", None
    return {
        "enabled": BRIDGE_ENABLED,
        "configured": status == "active",
        "status": status,
        "reason": reason,
        "missing_configuration": missing,
    }


# What the relay really does when enabled: an allowlisted, token-gated HTTP
# JSON POST.  It speaks no AI protocol (OpenAI/Anthropic/MCP/A2A), so it is
# not advertised as "external AI federation" or "multi-agent communication".
_ACTIVE_CAPABILITIES = (
    "endpoint_registration",
    "allowlisted_http_json_relay",
    "token_auth",
    "global_rate_limit",
)
_LIMITATIONS = (
    "relay posts an ad-hoc JSON body {query, source, ...payload}; no AI protocol adapters",
    "connection registry is in memory unless BRIDGE_PERSIST_ENABLED=true",
    "rate limit is global, not per principal",
    "relaying user content is an external disclosure; never auto-run without approval",
)


@router.get("/status")
async def bridge_status():
    state = bridge_configuration_state()
    configured = state["configured"]
    return {
        "success": configured,
        "level": 25,
        "name": "Bridge",
        "status": state["status"],
        "reason": state["reason"],
        "enabled": BRIDGE_ENABLED,
        "configured": configured,
        "missing_configuration": state["missing_configuration"],
        "registered_connections": len(_connections),
        "persist_enabled": BRIDGE_PERSIST_ENABLED,
        "allowlist": BRIDGE_ALLOWLIST,
        "caps": {
            "timeout_min_s": TIMEOUT_MIN_S,
            "timeout_max_s": TIMEOUT_MAX_S,
            "rate_window_s": RATE_LIMIT_WINDOW_S,
            "rate_max": RATE_LIMIT_MAX,
        },
        "capabilities": list(_ACTIVE_CAPABILITIES) if configured else [],
        "unavailable_capabilities": {
            "external_ai_federation": "not_implemented",
            "multi_agent_communication": "not_implemented",
        },
        "limitations": list(_LIMITATIONS),
        "auto_run": "never (approval required)",
    }


@router.get("/health")
async def bridge_health():
    state = bridge_configuration_state()
    return {
        "success": state["configured"],
        "status": state["status"],
        "reason": state["reason"],
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
    # Reserved keys are server-owned: caller payload cannot override the
    # relayed query or the source label.
    extra = {
        str(key): value
        for key, value in (request.payload or {}).items()
        if str(key) not in _RESERVED_RELAY_KEYS
    }
    payload = {
        **extra,
        "query": request.query,
        "source": "cortex-bridge-l25",
    }

    _relay_events.append(time.time())

    try:
        response = await outbound_request(
            "POST",
            conn["url"],
            policy=EgressPolicy(
                capability="bridge",
                allowed_hosts=tuple(BRIDGE_ALLOWLIST),
            ),
            json=payload,
            timeout=timeout_s,
            max_response_bytes=RESPONSE_MAX_CHARS,
            max_redirects=2,
        )
        if response.status_code >= 400:
            latency = (time.time() - start) * 1000
            err = f"upstream_http_{response.status_code}"
            conn["last_error"] = err
            return RelayResponse(success=False, connection_id=request.connection_id, error=err, latency_ms=round(latency, 2))
        try:
            data = response.json()
        except Exception:
            data = response.text
    except EgressError as exc:
        latency = (time.time() - start) * 1000
        err = type(exc).__name__
        conn["last_error"] = err
        return RelayResponse(success=False, connection_id=request.connection_id, error=err, latency_ms=round(latency, 2))

    latency = (time.time() - start) * 1000

    conn["relay_count"] = int(conn.get("relay_count", 0)) + 1
    conn["last_relay"] = datetime.now().isoformat()
    conn["last_error"] = None
    _persist_save()

    return RelayResponse(success=True, connection_id=request.connection_id, response=data, latency_ms=round(latency, 2))
