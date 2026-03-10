"""The Hive - Swarm Orchestration for The Cortex.
Uses Celery for non-blocking async task processing.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
import requests
import uuid
import json

from cortex_server.worker import app as celery_app

router = APIRouter()

ORACLE_URL = "http://localhost:8888/oracle/chat"
QUEUE_URL = "http://localhost:8888/queue/schedule"
LIBRARIAN_EMBED = "http://localhost:8888/librarian/embed"
LIBRARIAN_SEARCH = "http://localhost:8888/librarian/search"


class SwarmRequest(BaseModel):
    goal: str = Field(..., description="The complex goal to achieve")
    context: Optional[str] = None


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
    """Queue a swarm planning task for async processing. Returns immediately."""
    if not request.goal.strip():
        raise HTTPException(status_code=400, detail="Goal cannot be empty")
    
    # Dispatch the heavy processing to Celery
    # This returns immediately without blocking the API
    task = celery_app.send_task(
        "cortex_tasks.process_swarm",
        args=[request.goal, request.context],
        countdown=0
    )
    
    return QueuedResponse(
        status="queued",
        task_id=task.id,
        message="Swarm planning task dispatched. Check task status via /queue/status/"
    )


@router.get("/plan/{plan_id}")
async def get_swarm_plan(plan_id: str):
    try:
        search_payload = {"query": f"HIVE MASTER PLAN [{plan_id}]", "n_results": 1}
        resp = requests.post(LIBRARIAN_SEARCH, json=search_payload, timeout=10)
        results = resp.json().get("results", [])
        if results:
            return {"found": True, "plan_id": plan_id, "memory": results[0]}
        return {"found": False, "plan_id": plan_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@router.get("/status")
async def hive_status():
    services = {}
    try:
        resp = requests.get("http://localhost:8888/oracle/status", timeout=2)
        services["oracle"] = "online" if resp.status_code == 200 else "offline"
    except:
        services["oracle"] = "offline"
    try:
        resp = requests.get("http://localhost:8888/librarian/stats", timeout=2)
        services["librarian"] = "online" if resp.status_code == 200 else "offline"
    except:
        services["librarian"] = "offline"
    return {"services": services, "all_online": all(s == "online" for s in services.values())}
