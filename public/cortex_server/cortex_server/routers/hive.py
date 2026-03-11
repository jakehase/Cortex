"""The Hive - Swarm Orchestration for The Cortex.
Uses Celery for non-blocking async task processing.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import httpx
import uuid
import json

from cortex_server.worker import app as celery_app
from cortex_server.modules.hive_novelty import build_l3_novel_plan

router = APIRouter()

ORACLE_URL = "http://localhost:8888/oracle/chat"
QUEUE_URL = "http://localhost:8888/queue/schedule"
LIBRARIAN_EMBED = "http://localhost:8888/librarian/embed"
LIBRARIAN_SEARCH = "http://localhost:8888/librarian/search"


class SwarmRequest(BaseModel):
    goal: str = Field(..., description="The complex goal to achieve")
    context: Optional[str] = None
    novelty_mode: str = Field(default="standard", description="standard|l3_novel")
    worker_pool: Optional[List[str]] = None
    assumptions: Optional[List[str]] = None
    options: Optional[Dict[str, Any]] = None


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


@router.post("/swarm", response_model=QueuedResponse)
async def swarm_orchestrate(request: SwarmRequest):
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

    # Dispatch the heavy processing to Celery
    task = celery_app.send_task(
        "cortex_tasks.process_swarm",
        args=[request.goal, context_payload],
        countdown=0,
    )

    suffix = " (L3 novel plan attached)" if (request.novelty_mode or "").lower() == "l3_novel" else ""
    return QueuedResponse(
        status="queued",
        task_id=task.id,
        message=f"Swarm planning task dispatched{suffix}. Check task status via /queue/status/",
    )


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
        async with httpx.AsyncClient(timeout=10) as client:
            search_payload = {"query": f"HIVE MASTER PLAN [{plan_id}]", "n_results": 1}
            resp = await client.post(LIBRARIAN_SEARCH, json=search_payload)
            results = resp.json().get("results", [])
            if results:
                return {"found": True, "plan_id": plan_id, "memory": results[0]}
            return {"found": False, "plan_id": plan_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@router.get("/status")
async def hive_status():
    """Check Hive dependencies — uses async httpx to avoid self-call deadlock."""
    services = {}
    async with httpx.AsyncClient(timeout=3) as client:
        try:
            resp = await client.get("http://localhost:8888/oracle/status")
            services["oracle"] = "online" if resp.status_code == 200 else "offline"
        except Exception:
            services["oracle"] = "offline"
        try:
            resp = await client.get("http://localhost:8888/librarian/stats")
            services["librarian"] = "online" if resp.status_code == 200 else "offline"
        except Exception:
            services["librarian"] = "offline"

    # Check Redis/Celery
    try:
        celery_app.connection().connect()
        services["celery"] = "online"
    except Exception:
        services["celery"] = "offline"

    return {
        "level": 3,
        "name": "Hive",
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
