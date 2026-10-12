"""
Cron Router (L8) - API endpoints for cron scheduling and webhook triggers.

Schedulable tasks are either in-process Cortex tasks (``cortex.reminder``,
``cortex.health_report``; executed inside this process at fire time) or Celery
tasks that consume delegated action capabilities.  For Celery tasks,
"triggered" only means the broker accepted the message; no worker result is
observed by this router.  ``POST /cron/propose`` turns natural language into a
schedule proposal and never schedules anything.
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
    task_is_schedulable,
    schedulable_task_catalog,
    validate_timezone_name,
    preview_fire_times,
    is_internal_job,
    get_in_process_result,
    get_internal_job_status,
    _estimate_runs_for_hours,
    _ensure_state_dir,
)
from cortex_server.modules import cron_tasks
from cortex_server.modules.level_model import scope_key_for_request
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
    timezone: str = Field(default="UTC", max_length=64)
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
    task: Optional[str] = None
    timezone: Optional[str] = None
    dispatch: Optional[str] = None
    recommendation_basis: Optional[str] = None


class WebhookTriggerRequest(BaseModel):
    task: str
    args: List[Any] = Field(default_factory=list)
    payload: Optional[dict] = None
    policy: Optional[dict] = None


class TriggerResponse(BaseModel):
    task_id: Optional[str]
    status: str
    dispatch: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    detail: Optional[str] = None


class JobListResponse(BaseModel):
    jobs: list


class CadenceTwinRequest(BaseModel):
    cron: str
    alternatives: Optional[List[str]] = None
    value_score: float = 0.70
    risk_score: float = 0.30
    token_cost_est: int = 2000
    estimated_runtime_s: float = 30.0
    job_id: Optional[str] = Field(default=None, max_length=128)
    timezone: Optional[str] = Field(default=None, max_length=64)


class CronProposeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    timezone: Optional[str] = Field(default=None, max_length=64)
    use_model: bool = True


def _unschedulable_detail(task: str) -> str:
    allowed = ", ".join(row["task"] for row in schedulable_task_catalog())
    return f"task does not consume delegated action capabilities; schedulable tasks: {allowed}"


def _validated_in_process_args(task: str, args: List[Any]) -> List[Any]:
    if not cron_tasks.is_in_process_task(task):
        return list(args)
    try:
        return cron_tasks.validate_in_process_args(task, list(args))
    except cron_tasks.CronTaskArgsError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


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
    if not task_is_schedulable(request.task):
        raise HTTPException(
            status_code=503,
            detail=_unschedulable_detail(request.task),
        )
    try:
        timezone_name = validate_timezone_name(request.timezone)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    task_args = _validated_in_process_args(request.task, request.args)
    if task_args != list(request.args):
        # The capability binds the exact argument vector the job will fire with.
        request.args = task_args
    try:
        # Classic cron numbers weekdays from Sunday=0; APScheduler from Monday=0.
        request.cron = cron_tasks.normalize_classic_cron(request.cron)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

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
        job_id=request.job_name,
        timezone_name=timezone_name,
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
        "recommendation_basis": "heuristic_over_caller_supplied_priors",
    }

    try:
        job_id = add_cron_job(
            job_name=request.job_name,
            task=request.task,
            cron=request.cron,
            args=request.args,
            policy=policy,
            timezone_name=timezone_name,
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
        task=request.task,
        timezone=timezone_name,
        dispatch="in_process" if cron_tasks.is_in_process_task(request.task) else "celery",
        recommendation_basis="heuristic_over_caller_supplied_priors",
    )


@router.get("/jobs", response_model=JobListResponse)
async def list_cron_jobs() -> JobListResponse:
    jobs = []
    policies = list_job_policies()

    for job in get_scheduled_jobs():
        if is_internal_job(job):
            continue
        policy = policies.get(job.id, {})
        jobs.append(
            {
                **CronJobResponse(
                    job_id=job.id,
                    job_name=job.name,
                    next_run_time=job.next_run_time.isoformat() if job.next_run_time else None,
                    recommended_cadence=policy.get("recommended_cadence"),
                    topology_hint=("mesh" if float(policy.get("disagreement_density", 0.0)) >= 0.5 else "tree" if float(policy.get("dependency_density", 0.0)) >= 0.6 else "star"),
                    task=policy.get("task"),
                    timezone=policy.get("timezone"),
                    dispatch=policy.get("dispatch") or (
                        "in_process" if cron_tasks.is_in_process_task(policy.get("task")) else "celery"
                    ),
                    recommendation_basis="heuristic_over_caller_supplied_priors",
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
    if job_id.startswith("__internal__:"):
        raise HTTPException(status_code=403, detail="internal scheduler jobs are not user cron jobs")
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
    # The former "oracle.ask" -> cortex_tasks.process_swarm rewrite is gone:
    # that Celery task cannot be admitted (it consumes no delegated capability)
    # and its body fell back to canned sub-tasks.  "oracle.ask" is now simply
    # an unschedulable task name and is refused with the schedulable list.
    return (task or "").strip(), list(args or [])


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
    if not task_is_schedulable(task_name):
        raise HTTPException(
            status_code=503,
            detail=_unschedulable_detail(task_name),
        )
    in_process = cron_tasks.is_in_process_task(task_name)
    task_args = _validated_in_process_args(task_name, task_args)

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

    if task_id is not None and in_process:
        outcome = get_in_process_result(task_id) or {}
        return TriggerResponse(
            task_id=task_id,
            status=str(outcome.get("status") or "failed"),
            dispatch="in_process",
            result=outcome.get("outcome"),
            detail=outcome.get("error_type"),
        )
    if task_id is not None:
        return TriggerResponse(
            task_id=task_id,
            status="triggered",
            dispatch="celery",
            detail="broker accepted the task; execution requires a running Celery worker and is not observed here",
        )
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
    timezone_name = None
    if request.timezone:
        try:
            timezone_name = validate_timezone_name(request.timezone)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    sim = simulate_cadence_twin(
        primary_cron=request.cron,
        alternatives=request.alternatives,
        value_score=request.value_score,
        risk_score=request.risk_score,
        token_cost_est=request.token_cost_est,
        estimated_runtime_s=request.estimated_runtime_s,
        job_id=request.job_id,
        timezone_name=timezone_name,
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

    user_jobs = [job for job in get_scheduled_jobs() if not is_internal_job(job)]
    return {
        'success': scheduler_healthy,
        'level': 8,
        'name': 'Cron',
        'status': 'active' if scheduler_healthy else 'degraded',
        'scheduler_rehydration': rehydration,
        'blocking_operations': blocking_operation_status(),
        'scheduled_jobs': len(user_jobs),
        'schedulable_tasks': schedulable_task_catalog(),
        'celery_execution': 'unobserved: Celery "triggered" means broker acceptance only',
        'internal_jobs': get_internal_job_status(),
        'job_policies': len(policies),
        'triggered_last_24h': stats24.get('trigger_count', 0),
        'trigger_errors_last_24h': stats24.get('error_count', 0),
        'trigger_skipped_voi_last_24h': stats24.get('skipped_voi_count', 0),
        'trigger_held_escrow_last_24h': stats24.get('held_escrow_count', 0),
        'triggered_total': totals.get('total_triggered', 0),
        'last_trigger_at': totals.get('last_trigger_at'),
        'capabilities': _mounted_capabilities(),
        'heuristic_surfaces': {
            'cadence_twin': 'run counts measured; quality/risk/efficiency are labelled heuristics',
            'voi_gate': 'caller-configured rule over caller-supplied priors',
            'topology': 'descriptive grouping from caller-supplied densities',
            'novelty_budget': 'sha256 time-bucket sample, recorded only',
        },
    }


def _mounted_capabilities() -> List[str]:
    """Capability names derived from the routes this router actually defines."""

    names = []
    for route in router.routes:
        path = str(getattr(route, "path", "") or "")
        name = path.strip("/").split("/")[0] or "root"
        if name not in names:
            names.append(name)
    return names


@router.post('/propose')
async def cron_propose(request: CronProposeRequest, http_request: Request) -> dict:
    """Natural language -> schedule PROPOSAL. Never schedules; needs no action capability."""

    if request.timezone:
        try:
            validate_timezone_name(request.timezone)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    result = await cron_tasks.propose_schedule(
        request.text,
        timezone_name=request.timezone,
        principal_scope_key=scope_key_for_request(http_request, "cron"),
        use_model=request.use_model,
        preview_fn=preview_fire_times,
        validate_timezone_fn=validate_timezone_name,
    )
    proposal = result.get("proposal") if isinstance(result, dict) else None
    if isinstance(proposal, dict):
        try:
            runs_30d = _estimate_runs_for_hours(
                proposal["cron"], window_hours=24 * 30, timezone_name=proposal.get("timezone")
            )
        except Exception:
            runs_30d = None
        body = (result.get("schedule_with") or {}).get("body")
        if isinstance(body, dict) and runs_30d:
            body["authorization_ttl_seconds"] = 2_592_000
            body["max_runs"] = max(1, min(1000, int(runs_30d)))
            result["schedule_with"]["note"] = (
                "max_runs covers 30 days of fires; the deferred capability stops the job after that"
            )
    result.update({"level": 8, "name": "Cron"})
    return result


@router.get('/reminders')
async def cron_reminders(limit: int = 50) -> dict:
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 500")
    rows = cron_tasks.read_log_tail(_ensure_state_dir() / cron_tasks.REMINDER_LOG_FILENAME, limit=limit)
    return {"success": True, "level": 8, "name": "Cron", "count": len(rows), "reminders": rows}


@router.get('/reports')
async def cron_reports(limit: int = 20) -> dict:
    if limit < 1 or limit > 200:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 200")
    rows = cron_tasks.read_log_tail(_ensure_state_dir() / cron_tasks.REPORT_LOG_FILENAME, limit=limit)
    return {"success": True, "level": 8, "name": "Cron", "count": len(rows), "reports": rows}
