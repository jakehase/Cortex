"""HTTP observability middleware: structured access logs + request metrics."""
from __future__ import annotations

import json
import logging
import time
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from cortex_server.modules.metrics_store import record_http_request

logger = logging.getLogger("cortex.observability")


class ObservabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = None
        error = None
        status_code = 500

        try:
            response = await call_next(request)
            status_code = int(getattr(response, "status_code", 200))
            return response
        except Exception as exc:  # noqa: BLE001
            error = exc
            status_code = 500
        finally:
            latency_ms = (time.perf_counter() - start) * 1000.0
            request_id = getattr(request.state, "request_id", "unknown")
            path = request.url.path
            method = request.method

            if response is not None:
                try:
                    response.headers["X-Process-Time-Ms"] = f"{latency_ms:.2f}"
                except Exception:
                    pass

            record_http_request(
                path=path,
                method=method,
                status=status_code,
                latency_ms=latency_ms,
                request_id=request_id,
            )

            event = {
                "event": "http_request",
                "request_id": request_id,
                "method": method,
                "path": path,
                "status": status_code,
                "latency_ms": round(latency_ms, 2),
                "error": error.__class__.__name__ if error else None,
            }
            logger.info(json.dumps(event, separators=(",", ":")))

        if error is not None:
            raise error
