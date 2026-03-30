"""
Level 26: The Orchestrator / Conductor — Real Workflow Execution

Coordinates multi-level workflows by accepting step definitions, executing
them sequentially via async HTTP, and storing results for replay.

NOTE: This is L26 Workflow Conductor, NOT L36 Meta-Conductor.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, List, Any, Optional
from datetime import datetime
from pathlib import Path
import os
import json
import asyncio
import httpx

from cortex_server.modules.reasoning_approvals import create_approval_grant
from cortex_server.modules.reasoning_beliefs import belief_conflicts, beliefs_for_task, explain_belief, get_belief, list_beliefs, search_beliefs, select_influential_beliefs, summarize_beliefs, trace_belief_lineage, upsert_belief
from cortex_server.modules import reasoning_explain as explain
from cortex_server.modules import reasoning_observability as observability
from cortex_server.modules import reasoning_runtime_execution as runtime_execution
from cortex_server.modules import reasoning_runtime_explain as runtime_explain
from cortex_server.modules import reasoning_runtime_service as runtime_service
from cortex_server.modules import reasoning_runtime_workflows as runtime_workflows
from cortex_server.modules.reasoning_kernel import model_dump_compat
from cortex_server.modules.reasoning_planner import (
    PlanGraphError,
    ReasoningPlanGraph,
    compile_plan_to_reasoning_task,
    compile_plan_to_workflow,
    validate_plan_graph,
)
from cortex_server.modules.reasoning_policy import build_workflow_policy
from cortex_server.modules.reasoning_store import get_doc as store_get_doc, list_docs as store_list_docs, upsert_doc as store_upsert_doc
from cortex_server.modules.reasoning_scheduler import (
    ReasoningSchedulerError,
    create_process_from_workflow,
    cancel_process as cancel_runtime_process,
    get_process as get_runtime_process,
    list_processes as list_runtime_processes,
    mark_node_running,
    pause_process as pause_runtime_process,
    process_events as get_runtime_events,
    record_node_result,
    replace_process_workflow,
    resume_process as resume_runtime_process,
    runtime_status as get_runtime_status,
    scheduler_tick as reasoning_scheduler_tick,
    wake_process as wake_runtime_process,
)

router = APIRouter()

# ── In-memory state ────────────────────────────────────────────────────────
DEFAULT_DB_PATH = Path("/opt/clawdbot/state/reasoning_runtime.db")
workflows: Dict[str, Dict[str, Any]] = {}
_stats = {
    "workflows_created": 0,
    "workflows_executed": 0,
}

BASE_URL = "http://127.0.0.1:8888"

MAX_WORKFLOW_STEPS = int(os.getenv("ORCHESTRATOR_MAX_STEPS", "25"))
MAX_PAYLOAD_BYTES = int(os.getenv("ORCHESTRATOR_MAX_PAYLOAD_BYTES", "51200"))
STEP_TIMEOUT_MAX_S = float(os.getenv("ORCHESTRATOR_STEP_TIMEOUT_MAX_S", "20"))
MAX_STEP_RESPONSE_CHARS = int(os.getenv("ORCHESTRATOR_MAX_STEP_RESPONSE_CHARS", "4000"))
MAX_EXECUTIONS_PER_WORKFLOW = int(os.getenv("ORCHESTRATOR_MAX_EXECUTIONS_PER_WORKFLOW", "20"))
SENTINEL_SCAN_URL = "http://127.0.0.1:8888/sentinel/scan"


def _db_path() -> Path:
    return runtime_workflows.db_path(DEFAULT_DB_PATH)



def _persist_workflow(workflow: Dict[str, Any]) -> Dict[str, Any]:
    return runtime_workflows.persist_workflow(
        workflow,
        workflows_cache=workflows,
        db_path=_db_path(),
        store_upsert_doc_fn=lambda collection, doc_id, row: store_upsert_doc(collection, doc_id, row, db_path=_db_path()),
    )



def _load_workflow(workflow_id: str) -> Optional[Dict[str, Any]]:
    return runtime_workflows.load_workflow(
        workflow_id,
        workflows_cache=workflows,
        db_path=_db_path(),
        store_get_doc_fn=lambda collection, doc_id: store_get_doc(collection, doc_id, db_path=_db_path()),
    )



def _list_workflows() -> List[Dict[str, Any]]:
    return runtime_workflows.list_workflows(
        workflows_cache=workflows,
        db_path=_db_path(),
        store_list_docs_fn=lambda collection: store_list_docs(collection, db_path=_db_path()),
    )


# ── Models ─────────────────────────────────────────────────────────────────

class WorkflowStep(BaseModel):
    """A single step in a workflow."""
    endpoint: str          # e.g. "/oracle/chat" or "/librarian/search"
    method: str = "POST"   # GET or POST
    payload: Dict[str, Any] = {}
    headers: Dict[str, str] = {}
    timeout_seconds: Optional[float] = None
    node_id: Optional[str] = None
    title: Optional[str] = None
    depends_on: List[str] = []
    preconditions: List[str] = []
    success_criteria: List[str] = []
    contracts: List[Dict[str, Any]] = []
    failure_mode: str = "continue"
    metadata: Dict[str, Any] = {}


class CreateWorkflowRequest(BaseModel):
    """Workflow definition."""
    name: str
    steps: List[WorkflowStep]
    metadata: Optional[Dict[str, Any]] = {}


class RuntimeScheduleOptions(BaseModel):
    start_at: Optional[str] = None
    owner: Optional[str] = None
    session_key: Optional[str] = None
    cadence_seconds: Optional[int] = None
    approval_grants: List[Dict[str, Any]] = []
    approval_grant_ids: List[str] = []
    approved: bool = False


class RuntimeTickRequest(BaseModel):
    limit: int = 25
    now_iso: Optional[str] = None
    execute: bool = True


class RuntimePolicyApplyRequest(BaseModel):
    dry_run: bool = False
    allow_confirmation_required: bool = False
    settings: Optional[List[str]] = None
    metadata_overrides: Optional[Dict[str, Any]] = None


class RuntimePolicyRollbackRequest(BaseModel):
    dry_run: bool = False
    allow_confirmation_required: bool = False
    allow_intervening_revisions: bool = False


class RuntimeHomeostasisControlRequest(BaseModel):
    dry_run: bool = False
    allow_intervening_revisions: bool = False


class RuntimePlanRequest(BaseModel):
    graph: ReasoningPlanGraph
    options: RuntimeScheduleOptions = Field(default_factory=RuntimeScheduleOptions)


# ── Helpers ─────────────────────────────────────────────────────────────────



def _redact_headers(h: Any) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not isinstance(h, dict):
        return out
    for k,v in h.items():
        lk=str(k).lower()
        if lk in ("authorization","x-bridge-token","x-api-key","cookie"):
            out[str(k)] = "[REDACTED]"
        else:
            out[str(k)] = str(v)[:200]
    return out

def _validate_endpoint(ep: str) -> None:
    if not isinstance(ep, str) or not ep.startswith('/'):
        raise HTTPException(status_code=400, detail='Invalid endpoint (must start with /)')
    if '..' in ep or ep.startswith('//'):
        raise HTTPException(status_code=400, detail='Invalid endpoint (path traversal)')


def _payload_size_ok(obj: Any) -> bool:
    try:
        b = len(json.dumps(obj).encode('utf-8'))
        return b <= MAX_PAYLOAD_BYTES
    except Exception:
        return False


async def _sentinel_preflight() -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.post(SENTINEL_SCAN_URL, json={})
            r.raise_for_status()
            return r.json()
    except Exception as e:
        return {"success": False, "error": f"sentinel_preflight_failed:{type(e).__name__}:{e}"}


def _trim_response_body(body: Any) -> Any:
    return runtime_execution.trim_response_body(body, max_chars=MAX_STEP_RESPONSE_CHARS)



def _workflow_policy_settings(workflow_metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return runtime_execution.workflow_policy_settings(workflow_metadata)



def _effective_step_timeout(step: Dict[str, Any], workflow_metadata: Optional[Dict[str, Any]]) -> float:
    return runtime_execution.effective_step_timeout(
        step,
        workflow_metadata,
        step_timeout_max_s=STEP_TIMEOUT_MAX_S,
    )



def _cancelled_step_result(step: Dict[str, Any], *, step_index: int, reason: str) -> Dict[str, Any]:
    result = runtime_execution.cancelled_step_result(step, step_index=step_index, reason=reason)
    request = result.get("request") if isinstance(result.get("request"), dict) else {}
    request["headers"] = _redact_headers(step.get("headers", {}))
    result["request"] = request
    return result



def _step_belief_context(step: Dict[str, Any], workflow_metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    metadata = dict(workflow_metadata or {})
    step_metadata = step.get("metadata") if isinstance(step.get("metadata"), dict) else {}
    task_id = str(metadata.get("task_id") or metadata.get("kernel_task_id") or "").strip() or None
    subjects = [str(x) for x in ((step_metadata or {}).get("belief_subjects") or []) if str(x).strip()]
    predicates = [str(x) for x in ((step_metadata or {}).get("belief_predicates") or []) if str(x).strip()]
    query = (step_metadata or {}).get("belief_query")
    selected = select_influential_beliefs(task_id=task_id, subjects=subjects or None, predicates=predicates or None, query=query, limit=8)
    return {
        "task_id": task_id,
        "selected": selected,
        "selected_ids": [str(row.get("claim_id") or "") for row in selected if str(row.get("claim_id") or "").strip()],
        "filters": {"subjects": subjects, "predicates": predicates, "query": query},
    }



def _step_retry_settings(step: Dict[str, Any], workflow_metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return runtime_execution.step_retry_settings(step, workflow_metadata)



def _retry_result_matches_policy(result: Dict[str, Any], retry_settings: Dict[str, Any]) -> bool:
    return runtime_execution.retry_result_matches_policy(result, retry_settings)


async def _execute_single_step(
    client: httpx.AsyncClient,
    step: Dict[str, Any],
    *,
    step_index: int,
    results_by_node: Dict[str, Dict[str, Any]],
    workflow_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return await runtime_execution.execute_single_step(
        client,
        step,
        step_index=step_index,
        results_by_node=results_by_node,
        workflow_metadata=workflow_metadata,
        base_url=BASE_URL,
        max_step_response_chars=MAX_STEP_RESPONSE_CHARS,
        step_timeout_max_s=STEP_TIMEOUT_MAX_S,
        redact_headers_fn=_redact_headers,
        validate_endpoint_fn=_validate_endpoint,
        payload_size_ok_fn=_payload_size_ok,
        step_belief_context_fn=_step_belief_context,
    )



def _workflow_deadline_at(workflow_metadata: Optional[Dict[str, Any]], *, started_at: Optional[datetime] = None) -> Optional[datetime]:
    return runtime_execution.workflow_deadline_at(workflow_metadata, started_at=started_at)



def _deadline_exceeded(deadline_at: Optional[datetime]) -> bool:
    return runtime_execution.deadline_exceeded(deadline_at)



def _deadline_result(step: Dict[str, Any], *, step_index: int, deadline_at: Optional[datetime]) -> Dict[str, Any]:
    return runtime_execution.deadline_result(
        step,
        step_index=step_index,
        deadline_at=deadline_at,
        redact_headers_fn=_redact_headers,
    )



def _compensation_steps(step: Dict[str, Any]) -> List[Dict[str, Any]]:
    return runtime_execution.compensation_steps(step)


async def _execute_compensation_steps(
    client: httpx.AsyncClient,
    step: Dict[str, Any],
    *,
    step_index: int,
    results_by_node: Dict[str, Dict[str, Any]],
    workflow_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return await runtime_execution.execute_compensation_steps(
        client,
        step,
        step_index=step_index,
        results_by_node=results_by_node,
        workflow_metadata=workflow_metadata,
        execute_single_step_fn=_execute_single_step,
    )


async def _execute_step_with_retry(
    client: httpx.AsyncClient,
    step: Dict[str, Any],
    *,
    step_index: int,
    results_by_node: Dict[str, Dict[str, Any]],
    workflow_metadata: Optional[Dict[str, Any]] = None,
    deadline_at: Optional[datetime] = None,
) -> Dict[str, Any]:
    return await runtime_execution.execute_step_with_retry(
        client,
        step,
        step_index=step_index,
        results_by_node=results_by_node,
        workflow_metadata=workflow_metadata,
        deadline_at=deadline_at,
        execute_single_step_fn=_execute_single_step,
        step_belief_context_fn=_step_belief_context,
        redact_headers_fn=_redact_headers,
    )



async def _execute_workflow(workflow: Dict[str, Any]) -> Dict[str, Any]:
    execution = await runtime_execution.execute_workflow(
        workflow,
        execute_step_with_retry_fn=_execute_step_with_retry,
        workflow_policy_settings_fn=_workflow_policy_settings,
        cancelled_step_result_fn=_cancelled_step_result,
        redact_headers_fn=_redact_headers,
    )
    _stats["workflows_executed"] += 1
    return execution



def _store_workflow_from_plan(graph: ReasoningPlanGraph) -> Dict[str, Any]:
    try:
        workflow = runtime_workflows.build_workflow_from_plan(
            graph,
            compile_plan_to_workflow_fn=compile_plan_to_workflow,
            compile_plan_to_reasoning_task_fn=compile_plan_to_reasoning_task,
            model_dump_compat_fn=model_dump_compat,
            build_workflow_policy_fn=build_workflow_policy,
        )
    except PlanGraphError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _stats["workflows_created"] += 1
    _persist_workflow(workflow)
    return workflow



def _step_index_for_node(workflow: Dict[str, Any], node_id: str) -> int:
    return runtime_workflows.step_index_for_node(workflow, node_id)



def _record_runtime_beliefs(*, process_id: str, task_id: Optional[str], node_id: str, step_result: Dict[str, Any]) -> List[Dict[str, Any]]:
    return runtime_workflows.record_runtime_beliefs(
        process_id=process_id,
        task_id=task_id,
        node_id=node_id,
        step_result=step_result,
        upsert_belief_fn=upsert_belief,
    )


async def _execute_runtime_batch(*, limit: int = 25, now_iso: Optional[str] = None) -> Dict[str, Any]:
    return await runtime_workflows.execute_runtime_batch(
        limit=limit,
        now_iso=now_iso,
        scheduler_tick_fn=reasoning_scheduler_tick,
        get_runtime_process_fn=get_runtime_process,
        mark_node_running_fn=mark_node_running,
        execute_step_with_retry_fn=_execute_step_with_retry,
        step_index_for_node_fn=_step_index_for_node,
        step_belief_context_fn=_step_belief_context,
        record_runtime_beliefs_fn=_record_runtime_beliefs,
        record_node_result_fn=record_node_result,
        workflow_policy_settings_fn=_workflow_policy_settings,
        scheduler_error_cls=ReasoningSchedulerError,
    )


# ── Routes ──────────────────────────────────────────────────────────────────

@router.get("/status")
async def conductor_status():
    """Get Conductor status — L26 Workflow Orchestration."""
    return {
        "success": True,
        "data": {
            "level": 26,
            "name": "The Orchestrator",
            "role": "Workflow Orchestration",
            "description": "Coordinates multi-level execution workflows (NOT L36 Meta-Conductor)",
            "status": "active",
            "workflows_created": _stats["workflows_created"],
            "workflows_executed": _stats["workflows_executed"],
            "workflows_stored": len(_list_workflows()),
            "always_on": True,
            "timestamp": datetime.now().isoformat(),
        },
        "error": None,
    }


@router.post("/plan")
async def create_plan(graph: ReasoningPlanGraph):
    """Validate a reasoning plan graph and project it into kernel task form."""
    try:
        return runtime_service.build_plan_projection(
            graph,
            validate_plan_graph_fn=validate_plan_graph,
            build_workflow_policy_fn=build_workflow_policy,
            compile_plan_to_workflow_fn=compile_plan_to_workflow,
            compile_plan_to_reasoning_task_fn=compile_plan_to_reasoning_task,
            model_dump_compat_fn=model_dump_compat,
        )
    except PlanGraphError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/plan/execute")
async def create_and_run_plan(graph: ReasoningPlanGraph):
    """Store a plan graph as a workflow, then execute it in dependency order."""
    workflow = _store_workflow_from_plan(graph)
    execution = await _execute_workflow(workflow)
    runtime_workflows.apply_execution_result(workflow, execution, max_executions=MAX_EXECUTIONS_PER_WORKFLOW)
    _persist_workflow(workflow)

    return {
        "success": True,
        "workflow_id": workflow["workflow_id"],
        "name": workflow["name"],
        "plan_graph": workflow.get("plan_graph"),
        "kernel_task": workflow.get("kernel_task"),
        "execution": execution,
    }


@router.post("/runtime/plan")
async def schedule_plan_runtime(request: RuntimePlanRequest):
    """Store a plan graph as a managed reasoning process without executing it yet."""
    workflow = _store_workflow_from_plan(request.graph)
    try:
        return runtime_service.schedule_runtime_plan(
            request,
            workflow=workflow,
            create_approval_grant_fn=create_approval_grant,
            build_workflow_policy_fn=build_workflow_policy,
            create_process_from_workflow_fn=create_process_from_workflow,
        )
    except ReasoningSchedulerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/runtime/tick")
async def tick_runtime(request: RuntimeTickRequest):
    """Advance the reasoning runtime and optionally execute due ready nodes."""
    if not bool(request.execute):
        tick = reasoning_scheduler_tick(now_iso=request.now_iso, limit=request.limit)
        return {"success": True, "tick": tick, "executed": [], "executed_count": 0}
    batch = await _execute_runtime_batch(limit=request.limit, now_iso=request.now_iso)
    return {"success": True, **batch}


@router.get("/runtime/status")
async def get_runtime_scheduler_status():
    return {"success": True, "runtime": get_runtime_status()}


@router.get("/runtime/processes")
async def get_runtime_processes():
    return {"success": True, "processes": list_runtime_processes()}


async def explain_runtime_process(process_id: str):
    return await runtime_service.explain_runtime_process(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        assemble_runtime_process_explain_fn=runtime_explain.assemble_runtime_process_explain,
        beliefs_for_task_fn=beliefs_for_task,
        summarize_beliefs_fn=summarize_beliefs,
        explain_belief_fn=explain_belief,
        get_belief_fn=get_belief,
        select_influential_beliefs_fn=select_influential_beliefs,
    )


@router.get("/runtime/process/{process_id}")
async def get_runtime_process_view(process_id: str, events_limit: int = 25):
    return await runtime_service.runtime_process_view(
        process_id,
        events_limit=events_limit,
        get_runtime_process_fn=get_runtime_process,
        assemble_runtime_process_view_fn=runtime_explain.assemble_runtime_process_view,
        get_runtime_events_fn=get_runtime_events,
        beliefs_for_task_fn=beliefs_for_task,
        summarize_beliefs_fn=summarize_beliefs,
        explain_belief_fn=explain_belief,
        get_belief_fn=get_belief,
        select_influential_beliefs_fn=select_influential_beliefs,
    )


@router.get("/runtime/trace/{process_id}")
async def get_runtime_process_trace(process_id: str):
    return runtime_service.runtime_process_trace(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        get_runtime_events_fn=get_runtime_events,
        process_trace_surface_fn=observability.process_trace_surface,
    )

@router.get("/runtime/policy-explain/{process_id}")
async def explain_runtime_policy(process_id: str):
    return await runtime_service.runtime_policy_explain(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        get_runtime_events_fn=get_runtime_events,
        explain_runtime_process_fn=explain_runtime_process,
        assemble_runtime_policy_response_fn=runtime_explain.assemble_runtime_policy_response,
        policy_patch_history_fn=runtime_explain.policy_patch_history,
        explain_belief_fn=explain_belief,
        get_belief_fn=get_belief,
    )


@router.get("/runtime/policy-history/{process_id}")
async def get_runtime_policy_history(process_id: str):
    return runtime_service.runtime_policy_history(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        get_runtime_events_fn=get_runtime_events,
        policy_patch_history_fn=runtime_explain.policy_patch_history,
    )


@router.post("/runtime/policy-rollback/{process_id}/{revision_id}")
async def rollback_runtime_policy_patch(process_id: str, revision_id: str, req: Optional[RuntimePolicyRollbackRequest] = None):
    req = req or RuntimePolicyRollbackRequest()
    return await runtime_service.rollback_runtime_policy_patch(
        process_id,
        revision_id,
        get_runtime_process_fn=get_runtime_process,
        get_runtime_events_fn=get_runtime_events,
        policy_patch_history_fn=runtime_explain.policy_patch_history,
        select_policy_patch_preview_fn=observability.select_policy_patch_preview,
        apply_policy_patch_preview_fn=observability.apply_policy_patch_preview,
        refresh_workflow_policy_fn=lambda workflow: runtime_workflows.refresh_workflow_policy(
            workflow,
            build_workflow_policy_fn=build_workflow_policy,
        ),
        replace_process_workflow_fn=replace_process_workflow,
        dry_run=bool(req.dry_run),
        allow_confirmation_required=bool(req.allow_confirmation_required),
        allow_intervening_revisions=bool(req.allow_intervening_revisions),
        load_workflow_fn=_load_workflow,
        persist_workflow_fn=_persist_workflow,
    )


@router.post("/runtime/policy-apply/{process_id}")
async def apply_runtime_policy_patch(process_id: str, req: Optional[RuntimePolicyApplyRequest] = None):
    req = req or RuntimePolicyApplyRequest()
    return await runtime_service.apply_runtime_policy_patch(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        explain_runtime_process_fn=explain_runtime_process,
        select_policy_patch_preview_fn=observability.select_policy_patch_preview,
        apply_policy_patch_preview_fn=observability.apply_policy_patch_preview,
        refresh_workflow_policy_fn=lambda workflow: runtime_workflows.refresh_workflow_policy(
            workflow,
            build_workflow_policy_fn=build_workflow_policy,
        ),
        replace_process_workflow_fn=replace_process_workflow,
        requested_settings=list(req.settings or []),
        metadata_overrides=dict(req.metadata_overrides or {}),
        dry_run=bool(req.dry_run),
        allow_confirmation_required=bool(req.allow_confirmation_required),
        load_workflow_fn=_load_workflow,
        persist_workflow_fn=_persist_workflow,
    )


@router.post("/runtime/homeostasis/freeze/{process_id}")
async def freeze_runtime_homeostasis(process_id: str, req: Optional[RuntimeHomeostasisControlRequest] = None):
    req = req or RuntimeHomeostasisControlRequest()
    return await runtime_service.runtime_homeostasis_freeze_control(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        explain_runtime_process_fn=explain_runtime_process,
        select_policy_patch_preview_fn=observability.select_policy_patch_preview,
        apply_policy_patch_preview_fn=observability.apply_policy_patch_preview,
        refresh_workflow_policy_fn=lambda workflow: runtime_workflows.refresh_workflow_policy(
            workflow,
            build_workflow_policy_fn=build_workflow_policy,
        ),
        replace_process_workflow_fn=replace_process_workflow,
        pause_process_fn=pause_runtime_process,
        dry_run=bool(req.dry_run),
        load_workflow_fn=_load_workflow,
        persist_workflow_fn=_persist_workflow,
    )


@router.post("/runtime/homeostasis/rollback/{process_id}")
async def rollback_runtime_homeostasis(process_id: str, req: Optional[RuntimeHomeostasisControlRequest] = None):
    req = req or RuntimeHomeostasisControlRequest()
    return await runtime_service.runtime_homeostasis_rollback_control(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        get_runtime_events_fn=get_runtime_events,
        policy_patch_history_fn=runtime_explain.policy_patch_history,
        select_policy_patch_preview_fn=observability.select_policy_patch_preview,
        apply_policy_patch_preview_fn=observability.apply_policy_patch_preview,
        refresh_workflow_policy_fn=lambda workflow: runtime_workflows.refresh_workflow_policy(
            workflow,
            build_workflow_policy_fn=build_workflow_policy,
        ),
        replace_process_workflow_fn=replace_process_workflow,
        dry_run=bool(req.dry_run),
        allow_intervening_revisions=bool(req.allow_intervening_revisions),
        load_workflow_fn=_load_workflow,
        persist_workflow_fn=_persist_workflow,
    )


@router.post("/runtime/homeostasis/resume/{process_id}")
async def resume_runtime_homeostasis(process_id: str):
    return runtime_service.runtime_homeostasis_resume_control(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        resume_process_fn=resume_runtime_process,
    )

@router.get("/runtime/incident-trends")
async def get_runtime_incident_trends(hours: Optional[float] = None):
    return runtime_service.runtime_incident_trends(
        hours=hours,
        list_runtime_processes_fn=list_runtime_processes,
        filter_processes_by_hours_fn=observability.filter_processes_by_hours,
        incident_trends_fn=observability.incident_trends,
        execution_trace_fn=explain.execution_trace,
    )


@router.get("/runtime/analytics-summary")
async def get_runtime_analytics_summary(hours: Optional[float] = None, bucket_hours: float = 6.0):
    return runtime_service.runtime_analytics_summary(
        hours=hours,
        bucket_hours=bucket_hours,
        list_runtime_processes_fn=list_runtime_processes,
        analytics_summary_fn=observability.analytics_summary,
        execution_trace_fn=explain.execution_trace,
    )


@router.get("/runtime/analytics-report")
async def get_runtime_analytics_report(hours: Optional[float] = None, bucket_hours: float = 6.0, title: Optional[str] = None):
    return runtime_service.runtime_analytics_report(
        hours=hours,
        bucket_hours=bucket_hours,
        title=title,
        list_runtime_processes_fn=list_runtime_processes,
        analytics_report_fn=observability.analytics_report,
        execution_trace_fn=explain.execution_trace,
    )


@router.get("/runtime/analytics-report-markdown")
async def get_runtime_analytics_report_markdown(hours: Optional[float] = None, bucket_hours: float = 6.0, title: Optional[str] = None):
    return runtime_service.runtime_analytics_report_markdown(
        hours=hours,
        bucket_hours=bucket_hours,
        title=title,
        list_runtime_processes_fn=list_runtime_processes,
        analytics_report_fn=observability.analytics_report,
        analytics_report_markdown_fn=observability.analytics_report_markdown,
        execution_trace_fn=explain.execution_trace,
    )


@router.get("/runtime/analytics-compare")
async def get_runtime_analytics_compare(hours: float = 24.0, bucket_hours: float = 6.0):
    return runtime_service.runtime_analytics_compare(
        hours=hours,
        bucket_hours=bucket_hours,
        list_runtime_processes_fn=list_runtime_processes,
        analytics_comparison_fn=observability.analytics_comparison,
        execution_trace_fn=explain.execution_trace,
    )


@router.get("/runtime/analytics-correlation")
async def get_runtime_analytics_correlation(hours: Optional[float] = None):
    return runtime_service.runtime_analytics_correlation(
        hours=hours,
        list_runtime_processes_fn=list_runtime_processes,
        get_runtime_events_fn=get_runtime_events,
        trace_correlation_summary_fn=observability.trace_correlation_summary,
    )

@router.get("/runtime/self-review/{process_id}")
async def get_runtime_self_review(process_id: str):
    return await runtime_service.runtime_self_review(
        process_id,
        explain_runtime_process_fn=explain_runtime_process,
        get_runtime_process_fn=get_runtime_process,
        assemble_runtime_self_review_response_fn=runtime_explain.assemble_runtime_self_review_response,
    )

@router.get("/runtime/postmortem/{process_id}")
async def get_runtime_postmortem(process_id: str):
    return await runtime_service.runtime_postmortem(
        process_id,
        explain_runtime_process_fn=explain_runtime_process,
        get_runtime_process_fn=get_runtime_process,
        assemble_runtime_postmortem_response_fn=runtime_explain.assemble_runtime_postmortem_response,
    )

@router.post("/runtime/wake/{process_id}")
async def wake_runtime_process_route(process_id: str):
    return runtime_service.runtime_process_action(
        process_id,
        action_fn=wake_runtime_process,
        error_cls=ReasoningSchedulerError,
    )


@router.post("/runtime/cancel/{process_id}")
async def cancel_runtime_process_route(process_id: str, reason: str = "cancelled_by_operator"):
    return runtime_service.runtime_process_action(
        process_id,
        action_fn=cancel_runtime_process,
        error_cls=ReasoningSchedulerError,
        reason=reason,
    )


@router.post("/runtime/pause/{process_id}")
async def pause_runtime_process_route(process_id: str):
    return runtime_service.runtime_process_action(
        process_id,
        action_fn=pause_runtime_process,
        error_cls=ReasoningSchedulerError,
    )


@router.post("/runtime/resume/{process_id}")
async def resume_runtime_process_route(process_id: str):
    return runtime_service.runtime_process_action(
        process_id,
        action_fn=resume_runtime_process,
        error_cls=ReasoningSchedulerError,
    )


@router.get("/runtime/belief-conflicts")
async def get_runtime_belief_conflicts(subject: Optional[str] = None, predicate: Optional[str] = None, limit: int = 50):
    return runtime_service.runtime_belief_conflicts(
        subject=subject,
        predicate=predicate,
        limit=limit,
        belief_conflicts_fn=belief_conflicts,
    )


@router.get("/runtime/belief-lineage/{claim_id}")
async def get_runtime_belief_lineage(claim_id: str):
    return runtime_service.runtime_belief_lineage(claim_id, trace_belief_lineage_fn=trace_belief_lineage)


@router.get("/runtime/belief/{claim_id}")
async def get_runtime_belief(claim_id: str):
    return runtime_service.runtime_belief_detail(claim_id, explain_belief_fn=explain_belief)


@router.get("/runtime/beliefs")
async def get_runtime_beliefs(query: Optional[str] = None, task_id: Optional[str] = None, limit: int = 50):
    return runtime_service.runtime_beliefs(
        query=query,
        task_id=task_id,
        limit=limit,
        search_beliefs_fn=search_beliefs,
        beliefs_for_task_fn=beliefs_for_task,
        list_beliefs_fn=list_beliefs,
    )


@router.post("/workflow")
async def create_and_run_workflow(request: CreateWorkflowRequest):
    """Create a workflow, store it, then execute it immediately."""
    if len(request.steps) > MAX_WORKFLOW_STEPS:
        raise HTTPException(status_code=400, detail=f"too many steps (max {MAX_WORKFLOW_STEPS})")

    workflow = runtime_service.build_workflow_request_record(
        name=request.name,
        steps=request.steps,
        metadata=request.metadata,
        model_dump_compat_fn=model_dump_compat,
        build_workflow_record_fn=runtime_workflows.build_workflow_record,
    )
    _stats["workflows_created"] += 1

    gate_failure = await runtime_service.maybe_sentinel_gate(
        metadata=request.metadata,
        workflow_id=workflow["workflow_id"],
        sentinel_preflight_fn=_sentinel_preflight,
    )
    if gate_failure:
        return gate_failure

    execution = await runtime_service.execute_and_persist_workflow(
        workflow,
        execute_workflow_fn=_execute_workflow,
        apply_execution_result_fn=runtime_workflows.apply_execution_result,
        persist_workflow_fn=_persist_workflow,
        max_executions=MAX_EXECUTIONS_PER_WORKFLOW,
    )

    return {
        "success": True,
        "workflow_id": workflow["workflow_id"],
        "name": request.name,
        "execution": execution,
    }

@router.post("/workflow_async")
async def create_and_run_workflow_async(request: CreateWorkflowRequest):
    """Create a workflow, store it, then execute it in the background."""
    if len(request.steps) > MAX_WORKFLOW_STEPS:
        raise HTTPException(status_code=400, detail=f"too many steps (max {MAX_WORKFLOW_STEPS})")

    workflow = runtime_service.build_workflow_request_record(
        name=request.name,
        steps=request.steps,
        metadata=request.metadata,
        model_dump_compat_fn=model_dump_compat,
        build_workflow_record_fn=runtime_workflows.build_workflow_record,
    )

    _stats["workflows_created"] += 1
    _persist_workflow(workflow)

    async def _runner():
        await runtime_service.finalize_async_workflow(
            workflow,
            metadata=request.metadata,
            sentinel_preflight_fn=_sentinel_preflight,
            execute_workflow_fn=_execute_workflow,
            apply_execution_result_fn=runtime_workflows.apply_execution_result,
            build_blocked_execution_fn=runtime_workflows.build_blocked_execution,
            build_error_execution_fn=runtime_workflows.build_error_execution,
            persist_workflow_fn=_persist_workflow,
            max_executions=MAX_EXECUTIONS_PER_WORKFLOW,
        )

    asyncio.create_task(_runner())

    return {
        "success": True,
        "workflow_id": workflow["workflow_id"],
        "name": request.name,
        "scheduled": True,
    }



@router.get("/workflows")
async def list_workflows():
    """List all stored workflows with last execution status."""
    items = runtime_workflows.workflow_summary_items(_list_workflows())
    return {
        "success": True,
        "workflows": items,
        "total": len(items),
    }




@router.get("/workflow/{workflow_id}")
async def get_workflow(workflow_id: str, executions_limit: int = 5):
    """Get a stored workflow including recent execution traces."""
    lim = max(0, min(int(executions_limit), MAX_EXECUTIONS_PER_WORKFLOW))
    return runtime_service.workflow_view_or_404(
        workflow_id,
        executions_limit=lim,
        load_workflow_fn=_load_workflow,
        workflow_view_fn=runtime_workflows.workflow_view,
    )


@router.get("/execution/{execution_id}")
async def get_execution(execution_id: str):
    """Lookup an execution trace across all workflows."""
    return runtime_service.execution_lookup_or_404(
        execution_id,
        list_workflows_fn=_list_workflows,
        find_execution_fn=runtime_workflows.find_execution,
    )


@router.post("/run/{workflow_id}")
async def rerun_workflow(workflow_id: str):
    """Re-run an existing stored workflow by ID."""
    return await runtime_service.rerun_workflow_or_404(
        workflow_id,
        load_workflow_fn=_load_workflow,
        execute_workflow_fn=_execute_workflow,
        apply_execution_result_fn=runtime_workflows.apply_execution_result,
        persist_workflow_fn=_persist_workflow,
        max_executions=MAX_EXECUTIONS_PER_WORKFLOW,
    )
