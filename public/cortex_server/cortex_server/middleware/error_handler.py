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
        return JSONResponse(
            status_code=exc.status_code,
            content=APIResponse.failure(
                _safe_http_detail(exc.detail, status_code=exc.status_code)
            ).dict(),
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
