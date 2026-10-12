"""Request timeout middleware to prevent hung routes from wedging the API."""

import asyncio
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class RequestTimeoutMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, timeout_seconds: int = 25, exclude_paths=None, path_timeouts=None):
        super().__init__(app)
        self.timeout_seconds = timeout_seconds
        self.exclude_paths = set(exclude_paths or [])
        # Per-path aggregate deadlines for routes whose bounded provider work
        # legitimately exceeds the global default (they stay under a deadline).
        self.path_timeouts = {
            str(path): float(seconds)
            for path, seconds in dict(path_timeouts or {}).items()
            if float(seconds) > 0
        }

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
            timeout_seconds = self.path_timeouts.get(path, self.timeout_seconds)
            return await asyncio.wait_for(call_next(request), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            request_id = getattr(request.state, "request_id", "unknown")
            return JSONResponse(
                status_code=504,
                content={
                    "success": False,
                    "error": f"Request timed out after {self.path_timeouts.get(path, self.timeout_seconds):g}s",
                    "request_id": request_id,
                    "path": path,
                },
                headers={"X-Request-ID": request_id},
            )
