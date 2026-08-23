"""The Hive - Swarm Orchestration for The Cortex.
Uses Celery for non-blocking async task processing.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import httpx
import json
import uuid

from cortex_server.internal_addressing import internal_url
from cortex_server.modules.hive_novelty import build_l3_novel_plan
from cortex_server.modules.async_offload import (
    BlockingCallCapacityExceeded,
    BlockingCallDeadlineExceeded,
    run_blocking,
)
from cortex_server.modules.level_registry import LEVEL_REGISTRY_VERSION, get_level_entry
from cortex_server.modules.memory_scope import (
    MemoryScopeAuthError,
    configured_internal_memory_headers,
)
from cortex_server.routers.queue import ScheduleRequest, schedule_task
from cortex_server.worker import app as celery_app

router = APIRouter()

ORACLE_URL = internal_url("/oracle/chat")
QUEUE_URL = internal_url("/queue/schedule")
LIBRARIAN_EMBED = internal_url("/librarian/embed")
LIBRARIAN_SEARCH = internal_url("/librarian/search")


class SwarmRequest(BaseModel):
    goal: str = Field(..., description="The complex goal to achieve")
    context: Optional[str] = None
    novelty_mode: str = Field(default="standard", description="standard|l3_novel")
    worker_pool: Optional[List[str]] = None
    assumptions: Optional[List[str]] = None
    options: Optional[Dict[str, Any]] = None
    idempotency_key: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    )


class AdmittedSwarmRequest(SwarmRequest):
    """HTTP request contract requiring durable queue idempotency."""

    idempotency_key: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    )


class NovelSwarmRequest(BaseModel):
    goal: str = Field(..., description="The complex goal to achieve")
    context: Optional[str] = None
    tasks: Optional[List[str]] = None
    worker_pool: Optional[List[str]] = None
    assumptions: Optional[List[str]] = None
    options: Optional[Dict[str, Any]] = None


class SwarmResponse(BaseModel):
    master_plan_id: str
    plan: str
    task_ids: List[str]
    status: str


class QueuedResponse(BaseModel):
    status: str
    task_id: str
    message: str


async def _swarm_orchestrate(request: SwarmRequest) -> QueuedResponse:
    """Queue a swarm planning task for async processing. Returns immediately.

    When novelty_mode=l3_novel, a full six-idea novelty plan is generated and
    embedded into context for downstream workers and auditability.
    """
    if not request.goal.strip():
        raise HTTPException(status_code=400, detail="Goal cannot be empty")

    context_payload: Any = request.context
    if (request.novelty_mode or "standard").lower() == "l3_novel":
        novelty_plan = build_l3_novel_plan(
            goal=request.goal,
            context=request.context,
            worker_pool=request.worker_pool,
            assumptions=request.assumptions,
            options=request.options,
        )
        context_payload = json.dumps(
            {
                "context": request.context,
                "novelty_mode": "l3_novel",
                "novel_plan": novelty_plan,
            },
            ensure_ascii=False,
        )

    if request.idempotency_key:
        # HTTP submissions reuse the queue's bounded admission/idempotency
        # contract instead of blocking this event loop on a broker call.
        task = await schedule_task(
            ScheduleRequest(
                task="cortex_tasks.process_swarm",
                args=[request.goal, context_payload],
                idempotency_key=request.idempotency_key,
            )
        )
        task_id = task.task_id
    else:
        # Preserve the pre-admission programmatic contract for existing local
        # callers. HTTP requests cannot enter this branch because their model
        # requires an idempotency key.
        submission_id = str(uuid.uuid4())
        try:
            task = await run_blocking(
                "celery.send_swarm",
                celery_app.send_task,
                "cortex_tasks.process_swarm",
                args=[request.goal, context_payload],
                countdown=0,
                task_id=submission_id,
                timeout_seconds=5.0,
            )
        except BlockingCallCapacityExceeded as exc:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": str(exc),
                    "task_id": submission_id,
                    "submission": "not_dispatched",
                },
            ) from exc
        except BlockingCallDeadlineExceeded as exc:
            raise HTTPException(
                status_code=504,
                detail={
                    "error": str(exc),
                    "task_id": submission_id,
                    "submission": "tracked_pending_completion",
                },
            ) from exc
        task_id = task.id

    suffix = " (L3 novel plan attached)" if (request.novelty_mode or "").lower() == "l3_novel" else ""
    return QueuedResponse(
        status="queued",
        task_id=task_id,
        message=f"Swarm planning task dispatched{suffix}. Check task status via /queue/status/",
    )


@router.post("/swarm", response_model=QueuedResponse)
async def swarm_orchestrate(request: AdmittedSwarmRequest) -> QueuedResponse:
    """Expose the admitted HTTP contract while retaining direct-call compatibility."""

    return await _swarm_orchestrate(request)


@router.post("/swarm/novel/plan")
async def swarm_novel_plan(request: NovelSwarmRequest):
    """Build an executable L3 novelty plan implementing ideas 1-6.

    Returns algorithm artifacts for:
      1) Swarm Auction Scheduler (SAS)
      2) Counterfactual Branch Swarm (CBS)
      3) Disagreement-First Hive (DFH)
      4) Verifier-Escrow Parallelism (VEP)
      5) Adaptive Topology Hive (ATH)
      6) Novelty-Seeking Exploration Budget (NSEB)
    """
    if not request.goal.strip():
        raise HTTPException(status_code=400, detail="Goal cannot be empty")

    plan = build_l3_novel_plan(
        goal=request.goal,
        context=request.context,
        tasks=request.tasks,
        worker_pool=request.worker_pool,
        assumptions=request.assumptions,
        options=request.options,
    )

    return {
        "status": "ok",
        "mode": "l3_novel",
        "implemented": ["SAS", "CBS", "DFH", "VEP", "ATH", "NSEB"],
        "plan": plan,
    }


@router.get("/plan/{plan_id}")
async def get_swarm_plan(plan_id: str):
    """Retrieve a swarm plan from Librarian memory."""
    try:
        memory_headers = configured_internal_memory_headers()
    except MemoryScopeAuthError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if memory_headers is None:
        raise HTTPException(
            status_code=503,
            detail="configured internal memory principal is unavailable",
        )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            search_payload = {"query": f"HIVE MASTER PLAN [{plan_id}]", "n_results": 1}
            resp = await client.post(
                LIBRARIAN_SEARCH,
                json=search_payload,
                headers=memory_headers,
            )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=503,
                    detail=f"Librarian search unavailable ({resp.status_code})",
                )
            results = resp.json().get("results", [])
            if results:
                return {"found": True, "plan_id": plan_id, "memory": results[0]}
            return {"found": False, "plan_id": plan_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@router.get("/status")
async def hive_status():
    """Check Hive dependencies — uses async httpx to avoid self-call deadlock."""
    services = {}
    async with httpx.AsyncClient(timeout=3) as client:
        try:
            resp = await client.get(internal_url("/oracle/status"))
            services["oracle"] = "online" if resp.status_code == 200 else "offline"
        except Exception:
            services["oracle"] = "offline"
        try:
            resp = await client.get(internal_url("/librarian/stats"))
            services["librarian"] = "online" if resp.status_code == 200 else "offline"
        except Exception:
            services["librarian"] = "offline"

    # Check Redis/Celery
    try:
        await run_blocking(
            "celery.connect",
            lambda: celery_app.connection().connect(),
            timeout_seconds=2.0,
        )
        services["celery"] = "online"
    except Exception:
        services["celery"] = "offline"

    identity = get_level_entry(12) or {"level": 12, "name": "Hive/Darwin"}
    online_services = sum(value == "online" for value in services.values())
    status = (
        "active"
        if online_services == len(services)
        else "degraded"
        if online_services
        else "unavailable"
    )
    return {
        "success": status == "active",
        "status": status,
        "level": identity["level"],
        "name": identity["name"],
        "registry_version": LEVEL_REGISTRY_VERSION,
        "services": services,
        "all_online": all(s == "online" for s in services.values()),
        "novelty_features": {
            "SAS": True,
            "CBS": True,
            "DFH": True,
            "VEP": True,
            "ATH": True,
            "NSEB": True,
        },
    }
