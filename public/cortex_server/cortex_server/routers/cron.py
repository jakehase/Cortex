"""
Cron Router - API endpoints for cron scheduling and webhook triggers.
"""

from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from cortex_server.scheduler import (
    add_cron_job,
    get_scheduled_jobs,
    remove_job,
    trigger_celery_task,
)
from cortex_server.worker import app as celery_app

router = APIRouter()


class CronScheduleRequest(BaseModel):
    job_name: str
    cron: str
    task: str
    args: Optional[List[Any]] = []


class CronJobResponse(BaseModel):
    job_id: str
    job_name: str
    next_run_time: Optional[str]


class WebhookTriggerRequest(BaseModel):
    task: str
    args: Optional[List[Any]] = []


class TriggerResponse(BaseModel):
    task_id: str
    status: str


class JobListResponse(BaseModel):
    jobs: list


@router.post("/schedule", response_model=CronJobResponse)
async def schedule_cron(request: CronScheduleRequest) -> CronJobResponse:
    """Schedule a cron job to trigger a Celery task."""
    if request.task not in celery_app.tasks:
        raise HTTPException(status_code=404, detail=f"Unknown task: {request.task}")

    try:
        job_id = add_cron_job(
            job_name=request.job_name,
            task=request.task,
            cron=request.cron,
            args=request.args,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    next_run_time = None
    for job in get_scheduled_jobs():
        if job.id == job_id:
            next_run_time = job.next_run_time.isoformat() if job.next_run_time else None
            break

    return CronJobResponse(
        job_id=job_id,
        job_name=request.job_name,
        next_run_time=next_run_time,
    )


@router.get("/jobs", response_model=JobListResponse)
async def list_cron_jobs() -> JobListResponse:
    """Return all scheduled cron jobs."""
    jobs = []
    for job in get_scheduled_jobs():
        jobs.append(
            CronJobResponse(
                job_id=job.id,
                job_name=job.name,
                next_run_time=job.next_run_time.isoformat() if job.next_run_time else None,
            ).dict()
        )
    return JobListResponse(jobs=jobs)


@router.delete("/jobs/{job_id}")
async def delete_cron_job(job_id: str) -> dict:
    """Remove a scheduled job by id."""
    remove_job(job_id)
    return {"status": "removed"}


@router.post("/trigger", response_model=TriggerResponse)
async def trigger_webhook(request: WebhookTriggerRequest) -> TriggerResponse:
    """Trigger a Celery task immediately."""
    if request.task not in celery_app.tasks:
        raise HTTPException(status_code=404, detail=f"Unknown task: {request.task}")

    task_id = trigger_celery_task(request.task, args=request.args)
    return TriggerResponse(task_id=task_id, status="triggered")
