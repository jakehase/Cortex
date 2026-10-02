"""
Error handling middleware and request ID tracking.
"""

import logging
import uuid
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from cortex_server.models.requests import APIResponse
logger = logging.getLogger(__name__)


_PUBLIC_HTTP_DETAILS = {
    400: "Invalid request",
    401: "Authentication required",
    403: "Request not authorized",
    404: "Resource not found",
    405: "Method not allowed",
    409: "Request conflict",
    413: "Request too large",
    415: "Unsupported media type",
    422: "Invalid request",
    429: "Too many requests",
    503: "Service unavailable",
    504: "Upstream timeout",
}


_MEMORY_HTTP_CODES = {
    ("/nexus/assurance/receipt", 422): frozenset({
        "interaction_not_eligible_for_commit",
    }),
    ("/nexus/commit", 422): frozenset({
        "interaction_no_longer_eligible_for_commit",
        "memory_metadata_not_storable",
    }),
    ("/nexus/commit", 409): frozenset({
        "assurance_receipt_commit_in_progress",
        "assurance_receipt_commit_outcome_unknown",
    }),
    ("/nexus/commit", 503): frozenset({
        "assurance_receipt_commit_outcome_unknown",
        "assurance_receipt_ledger_unavailable",
        "assurance_receipt_recovery_failed",
        "assurance_receipt_reservation_missing",
        "assurance_receipt_finalization_failed",
        "assurance_receipt_release_failed",
    }),
}


def _safe_memory_http_code(request: Request, exc: HTTPException):
    """Preserve fixed protocol codes without exposing error text or identities."""

    if request.method != "POST" or not isinstance(exc.detail, dict):
        return None
    codes = _MEMORY_HTTP_CODES.get((request.url.path, exc.status_code), ())
    code = exc.detail.get("error")
    if not isinstance(code, str) or code not in codes:
        return None
    from cortex_server.modules.memory_scope import AuthenticatedMemoryPrincipal

    if not isinstance(
        getattr(request.state, "authenticated_memory_principal", None),
        AuthenticatedMemoryPrincipal,
    ):
        return None
    # In particular, do not expose expired-without-commit as an automatic
    # reissue signal based only on absent rows; retained publication intent
    # requires a separate authoritative no-publication proof.
    return code


def _safe_http_detail(_detail, *, status_code: int = 400) -> str:
    """Map exceptions to an allowlisted public reason, never exception text."""

    try:
        normalized_status = int(status_code)
    except (TypeError, ValueError):
        normalized_status = 400
    if normalized_status >= 500:
        return _PUBLIC_HTTP_DETAILS.get(normalized_status, "Service unavailable")
    return _PUBLIC_HTTP_DETAILS.get(normalized_status, "Request rejected")


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Add unique request ID to each request."""
    
    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


def register_exception_handlers(app: FastAPI):
    """Register global exception handlers."""
    
    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        request_id = getattr(request.state, "request_id", "unknown")
        content = APIResponse.failure(
            _safe_http_detail(exc.detail, status_code=exc.status_code)
        ).dict()
        code = _safe_memory_http_code(request, exc)
        if code is not None:
            content["detail"] = {"error": code}
            logger.info("Request %s rejected (status=%s, code=%s)",
                        request_id, exc.status_code, code)
        return JSONResponse(
            status_code=exc.status_code,
            content=content,
            headers={"X-Request-ID": request_id},
        )

    @app.exception_handler(ValueError)
    async def value_error_handler(request: Request, exc: ValueError):
        request_id = getattr(request.state, "request_id", "unknown")
        logger.info("Request %s rejected (%s)", request_id, type(exc).__name__)
        return JSONResponse(
            status_code=400,
            content=APIResponse.failure("Invalid request").dict(),
            headers={"X-Request-ID": request_id},
        )

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        request_id = getattr(request.state, "request_id", "unknown")
        # Exception values and tracebacks can contain request bodies, upstream
        # responses, credentials, or PHI. Keep only the class and correlation ID.
        logger.error("Request %s failed (%s)", request_id, type(exc).__name__)
        
        return JSONResponse(
            status_code=500,
            content=APIResponse.failure("Internal Server Error").dict(),
            headers={"X-Request-ID": request_id},
        )
