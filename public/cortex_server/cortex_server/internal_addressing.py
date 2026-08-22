"""Canonical addressing and reachability contract for Cortex self-calls.

All in-process components that must cross the HTTP boundary use the same base
URL.  The explicit ``CORTEX_INTERNAL_BASE_URL`` setting wins; otherwise the
address is derived from the uvicorn bind settings and defaults to the deployed
loopback listener on port 8000.
"""

from __future__ import annotations

import math
import os
from collections.abc import Mapping
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

import httpx


DEFAULT_CORTEX_HOST = "127.0.0.1"
DEFAULT_CORTEX_PORT = 8000
INTERNAL_REACHABILITY_PATH = "/_internal/reachability"
INTERNAL_REACHABILITY_SCHEMA = "cortex.internal_reachability.v1"


def resolve_internal_base_url(environ: Optional[Mapping[str, str]] = None) -> str:
    """Resolve and validate the one HTTP base URL used for Cortex self-calls."""
    env = os.environ if environ is None else environ
    configured = str(env.get("CORTEX_INTERNAL_BASE_URL") or "").strip().rstrip("/")
    if configured:
        parsed = urlsplit(configured)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path not in {"", "/"}
        ):
            raise ValueError(
                "CORTEX_INTERNAL_BASE_URL must be an http(s) origin without "
                "credentials, path, query, or fragment"
            )
        try:
            parsed_port = parsed.port
        except ValueError as exc:
            raise ValueError("CORTEX_INTERNAL_BASE_URL contains an invalid port") from exc
        if parsed_port is not None and not 1 <= parsed_port <= 65535:
            raise ValueError("CORTEX_INTERNAL_BASE_URL port must be between 1 and 65535")
        return configured

    host = str(env.get("CORTEX_HOST") or DEFAULT_CORTEX_HOST).strip()
    if not host:
        host = DEFAULT_CORTEX_HOST
    # Wildcard bind addresses are not valid self-connect destinations.
    if host == "0.0.0.0":
        host = "127.0.0.1"
    elif host == "::":
        host = "::1"
    if any(marker in host for marker in ("/", "?", "#", "@", "://")):
        raise ValueError("CORTEX_HOST must contain only a host name or IP address")
    try:
        port = int(str(env.get("CORTEX_PORT") or DEFAULT_CORTEX_PORT).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError("CORTEX_PORT must be an integer") from exc
    if not 1 <= port <= 65535:
        raise ValueError("CORTEX_PORT must be between 1 and 65535")
    host_for_url = f"[{host}]" if ":" in host and not host.startswith("[") else host
    return f"http://{host_for_url}:{port}"


CORTEX_INTERNAL_BASE_URL = resolve_internal_base_url()


def internal_url(path: str, *, base_url: str = CORTEX_INTERNAL_BASE_URL) -> str:
    """Join an absolute API path to the canonical internal Cortex origin."""
    normalized = str(path or "").strip()
    if not normalized.startswith("/") or normalized.startswith("//"):
        raise ValueError("internal Cortex paths must start with one slash")
    return f"{base_url.rstrip('/')}{normalized}"


def internal_host_port(*, base_url: str = CORTEX_INTERNAL_BASE_URL) -> tuple[str, int]:
    """Return the connectable host/port represented by the internal origin."""
    parsed = urlsplit(base_url)
    if not parsed.hostname:
        raise ValueError("internal Cortex base URL has no host")
    return parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)


def internal_reachability_response(*, base_url: str = CORTEX_INTERNAL_BASE_URL) -> Dict[str, Any]:
    """Return the identity document an active self-reachability probe expects."""
    return {
        "schemaVersion": INTERNAL_REACHABILITY_SCHEMA,
        "service": "cortex",
        "status": "reachable",
        "internalBaseUrl": base_url,
    }


async def probe_internal_reachability(
    *,
    base_url: str = CORTEX_INTERNAL_BASE_URL,
    timeout_seconds: float = 1.5,
) -> Dict[str, Any]:
    """Actively verify that the configured self-call origin reaches this Cortex.

    This probe is called by readiness after the HTTP server is accepting
    requests.  It is deliberately not a lifespan/startup gate, since a server
    cannot reach its own listener before uvicorn starts listening.
    """
    target = internal_url(INTERNAL_REACHABILITY_PATH, base_url=base_url)
    try:
        requested_timeout = float(timeout_seconds)
        if not math.isfinite(requested_timeout):
            requested_timeout = 1.5
        bounded_timeout = min(10.0, max(0.1, requested_timeout))
        async with httpx.AsyncClient(timeout=bounded_timeout, trust_env=False) as client:
            response = await client.get(target)
        if response.status_code != 200:
            return {
                "ok": False,
                "status": "http_error",
                "target": target,
                "statusCode": response.status_code,
            }
        payload = response.json()
    except Exception as exc:
        return {
            "ok": False,
            "status": "unreachable",
            "target": target,
            "error": f"{type(exc).__name__}:{exc}",
        }

    valid = (
        isinstance(payload, dict)
        and payload.get("schemaVersion") == INTERNAL_REACHABILITY_SCHEMA
        and payload.get("service") == "cortex"
        and payload.get("status") == "reachable"
        and payload.get("internalBaseUrl") == base_url
    )
    if not valid:
        return {
            "ok": False,
            "status": "identity_mismatch",
            "target": target,
        }
    return {"ok": True, "status": "reachable", "target": target}


__all__ = [
    "CORTEX_INTERNAL_BASE_URL",
    "DEFAULT_CORTEX_HOST",
    "DEFAULT_CORTEX_PORT",
    "INTERNAL_REACHABILITY_PATH",
    "INTERNAL_REACHABILITY_SCHEMA",
    "internal_reachability_response",
    "internal_host_port",
    "internal_url",
    "probe_internal_reachability",
    "resolve_internal_base_url",
]
