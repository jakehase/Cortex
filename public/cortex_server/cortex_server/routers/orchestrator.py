"""
Level 26: The Orchestrator / Conductor — Real Workflow Execution

Coordinates multi-level workflows by accepting step definitions, executing
them sequentially via async HTTP, and storing results for replay.

NOTE: This is L26 Workflow Conductor, NOT L36 Meta-Conductor.
"""
from __future__ import annotations
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
    record_process_event as record_runtime_event,
    record_node_result,
    replace_process_workflow,
    resume_process as resume_runtime_process,
    runtime_status as get_runtime_status,
    scheduler_tick as reasoning_scheduler_tick,
    sync_process_progress,
    wake_process as wake_runtime_process,
)
from cortex_server.runtime import (
    AgentMailbox,
    AgentSupervisor,
    ProcessJournal,
    ProcessSnapshot,
    ProcessSnapshotStore,
    ProductionBuildContract,
    ProductionBuildLoopReport,
    ProductionBuildLoopState,
    ProductionBuildLoopStore,
    ReleaseWorkflowState,
    ReleaseWorkflowStore,
    RoadmapExecutionStore,
    RoadmapObjectiveContract,
    SharedProcessState,
    SharedProcessStateStore,
    apply_release_rollback_restore,
    capture_release_rollback_fencepost,
    detect_true_blockers,
    evaluate_production_completion,
    record_release_fencepost,
    reconcile_production_build_loop,
    reconcile_roadmap_execution,
)

router = APIRouter()

# ── In-memory state ────────────────────────────────────────────────────────
DEFAULT_DB_PATH = Path("/opt/clawdbot/state/reasoning_runtime.db")
RUNTIME_DELIVERY_ROOT = Path(os.getenv("ORCHESTRATOR_RUNTIME_DELIVERY_ROOT", "/opt/clawdbot/state/runtime_delivery"))
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



def _runtime_delivery_root() -> Path:
    return Path(str(RUNTIME_DELIVERY_ROOT))



def _runtime_delivery_stores() -> Dict[str, Any]:
    root = _runtime_delivery_root()
    return {
        "root": root,
        "snapshot_store": ProcessSnapshotStore(root / "snapshots"),
        "shared_state_store": SharedProcessStateStore(root / "shared_state"),
        "journal": ProcessJournal(root / "journal.jsonl"),
        "mailbox": AgentMailbox(root / "mailbox.json"),
        "supervisor": AgentSupervisor(root / "leases.json"),
        "release_store": ReleaseWorkflowStore(root / "release_workflow"),
        "loop_store": ProductionBuildLoopStore(root / "production_build_loop"),
        "roadmap_store": RoadmapExecutionStore(root / "roadmap_executor"),
    }



def _parse_optional_dt(value: Optional[str]) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    return datetime.fromisoformat(text.replace("Z", "+00:00"))



def _validate_production_contract(payload: Dict[str, Any]) -> ProductionBuildContract:
    if hasattr(ProductionBuildContract, "model_validate"):
        return ProductionBuildContract.model_validate(payload)
    return ProductionBuildContract.parse_obj(payload)



def _validate_roadmap_contract(payload: Dict[str, Any]) -> RoadmapObjectiveContract:
    if hasattr(RoadmapObjectiveContract, "model_validate"):
        return RoadmapObjectiveContract.model_validate(payload)
    return RoadmapObjectiveContract.parse_obj(payload)



def _bootstrap_runtime_delivery_state(process_id: str, *, process: Dict[str, Any], stores: Dict[str, Any]) -> Dict[str, Any]:
    snapshot_store = stores["snapshot_store"]
    shared_state_store = stores["shared_state_store"]
    journal = stores["journal"]

    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    nodes = process.get("nodes") if isinstance(process.get("nodes"), dict) else {}
    owner = str(process.get("owner") or metadata.get("owner") or "cortex").strip() or "cortex"

    active_steps = [node_id for node_id, row in nodes.items() if isinstance(row, dict) and str(row.get("status") or "") in {"running", "ready"}]
    waiting_steps = [node_id for node_id, row in nodes.items() if isinstance(row, dict) and str(row.get("status") or "") in {"pending", "scheduled", "waiting"}]
    completed_steps = [node_id for node_id, row in nodes.items() if isinstance(row, dict) and str(row.get("status") or "") == "completed"]
    failed_steps = [node_id for node_id, row in nodes.items() if isinstance(row, dict) and str(row.get("status") or "") in {"failed", "cancelled"}]
    if str(process.get("status") or "") == "completed":
        lifecycle_state = "completed"
    elif str(process.get("status") or "") in {"failed", "cancelled"}:
        lifecycle_state = "failed"
    elif active_steps:
        lifecycle_state = "running"
    else:
        lifecycle_state = "waiting"
    assigned_agents = {node_id: owner for node_id in active_steps + waiting_steps}

    shared_state = shared_state_store.load(process_id)
    if shared_state is None:
        revision_id = str(metadata.get("delivery_revision_id") or metadata.get("revision_id") or f"runtime_{process_id}_r1").strip()
        shared_state = shared_state_store.save(
            SharedProcessState(
                process_id=process_id,
                revision_id=revision_id,
                goals=[str(workflow.get("name") or f"Drive {process_id} to completion")],
                active_plan_node_ids=active_steps + waiting_steps,
                runtime_constraints=dict(((metadata.get("policy") or {}).get("settings") or {})),
                world_state={
                    "process_status": str(process.get("status") or lifecycle_state),
                    "workflow_name": str(workflow.get("name") or "runtime_workflow"),
                },
                belief_refs=[],
                open_questions=[],
                agent_ownership=dict(assigned_agents),
                metadata={"bootstrapped_from_runtime_process": True},
            ),
            actor="runtime_delivery_bootstrap",
            provenance={"source": "orchestrator_runtime_process"},
        )

    snapshot = snapshot_store.load(process_id)
    if snapshot is None:
        latest_event = journal.latest(process_id=process_id)
        if latest_event is None:
            latest_event = journal.append(
                process_id=process_id,
                kind="runtime_delivery_bootstrap",
                revision_id=shared_state.revision_id,
                actor="runtime_delivery_bootstrap",
                payload={"workflow_name": workflow.get("name"), "process_status": process.get("status")},
            )
        snapshot = snapshot_store.save(
            ProcessSnapshot(
                process_id=process_id,
                last_event_id=latest_event.event_id,
                event_count=max(1, len(journal.load(process_id=process_id))),
                lifecycle_state=lifecycle_state,
                active_steps=active_steps,
                waiting_steps=waiting_steps,
                completed_steps=completed_steps,
                failed_steps=failed_steps,
                assigned_agents=assigned_agents,
                runtime_policy=dict(((metadata.get("policy") or {}).get("settings") or {})),
                world_state={**dict(shared_state.world_state), "process_status": str(process.get("status") or lifecycle_state)},
                belief_refs=list(shared_state.belief_refs),
                artifact_refs=[],
                metadata={"bootstrapped_from_runtime_process": True},
            )
        )
    return {"snapshot": snapshot, "shared_state": shared_state}



def _ensure_runtime_release_state(
    process_id: str,
    *,
    process: Dict[str, Any],
    contract: ProductionBuildContract,
    stores: Dict[str, Any],
    request: RuntimeDeliveryReconcileRequest,
) -> ReleaseWorkflowState:
    release_store = stores["release_store"]
    existing = release_store.load(process_id)
    if existing is not None:
        return existing

    snapshot = stores["snapshot_store"].load(process_id)
    shared_state = stores["shared_state_store"].load(process_id)
    if snapshot is None or shared_state is None:
        raise HTTPException(status_code=400, detail=f"runtime delivery state not initialized for {process_id}")

    contract_metadata = dict(contract.metadata or {})
    initial_stage = str(
        request.initial_release_stage
        or contract_metadata.get("initial_release_stage")
        or shared_state.world_state.get("release_stage")
        or snapshot.world_state.get("release_stage")
        or "draft"
    ).strip() or "draft"
    candidate_ref = str(
        request.candidate_ref
        or contract_metadata.get("candidate_ref")
        or f"runtime:{process_id}:{shared_state.revision_id}"
    ).strip()
    state = ReleaseWorkflowState(
        process_id=process_id,
        candidate_ref=candidate_ref,
        target_environment=contract.target_environment,
        revision_id=shared_state.revision_id,
        current_stage=initial_stage,
        status="preparing",
        metadata={"bootstrapped_from_runtime_process": True},
    )
    if initial_stage and initial_stage != "draft":
        state = record_release_fencepost(
            state,
            capture_release_rollback_fencepost(
                snapshot=snapshot,
                shared_state=shared_state,
                stage=initial_stage,
                metadata={"bootstrapped_from_runtime_process": True},
            ),
        )
    return release_store.save(state, actor=request.controller_id, provenance={"source": "runtime_delivery_bootstrap_release"})



def _resolve_runtime_delivery_contract(
    process_id: str,
    *,
    process: Dict[str, Any],
    stores: Dict[str, Any],
    request: RuntimeDeliveryReconcileRequest,
) -> ProductionBuildContract:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    workflow_contract = metadata.get("production_build_loop") if isinstance(metadata.get("production_build_loop"), dict) else {}
    stored_contract = stores["loop_store"].load_contract(process_id)

    payload: Dict[str, Any] = {}
    if stored_contract is not None:
        payload.update(model_dump_compat(stored_contract))
    elif workflow_contract:
        payload.update(dict(workflow_contract))
    if isinstance(request.contract, dict):
        payload.update(dict(request.contract))

    payload["process_id"] = process_id
    payload.setdefault("objective", str(workflow.get("name") or request.objective or f"Drive {process_id} to production"))
    if request.objective:
        payload["objective"] = request.objective
    if request.target_environment:
        payload["target_environment"] = request.target_environment
    if request.promotion_stages is not None:
        payload["promotion_stages"] = list(request.promotion_stages)
    if request.stage_gates is not None:
        payload["stage_gates"] = list(request.stage_gates)
    if request.completion_criteria is not None:
        payload["completion_criteria"] = list(request.completion_criteria)
    if request.blocker_rules is not None:
        payload["blocker_rules"] = list(request.blocker_rules)
    if request.dependability_profile is not None:
        payload["dependability_profile"] = request.dependability_profile
    if request.execution_budget is not None:
        payload["execution_budget"] = dict(request.execution_budget)
    payload.setdefault("dependability_profile", "24h")

    merged_metadata = dict(payload.get("metadata") or {})
    merged_metadata.update(dict(request.metadata or {}))
    if request.initial_release_stage:
        merged_metadata["initial_release_stage"] = request.initial_release_stage
    if request.candidate_ref:
        merged_metadata["candidate_ref"] = request.candidate_ref
    payload["metadata"] = merged_metadata
    return _validate_production_contract(payload)



def _runtime_delivery_projection(
    *,
    contract: Optional[ProductionBuildContract],
    loop_state: Optional[ProductionBuildLoopState],
    release_state: Optional[ReleaseWorkflowState],
    snapshot: Optional[ProcessSnapshot],
    shared_state: Optional[SharedProcessState],
    latest_report: Optional[ProductionBuildLoopReport],
) -> Dict[str, Any]:
    completion = dict(loop_state.completion or {}) if loop_state is not None else {}
    metadata = dict(loop_state.metadata or {}) if loop_state is not None else {}
    latest_report_metadata = dict(latest_report.metadata or {}) if latest_report is not None else {}
    return {
        "contract_id": contract.contract_id if contract is not None else None,
        "objective": contract.objective if contract is not None else None,
        "target_environment": contract.target_environment if contract is not None else None,
        "loop_id": loop_state.loop_id if loop_state is not None else None,
        "loop_status": loop_state.status if loop_state is not None else None,
        "liveness": loop_state.liveness if loop_state is not None else None,
        "terminal_state": loop_state.terminal_state if loop_state is not None else None,
        "loop_iteration": int(loop_state.iteration_count or 0) if loop_state is not None else 0,
        "loop_checkpoint_count": int(loop_state.checkpoint_count or 0) if loop_state is not None else 0,
        "loop_recovery_count": int(loop_state.recovery_count or 0) if loop_state is not None else 0,
        "release_id": release_state.release_id if release_state is not None else None,
        "release_stage": release_state.current_stage if release_state is not None else None,
        "release_status": release_state.status if release_state is not None else None,
        "shared_state_revision_id": shared_state.revision_id if shared_state is not None else None,
        "snapshot_id": snapshot.snapshot_id if snapshot is not None else None,
        "snapshot_lifecycle_state": snapshot.lifecycle_state if snapshot is not None else None,
        "latest_report_id": latest_report.report_id if latest_report is not None else None,
        "latest_report_kind": latest_report.kind if latest_report is not None else None,
        "latest_report_status": latest_report.status if latest_report is not None else None,
        "last_progress_at": loop_state.last_progress_at if loop_state is not None else None,
        "last_report_at": loop_state.last_report_at if loop_state is not None else None,
        "next_review_at": loop_state.next_review_at if loop_state is not None else None,
        "true_blocker_count": len(loop_state.true_blockers) if loop_state is not None else 0,
        "completion_ready": bool(completion.get("all_required_satisfied")) if completion else None,
        "continuation": dict(loop_state.continuation or {}) if loop_state is not None else {},
        "next_action": dict(loop_state.next_action or {}) if loop_state is not None else {},
        "last_pass": dict(loop_state.last_pass or {}) if loop_state is not None else {},
        "last_progress": dict(loop_state.last_progress or {}) if loop_state is not None else {},
        "last_report": dict(loop_state.last_report or {}) if loop_state is not None else {},
        "owed_follow_up": dict(loop_state.owed_follow_up or {}) if loop_state is not None else {},
        "reporting_cadence": dict(loop_state.reporting_cadence or {}) if loop_state is not None else {},
        "last_watchdog_decision": dict(loop_state.last_watchdog_decision or {}) if loop_state is not None else {},
        "execution_budget": model_dump_compat(contract.execution_budget) if contract is not None and getattr(contract, "execution_budget", None) is not None else None,
        "reporting_policy": model_dump_compat(contract.checkpoint_policy) if contract is not None and getattr(contract, "checkpoint_policy", None) is not None else None,
        "execution_discipline": dict(metadata.get("execution_discipline") or {}),
        "validation_policy": dict(metadata.get("validation_policy") or {}),
        "blocker_policy": dict(metadata.get("blocker_policy") or {}),
        "latest_decisions": dict((metadata.get("execution_discipline") or {}).get("latest_decisions") or {}),
        "latest_report_reasons": list(latest_report_metadata.get("reasons") or []),
    }



def _sync_runtime_process_delivery_state(
    process_id: str,
    *,
    process: Dict[str, Any],
    stores: Dict[str, Any],
    event_kind: str,
    event_payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    snapshot = stores["snapshot_store"].load(process_id)
    shared_state = stores["shared_state_store"].load(process_id)
    contract = stores["loop_store"].load_contract(process_id)
    loop_state = stores["loop_store"].load_state(process_id)
    release_state = stores["release_store"].load(process_id)
    reports = stores["loop_store"].reports(process_id)
    latest_report = reports[-1] if reports else None

    if snapshot is not None:
        process = sync_process_progress(
            process_id,
            lifecycle_state=snapshot.lifecycle_state,
            active_nodes=snapshot.active_steps,
            waiting_nodes=snapshot.waiting_steps,
            completed_nodes=snapshot.completed_steps,
            failed_nodes=snapshot.failed_steps,
            enabled=(snapshot.lifecycle_state != "failed"),
            event_kind=f"{event_kind}.progress",
            event_payload={
                **dict(event_payload or {}),
                "snapshot_id": snapshot.snapshot_id,
                "shared_state_revision_id": shared_state.revision_id if shared_state is not None else None,
            },
        )

    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = dict(workflow.get("metadata") or {})
    desired_metadata = dict(metadata)
    desired_metadata["runtime_delivery"] = _runtime_delivery_projection(
        contract=contract,
        loop_state=loop_state,
        release_state=release_state,
        snapshot=snapshot,
        shared_state=shared_state,
        latest_report=latest_report,
    )
    if release_state is not None:
        desired_metadata["release_stage"] = release_state.current_stage
        desired_metadata["release_status"] = release_state.status
    if shared_state is not None:
        desired_metadata["delivery_revision_id"] = shared_state.revision_id
    if loop_state is not None:
        desired_metadata["delivery_continuation_mode"] = loop_state.continuation.get("mode") if isinstance(loop_state.continuation, dict) else None
    if contract is not None:
        desired_metadata["production_build_loop"] = model_dump_compat(contract)

    if desired_metadata != metadata:
        process = replace_process_workflow(
            process_id,
            {
                "name": workflow.get("name"),
                "metadata": desired_metadata,
                "steps": list(workflow.get("steps") or []),
            },
            event_kind=event_kind,
            event_payload=dict(event_payload or {}),
        )
    elif event_kind:
        process = record_runtime_event(process_id, event_kind, dict(event_payload or {}))
    refreshed = get_runtime_process(process_id)
    return refreshed or process



def _checkpoint_runtime_delivery_rollback(
    process_id: str,
    *,
    contract: Optional[ProductionBuildContract],
    stores: Dict[str, Any],
    release_state: ReleaseWorkflowState,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    actor: str,
    reason: str,
    rollback_fencepost_id: Optional[str],
) -> Optional[Dict[str, Any]]:
    if contract is None:
        return None
    loop_store = stores["loop_store"]
    current = loop_store.load_state(process_id)
    blockers = detect_true_blockers(contract, snapshot=snapshot, shared_state=shared_state, release_state=release_state)
    completion = evaluate_production_completion(
        contract,
        snapshot=snapshot,
        shared_state=shared_state,
        release_state=release_state,
    )
    status = "completed" if completion.get("all_required_satisfied") and not blockers else ("blocked" if blockers else "active")
    existing = current or ProductionBuildLoopState(contract_id=contract.contract_id, process_id=process_id)
    iteration = int(existing.iteration_count or 0) + 1
    report = loop_store.append_report(
        ProductionBuildLoopReport(
            loop_id=existing.loop_id,
            contract_id=contract.contract_id,
            process_id=process_id,
            iteration=iteration,
            kind="rollback",
            status=status,
            summary=f"Release rollback applied to {release_state.current_stage} for {process_id}",
            controller_id=actor,
            controller_session_id=f"runtime-delivery-rollback:{process_id}",
            stage=release_state.current_stage,
            actions_taken=[
                {
                    "action": "rollback_runtime_delivery",
                    "reason": reason,
                    "fencepost_id": rollback_fencepost_id,
                    "revision_id": shared_state.revision_id,
                    "snapshot_id": snapshot.snapshot_id,
                }
            ],
            blockers=blockers,
            completion=completion,
            metadata={
                "rollback_reason": reason,
                "rollback_fencepost_id": rollback_fencepost_id,
                "shared_state_revision_id": shared_state.revision_id,
                "snapshot_id": snapshot.snapshot_id,
            },
        )
    )
    updated = loop_store.save_state(
        ProductionBuildLoopState(
            loop_id=existing.loop_id,
            contract_id=contract.contract_id,
            process_id=process_id,
            status=status,
            iteration_count=iteration,
            checkpoint_count=int(existing.checkpoint_count or 0) + 1,
            recovery_count=int(existing.recovery_count or 0),
            controller=existing.controller,
            current_revision_id=shared_state.revision_id,
            current_snapshot_id=snapshot.snapshot_id,
            current_stage=release_state.current_stage,
            latest_report_id=report.report_id,
            last_checkpoint_at=report.recorded_at,
            true_blockers=blockers,
            completion=completion,
            metadata={
                **dict(existing.metadata or {}),
                "last_runtime_delivery_event": "rollback",
                "last_rollback_reason": reason,
                "last_rollback_fencepost_id": rollback_fencepost_id,
            },
        )
    )
    return {"state": updated, "report": report}



def _runtime_delivery_status_payload(process_id: str, *, process: Dict[str, Any], stores: Dict[str, Any]) -> Dict[str, Any]:
    snapshot = stores["snapshot_store"].load(process_id)
    shared_state = stores["shared_state_store"].load(process_id)
    contract = stores["loop_store"].load_contract(process_id)
    loop_state = stores["loop_store"].load_state(process_id)
    release_state = stores["release_store"].load(process_id)
    reports = stores["loop_store"].reports(process_id)
    latest_report = reports[-1] if reports else None
    return {
        "success": True,
        "process_id": process_id,
        "process": process,
        "contract": model_dump_compat(contract) if contract is not None else None,
        "loop_state": model_dump_compat(loop_state) if loop_state is not None else None,
        "release_state": model_dump_compat(release_state) if release_state is not None else None,
        "snapshot": model_dump_compat(snapshot) if snapshot is not None else None,
        "shared_state": model_dump_compat(shared_state) if shared_state is not None else None,
        "report_count": len(reports),
        "latest_report": model_dump_compat(latest_report) if latest_report is not None else None,
        "recent_reports": [model_dump_compat(report) for report in reports[-5:]],
    }



def _default_roadmap_tasks(process: Dict[str, Any]) -> Dict[str, Any]:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    steps = list(workflow.get("steps") or [])
    phase_id = "runtime_workflow"
    tasks: List[Dict[str, Any]] = []
    for index, step in enumerate(steps):
        if not isinstance(step, dict):
            continue
        task_id = str(step.get("node_id") or f"step_{index + 1}").strip() or f"step_{index + 1}"
        metadata = step.get("metadata") if isinstance(step.get("metadata"), dict) else {}
        tasks.append(
            {
                "task_id": task_id,
                "phase_id": phase_id,
                "title": str(step.get("title") or task_id).strip() or task_id,
                "summary": str(step.get("payload", {}).get("message") or step.get("endpoint") or task_id),
                "work_type": str(metadata.get("work_type") or "feature").strip() or "feature",
                "depends_on": list(step.get("depends_on") or []),
                "success_criteria": list(step.get("success_criteria") or []),
                "quality_gates": [{
                    "criterion_id": f"runtime-node:{task_id}",
                    "summary": f"Runtime node {task_id} must complete",
                    "kind": "runtime_node_completed",
                    "task_id": task_id,
                }],
                "metadata": dict(metadata),
            }
        )
    phases = [
        {
            "phase_id": phase_id,
            "title": str(workflow.get("name") or "Runtime workflow roadmap").strip() or "Runtime workflow roadmap",
            "summary": "Derived from runtime workflow steps",
        }
    ] if tasks else []
    return {"phases": phases, "tasks": tasks}



def _resolve_runtime_roadmap_contract(
    process_id: str,
    *,
    process: Dict[str, Any],
    stores: Dict[str, Any],
    request: RuntimeRoadmapReconcileRequest,
) -> RoadmapObjectiveContract:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    workflow_contract = metadata.get("roadmap_executor") if isinstance(metadata.get("roadmap_executor"), dict) else {}
    stored_contract = stores["roadmap_store"].load_contract(process_id)

    payload: Dict[str, Any] = {}
    if stored_contract is not None:
        payload.update(model_dump_compat(stored_contract))
    elif workflow_contract:
        payload.update(dict(workflow_contract))
    if isinstance(request.contract, dict):
        payload.update(dict(request.contract))

    payload["process_id"] = process_id
    payload.setdefault("objective", str(workflow.get("name") or request.objective or f"Drive {process_id} to roadmap completion"))
    if request.objective:
        payload["objective"] = request.objective
    if request.success_criteria is not None:
        payload["success_criteria"] = list(request.success_criteria)
    if request.phases is not None:
        payload["phases"] = list(request.phases)
    if request.tasks is not None:
        payload["tasks"] = list(request.tasks)
    if request.blocker_rules is not None:
        payload["blocker_rules"] = list(request.blocker_rules)
    if request.dependability_profile is not None:
        payload["dependability_profile"] = request.dependability_profile
    if request.reporting_policy is not None:
        payload["reporting_policy"] = dict(request.reporting_policy)
    if request.execution_budget is not None:
        payload["execution_budget"] = dict(request.execution_budget)
    payload.setdefault("dependability_profile", "24h")

    if not payload.get("phases") and not payload.get("tasks"):
        derived = _default_roadmap_tasks(process)
        payload["phases"] = derived["phases"]
        payload["tasks"] = derived["tasks"]

    merged_metadata = dict(payload.get("metadata") or {})
    merged_metadata.update(dict(request.metadata or {}))
    payload["metadata"] = merged_metadata
    return _validate_roadmap_contract(payload)



def _runtime_roadmap_projection(
    *,
    contract: Optional[RoadmapObjectiveContract],
    state: Optional[Dict[str, Any]],
    latest_report: Optional[Dict[str, Any]],
    snapshot: Optional[ProcessSnapshot],
    shared_state: Optional[SharedProcessState],
) -> Dict[str, Any]:
    completion = dict((state or {}).get("completion") or {})
    metadata = dict((state or {}).get("metadata") or {})
    latest_report_metadata = dict((latest_report or {}).get("metadata") or {})
    return {
        "objective_id": contract.objective_id if contract is not None else None,
        "objective": contract.objective if contract is not None else None,
        "status": (state or {}).get("status"),
        "liveness": (state or {}).get("liveness"),
        "terminal_state": (state or {}).get("terminal_state"),
        "iteration_count": int((state or {}).get("iteration_count", 0) or 0),
        "checkpoint_count": int((state or {}).get("checkpoint_count", 0) or 0),
        "recovery_count": int((state or {}).get("recovery_count", 0) or 0),
        "active_phase_id": (state or {}).get("active_phase_id"),
        "active_task_ids": list((state or {}).get("active_task_ids") or []),
        "current_revision_id": shared_state.revision_id if shared_state is not None else None,
        "current_snapshot_id": snapshot.snapshot_id if snapshot is not None else None,
        "latest_report_id": (latest_report or {}).get("report_id") if latest_report is not None else None,
        "latest_report_kind": (latest_report or {}).get("kind") if latest_report is not None else None,
        "last_progress_at": (state or {}).get("last_progress_at"),
        "last_report_at": (state or {}).get("last_report_at"),
        "next_review_at": (state or {}).get("next_review_at"),
        "true_blocker_count": len((state or {}).get("true_blockers") or []),
        "completion_ready": bool(completion.get("all_required_satisfied")) if completion else None,
        "continuation": dict((state or {}).get("continuation") or {}),
        "next_action": dict((state or {}).get("next_action") or {}),
        "last_pass": dict((state or {}).get("last_pass") or {}),
        "last_progress": dict((state or {}).get("last_progress") or {}),
        "last_report": dict((state or {}).get("last_report") or {}),
        "owed_follow_up": dict((state or {}).get("owed_follow_up") or {}),
        "reporting_cadence": dict((state or {}).get("reporting_cadence") or {}),
        "last_watchdog_decision": dict((state or {}).get("last_watchdog_decision") or {}),
        "execution_budget": model_dump_compat(contract.execution_budget) if contract is not None and getattr(contract, "execution_budget", None) is not None else None,
        "reporting_policy": model_dump_compat(contract.reporting_policy) if contract is not None and getattr(contract, "reporting_policy", None) is not None else None,
        "execution_discipline": dict(metadata.get("execution_discipline") or {}),
        "validation_policy": dict(metadata.get("validation_policy") or {}),
        "blocker_policy": dict(metadata.get("blocker_policy") or {}),
        "progress_snapshot": dict(metadata.get("progress_snapshot") or {}),
        "latest_decisions": dict((metadata.get("execution_discipline") or {}).get("latest_decisions") or {}),
        "latest_report_reasons": list(latest_report_metadata.get("reasons") or []),
        "latest_report_progress": dict(latest_report_metadata.get("progress") or {}),
    }



def _sync_runtime_process_roadmap_state(
    process_id: str,
    *,
    process: Dict[str, Any],
    stores: Dict[str, Any],
    event_kind: str,
    event_payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    snapshot = stores["snapshot_store"].load(process_id)
    shared_state = stores["shared_state_store"].load(process_id)
    contract = stores["roadmap_store"].load_contract(process_id)
    state = stores["roadmap_store"].load_state(process_id)
    reports = stores["roadmap_store"].reports(process_id)
    latest_report = reports[-1] if reports else None

    if snapshot is not None:
        process = sync_process_progress(
            process_id,
            lifecycle_state=snapshot.lifecycle_state,
            active_nodes=snapshot.active_steps,
            waiting_nodes=snapshot.waiting_steps,
            completed_nodes=snapshot.completed_steps,
            failed_nodes=snapshot.failed_steps,
            enabled=(snapshot.lifecycle_state != "failed"),
            event_kind=f"{event_kind}.progress",
            event_payload={
                **dict(event_payload or {}),
                "snapshot_id": snapshot.snapshot_id,
                "shared_state_revision_id": shared_state.revision_id if shared_state is not None else None,
            },
        )

    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = dict(workflow.get("metadata") or {})
    desired_metadata = dict(metadata)
    desired_metadata["runtime_roadmap"] = _runtime_roadmap_projection(
        contract=contract,
        state=model_dump_compat(state) if state is not None else None,
        latest_report=model_dump_compat(latest_report) if latest_report is not None else None,
        snapshot=snapshot,
        shared_state=shared_state,
    )
    if contract is not None:
        desired_metadata["roadmap_executor"] = model_dump_compat(contract)
    if state is not None:
        desired_metadata["roadmap_status"] = state.status
        desired_metadata["roadmap_active_phase"] = state.active_phase_id
        desired_metadata["roadmap_continuation_mode"] = state.continuation.get("mode") if isinstance(state.continuation, dict) else None

    if desired_metadata != metadata:
        process = replace_process_workflow(
            process_id,
            {
                "name": workflow.get("name"),
                "metadata": desired_metadata,
                "steps": list(workflow.get("steps") or []),
            },
            event_kind=event_kind,
            event_payload=dict(event_payload or {}),
        )
    elif event_kind:
        process = record_runtime_event(process_id, event_kind, dict(event_payload or {}))
    refreshed = get_runtime_process(process_id)
    return refreshed or process



def _runtime_roadmap_status_payload(process_id: str, *, process: Dict[str, Any], stores: Dict[str, Any]) -> Dict[str, Any]:
    snapshot = stores["snapshot_store"].load(process_id)
    shared_state = stores["shared_state_store"].load(process_id)
    contract = stores["roadmap_store"].load_contract(process_id)
    state = stores["roadmap_store"].load_state(process_id)
    reports = stores["roadmap_store"].reports(process_id)
    latest_report = reports[-1] if reports else None
    return {
        "success": True,
        "process_id": process_id,
        "process": process,
        "contract": model_dump_compat(contract) if contract is not None else None,
        "state": model_dump_compat(state) if state is not None else None,
        "snapshot": model_dump_compat(snapshot) if snapshot is not None else None,
        "shared_state": model_dump_compat(shared_state) if shared_state is not None else None,
        "report_count": len(reports),
        "latest_report": model_dump_compat(latest_report) if latest_report is not None else None,
        "recent_reports": [model_dump_compat(report) for report in reports[-5:]],
    }



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
    actor_id: str = "cortex"
    actor_session_key: Optional[str] = None
    reason: Optional[str] = None


class RuntimePlanRequest(BaseModel):
    graph: ReasoningPlanGraph
    options: RuntimeScheduleOptions = Field(default_factory=RuntimeScheduleOptions)


class RuntimeDeliveryReconcileRequest(BaseModel):
    contract: Optional[Dict[str, Any]] = None
    objective: Optional[str] = None
    target_environment: Optional[str] = None
    promotion_stages: Optional[List[str]] = None
    stage_gates: Optional[List[Dict[str, Any]]] = None
    completion_criteria: Optional[List[Dict[str, Any]]] = None
    blocker_rules: Optional[List[Dict[str, Any]]] = None
    dependability_profile: Optional[Any] = None
    execution_budget: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    candidate_ref: Optional[str] = None
    initial_release_stage: Optional[str] = None
    bootstrap_runtime_state: bool = True
    initialize_release: bool = True
    controller_id: str = "cortex"
    controller_session_id: Optional[str] = None
    now_iso: Optional[str] = None


class RuntimeDeliveryRollbackRequest(BaseModel):
    stage: Optional[str] = None
    fencepost_id: Optional[str] = None
    reason: str = "operator_requested"
    actor: str = "cortex"
    new_revision_id: Optional[str] = None


class RuntimeRoadmapReconcileRequest(BaseModel):
    contract: Optional[Dict[str, Any]] = None
    objective: Optional[str] = None
    success_criteria: Optional[List[Dict[str, Any]]] = None
    phases: Optional[List[Dict[str, Any]]] = None
    tasks: Optional[List[Dict[str, Any]]] = None
    blocker_rules: Optional[List[Dict[str, Any]]] = None
    dependability_profile: Optional[Any] = None
    reporting_policy: Optional[Dict[str, Any]] = None
    execution_budget: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    bootstrap_runtime_state: bool = True
    controller_id: str = "cortex"
    controller_session_id: Optional[str] = None
    now_iso: Optional[str] = None


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



def _process_has_running_nodes(process: Dict[str, Any]) -> bool:
    nodes = process.get("nodes") if isinstance(process.get("nodes"), dict) else {}
    return any(str((node or {}).get("status") or "") == "running" for node in nodes.values() if isinstance(node, dict))



def _process_has_waiting_nodes(process: Dict[str, Any]) -> bool:
    nodes = process.get("nodes") if isinstance(process.get("nodes"), dict) else {}
    return any(str((node or {}).get("status") or "") in {"waiting", "ready", "scheduled"} for node in nodes.values() if isinstance(node, dict))



def _runtime_watchdog_now(now_iso: Optional[str]) -> datetime:
    return _parse_optional_dt(now_iso) or datetime.now().astimezone()



def _runtime_roadmap_watchdog_decision(*, process: Dict[str, Any], contract: RoadmapObjectiveContract, state: Optional[RoadmapExecutionState], now: datetime) -> Optional[Dict[str, Any]]:
    if state is None:
        return {"decision": "auto_resume", "classification": "bootstrap", "reason": "missing_state"}
    if str(state.liveness or "live") == "terminal" or str(state.status or "") not in {"active", "blocked"}:
        return None
    running = _process_has_running_nodes(process)
    waiting = _process_has_waiting_nodes(process)
    review_due = False
    if state.next_review_at:
        due_at = _parse_optional_dt(state.next_review_at)
        review_due = due_at is not None and due_at <= now
    last_progress = _parse_optional_dt(state.last_progress_at)
    idle_seconds = (now - last_progress).total_seconds() if last_progress is not None else None
    abnormal_idle = str((state.continuation or {}).get("mode") or "") == "continue_now"
    if not abnormal_idle and not running and not waiting and str(state.status or "") == "active":
        abnormal_idle = idle_seconds is None or idle_seconds >= int(contract.reporting_policy.abnormal_idle_grace_seconds or 0)
    if abnormal_idle:
        return {
            "decision": "auto_resume",
            "classification": "abnormal_idle",
            "reason": str((state.continuation or {}).get("reason") or (state.next_action or {}).get("kind") or state.status),
            "idle_seconds": idle_seconds,
            "review_due": review_due,
        }
    if review_due and str(state.status or "") == "blocked":
        return {
            "decision": "report_blocker",
            "classification": "expected_wait",
            "reason": str((state.continuation or {}).get("reason") or "blocked"),
            "idle_seconds": idle_seconds,
            "review_due": True,
        }
    if review_due:
        return {
            "decision": "report_status",
            "classification": "expected_wait",
            "reason": str((state.continuation or {}).get("reason") or (state.next_action or {}).get("kind") or state.status),
            "idle_seconds": idle_seconds,
            "review_due": True,
        }
    return None



def _runtime_delivery_watchdog_decision(*, process: Dict[str, Any], contract: ProductionBuildContract, state: Optional[ProductionBuildLoopState], now: datetime) -> Optional[Dict[str, Any]]:
    if state is None:
        return {"decision": "auto_resume", "classification": "bootstrap", "reason": "missing_state"}
    if str(state.liveness or "live") == "terminal" or str(state.status or "") not in {"active", "blocked"}:
        return None
    running = _process_has_running_nodes(process)
    waiting = _process_has_waiting_nodes(process)
    review_due = False
    if state.next_review_at:
        due_at = _parse_optional_dt(state.next_review_at)
        review_due = due_at is not None and due_at <= now
    last_progress = _parse_optional_dt(state.last_progress_at)
    idle_seconds = (now - last_progress).total_seconds() if last_progress is not None else None
    abnormal_idle = str((state.continuation or {}).get("mode") or "") == "continue_now"
    if not abnormal_idle and not running and not waiting and str(state.status or "") == "active":
        abnormal_idle = idle_seconds is None or idle_seconds >= int(contract.checkpoint_policy.abnormal_idle_grace_seconds or 0)
    if abnormal_idle:
        return {
            "decision": "auto_resume",
            "classification": "abnormal_idle",
            "reason": str((state.continuation or {}).get("reason") or (state.next_action or {}).get("kind") or state.status),
            "idle_seconds": idle_seconds,
            "review_due": review_due,
        }
    if review_due and str(state.status or "") == "blocked":
        return {
            "decision": "report_blocker",
            "classification": "expected_wait",
            "reason": str((state.continuation or {}).get("reason") or "blocked"),
            "idle_seconds": idle_seconds,
            "review_due": True,
        }
    if review_due:
        return {
            "decision": "report_status",
            "classification": "expected_wait",
            "reason": str((state.continuation or {}).get("reason") or (state.next_action or {}).get("kind") or state.status),
            "idle_seconds": idle_seconds,
            "review_due": True,
        }
    return None



def _run_runtime_no_silent_idle_watchdog(*, now_iso: Optional[str] = None, limit: int = 25) -> Dict[str, Any]:
    stores = _runtime_delivery_stores()
    now = _runtime_watchdog_now(now_iso)
    reviewed = 0
    actions: List[Dict[str, Any]] = []
    for process in list_runtime_processes()[: max(1, int(limit or 1))]:
        process_id = process.get("process_id")
        if not process_id:
            continue
        reviewed += 1
        snapshot = stores["snapshot_store"].load(process_id)
        shared_state = stores["shared_state_store"].load(process_id)
        workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
        metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
        if (stores["roadmap_store"].load_contract(process_id) is not None or stores["roadmap_store"].load_state(process_id) is not None or isinstance(metadata.get("roadmap_executor"), dict)) and (snapshot is not None or shared_state is not None):
            if snapshot is None or shared_state is None:
                _bootstrap_runtime_delivery_state(process_id, process=process, stores=stores)
            contract = _resolve_runtime_roadmap_contract(process_id, process=process, stores=stores, request=RuntimeRoadmapReconcileRequest())
            state = stores["roadmap_store"].load_state(process_id)
            decision = _runtime_roadmap_watchdog_decision(process=process, contract=contract, state=state, now=now)
            if decision is not None:
                reconciled = reconcile_roadmap_execution(
                    contract,
                    roadmap_store=stores["roadmap_store"],
                    snapshot_store=stores["snapshot_store"],
                    shared_state_store=stores["shared_state_store"],
                    mailbox=stores["mailbox"],
                    supervisor=stores["supervisor"],
                    release_store=stores["release_store"],
                    controller_id="runtime-watchdog",
                    controller_session_id=f"runtime-watchdog:{process_id}",
                    journal=stores["journal"],
                    now=now,
                    watchdog_context={**decision, "source": "runtime_tick", "process_id": process_id},
                )
                process = _sync_runtime_process_roadmap_state(
                    process_id,
                    process=get_runtime_process(process_id) or process,
                    stores=stores,
                    event_kind="runtime_roadmap_watchdog",
                    event_payload={"decision": decision.get("decision"), "classification": decision.get("classification"), "status": (reconciled.get("state") or {}).get("status")},
                )
                actions.append({"kind": "roadmap", "process_id": process_id, "decision": decision, "status": (reconciled.get("state") or {}).get("status"), "report": (reconciled.get("report") or {}).get("kind") if isinstance(reconciled.get("report"), dict) else None})
                continue
        if (stores["loop_store"].load_contract(process_id) is not None or stores["loop_store"].load_state(process_id) is not None or isinstance(metadata.get("production_build_loop"), dict)) and (snapshot is not None or shared_state is not None):
            if snapshot is None or shared_state is None:
                _bootstrap_runtime_delivery_state(process_id, process=process, stores=stores)
            contract = _resolve_runtime_delivery_contract(process_id, process=process, stores=stores, request=RuntimeDeliveryReconcileRequest())
            state = stores["loop_store"].load_state(process_id)
            decision = _runtime_delivery_watchdog_decision(process=process, contract=contract, state=state, now=now)
            if decision is not None:
                reconciled = reconcile_production_build_loop(
                    contract,
                    loop_store=stores["loop_store"],
                    snapshot_store=stores["snapshot_store"],
                    shared_state_store=stores["shared_state_store"],
                    journal=stores["journal"],
                    mailbox=stores["mailbox"],
                    supervisor=stores["supervisor"],
                    release_store=stores["release_store"],
                    controller_id="runtime-watchdog",
                    controller_session_id=f"runtime-watchdog:{process_id}",
                    now=now,
                    watchdog_context={**decision, "source": "runtime_tick", "process_id": process_id},
                )
                process = _sync_runtime_process_delivery_state(
                    process_id,
                    process=get_runtime_process(process_id) or process,
                    stores=stores,
                    event_kind="runtime_delivery_watchdog",
                    event_payload={"decision": decision.get("decision"), "classification": decision.get("classification"), "status": (reconciled.get("state") or {}).get("status")},
                )
                actions.append({"kind": "delivery", "process_id": process_id, "decision": decision, "status": (reconciled.get("state") or {}).get("status"), "report": (reconciled.get("report") or {}).get("kind") if isinstance(reconciled.get("report"), dict) else None})
    return {"reviewed": reviewed, "actions": actions, "action_count": len(actions)}


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
        watchdog = _run_runtime_no_silent_idle_watchdog(now_iso=request.now_iso, limit=request.limit)
        return {"success": True, "tick": tick, "executed": [], "executed_count": 0, "watchdog": watchdog}
    batch = await _execute_runtime_batch(limit=request.limit, now_iso=request.now_iso)
    watchdog = _run_runtime_no_silent_idle_watchdog(now_iso=request.now_iso, limit=request.limit)
    return {"success": True, **batch, "watchdog": watchdog}


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


@router.get("/runtime/delivery/{process_id}")
async def get_runtime_delivery_status(process_id: str):
    process = get_runtime_process(process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{process_id}' not found")
    stores = _runtime_delivery_stores()
    return _runtime_delivery_status_payload(process_id, process=process, stores=stores)


@router.post("/runtime/delivery/reconcile/{process_id}")
async def reconcile_runtime_delivery(process_id: str, request: Optional[RuntimeDeliveryReconcileRequest] = None):
    request = request or RuntimeDeliveryReconcileRequest()
    process = get_runtime_process(process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{process_id}' not found")
    stores = _runtime_delivery_stores()
    if request.bootstrap_runtime_state:
        _bootstrap_runtime_delivery_state(process_id, process=process, stores=stores)
    snapshot = stores["snapshot_store"].load(process_id)
    shared_state = stores["shared_state_store"].load(process_id)
    if snapshot is None or shared_state is None:
        raise HTTPException(status_code=400, detail=f"runtime delivery state missing for {process_id}; enable bootstrap_runtime_state to initialize it")
    contract = _resolve_runtime_delivery_contract(process_id, process=process, stores=stores, request=request)
    if request.initialize_release:
        _ensure_runtime_release_state(process_id, process=process, contract=contract, stores=stores, request=request)
    reconciled = reconcile_production_build_loop(
        contract,
        loop_store=stores["loop_store"],
        snapshot_store=stores["snapshot_store"],
        shared_state_store=stores["shared_state_store"],
        journal=stores["journal"],
        mailbox=stores["mailbox"],
        supervisor=stores["supervisor"],
        release_store=stores["release_store"],
        controller_id=request.controller_id,
        controller_session_id=request.controller_session_id or f"runtime-delivery:{process_id}",
        now=_parse_optional_dt(request.now_iso),
    )
    process = _sync_runtime_process_delivery_state(
        process_id,
        process=process,
        stores=stores,
        event_kind="runtime_delivery_reconciled",
        event_payload={
            "controller_id": request.controller_id,
            "controller_session_id": request.controller_session_id or f"runtime-delivery:{process_id}",
            "loop_status": reconciled["state"].get("status") if isinstance(reconciled.get("state"), dict) else None,
            "release_stage": ((reconciled.get("release_state") or {}).get("current_stage") if isinstance(reconciled.get("release_state"), dict) else None),
        },
    )
    return {
        "success": True,
        "process_id": process_id,
        "process": process,
        "contract": model_dump_compat(contract),
        **reconciled,
        "delivery": _runtime_delivery_status_payload(process_id, process=process, stores=stores),
    }


@router.post("/runtime/delivery/rollback/{process_id}")
async def rollback_runtime_delivery(process_id: str, request: Optional[RuntimeDeliveryRollbackRequest] = None):
    request = request or RuntimeDeliveryRollbackRequest()
    process = get_runtime_process(process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{process_id}' not found")
    stores = _runtime_delivery_stores()
    release_state = stores["release_store"].load(process_id)
    if release_state is None:
        raise HTTPException(status_code=404, detail=f"Runtime delivery release state '{process_id}' not found")
    rolled = apply_release_rollback_restore(
        release_state,
        snapshot_store=stores["snapshot_store"],
        shared_state_store=stores["shared_state_store"],
        release_store=stores["release_store"],
        journal=stores["journal"],
        stage=request.stage,
        fencepost_id=request.fencepost_id,
        actor=request.actor,
        reason=request.reason,
        new_revision_id=request.new_revision_id,
    )
    contract = stores["loop_store"].load_contract(process_id)
    rollback_checkpoint = _checkpoint_runtime_delivery_rollback(
        process_id,
        contract=contract,
        stores=stores,
        release_state=rolled["state"],
        snapshot=rolled["snapshot"],
        shared_state=rolled["shared_state"],
        actor=request.actor,
        reason=request.reason,
        rollback_fencepost_id=(rolled.get("fencepost") or {}).get("fencepost_id") if isinstance(rolled.get("fencepost"), dict) else None,
    )
    process = _sync_runtime_process_delivery_state(
        process_id,
        process=process,
        stores=stores,
        event_kind="runtime_delivery_rollback_applied",
        event_payload={
            "actor": request.actor,
            "reason": request.reason,
            "release_stage": rolled["state"].current_stage,
            "shared_state_revision_id": rolled["shared_state"].revision_id,
        },
    )
    return {
        "success": True,
        "process_id": process_id,
        "process": process,
        "state": model_dump_compat(rolled["state"]),
        "snapshot": model_dump_compat(rolled["snapshot"]),
        "shared_state": model_dump_compat(rolled["shared_state"]),
        "rollback_event": rolled.get("rollback_event"),
        "operator_summary": rolled.get("operator_summary"),
        "loop_checkpoint": {
            "state": model_dump_compat(rollback_checkpoint["state"]),
            "report": model_dump_compat(rollback_checkpoint["report"]),
        } if rollback_checkpoint is not None else None,
        "delivery": _runtime_delivery_status_payload(process_id, process=process, stores=stores),
    }


@router.get("/runtime/roadmap/{process_id}")
async def get_runtime_roadmap_status(process_id: str):
    process = get_runtime_process(process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{process_id}' not found")
    stores = _runtime_delivery_stores()
    return _runtime_roadmap_status_payload(process_id, process=process, stores=stores)


@router.post("/runtime/roadmap/reconcile/{process_id}")
async def reconcile_runtime_roadmap(process_id: str, request: Optional[RuntimeRoadmapReconcileRequest] = None):
    request = request or RuntimeRoadmapReconcileRequest()
    process = get_runtime_process(process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{process_id}' not found")
    stores = _runtime_delivery_stores()
    if request.bootstrap_runtime_state:
        _bootstrap_runtime_delivery_state(process_id, process=process, stores=stores)
    snapshot = stores["snapshot_store"].load(process_id)
    shared_state = stores["shared_state_store"].load(process_id)
    if snapshot is None or shared_state is None:
        raise HTTPException(status_code=400, detail=f"runtime roadmap state missing for {process_id}; enable bootstrap_runtime_state to initialize it")
    contract = _resolve_runtime_roadmap_contract(process_id, process=process, stores=stores, request=request)
    reconciled = reconcile_roadmap_execution(
        contract,
        roadmap_store=stores["roadmap_store"],
        snapshot_store=stores["snapshot_store"],
        shared_state_store=stores["shared_state_store"],
        mailbox=stores["mailbox"],
        supervisor=stores["supervisor"],
        release_store=stores["release_store"],
        controller_id=request.controller_id,
        controller_session_id=request.controller_session_id or f"runtime-roadmap:{process_id}",
        journal=stores["journal"],
        now=_parse_optional_dt(request.now_iso),
    )
    process = _sync_runtime_process_roadmap_state(
        process_id,
        process=process,
        stores=stores,
        event_kind="runtime_roadmap_reconciled",
        event_payload={
            "controller_id": request.controller_id,
            "controller_session_id": request.controller_session_id or f"runtime-roadmap:{process_id}",
            "status": reconciled["state"].get("status") if isinstance(reconciled.get("state"), dict) else None,
            "active_phase_id": reconciled["state"].get("active_phase_id") if isinstance(reconciled.get("state"), dict) else None,
        },
    )
    return {
        "success": True,
        "process_id": process_id,
        "process": process,
        "contract": model_dump_compat(contract),
        **reconciled,
        "roadmap": _runtime_roadmap_status_payload(process_id, process=process, stores=stores),
    }


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
        record_runtime_event_fn=record_runtime_event,
        actor_id=req.actor_id,
        actor_session_key=req.actor_session_key,
        reason=req.reason,
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
        record_runtime_event_fn=record_runtime_event,
        actor_id=req.actor_id,
        actor_session_key=req.actor_session_key,
        reason=req.reason,
        dry_run=bool(req.dry_run),
        allow_intervening_revisions=bool(req.allow_intervening_revisions),
        load_workflow_fn=_load_workflow,
        persist_workflow_fn=_persist_workflow,
    )


@router.post("/runtime/homeostasis/resume/{process_id}")
async def resume_runtime_homeostasis(process_id: str, req: Optional[RuntimeHomeostasisControlRequest] = None):
    req = req or RuntimeHomeostasisControlRequest()
    return runtime_service.runtime_homeostasis_resume_control(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        resume_process_fn=resume_runtime_process,
        record_runtime_event_fn=record_runtime_event,
        actor_id=req.actor_id,
        actor_session_key=req.actor_session_key,
        reason=req.reason,
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
