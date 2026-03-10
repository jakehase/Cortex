"""
The Cortex - Local Knowledge Graph and Tool Server
Main entry point and FastAPI application factory.
"""

import logging
logger = logging.getLogger(__name__)
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import importlib
import os
from pathlib import Path

from cortex_server.middleware.error_handler import register_exception_handlers, RequestIDMiddleware
from cortex_server.middleware.request_timeout import RequestTimeoutMiddleware
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.routers import websockets
from cortex_server.scheduler import start_scheduler
from cortex_server.modules.chronos import get_chronos
import asyncio
import subprocess
from cortex_server.routers.awareness import start_awareness

SAFE_MODE = os.getenv("CORTEX_SAFE_MODE", "true").lower() in {"1", "true", "yes", "on"}
DANGEROUS_ROUTERS = {
    "lab_fixed",
    "architect",
    "oracle_budget",
    "plugin_test",
    "test_module",
    "demo",
}
ADMIN_TOKEN = os.getenv("CORTEX_ADMIN_TOKEN", "").strip()
FAIL_CLOSED_MEMORY_ENDPOINTS = os.getenv("CORTEX_FAIL_CLOSED_MEMORY_ENDPOINTS", "true").lower() in {"1", "true", "yes", "on"}


def load_dynamic_routers(app: FastAPI) -> None:
    """Dynamically discover and mount routers from cortex_server.routers."""
    routers_dir = Path(__file__).parent / "routers"
    for file_path in routers_dir.glob("*.py"):
        module_name = file_path.stem
        if module_name == "__init__" or module_name.startswith("_"):
            continue
        if module_name == "websockets":
            continue
        if SAFE_MODE and module_name in DANGEROUS_ROUTERS:
            logger.warning("SAFE_MODE: skipping dangerous router '%s'", module_name)
            continue
        module = importlib.import_module(f"cortex_server.routers.{module_name}")
        router = getattr(module, "router", None)
        if router is not None:
            app.include_router(router, prefix=f"/{module_name}", tags=[module_name.title()])


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="The Cortex",
        description="Local Knowledge Graph and Tool Server",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    @app.middleware("http")
    async def admin_guard(request, call_next):
        if SAFE_MODE and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            p = request.url.path
            if any(p.startswith(f"/{r}/") or p == f"/{r}" for r in DANGEROUS_ROUTERS):
                if not ADMIN_TOKEN or request.headers.get("x-cortex-admin-token", "") != ADMIN_TOKEN:
                    from fastapi.responses import JSONResponse
                    return JSONResponse(status_code=403, content={"success": False, "error": "admin token required"})
        return await call_next(request)

    # CORS middleware (tightened default; configurable via env)
    allowed_origins = [o.strip() for o in os.getenv("CORTEX_ALLOW_ORIGINS", "http://localhost,https://localhost").split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Custom middleware
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(RequestTimeoutMiddleware, timeout_seconds=25, exclude_paths=["/health", "/", "/oracle/chat", "/oracle/status", "/oracle/ledger"])
    app.add_middleware(HUDMiddleware)
    register_exception_handlers(app)

    # API Routers
    load_dynamic_routers(app)
    app.include_router(websockets.router, tags=["WebSockets"])

    @app.on_event("startup")
    async def startup_event():
        if FAIL_CLOSED_MEMORY_ENDPOINTS:
            route_paths = {route.path for route in app.routes}
            required_paths = {"/l22/store", "/knowledge/search"}
            missing_paths = sorted(required_paths - route_paths)
            if missing_paths:
                raise RuntimeError(
                    f"Fail-closed startup: missing required memory endpoints: {', '.join(missing_paths)}"
                )

        try:
            subprocess.run(["redis-server", "--daemonize", "yes"], check=False)
            await asyncio.sleep(1)
            logger.info("Redis started for background task processing")
        except Exception as e:
            logger.warning(f"Redis startup warning: {e}")

        start_scheduler()
        try:
            asyncio.create_task(get_chronos().start_scheduler())
        except Exception as e:
            logger.warning(f"Chronos scheduler startup skipped: {e}")
        asyncio.create_task(start_awareness())

    @app.get("/health")
    async def health_check():
        return {"status": "healthy", "service": "cortex", "contract": {"identity_phrase": "Cortex-first orchestration active", "activation_metadata_available": True, "activation_metadata_source": "derived"}}

    @app.get("/")
    async def root():
        return {
            "name": "The Cortex",
            "version": "1.0.0",
            "description": "Local Knowledge Graph and Tool Server",
            "endpoints": {
                "docs": "/docs",
                "health": "/health",
                "graph": "/graph",
                "parse": "/parse",
                "tools": "/tools",
                "websockets": "/ws",
            },
        }

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
