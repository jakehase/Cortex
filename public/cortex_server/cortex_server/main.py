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
import math
import os
from pathlib import Path

from cortex_server.middleware.error_handler import register_exception_handlers, RequestIDMiddleware
from cortex_server.middleware.request_timeout import RequestTimeoutMiddleware
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.middleware.event_ledger_middleware import EventLedgerMiddleware
from cortex_server.middleware.observability import ObservabilityMiddleware
from cortex_server.middleware.write_authorization import MUTATING_METHODS, WriteAuthorizationMiddleware
from cortex_server.routers import websockets
import asyncio
import subprocess
from dataclasses import dataclass
import threading
import weakref

DANGEROUS_ROUTERS = {
    "lab_fixed",
    "architect",
    "oracle_budget",
    "plugin_test",
    "test_module",
    "demo",
}

LIFECYCLE_SERVICES = ("redis", "scheduler", "chronos", "awareness")


def _not_started_lifecycle_checks():
    return {
        name: {"ok": False, "error": "not started"}
        for name in LIFECYCLE_SERVICES
    }


@dataclass(frozen=True)
class WebSocketSecurityConfig:
    """Security policy captured once for a specific application instance."""

    write_auth_mode: str
    write_token: str
    write_token_header: str
    allowed_origins: frozenset[str]


@dataclass(frozen=True)
class ReadinessConfig:
    required_paths: frozenset[str]
    required_routers: frozenset[str]


class SharedServiceStartupError(RuntimeError):
    """A shared service has owners but its singleton task is no longer usable."""


class _SharedServiceOwners:
    """Per-event-loop ownership for services used by app lifespans.

    A threading lock protects only short state transitions.  It is deliberately
    never held across an await, so sequential lifespans created by separate
    event loops cannot inherit an asyncio primitive bound to an old loop.
    """

    def __init__(self):
        self._lock = threading.Lock()
        # Values are removed explicitly by the final owner. Weak keys are an
        # additional safeguard for loops whose startup never acquired a
        # service. A live task may itself retain its loop, so weak keys alone
        # must not be relied on for lifecycle cleanup.
        self._loops = weakref.WeakKeyDictionary()

    @staticmethod
    def _new_loop_state():
        return {
            name: {"owners": {}, "starting": False, "task": None, "error": None}
            for name in ("scheduler", "chronos", "awareness")
        }

    def _state(self, loop, name, *, create=True):
        services = self._loops.get(loop)
        if services is None and create:
            services = self._new_loop_state()
            self._loops[loop] = services
        return None if services is None else services[name]

    def _prune_loop_locked(self, loop):
        services = self._loops.get(loop)
        if services is not None and all(
            not state["owners"] and not state["starting"] and state["task"] is None
            for state in services.values()
        ):
            self._loops.pop(loop, None)

    def registry_size(self):
        """Return the number of loop entries (primarily for diagnostics/tests)."""
        with self._lock:
            return len(self._loops)

    async def acquire(self, name, app, start, rollback=None):
        loop = asyncio.get_running_loop()
        while True:
            with self._lock:
                state = self._state(loop, name)
                if id(app) in state["owners"]:
                    return
                task = state["task"]
                healthy = task is None or not task.done()
                if state["owners"] and healthy and not state["starting"]:
                    state["owners"][id(app)] = app
                    if task is not None:
                        app.state.background_tasks.add(task)
                    app.state.lifecycle_checks[name] = {"ok": True, "error": None}
                    return
                if state["owners"] and not healthy:
                    # Never join or replace a dead singleton while its current
                    # owners still own its cleanup.  Recovery here would either
                    # corrupt the reference count or race the final stop.
                    error = state["error"]
                    if error is None:
                        if task.cancelled():
                            error = "CancelledError: background task was cancelled"
                        else:
                            exception = task.exception()
                            error = (
                                f"{type(exception).__name__}: {exception}"
                                if exception is not None
                                else "RuntimeError: background task exited unexpectedly"
                            )
                        state["error"] = error
                        for owner in state["owners"].values():
                            owner.state.lifecycle_checks[name] = {
                                "ok": False,
                                "error": error,
                            }
                    raise SharedServiceStartupError(
                        f"shared {name} service is unavailable"
                    )
                if not state["owners"] and not state["starting"]:
                    state["starting"] = True
                    break
            # Cross-loop safe waiting: never await a Future/Lock made by a
            # different loop. Startup transitions are expected to be brief.
            await asyncio.sleep(0)

        task = None
        try:
            task = await start()
            if task is not None:
                await asyncio.sleep(0)
                if task.done():
                    task.result()
        except BaseException as exc:
            try:
                if task is not None:
                    if not task.done():
                        task.cancel()
                        await asyncio.gather(task, return_exceptions=True)
                    if rollback is not None:
                        await rollback()
            except BaseException:
                logger.exception("Failed to roll back %s startup cleanly", name)
            finally:
                with self._lock:
                    state = self._state(loop, name)
                    state["starting"] = False
                    state["error"] = f"{type(exc).__name__}: {exc}"
                    self._prune_loop_locked(loop)
            raise

        with self._lock:
            state = self._state(loop, name)
            state["starting"] = False
            state["task"] = task
            state["error"] = None
            state["owners"][id(app)] = app
        app.state.lifecycle_checks[name] = {"ok": True, "error": None}
        if task is not None:
            app.state.background_tasks.add(task)
            task.add_done_callback(
                lambda finished, owner_loop=loop: self._task_finished(
                    owner_loop, name, finished
                )
            )

    def _task_finished(self, loop, name, task):
        if task.cancelled():
            error = "CancelledError: background task was cancelled"
        else:
            try:
                exception = task.exception()
            except asyncio.CancelledError:
                exception = asyncio.CancelledError()
            error = (f"{type(exception).__name__}: {exception}" if exception is not None
                     else "RuntimeError: background task exited unexpectedly")
        with self._lock:
            state = self._state(loop, name, create=False)
            if state is None or state["task"] is not task:
                return
            state["error"] = error
            owners = tuple(state["owners"].values())
        for app in owners:
            app.state.lifecycle_checks[name] = {"ok": False, "error": error}

    async def release(self, name, app, stop):
        loop = asyncio.get_running_loop()
        with self._lock:
            state = self._state(loop, name, create=False)
            if state is None:
                return
            if id(app) not in state["owners"]:
                return
            state["owners"].pop(id(app), None)
            if state["owners"]:
                return
            task = state["task"]
            state["task"] = None
            state["error"] = None
            # Reuse the transition flag while final-owner shutdown is in
            # progress, preventing a new owner from starting into a concurrent
            # stop operation.
            state["starting"] = True
        try:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await stop()
        finally:
            with self._lock:
                state["starting"] = False
                self._prune_loop_locked(loop)


_shared_service_owners = _SharedServiceOwners()


def _effective_routes(routes):
    """Yield concrete routes, expanding lazy router groups recursively."""
    for route in routes:
        effective_candidates = getattr(route, "effective_candidates", None)
        if callable(effective_candidates):
            yield from _effective_routes(effective_candidates())
        else:
            yield route


def _route_paths(routes) -> set[str]:
    """Return concrete paths, including FastAPI's lazily included routers."""
    return {
        path
        for route in _effective_routes(routes)
        if (path := getattr(route, "path", None)) is not None
    }


def load_dynamic_routers(app: FastAPI, *, safe_mode: bool = True) -> dict:
    """Dynamically discover and mount routers from cortex_server.routers."""
    routers_dir = Path(__file__).parent / "routers"
    report = {"loaded": [], "safeModeSkipped": [], "failed": [], "missingRouter": []}
    for file_path in routers_dir.glob("*.py"):
        module_name = file_path.stem
        if module_name == "__init__" or module_name.startswith("_"):
            continue
        if module_name == "websockets":
            continue
        if safe_mode and module_name in DANGEROUS_ROUTERS:
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

    from cortex_server.services.parser_service import ParserService

    parser_workspace_roots = tuple(
        str(Path(value).expanduser().resolve())
        for value in os.getenv("CORTEX_WORKSPACE_ROOTS", os.getcwd()).split(os.pathsep)
        if value
    )
    write_auth_mode = os.getenv("CORTEX_WRITE_AUTH_MODE", "token_or_loopback").strip().lower()
    write_token = os.getenv("CORTEX_WRITE_TOKEN", "").strip()
    write_token_header = os.getenv("CORTEX_WRITE_TOKEN_HEADER", "x-cortex-write-token").strip().lower()
    safe_mode = os.getenv("CORTEX_SAFE_MODE", "true").lower() in {"1", "true", "yes", "on"}
    admin_token = os.getenv("CORTEX_ADMIN_TOKEN", "").strip()
    readiness_config = ReadinessConfig(
        required_paths=frozenset(
            value.strip()
            for value in os.getenv("CORTEX_REQUIRED_PATHS", "/l22/store,/knowledge/search").split(",")
            if value.strip()
        ),
        required_routers=frozenset(
            value.strip()
            for value in os.getenv("CORTEX_REQUIRED_ROUTERS", "l22,knowledge").split(",")
            if value.strip()
        ),
    )
    fail_closed_memory = os.getenv("CORTEX_FAIL_CLOSED_MEMORY_ENDPOINTS", "true").lower() in {"1", "true", "yes", "on"}
    try:
        redis_startup_timeout = float(os.getenv("CORTEX_REDIS_STARTUP_TIMEOUT_SECONDS", "2.0"))
        if not math.isfinite(redis_startup_timeout):
            raise ValueError
    except ValueError:
        redis_startup_timeout = 2.0
    # Configuration must not be able to turn startup into an unbounded wait.
    redis_startup_timeout = min(max(redis_startup_timeout, 0.1), 30.0)
    try:
        redis_monitor_interval = float(
            os.getenv("CORTEX_REDIS_MONITOR_INTERVAL_SECONDS", "5.0")
        )
        if not math.isfinite(redis_monitor_interval):
            raise ValueError
    except ValueError:
        redis_monitor_interval = 5.0
    redis_monitor_interval = min(max(redis_monitor_interval, 0.1), 300.0)
    allowed_origins = frozenset(
        origin.strip()
        for origin in os.getenv(
            "CORTEX_ALLOW_ORIGINS", "http://localhost,https://localhost"
        ).split(",")
        if origin.strip()
    )
    websocket_security = WebSocketSecurityConfig(
        write_auth_mode=write_auth_mode,
        write_token=write_token,
        write_token_header=write_token_header,
        allowed_origins=allowed_origins,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.lifecycle_checks = _not_started_lifecycle_checks()
        # Initialize every cleanup reference before the first operation that can
        # fail.  In particular, cancellation may arrive at any startup await.
        redis_worker = None
        redis_monitor = None
        acquired = []
        app.state.background_tasks = set()
        try:
            if fail_closed_memory:
                route_paths = _route_paths(app.routes)
                required_paths = {"/l22/store", "/knowledge/search"}
                missing_paths = sorted(required_paths - route_paths)
                if missing_paths:
                    raise RuntimeError(
                        f"Fail-closed startup: missing required memory endpoints: {', '.join(missing_paths)}"
                    )

            def start_and_check_redis() -> None:
                result = subprocess.run(
                    ["redis-server", "--daemonize", "yes"], check=False,
                    timeout=redis_startup_timeout,
                )
                if result.returncode != 0:
                    raise RuntimeError(f"redis-server exited with status {result.returncode}")
                from cortex_server.worker import check_redis_connection
                if check_redis_connection() is not True:
                    raise RuntimeError("Redis connectivity check did not confirm readiness")

            redis_worker = asyncio.create_task(
                asyncio.to_thread(start_and_check_redis), name="cortex-redis-startup"
            )
            redis_startup_pending = False
            try:
                await asyncio.wait_for(asyncio.shield(redis_worker), timeout=redis_startup_timeout)
                app.state.lifecycle_checks["redis"] = {"ok": True, "error": None}
                logger.info("Redis is reachable for background task processing")
            except asyncio.TimeoutError:
                redis_startup_pending = True
                error = f"Redis startup timed out after {redis_startup_timeout:g} seconds"
                app.state.lifecycle_checks["redis"] = {"ok": False, "error": error}
                logger.warning("Redis is not ready: %s", error)
            except subprocess.TimeoutExpired:
                error = f"Redis startup timed out after {redis_startup_timeout:g} seconds"
                app.state.lifecycle_checks["redis"] = {"ok": False, "error": error}
                logger.warning("Redis is not ready: %s", error)
            except Exception as e:
                app.state.lifecycle_checks["redis"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                logger.warning("Redis is not ready: %s", e)

            async def monitor_redis() -> None:
                from cortex_server.worker import check_redis_connection

                previously_ok = app.state.lifecycle_checks["redis"]["ok"]
                if redis_startup_pending:
                    try:
                        await asyncio.shield(redis_worker)
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        app.state.lifecycle_checks["redis"] = {
                            "ok": False,
                            "error": f"{type(exc).__name__}: {exc}",
                        }
                        logger.warning("Late Redis startup failed: %s", exc)
                        previously_ok = False
                    else:
                        app.state.lifecycle_checks["redis"] = {
                            "ok": True,
                            "error": None,
                        }
                        logger.info("Redis connectivity recovered after startup timeout")
                        previously_ok = True

                while True:
                    await asyncio.sleep(redis_monitor_interval)
                    connectivity_check = asyncio.create_task(
                        asyncio.to_thread(check_redis_connection),
                        name="cortex-redis-connectivity-check",
                    )
                    try:
                        reachable = await asyncio.shield(connectivity_check)
                        if reachable is not True:
                            raise RuntimeError(
                                "Redis connectivity check did not confirm readiness"
                            )
                    except asyncio.CancelledError:
                        # Cancelling an asyncio wrapper cannot stop a function that is
                        # already running in an executor. Observe the bounded socket
                        # check before allowing lifespan shutdown to complete.
                        await asyncio.gather(connectivity_check, return_exceptions=True)
                        raise
                    except Exception as exc:
                        app.state.lifecycle_checks["redis"] = {
                            "ok": False,
                            "error": f"{type(exc).__name__}: {exc}",
                        }
                        if previously_ok:
                            logger.warning("Redis connectivity monitor failed: %s", exc)
                        previously_ok = False
                    else:
                        app.state.lifecycle_checks["redis"] = {
                            "ok": True,
                            "error": None,
                        }
                        if not previously_ok:
                            logger.info("Redis connectivity recovered")
                        previously_ok = True

            redis_monitor = asyncio.create_task(
                monitor_redis(), name="cortex-redis-monitor"
            )

            async def stop_service(name):
                if name == "awareness":
                    from cortex_server.routers.awareness import stop_awareness
                    await stop_awareness()
                elif name == "chronos":
                    from cortex_server.modules.chronos import get_chronos
                    get_chronos().stop()
                else:
                    from cortex_server.scheduler import stop_scheduler
                    await stop_scheduler()

            try:
                from cortex_server.scheduler import start_scheduler
                async def start_main_scheduler():
                    start_scheduler()
                await _shared_service_owners.acquire(
                    "scheduler", app, start_main_scheduler,
                    lambda: stop_service("scheduler"),
                )
                acquired.append("scheduler")
            except Exception as e:
                app.state.lifecycle_checks["scheduler"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                logger.warning("Scheduler is not ready: %s", e)
            try:
                from cortex_server.modules.chronos import get_chronos
                async def start_chronos():
                    return asyncio.create_task(get_chronos().start_scheduler(), name="cortex-chronos")
                await _shared_service_owners.acquire(
                    "chronos", app, start_chronos,
                    lambda: stop_service("chronos"),
                )
                acquired.append("chronos")
            except Exception as e:
                app.state.lifecycle_checks["chronos"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                logger.warning("Chronos is not ready: %s", e)
            try:
                from cortex_server.routers.awareness import start_awareness
                await _shared_service_owners.acquire(
                    "awareness", app, start_awareness,
                    lambda: stop_service("awareness"),
                )
                acquired.append("awareness")
            except Exception as e:
                app.state.lifecycle_checks["awareness"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                logger.warning("Awareness is not ready: %s", e)
            yield
        finally:
            try:
                if redis_monitor is not None:
                    redis_monitor.cancel()
                    await asyncio.gather(redis_monitor, return_exceptions=True)
                # The worker has enforceable subprocess and socket timeouts. Keep it
                # strongly referenced and observe it before the lifespan disappears.
                if redis_worker is not None:
                    await asyncio.gather(redis_worker, return_exceptions=True)
                for name in reversed(acquired):
                    try:
                        await _shared_service_owners.release(
                            name, app, lambda name=name: stop_service(name)
                        )
                    except BaseException:
                        logger.exception("Failed to stop %s cleanly", name)
            finally:
                app.state.lifecycle_checks = _not_started_lifecycle_checks()

    app = FastAPI(
        title="The Cortex",
        description="Local Knowledge Graph and Tool Server",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )
    app.state.websocket_security = websocket_security
    app.state.readiness_config = readiness_config
    app.state.lifecycle_checks = _not_started_lifecycle_checks()
    app.state.parser_service = ParserService(workspace_roots=parser_workspace_roots)

    app.add_middleware(
        WriteAuthorizationMiddleware,
        mode=write_auth_mode,
        token=write_token,
        header_name=write_token_header,
    )

    @app.middleware("http")
    async def admin_guard(request, call_next):
        if safe_mode and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            p = request.url.path
            if any(p.startswith(f"/{r}/") or p == f"/{r}" for r in DANGEROUS_ROUTERS):
                if not admin_token or request.headers.get("x-cortex-admin-token", "") != admin_token:
                    from fastapi.responses import JSONResponse
                    return JSONResponse(status_code=403, content={"success": False, "error": "admin token required"})
        return await call_next(request)

    # CORS middleware (tightened default; configurable via env)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(allowed_origins),
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
    router_load_report = load_dynamic_routers(app, safe_mode=safe_mode)
    app.include_router(websockets.router, tags=["WebSockets"])

    def readiness_payload() -> dict:
        route_paths = _route_paths(app.routes)
        required_paths = readiness_config.required_paths
        required_routers = readiness_config.required_routers
        loaded_routers = set(router_load_report["loaded"])
        missing_paths = sorted(required_paths - route_paths)
        missing_routers = sorted(required_routers - loaded_routers)
        graph_path = Path(__file__).resolve().parents[1] / "cortex_graph.db"
        graph_available = graph_path.is_file()
        checks = {
            "requiredPaths": {"ok": not missing_paths, "missing": missing_paths},
            "requiredRouters": {"ok": not missing_routers, "missing": missing_routers},
            "structuralGraph": {
                "ok": graph_available,
                "required": False,
                "degraded": not graph_available,
                "path": str(graph_path),
            },
            "writeAuthorization": {
                "ok": write_auth_mode == "token_or_loopback" or (write_auth_mode == "token_required" and bool(write_token)),
                "mode": write_auth_mode,
                "tokenConfigured": bool(write_token),
            },
            "routerImports": {
                "ok": not any(row["router"] in required_routers for row in router_load_report["failed"]),
                "failed": [row for row in router_load_report["failed"] if row["router"] in required_routers],
            },
        }
        checks.update(getattr(app.state, "lifecycle_checks", {}))
        scheduler_check = checks.get("scheduler")
        if scheduler_check is not None and scheduler_check.get("ok"):
            try:
                from cortex_server.scheduler import scheduler

                if not scheduler.running:
                    raise RuntimeError("scheduler is not running")
            except Exception as exc:
                checks["scheduler"] = {
                    "ok": False,
                    "error": f"{type(exc).__name__}: {exc}",
                }
        ready = all(
            check["ok"]
            for check in checks.values()
            if check.get("required", True)
        )
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

    @app.get("/ready")
    async def readiness_check():
        from fastapi.responses import JSONResponse
        payload = readiness_payload()
        return JSONResponse(status_code=200 if payload["ready"] else 503, content=payload)

    @app.get("/capabilities")
    async def capability_inventory():
        capabilities = []
        for route in _effective_routes(app.routes):
            methods = sorted(method for method in (getattr(route, "methods", None) or []) if method not in {"HEAD", "OPTIONS"})
            if not methods:
                continue
            capabilities.append({
                "path": getattr(route, "path", ""),
                "methods": methods,
                "write": any(method in MUTATING_METHODS for method in methods),
                "name": getattr(route, "name", None),
            })
        return {
            "schemaVersion": "cortex.capability_inventory.v1",
            "security": {
                "writeAuthorizationMode": write_auth_mode,
                "writeTokenConfigured": bool(write_token),
                "writeTokenHeader": write_token_header,
            },
            "capabilityCount": len(capabilities),
            "writeCapabilityCount": sum(1 for row in capabilities if row["write"]),
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
                "networkBind": os.getenv("CORTEX_HOST", "127.0.0.1"),
            },
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
    uvicorn.run(app, host=os.getenv("CORTEX_HOST", "127.0.0.1"), port=int(os.getenv("CORTEX_PORT", "8000")))
