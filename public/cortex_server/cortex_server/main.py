"""
The Cortex - Local Knowledge Graph and Tool Server
Main entry point and FastAPI application factory.
"""

import logging
logger = logging.getLogger(__name__)
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi

import importlib
import os
from pathlib import Path

from cortex_server.middleware.error_handler import register_exception_handlers, RequestIDMiddleware
from cortex_server.middleware.request_timeout import RequestTimeoutMiddleware
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.middleware.event_ledger_middleware import EventLedgerMiddleware
from cortex_server.middleware.observability import ObservabilityMiddleware
from cortex_server.middleware.write_authorization import MUTATING_METHODS, WriteAuthorizationMiddleware
from cortex_server.internal_addressing import (
    CORTEX_INTERNAL_BASE_URL,
    DEFAULT_CORTEX_HOST,
    DEFAULT_CORTEX_PORT,
    internal_reachability_response,
    probe_internal_reachability,
)
from cortex_server.modules.execution_capabilities import execution_capability_status
from cortex_server.routers import websockets
import asyncio
import subprocess

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


def _route_inventory(routes) -> dict:
    """Flatten path-bearing routes while safely expanding FastAPI router containers."""
    source_routes = list(routes)
    records = []
    expanded_container_types = {}
    ignored_object_types = {}
    expansion_errors = []

    def add_record(candidate, *, source_type: str, expanded: bool) -> None:
        route_path = getattr(candidate, "path", None)
        if not isinstance(route_path, str) or not route_path:
            candidate_type = type(candidate).__name__
            ignored_object_types[candidate_type] = ignored_object_types.get(candidate_type, 0) + 1
            return
        methods = sorted(
            str(method)
            for method in (getattr(candidate, "methods", None) or [])
            if str(method) not in {"HEAD", "OPTIONS"}
        )
        records.append({
            "path": route_path,
            "methods": methods,
            "name": getattr(candidate, "name", None),
            "sourceType": source_type,
            "expanded": expanded,
        })

    for route in source_routes:
        route_path = getattr(route, "path", None)
        if isinstance(route_path, str) and route_path:
            add_record(route, source_type=type(route).__name__, expanded=False)
            continue
        expand = getattr(route, "effective_route_contexts", None)
        if callable(expand):
            container_type = type(route).__name__
            expanded_container_types[container_type] = expanded_container_types.get(container_type, 0) + 1
            try:
                for context in expand():
                    add_record(context, source_type=container_type, expanded=True)
            except Exception as exc:
                expansion_errors.append({
                    "type": container_type,
                    "error": f"{type(exc).__name__}: {exc}",
                })
            continue
        ignored_type = type(route).__name__
        ignored_object_types[ignored_type] = ignored_object_types.get(ignored_type, 0) + 1

    records.sort(key=lambda row: (row["path"], row["methods"], str(row["name"] or "")))
    return {
        "sourceObjectCount": len(source_routes),
        "pathRouteCount": len(records),
        "expandedContainerCount": sum(expanded_container_types.values()),
        "expandedContainerTypes": dict(sorted(expanded_container_types.items())),
        "ignoredObjectCount": sum(ignored_object_types.values()),
        "ignoredObjectTypes": dict(sorted(ignored_object_types.items())),
        "expansionErrors": expansion_errors,
        "routes": records,
    }


def _route_inventory_summary(inventory: dict) -> dict:
    return {key: inventory[key] for key in (
        "sourceObjectCount",
        "pathRouteCount",
        "expandedContainerCount",
        "expandedContainerTypes",
        "ignoredObjectCount",
        "ignoredObjectTypes",
        "expansionErrors",
    )}


def load_dynamic_routers(app: FastAPI) -> dict:
    """Dynamically discover and mount routers from cortex_server.routers."""
    routers_dir = Path(__file__).parent / "routers"
    report = {"loaded": [], "safeModeSkipped": [], "failed": [], "missingRouter": []}
    for file_path in routers_dir.glob("*.py"):
        module_name = file_path.stem
        if module_name == "__init__" or module_name.startswith("_"):
            continue
        if module_name == "websockets":
            continue
        if SAFE_MODE and module_name in DANGEROUS_ROUTERS:
            logger.warning("SAFE_MODE: skipping dangerous router '%s'", module_name)
            report["safeModeSkipped"].append(module_name)
            continue
        try:
            module = importlib.import_module(f"cortex_server.routers.{module_name}")
        except Exception as e:
            logger.warning("Skipping router '%s' due to import error: %s", module_name, e)
            report["failed"].append({"router": module_name, "error": f"{type(e).__name__}: {e}"})
            continue
        router = getattr(module, "router", None)
        if router is not None:
            app.include_router(router, prefix=f"/{module_name}", tags=[module_name.title()])
            report["loaded"].append(module_name)
        else:
            report["missingRouter"].append(module_name)
    for key in ("loaded", "safeModeSkipped", "missingRouter"):
        report[key].sort()
    report["failed"].sort(key=lambda row: row["router"])
    app.state.router_load_report = report
    return report


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""

    write_auth_mode = os.getenv("CORTEX_WRITE_AUTH_MODE", "token_or_loopback").strip().lower()
    write_token = os.getenv("CORTEX_WRITE_TOKEN", "").strip()
    write_token_header = os.getenv("CORTEX_WRITE_TOKEN_HEADER", "x-cortex-write-token").strip().lower()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if FAIL_CLOSED_MEMORY_ENDPOINTS:
            route_inventory = _route_inventory(app.routes)
            route_paths = {route["path"] for route in route_inventory["routes"]}
            required_paths = {"/l22/store", "/knowledge/search"}
            missing_paths = sorted(required_paths - route_paths)
            if route_inventory["expansionErrors"] or missing_paths:
                problems = []
                if route_inventory["expansionErrors"]:
                    problems.append(f"route inventory expansion errors: {route_inventory['expansionErrors']}")
                if missing_paths:
                    problems.append(f"missing required memory endpoints: {', '.join(missing_paths)}")
                raise RuntimeError(f"Fail-closed startup: {'; '.join(problems)}")

        try:
            subprocess.run(["redis-server", "--daemonize", "yes"], check=False)
            await asyncio.sleep(1)
            logger.info("Redis started for background task processing")
        except Exception as e:
            logger.warning(f"Redis startup warning: {e}")

        try:
            from cortex_server.scheduler import start_scheduler
            start_scheduler()
        except Exception as e:
            logger.warning(f"Scheduler startup skipped: {e}")
        try:
            from cortex_server.modules.chronos import get_chronos
            asyncio.create_task(get_chronos().start_scheduler())
        except Exception as e:
            logger.warning(f"Chronos scheduler startup skipped: {e}")
        try:
            from cortex_server.routers.awareness import start_awareness
            asyncio.create_task(start_awareness())
        except Exception as e:
            logger.warning(f"Awareness startup skipped: {e}")

        yield

    app = FastAPI(
        title="The Cortex",
        description="Local Knowledge Graph and Tool Server",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )
    app.state.last_internal_reachability = {
        "ok": False,
        "status": "not_checked",
        "target": f"{CORTEX_INTERNAL_BASE_URL}/_internal/reachability",
    }

    app.add_middleware(
        WriteAuthorizationMiddleware,
        mode=write_auth_mode,
        token=write_token,
        header_name=write_token_header,
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
    app.add_middleware(ObservabilityMiddleware)
    app.add_middleware(RequestTimeoutMiddleware, timeout_seconds=30, exclude_paths=["/health", "/", "/oracle/chat", "/oracle/status", "/oracle/ledger", "/augmenter/chat", "/bard/speak", "/homeassistant/voice/assist_tts"])
    app.add_middleware(EventLedgerMiddleware)
    app.add_middleware(HUDMiddleware)
    register_exception_handlers(app)

    # API Routers
    router_load_report = load_dynamic_routers(app)
    app.include_router(websockets.router, tags=["WebSockets"])

    def readiness_payload(*, self_reachability: dict | None = None) -> dict:
        route_inventory = _route_inventory(app.routes)
        route_paths = {route["path"] for route in route_inventory["routes"]}
        required_paths = {
            value.strip()
            for value in os.getenv("CORTEX_REQUIRED_PATHS", "/l22/store,/knowledge/search").split(",")
            if value.strip()
        }
        required_routers = {
            value.strip()
            for value in os.getenv("CORTEX_REQUIRED_ROUTERS", "l22,knowledge").split(",")
            if value.strip()
        }
        loaded_routers = set(router_load_report["loaded"])
        missing_paths = sorted(required_paths - route_paths)
        missing_routers = sorted(required_routers - loaded_routers)
        graph_path = Path(__file__).resolve().parents[1] / "cortex_graph.db"
        execution_policy = execution_capability_status()
        checks = {
            "routeInventory": {
                "ok": not route_inventory["expansionErrors"],
                **_route_inventory_summary(route_inventory),
            },
            "requiredPaths": {"ok": not missing_paths, "missing": missing_paths},
            "requiredRouters": {"ok": not missing_routers, "missing": missing_routers},
            "structuralGraph": {"ok": graph_path.is_file(), "path": str(graph_path)},
            "writeAuthorization": {
                "ok": write_auth_mode == "token_or_loopback" or (write_auth_mode == "token_required" and bool(write_token)),
                "mode": write_auth_mode,
                "tokenConfigured": bool(write_token),
            },
            "internalSelfReachability": dict(
                self_reachability
                if self_reachability is not None
                else app.state.last_internal_reachability
            ),
            "executionCapabilityPolicy": {
                "ok": execution_policy.get("defaultDeny") is True,
                "requiredForReadiness": False,
                **execution_policy,
            },
        }
        ready = all(check["ok"] for check in checks.values())
        return {
            "status": "ready" if ready else "not_ready",
            "ready": ready,
            "service": "cortex",
            "checks": checks,
            "routerLoad": {
                "loadedCount": len(router_load_report["loaded"]),
                "safeModeSkipped": router_load_report["safeModeSkipped"],
                "failed": router_load_report["failed"],
                "missingRouter": router_load_report["missingRouter"],
            },
        }

    @app.get("/_internal/reachability", include_in_schema=False)
    async def internal_reachability_check():
        return internal_reachability_response()

    @app.get("/ready")
    async def readiness_check():
        from fastapi.responses import JSONResponse
        try:
            timeout_seconds = float(os.getenv("CORTEX_SELF_REACHABILITY_TIMEOUT_S", "1.5"))
        except ValueError:
            timeout_seconds = 1.5
        self_reachability = await probe_internal_reachability(timeout_seconds=timeout_seconds)
        app.state.last_internal_reachability = self_reachability
        payload = readiness_payload(self_reachability=self_reachability)
        return JSONResponse(status_code=200 if payload["ready"] else 503, content=payload)

    @app.get("/capabilities")
    async def capability_inventory():
        route_inventory = _route_inventory(app.routes)
        execution_policy = execution_capability_status()
        capabilities = []
        for route in route_inventory["routes"]:
            methods = route["methods"]
            if not methods:
                continue
            capabilities.append({
                "path": route["path"],
                "methods": methods,
                "write": any(method in MUTATING_METHODS for method in methods),
                "name": route["name"],
            })
        return {
            "schemaVersion": "cortex.capability_inventory.v1",
            "security": {
                "writeAuthorizationMode": write_auth_mode,
                "writeTokenConfigured": bool(write_token),
                "writeTokenHeader": write_token_header,
            },
            "executionCapabilityPolicy": execution_policy,
            "capabilityCount": len(capabilities),
            "writeCapabilityCount": sum(1 for row in capabilities if row["write"]),
            "inventory": _route_inventory_summary(route_inventory),
            "capabilities": sorted(capabilities, key=lambda row: (row["path"], row["methods"])),
        }

    @app.get("/health")
    async def health_check():
        return {
            "status": "healthy",
            "service": "cortex",
            "contract": {
                "identity_phrase": "Cortex-first orchestration active",
                "activation_metadata_available": True,
                "activation_metadata_source": "derived",
            },
            "one_brain": {
                "autonomy_control_plane": True,
                "event_ledger": True,
            },
            "security": {
                "writeAuthorizationMode": write_auth_mode,
                "writeTokenConfigured": bool(write_token),
                "networkBind": os.getenv("CORTEX_HOST", DEFAULT_CORTEX_HOST),
            },
            "internalBaseUrl": CORTEX_INTERNAL_BASE_URL,
            "readiness": readiness_payload()["ready"],
        }

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

    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )
        components = schema.setdefault("components", {})
        security_schemes = components.setdefault("securitySchemes", {})
        security_schemes["CortexWriteToken"] = {
            "type": "apiKey",
            "in": "header",
            "name": write_token_header,
            "description": "Required for non-loopback mutating requests. Loopback is a trusted capability boundary in token_or_loopback mode.",
        }
        for path_item in schema.get("paths", {}).values():
            for method in ("post", "put", "patch", "delete"):
                operation = path_item.get(method)
                if operation:
                    operation["security"] = [{"CortexWriteToken": []}]
                    operation["x-cortex-write-authorization-mode"] = write_auth_mode
        app.openapi_schema = schema
        return schema

    app.openapi = custom_openapi
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=os.getenv("CORTEX_HOST", DEFAULT_CORTEX_HOST),
        port=int(os.getenv("CORTEX_PORT", str(DEFAULT_CORTEX_PORT))),
    )
