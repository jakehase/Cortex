"""
Error handling middleware and request ID tracking.
"""

import uuid
import traceback
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from cortex_server.models.requests import APIResponse


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
            content=APIResponse.failure(str(exc.detail)).dict(),
            headers={"X-Request-ID": request_id},
        )

    @app.exception_handler(ValueError)
    async def value_error_handler(request: Request, exc: ValueError):
        request_id = getattr(request.state, "request_id", "unknown")
        return JSONResponse(
            status_code=400,
            content=APIResponse.failure(str(exc)).dict(),
            headers={"X-Request-ID": request_id},
        )

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        request_id = getattr(request.state, "request_id", "unknown")
        # Log the full traceback for debugging
        traceback_str = traceback.format_exc()
        # In production, you might want to log this instead of printing
        print(f"[ERROR] Request {request_id}: {traceback_str}")
        
        return JSONResponse(
            status_code=500,
            content=APIResponse.failure("Internal Server Error").dict(),
            headers={"X-Request-ID": request_id},
        )