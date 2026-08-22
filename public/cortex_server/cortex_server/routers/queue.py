"""
Queue Router - API endpoints for task queue management.
Uses non-blocking threadpool for Celery inspection to keep API responsive.
"""
from typing import Any, List
import asyncio

from celery.result import AsyncResult
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from cortex_server.worker import app as celery_app

router = APIRouter()


class ScheduleRequest(BaseModel):
    task: str
    args: List[Any] = []


class TaskResponse(BaseModel):
    task_id: str
    status: str


class TaskStatus(BaseModel):
    task_id: str
    status: str
    result: Any | None
    state: str


def _count_active_jobs_sync() -> int:
    """Synchronously count active Celery tasks - runs in threadpool."""
    try:
        # Get the inspector with short timeout
        inspect = celery_app.control.inspect(timeout=1.0)
        
        # Get active tasks from all workers
        active_tasks = inspect.active()
        
        if active_tasks is None:
            return 0
        
        # Count total active tasks across all workers
        total_jobs = 0
        for worker_name, tasks in active_tasks.items():
            if tasks:
                total_jobs += len(tasks)
        
        return total_jobs
    except Exception:
        # Default to 0 on any error/timeout
        return 0


@router.post("/schedule", response_model=TaskResponse)
async def schedule_task(request: ScheduleRequest) -> TaskResponse:
    """Schedule a task by name with optional args."""
    if request.task not in celery_app.tasks:
        raise HTTPException(status_code=404, detail=f"Unknown task: {request.task}")

    async_result = celery_app.send_task(request.task, args=request.args)
    return TaskResponse(task_id=async_result.id, status="scheduled")


@router.get("/status/{task_id}", response_model=TaskStatus)
async def get_status(task_id: str) -> TaskStatus:
    """Get status for a task by id."""
    result = AsyncResult(task_id, app=celery_app)
    state = result.state

    status_map = {
        "PENDING": "pending",
        "STARTED": "pending",
        "RETRY": "pending",
        "SUCCESS": "success",
        "FAILURE": "failure",
    }
    status = status_map.get(state, "pending")

    # Attempt to detect unknown task ids via backend metadata.
    meta = celery_app.backend.get_task_meta(task_id) if celery_app.backend else {}
    if not meta and state == "PENDING":
        raise HTTPException(status_code=404, detail=f"Unknown task id: {task_id}")

    return TaskStatus(
        task_id=task_id,
        status=status,
        result=result.result if status != "pending" else None,
        state=state,
    )


@router.get("/status")
async def get_queue_status():
    """Get queue status with strict timeout so this route never hangs."""
    try:
        active_jobs = await asyncio.wait_for(run_in_threadpool(_count_active_jobs_sync), timeout=1.5)
        return {
            "success": True,
            "status": "online",
            "active_jobs": int(active_jobs or 0),
            "source": "celery.inspect",
        }
    except asyncio.TimeoutError:
        return {
            "success": True,
            "status": "degraded",
            "active_jobs": 0,
            "source": "timeout_fallback",
        }
    except Exception:
        return {
            "success": True,
            "status": "degraded",
            "active_jobs": 0,
            "source": "error_fallback",
        }
