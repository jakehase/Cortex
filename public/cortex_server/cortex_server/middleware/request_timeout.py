"""Request timeout middleware to prevent hung routes from wedging the API."""

import asyncio
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class RequestTimeoutMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, timeout_seconds: int = 25, exclude_paths=None):
        super().__init__(app)
        self.timeout_seconds = timeout_seconds
        self.exclude_paths = set(exclude_paths or [])

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if (
            path in self.exclude_paths
            or path.startswith("/docs")
            or path.startswith("/redoc")
            or path.startswith("/openapi.json")
        ):
            return await call_next(request)

        try:
            return await asyncio.wait_for(call_next(request), timeout=self.timeout_seconds)
        except asyncio.TimeoutError:
            request_id = getattr(request.state, "request_id", "unknown")
            return JSONResponse(
                status_code=504,
                content={
                    "success": False,
                    "error": f"Request timed out after {self.timeout_seconds}s",
                    "request_id": request_id,
                    "path": path,
                },
                headers={"X-Request-ID": request_id},
            )
