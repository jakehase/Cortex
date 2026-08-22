from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, MutableMapping, Optional, Tuple

import httpx


JsonDict = Dict[str, Any]
WorkflowCache = MutableMapping[str, JsonDict]
StoreGetDocFn = Callable[[str, str], Optional[JsonDict]]
StoreListDocsFn = Callable[[str], List[JsonDict]]
StoreUpsertDocFn = Callable[[str, str, JsonDict], Any]
WorkflowPolicySettingsFn = Callable[[Optional[JsonDict]], JsonDict]
StepBeliefContextFn = Callable[[JsonDict, Optional[JsonDict]], JsonDict]
RecordRuntimeBeliefsFn = Callable[..., List[JsonDict]]
StepIndexForNodeFn = Callable[[JsonDict, str], int]
ExecuteStepWithRetryFn = Callable[..., Awaitable[JsonDict]]
SchedulerTickFn = Callable[..., JsonDict]
GetRuntimeProcessFn = Callable[[str], Optional[JsonDict]]
MarkNodeRunningFn = Callable[[str, str], Any]
RecordNodeResultFn = Callable[[str, str, JsonDict], JsonDict]
UpsertBeliefFn = Callable[..., JsonDict]
CompilePlanToWorkflowFn = Callable[[Any], JsonDict]
CompilePlanToReasoningTaskFn = Callable[..., Any]
ModelDumpCompatFn = Callable[[Any], JsonDict]
BuildWorkflowPolicyFn = Callable[..., JsonDict]


@asynccontextmanager
async def _no_process_execution_fence():
    yield



def db_path(default_db_path: Any) -> Path:
    return Path(str(default_db_path))



def persist_workflow(
    workflow: JsonDict,
    *,
    workflows_cache: WorkflowCache,
    db_path: Path,
    store_upsert_doc_fn: StoreUpsertDocFn,
) -> JsonDict:
    row = dict(workflow or {})
    workflow_id = str(row.get("workflow_id") or "")
    if workflow_id:
        workflows_cache[workflow_id] = row
        store_upsert_doc_fn("workflows", workflow_id, row)
    return row



def load_workflow(
    workflow_id: str,
    *,
    workflows_cache: WorkflowCache,
    db_path: Path,
    store_get_doc_fn: StoreGetDocFn,
) -> Optional[JsonDict]:
    if workflow_id in workflows_cache:
        return dict(workflows_cache[workflow_id])
    row = store_get_doc_fn("workflows", workflow_id)
    if isinstance(row, dict):
        workflows_cache[workflow_id] = dict(row)
        return dict(row)
    return None



def list_workflows(
    *,
    workflows_cache: WorkflowCache,
    db_path: Path,
    store_list_docs_fn: StoreListDocsFn,
) -> List[JsonDict]:
    rows = [dict(row) for row in store_list_docs_fn("workflows") if isinstance(row, dict)]
    if rows:
        workflows_cache.clear()
        for row in rows:
            workflow_id = str(row.get("workflow_id") or "")
            if workflow_id:
                workflows_cache[workflow_id] = dict(row)
        return rows
    return [dict(row) for row in workflows_cache.values()]



def build_workflow_record(
    *,
    name: str,
    steps: List[JsonDict],
    metadata: Optional[JsonDict] = None,
    workflow_id: Optional[str] = None,
    created_at: Optional[str] = None,
) -> JsonDict:
    workflow_id = workflow_id or f"wf_{uuid.uuid4().hex[:12]}"
    workflow_metadata = dict(metadata or {})
    # Approval grants bind the server-issued workflow identity.  Do not rely on
    # caller metadata to repeat or choose that identity.
    workflow_metadata["workflow_id"] = workflow_id
    return {
        "workflow_id": workflow_id,
        "name": name,
        "steps": [dict(step) for step in (steps or [])],
        "metadata": workflow_metadata,
        "created_at": created_at or datetime.now().isoformat(),
        "executions": [],
    }



def refresh_workflow_policy(workflow: JsonDict, *, build_workflow_policy_fn: BuildWorkflowPolicyFn) -> JsonDict:
    updated = dict(workflow or {})
    metadata = dict(updated.get("metadata") or {})
    policy = build_workflow_policy_fn(
        name=str(updated.get("name") or ""),
        goal=str(metadata.get("goal") or ""),
        description=str(metadata.get("description") or ""),
        steps=list(updated.get("steps") or []),
        metadata=metadata,
    )
    metadata["policy"] = policy
    updated["metadata"] = metadata
    if isinstance(updated.get("kernel_task"), dict):
        kernel_task = dict(updated.get("kernel_task") or {})
        kernel_task.setdefault("metadata", {})["policy"] = policy
        kernel_task["policy_decisions"] = list(policy.get("decisions") or [])
        kernel_task["belief_influence_ids"] = list(policy.get("belief_influence_ids") or [])
        updated["kernel_task"] = kernel_task
    return updated



def build_workflow_from_plan(
    graph: Any,
    *,
    compile_plan_to_workflow_fn: CompilePlanToWorkflowFn,
    compile_plan_to_reasoning_task_fn: CompilePlanToReasoningTaskFn,
    model_dump_compat_fn: ModelDumpCompatFn,
    build_workflow_policy_fn: BuildWorkflowPolicyFn,
) -> JsonDict:
    workflow_def = compile_plan_to_workflow_fn(graph)
    workflow_id = f"wf_{uuid.uuid4().hex[:12]}"
    kernel_task_payload = model_dump_compat_fn(
        compile_plan_to_reasoning_task_fn(
            graph,
            task_id=f"task_{workflow_id}",
            owner=str((graph.metadata or {}).get("owner") or "cortex"),
            session_key=(graph.metadata or {}).get("session_key"),
            archetype=(graph.metadata or {}).get("archetype"),
        )
    )
    workflow_metadata = dict(workflow_def.get("metadata") or {})
    workflow_metadata["workflow_id"] = workflow_id
    workflow_metadata["kernel_task_id"] = kernel_task_payload.get("task_id")
    workflow_metadata["task_id"] = kernel_task_payload.get("task_id")
    workflow = {
        "workflow_id": workflow_id,
        "name": workflow_def["name"],
        "steps": workflow_def["steps"],
        "metadata": workflow_metadata,
        "created_at": datetime.now().isoformat(),
        "executions": [],
        "plan_graph": workflow_def.get("metadata", {}).get("plan_graph"),
        "kernel_task": kernel_task_payload,
    }
    return refresh_workflow_policy(workflow, build_workflow_policy_fn=build_workflow_policy_fn)



def apply_execution_result(workflow: JsonDict, execution: JsonDict, *, max_executions: int) -> JsonDict:
    workflow.setdefault("executions", []).append(execution)
    if len(workflow["executions"]) > max_executions:
        workflow["executions"] = workflow["executions"][-max_executions:]
    workflow["last_status"] = execution.get("status")
    workflow["last_run"] = execution.get("completed_at")
    return workflow



def build_blocked_execution(*, scan: JsonDict) -> JsonDict:
    now = datetime.now().isoformat()
    return {
        "execution_id": f"exec_{uuid.uuid4().hex[:8]}",
        "status": "blocked",
        "started_at": now,
        "completed_at": now,
        "steps": [],
        "total_steps": 0,
        "successful_steps": 0,
        "sentinel": scan,
    }



def build_error_execution(error: Any) -> JsonDict:
    now = datetime.now().isoformat()
    return {
        "execution_id": f"exec_{uuid.uuid4().hex[:8]}",
        "status": "error",
        "error": str(error)[:300],
        "started_at": now,
        "completed_at": now,
        "steps": [],
        "total_steps": 0,
        "successful_steps": 0,
    }



def workflow_summary_items(workflows: List[JsonDict]) -> List[JsonDict]:
    items: List[JsonDict] = []
    for wf in workflows:
        wf_id = str(wf.get("workflow_id") or "")
        items.append(
            {
                "workflow_id": wf_id,
                "name": wf["name"],
                "steps_count": len(wf["steps"]),
                "executions_count": len(wf["executions"]),
                "last_status": wf.get("last_status", "never_run"),
                "last_run": wf.get("last_run"),
                "created_at": wf["created_at"],
            }
        )
    return items



def workflow_view(workflow: JsonDict, *, executions_limit: int) -> JsonDict:
    wf_view = dict(workflow)
    wf_view["executions"] = list(workflow.get("executions", []))[-executions_limit:] if executions_limit else []
    return wf_view



def find_execution(workflows: List[JsonDict], execution_id: str) -> Optional[Tuple[str, JsonDict]]:
    for wf in workflows:
        for execution in wf.get("executions", []):
            if execution.get("execution_id") == execution_id:
                return str(wf.get("workflow_id") or ""), execution
    return None



def step_index_for_node(workflow: JsonDict, node_id: str) -> int:
    for idx, step in enumerate(workflow.get("steps") or [], start=1):
        if str((step or {}).get("node_id") or f"step_{idx}") == str(node_id):
            return idx
    return 1



def record_runtime_beliefs(
    *,
    process_id: str,
    task_id: Optional[str],
    node_id: str,
    step_result: JsonDict,
    upsert_belief_fn: UpsertBeliefFn,
    scope: Optional[JsonDict] = None,
) -> List[JsonDict]:
    subject = f"process:{process_id}:node:{node_id}"
    created: List[JsonDict] = []
    created.append(
        upsert_belief_fn(
            subject=subject,
            predicate="status",
            value="completed" if bool(step_result.get("success")) else "failed",
            confidence=0.98,
            freshness=0.95,
            kind="observed",
            task_id=task_id,
            source_type="runtime_execution",
            source_ref=node_id,
            note="node execution result",
            metadata={"process_id": process_id, "node_id": node_id, "source_execution": "runtime"},
            scope=scope,
        )
    )
    if step_result.get("status_code") is not None:
        created.append(
            upsert_belief_fn(
                subject=subject,
                predicate="http_status",
                value=int(step_result.get("status_code") or 0),
                confidence=0.98,
                freshness=0.95,
                kind="observed",
                task_id=task_id,
                source_type="runtime_execution",
                source_ref=node_id,
                note="http status from node execution",
                metadata={"process_id": process_id, "node_id": node_id, "source_execution": "runtime"},
                scope=scope,
            )
        )
    if step_result.get("error"):
        created.append(
            upsert_belief_fn(
                subject=subject,
                predicate="error",
                value=str(step_result.get("error")),
                confidence=0.9,
                freshness=0.9,
                kind="observed",
                task_id=task_id,
                source_type="runtime_execution",
                source_ref=node_id,
                note="execution error",
                metadata={"process_id": process_id, "node_id": node_id, "source_execution": "runtime"},
                conflict_mode="contradict",
                scope=scope,
            )
        )
    return created


async def execute_runtime_batch(
    *,
    limit: int = 25,
    now_iso: Optional[str] = None,
    scheduler_tick_fn: SchedulerTickFn,
    get_runtime_process_fn: GetRuntimeProcessFn,
    mark_node_running_fn: MarkNodeRunningFn,
    execute_step_with_retry_fn: ExecuteStepWithRetryFn,
    step_index_for_node_fn: StepIndexForNodeFn,
    step_belief_context_fn: StepBeliefContextFn,
    record_runtime_beliefs_fn: RecordRuntimeBeliefsFn,
    record_node_result_fn: RecordNodeResultFn,
    workflow_policy_settings_fn: WorkflowPolicySettingsFn,
    scheduler_error_cls: type[Exception],
    process_execution_fence_fn: Optional[Callable[[str], Any]] = None,
) -> JsonDict:
    executed: List[JsonDict] = []
    remaining = max(0, int(limit))
    initial = scheduler_tick_fn(now_iso=now_iso, limit=remaining or 1)
    if remaining <= 0 or not list(initial.get("runnable") or []):
        return {"tick": initial, "executed": executed, "executed_count": 0}

    async with httpx.AsyncClient(timeout=30.0) as client:
        while remaining > 0:
            tick = scheduler_tick_fn(now_iso=now_iso, limit=remaining)
            runnable = list(tick.get("runnable") or [])
            if not runnable:
                final_tick = tick
                break
            item = runnable[0]
            process_id = str(item.get("process_id") or "")
            node_id = str(item.get("node_id") or "")
            process = get_runtime_process_fn(process_id)
            if not process:
                remaining -= 1
                continue
            workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
            steps = workflow.get("steps") if isinstance(workflow.get("steps"), list) else []
            step = next((dict(s) for s in steps if str((s or {}).get("node_id") or "") == node_id), None)
            if not step:
                remaining -= 1
                continue
            try:
                fence = process_execution_fence_fn(process_id) if process_execution_fence_fn is not None else _no_process_execution_fence()
                async with fence:
                    # Reload only after the rollback fence is owned. A tick
                    # selected before rollback must not execute stale work.
                    process = get_runtime_process_fn(process_id)
                    if not process:
                        remaining -= 1
                        continue
                    current_nodes = process.get("nodes")
                    current_node = ((current_nodes or {}).get(node_id) or {})
                    if isinstance(current_nodes, dict) and str(current_node.get("status") or "") != "ready":
                        remaining -= 1
                        continue
                    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
                    steps = workflow.get("steps") if isinstance(workflow.get("steps"), list) else []
                    step = next((dict(s) for s in steps if str((s or {}).get("node_id") or "") == node_id), None)
                    if not step:
                        remaining -= 1
                        continue
                    mark_node_running_fn(process_id, node_id)
                    refreshed = get_runtime_process_fn(process_id) or process
                    results_by_node = dict(refreshed.get("results_by_node") or {})
                    step_result = await execute_step_with_retry_fn(
                        client,
                        step,
                        step_index=step_index_for_node_fn(workflow, node_id),
                        results_by_node=results_by_node,
                        workflow_metadata=workflow.get("metadata") or {},
                    )
                    if not isinstance(step_result.get("belief_context"), dict):
                        backfilled_context = step_belief_context_fn(step, workflow.get("metadata") or {})
                        step_result["belief_context"] = {
                            "task_id": backfilled_context.get("task_id"),
                            "selected_ids": backfilled_context.get("selected_ids"),
                            "selected_count": len(backfilled_context.get("selected_ids") or []),
                            "filters": backfilled_context.get("filters"),
                        }
                    produced_beliefs = record_runtime_beliefs_fn(
                        process_id=process_id,
                        task_id=(process.get("task_id") or refreshed.get("task_id")),
                        node_id=node_id,
                        step_result=step_result,
                        workflow_metadata=workflow.get("metadata") or {},
                    )
                    step_result["produced_belief_ids"] = [
                        str(row.get("claim_id") or "") for row in produced_beliefs if str(row.get("claim_id") or "").strip()
                    ]
                    step_result["produced_belief_count"] = len(step_result["produced_belief_ids"])
                    record_node_result_fn(process_id, node_id, step_result)
                    executed.append({"process_id": process_id, "node_id": node_id, "result": step_result})
            except scheduler_error_cls as exc:
                executed.append({"process_id": process_id, "node_id": node_id, "result": {"success": False, "error": str(exc)}})
            remaining -= 1
            process_policy = workflow_policy_settings_fn(workflow.get("metadata") or {})
            if not bool(process_policy.get("enforce_policy", True)):
                break
            if not bool(process_policy.get("same_tick_drain", True)):
                break
        else:
            final_tick = scheduler_tick_fn(now_iso=now_iso, limit=max(1, int(limit)))
    if "final_tick" not in locals():
        final_tick = scheduler_tick_fn(now_iso=now_iso, limit=max(1, int(limit)))
    return {"tick": final_tick, "executed": executed, "executed_count": len(executed)}


__all__ = [
    "apply_execution_result",
    "build_blocked_execution",
    "build_error_execution",
    "build_workflow_from_plan",
    "build_workflow_record",
    "refresh_workflow_policy",
    "db_path",
    "execute_runtime_batch",
    "find_execution",
    "list_workflows",
    "load_workflow",
    "persist_workflow",
    "record_runtime_beliefs",
    "step_index_for_node",
    "workflow_summary_items",
    "workflow_view",
]
