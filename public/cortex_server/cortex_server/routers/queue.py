"""
Queue Router - API endpoints for task queue management.
Uses non-blocking threadpool for Celery inspection to keep API responsive.
"""
from typing import Any, List
import asyncio
import uuid

from celery.result import AsyncResult
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from cortex_server.worker import app as celery_app
from cortex_server.modules.async_offload import (
    BlockingCallCapacityExceeded,
    BlockingCallDeadlineExceeded,
    run_blocking,
)

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
    inspect = celery_app.control.inspect(timeout=1.0)
    active_tasks = inspect.active()
    if active_tasks is None:
        raise RuntimeError("Celery workers did not answer the active-task probe")
    return sum(len(tasks or []) for tasks in active_tasks.values())


@router.post("/schedule", response_model=TaskResponse)
async def schedule_task(request: ScheduleRequest) -> TaskResponse:
    """Schedule a task by name with optional args."""
    if request.task not in celery_app.tasks:
        raise HTTPException(status_code=404, detail=f"Unknown task: {request.task}")

    submission_id = str(uuid.uuid4())
    try:
        async_result = await run_blocking(
            "celery.send_task",
            celery_app.send_task,
            request.task,
            args=request.args,
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
    return TaskResponse(task_id=async_result.id, status="scheduled")


@router.get("/status/{task_id}", response_model=TaskStatus)
async def get_status(task_id: str) -> TaskStatus:
    """Get status for a task by id."""
    def load_task_state():
        result = AsyncResult(task_id, app=celery_app)
        state = result.state
        meta = celery_app.backend.get_task_meta(task_id) if celery_app.backend else {}
        return result, state, meta

    try:
        result, state, meta = await run_blocking(
            "celery.task_status",
            load_task_state,
            timeout_seconds=2.0,
        )
    except BlockingCallDeadlineExceeded as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc

    status_map = {
        "PENDING": "pending",
        "STARTED": "pending",
        "RETRY": "pending",
        "SUCCESS": "success",
        "FAILURE": "failure",
    }
    status = status_map.get(state, "pending")

    # Attempt to detect unknown task ids via backend metadata.
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
        active_jobs = await run_blocking(
            "celery.inspect_active",
            _count_active_jobs_sync,
            timeout_seconds=1.5,
        )
        return {
            "success": True,
            "status": "online",
            "active_jobs": int(active_jobs or 0),
            "source": "celery.inspect",
        }
    except (asyncio.TimeoutError, BlockingCallDeadlineExceeded):
        return {
            "success": False,
            "status": "degraded",
            "active_jobs": 0,
            "source": "timeout_fallback",
        }
    except Exception:
        return {
            "success": False,
            "status": "degraded",
            "active_jobs": 0,
            "source": "error_fallback",
        }
