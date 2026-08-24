"""Fail-closed authorization for Cortex mutating HTTP operations."""

from __future__ import annotations

import hmac
import ipaddress
from typing import Iterable

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _is_loopback(host: str) -> bool:
    try:
        return ipaddress.ip_address((host or "").split("%", 1)[0]).is_loopback
    except ValueError:
        return False


class WriteAuthorizationMiddleware(BaseHTTPMiddleware):
    """Authorize writes with a token, optionally trusting the loopback boundary.

    Modes:
    - ``token_required``: every mutating request must carry the configured token.
    - ``token_or_loopback``: loopback is a trusted local capability boundary;
      non-loopback callers must carry the configured token.
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
        exempt_paths: Iterable[str] = (),
    ):
        super().__init__(app)
        normalized_mode = str(mode or "").strip().lower()
        if normalized_mode not in {"token_required", "token_or_loopback", "disabled"}:
            raise ValueError(f"unsupported Cortex write authorization mode: {mode}")
        self.mode = normalized_mode
        self.token = str(token or "").strip()
        self.header_name = str(header_name or "x-cortex-write-token").strip().lower()
        self.exempt_paths = frozenset(str(path) for path in exempt_paths)

    async def dispatch(self, request, call_next):
        if (
            self.mode == "disabled"
            or request.method.upper() not in MUTATING_METHODS
            or request.url.path in self.exempt_paths
        ):
            return await call_next(request)

        client_host = request.client.host if request.client else ""
        if self.mode == "token_or_loopback" and _is_loopback(client_host):
            request.state.cortex_write_authorization = "trusted_loopback"
            return await call_next(request)

        supplied = request.headers.get(self.header_name, "")
        if self.token and supplied and hmac.compare_digest(supplied, self.token):
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
