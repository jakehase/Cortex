"""The Hive (L12) - swarm decomposition and read-only fan-out for The Cortex.

``POST /hive/run`` runs one bounded swarm synchronously: the level model breaks
the goal into at most four independent research questions, each question runs
in process through a READ-ONLY level adapter (librarian memory recall,
mnemosyne knowledge search, governed ghost web search), and the model
synthesises an answer citing subtask ids.  ``POST /hive/swarm`` starts the same
run in the background (action capability + idempotency key required) and
``GET /hive/plan/{run_id}`` returns its recorded result.

The previous Celery path (``cortex_tasks.process_swarm``) could never be
admitted (it does not consume delegated capabilities) and, when invoked
directly, fell back to canned sub-tasks and sleep-10 child jobs.  Hive no longer
dispatches it.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import asyncio
import httpx
import uuid

from cortex_server.internal_addressing import internal_url, health_probe_headers as _health_probe_headers
from cortex_server.modules import hive_swarm
from cortex_server.modules.hive_novelty import build_l3_novel_plan
from cortex_server.modules.async_offload import run_blocking
from cortex_server.modules.level_model import scope_key_for_request
from cortex_server.modules.level_registry import LEVEL_REGISTRY_VERSION, get_level_entry
from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    require_action_capability,
)
from cortex_server.modules.memory_scope import (
    MemoryScopeAuthError,
    MEMORY_PRINCIPAL_HEADERS,
    AuthenticatedMemoryPrincipal,
    authenticate_memory_headers,
)
from cortex_server.worker import app as celery_app

router = APIRouter()


class SwarmRequest(BaseModel):
    goal: str = Field(..., description="The complex goal to achieve")
    context: Optional[str] = Field(default=None, max_length=2000)
    novelty_mode: str = Field(default="standard", description="standard|l3_novel (plan view only)")
    worker_pool: Optional[List[str]] = None
    assumptions: Optional[List[str]] = None
    options: Optional[Dict[str, Any]] = None
    max_subtasks: int = Field(default=hive_swarm.DEFAULT_SUBTASKS, ge=1, le=hive_swarm.MAX_SUBTASKS)
    idempotency_key: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    )


class AdmittedSwarmRequest(SwarmRequest):
    """HTTP request contract requiring idempotency."""

    idempotency_key: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    )


class HiveRunRequest(BaseModel):
    goal: str = Field(..., min_length=1, max_length=hive_swarm.MAX_GOAL_CHARS)
    context: Optional[str] = Field(default=None, max_length=2000)
    max_subtasks: int = Field(default=hive_swarm.DEFAULT_SUBTASKS, ge=1, le=hive_swarm.MAX_SUBTASKS)


class NovelSwarmRequest(BaseModel):
    goal: str = Field(..., description="The complex goal to achieve")
    context: Optional[str] = None
    tasks: Optional[List[str]] = None
    worker_pool: Optional[List[str]] = None
    assumptions: Optional[List[str]] = None
    options: Optional[Dict[str, Any]] = None
    max_subtasks: int = Field(default=hive_swarm.DEFAULT_SUBTASKS, ge=1, le=hive_swarm.MAX_SUBTASKS)


class QueuedResponse(BaseModel):
    status: str
    task_id: str
    message: str
    execution: str = "in_process"
    reused: bool = False


def _swarm_context(http_request: Optional[Request], extra_context: Optional[str] = None) -> Dict[str, Any]:
    """Principal-scoped context for model calls and read-only sub-adapters.

    Memory identity comes only from signed principal headers (verified here);
    without them the librarian sub-adapter reports itself blocked instead of
    reading anyone's memory.
    """

    context: Dict[str, Any] = {}
    principal: Optional[AuthenticatedMemoryPrincipal] = None
    if http_request is not None:
        state = getattr(http_request, "state", None)
        existing = getattr(state, "authenticated_memory_principal", None) if state is not None else None
        if isinstance(existing, AuthenticatedMemoryPrincipal):
            principal = existing
        else:
            headers = getattr(http_request, "headers", {}) or {}
            if any(str(headers.get(h, "") or "").strip() for h in MEMORY_PRINCIPAL_HEADERS.values()):
                try:
                    principal = authenticate_memory_headers(headers)
                except MemoryScopeAuthError as exc:
                    status = 503 if "not configured" in str(exc) else 403
                    raise HTTPException(status_code=status, detail=str(exc)) from exc
                if state is not None:
                    state.authenticated_memory_principal = principal
    if principal is not None:
        context.update(
            memory_principal_key=principal.memory_principal_key,
            file_memory_grant_key=principal.file_memory_grant_key,
            tenant_id=principal.tenant_id,
            workspace_id=principal.storage_workspace_id,
            channel_id=principal.channel_id,
        )
    context["principal_scope_key"] = (
        scope_key_for_request(http_request, "hive") if http_request is not None else "admin:level.hive"
    )
    if extra_context:
        context["hive_context"] = extra_context[:2000]
    return context


@router.post("/run")
async def hive_run(request: HiveRunRequest, http_request: Request = None) -> Dict[str, Any]:
    """Run one bounded, read-only swarm and return the synthesis with receipts."""

    if not request.goal.strip():
        raise HTTPException(status_code=400, detail="Goal cannot be empty")
    context = _swarm_context(http_request, request.context)
    result = await hive_swarm.run_and_record(
        request.goal, context=context, max_subtasks=request.max_subtasks,
    )
    result.setdefault("name", "Hive")
    return result


async def _swarm_orchestrate(
    request: SwarmRequest,
    authorization: Optional[ActionAuthorization] = None,
    http_request: Optional[Request] = None,
) -> QueuedResponse:
    """Start a background swarm run in this process. Returns immediately."""
    if not request.goal.strip():
        raise HTTPException(status_code=400, detail="Goal cannot be empty")
    if len(request.goal) > hive_swarm.MAX_GOAL_CHARS:
        raise HTTPException(status_code=400, detail="Goal is too long")
    context = _swarm_context(http_request, request.context)
    key = request.idempotency_key or f"direct-{uuid.uuid4().hex}"
    try:
        started = hive_swarm.start_background_run(
            request.goal,
            context=context,
            idempotency_key=key,
            max_subtasks=request.max_subtasks,
        )
    except hive_swarm.HiveBusy as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": str(exc), "submission": "not_dispatched"},
        ) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "hive run store unavailable", "submission": "not_dispatched"},
        ) from exc
    run_id = str(started["run_id"])
    reused = bool(started.get("reused"))
    status = "queued" if not reused else str(started.get("status") or "unknown")
    return QueuedResponse(
        status=status,
        task_id=run_id,
        message=(
            f"Swarm run {'already exists' if reused else 'started in process'}. "
            f"Poll GET /hive/plan/{run_id} for the decomposition, subtask receipts and synthesis."
        ),
        reused=reused,
    )


@router.post("/swarm", response_model=QueuedResponse)
async def swarm_orchestrate(
    request: AdmittedSwarmRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
    http_request: Request = None,
) -> QueuedResponse:
    """Admitted background swarm (action capability + idempotency key)."""

    return await _swarm_orchestrate(request, authorization, http_request)


@router.post("/swarm/novel/plan")
async def swarm_novel_plan(request: NovelSwarmRequest, http_request: Request = None):
    """Plan view over real subtasks (caller-supplied or model-decomposed). Executes nothing."""
    if not request.goal.strip():
        raise HTTPException(status_code=400, detail="Goal cannot be empty")

    decomposition: Optional[Dict[str, Any]] = None
    subtasks: Optional[List[Dict[str, Any]]] = None
    if not [t for t in (request.tasks or []) if isinstance(t, str) and t.strip()]:
        decomposition = await hive_swarm.decompose_goal(
            request.goal,
            context=_swarm_context(http_request, request.context),
            max_subtasks=request.max_subtasks,
        )
        if decomposition.get("status") != "ok":
            return {**decomposition, "success": False, "operation": "hive.plan", "mode": "l3_novel"}
        subtasks = decomposition["subtasks"]

    plan = build_l3_novel_plan(
        goal=request.goal,
        context=request.context,
        tasks=request.tasks,
        worker_pool=request.worker_pool,
        assumptions=request.assumptions,
        options=request.options,
        subtasks=subtasks,
    )
    return {
        "success": plan.get("status") == "planned",
        "status": "ok" if plan.get("status") == "planned" else plan.get("status"),
        "operation": "hive.plan",
        "mode": "l3_novel",
        "origin": "model" if decomposition else "caller_supplied",
        "templates": list(plan.get("plan_templates", {}).keys()),
        "plan": plan,
        **(
            {"decomposition": decomposition.get("decomposition"), "adapters": decomposition.get("adapters")}
            if decomposition
            else {}
        ),
    }


@router.get("/plan/{plan_id}")
async def get_swarm_plan(plan_id: str):
    """Retrieve a recorded swarm run (status, subtasks, synthesis)."""
    if not plan_id or len(plan_id) > 64:
        raise HTTPException(status_code=400, detail="invalid plan id")
    try:
        row = await run_blocking("hive.plan.read", hive_swarm.get_run, plan_id, timeout_seconds=5.0)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"hive run store unavailable ({type(exc).__name__})") from exc
    if row is None:
        return {"found": False, "plan_id": plan_id}
    return {"found": True, "plan_id": plan_id, "status": row.get("status"), "run": row}


def _dependency_health_state(response: httpx.Response) -> str:
    """Transport success alone does not prove a dependency is healthy."""
    if response.status_code in {401, 403}:
        return "unauthorized"
    if response.status_code != 200:
        return "offline"
    try:
        payload = response.json()
    except (ValueError, TypeError):
        return "unknown"
    if not isinstance(payload, dict):
        return "unknown"
    status = payload.get("status")
    if not isinstance(status, str):
        return "unknown"
    if status in {"degraded", "unavailable", "offline", "stopped"}:
        return status
    if payload.get("success") is False or payload.get("ok") is False:
        return "degraded"
    return "online" if status in {"online", "active", "ready", "healthy", "ok"} else "unknown"


def _darwin_mounted(http_request: Optional[Request]) -> Optional[bool]:
    app = getattr(http_request, "app", None) if http_request is not None else None
    routes = getattr(app, "routes", None)
    if routes is None:
        return None
    return any(str(getattr(route, "path", "")) == "/darwin/status" for route in routes)


async def _oracle_dependency_state() -> str:
    """In-process: is the model lane the swarm uses configured and proven?"""
    from cortex_server.routers import oracle

    try:
        probe = await asyncio.wait_for(asyncio.to_thread(oracle._probe_openclaw_status), timeout=3.0)
    except Exception:
        return "offline"
    if probe.get("ok"):
        return "online"  # configured and a verified provider completion is recent
    if probe.get("ready"):
        return "ready"  # configured; no recent verified completion yet (e.g. after restart)
    return "offline"


async def _librarian_dependency_state() -> str:
    """In-process: can the swarm's memory subtasks actually recall?"""
    from cortex_server.routers import librarian

    try:
        collection = await asyncio.wait_for(librarian._collection_available(), timeout=3.0)
        scope_ready = bool(librarian._memory_scope_auth_ready())
        fallback = bool(await asyncio.to_thread(librarian._fallback_store_appendable))
    except Exception:
        return "offline"
    if collection and scope_ready:
        return "online"
    if fallback and scope_ready:
        return "degraded"
    return "offline"


async def _dependency_states() -> Dict[str, str]:
    # In-process checks: the previous HTTP self-calls carried no credentials and
    # were rejected by the auth layer, so Hive always looked unavailable.
    oracle_state, librarian_state = await asyncio.gather(
        _oracle_dependency_state(), _librarian_dependency_state()
    )
    return {"oracle": oracle_state, "librarian": librarian_state}


_USABLE_DEPENDENCY_STATES = {"online", "ready"}


@router.get("/status")
async def hive_status(http_request: Request = None):
    """Check the swarm's dependencies in-process without elevating the caller."""
    services = await _dependency_states()

    # Celery is no longer on the swarm path; it is reported for visibility only.
    auxiliary = {}
    try:
        await run_blocking(
            "celery.connect",
            lambda: celery_app.connection().connect(),
            timeout_seconds=2.0,
        )
        auxiliary["celery_broker"] = "online"
    except Exception:
        auxiliary["celery_broker"] = "offline"

    adapters = hive_swarm.adapter_availability()
    any_adapter = any(row.get("available") for row in adapters.values())
    identity = get_level_entry(12) or {"level": 12, "name": "Hive/Darwin"}
    online_services = sum(value in _USABLE_DEPENDENCY_STATES for value in services.values())
    status = (
        "active"
        if online_services == len(services)
        else "degraded"
        if online_services
        else "unavailable"
    )
    swarm_ready = services.get("oracle") in _USABLE_DEPENDENCY_STATES and any_adapter
    return {
        "success": status == "active",
        "status": status,
        "level": identity["level"],
        "name": identity["name"],
        "registry_version": LEVEL_REGISTRY_VERSION,
        "services": services,
        "auxiliary": auxiliary,
        "all_online": all(s == "online" for s in services.values()),
        "capabilities": {
            "swarm_run": swarm_ready,
            "background_swarm": swarm_ready,
            "celery_swarm_dispatch": False,
            "plan_view": True,
        },
        "subtask_adapters": adapters,
        "swarm_stats": hive_swarm.stats(),
        "darwin": {
            "mounted": _darwin_mounted(http_request),
            "role": "proposal-only code evolution; not part of the swarm path",
        },
    }
