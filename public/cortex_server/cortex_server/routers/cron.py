"""
Cron Router - API endpoints for cron scheduling and webhook triggers.
"""

from typing import Any, List, Optional, Dict
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from cortex_server.scheduler import (
    add_cron_job,
    get_scheduled_jobs,
    remove_job,
    get_trigger_events,
    get_trigger_stats,
    get_trigger_totals,
    get_notary_packets,
    list_job_policies,
    get_job_policy,
    build_topology_plan,
    simulate_cadence_twin,
    get_novelty_budget_status,
    get_scheduler_rehydration_status,
    evaluate_voi_gate,
    evaluate_verifier_escrow,
    trigger_celery_task,
)
from cortex_server.worker import (
    app as celery_app,
    task_consumes_delegated_action_capability,
)
from cortex_server.modules.async_offload import (
    BlockingCallCapacityExceeded,
    BlockingCallDeadlineExceeded,
    blocking_operation_status,
    run_blocking,
)
from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    action_authorization_is_global_admin,
    assert_action_authorized,
    cancel_deferred_action_capability,
    deferred_action_runtime_configuration,
    deferred_action_owner,
    mint_deferred_action_capability,
    require_action_capability,
)

router = APIRouter()


class CronScheduleRequest(BaseModel):
    job_name: str
    cron: str
    task: str
    args: List[Any] = Field(default_factory=list)
    authorization_ttl_seconds: int = Field(default=86_400, ge=1, le=2_592_000)
    max_runs: int = Field(default=1, ge=1, le=1000)

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


def _authorize_existing_job_mutation(
    job_id: str,
    *,
    http_request: Request,
    authorization: ActionAuthorization,
) -> tuple[Optional[dict], Optional[str]]:
    """Authorize replacement/deletion from an HMAC-authenticated stored owner."""

    if not any(job.id == job_id for job in get_scheduled_jobs()):
        return None, None
    policy = get_job_policy(job_id)
    capability = policy.get("action_capability")
    owner = (
        deferred_action_owner(
            capability,
            secret=str(getattr(http_request.app.state, "action_delegation_secret", "")),
        )
        if isinstance(capability, dict)
        else None
    )
    is_admin = action_authorization_is_global_admin(authorization)
    if owner is None and not is_admin:
        raise HTTPException(
            status_code=403,
            detail="legacy or unauthenticated cron jobs require global administrator control",
        )
    if owner is not None and owner != authorization.principal_id and not is_admin:
        raise HTTPException(status_code=403, detail="job belongs to a different action principal")
    return capability if isinstance(capability, dict) else None, owner


@router.post("/schedule", response_model=CronJobResponse)
async def schedule_cron(
    request: CronScheduleRequest,
    http_request: Request,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> CronJobResponse:
    assert_action_authorized(authorization)
    _authorize_existing_job_mutation(
        request.job_name,
        http_request=http_request,
        authorization=authorization,
    )
    if not task_consumes_delegated_action_capability(
        request.task,
        celery=celery_app,
    ):
        raise HTTPException(
            status_code=503,
            detail="task does not consume delegated action capabilities",
        )

    try:
        delegation_secret, _replay_path = deferred_action_runtime_configuration(
            secret=str(
                getattr(http_request.app.state, "action_delegation_secret", "")
            ),
            db_path=str(
                getattr(http_request.app.state, "action_capability_db_path", "")
            ),
        )
        delegated_action = mint_deferred_action_capability(
            authorization,
            task=request.task,
            args=request.args,
            secret=delegation_secret,
            ttl_seconds=request.authorization_ttl_seconds,
            max_runs=request.max_runs,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=503,
            detail="cron worker action capability is unavailable",
        ) from exc

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
        "action_capability": delegated_action,
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
            next_run_time = (
                job.next_run_time.isoformat() if job.next_run_time else None
            )
            break

    topology = build_topology_plan({job_id: policy})
    group = (topology.get("groups") or [{}])[0]
    return CronJobResponse(
        job_id=job_id,
        job_name=request.job_name,
        next_run_time=next_run_time,
        recommended_cadence=cadence.get("recommended_cron"),
        topology_hint=group.get("topology"),
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
async def delete_cron_job(
    job_id: str,
    http_request: Request,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> dict:
    assert_action_authorized(authorization)
    delegated_action, owner = _authorize_existing_job_mutation(
        job_id,
        http_request=http_request,
        authorization=authorization,
    )
    if delegated_action is not None and owner is not None:
        cancelled = cancel_deferred_action_capability(
            delegated_action,
            principal_id=owner,
            db_path=str(getattr(http_request.app.state, "action_capability_db_path", "")),
            secret=str(getattr(http_request.app.state, "action_delegation_secret", "")),
        )
        if not cancelled:
            raise HTTPException(
                status_code=503,
                detail="cron action capability could not be cancelled",
            )
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
async def trigger_webhook(
    request: WebhookTriggerRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> TriggerResponse:
    assert_action_authorized(authorization)
    task_name, task_args = _normalize_trigger(
        request.task,
        request.args,
        request.payload,
    )
    if not task_consumes_delegated_action_capability(
        task_name,
        celery=celery_app,
    ):
        raise HTTPException(
            status_code=503,
            detail="task does not consume delegated action capabilities",
        )

    policy = dict(request.policy or {})
    submission_id = str(uuid.uuid4())
    try:
        task_id = await run_blocking(
            f"celery.trigger_task:{submission_id}",
            trigger_celery_task,
            task_name,
            args=task_args,
            source="manual_api",
            job_id="manual_api",
            job_name="manual_api_trigger",
            policy_override=policy if policy else None,
            submission_id=submission_id,
            action_authorization=authorization,
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
    except ValueError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "worker action capability is unavailable",
                "task_id": submission_id,
                "submission": "not_dispatched",
            },
        ) from exc

    if task_id is not None:
        return TriggerResponse(task_id=task_id, status="triggered")
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
    rehydration = get_scheduler_rehydration_status()
    scheduler_healthy = bool(
        rehydration.get("scheduler_running")
        and rehydration.get("status") == "ready"
    )

    return {
        'success': scheduler_healthy,
        'level': 8,
        'name': 'Cron',
        'status': 'active' if scheduler_healthy else 'degraded',
        'scheduler_rehydration': rehydration,
        'blocking_operations': blocking_operation_status(),
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
