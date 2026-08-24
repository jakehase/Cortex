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

from cortex_server.internal_addressing import CORTEX_INTERNAL_BASE_URL, internal_url
from cortex_server.modules.diplomat import get_diplomat
from cortex_server.modules.reasoning_beliefs import belief_conflicts, beliefs_for_task, explain_belief, get_belief, list_beliefs, search_beliefs, select_influential_beliefs, summarize_beliefs, trace_belief_lineage, upsert_belief
from cortex_server.modules import reasoning_explain as explain
from cortex_server.modules import reasoning_observability as observability
from cortex_server.modules import reasoning_runtime_execution as runtime_execution
from cortex_server.modules import reasoning_runtime_explain as runtime_explain
from cortex_server.modules import reasoning_runtime_service as runtime_service
from cortex_server.modules import reasoning_runtime_workflows as runtime_workflows
from cortex_server.modules.cortex_codec import get_codec_packet_for_session
from cortex_server.modules.evidence_governance import capability_matrix
from cortex_server.modules.evidence_lineage import build_lineage_bundle
from cortex_server.modules.reasoning_kernel import model_dump_compat
from cortex_server.modules.reasoning_planner import (
    PlanGraphError,
    ReasoningPlanGraph,
    compile_plan_to_agent_work_handoff,
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
    DeliveryDeadLetterStore,
    MaintenanceQueueItem,
    MaintenanceQueueStore,
    RuntimeMemoryStore,
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
    RuntimeFollowUpDispatch,
    RuntimeFollowUpStore,
    SessionRegistryStore,
    SharedProcessState,
    SharedProcessStateStore,
    WatchRegistration,
    WatcherRuntimeStore,
    adapt_tool_event,
    compile_handoff_to_agent_work_spec,
    derive_session_plane,
    resolve_session_follow_up_policy,
    session_follow_up_allowed,
    session_plane_is_blocking,
    apply_release_rollback_restore,
    capture_release_rollback_fencepost,
    detect_true_blockers,
    evaluate_production_completion,
    normalize_session_event,
    record_release_fencepost,
    reconcile_production_build_loop,
    reconcile_roadmap_execution,
    resilient_delivery_attempt,
)

router = APIRouter()

# ── In-memory state ────────────────────────────────────────────────────────
DEFAULT_DB_PATH = Path(os.getenv("REASONING_STORE_DB_PATH", "/opt/clawdbot/state/reasoning_runtime.db"))
RUNTIME_DELIVERY_ROOT = Path(os.getenv("ORCHESTRATOR_RUNTIME_DELIVERY_ROOT", "/opt/clawdbot/state/runtime_delivery"))
workflows: Dict[str, Dict[str, Any]] = {}
_stats = {
    "workflows_created": 0,
    "workflows_executed": 0,
}

BASE_URL = CORTEX_INTERNAL_BASE_URL

MAX_WORKFLOW_STEPS = int(os.getenv("ORCHESTRATOR_MAX_STEPS", "25"))
MAX_PAYLOAD_BYTES = int(os.getenv("ORCHESTRATOR_MAX_PAYLOAD_BYTES", "51200"))
STEP_TIMEOUT_MAX_S = float(os.getenv("ORCHESTRATOR_STEP_TIMEOUT_MAX_S", "20"))
MAX_STEP_RESPONSE_CHARS = int(os.getenv("ORCHESTRATOR_MAX_STEP_RESPONSE_CHARS", "4000"))
MAX_EXECUTIONS_PER_WORKFLOW = int(os.getenv("ORCHESTRATOR_MAX_EXECUTIONS_PER_WORKFLOW", "20"))
SENTINEL_SCAN_URL = internal_url("/sentinel/scan")


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
        "session_registry": SessionRegistryStore(root / "session_registry.json"),
        "watcher_store": WatcherRuntimeStore(root / "watchers.json"),
        "runtime_memory_store": RuntimeMemoryStore(root / "memory"),
        "delivery_dlq": DeliveryDeadLetterStore(root / "delivery_dlq.jsonl"),
        "mailbox": AgentMailbox(root / "mailbox.json"),
        "supervisor": AgentSupervisor(root / "leases.json"),
        "release_store": ReleaseWorkflowStore(root / "release_workflow"),
        "loop_store": ProductionBuildLoopStore(root / "production_build_loop"),
        "roadmap_store": RoadmapExecutionStore(root / "roadmap_executor"),
        "follow_up_store": RuntimeFollowUpStore(root / "runtime_follow_ups.json"),
        "maintenance_queue_store": MaintenanceQueueStore(root / "maintenance_queue.json"),
    }



def _parse_optional_dt(value: Optional[str]) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def _next_runtime_revision_id(process_id: str, current_revision_id: Optional[str] = None) -> str:
    suffix = datetime.now().strftime("%Y%m%dT%H%M%S%fZ")
    current = str(current_revision_id or "").strip()
    base = current.rsplit("@", 1)[0] if current else f"runtime_{process_id}"
    return f"{base}@{suffix}"


def _append_unique_text(rows: List[str], value: Optional[str]) -> List[str]:
    out = [str(row).strip() for row in (rows or []) if str(row).strip()]
    text = str(value or "").strip()
    if text and text not in out:
        out.append(text)
    return out


def _upsert_runtime_shared_state_from_session_event(process_id: str, event: Any, *, stores: Dict[str, Any]) -> Optional[SharedProcessState]:
    shared_state_store = stores["shared_state_store"]
    current = shared_state_store.load(process_id)
    if current is None:
        current = SharedProcessState(
            process_id=process_id,
            revision_id=_next_runtime_revision_id(process_id),
            goals=[f"Track runtime state for {process_id}"],
            active_plan_node_ids=[],
            runtime_constraints={},
            world_state={},
            belief_refs=[],
            open_questions=[],
            agent_ownership={},
            metadata={"bootstrapped_from_session_event": True},
        )
    world_state = dict(current.world_state or {})
    session_row = stores["session_registry"].get(process_id=process_id, session_id=str(event.session_id or process_id))
    derived_session_plane = derive_session_plane(
        process=get_runtime_process(process_id) or {"process_id": process_id},
        session_rows=[model_dump_compat(session_row)] if session_row is not None else [],
        watcher_rows=[model_dump_compat(row) for row in stores["watcher_store"].list(process_id=process_id)],
        shared_state=model_dump_compat(current),
    )
    world_state.update(
        {
            "last_session_event": event.kind,
            "last_session_event_at": event.ts,
            "last_session_summary": event.summary or event.operator_summary,
            "last_session_tool": event.tool,
            "session_status": session_row.status if session_row is not None else None,
            "session_plane": derived_session_plane,
        }
    )
    updated = SharedProcessState(
        process_id=current.process_id,
        state_id=current.state_id,
        revision_id=_next_runtime_revision_id(process_id, current.revision_id),
        updated_at=datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
        goals=list(current.goals or []),
        active_plan_node_ids=list(current.active_plan_node_ids or []),
        open_decisions=list(current.open_decisions or []),
        runtime_constraints=dict(current.runtime_constraints or {}),
        world_state=world_state,
        belief_refs=list(current.belief_refs or []),
        open_questions=list(current.open_questions or []),
        agent_ownership=dict(current.agent_ownership or {}),
        operator_overrides=dict(current.operator_overrides or {}),
        metadata={**dict(current.metadata or {}), "last_session_event_id": event.event_id, "session_plane_authority": "derived"},
    )
    return shared_state_store.save(updated, expected_revision_id=current.revision_id, actor=str(event.tool or "runtime-session"), provenance={"source": "runtime_session_event", "event_kind": event.kind})


def _record_runtime_session_event(*, process_id: str, event: Any, stores: Dict[str, Any]) -> Dict[str, Any]:
    process = get_runtime_process(process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{process_id}' not found")

    session_registry = stores["session_registry"]
    journal = stores["journal"]
    runtime_memory_store = stores["runtime_memory_store"]

    session_registry.apply_event(event)
    journal.append(
        process_id=process_id,
        kind=event.kind,
        actor=event.tool,
        payload={
            **dict(event.payload or {}),
            "operator_summary": event.operator_summary,
            "session_id": event.session_id,
            "session_name": event.session_name,
            "raw_event": event.raw_event,
        },
    )
    record_runtime_event(process_id, event.kind, {**dict(event.payload or {}), "operator_summary": event.operator_summary})
    shared_state = _upsert_runtime_shared_state_from_session_event(process_id, event, stores=stores)
    memory_path = runtime_memory_store.write_session_event(event)
    refreshed = get_runtime_process(process_id)
    snapshot = _upsert_runtime_snapshot_session_state(process_id=process_id, stores=stores, process=refreshed or process)
    follow_up = _enqueue_session_follow_up(process=refreshed or process, event=event, stores=stores)
    return {
        "success": True,
        "process": refreshed or process,
        "session": (session_registry.get(process_id=process_id, session_id=str(event.session_id or process_id))),
        "shared_state": shared_state,
        "snapshot": snapshot,
        "memory_path": str(memory_path),
        "event": event,
        "follow_up_dispatch": follow_up,
    }


def _runtime_workspace_targets_from_process(process: Dict[str, Any]) -> List[str]:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    candidates = []
    for key in ("workspace_path", "workspace_root", "repo_root", "repo_path", "target_path"):
        value = str(metadata.get(key) or "").strip()
        if value:
            candidates.append(value)
    for value in (metadata.get("workspace_paths") or []):
        text = str(value or "").strip()
        if text:
            candidates.append(text)
    out: List[str] = []
    for value in candidates:
        if value not in out:
            out.append(value)
    return out


def _bootstrap_runtime_session_plane(process_id: str, *, process: Dict[str, Any], stores: Dict[str, Any]) -> Dict[str, Any]:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    session_id = str(metadata.get("runtime_session_id") or process_id).strip() or process_id
    session_name = str(workflow.get("name") or session_id).strip() or session_id
    tool = str(metadata.get("runtime_tool") or "cortex-runtime").strip() or "cortex-runtime"

    session = stores["session_registry"].register(
        process_id=process_id,
        session_id=session_id,
        session_name=session_name,
        tool=tool,
        source="runtime_bootstrap",
        stale_after_seconds=int(metadata.get("session_stale_after_seconds") or 900),
        parent_process={"process_id": process_id, "workflow_name": workflow.get("name")},
        metadata={"bootstrapped": True},
    )
    default_watchers: List[Dict[str, Any]] = []
    heartbeat_watcher = stores["watcher_store"].register(
        WatchRegistration(
            process_id=process_id,
            kind="session-heartbeat",
            target=session_id,
            session_id=session_id,
            session_name=session_name,
            tool=tool,
            stale_after_seconds=session.stale_after_seconds,
            metadata={"bootstrapped": True},
        )
    )
    stores["session_registry"].attach_watcher(process_id=process_id, session_id=session_id, watcher_id=heartbeat_watcher.watch_id)
    default_watchers.append(model_dump_compat(heartbeat_watcher))

    for target in _runtime_workspace_targets_from_process(process):
        watcher = stores["watcher_store"].register(
            WatchRegistration(
                process_id=process_id,
                kind="workspace",
                target=target,
                session_id=session_id,
                session_name=session_name,
                tool="workspace",
                debounce_seconds=float(metadata.get("workspace_debounce_seconds") or 1.0),
                metadata={"bootstrapped": True},
            )
        )
        stores["session_registry"].attach_watcher(process_id=process_id, session_id=session_id, watcher_id=watcher.watch_id)
        default_watchers.append(model_dump_compat(watcher))

    stores["runtime_memory_store"].write_process_note(
        process_id=process_id,
        title="Session plane bootstrapped",
        note=f"bootstrapped session={session_id} tool={tool} watchers={len(default_watchers)}",
        metadata={"session_id": session_id, "watcher_count": len(default_watchers)},
    )

    event = normalize_session_event(
        process_id,
        "session.started",
        tool=tool,
        session_id=session_id,
        session_name=session_name,
        summary="runtime session plane bootstrapped",
        payload={"bootstrapped": True, "watcher_count": len(default_watchers)},
    )
    recorded = _record_runtime_session_event(process_id=process_id, event=event, stores=stores)
    return {
        "session": model_dump_compat(recorded.get("session")),
        "shared_state": model_dump_compat(recorded.get("shared_state")) if recorded.get("shared_state") is not None else None,
        "memory_path": recorded.get("memory_path"),
        "watchers": default_watchers,
        "event": model_dump_compat(event),
    }


def _ensure_runtime_session_plane_bootstrap(process_id: str, *, process: Dict[str, Any], stores: Dict[str, Any]) -> Dict[str, Any]:
    existing_sessions = [model_dump_compat(row) for row in stores["session_registry"].list(process_id=process_id)]
    existing_watchers = [model_dump_compat(row) for row in stores["watcher_store"].list(process_id=process_id)]
    if existing_sessions:
        session = existing_sessions[0]
        return {
            "session": session,
            "shared_state": model_dump_compat(stores["shared_state_store"].load(process_id)) if stores["shared_state_store"].load(process_id) is not None else None,
            "memory_path": None,
            "watchers": existing_watchers,
            "event": None,
        }
    return _bootstrap_runtime_session_plane(process_id, process=process, stores=stores)


def _runtime_session_plane_status(*, stores: Dict[str, Any], process_id: Optional[str] = None) -> Dict[str, Any]:
    stores["session_registry"].detect_stale()
    sessions = stores["session_registry"].list(process_id=process_id)
    watchers = stores["watcher_store"].list(process_id=process_id)
    by_status: Dict[str, int] = {}
    for row in sessions:
        status = str(row.status or "unknown")
        by_status[status] = by_status.get(status, 0) + 1
    return {
        "session_count": len(sessions),
        "watcher_count": len(watchers),
        "sessions_by_status": by_status,
        "dlq_count": len(stores["delivery_dlq"].list()),
        "memory_root": str(stores["runtime_memory_store"].root),
    }


def _snapshot_session_state(*, process: Dict[str, Any], stores: Dict[str, Any], process_id: str) -> Dict[str, Any]:
    session_rows = [model_dump_compat(row) for row in stores["session_registry"].list(process_id=process_id)]
    watcher_rows = [model_dump_compat(row) for row in stores["watcher_store"].list(process_id=process_id)]
    derived = derive_session_plane(process=process, session_rows=session_rows, watcher_rows=watcher_rows)
    return dict(derived or {"authority": "derived", "authority_source": "process", "status": str(process.get("status") or "scheduled"), "session_id": process_id, "session_name": ((process.get("workflow") or {}).get("name") if isinstance(process.get("workflow"), dict) else None) or process_id, "tool": "cortex-runtime", "retry_count": 0, "watcher_count": len(watcher_rows), "session_count": len(session_rows), "open_questions": [], "watcher_ids": [], "sessions": session_rows, "watchers": watcher_rows})


def _upsert_runtime_snapshot_session_state(*, process_id: str, stores: Dict[str, Any], process: Optional[Dict[str, Any]] = None) -> Optional[ProcessSnapshot]:
    snapshot_store = stores["snapshot_store"]
    snapshot = snapshot_store.load(process_id)
    current_process = process or get_runtime_process(process_id)
    if not isinstance(current_process, dict):
        return snapshot
    session_state = _snapshot_session_state(process=current_process, stores=stores, process_id=process_id)
    if snapshot is None:
        workflow = current_process.get("workflow") if isinstance(current_process.get("workflow"), dict) else {}
        metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
        nodes = current_process.get("nodes") if isinstance(current_process.get("nodes"), dict) else {}
        active_steps = [node_id for node_id, row in nodes.items() if isinstance(row, dict) and str(row.get("status") or "") == "running"]
        waiting_steps = [node_id for node_id, row in nodes.items() if isinstance(row, dict) and str(row.get("status") or "") in {"waiting", "blocked", "ready", "pending"}]
        completed_steps = [node_id for node_id, row in nodes.items() if isinstance(row, dict) and str(row.get("status") or "") == "completed"]
        failed_steps = [node_id for node_id, row in nodes.items() if isinstance(row, dict) and str(row.get("status") or "") in {"failed", "cancelled"}]
        if str(current_process.get("status") or "") in {"completed"}:
            lifecycle_state = "completed"
        elif str(current_process.get("status") or "") in {"failed", "cancelled"}:
            lifecycle_state = "failed"
        elif active_steps:
            lifecycle_state = "running"
        else:
            lifecycle_state = "waiting"
        latest_event = stores["journal"].latest(process_id=process_id)
        if latest_event is None:
            latest_event = stores["journal"].append(
                process_id=process_id,
                kind="runtime_session_snapshot_bootstrap",
                actor="runtime-session",
                payload={"process_status": current_process.get("status"), "workflow_name": workflow.get("name")},
            )
        shared_state = stores["shared_state_store"].load(process_id)
        snapshot = ProcessSnapshot(
            process_id=process_id,
            last_event_id=latest_event.event_id,
            event_count=max(1, len(stores["journal"].load(process_id=process_id))),
            lifecycle_state=lifecycle_state,
            active_steps=active_steps,
            waiting_steps=waiting_steps,
            completed_steps=completed_steps,
            failed_steps=failed_steps,
            assigned_agents={node_id: owner for node_id, owner in dict((shared_state.agent_ownership if shared_state is not None else {}) or {}).items()},
            runtime_policy=dict(((metadata.get("policy") or {}).get("settings") or {})),
            session_state=session_state,
            world_state={**dict((shared_state.world_state if shared_state is not None else {}) or {}), "process_status": str(current_process.get("status") or lifecycle_state), "session_status": session_state.get("status")},
            belief_refs=list((shared_state.belief_refs if shared_state is not None else []) or []),
            artifact_refs=[],
            metadata={"bootstrapped_from_session_event": True},
        )
    snapshot.session_state = session_state
    snapshot.metadata = {**dict(snapshot.metadata or {}), "session_plane": {"status": session_state.get("status"), "watcher_count": session_state.get("watcher_count"), "session_count": len(session_state.get("sessions") or [])}}
    snapshot.world_state = {**dict(snapshot.world_state or {}), "session_status": session_state.get("status"), "session_retry_count": session_state.get("retry_count")}
    return snapshot_store.save(snapshot)


def _runtime_session_follow_up_context(process: Dict[str, Any]) -> Dict[str, Any]:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    conversation = metadata.get("runtime_conversation") if isinstance(metadata.get("runtime_conversation"), dict) else {}
    owned = bool(conversation.get("owned", True))
    channel = str(conversation.get("channel") or metadata.get("runtime_channel") or "").strip() or None
    conversation_id = str(conversation.get("conversation_id") or metadata.get("runtime_conversation_id") or "").strip() or None
    owner = str(conversation.get("owner") or process.get("owner") or metadata.get("owner") or "").strip() or None
    session_key = str(conversation.get("session_key") or process.get("session_key") or metadata.get("session_key") or "").strip() or None
    return {
        "owned": owned,
        "channel": channel,
        "conversation_id": conversation_id,
        "owner": owner,
        "session_key": session_key,
    }


def _runtime_session_follow_up_policy(process: Dict[str, Any], *, stores: Dict[str, Any]) -> Dict[str, Any]:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    process_id = str(process.get("process_id") or "").strip()
    roadmap_contract = stores["roadmap_store"].load_contract(process_id) if process_id else None
    production_contract = stores["loop_store"].load_contract(process_id) if process_id else None
    roadmap_policy = model_dump_compat(getattr(roadmap_contract, "reporting_policy", None)) if roadmap_contract is not None and getattr(roadmap_contract, "reporting_policy", None) is not None else None
    production_policy = model_dump_compat(getattr(production_contract, "checkpoint_policy", None)) if production_contract is not None and getattr(production_contract, "checkpoint_policy", None) is not None else None
    return resolve_session_follow_up_policy(
        workflow_metadata=metadata,
        roadmap_reporting_policy=roadmap_policy,
        production_checkpoint_policy=production_policy,
    )


_SESSION_FOLLOW_UP_EVENT_KINDS = {
    "session.blocked": "blocker",
    "session.retry-needed": "retry",
    "session.test-failed": "test_failure",
    "session.stale": "stale",
    "session.handoff-needed": "handoff",
    "session.failed": "failure",
    "session.pr-created": "pr",
}


def _enqueue_session_follow_up(*, process: Dict[str, Any], event: Any, stores: Dict[str, Any]) -> Optional[RuntimeFollowUpDispatch]:
    update_kind = _SESSION_FOLLOW_UP_EVENT_KINDS.get(str(event.kind or "").strip())
    if not update_kind:
        return None
    context = _runtime_session_follow_up_context(process)
    policy = _runtime_session_follow_up_policy(process, stores=stores)
    if not session_follow_up_allowed(policy, update_kind=update_kind):
        return None
    summary = str(event.summary or event.operator_summary).strip() or event.kind
    fingerprint = f"session:{process.get('process_id')}:{event.session_id or process.get('process_id')}:{event.kind}:{summary}"
    record = stores["follow_up_store"].enqueue(
        RuntimeFollowUpDispatch(
            process_id=str(process.get("process_id") or "").strip(),
            runtime_kind="session",
            fingerprint=fingerprint,
            update_kind=update_kind,
            title="[Cortex] Session follow-up",
            message=summary,
            status=str(event.kind or "session.event"),
            channel=context.get("channel"),
            owner=context.get("owner"),
            session_key=context.get("session_key"),
            conversation_id=context.get("conversation_id"),
            objective=str(((process.get("workflow") or {}).get("name")) or "").strip() or None,
            summary=summary,
            metadata={
                "session_id": event.session_id,
                "session_name": event.session_name,
                "tool": event.tool,
                "operator_summary": event.operator_summary,
                "owned": context.get("owned"),
                "policy_source": policy.get("source"),
            },
        )
    )
    if bool(policy.get("auto_send_owned_whatsapp")) and context.get("owned") and str(context.get("channel") or "").strip().lower() == "whatsapp":
        success, error = _deliver_runtime_follow_up(record)
        now_iso = datetime.now().astimezone().isoformat(timespec="milliseconds").replace("+00:00", "Z")
        if success:
            return stores["follow_up_store"].mark_sent(record.dispatch_id, when_iso=now_iso)
        return stores["follow_up_store"].mark_failed(record.dispatch_id, error=str(error or "send_failed"), when_iso=now_iso)
    return record



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
                session_state=_snapshot_session_state(process=process, stores=stores, process_id=process_id),
                world_state={**dict(shared_state.world_state), "process_status": str(process.get("status") or lifecycle_state)},
                belief_refs=list(shared_state.belief_refs),
                artifact_refs=[],
                metadata={"bootstrapped_from_runtime_process": True},
            )
        )
    else:
        snapshot = _upsert_runtime_snapshot_session_state(process_id=process_id, stores=stores, process=process) or snapshot
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
    merged_metadata.setdefault("owner", process.get("owner") or metadata.get("owner"))
    merged_metadata.setdefault("session_key", process.get("session_key") or metadata.get("session_key"))
    if metadata.get("channel") and not merged_metadata.get("channel"):
        merged_metadata["channel"] = metadata.get("channel")
    if metadata.get("conversation_id") and not merged_metadata.get("conversation_id"):
        merged_metadata["conversation_id"] = metadata.get("conversation_id")
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
        "conversation_ownership": dict(loop_state.conversation_ownership or {}) if loop_state is not None else {},
        "follow_through": dict(loop_state.follow_through or {}) if loop_state is not None else {},
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
        desired_metadata["delivery_follow_up_due_at"] = (loop_state.owed_follow_up or {}).get("due_at") if isinstance(loop_state.owed_follow_up, dict) else None
        desired_metadata["delivery_conversation_ownership"] = dict(loop_state.conversation_ownership or {})
        desired_metadata["delivery_follow_through"] = dict(loop_state.follow_through or {})
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
    human_blockers = any(bool((row or {}).get("requires_human")) for row in blockers)
    status = "completed" if completion.get("all_required_satisfied") and not blockers else ("blocked" if human_blockers else "active")
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
            conversation_ownership=dict(current.conversation_ownership or {}) if current is not None else {},
            follow_through={
                **(dict(current.follow_through or {}) if current is not None else {}),
                "continuation": {"mode": "await_external_progress", "terminal": False, "reason": "rollback", "status": status},
                "next_action": {"kind": "rollback_checkpoint", "status": status, "stage": release_state.current_stage},
                "updated_at": report.recorded_at,
            },
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
    merged_metadata.setdefault("owner", process.get("owner") or metadata.get("owner"))
    merged_metadata.setdefault("session_key", process.get("session_key") or metadata.get("session_key"))
    if metadata.get("channel") and not merged_metadata.get("channel"):
        merged_metadata["channel"] = metadata.get("channel")
    if metadata.get("conversation_id") and not merged_metadata.get("conversation_id"):
        merged_metadata["conversation_id"] = metadata.get("conversation_id")
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
        "conversation_ownership": dict((state or {}).get("conversation_ownership") or {}),
        "follow_through": dict((state or {}).get("follow_through") or {}),
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
        desired_metadata["roadmap_follow_up_due_at"] = (state.owed_follow_up or {}).get("due_at") if isinstance(state.owed_follow_up, dict) else None
        desired_metadata["roadmap_conversation_ownership"] = dict(state.conversation_ownership or {})
        desired_metadata["roadmap_follow_through"] = dict(state.follow_through or {})

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



def _bridge_runtime_delivery_follow_up(
    process_id: str,
    *,
    process: Dict[str, Any],
    stores: Dict[str, Any],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    loop_state = stores["loop_store"].load_state(process_id)
    contract = stores["loop_store"].load_contract(process_id)
    reports = stores["loop_store"].reports(process_id)
    latest_report = reports[-1] if reports else None
    if loop_state is None:
        return {"process": process, "dispatch": None}
    state_payload = model_dump_compat(loop_state)
    previous_state_payload = json.loads(json.dumps(state_payload))
    dispatch = _bridge_runtime_follow_up(
        process_id=process_id,
        runtime_kind="delivery",
        objective=contract.objective if contract is not None else process.get("workflow", {}).get("name"),
        state=state_payload,
        latest_report=model_dump_compat(latest_report) if latest_report is not None else None,
        follow_up_store=stores["follow_up_store"],
        now=now,
    )
    if dispatch is None:
        return {"process": process, "dispatch": None}
    updated_state = _apply_runtime_follow_up_state(
        state=state_payload,
        conversation=dict(state_payload.get("conversation_ownership") or {}),
        record=dispatch,
    )
    if updated_state != previous_state_payload:
        stores["loop_store"].save_state(updated_state)
        process = _sync_runtime_process_delivery_state(
            process_id,
            process=process,
            stores=stores,
            event_kind=f"runtime_delivery_follow_up_{dispatch.delivery_status}",
            event_payload={
                "dispatch_id": dispatch.dispatch_id,
                "delivery_status": dispatch.delivery_status,
                "report_id": dispatch.report_id,
                "fingerprint": dispatch.fingerprint,
            },
        )
    return {"process": process, "dispatch": model_dump_compat(dispatch)}



def _bridge_runtime_roadmap_follow_up(
    process_id: str,
    *,
    process: Dict[str, Any],
    stores: Dict[str, Any],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    state = stores["roadmap_store"].load_state(process_id)
    contract = stores["roadmap_store"].load_contract(process_id)
    reports = stores["roadmap_store"].reports(process_id)
    latest_report = reports[-1] if reports else None
    if state is None:
        return {"process": process, "dispatch": None}
    state_payload = model_dump_compat(state)
    previous_state_payload = json.loads(json.dumps(state_payload))
    dispatch = _bridge_runtime_follow_up(
        process_id=process_id,
        runtime_kind="roadmap",
        objective=contract.objective if contract is not None else process.get("workflow", {}).get("name"),
        state=state_payload,
        latest_report=model_dump_compat(latest_report) if latest_report is not None else None,
        follow_up_store=stores["follow_up_store"],
        now=now,
    )
    if dispatch is None:
        return {"process": process, "dispatch": None}
    updated_state = _apply_runtime_follow_up_state(
        state=state_payload,
        conversation=dict(state_payload.get("conversation_ownership") or {}),
        record=dispatch,
    )
    if updated_state != previous_state_payload:
        stores["roadmap_store"].save_state(updated_state)
        process = _sync_runtime_process_roadmap_state(
            process_id,
            process=process,
            stores=stores,
            event_kind=f"runtime_roadmap_follow_up_{dispatch.delivery_status}",
            event_payload={
                "dispatch_id": dispatch.dispatch_id,
                "delivery_status": dispatch.delivery_status,
                "report_id": dispatch.report_id,
                "fingerprint": dispatch.fingerprint,
            },
        )
    return {"process": process, "dispatch": model_dump_compat(dispatch)}



def _maintenance_queue_item_projection(
    item: MaintenanceQueueItem,
    *,
    process: Optional[Dict[str, Any]],
    state: Optional[Dict[str, Any]],
    latest_report: Optional[Dict[str, Any]],
    stores: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    conversation = dict((state or {}).get("conversation_ownership") or {})
    follow_through = dict((state or {}).get("follow_through") or {})
    metadata = dict(item.metadata or {})
    session_plane = None
    if item.process_id and isinstance(stores, dict):
        session_plane = _snapshot_session_state(process=process or (get_runtime_process(item.process_id) or {}), stores=stores, process_id=item.process_id)
    return {
        "item_id": item.item_id,
        "queue_name": item.queue_name,
        "status": item.status,
        "priority": int(item.priority or 0),
        "objective": item.objective,
        "summary": item.summary,
        "item_kind": item.item_kind,
        "process_id": item.process_id,
        "workflow_name": ((process or {}).get("workflow") or {}).get("name") if isinstance((process or {}).get("workflow"), dict) else None,
        "process_status": (process or {}).get("status") if isinstance(process, dict) else None,
        "roadmap_status": (state or {}).get("status"),
        "roadmap_liveness": (state or {}).get("liveness"),
        "active_phase_id": (state or {}).get("active_phase_id"),
        "active_task_ids": list((state or {}).get("active_task_ids") or []),
        "next_action": dict((state or {}).get("next_action") or {}),
        "continuation": dict((state or {}).get("continuation") or {}),
        "owed_follow_up": dict((state or {}).get("owed_follow_up") or {}),
        "session_plane": session_plane,
        "conversation_ownership": conversation,
        "follow_through": follow_through,
        "latest_report_kind": (latest_report or {}).get("kind"),
        "latest_report_summary": (latest_report or {}).get("summary"),
        "latest_report_reasons": list((((latest_report or {}).get("metadata") if isinstance((latest_report or {}).get("metadata"), dict) else {}) or {}).get("reasons") or []),
        "source": {
            "channel": ((item.source_message or {}).get("channel") if isinstance(item.source_message, dict) else None),
            "conversation_id": ((item.source_message or {}).get("conversation_id") if isinstance(item.source_message, dict) else None),
            "message_id": ((item.source_message or {}).get("message_id") if isinstance(item.source_message, dict) else None),
            "from_user": ((item.source_message or {}).get("from_user") if isinstance(item.source_message, dict) else None),
        },
        "done_world_state_key": metadata.get("done_world_state_key"),
        "maintenance_metadata": dict(metadata.get("maintenance_queue") or {}),
        "created_at": item.created_at,
        "claimed_at": item.claimed_at,
        "completed_at": item.completed_at,
        "blocked_at": item.blocked_at,
        "last_transition_at": item.last_transition_at,
    }



def _runtime_maintenance_queue_status_payload(*, stores: Dict[str, Any]) -> Dict[str, Any]:
    queue_state = stores["maintenance_queue_store"].get_state()
    items = stores["maintenance_queue_store"].list()
    counts = {
        "pending": sum(1 for item in items if item.status == "pending"),
        "active": sum(1 for item in items if item.status == "active"),
        "completed": sum(1 for item in items if item.status == "completed"),
        "blocked": sum(1 for item in items if item.status == "blocked"),
    }
    session_counts: Dict[str, int] = {}
    for item in items:
        projection = item.projection if isinstance(item.projection, dict) else {}
        session_plane = projection.get("session_plane") if isinstance(projection.get("session_plane"), dict) else {}
        session_status = str(session_plane.get("status") or "none").strip() or "none"
        session_counts[session_status] = session_counts.get(session_status, 0) + 1
    return {
        "success": True,
        "queue": {
            "version": queue_state.version,
            "updated_at": queue_state.updated_at,
            "max_active_items": int(queue_state.max_active_items or 1),
            "counts": counts,
            "session_counts": session_counts,
            "items": [model_dump_compat(item) for item in items],
        },
    }



def _maintenance_queue_intake_text(request: RuntimeMaintenanceIntakeRequest) -> str:
    message_text = str(request.message.text or "").strip()
    direct_text = str(request.text or "").strip()
    title = str(request.title or "").strip()
    objective = str(request.objective or "").strip()
    return direct_text or message_text or title or objective



def _maintenance_queue_objective(request: RuntimeMaintenanceIntakeRequest) -> str:
    objective = str(request.objective or request.title or "").strip()
    if objective:
        return objective
    text = _maintenance_queue_intake_text(request)
    if not text:
        raise HTTPException(status_code=400, detail="maintenance intake requires objective/title/text/message.text")
    condensed = " ".join(text.split())
    return condensed[:120] if len(condensed) > 120 else condensed



def _build_runtime_maintenance_contract(item_id: str, request: RuntimeMaintenanceIntakeRequest) -> RoadmapObjectiveContract:
    objective = _maintenance_queue_objective(request)
    source_text = _maintenance_queue_intake_text(request) or objective
    payload: Dict[str, Any] = {}
    if isinstance(request.contract, dict):
        payload.update(dict(request.contract))
    payload["process_id"] = str(payload.get("process_id") or f"pending:{item_id}")
    payload.setdefault("objective", objective)
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
    done_key = f"maintenance_queue.{item_id}.done"
    if not payload.get("phases"):
        payload["phases"] = [
            {
                "phase_id": "maintenance",
                "title": "Maintenance queue execution",
                "summary": "Drive the queued maintenance intake to completion",
            }
        ]
    if not payload.get("tasks"):
        payload["tasks"] = [
            {
                "task_id": "resolve_request",
                "phase_id": "maintenance",
                "title": objective,
                "summary": source_text,
                "work_type": str(request.item_kind or "maintenance").strip() or "maintenance",
                "quality_gates": [
                    {
                        "criterion_id": "maintenance-done",
                        "summary": "Queue item must be marked done in shared world state",
                        "kind": "world_state",
                        "world_state_key": done_key,
                        "expected_value": True,
                    }
                ],
            }
        ]
    if not payload.get("success_criteria"):
        payload["success_criteria"] = [
            {
                "criterion_id": "maintenance-done",
                "summary": "Queue item must be marked done in shared world state",
                "kind": "world_state",
                "world_state_key": done_key,
                "expected_value": True,
            }
        ]
    merged_metadata = dict(payload.get("metadata") or {})
    merged_metadata.update(dict(request.metadata or {}))
    merged_metadata.setdefault("owner", "cortex")
    if request.message.session_key and not merged_metadata.get("session_key"):
        merged_metadata["session_key"] = request.message.session_key
    if request.message.channel and not merged_metadata.get("channel"):
        merged_metadata["channel"] = request.message.channel
    if request.message.conversation_id and not merged_metadata.get("conversation_id"):
        merged_metadata["conversation_id"] = request.message.conversation_id
    merged_metadata["done_world_state_key"] = done_key
    merged_metadata["maintenance_queue"] = {
        "item_id": item_id,
        "queue_name": str(request.queue_name or "maintenance").strip() or "maintenance",
        "item_kind": str(request.item_kind or "maintenance").strip() or "maintenance",
        "source_message_id": str(request.message.message_id or "").strip() or None,
        "source_channel": str(request.message.channel or "").strip() or None,
        "source_conversation_id": str(request.message.conversation_id or "").strip() or None,
        "source_from_user": str(request.message.from_user or "").strip() or None,
        "source_text": source_text,
    }
    payload["metadata"] = merged_metadata
    return _validate_roadmap_contract(payload)



def _maintenance_queue_contract_for_process(item: MaintenanceQueueItem, *, process_id: str) -> RoadmapObjectiveContract:
    payload = dict(item.roadmap_contract or {})
    payload["process_id"] = process_id
    metadata = dict(payload.get("metadata") or {})
    metadata.setdefault("maintenance_queue", {})
    if isinstance(metadata.get("maintenance_queue"), dict):
        metadata["maintenance_queue"] = {**dict(metadata.get("maintenance_queue") or {}), "item_id": item.item_id, "queue_name": item.queue_name}
    payload["metadata"] = metadata
    return _validate_roadmap_contract(payload)



def _maintenance_queue_workflow(item: MaintenanceQueueItem) -> Dict[str, Any]:
    message = dict(item.source_message or {})
    metadata = {
        "owner": "cortex",
        "session_key": message.get("session_key"),
        "channel": message.get("channel"),
        "conversation_id": message.get("conversation_id"),
        "maintenance_queue_item_id": item.item_id,
        "maintenance_queue": {
            "item_id": item.item_id,
            "queue_name": item.queue_name,
            "item_kind": item.item_kind,
            "source_message_id": message.get("message_id"),
        },
    }
    return {
        "name": item.objective,
        "metadata": metadata,
        "steps": [
            {
                "node_id": "maintenance_intake",
                "title": "Advance maintenance intake",
                "endpoint": "/oracle/chat",
                "payload": {"message": item.source_text or item.objective},
                "metadata": {"maintenance_queue_item_id": item.item_id, "source_message": message},
            }
        ],
    }



def _maintenance_queue_process_id(item: MaintenanceQueueItem) -> str:
    suffix = "".join(ch for ch in str(item.item_id or "") if ch.isalnum())[-12:] or "item"
    return f"proc_maintenance_{suffix}"



def _runtime_maintenance_queue_sync(
    *,
    stores: Dict[str, Any],
    now: Optional[datetime] = None,
    allow_claim: bool = True,
) -> Dict[str, Any]:
    current_time = now or datetime.now().astimezone()
    now_iso = current_time.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    queue_store = stores["maintenance_queue_store"]
    queue_state = queue_store.get_state()
    items = list(queue_state.items)
    by_id = {item.item_id: item for item in items}
    actions: List[Dict[str, Any]] = []
    active_count = 0
    pending: List[MaintenanceQueueItem] = []

    ordered = sorted(items, key=lambda row: (int(row.priority or 0), str(row.created_at), str(row.item_id)))
    for item in ordered:
        process = get_runtime_process(item.process_id) if item.process_id else None
        roadmap_state_model = stores["roadmap_store"].load_state(item.process_id) if item.process_id else None
        reports = stores["roadmap_store"].reports(item.process_id) if item.process_id else []
        latest_report_model = reports[-1] if reports else None
        state_payload = model_dump_compat(roadmap_state_model) if roadmap_state_model is not None else None
        latest_report = model_dump_compat(latest_report_model) if latest_report_model is not None else None
        derived_status = item.status
        if isinstance(state_payload, dict):
            derived = str(state_payload.get("status") or "").strip()
            if derived in {"active", "completed", "blocked"}:
                derived_status = derived
        session_plane = _snapshot_session_state(process=process, stores=stores, process_id=item.process_id) if item.process_id and isinstance(process, dict) else None
        if derived_status == "active" and isinstance(session_plane, dict) and session_plane_is_blocking(session_plane):
            derived_status = "blocked"
        if derived_status == "active":
            active_count += 1
            item.claimed_at = item.claimed_at or now_iso
        elif derived_status == "pending":
            pending.append(item)
        elif derived_status == "completed":
            item.completed_at = item.completed_at or now_iso
            item.blocked_at = None
        elif derived_status == "blocked":
            item.blocked_at = item.blocked_at or now_iso
        if derived_status != item.status:
            item.status = derived_status
            item.last_transition_at = now_iso
        item.projection = _maintenance_queue_item_projection(item, process=process, state=state_payload, latest_report=latest_report, stores=stores)
        by_id[item.item_id] = item

    capacity = max(1, int(queue_state.max_active_items or 1))
    if allow_claim and active_count < capacity:
        available = capacity - active_count
        for item in pending[:available]:
            process = get_runtime_process(item.process_id) if item.process_id else None
            if process is None:
                process = create_process_from_workflow(
                    _maintenance_queue_workflow(item),
                    process_id=item.process_id or _maintenance_queue_process_id(item),
                    owner="cortex",
                    session_key=str((item.source_message or {}).get("session_key") or "").strip() or None,
                )
            item.process_id = process.get("process_id")
            _ensure_runtime_session_plane_bootstrap(item.process_id, process=process, stores=stores)
            _bootstrap_runtime_delivery_state(item.process_id, process=process, stores=stores)
            contract = _maintenance_queue_contract_for_process(item, process_id=item.process_id)
            reconciled = reconcile_roadmap_execution(
                contract,
                roadmap_store=stores["roadmap_store"],
                snapshot_store=stores["snapshot_store"],
                shared_state_store=stores["shared_state_store"],
                mailbox=stores["mailbox"],
                supervisor=stores["supervisor"],
                release_store=stores["release_store"],
                controller_id="maintenance-queue",
                controller_session_id=f"maintenance-queue:{item.item_id}",
                journal=stores["journal"],
                now=current_time,
            )
            process = _sync_runtime_process_roadmap_state(
                item.process_id,
                process=get_runtime_process(item.process_id) or process,
                stores=stores,
                event_kind="runtime_maintenance_queue_claimed",
                event_payload={"item_id": item.item_id, "queue_name": item.queue_name, "status": (reconciled.get("state") or {}).get("status")},
            )
            follow_up_bridge = _bridge_runtime_roadmap_follow_up(item.process_id, process=process, stores=stores, now=current_time)
            process = follow_up_bridge.get("process") or process
            latest_state_model = stores["roadmap_store"].load_state(item.process_id)
            latest_reports = stores["roadmap_store"].reports(item.process_id)
            latest_report_model = latest_reports[-1] if latest_reports else None
            state_payload = model_dump_compat(latest_state_model) if latest_state_model is not None else ((reconciled.get("state") if isinstance(reconciled.get("state"), dict) else None) or {})
            latest_report = model_dump_compat(latest_report_model) if latest_report_model is not None else (reconciled.get("report") if isinstance(reconciled.get("report"), dict) else None)
            item.status = str(state_payload.get("status") or "active").strip() or "active"
            item.claimed_at = item.claimed_at or now_iso
            if item.status == "completed":
                item.completed_at = item.completed_at or now_iso
            if item.status == "blocked":
                item.blocked_at = item.blocked_at or now_iso
            item.last_transition_at = now_iso
            item.projection = _maintenance_queue_item_projection(item, process=process, state=state_payload, latest_report=latest_report, stores=stores)
            by_id[item.item_id] = item
            actions.append(
                {
                    "kind": "maintenance_queue_claim",
                    "item_id": item.item_id,
                    "queue_name": item.queue_name,
                    "process_id": item.process_id,
                    "status": item.status,
                    "objective": item.objective,
                    "follow_up_dispatch": follow_up_bridge.get("dispatch"),
                }
            )
            if item.status == "active":
                active_count += 1

    persisted = [by_id[item.item_id] for item in items]
    queue_store.replace_items(persisted, max_active_items=queue_state.max_active_items)
    return {
        "max_active_items": capacity,
        "active_count": sum(1 for item in persisted if item.status == "active"),
        "pending_count": sum(1 for item in persisted if item.status == "pending"),
        "blocked_count": sum(1 for item in persisted if item.status == "blocked"),
        "completed_count": sum(1 for item in persisted if item.status == "completed"),
        "actions": actions,
        "action_count": len(actions),
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


class RuntimeSessionRegisterRequest(BaseModel):
    process_id: str
    session_id: str
    session_name: Optional[str] = None
    tool: Optional[str] = None
    source: str = "runtime"
    stale_after_seconds: int = 900
    parent_process: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RuntimeSessionEventRequest(BaseModel):
    process_id: str
    event: str
    session_id: Optional[str] = None
    session_name: Optional[str] = None
    tool: Optional[str] = None
    summary: Optional[str] = None
    status: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class RuntimeSessionHeartbeatRequest(BaseModel):
    process_id: str
    session_id: str
    stale_after_seconds: Optional[int] = None


class RuntimeWatcherRegisterRequest(BaseModel):
    process_id: str
    kind: str
    target: str
    session_id: Optional[str] = None
    session_name: Optional[str] = None
    tool: Optional[str] = None
    debounce_seconds: float = 1.0
    stale_after_seconds: int = 900
    keywords: List[str] = Field(default_factory=list)
    enabled: bool = True
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RuntimeWatcherReconcileRequest(BaseModel):
    now_iso: Optional[str] = None


class RuntimeMemoryNoteRequest(BaseModel):
    process_id: str
    title: str
    note: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RuntimeToolIngestRequest(BaseModel):
    process_id: str
    tool: str
    event: str
    session_id: Optional[str] = None
    session_name: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


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


class AgentWorkPlanRequest(BaseModel):
    graph: ReasoningPlanGraph
    repo_path: str
    goal_id: Optional[str] = None
    run_id: Optional[str] = None
    owner: Optional[str] = None
    session: Dict[str, Any] = Field(default_factory=dict)
    fidelity: Optional[str] = None
    requested_agent_count: Optional[int] = None
    permissions: Dict[str, Any] = Field(default_factory=dict)
    budgets: Dict[str, Any] = Field(default_factory=dict)
    wave_policy: Dict[str, Any] = Field(default_factory=dict)
    expansion_policy: Dict[str, Any] = Field(default_factory=dict)
    evidence_schemas: List[Dict[str, Any]] = Field(default_factory=list)
    templates: List[Dict[str, Any]] = Field(default_factory=list)
    route_levels: List[str] = Field(default_factory=list)
    memory_citations: List[str] = Field(default_factory=list)


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


class RuntimeMaintenanceIntakeMessage(BaseModel):
    text: Optional[str] = None
    channel: Optional[str] = None
    conversation_id: Optional[str] = None
    session_key: Optional[str] = None
    from_user: Optional[str] = None
    message_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RuntimeMaintenanceIntakeRequest(BaseModel):
    message: RuntimeMaintenanceIntakeMessage = Field(default_factory=RuntimeMaintenanceIntakeMessage)
    objective: Optional[str] = None
    title: Optional[str] = None
    text: Optional[str] = None
    item_kind: str = "maintenance"
    priority: int = 100
    queue_name: str = "maintenance"
    max_active_items: Optional[int] = None
    contract: Optional[Dict[str, Any]] = None
    success_criteria: Optional[List[Dict[str, Any]]] = None
    phases: Optional[List[Dict[str, Any]]] = None
    tasks: Optional[List[Dict[str, Any]]] = None
    blocker_rules: Optional[List[Dict[str, Any]]] = None
    dependability_profile: Optional[Any] = None
    reporting_policy: Optional[Dict[str, Any]] = None
    execution_budget: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


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
    required_targets = [
        internal_url('/health'),
        internal_url('/oracle/status'),
        internal_url('/augmenter/status'),
    ]
    try:
        async with httpx.AsyncClient(timeout=4.0, trust_env=False) as client:
            for target in required_targets:
                watch_response = await client.post(
                    internal_url('/sentinel/watch'),
                    json={
                        'name': 'orchestrator-required-preflight',
                        'watch_type': 'endpoint',
                        'target': target,
                        'timeout_seconds': 1.5,
                    },
                )
                watch_response.raise_for_status()
                watch_payload = watch_response.json()
                if not isinstance(watch_payload, dict) or watch_payload.get('success') is not True or not watch_payload.get('watch_id'):
                    raise RuntimeError('malformed_sentinel_watch_response')
            r = await client.post(SENTINEL_SCAN_URL, json={})
            r.raise_for_status()
            payload = r.json()
            scan = payload.get('scan') if isinstance(payload, dict) else None
            results = scan.get('results') if isinstance(scan, dict) else None
            if not isinstance(results, list):
                raise RuntimeError('malformed_sentinel_scan_results')
            by_target = {
                str(row.get('target')): row
                for row in results
                if isinstance(row, dict) and row.get('target')
            }
            for target in required_targets:
                result = by_target.get(target)
                try:
                    status_code = int(result.get('status_code')) if isinstance(result, dict) else 0
                except (TypeError, ValueError):
                    status_code = 0
                if not isinstance(result, dict) or result.get('ok') is not True or not 0 < status_code < 400:
                    raise RuntimeError(f'sentinel_required_target_failed:{target}')
            return payload
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


FOLLOW_UP_RETRY_SECONDS = int(os.getenv("ORCHESTRATOR_FOLLOW_UP_RETRY_SECONDS", "30"))
FOLLOW_UP_REPEAT_GRACE_SECONDS = int(os.getenv("ORCHESTRATOR_FOLLOW_UP_REPEAT_GRACE_SECONDS", "60"))
FOLLOW_UP_REASON_MARKERS = {
    "review_due",
    "status_followup_due",
    "blocker_followup_due",
    "idle_recovery",
    "human_blocker",
    "blocked",
    "completed",
}



def _runtime_follow_up_fingerprint(*, process_id: str, runtime_kind: str, report: Optional[Dict[str, Any]], pending_intent: Dict[str, Any]) -> Optional[str]:
    if isinstance(report, dict) and str(report.get("report_id") or "").strip():
        return f"{runtime_kind}:{process_id}:report:{str(report.get('report_id')).strip()}"
    due_at = str(pending_intent.get("due_at") or "").strip()
    intent_kind = str(pending_intent.get("kind") or "status").strip() or "status"
    status = str(pending_intent.get("status") or "active").strip() or "active"
    reason = str(pending_intent.get("reason") or "follow_up_due").strip() or "follow_up_due"
    if not due_at:
        return None
    return f"{runtime_kind}:{process_id}:intent:{intent_kind}:{status}:{due_at}:{reason}"



def _runtime_follow_up_title(*, runtime_kind: str, report: Optional[Dict[str, Any]], pending_intent: Dict[str, Any]) -> str:
    report_kind = str((report or {}).get("kind") or "").strip()
    intent_kind = str(pending_intent.get("kind") or "status").strip() or "status"
    if report_kind == "completed":
        return "[Cortex] Runtime completed"
    if report_kind == "blocked" or intent_kind == "blocker":
        return "[Cortex] Runtime blocker"
    return "[Cortex] Runtime update"



def _runtime_follow_up_message(
    *,
    runtime_kind: str,
    objective: Optional[str],
    report: Optional[Dict[str, Any]],
    state: Dict[str, Any],
    pending_intent: Dict[str, Any],
) -> str:
    report = dict(report or {})
    summary = str(report.get("summary") or pending_intent.get("reason") or objective or f"{runtime_kind} follow-up due").strip()
    status = str(report.get("status") or state.get("status") or pending_intent.get("status") or "active").strip() or "active"
    next_action = dict(state.get("next_action") or {})
    blockers = [row for row in list(report.get("blockers") or state.get("true_blockers") or []) if isinstance(row, dict)]
    reasons = list(((report.get("metadata") if isinstance(report.get("metadata"), dict) else {}) or {}).get("reasons") or [])

    lines = [summary]
    if objective:
        lines.append(f"Objective: {objective}")
    lines.append(f"Status: {status}")
    if next_action:
        next_summary = str(next_action.get("summary") or next_action.get("kind") or "continue").strip()
        if next_summary:
            lines.append(f"Next: {next_summary}")
    if blockers:
        if str(pending_intent.get("kind") or "").strip() == "blocker" or status == "blocked":
            need = "; ".join(str((row or {}).get("summary") or (row or {}).get("reason") or "human decision needed").strip() for row in blockers[:3])
            if need:
                lines.append(f"Need from you: {need}")
        else:
            handling = "; ".join(str((row or {}).get("summary") or (row or {}).get("reason") or "runtime recovery in progress").strip() for row in blockers[:3])
            if handling:
                lines.append(f"Handling: {handling}")
    if reasons:
        lines.append(f"Why now: {', '.join(str(row).strip() for row in reasons[:4] if str(row).strip())}")
    return "\n".join(line for line in lines if line)



def _runtime_follow_up_plan(
    *,
    process_id: str,
    runtime_kind: str,
    objective: Optional[str],
    conversation: Dict[str, Any],
    follow_through: Dict[str, Any],
    state: Dict[str, Any],
    latest_report: Optional[Dict[str, Any]],
    now: datetime,
) -> Optional[RuntimeFollowUpDispatch]:
    if not bool(conversation.get("owned")):
        return None
    channel = str(conversation.get("channel") or "").strip().lower()
    conversation_id = str(conversation.get("conversation_id") or "").strip()
    if not channel and not conversation_id:
        return None
    if channel and channel != "whatsapp":
        return None
    pending_intent = dict(follow_through.get("pending_update_intent") or {})
    if not pending_intent:
        return None
    reasons = set(str(row).strip() for row in (((latest_report or {}).get("metadata") if isinstance((latest_report or {}).get("metadata"), dict) else {}) or {}).get("reasons") or [] if str(row).strip())
    report_kind = str((latest_report or {}).get("kind") or "").strip()
    report_due = bool(follow_through.get("report_due"))
    due_at = _parse_optional_dt(str(pending_intent.get("due_at") or "").strip() or None)
    follow_up_due = due_at is not None and due_at <= now
    summary = str((latest_report or {}).get("summary") or pending_intent.get("reason") or objective or f"{runtime_kind} follow-up due").strip()
    status = str(state.get("status") or pending_intent.get("status") or "active").strip() or "active"
    update_kind = str(pending_intent.get("kind") or "status").strip() or "status"
    last_outbound = dict(follow_through.get("outbound_update") or {})
    last_sent_at = _parse_optional_dt(str(last_outbound.get("sent_at") or "").strip() or None)
    if last_sent_at is not None and due_at is not None and now < due_at and report_kind not in {"blocked", "completed"} and update_kind != "blocker":
        return None
    if last_sent_at is not None and report_kind not in {"blocked", "completed"} and update_kind != "blocker":
        repeated_summary = str(last_outbound.get("summary") or "").strip() == summary
        repeated_status = str(last_outbound.get("status") or "").strip() == status
        repeated_kind = str(last_outbound.get("kind") or "status").strip() == update_kind
        if repeated_summary and repeated_status and repeated_kind and (now - last_sent_at).total_seconds() < max(1, FOLLOW_UP_REPEAT_GRACE_SECONDS):
            return None
    eligible = bool(report_due or follow_up_due or reasons.intersection(FOLLOW_UP_REASON_MARKERS) or report_kind in {"blocked", "completed"})
    if not eligible:
        return None
    fingerprint = _runtime_follow_up_fingerprint(process_id=process_id, runtime_kind=runtime_kind, report=latest_report, pending_intent=pending_intent)
    if not fingerprint:
        return None
    return RuntimeFollowUpDispatch(
        process_id=process_id,
        runtime_kind=runtime_kind,
        fingerprint=fingerprint,
        update_kind=update_kind,
        title=_runtime_follow_up_title(runtime_kind=runtime_kind, report=latest_report, pending_intent=pending_intent),
        message=_runtime_follow_up_message(runtime_kind=runtime_kind, objective=objective, report=latest_report, state=state, pending_intent=pending_intent),
        status=status,
        channel=channel or None,
        owner=str(conversation.get("owner") or "").strip() or None,
        session_key=str(conversation.get("session_key") or "").strip() or None,
        conversation_id=str(conversation.get("conversation_id") or "").strip() or None,
        objective=str(objective or "").strip() or None,
        report_id=str((latest_report or {}).get("report_id") or "").strip() or None,
        due_at=str(pending_intent.get("due_at") or "").strip() or None,
        summary=summary or None,
        metadata={
            "latest_report_kind": report_kind or None,
            "latest_report_reasons": sorted(reasons),
            "next_action": dict(state.get("next_action") or {}),
            "continuation": dict(state.get("continuation") or {}),
            "pending_update_intent": pending_intent,
        },
    )



def _runtime_follow_up_attempt_allowed(record: RuntimeFollowUpDispatch, *, now: datetime) -> bool:
    if str(record.delivery_status or "") == "sent":
        return False
    if str(record.delivery_status or "") == "skipped":
        return False
    last_attempt = _parse_optional_dt(record.last_attempt_at)
    if last_attempt is None:
        return True
    return (now - last_attempt).total_seconds() >= max(1, FOLLOW_UP_RETRY_SECONDS)



def _deliver_runtime_follow_up(record: RuntimeFollowUpDispatch) -> tuple[bool, Optional[str]]:
    try:
        diplomat = get_diplomat()
        success = bool(diplomat.send_briefing(message=record.message, title=record.title))
        return success, None if success else "diplomat_send_failed"
    except Exception as exc:  # pragma: no cover - defensive guard
        return False, str(exc)



def _apply_runtime_follow_up_state(
    *,
    state: Dict[str, Any],
    conversation: Dict[str, Any],
    record: RuntimeFollowUpDispatch,
) -> Dict[str, Any]:
    follow_through = dict(state.get("follow_through") or {})
    last_intent = dict(follow_through.get("last_user_visible_update_intent") or {})
    if record.sent_at:
        last_intent = {
            **last_intent,
            "dispatch_id": record.dispatch_id,
            "delivery_status": record.delivery_status,
            "sent_at": record.sent_at,
        }
    follow_through["outbound_update"] = {
        "dispatch_id": record.dispatch_id,
        "fingerprint": record.fingerprint,
        "report_id": record.report_id,
        "kind": record.update_kind,
        "status": record.status,
        "delivery_status": record.delivery_status,
        "attempt_count": int(record.attempt_count or 0),
        "last_attempt_at": record.last_attempt_at,
        "sent_at": record.sent_at,
        "last_error": record.last_error,
        "summary": record.summary,
        "due_at": record.due_at,
    }
    follow_through["last_user_visible_update_intent"] = last_intent
    if record.sent_at:
        follow_through["last_user_visible_update_at"] = record.sent_at
        conversation["last_user_visible_update_at"] = record.sent_at
    state["follow_through"] = follow_through
    state["conversation_ownership"] = conversation
    return state



def _bridge_runtime_follow_up(
    *,
    process_id: str,
    runtime_kind: str,
    objective: Optional[str],
    state: Optional[Dict[str, Any]],
    latest_report: Optional[Dict[str, Any]],
    follow_up_store: RuntimeFollowUpStore,
    now: Optional[datetime] = None,
) -> Optional[RuntimeFollowUpDispatch]:
    if not isinstance(state, dict):
        return None
    current_time = now or datetime.now().astimezone()
    conversation = dict(state.get("conversation_ownership") or {})
    follow_through = dict(state.get("follow_through") or {})
    plan = _runtime_follow_up_plan(
        process_id=process_id,
        runtime_kind=runtime_kind,
        objective=objective,
        conversation=conversation,
        follow_through=follow_through,
        state=state,
        latest_report=latest_report,
        now=current_time,
    )
    if plan is None:
        return None
    record = follow_up_store.enqueue(plan)
    if not _runtime_follow_up_attempt_allowed(record, now=current_time):
        return record
    success, error = _deliver_runtime_follow_up(record)
    now_iso = current_time.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if success:
        return follow_up_store.mark_sent(record.dispatch_id, when_iso=now_iso)
    return follow_up_store.mark_failed(record.dispatch_id, error=str(error or "send_failed"), when_iso=now_iso)



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
                follow_up_bridge = _bridge_runtime_roadmap_follow_up(process_id, process=process, stores=stores, now=now)
                process = follow_up_bridge.get("process") or process
                actions.append({"kind": "roadmap", "process_id": process_id, "decision": decision, "status": (reconciled.get("state") or {}).get("status"), "report": (reconciled.get("report") or {}).get("kind") if isinstance(reconciled.get("report"), dict) else None, "follow_up_dispatch": follow_up_bridge.get("dispatch")})
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
                follow_up_bridge = _bridge_runtime_delivery_follow_up(process_id, process=process, stores=stores, now=now)
                process = follow_up_bridge.get("process") or process
                actions.append({"kind": "delivery", "process_id": process_id, "decision": decision, "status": (reconciled.get("state") or {}).get("status"), "report": (reconciled.get("report") or {}).get("kind") if isinstance(reconciled.get("report"), dict) else None, "follow_up_dispatch": follow_up_bridge.get("dispatch")})
                continue
        roadmap_state = stores["roadmap_store"].load_state(process_id)
        loop_state = stores["loop_store"].load_state(process_id)
        if roadmap_state is not None or loop_state is not None:
            roadmap_bridge = _bridge_runtime_roadmap_follow_up(process_id, process=get_runtime_process(process_id) or process, stores=stores, now=now)
            if roadmap_bridge.get("dispatch") is not None:
                process = roadmap_bridge.get("process") or process
                actions.append({"kind": "roadmap_follow_up", "process_id": process_id, "decision": None, "status": roadmap_state.status if roadmap_state is not None else None, "report": None, "follow_up_dispatch": roadmap_bridge.get("dispatch")})
                continue
            delivery_bridge = _bridge_runtime_delivery_follow_up(process_id, process=get_runtime_process(process_id) or process, stores=stores, now=now)
            if delivery_bridge.get("dispatch") is not None:
                process = delivery_bridge.get("process") or process
                actions.append({"kind": "delivery_follow_up", "process_id": process_id, "decision": None, "status": loop_state.status if loop_state is not None else None, "report": None, "follow_up_dispatch": delivery_bridge.get("dispatch")})
    queue_actions = _runtime_maintenance_queue_sync(stores=stores, now=now, allow_claim=True)
    actions.extend(list(queue_actions.get("actions") or []))
    return {"reviewed": reviewed, "actions": actions, "action_count": len(actions), "maintenance_queue": queue_actions}


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


@router.post("/plan/agent-work")
async def create_agent_work_handoff(request: AgentWorkPlanRequest):
    """Compile an executable Cortex plan graph into an Agent Work DSL handoff."""
    try:
        handoff = compile_plan_to_agent_work_handoff(
            request.graph,
            repo_path=request.repo_path,
            goal_id=request.goal_id,
            run_id=request.run_id,
            owner=request.owner,
            session=request.session,
            fidelity=request.fidelity,
            requested_agent_count=request.requested_agent_count,
            permissions=request.permissions,
            budgets=request.budgets,
            wave_policy=request.wave_policy,
            expansion_policy=request.expansion_policy,
            evidence_schemas=request.evidence_schemas,
            templates=request.templates,
            route_levels=request.route_levels,
            memory_citations=request.memory_citations,
        )
        handoff_payload = model_dump_compat(handoff)
        return {
            "success": True,
            "schemaVersion": handoff_payload.get("schemaVersion"),
            "handoff": handoff_payload,
            "agent_work_spec": compile_handoff_to_agent_work_spec(handoff),
        }
    except (PlanGraphError, ValueError) as exc:
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
        scheduled = runtime_service.schedule_runtime_plan(
            request,
            workflow=workflow,
            build_workflow_policy_fn=build_workflow_policy,
            create_process_from_workflow_fn=create_process_from_workflow,
        )
        stores = _runtime_delivery_stores()
        process_id = str(((scheduled.get("process") or {}).get("process_id")) or "").strip()
        process = get_runtime_process(process_id) if process_id else None
        bootstrap = _ensure_runtime_session_plane_bootstrap(process_id, process=process, stores=stores) if process_id and process else None
        if bootstrap is not None:
            scheduled["session_plane"] = bootstrap
        return scheduled
    except ReasoningSchedulerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/runtime/tick")
async def tick_runtime(request: RuntimeTickRequest):
    """Advance the reasoning runtime and optionally execute due ready nodes."""
    stores = _runtime_delivery_stores()
    if not bool(request.execute):
        tick = reasoning_scheduler_tick(now_iso=request.now_iso, limit=request.limit)
        watchdog = _run_runtime_no_silent_idle_watchdog(now_iso=request.now_iso, limit=request.limit)
        session_watchdog = await reconcile_runtime_watchers(RuntimeWatcherReconcileRequest(now_iso=request.now_iso))
        return {"success": True, "tick": tick, "executed": [], "executed_count": 0, "watchdog": watchdog, "session_watchdog": session_watchdog, "session_plane": _runtime_session_plane_status(stores=stores)}
    batch = await _execute_runtime_batch(limit=request.limit, now_iso=request.now_iso)
    watchdog = _run_runtime_no_silent_idle_watchdog(now_iso=request.now_iso, limit=request.limit)
    session_watchdog = await reconcile_runtime_watchers(RuntimeWatcherReconcileRequest(now_iso=request.now_iso))
    return {"success": True, **batch, "watchdog": watchdog, "session_watchdog": session_watchdog, "session_plane": _runtime_session_plane_status(stores=stores)}


@router.get("/runtime/status")
async def get_runtime_scheduler_status():
    stores = _runtime_delivery_stores()
    return {"success": True, "runtime": {**get_runtime_status(), "session_plane": _runtime_session_plane_status(stores=stores)}}


@router.get("/runtime/processes")
async def get_runtime_processes():
    stores = _runtime_delivery_stores()
    session_rows = stores["session_registry"].list()
    watcher_rows = stores["watcher_store"].list()
    sessions_by_process: Dict[str, List[Dict[str, Any]]] = {}
    for row in session_rows:
        sessions_by_process.setdefault(row.process_id, []).append(model_dump_compat(row))
    watcher_count_by_process: Dict[str, int] = {}
    for row in watcher_rows:
        watcher_count_by_process[row.process_id] = watcher_count_by_process.get(row.process_id, 0) + 1
    processes = []
    for row in list_runtime_processes():
        process_id = str(row.get("process_id") or "").strip()
        process_copy = dict(row)
        process_copy["session_plane"] = {
            "sessions": sessions_by_process.get(process_id, []),
            "watcher_count": watcher_count_by_process.get(process_id, 0),
        }
        processes.append(process_copy)
    return {"success": True, "processes": processes}


@router.post("/runtime/session/register")
async def register_runtime_session(request: RuntimeSessionRegisterRequest):
    process = get_runtime_process(request.process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{request.process_id}' not found")
    stores = _runtime_delivery_stores()
    record = stores["session_registry"].register(
        process_id=request.process_id,
        session_id=request.session_id,
        session_name=request.session_name,
        tool=request.tool,
        source=request.source,
        stale_after_seconds=request.stale_after_seconds,
        parent_process=request.parent_process,
        metadata=request.metadata,
    )
    return {"success": True, "process": process, "session": model_dump_compat(record)}


@router.get("/runtime/sessions")
async def list_runtime_sessions(process_id: Optional[str] = None):
    stores = _runtime_delivery_stores()
    stores["session_registry"].detect_stale()
    return {"success": True, "sessions": [model_dump_compat(row) for row in stores["session_registry"].list(process_id=process_id)]}


@router.post("/runtime/session/event")
async def record_runtime_session_event(request: RuntimeSessionEventRequest):
    stores = _runtime_delivery_stores()
    event = normalize_session_event(
        request.process_id,
        request.event,
        tool=request.tool,
        session_id=request.session_id,
        session_name=request.session_name,
        summary=request.summary,
        status=request.status,
        payload=request.payload,
    )
    delivery = resilient_delivery_attempt(
        "runtime_session_event_ingest",
        lambda: _record_runtime_session_event(process_id=request.process_id, event=event, stores=stores),
        process_id=request.process_id,
        event_kind=event.kind,
        payload=model_dump_compat(event),
        dlq_store=stores["delivery_dlq"],
    )
    if not delivery.get("success"):
        raise HTTPException(status_code=409, detail=delivery)
    result = dict(delivery.get("result") or {})
    return {
        "success": True,
        "event": model_dump_compat(result.get("event")),
        "session": model_dump_compat(result.get("session")),
        "shared_state": model_dump_compat(result.get("shared_state")) if result.get("shared_state") is not None else None,
        "snapshot": model_dump_compat(result.get("snapshot")) if result.get("snapshot") is not None else None,
        "memory_path": result.get("memory_path"),
        "process": result.get("process"),
        "follow_up_dispatch": model_dump_compat(result.get("follow_up_dispatch")) if result.get("follow_up_dispatch") is not None else None,
        "delivery": {k: v for k, v in delivery.items() if k != "result"},
    }


@router.post("/runtime/session/heartbeat")
async def heartbeat_runtime_session(request: RuntimeSessionHeartbeatRequest):
    stores = _runtime_delivery_stores()
    process = get_runtime_process(request.process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{request.process_id}' not found")
    session = stores["session_registry"].heartbeat(
        process_id=request.process_id,
        session_id=request.session_id,
        stale_after_seconds=request.stale_after_seconds,
    )
    event = normalize_session_event(
        request.process_id,
        "session.heartbeat",
        tool=session.tool,
        session_id=session.session_id,
        session_name=session.session_name,
        summary="heartbeat",
        payload={"stale_after_seconds": session.stale_after_seconds},
    )
    result = _record_runtime_session_event(process_id=request.process_id, event=event, stores=stores)
    return {
        "success": True,
        "session": model_dump_compat(result.get("session")),
        "event": model_dump_compat(result.get("event")),
        "memory_path": result.get("memory_path"),
    }


@router.post("/runtime/watchers/register")
async def register_runtime_watcher(request: RuntimeWatcherRegisterRequest):
    stores = _runtime_delivery_stores()
    process = get_runtime_process(request.process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{request.process_id}' not found")
    watcher = stores["watcher_store"].register(
        WatchRegistration(
            process_id=request.process_id,
            kind=request.kind,
            target=request.target,
            session_id=request.session_id,
            session_name=request.session_name,
            tool=request.tool,
            debounce_seconds=request.debounce_seconds,
            stale_after_seconds=request.stale_after_seconds,
            keywords=list(request.keywords or []),
            enabled=bool(request.enabled),
            metadata=dict(request.metadata or {}),
        )
    )
    if request.session_id:
        try:
            stores["session_registry"].attach_watcher(process_id=request.process_id, session_id=request.session_id, watcher_id=watcher.watch_id)
        except KeyError:
            pass
    return {"success": True, "watcher": model_dump_compat(watcher)}


@router.get("/runtime/watchers")
async def list_runtime_watchers(process_id: Optional[str] = None):
    stores = _runtime_delivery_stores()
    return {"success": True, "watchers": [model_dump_compat(row) for row in stores["watcher_store"].list(process_id=process_id)]}


@router.post("/runtime/watchers/reconcile")
async def reconcile_runtime_watchers(request: RuntimeWatcherReconcileRequest = RuntimeWatcherReconcileRequest()):
    stores = _runtime_delivery_stores()
    now_dt = _parse_optional_dt(request.now_iso)
    stores["session_registry"].detect_stale(now=now_dt)
    emitted = stores["watcher_store"].reconcile(session_registry=stores["session_registry"], now=now_dt)
    recorded = []
    for event in emitted:
        delivery = resilient_delivery_attempt(
            "runtime_session_event_ingest",
            lambda event=event: _record_runtime_session_event(process_id=event.process_id, event=event, stores=stores),
            process_id=event.process_id,
            event_kind=event.kind,
            payload=model_dump_compat(event),
            dlq_store=stores["delivery_dlq"],
        )
        recorded.append({
            "event": model_dump_compat(event),
            "delivery": {k: v for k, v in delivery.items() if k != "result"},
        })
    return {"success": True, "emitted_count": len(emitted), "emitted": recorded}


@router.post("/runtime/memory/note")
async def write_runtime_memory_note(request: RuntimeMemoryNoteRequest):
    process = get_runtime_process(request.process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{request.process_id}' not found")
    stores = _runtime_delivery_stores()
    path = stores["runtime_memory_store"].write_process_note(
        process_id=request.process_id,
        title=request.title,
        note=request.note,
        metadata=request.metadata,
    )
    record_runtime_event(request.process_id, "runtime.memory.noted", {"title": request.title, "path": str(path)})
    return {"success": True, "process": process, "path": str(path)}


@router.post("/runtime/tools/ingest")
async def ingest_runtime_tool_event(request: RuntimeToolIngestRequest):
    stores = _runtime_delivery_stores()
    event = adapt_tool_event(
        request.process_id,
        tool=request.tool,
        event=request.event,
        session_id=request.session_id,
        session_name=request.session_name,
        payload=request.payload,
    )
    delivery = resilient_delivery_attempt(
        "runtime_tool_event_ingest",
        lambda: _record_runtime_session_event(process_id=request.process_id, event=event, stores=stores),
        process_id=request.process_id,
        event_kind=event.kind,
        payload=model_dump_compat(event),
        dlq_store=stores["delivery_dlq"],
    )
    if not delivery.get("success"):
        raise HTTPException(status_code=409, detail=delivery)
    result = dict(delivery.get("result") or {})
    return {
        "success": True,
        "event": model_dump_compat(result.get("event")),
        "session": model_dump_compat(result.get("session")),
        "shared_state": model_dump_compat(result.get("shared_state")) if result.get("shared_state") is not None else None,
        "snapshot": model_dump_compat(result.get("snapshot")) if result.get("snapshot") is not None else None,
        "memory_path": result.get("memory_path"),
        "follow_up_dispatch": model_dump_compat(result.get("follow_up_dispatch")) if result.get("follow_up_dispatch") is not None else None,
        "delivery": {k: v for k, v in delivery.items() if k != "result"},
    }


@router.get("/runtime/delivery/dlq")
async def get_runtime_delivery_dlq(dependency: Optional[str] = None):
    stores = _runtime_delivery_stores()
    return {"success": True, "entries": [model_dump_compat(row) for row in stores["delivery_dlq"].list(dependency=dependency)]}


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
    response = await runtime_service.runtime_process_view(
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
    stores = _runtime_delivery_stores()
    response["session_plane"] = {
        "status": _runtime_session_plane_status(stores=stores, process_id=process_id),
        "sessions": [model_dump_compat(row) for row in stores["session_registry"].list(process_id=process_id)],
        "watchers": [model_dump_compat(row) for row in stores["watcher_store"].list(process_id=process_id)],
    }
    return response


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
    follow_up_bridge = _bridge_runtime_delivery_follow_up(process_id, process=process, stores=stores, now=_parse_optional_dt(request.now_iso))
    process = follow_up_bridge.get("process") or process
    return {
        "success": True,
        "process_id": process_id,
        "process": process,
        "contract": model_dump_compat(contract),
        **reconciled,
        "follow_up_dispatch": follow_up_bridge.get("dispatch"),
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
    follow_up_bridge = _bridge_runtime_roadmap_follow_up(process_id, process=process, stores=stores, now=_parse_optional_dt(request.now_iso))
    process = follow_up_bridge.get("process") or process
    return {
        "success": True,
        "process_id": process_id,
        "process": process,
        "contract": model_dump_compat(contract),
        **reconciled,
        "follow_up_dispatch": follow_up_bridge.get("dispatch"),
        "roadmap": _runtime_roadmap_status_payload(process_id, process=process, stores=stores),
    }


@router.post("/runtime/maintenance/intake")
async def intake_runtime_maintenance_item(request: RuntimeMaintenanceIntakeRequest):
    stores = _runtime_delivery_stores()
    if request.max_active_items is not None:
        stores["maintenance_queue_store"].configure(max_active_items=request.max_active_items)
    contract = _build_runtime_maintenance_contract("pending", request)
    item = MaintenanceQueueItem(
        queue_name=str(request.queue_name or "maintenance").strip() or "maintenance",
        status="pending",
        priority=int(request.priority or 0),
        objective=_maintenance_queue_objective(request),
        summary=str(request.title or _maintenance_queue_intake_text(request) or _maintenance_queue_objective(request)).strip() or None,
        item_kind=str(request.item_kind or "maintenance").strip() or "maintenance",
        source_text=_maintenance_queue_intake_text(request) or _maintenance_queue_objective(request),
        source_message={
            "text": str(request.message.text or request.text or "").strip() or None,
            "channel": str(request.message.channel or "").strip() or None,
            "conversation_id": str(request.message.conversation_id or "").strip() or None,
            "session_key": str(request.message.session_key or "").strip() or None,
            "from_user": str(request.message.from_user or "").strip() or None,
            "message_id": str(request.message.message_id or "").strip() or None,
            "metadata": dict(request.message.metadata or {}),
        },
        roadmap_contract=model_dump_compat(contract),
        metadata={
            **dict(request.metadata or {}),
            "done_world_state_key": dict(contract.metadata or {}).get("done_world_state_key"),
            "maintenance_queue": dict((contract.metadata or {}).get("maintenance_queue") or {}),
        },
    )
    # Rebuild the contract once the stable item id exists so the done-key fingerprint is durable.
    contract = _build_runtime_maintenance_contract(item.item_id, request)
    item.roadmap_contract = model_dump_compat(contract)
    item.metadata = {
        **dict(item.metadata or {}),
        "done_world_state_key": dict(contract.metadata or {}).get("done_world_state_key"),
        "maintenance_queue": dict((contract.metadata or {}).get("maintenance_queue") or {}),
    }
    item.projection = _maintenance_queue_item_projection(item, process=None, state=None, latest_report=None, stores=stores)
    queued = stores["maintenance_queue_store"].enqueue(item)
    _runtime_maintenance_queue_sync(stores=stores, now=None, allow_claim=False)
    return {
        "success": True,
        "item": model_dump_compat(stores["maintenance_queue_store"].get(queued.item_id) or queued),
        "maintenance_queue": _runtime_maintenance_queue_status_payload(stores=stores),
    }


@router.get("/runtime/maintenance/queue")
async def get_runtime_maintenance_queue():
    stores = _runtime_delivery_stores()
    _runtime_maintenance_queue_sync(stores=stores, now=None, allow_claim=False)
    return _runtime_maintenance_queue_status_payload(stores=stores)


@router.get("/runtime/maintenance/queue/{item_id}")
async def get_runtime_maintenance_queue_item(item_id: str):
    stores = _runtime_delivery_stores()
    _runtime_maintenance_queue_sync(stores=stores, now=None, allow_claim=False)
    item = stores["maintenance_queue_store"].get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Runtime maintenance queue item '{item_id}' not found")
    return {"success": True, "item": model_dump_compat(item), "maintenance_queue": _runtime_maintenance_queue_status_payload(stores=stores)}


@router.get("/runtime/trace/{process_id}")
async def get_runtime_process_trace(process_id: str):
    return runtime_service.runtime_process_trace(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        get_runtime_events_fn=get_runtime_events,
        process_trace_surface_fn=observability.process_trace_surface,
    )


@router.get("/runtime/lineage/{process_id}")
async def get_runtime_process_lineage(process_id: str, limit: int = 120):
    process = get_runtime_process(process_id)
    session_key = str((process or {}).get("session_key") or "").strip()
    codec_packet = get_codec_packet_for_session(session_key, max_chars=800) if session_key else {"state": {}}
    bundle = build_lineage_bundle(
        process=process,
        events=get_runtime_events(process_id, limit=max(1, min(int(limit), 200))),
        objective_detail=None,
        codec_state=(codec_packet.get("state") if isinstance(codec_packet, dict) else {}),
        session_key=session_key or None,
    )
    bundle["process"] = {
        "process_id": process_id,
        "status": (process or {}).get("status"),
        "session_key": session_key or None,
        "task_id": (process or {}).get("task_id"),
        "workflow_name": (((process or {}).get("workflow") or {}).get("name") if isinstance((process or {}).get("workflow"), dict) else None),
    }
    bundle["capability_matrix"] = capability_matrix()
    return bundle


@router.get("/runtime/processes/{process_id}/traceability")
async def get_runtime_process_traceability(process_id: str, limit: int = 120):
    bundle = await get_runtime_process_lineage(process_id, limit=limit)
    bundle["traceability_contract"] = {
        "schema_version": "cortex.traceability.contract.v1",
        "raw_event_class": "observed_evidence",
        "derived_state_class": "inferred_state",
        "memory_class": "learned_memory",
        "override_class": "operator_overrides",
    }
    return bundle

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
