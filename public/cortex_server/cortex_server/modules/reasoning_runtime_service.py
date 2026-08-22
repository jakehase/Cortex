from __future__ import annotations

import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import HTTPException


JsonDict = Dict[str, Any]
ExplainRuntimeProcessFn = Callable[[str], Awaitable[JsonDict]]
GetRuntimeProcessFn = Callable[[str], Optional[JsonDict]]
ListRuntimeProcessesFn = Callable[[], List[JsonDict]]
GetRuntimeEventsFn = Callable[..., List[JsonDict]]
BeliefsForTaskFn = Callable[..., List[JsonDict]]
PolicyPatchHistoryFn = Callable[[List[JsonDict]], JsonDict]
ListBeliefsFn = Callable[..., List[JsonDict]]
SearchBeliefsFn = Callable[..., List[JsonDict]]
LoadWorkflowFn = Callable[[str], Optional[JsonDict]]
ListWorkflowsFn = Callable[[], List[JsonDict]]
PersistWorkflowFn = Callable[[JsonDict], JsonDict]
ApplyExecutionResultFn = Callable[..., JsonDict]
ExecuteWorkflowFn = Callable[[JsonDict], Awaitable[JsonDict]]
SentinelPreflightFn = Callable[[], Awaitable[JsonDict]]
BuildWorkflowRecordFn = Callable[..., JsonDict]
ModelDumpCompatFn = Callable[[Any], JsonDict]
ReplaceProcessWorkflowFn = Callable[..., JsonDict]
RefreshWorkflowPolicyFn = Callable[[JsonDict], JsonDict]
ApplyPolicyPatchPreviewFn = Callable[..., JsonDict]
SelectPolicyPatchPreviewFn = Callable[..., JsonDict]
ProcessActionFn = Callable[[str], JsonDict]
RecordRuntimeEventFn = Callable[[str, str, JsonDict], JsonDict]



def build_plan_projection(
    graph: Any,
    *,
    validate_plan_graph_fn: Callable[[Any], JsonDict],
    build_workflow_policy_fn: Callable[..., JsonDict],
    compile_plan_to_workflow_fn: Callable[[Any], JsonDict],
    compile_plan_to_reasoning_task_fn: Callable[..., Any],
    model_dump_compat_fn: Callable[[Any], JsonDict],
) -> JsonDict:
    summary = validate_plan_graph_fn(graph)
    policy = build_workflow_policy_fn(
        name=graph.name,
        goal=graph.goal,
        description=graph.description,
        steps=compile_plan_to_workflow_fn(graph).get("steps") or [],
        metadata=graph.metadata,
    )
    kernel_task = compile_plan_to_reasoning_task_fn(
        graph,
        task_id=f"task_plan_{uuid.uuid4().hex[:10]}",
        owner=str((graph.metadata or {}).get("owner") or "cortex"),
        session_key=(graph.metadata or {}).get("session_key"),
        archetype=(graph.metadata or {}).get("archetype"),
    )
    task_payload = model_dump_compat_fn(kernel_task)
    task_payload.setdefault("metadata", {})["policy"] = policy
    task_payload.setdefault("policy_decisions", list(policy.get("decisions") or []))
    return {
        "success": True,
        "plan": summary,
        "policy": policy,
        "kernel_task": task_payload,
    }



def schedule_runtime_plan(
    request: Any,
    *,
    workflow: JsonDict,
    build_workflow_policy_fn: Callable[..., JsonDict],
    create_process_from_workflow_fn: Callable[..., JsonDict],
) -> JsonDict:
    runtime_metadata = dict(workflow.get("metadata") or {})
    runtime_metadata["workflow_id"] = workflow["workflow_id"]
    if request.options.cadence_seconds:
        runtime_metadata["cadence_seconds"] = int(request.options.cadence_seconds)
    approval_grant_ids = [str(x) for x in (request.options.approval_grant_ids or []) if str(x).strip()]
    inline_approval_grants = [dict(item) for item in (request.options.approval_grants or []) if isinstance(item, dict)]
    if inline_approval_grants:
        # Preserve signed grants for downstream verification.  Scheduling must
        # never turn an unsigned caller assertion into a persisted authority.
        runtime_metadata["approval_grants"] = inline_approval_grants
    if approval_grant_ids:
        runtime_metadata["approval_grant_ids"] = approval_grant_ids
    if request.options.approved:
        runtime_metadata["legacy_approval_requested"] = True
    runtime_policy = build_workflow_policy_fn(
        name=workflow["name"],
        goal=str(runtime_metadata.get("goal") or ""),
        description=str(runtime_metadata.get("description") or ""),
        steps=workflow["steps"],
        metadata=runtime_metadata,
    )
    runtime_metadata["policy"] = runtime_policy
    process = create_process_from_workflow_fn(
        {
            "name": workflow["name"],
            "steps": workflow["steps"],
            "metadata": runtime_metadata,
        },
        task_id=((workflow.get("kernel_task") or {}).get("task_id")),
        start_at=request.options.start_at,
        owner=request.options.owner or str((request.graph.metadata or {}).get("owner") or "cortex"),
        session_key=request.options.session_key or (request.graph.metadata or {}).get("session_key"),
        cadence_seconds=request.options.cadence_seconds,
        enabled=True,
    )
    return {
        "success": True,
        "workflow_id": workflow["workflow_id"],
        "process": process,
        "kernel_task": workflow.get("kernel_task"),
    }



def require_runtime_process(process_id: str, *, get_runtime_process_fn: GetRuntimeProcessFn) -> JsonDict:
    process = get_runtime_process_fn(process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{process_id}' not found")
    return process


async def explain_runtime_process(
    process_id: str,
    *,
    get_runtime_process_fn: GetRuntimeProcessFn,
    assemble_runtime_process_explain_fn: Callable[..., JsonDict],
    beliefs_for_task_fn: Callable[..., List[JsonDict]],
    summarize_beliefs_fn: Callable[..., JsonDict],
    explain_belief_fn: Callable[..., JsonDict],
    get_belief_fn: Callable[..., JsonDict],
    select_influential_beliefs_fn: Callable[..., List[JsonDict]],
) -> JsonDict:
    process = require_runtime_process(process_id, get_runtime_process_fn=get_runtime_process_fn)
    return assemble_runtime_process_explain_fn(
        process_id=process_id,
        process=process,
        beliefs_for_task_fn=beliefs_for_task_fn,
        summarize_beliefs_fn=summarize_beliefs_fn,
        explain_belief_fn=explain_belief_fn,
        get_belief_fn=get_belief_fn,
        select_influential_beliefs_fn=select_influential_beliefs_fn,
    )


async def runtime_process_view(
    process_id: str,
    *,
    events_limit: int,
    get_runtime_process_fn: GetRuntimeProcessFn,
    assemble_runtime_process_view_fn: Callable[..., JsonDict],
    get_runtime_events_fn: Callable[..., List[JsonDict]],
    beliefs_for_task_fn: Callable[..., List[JsonDict]],
    summarize_beliefs_fn: Callable[..., JsonDict],
    explain_belief_fn: Callable[..., JsonDict],
    get_belief_fn: Callable[..., JsonDict],
    select_influential_beliefs_fn: Callable[..., List[JsonDict]],
) -> JsonDict:
    process = require_runtime_process(process_id, get_runtime_process_fn=get_runtime_process_fn)
    return assemble_runtime_process_view_fn(
        process_id=process_id,
        process=process,
        events_limit=events_limit,
        get_runtime_events_fn=get_runtime_events_fn,
        beliefs_for_task_fn=beliefs_for_task_fn,
        summarize_beliefs_fn=summarize_beliefs_fn,
        explain_belief_fn=explain_belief_fn,
        get_belief_fn=get_belief_fn,
        select_influential_beliefs_fn=select_influential_beliefs_fn,
    )


async def runtime_policy_explain(
    process_id: str,
    *,
    get_runtime_process_fn: GetRuntimeProcessFn,
    get_runtime_events_fn: GetRuntimeEventsFn,
    explain_runtime_process_fn: ExplainRuntimeProcessFn,
    assemble_runtime_policy_response_fn: Callable[..., JsonDict],
    policy_patch_history_fn: Callable[[List[JsonDict]], JsonDict],
    explain_belief_fn: Callable[..., JsonDict],
    get_belief_fn: Callable[..., JsonDict],
) -> JsonDict:
    process = require_runtime_process(process_id, get_runtime_process_fn=get_runtime_process_fn)
    process_explain = await explain_runtime_process_fn(process_id)
    events = get_runtime_events_fn(process_id, limit=100)
    if isinstance(process_explain, dict):
        process_explain = dict(process_explain)
        process_explain["policy_patch_history"] = policy_patch_history_fn(events)
    return assemble_runtime_policy_response_fn(
        process_id=process_id,
        process=process,
        explained=process_explain,
        explain_belief_fn=explain_belief_fn,
        get_belief_fn=get_belief_fn,
    )



def runtime_policy_history(
    process_id: str,
    *,
    get_runtime_process_fn: GetRuntimeProcessFn,
    get_runtime_events_fn: GetRuntimeEventsFn,
    policy_patch_history_fn: Callable[[List[JsonDict]], JsonDict],
) -> JsonDict:
    require_runtime_process(process_id, get_runtime_process_fn=get_runtime_process_fn)
    events = get_runtime_events_fn(process_id, limit=100)
    history = policy_patch_history_fn(events)
    return {"success": True, "process_id": process_id, "policy_patch_history": history}


_HOMEOSTASIS_FREEZE_SETTINGS = [
    "execution_mode",
    "max_parallelism",
    "same_tick_drain",
    "verification_mode",
    "retry_on_timeout",
    "retry_max_attempts",
]

_HOMEOSTASIS_FREEZE_OVERRIDES = {
    "execution_mode": "sequential",
    "max_parallelism": 1,
    "same_tick_drain": False,
    "verification_mode": "strict",
    "retry_on_timeout": True,
    "retry_max_attempts": 2,
}


def _runtime_process_identity(process: JsonDict) -> JsonDict:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    return {
        "owner": str(process.get("owner") or metadata.get("owner") or "cortex"),
        "session_key": str(process.get("session_key") or metadata.get("session_key") or "") or None,
        "workflow_id": str(metadata.get("workflow_id") or "") or None,
        "task_id": str(process.get("task_id") or metadata.get("task_id") or metadata.get("kernel_task_id") or "") or None,
    }



def _authorize_homeostasis_operator(*, process: JsonDict, actor_id: str, actor_session_key: Optional[str]) -> JsonDict:
    identity = _runtime_process_identity(process)
    owner = str(identity.get("owner") or "cortex")
    session_key = str(identity.get("session_key") or "") or None
    actor_id = str(actor_id or "").strip() or "unknown"
    actor_session_key = str(actor_session_key or "").strip() or None

    if actor_id == owner:
        return {"authorized": True, "basis": "owner_match", "owner": owner, "session_key": session_key, "actor_id": actor_id, "actor_session_key": actor_session_key}
    if actor_session_key and session_key and actor_session_key == session_key:
        return {"authorized": True, "basis": "session_key_match", "owner": owner, "session_key": session_key, "actor_id": actor_id, "actor_session_key": actor_session_key}
    if actor_id == "cortex" and owner == "cortex":
        return {"authorized": True, "basis": "system_default", "owner": owner, "session_key": session_key, "actor_id": actor_id, "actor_session_key": actor_session_key}
    return {"authorized": False, "basis": "owner_or_session_mismatch", "owner": owner, "session_key": session_key, "actor_id": actor_id, "actor_session_key": actor_session_key}



def _homeostasis_audit_payload(*, control: str, process: JsonDict, actor_id: str, actor_session_key: Optional[str], reason: Optional[str], authorization: JsonDict, status: str, dry_run: bool, extra: Optional[JsonDict] = None) -> JsonDict:
    identity = _runtime_process_identity(process)
    payload = {
        "control": control,
        "status": status,
        "dry_run": bool(dry_run),
        "actor": {
            "actor_id": str(actor_id or "").strip() or "unknown",
            "actor_session_key": str(actor_session_key or "").strip() or None,
        },
        "authorization": {
            "authorized": bool(authorization.get("authorized")),
            "basis": authorization.get("basis"),
            "process_owner": identity.get("owner"),
            "process_session_key": identity.get("session_key"),
        },
        "reason": str(reason or "operator_control").strip() or "operator_control",
        "workflow_id": identity.get("workflow_id"),
        "task_id": identity.get("task_id"),
    }
    if isinstance(extra, dict) and extra:
        payload.update(dict(extra))
    return payload



def _record_homeostasis_control_event(*, record_runtime_event_fn: Optional[RecordRuntimeEventFn], process_id: str, payload: JsonDict) -> None:
    if callable(record_runtime_event_fn):
        record_runtime_event_fn(process_id, "homeostasis_control_audit", dict(payload or {}))


async def runtime_homeostasis_freeze_control(
    process_id: str,
    *,
    get_runtime_process_fn: GetRuntimeProcessFn,
    explain_runtime_process_fn: ExplainRuntimeProcessFn,
    select_policy_patch_preview_fn: SelectPolicyPatchPreviewFn,
    apply_policy_patch_preview_fn: ApplyPolicyPatchPreviewFn,
    refresh_workflow_policy_fn: RefreshWorkflowPolicyFn,
    replace_process_workflow_fn: ReplaceProcessWorkflowFn,
    pause_process_fn: ProcessActionFn,
    record_runtime_event_fn: Optional[RecordRuntimeEventFn] = None,
    actor_id: str = "cortex",
    actor_session_key: Optional[str] = None,
    reason: Optional[str] = None,
    dry_run: bool = False,
    load_workflow_fn: Optional[LoadWorkflowFn] = None,
    persist_workflow_fn: Optional[PersistWorkflowFn] = None,
) -> JsonDict:
    process = require_runtime_process(process_id, get_runtime_process_fn=get_runtime_process_fn)
    authorization = _authorize_homeostasis_operator(process=process, actor_id=actor_id, actor_session_key=actor_session_key)
    if not bool(authorization.get("authorized")):
        denied_payload = _homeostasis_audit_payload(
            control="freeze_policy",
            process=process,
            actor_id=actor_id,
            actor_session_key=actor_session_key,
            reason=reason,
            authorization=authorization,
            status="denied",
            dry_run=bool(dry_run),
        )
        _record_homeostasis_control_event(record_runtime_event_fn=record_runtime_event_fn, process_id=process_id, payload=denied_payload)
        raise HTTPException(status_code=403, detail="homeostasis control denied: actor must match process owner or session key")
    requested_payload = _homeostasis_audit_payload(
        control="freeze_policy",
        process=process,
        actor_id=actor_id,
        actor_session_key=actor_session_key,
        reason=reason,
        authorization=authorization,
        status="requested",
        dry_run=bool(dry_run),
        extra={"requested_settings": list(_HOMEOSTASIS_FREEZE_SETTINGS)},
    )
    _record_homeostasis_control_event(record_runtime_event_fn=record_runtime_event_fn, process_id=process_id, payload=requested_payload)
    status = str(process.get("status") or "")
    if status in {"completed", "failed", "cancelled"}:
        blocked_payload = _homeostasis_audit_payload(
            control="freeze_policy",
            process=process,
            actor_id=actor_id,
            actor_session_key=actor_session_key,
            reason=reason,
            authorization=authorization,
            status="blocked_terminal_process",
            dry_run=bool(dry_run),
        )
        _record_homeostasis_control_event(record_runtime_event_fn=record_runtime_event_fn, process_id=process_id, payload=blocked_payload)
        return {
            "success": True,
            "process_id": process_id,
            "control": "freeze_policy",
            "authorization": authorization,
            "frozen": False,
            "dry_run": bool(dry_run),
            "blocked_reason": "terminal_process",
            "process": process,
        }

    audit_context = _homeostasis_audit_payload(
        control="freeze_policy",
        process=process,
        actor_id=actor_id,
        actor_session_key=actor_session_key,
        reason=reason,
        authorization=authorization,
        status="patch_applied",
        dry_run=bool(dry_run),
    )
    patch_result = await apply_runtime_policy_patch(
        process_id,
        get_runtime_process_fn=get_runtime_process_fn,
        explain_runtime_process_fn=explain_runtime_process_fn,
        select_policy_patch_preview_fn=select_policy_patch_preview_fn,
        apply_policy_patch_preview_fn=apply_policy_patch_preview_fn,
        refresh_workflow_policy_fn=refresh_workflow_policy_fn,
        replace_process_workflow_fn=replace_process_workflow_fn,
        requested_settings=list(_HOMEOSTASIS_FREEZE_SETTINGS),
        metadata_overrides=dict(_HOMEOSTASIS_FREEZE_OVERRIDES),
        dry_run=bool(dry_run),
        allow_confirmation_required=True,
        load_workflow_fn=load_workflow_fn,
        persist_workflow_fn=persist_workflow_fn,
        audit_context=audit_context,
    )
    if bool(dry_run) or not bool(patch_result.get("applied")):
        completed_payload = _homeostasis_audit_payload(
            control="freeze_policy",
            process=patch_result.get("process") if isinstance(patch_result.get("process"), dict) else process,
            actor_id=actor_id,
            actor_session_key=actor_session_key,
            reason=reason,
            authorization=authorization,
            status="preview" if bool(dry_run) else "no_change",
            dry_run=bool(dry_run),
            extra={"policy_revision_id": patch_result.get("revision_id")},
        )
        _record_homeostasis_control_event(record_runtime_event_fn=record_runtime_event_fn, process_id=process_id, payload=completed_payload)
        return {
            "success": True,
            "process_id": process_id,
            "control": "freeze_policy",
            "authorization": authorization,
            "frozen": False,
            "dry_run": bool(dry_run),
            "policy_result": patch_result,
            "process": patch_result.get("process") or process,
            "workflow": patch_result.get("workflow"),
        }

    paused = pause_process_fn(process_id)
    completed_payload = _homeostasis_audit_payload(
        control="freeze_policy",
        process=paused,
        actor_id=actor_id,
        actor_session_key=actor_session_key,
        reason=reason,
        authorization=authorization,
        status="completed",
        dry_run=False,
        extra={"policy_revision_id": patch_result.get("revision_id")},
    )
    _record_homeostasis_control_event(record_runtime_event_fn=record_runtime_event_fn, process_id=process_id, payload=completed_payload)
    return {
        "success": True,
        "process_id": process_id,
        "control": "freeze_policy",
        "authorization": authorization,
        "frozen": True,
        "dry_run": False,
        "revision_id": patch_result.get("revision_id"),
        "policy_result": patch_result,
        "process": paused,
        "workflow": patch_result.get("workflow"),
    }


async def runtime_homeostasis_rollback_control(
    process_id: str,
    *,
    get_runtime_process_fn: GetRuntimeProcessFn,
    get_runtime_events_fn: GetRuntimeEventsFn,
    policy_patch_history_fn: PolicyPatchHistoryFn,
    select_policy_patch_preview_fn: SelectPolicyPatchPreviewFn,
    apply_policy_patch_preview_fn: ApplyPolicyPatchPreviewFn,
    refresh_workflow_policy_fn: RefreshWorkflowPolicyFn,
    replace_process_workflow_fn: ReplaceProcessWorkflowFn,
    record_runtime_event_fn: Optional[RecordRuntimeEventFn] = None,
    actor_id: str = "cortex",
    actor_session_key: Optional[str] = None,
    reason: Optional[str] = None,
    dry_run: bool = False,
    allow_intervening_revisions: bool = False,
    load_workflow_fn: Optional[LoadWorkflowFn] = None,
    persist_workflow_fn: Optional[PersistWorkflowFn] = None,
) -> JsonDict:
    process = require_runtime_process(process_id, get_runtime_process_fn=get_runtime_process_fn)
    authorization = _authorize_homeostasis_operator(process=process, actor_id=actor_id, actor_session_key=actor_session_key)
    if not bool(authorization.get("authorized")):
        denied_payload = _homeostasis_audit_payload(
            control="rollback_to_baseline",
            process=process,
            actor_id=actor_id,
            actor_session_key=actor_session_key,
            reason=reason,
            authorization=authorization,
            status="denied",
            dry_run=bool(dry_run),
        )
        _record_homeostasis_control_event(record_runtime_event_fn=record_runtime_event_fn, process_id=process_id, payload=denied_payload)
        raise HTTPException(status_code=403, detail="homeostasis control denied: actor must match process owner or session key")
    events = get_runtime_events_fn(process_id, limit=100)
    history = policy_patch_history_fn(events)
    entries = list(history.get("entries") or [])
    latest_applied = next((row for row in reversed(entries) if str((row or {}).get("kind") or "") == "policy_patch_applied"), None)
    if not isinstance(latest_applied, dict):
        blocked_payload = _homeostasis_audit_payload(
            control="rollback_to_baseline",
            process=process,
            actor_id=actor_id,
            actor_session_key=actor_session_key,
            reason=reason,
            authorization=authorization,
            status="blocked_no_patch_history",
            dry_run=bool(dry_run),
        )
        _record_homeostasis_control_event(record_runtime_event_fn=record_runtime_event_fn, process_id=process_id, payload=blocked_payload)
        return {
            "success": True,
            "process_id": process_id,
            "control": "rollback_to_baseline",
            "authorization": authorization,
            "rolled_back": False,
            "dry_run": bool(dry_run),
            "blocked_reason": "no_policy_patch_history",
            "policy_patch_history": history,
            "process": process,
        }

    requested_payload = _homeostasis_audit_payload(
        control="rollback_to_baseline",
        process=process,
        actor_id=actor_id,
        actor_session_key=actor_session_key,
        reason=reason,
        authorization=authorization,
        status="requested",
        dry_run=bool(dry_run),
        extra={"target_revision_id": latest_applied.get("revision_id")},
    )
    _record_homeostasis_control_event(record_runtime_event_fn=record_runtime_event_fn, process_id=process_id, payload=requested_payload)
    rollback_result = await rollback_runtime_policy_patch(
        process_id,
        str(latest_applied.get("revision_id") or ""),
        get_runtime_process_fn=get_runtime_process_fn,
        get_runtime_events_fn=get_runtime_events_fn,
        policy_patch_history_fn=policy_patch_history_fn,
        select_policy_patch_preview_fn=select_policy_patch_preview_fn,
        apply_policy_patch_preview_fn=apply_policy_patch_preview_fn,
        refresh_workflow_policy_fn=refresh_workflow_policy_fn,
        replace_process_workflow_fn=replace_process_workflow_fn,
        dry_run=bool(dry_run),
        allow_confirmation_required=True,
        allow_intervening_revisions=bool(allow_intervening_revisions),
        load_workflow_fn=load_workflow_fn,
        persist_workflow_fn=persist_workflow_fn,
        audit_context=_homeostasis_audit_payload(
            control="rollback_to_baseline",
            process=process,
            actor_id=actor_id,
            actor_session_key=actor_session_key,
            reason=reason,
            authorization=authorization,
            status="rollback_applied",
            dry_run=bool(dry_run),
            extra={"target_revision_id": latest_applied.get("revision_id")},
        ),
    )
    rollback_result = dict(rollback_result)
    rollback_result["control"] = "rollback_to_baseline"
    rollback_result["authorization"] = authorization
    rollback_result["target_revision_id"] = latest_applied.get("revision_id")
    completed_payload = _homeostasis_audit_payload(
        control="rollback_to_baseline",
        process=rollback_result.get("process") if isinstance(rollback_result.get("process"), dict) else process,
        actor_id=actor_id,
        actor_session_key=actor_session_key,
        reason=reason,
        authorization=authorization,
        status="completed" if bool(rollback_result.get("rolled_back")) else ("preview" if bool(dry_run) else "no_change"),
        dry_run=bool(dry_run),
        extra={"target_revision_id": latest_applied.get("revision_id"), "policy_revision_id": rollback_result.get("revision_id")},
    )
    _record_homeostasis_control_event(record_runtime_event_fn=record_runtime_event_fn, process_id=process_id, payload=completed_payload)
    return rollback_result


def runtime_homeostasis_resume_control(
    process_id: str,
    *,
    get_runtime_process_fn: GetRuntimeProcessFn,
    resume_process_fn: ProcessActionFn,
    record_runtime_event_fn: Optional[RecordRuntimeEventFn] = None,
    actor_id: str = "cortex",
    actor_session_key: Optional[str] = None,
    reason: Optional[str] = None,
) -> JsonDict:
    process = require_runtime_process(process_id, get_runtime_process_fn=get_runtime_process_fn)
    authorization = _authorize_homeostasis_operator(process=process, actor_id=actor_id, actor_session_key=actor_session_key)
    if not bool(authorization.get("authorized")):
        denied_payload = _homeostasis_audit_payload(
            control="resume_governor",
            process=process,
            actor_id=actor_id,
            actor_session_key=actor_session_key,
            reason=reason,
            authorization=authorization,
            status="denied",
            dry_run=False,
        )
        _record_homeostasis_control_event(record_runtime_event_fn=record_runtime_event_fn, process_id=process_id, payload=denied_payload)
        raise HTTPException(status_code=403, detail="homeostasis control denied: actor must match process owner or session key")
    requested_payload = _homeostasis_audit_payload(
        control="resume_governor",
        process=process,
        actor_id=actor_id,
        actor_session_key=actor_session_key,
        reason=reason,
        authorization=authorization,
        status="requested",
        dry_run=False,
    )
    _record_homeostasis_control_event(record_runtime_event_fn=record_runtime_event_fn, process_id=process_id, payload=requested_payload)
    if str(process.get("status") or "") != "paused" and bool(process.get("enabled", True)):
        blocked_payload = _homeostasis_audit_payload(
            control="resume_governor",
            process=process,
            actor_id=actor_id,
            actor_session_key=actor_session_key,
            reason=reason,
            authorization=authorization,
            status="blocked_not_paused",
            dry_run=False,
        )
        _record_homeostasis_control_event(record_runtime_event_fn=record_runtime_event_fn, process_id=process_id, payload=blocked_payload)
        return {
            "success": True,
            "process_id": process_id,
            "control": "resume_governor",
            "authorization": authorization,
            "resumed": False,
            "blocked_reason": "not_paused",
            "process": process,
        }
    resumed = resume_process_fn(process_id)
    completed_payload = _homeostasis_audit_payload(
        control="resume_governor",
        process=resumed,
        actor_id=actor_id,
        actor_session_key=actor_session_key,
        reason=reason,
        authorization=authorization,
        status="completed",
        dry_run=False,
    )
    _record_homeostasis_control_event(record_runtime_event_fn=record_runtime_event_fn, process_id=process_id, payload=completed_payload)
    return {
        "success": True,
        "process_id": process_id,
        "control": "resume_governor",
        "authorization": authorization,
        "resumed": True,
        "process": resumed,
    }


async def rollback_runtime_policy_patch(
    process_id: str,
    revision_id: str,
    *,
    get_runtime_process_fn: GetRuntimeProcessFn,
    get_runtime_events_fn: GetRuntimeEventsFn,
    policy_patch_history_fn: PolicyPatchHistoryFn,
    select_policy_patch_preview_fn: SelectPolicyPatchPreviewFn,
    apply_policy_patch_preview_fn: ApplyPolicyPatchPreviewFn,
    refresh_workflow_policy_fn: RefreshWorkflowPolicyFn,
    replace_process_workflow_fn: ReplaceProcessWorkflowFn,
    dry_run: bool = False,
    allow_confirmation_required: bool = False,
    allow_intervening_revisions: bool = False,
    load_workflow_fn: Optional[LoadWorkflowFn] = None,
    persist_workflow_fn: Optional[PersistWorkflowFn] = None,
    audit_context: Optional[JsonDict] = None,
) -> JsonDict:
    process = require_runtime_process(process_id, get_runtime_process_fn=get_runtime_process_fn)
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    events = get_runtime_events_fn(process_id, limit=100)
    history = policy_patch_history_fn(events)
    entries = list(history.get("entries") or [])
    target_index = next((idx for idx, row in enumerate(entries) if str((row or {}).get("revision_id") or "") == str(revision_id)), None)
    if target_index is None:
        raise HTTPException(status_code=404, detail=f"Policy patch revision '{revision_id}' not found")
    target = dict(entries[target_index] or {})

    previous_values = dict(target.get("previous_values") or {})
    target_settings = {str(x) for x in (target.get("settings") or previous_values.keys()) if str(x).strip()}
    intervening_revisions: List[JsonDict] = []
    for row in entries[target_index + 1:]:
        if not isinstance(row, dict):
            continue
        changed_settings = {str(x) for x in (row.get("settings") or (row.get("metadata_overrides") or {}).keys()) if str(x).strip()}
        overlap = sorted(target_settings & changed_settings)
        if overlap:
            intervening_revisions.append(
                {
                    "revision_id": row.get("revision_id"),
                    "kind": row.get("kind"),
                    "ts": row.get("ts"),
                    "settings": overlap,
                }
            )
    current_settings = {key: metadata.get(key) for key in previous_values.keys()}
    base_preview = {
        "current_settings": current_settings,
        "changes": [
            {
                "setting": key,
                "before": metadata.get(key),
                "after": value,
                "target": "rollback",
                "reason": f"rollback:{revision_id}",
                "sources": [{"suggestion": "rollback", "reason": f"rollback:{revision_id}", "target": "rollback"}],
            }
            for key, value in previous_values.items()
        ],
        "apply_target": "workflow.metadata",
        "apply_mode": "merge",
        "skipped": [],
    }
    preview = select_policy_patch_preview_fn(
        preview=base_preview,
        include_settings=list(previous_values.keys()),
        metadata_overrides=previous_values,
        allow_confirmation_required=allow_confirmation_required,
    )
    patch_application = apply_policy_patch_preview_fn(
        workflow_metadata=metadata,
        preview=preview,
    )
    if dry_run:
        return {
            "success": True,
            "process_id": process_id,
            "rolled_back": False,
            "dry_run": True,
            "rolled_back_from_revision_id": revision_id,
            "allow_intervening_revisions": bool(allow_intervening_revisions),
            "intervening_revisions": intervening_revisions,
            "policy_patch_preview": preview,
            "patch_application": patch_application,
            "process": process,
            "workflow": None,
        }
    if intervening_revisions and not allow_intervening_revisions:
        return {
            "success": True,
            "process_id": process_id,
            "rolled_back": False,
            "dry_run": False,
            "blocked_reason": "intervening_revisions_conflict",
            "rolled_back_from_revision_id": revision_id,
            "allow_intervening_revisions": False,
            "intervening_revisions": intervening_revisions,
            "policy_patch_preview": preview,
            "patch_application": patch_application,
            "process": process,
            "workflow": None,
        }
    if not bool(patch_application.get("applied")):
        return {
            "success": True,
            "process_id": process_id,
            "rolled_back": False,
            "dry_run": False,
            "rolled_back_from_revision_id": revision_id,
            "allow_intervening_revisions": bool(allow_intervening_revisions),
            "intervening_revisions": intervening_revisions,
            "policy_patch_preview": preview,
            "patch_application": patch_application,
            "process": process,
            "workflow": None,
        }

    updated_workflow = dict(workflow)
    updated_workflow["metadata"] = dict(patch_application.get("updated_metadata") or {})
    updated_workflow = refresh_workflow_policy_fn(updated_workflow)
    applied_settings = list(patch_application.get("applied_settings") or [])
    rollback_revision_id = f"polrev_{uuid.uuid4().hex[:10]}"
    rollback_previous_values = {str(row.get("setting") or ""): row.get("before") for row in applied_settings if str(row.get("setting") or "").strip()}
    restored_values = {str(row.get("setting") or ""): row.get("after") for row in applied_settings if str(row.get("setting") or "").strip()}
    updated_process = replace_process_workflow_fn(
        process_id,
        updated_workflow,
        event_kind="policy_patch_rolled_back",
        event_payload={
            "revision_id": rollback_revision_id,
            "recommendation_version": preview.get("recommendation_version"),
            "rolled_back_from_revision_id": revision_id,
            "applied_count": patch_application.get("applied_count"),
            "settings": [row.get("setting") for row in applied_settings],
            "applied_settings": applied_settings,
            "metadata_overrides": restored_values,
            "previous_values": rollback_previous_values,
            "requested_settings": list(previous_values.keys()),
            "operator_overrides": {},
            "allow_confirmation_required": bool(allow_confirmation_required),
            "audit": dict(audit_context or {}),
        },
    )

    persisted_workflow = None
    workflow_id = str(((updated_workflow.get("metadata") or {}).get("workflow_id")) or "").strip()
    if workflow_id and load_workflow_fn and persist_workflow_fn:
        stored = load_workflow_fn(workflow_id)
        if isinstance(stored, dict):
            stored = dict(stored)
            stored["metadata"] = dict(updated_workflow.get("metadata") or {})
            stored = refresh_workflow_policy_fn(stored)
            persisted_workflow = persist_workflow_fn(stored)

    return {
        "success": True,
        "process_id": process_id,
        "rolled_back": True,
        "dry_run": False,
        "revision_id": rollback_revision_id,
        "rolled_back_from_revision_id": revision_id,
        "allow_intervening_revisions": bool(allow_intervening_revisions),
        "intervening_revisions": intervening_revisions,
        "policy_patch_preview": preview,
        "patch_application": patch_application,
        "process": updated_process,
        "workflow": persisted_workflow,
    }



def runtime_incident_trends(
    *,
    hours: Optional[float],
    list_runtime_processes_fn: ListRuntimeProcessesFn,
    filter_processes_by_hours_fn: Callable[[List[JsonDict], Optional[float]], List[JsonDict]],
    incident_trends_fn: Callable[..., JsonDict],
    execution_trace_fn: Callable[..., List[JsonDict]],
) -> JsonDict:
    processes = filter_processes_by_hours_fn(list_runtime_processes_fn(), hours)
    return {
        "success": True,
        "trends": incident_trends_fn(processes=processes, execution_trace_fn=execution_trace_fn),
        "hours": hours,
    }



def runtime_analytics_summary(
    *,
    hours: Optional[float],
    bucket_hours: float,
    list_runtime_processes_fn: ListRuntimeProcessesFn,
    analytics_summary_fn: Callable[..., JsonDict],
    execution_trace_fn: Callable[..., List[JsonDict]],
) -> JsonDict:
    return {
        "success": True,
        "hours": hours,
        "bucket_hours": bucket_hours,
        "analytics": analytics_summary_fn(
            processes=list_runtime_processes_fn(),
            execution_trace_fn=execution_trace_fn,
            hours=hours,
            bucket_hours=bucket_hours,
        ),
    }



def runtime_analytics_report(
    *,
    hours: Optional[float],
    bucket_hours: float,
    title: Optional[str],
    list_runtime_processes_fn: ListRuntimeProcessesFn,
    analytics_report_fn: Callable[..., JsonDict],
    execution_trace_fn: Callable[..., List[JsonDict]],
) -> JsonDict:
    return {
        "success": True,
        "hours": hours,
        "bucket_hours": bucket_hours,
        "report": analytics_report_fn(
            processes=list_runtime_processes_fn(),
            execution_trace_fn=execution_trace_fn,
            hours=hours,
            bucket_hours=bucket_hours,
            title=title,
        ),
    }



def runtime_analytics_report_markdown(
    *,
    hours: Optional[float],
    bucket_hours: float,
    title: Optional[str],
    list_runtime_processes_fn: ListRuntimeProcessesFn,
    analytics_report_fn: Callable[..., JsonDict],
    analytics_report_markdown_fn: Callable[..., str],
    execution_trace_fn: Callable[..., List[JsonDict]],
) -> JsonDict:
    report = analytics_report_fn(
        processes=list_runtime_processes_fn(),
        execution_trace_fn=execution_trace_fn,
        hours=hours,
        bucket_hours=bucket_hours,
        title=title,
    )
    return {
        "success": True,
        "hours": hours,
        "bucket_hours": bucket_hours,
        "report": report,
        "markdown": analytics_report_markdown_fn(report=report),
    }



def runtime_analytics_compare(
    *,
    hours: float,
    bucket_hours: float,
    list_runtime_processes_fn: ListRuntimeProcessesFn,
    analytics_comparison_fn: Callable[..., JsonDict],
    execution_trace_fn: Callable[..., List[JsonDict]],
) -> JsonDict:
    return {
        "success": True,
        "hours": hours,
        "bucket_hours": bucket_hours,
        "comparison": analytics_comparison_fn(
            processes=list_runtime_processes_fn(),
            execution_trace_fn=execution_trace_fn,
            hours=hours,
            bucket_hours=bucket_hours,
        ),
    }



def runtime_analytics_correlation(
    *,
    hours: Optional[float],
    list_runtime_processes_fn: ListRuntimeProcessesFn,
    get_runtime_events_fn: GetRuntimeEventsFn,
    trace_correlation_summary_fn: Callable[..., JsonDict],
) -> JsonDict:
    return {
        "success": True,
        "hours": hours,
        "correlation": trace_correlation_summary_fn(
            processes=list_runtime_processes_fn(),
            get_runtime_events_fn=get_runtime_events_fn,
            hours=hours,
        ),
    }



def runtime_process_trace(
    process_id: str,
    *,
    get_runtime_process_fn: GetRuntimeProcessFn,
    get_runtime_events_fn: GetRuntimeEventsFn,
    process_trace_surface_fn: Callable[..., JsonDict],
) -> JsonDict:
    process = require_runtime_process(process_id, get_runtime_process_fn=get_runtime_process_fn)
    events = get_runtime_events_fn(process_id, limit=200)
    return {
        "success": True,
        "trace": process_trace_surface_fn(process=process, events=events),
    }


async def runtime_self_review(
    process_id: str,
    *,
    explain_runtime_process_fn: ExplainRuntimeProcessFn,
    get_runtime_process_fn: GetRuntimeProcessFn,
    assemble_runtime_self_review_response_fn: Callable[..., JsonDict],
) -> JsonDict:
    try:
        explained = await explain_runtime_process_fn(process_id)
        return assemble_runtime_self_review_response_fn(process_id=process_id, explained=explained)
    except HTTPException:
        raise
    except Exception:
        require_runtime_process(process_id, get_runtime_process_fn=get_runtime_process_fn)
        return assemble_runtime_self_review_response_fn(process_id=process_id, fallback=True)


async def runtime_postmortem(
    process_id: str,
    *,
    explain_runtime_process_fn: ExplainRuntimeProcessFn,
    get_runtime_process_fn: GetRuntimeProcessFn,
    assemble_runtime_postmortem_response_fn: Callable[..., JsonDict],
) -> JsonDict:
    try:
        explained = await explain_runtime_process_fn(process_id)
        return assemble_runtime_postmortem_response_fn(process_id=process_id, explained=explained)
    except HTTPException:
        raise
    except Exception:
        require_runtime_process(process_id, get_runtime_process_fn=get_runtime_process_fn)
        return assemble_runtime_postmortem_response_fn(process_id=process_id, fallback=True)



def runtime_beliefs(
    *,
    query: Optional[str],
    task_id: Optional[str],
    limit: int,
    search_beliefs_fn: SearchBeliefsFn,
    beliefs_for_task_fn: BeliefsForTaskFn,
    list_beliefs_fn: ListBeliefsFn,
) -> JsonDict:
    if query:
        beliefs = search_beliefs_fn(query, limit=limit)
    elif task_id:
        beliefs = beliefs_for_task_fn(task_id, limit=limit)
    else:
        beliefs = list_beliefs_fn(limit=limit)
    return {"success": True, "beliefs": beliefs, "count": len(beliefs)}



def runtime_process_action(
    process_id: str,
    *,
    action_fn: Callable[..., JsonDict],
    error_cls: type[Exception],
    **kwargs: Any,
) -> JsonDict:
    try:
        process = action_fn(process_id, **kwargs)
    except error_cls as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"success": True, "process": process}



def runtime_belief_conflicts(
    *,
    subject: Optional[str],
    predicate: Optional[str],
    limit: int,
    belief_conflicts_fn: Callable[..., List[JsonDict]],
) -> JsonDict:
    rows = belief_conflicts_fn(subject=subject, predicate=predicate, limit=limit)
    return {"success": True, "conflicts": rows, "count": len(rows)}



def runtime_belief_lineage(claim_id: str, *, trace_belief_lineage_fn: Callable[[str], Optional[JsonDict]]) -> JsonDict:
    lineage = trace_belief_lineage_fn(claim_id)
    if not lineage:
        raise HTTPException(status_code=404, detail=f"Belief '{claim_id}' not found")
    return {"success": True, **lineage}



def runtime_belief_detail(claim_id: str, *, explain_belief_fn: Callable[[str], Optional[JsonDict]]) -> JsonDict:
    belief = explain_belief_fn(claim_id)
    if not belief:
        raise HTTPException(status_code=404, detail=f"Belief '{claim_id}' not found")
    return {"success": True, **belief}



def build_workflow_request_record(
    *,
    name: str,
    steps: List[Any],
    metadata: Optional[JsonDict],
    model_dump_compat_fn: ModelDumpCompatFn,
    build_workflow_record_fn: BuildWorkflowRecordFn,
) -> JsonDict:
    return build_workflow_record_fn(
        name=name,
        steps=[model_dump_compat_fn(step) for step in steps],
        metadata=metadata or {},
    )


async def maybe_sentinel_gate(
    *,
    metadata: Optional[JsonDict],
    workflow_id: str,
    sentinel_preflight_fn: SentinelPreflightFn,
) -> Optional[JsonDict]:
    if (metadata or {}).get("requires_preflight") is not True:
        return None

    def blocked(error: str, *, detail: str, sentinel: Optional[JsonDict] = None) -> JsonDict:
        evidence = sentinel if isinstance(sentinel, dict) else {
            "status": "unavailable" if error == "sentinel_preflight_unavailable" else "malformed",
            "error": detail,
        }
        return {
            "success": False,
            "error": error,
            "detail": detail,
            "sentinel": evidence,
            "workflow_id": workflow_id,
        }

    try:
        gate = await sentinel_preflight_fn()
    except Exception as exc:
        return blocked(
            "sentinel_preflight_unavailable",
            detail=f"{type(exc).__name__}:{exc}"[:300],
        )

    if not isinstance(gate, dict):
        return blocked(
            "sentinel_preflight_malformed",
            detail="preflight response must be an object",
        )
    if gate.get("success") is not True:
        detail = str(gate.get("error") or "preflight response did not report success")[:300]
        return blocked("sentinel_preflight_unavailable", detail=detail)

    scan = gate.get("scan")
    if not isinstance(scan, dict):
        return blocked(
            "sentinel_preflight_malformed",
            detail="successful preflight response is missing a scan object",
        )
    issues_found = scan.get("issues_found")
    if type(issues_found) is not int or issues_found < 0:
        return blocked(
            "sentinel_preflight_malformed",
            detail="scan.issues_found must be a non-negative integer",
            sentinel=scan,
        )
    watchers_checked = scan.get("watchers_checked")
    results = scan.get("results")
    if (
        type(watchers_checked) is not int
        or watchers_checked <= 0
        or not isinstance(results, list)
        or len(results) != watchers_checked
    ):
        return blocked(
            "sentinel_preflight_malformed",
            detail="scan must contain a non-empty result for every checked watcher",
            sentinel=scan,
        )
    for result in results:
        if not isinstance(result, dict) or type(result.get("ok")) is not bool:
            return blocked(
                "sentinel_preflight_malformed",
                detail="every scan result must contain a boolean ok field",
                sentinel=scan,
            )
        try:
            status_code = int(result.get("status_code"))
        except (TypeError, ValueError):
            status_code = 0
        if result.get("ok") is not True or not 0 < status_code < 400:
            if issues_found == 0:
                return blocked(
                    "sentinel_preflight_malformed",
                    detail="scan issue count contradicts an unhealthy result",
                    sentinel=scan,
                )
    if issues_found > 0:
        return blocked(
            "sentinel_gate_failed",
            detail=f"Sentinel reported {issues_found} issue(s)",
            sentinel=scan,
        )
    return None


async def execute_and_persist_workflow(
    workflow: JsonDict,
    *,
    execute_workflow_fn: ExecuteWorkflowFn,
    apply_execution_result_fn: ApplyExecutionResultFn,
    persist_workflow_fn: PersistWorkflowFn,
    max_executions: int,
) -> JsonDict:
    execution = await execute_workflow_fn(workflow)
    apply_execution_result_fn(workflow, execution, max_executions=max_executions)
    persist_workflow_fn(workflow)
    return execution


async def finalize_async_workflow(
    workflow: JsonDict,
    *,
    metadata: Optional[JsonDict],
    sentinel_preflight_fn: SentinelPreflightFn,
    execute_workflow_fn: ExecuteWorkflowFn,
    apply_execution_result_fn: ApplyExecutionResultFn,
    build_blocked_execution_fn: Callable[..., JsonDict],
    build_error_execution_fn: Callable[[Any], JsonDict],
    persist_workflow_fn: PersistWorkflowFn,
    max_executions: int,
) -> None:
    try:
        gate_failure = await maybe_sentinel_gate(
            metadata=metadata,
            workflow_id=str(workflow.get("workflow_id") or ""),
            sentinel_preflight_fn=sentinel_preflight_fn,
        )
        if gate_failure:
            apply_execution_result_fn(
                workflow,
                build_blocked_execution_fn(scan=gate_failure.get("sentinel")),
                max_executions=max_executions,
            )
            persist_workflow_fn(workflow)
            return
        await execute_and_persist_workflow(
            workflow,
            execute_workflow_fn=execute_workflow_fn,
            apply_execution_result_fn=apply_execution_result_fn,
            persist_workflow_fn=persist_workflow_fn,
            max_executions=max_executions,
        )
    except Exception as exc:
        apply_execution_result_fn(
            workflow,
            build_error_execution_fn(exc),
            max_executions=max_executions,
        )
        persist_workflow_fn(workflow)



def workflow_view_or_404(
    workflow_id: str,
    *,
    executions_limit: int,
    load_workflow_fn: LoadWorkflowFn,
    workflow_view_fn: Callable[..., JsonDict],
) -> JsonDict:
    workflow = load_workflow_fn(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' not found")
    return {"success": True, "workflow": workflow_view_fn(workflow, executions_limit=executions_limit)}



def execution_lookup_or_404(
    execution_id: str,
    *,
    list_workflows_fn: ListWorkflowsFn,
    find_execution_fn: Callable[[List[JsonDict], str], Optional[Any]],
) -> JsonDict:
    found = find_execution_fn(list_workflows_fn(), execution_id)
    if not found:
        raise HTTPException(status_code=404, detail=f"Execution '{execution_id}' not found")
    workflow_id, execution = found
    return {"success": True, "workflow_id": workflow_id, "execution": execution}


async def rerun_workflow_or_404(
    workflow_id: str,
    *,
    load_workflow_fn: LoadWorkflowFn,
    execute_workflow_fn: ExecuteWorkflowFn,
    apply_execution_result_fn: ApplyExecutionResultFn,
    persist_workflow_fn: PersistWorkflowFn,
    max_executions: int,
) -> JsonDict:
    workflow = load_workflow_fn(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' not found")
    execution = await execute_and_persist_workflow(
        workflow,
        execute_workflow_fn=execute_workflow_fn,
        apply_execution_result_fn=apply_execution_result_fn,
        persist_workflow_fn=persist_workflow_fn,
        max_executions=max_executions,
    )
    return {
        "success": True,
        "workflow_id": workflow_id,
        "name": workflow["name"],
        "execution": execution,
    }


async def apply_runtime_policy_patch(
    process_id: str,
    *,
    get_runtime_process_fn: GetRuntimeProcessFn,
    explain_runtime_process_fn: ExplainRuntimeProcessFn,
    select_policy_patch_preview_fn: SelectPolicyPatchPreviewFn,
    apply_policy_patch_preview_fn: ApplyPolicyPatchPreviewFn,
    refresh_workflow_policy_fn: RefreshWorkflowPolicyFn,
    replace_process_workflow_fn: ReplaceProcessWorkflowFn,
    requested_settings: Optional[List[str]] = None,
    metadata_overrides: Optional[Dict[str, Any]] = None,
    dry_run: bool = False,
    allow_confirmation_required: bool = False,
    load_workflow_fn: Optional[LoadWorkflowFn] = None,
    persist_workflow_fn: Optional[PersistWorkflowFn] = None,
    audit_context: Optional[JsonDict] = None,
) -> JsonDict:
    process = require_runtime_process(process_id, get_runtime_process_fn=get_runtime_process_fn)
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    explained = await explain_runtime_process_fn(process_id)
    base_preview = explained.get("policy_patch_preview") if isinstance(explained, dict) else {}
    preview = select_policy_patch_preview_fn(
        preview=base_preview if isinstance(base_preview, dict) else {},
        include_settings=requested_settings,
        metadata_overrides=metadata_overrides,
        allow_confirmation_required=allow_confirmation_required,
    )
    patch_application = apply_policy_patch_preview_fn(
        workflow_metadata=workflow.get("metadata") if isinstance(workflow, dict) else {},
        preview=preview if isinstance(preview, dict) else {},
    )
    if dry_run:
        return {
            "success": True,
            "process_id": process_id,
            "applied": False,
            "dry_run": True,
            "request": {"settings": list(requested_settings or []), "metadata_overrides": dict(metadata_overrides or {}), "allow_confirmation_required": bool(allow_confirmation_required)},
            "policy_patch_preview": preview,
            "patch_application": patch_application,
            "process": process,
            "workflow": None,
        }
    if not bool(patch_application.get("applied")):
        return {
            "success": True,
            "process_id": process_id,
            "applied": False,
            "dry_run": False,
            "request": {"settings": list(requested_settings or []), "metadata_overrides": dict(metadata_overrides or {}), "allow_confirmation_required": bool(allow_confirmation_required)},
            "policy_patch_preview": preview,
            "patch_application": patch_application,
            "process": process,
            "workflow": None,
        }

    updated_workflow = dict(workflow)
    updated_workflow["metadata"] = dict(patch_application.get("updated_metadata") or {})
    updated_workflow = refresh_workflow_policy_fn(updated_workflow)
    applied_settings = list(patch_application.get("applied_settings") or [])
    revision_id = f"polrev_{uuid.uuid4().hex[:10]}"
    previous_values = {str(row.get("setting") or ""): row.get("before") for row in applied_settings if str(row.get("setting") or "").strip()}
    metadata_overrides_out = {str(row.get("setting") or ""): row.get("after") for row in applied_settings if str(row.get("setting") or "").strip()}
    updated_process = replace_process_workflow_fn(
        process_id,
        updated_workflow,
        event_kind="policy_patch_applied",
        event_payload={
            "revision_id": revision_id,
            "recommendation_version": preview.get("recommendation_version"),
            "applied_count": patch_application.get("applied_count"),
            "settings": [row.get("setting") for row in applied_settings],
            "applied_settings": applied_settings,
            "metadata_overrides": metadata_overrides_out,
            "previous_values": previous_values,
            "requested_settings": list(requested_settings or []),
            "operator_overrides": dict(metadata_overrides or {}),
            "allow_confirmation_required": bool(allow_confirmation_required),
            "audit": dict(audit_context or {}),
        },
    )

    persisted_workflow = None
    workflow_id = str(((updated_workflow.get("metadata") or {}).get("workflow_id")) or "").strip()
    if workflow_id and load_workflow_fn and persist_workflow_fn:
        stored = load_workflow_fn(workflow_id)
        if isinstance(stored, dict):
            stored = dict(stored)
            stored["metadata"] = dict(updated_workflow.get("metadata") or {})
            stored = refresh_workflow_policy_fn(stored)
            persisted_workflow = persist_workflow_fn(stored)

    return {
        "success": True,
        "process_id": process_id,
        "applied": True,
        "dry_run": False,
        "revision_id": revision_id,
        "request": {"settings": list(requested_settings or []), "metadata_overrides": dict(metadata_overrides or {}), "allow_confirmation_required": bool(allow_confirmation_required)},
        "policy_patch_preview": preview,
        "patch_application": patch_application,
        "process": updated_process,
        "workflow": persisted_workflow,
    }


__all__ = [
    "apply_runtime_policy_patch",
    "build_plan_projection",
    "build_workflow_request_record",
    "execution_lookup_or_404",
    "execute_and_persist_workflow",
    "explain_runtime_process",
    "finalize_async_workflow",
    "maybe_sentinel_gate",
    "require_runtime_process",
    "rerun_workflow_or_404",
    "rollback_runtime_policy_patch",
    "runtime_homeostasis_freeze_control",
    "runtime_homeostasis_resume_control",
    "runtime_homeostasis_rollback_control",
    "runtime_analytics_compare",
    "runtime_analytics_correlation",
    "runtime_analytics_report",
    "runtime_analytics_report_markdown",
    "runtime_analytics_summary",
    "runtime_belief_conflicts",
    "runtime_belief_detail",
    "runtime_belief_lineage",
    "runtime_beliefs",
    "runtime_incident_trends",
    "runtime_policy_explain",
    "runtime_policy_history",
    "runtime_postmortem",
    "runtime_process_action",
    "runtime_process_trace",
    "runtime_process_view",
    "runtime_self_review",
    "schedule_runtime_plan",
    "workflow_view_or_404",
]
