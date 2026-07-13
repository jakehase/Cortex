"""Fail-closed authorization for Cortex mutating HTTP operations."""

from __future__ import annotations

import hmac
import ipaddress
from typing import Iterable

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
FORWARDED_HEADERS = frozenset({"forwarded", "x-forwarded-for", "x-real-ip"})
AUTHORIZATION_MODES = frozenset({"token_required", "token_or_loopback", "disabled"})
TRUSTED_FETCH_SITES = frozenset({"same-origin", "same-site", "none"})


def _is_loopback(host: str) -> bool:
    try:
        return ipaddress.ip_address((host or "").split("%", 1)[0]).is_loopback
    except ValueError:
        return False


def is_trusted_direct_loopback(client_host: str, headers) -> bool:
    """Return true only for a loopback peer that did not arrive via a proxy."""
    return _is_loopback(client_host) and not any(name in headers for name in FORWARDED_HEADERS)


def is_trusted_browser_context(headers, allowed_origins: frozenset[str]) -> bool:
    """Reject browser writes that identify an untrusted source context."""
    origin = headers.get("origin")
    if origin is not None and origin not in allowed_origins:
        return False

    fetch_site = headers.get("sec-fetch-site")
    if fetch_site is not None and fetch_site.strip().lower() not in TRUSTED_FETCH_SITES:
        return False

    return True


def token_matches(supplied: str, configured: str) -> bool:
    """Compare credentials on every path while failing closed when unconfigured."""
    expected = str(configured or "\0").encode("utf-8")
    candidate = str(supplied or "\0").encode("utf-8")
    matched = hmac.compare_digest(candidate, expected)
    return bool(configured) and bool(supplied) and matched


def authorization_mode(value: str, *, strict: bool = False) -> str:
    """Normalize an authorization mode, failing closed for runtime configuration."""
    normalized = str(value or "").strip().lower()
    if normalized in AUTHORIZATION_MODES:
        return normalized
    if strict:
        raise ValueError(f"unsupported Cortex write authorization mode: {value}")
    return "token_required"


class WriteAuthorizationMiddleware(BaseHTTPMiddleware):
    """Authorize writes with a token, optionally trusting the loopback boundary.

    Modes:
    - ``token_required``: every mutating request must carry the configured token.
    - ``token_or_loopback``: loopback requests without an untrusted browser
      context may omit the token; other callers must carry it.
    - ``disabled``: intended only for isolated tests and explicit rollback.

    Forwarded headers are deliberately ignored. A reverse proxy must present a
    token rather than spoofing a source address.
    """

    def __init__(
        self,
        app,
        *,
        mode: str = "token_or_loopback",
        token: str = "",
        header_name: str = "x-cortex-write-token",
        allowed_origins: Iterable[str] = (),
        exempt_paths: Iterable[str] = (),
    ):
        super().__init__(app)
        self.mode = authorization_mode(mode, strict=True)
        self.token = str(token or "").strip()
        self.header_name = str(header_name or "x-cortex-write-token").strip().lower()
        self.allowed_origins = frozenset(
            str(origin).strip() for origin in allowed_origins if str(origin).strip()
        )
        self.exempt_paths = frozenset(str(path) for path in exempt_paths)

    async def dispatch(self, request, call_next):
        if (
            self.mode == "disabled"
            or request.method.upper() not in MUTATING_METHODS
            or request.url.path in self.exempt_paths
        ):
            return await call_next(request)

        client_host = request.client.host if request.client else ""
        if (
            self.mode == "token_or_loopback"
            and is_trusted_direct_loopback(client_host, request.headers)
            and is_trusted_browser_context(request.headers, self.allowed_origins)
        ):
            request.state.cortex_write_authorization = "trusted_loopback"
            return await call_next(request)

        supplied = request.headers.get(self.header_name, "")
        if token_matches(supplied, self.token):
            request.state.cortex_write_authorization = "write_token"
            return await call_next(request)

        error = "write authorization required"
        if not self.token:
            error = "write authorization is not configured"
        return JSONResponse(
            status_code=403,
            content={
                "success": False,
                "error": error,
                "authorizationMode": self.mode,
            },
        )
