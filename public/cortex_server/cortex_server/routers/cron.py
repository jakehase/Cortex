"""
Cron Router - API endpoints for cron scheduling and webhook triggers.
"""

from typing import Any, List, Optional, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from cortex_server.scheduler import (
    add_cron_job,
    get_scheduled_jobs,
    remove_job,
    trigger_celery_task,
    get_trigger_events,
    get_trigger_stats,
    get_trigger_totals,
    get_notary_packets,
    list_job_policies,
    get_job_policy,
    build_topology_plan,
    simulate_cadence_twin,
    get_novelty_budget_status,
    evaluate_voi_gate,
    evaluate_verifier_escrow,
)
from cortex_server.worker import app as celery_app

router = APIRouter()


class CronScheduleRequest(BaseModel):
    job_name: str
    cron: str
    task: str
    args: List[Any] = Field(default_factory=list)

    # Idea 1: counterfactual cadence twin hints
    counterfactual_alternatives: Optional[List[str]] = None
    value_score: float = 0.70
    risk_score: float = 0.30
    cost_score: float = 0.25
    urgency_score: float = 0.50
    token_cost_est: int = 2000
    estimated_runtime_s: float = 30.0

    # Idea 2: VOI gate
    voi_enabled: bool = True
    voi_threshold: float = 0.35

    # Idea 3: verifier escrow
    require_verifier: bool = False
    preflight_mode: str = "task_exists"  # task_exists | payload_nonempty | safe_payload
    payload_arg_max: int = 8
    payload_kwarg_max: int = 8

    # Idea 4: adaptive topology batching
    dependency_group: Optional[str] = None
    dependency_density: float = 0.30
    disagreement_density: float = 0.20

    # Idea 6: novelty budget scheduler
    novelty_enabled: bool = False
    novelty_budget_fraction: float = 0.12
    novelty_promote_threshold: float = 0.06


class CronJobResponse(BaseModel):
    job_id: str
    job_name: str
    next_run_time: Optional[str]
    recommended_cadence: Optional[str] = None
    topology_hint: Optional[str] = None


class WebhookTriggerRequest(BaseModel):
    task: str
    args: List[Any] = Field(default_factory=list)
    payload: Optional[dict] = None
    policy: Optional[dict] = None


class TriggerResponse(BaseModel):
    task_id: Optional[str]
    status: str


class JobListResponse(BaseModel):
    jobs: list


class CadenceTwinRequest(BaseModel):
    cron: str
    alternatives: Optional[List[str]] = None
    value_score: float = 0.70
    risk_score: float = 0.30
    token_cost_est: int = 2000
    estimated_runtime_s: float = 30.0


@router.post("/schedule", response_model=CronJobResponse)
async def schedule_cron(request: CronScheduleRequest) -> CronJobResponse:
    if request.task not in celery_app.tasks:
        raise HTTPException(status_code=404, detail=f"Unknown task: {request.task}")

    # Counterfactual cadence twin simulation (Idea #1)
    cadence = simulate_cadence_twin(
        primary_cron=request.cron,
        alternatives=request.counterfactual_alternatives,
        value_score=request.value_score,
        risk_score=request.risk_score,
        token_cost_est=request.token_cost_est,
        estimated_runtime_s=request.estimated_runtime_s,
    )

    policy = {
        "job_name": request.job_name,
        "task": request.task,
        "cron": request.cron,
        "counterfactual_alternatives": request.counterfactual_alternatives,
        "value_score": request.value_score,
        "risk_score": request.risk_score,
        "cost_score": request.cost_score,
        "urgency_score": request.urgency_score,
        "token_cost_est": request.token_cost_est,
        "estimated_runtime_s": request.estimated_runtime_s,
        "voi_enabled": request.voi_enabled,
        "voi_threshold": request.voi_threshold,
        "require_verifier": request.require_verifier,
        "preflight_mode": request.preflight_mode,
        "payload_arg_max": request.payload_arg_max,
        "payload_kwarg_max": request.payload_kwarg_max,
        "dependency_group": request.dependency_group or "default",
        "dependency_density": request.dependency_density,
        "disagreement_density": request.disagreement_density,
        "novelty_enabled": request.novelty_enabled,
        "novelty_budget_fraction": request.novelty_budget_fraction,
        "novelty_promote_threshold": request.novelty_promote_threshold,
        "recommended_cadence": cadence.get("recommended_cron"),
    }

    try:
        job_id = add_cron_job(
            job_name=request.job_name,
            task=request.task,
            cron=request.cron,
            args=request.args,
            policy=policy,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    next_run_time = None
    for job in get_scheduled_jobs():
        if job.id == job_id:
            next_run_time = job.next_run_time.isoformat() if job.next_run_time else None
            break

    # Idea #4 topology hint for this job
    topo = build_topology_plan({job_id: policy})
    group = (topo.get("groups") or [{}])[0]
    topology_hint = group.get("topology")

    return CronJobResponse(
        job_id=job_id,
        job_name=request.job_name,
        next_run_time=next_run_time,
        recommended_cadence=cadence.get("recommended_cron"),
        topology_hint=topology_hint,
    )


@router.get("/jobs", response_model=JobListResponse)
async def list_cron_jobs() -> JobListResponse:
    jobs = []
    policies = list_job_policies()

    for job in get_scheduled_jobs():
        policy = policies.get(job.id, {})
        jobs.append(
            {
                **CronJobResponse(
                    job_id=job.id,
                    job_name=job.name,
                    next_run_time=job.next_run_time.isoformat() if job.next_run_time else None,
                    recommended_cadence=policy.get("recommended_cadence"),
                    topology_hint=("mesh" if float(policy.get("disagreement_density", 0.0)) >= 0.5 else "tree" if float(policy.get("dependency_density", 0.0)) >= 0.6 else "star"),
                ).dict(),
                "policy": {
                    "voi_enabled": policy.get("voi_enabled"),
                    "voi_threshold": policy.get("voi_threshold"),
                    "require_verifier": policy.get("require_verifier"),
                    "preflight_mode": policy.get("preflight_mode"),
                    "novelty_enabled": policy.get("novelty_enabled"),
                    "novelty_budget_fraction": policy.get("novelty_budget_fraction"),
                },
            }
        )

    return JobListResponse(jobs=jobs)


@router.delete("/jobs/{job_id}")
async def delete_cron_job(job_id: str) -> dict:
    removed = remove_job(job_id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return {"status": "removed", "job_id": job_id}


def _normalize_trigger(task: str, args: List[Any], payload: Optional[dict]) -> tuple[str, List[Any]]:
    task_name = (task or "").strip()
    task_args = list(args or [])
    body = payload or {}
    if task_name == "oracle.ask":
        question = ""
        if task_args and isinstance(task_args[0], str):
            question = task_args[0]
        if not question:
            question = str(body.get("question") or body.get("prompt") or body.get("query") or "").strip()
        return "cortex_tasks.process_swarm", [question or "oracle.ask compatibility invocation"]
    return task_name, task_args


@router.post("/trigger", response_model=TriggerResponse)
async def trigger_webhook(request: WebhookTriggerRequest) -> TriggerResponse:
    task_name, task_args = _normalize_trigger(request.task, request.args, request.payload)
    if task_name not in celery_app.tasks:
        raise HTTPException(status_code=404, detail=f"Unknown task: {request.task}")

    policy = dict(request.policy or {})

    task_id = trigger_celery_task(
        task_name,
        args=task_args,
        source="manual_api",
        job_id="manual_api",
        job_name="manual_api_trigger",
        policy_override=policy if policy else None,
    )

    if task_id is not None:
        return TriggerResponse(task_id=task_id, status="triggered")

    # Gated/no-op status inference for explicit policy path
    if policy:
        voi = evaluate_voi_gate(policy)
        if not voi.get("allowed", True):
            return TriggerResponse(task_id=None, status="skipped_voi")

        escrow = evaluate_verifier_escrow(task_name, task_args, {}, policy)
        if not escrow.get("allowed", True):
            return TriggerResponse(task_id=None, status="held_escrow")

    return TriggerResponse(task_id=None, status="not_triggered")


@router.get('/trigger_stats')
async def cron_trigger_stats(hours: int = 24, limit: int = 50) -> dict:
    if hours < 1 or hours > 24 * 30:
        raise HTTPException(status_code=400, detail="hours must be between 1 and 720")
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 500")

    stats = get_trigger_stats(hours=hours)
    totals = get_trigger_totals()
    recent = get_trigger_events(hours=hours, limit=limit)

    return {
        "success": True,
        "level": 8,
        "name": "Cron",
        "window_hours": hours,
        "trigger_count": stats.get("trigger_count", 0),
        "error_count": stats.get("error_count", 0),
        "skipped_voi_count": stats.get("skipped_voi_count", 0),
        "held_escrow_count": stats.get("held_escrow_count", 0),
        "by_source": stats.get("by_source", {}),
        "top_tasks": stats.get("top_tasks", []),
        "last_trigger_at": stats.get("last_trigger_at") or totals.get("last_trigger_at"),
        "totals": totals,
        "recent": recent,
    }


@router.post('/cadence_twin')
async def cron_cadence_twin(request: CadenceTwinRequest) -> dict:
    sim = simulate_cadence_twin(
        primary_cron=request.cron,
        alternatives=request.alternatives,
        value_score=request.value_score,
        risk_score=request.risk_score,
        token_cost_est=request.token_cost_est,
        estimated_runtime_s=request.estimated_runtime_s,
    )
    return {
        "success": True,
        "level": 8,
        "name": "Cron",
        "cadence_twin": sim,
    }


@router.get('/topology')
async def cron_topology() -> dict:
    policies = list_job_policies()
    topo = build_topology_plan(policies)
    return {
        "success": True,
        "level": 8,
        "name": "Cron",
        "topology": topo,
        "job_policy_count": len(policies),
    }


@router.get('/notary')
async def cron_notary(hours: int = 24, limit: int = 100) -> dict:
    if hours < 1 or hours > 24 * 30:
        raise HTTPException(status_code=400, detail="hours must be between 1 and 720")
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 500")

    packets = get_notary_packets(hours=hours, limit=limit)
    return {
        "success": True,
        "level": 8,
        "name": "Cron",
        "window_hours": hours,
        "packet_count": len(packets),
        "packets": packets,
    }


@router.get('/novelty/status')
async def cron_novelty_status() -> dict:
    novelty = get_novelty_budget_status()
    return {
        "success": True,
        "level": 8,
        "name": "Cron",
        "novelty_budget": novelty,
    }


@router.get('/status')
async def cron_status() -> dict:
    stats24 = get_trigger_stats(hours=24)
    totals = get_trigger_totals()
    policies = list_job_policies()

    return {
        'success': True,
        'level': 8,
        'name': 'Cron',
        'status': 'active',
        'scheduled_jobs': len(get_scheduled_jobs()),
        'job_policies': len(policies),
        'triggered_last_24h': stats24.get('trigger_count', 0),
        'trigger_errors_last_24h': stats24.get('error_count', 0),
        'trigger_skipped_voi_last_24h': stats24.get('skipped_voi_count', 0),
        'trigger_held_escrow_last_24h': stats24.get('held_escrow_count', 0),
        'triggered_total': totals.get('total_triggered', 0),
        'last_trigger_at': totals.get('last_trigger_at'),
        'capabilities': [
            'schedule',
            'jobs',
            'trigger',
            'trigger_stats',
            'cadence_twin',
            'adaptive_topology',
            'notary_packets',
            'novelty_budget',
        ],
    }
