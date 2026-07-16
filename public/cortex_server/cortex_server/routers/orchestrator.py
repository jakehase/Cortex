"""
Level 26: The Orchestrator / Conductor — Real Workflow Execution

Coordinates multi-level workflows by accepting step definitions, executing
them sequentially via async HTTP, and storing results for replay.

NOTE: This is L26 Workflow Conductor, NOT L36 Meta-Conductor.
"""
from __future__ import annotations
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from pathlib import Path
import os
import fcntl
import hashlib
import hmac
import json
import asyncio
import base64
import httpx
from contextlib import ExitStack, asynccontextmanager, contextmanager
from functools import partial
from uuid import uuid4

from cortex_server.modules.diplomat import get_diplomat
from cortex_server.modules.reasoning_approvals import create_approval_grant
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
    CanonicalSessionEvent,
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
    build_unattended_profile,
    compile_handoff_to_agent_work_spec,
    derive_session_plane,
    resolve_session_follow_up_policy,
    session_follow_up_allowed,
    session_plane_is_blocking,
    apply_release_rollback_restore,
    detect_true_blockers,
    evaluate_production_completion,
    normalize_session_event,
    reconcile_production_build_loop,
    reconcile_roadmap_execution,
    resilient_delivery_attempt,
)
from cortex_server.runtime.offloaded_memory import RuntimeMemoryLimitError
from cortex_server.runtime.runtime_delivery_quota import (
    MAX_RUNTIME_DELIVERY_OBJECT_BYTES,
    RuntimeDeliveryQuotaError,
    assert_runtime_delivery_volume_capacity,
    runtime_delivery_quota_transaction,
)
from cortex_server.runtime.production_build_loop import (
    REQUIRED_RELEASE_HANDOFF_RECIPIENTS,
    ingest_production_release_artifact,
    probe_runtime_delivery_readiness,
    runtime_delivery_artifact_fetch_signature,
    runtime_delivery_handoff_claim_signature,
    runtime_delivery_handoff_discovery_signature,
    runtime_delivery_manager_rollback_signature,
    runtime_delivery_recipient_credentials,
    runtime_delivery_verifier_capability_signature,
    runtime_delivery_verifier_credentials,
)
from cortex_server.runtime.release_workflow import (
    RELEASE_STAGE_TOPOLOGY,
    canonical_release_artifact_bytes,
    release_artifact_storage_limits,
)
from cortex_server.runtime.durable_files import durable_mkdir

router = APIRouter()

# ── In-memory state ────────────────────────────────────────────────────────
DEFAULT_DB_PATH = Path(os.getenv("REASONING_STORE_DB_PATH", "/opt/clawdbot/state/reasoning_runtime.db"))
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
        "snapshot_store": ProcessSnapshotStore(root / "snapshots", delivery_root=root),
        "shared_state_store": SharedProcessStateStore(root / "shared_state"),
        "journal": ProcessJournal(root / "journal.jsonl", delivery_root=root),
        "session_registry": SessionRegistryStore(
            root / "session_registry.json",
            max_sessions=int(os.getenv("ORCHESTRATOR_MAX_SESSIONS", "1000")),
            max_questions=int(os.getenv("ORCHESTRATOR_MAX_SESSION_QUESTIONS", "50")),
            max_question_bytes=int(os.getenv("ORCHESTRATOR_MAX_SESSION_QUESTION_BYTES", "8192")),
            max_metadata_bytes=int(os.getenv("ORCHESTRATOR_MAX_SESSION_METADATA_BYTES", "65536")),
            max_state_bytes=int(os.getenv("ORCHESTRATOR_MAX_SESSION_STATE_BYTES", "4000000")),
            delivery_root=root,
        ),
        "watcher_store": WatcherRuntimeStore(root / "watchers.json", delivery_root=root),
        "runtime_memory_store": RuntimeMemoryStore(root / "memory", delivery_root=root),
        "delivery_dlq": DeliveryDeadLetterStore(root / "delivery_dlq.jsonl", delivery_root=root),
        "mailbox": AgentMailbox(root / "mailbox.json", delivery_root=root),
        "supervisor": AgentSupervisor(root / "leases.json", delivery_root=root),
        "release_store": ReleaseWorkflowStore(root / "release_workflow"),
        "loop_store": ProductionBuildLoopStore(root / "production_build_loop"),
        "roadmap_store": RoadmapExecutionStore(root / "roadmap_executor"),
        "follow_up_store": RuntimeFollowUpStore(root / "runtime_follow_ups.json", delivery_root=root),
        "maintenance_queue_store": MaintenanceQueueStore(
            root / "maintenance_queue.json",
            max_items=int(os.getenv("ORCHESTRATOR_MAX_MAINTENANCE_ITEMS", "1000")),
            max_state_bytes=int(os.getenv("ORCHESTRATOR_MAX_MAINTENANCE_STATE_BYTES", "4000000")),
            delivery_root=root,
        ),
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


def _runtime_event_receipt_paths(*, stores: Dict[str, Any], process_id: str, event_id: str) -> tuple[Path, Path, Path]:
    event_digest = hashlib.sha256(f"{process_id}:{event_id}".encode("utf-8")).hexdigest()
    process_digest = hashlib.sha256(str(process_id).encode("utf-8")).hexdigest()
    root = Path(stores["root"]) / "session_event_inbox"
    return root / f"{event_digest}.json", root / f"{process_digest}.lock", root / f"{process_digest}.pending.json"


def _release_bootstrap_intent_target(*, stores: Dict[str, Any], process_id: str) -> Path:
    digest = hashlib.sha256(str(process_id).encode("utf-8")).hexdigest()
    return Path(stores["root"]) / "release_bootstrap_intents" / f"{digest}.json"


def _save_release_bootstrap_intent(
    *,
    stores: Dict[str, Any],
    process_id: str,
    request: Any,
    contract: ProductionBuildContract,
) -> Path:
    target = _release_bootstrap_intent_target(stores=stores, process_id=process_id)
    payload = {
        "version": "cortex.runtime-delivery.release-bootstrap.v1",
        "process_id": process_id,
        "request": model_dump_compat(request),
        "contract": model_dump_compat(contract),
        "created_at": datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
    }
    encoded_size = len(
        (json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")
    )
    if encoded_size > MAX_RUNTIME_DELIVERY_OBJECT_BYTES:
        raise HTTPException(status_code=413, detail="runtime delivery bootstrap intent exceeds immutable object quota")
    try:
        with runtime_delivery_quota_transaction(Path(stores["root"])):
            assert_runtime_delivery_volume_capacity(
                Path(stores["root"]),
                additional_bytes=encoded_size,
            )
            _write_runtime_event_receipt(target, payload)
    except RuntimeDeliveryQuotaError as exc:
        raise HTTPException(status_code=507, detail=str(exc)) from exc
    return target


def _clear_release_bootstrap_intent(*, stores: Dict[str, Any], process_id: str) -> None:
    target = _release_bootstrap_intent_target(stores=stores, process_id=process_id)
    if target.exists():
        _unlink_fsynced(target)


def _write_runtime_event_receipt(path: Path, receipt: Dict[str, Any]) -> None:
    durable_mkdir(path.parent)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid4().hex}.tmp")
    encoded = (json.dumps(receipt, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    try:
        with temporary.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temporary.exists():
            temporary.unlink()


def _unlink_fsynced(path: Path) -> None:
    path.unlink()
    directory_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _canonical_event_identity(event: CanonicalSessionEvent) -> Dict[str, Any]:
    return {
        "event_id": event.event_id,
        "process_id": event.process_id,
        "raw_event": event.raw_event,
        "kind": event.kind,
        "tool": event.tool,
        "session_id": event.session_id,
        "session_name": event.session_name,
        "summary": event.summary,
        "status": event.status,
        "payload": dict(event.payload or {}),
    }


def _file_tail_contains(path: Path, needle: str, *, max_bytes: int = 1_048_576) -> bool:
    if not path.exists():
        return False
    with path.open("rb") as handle:
        size = path.stat().st_size
        handle.seek(max(0, size - max_bytes))
        return needle.encode("utf-8") in handle.read(max_bytes)


def _clear_runtime_event_pending(*, stores: Dict[str, Any], process_id: str, event_id: str) -> None:
    _, lock_path, pending_path = _runtime_event_receipt_paths(stores=stores, process_id=process_id, event_id=event_id)
    durable_mkdir(lock_path.parent)
    with lock_path.open("a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        pending = json.loads(pending_path.read_text(encoding="utf-8")) if pending_path.exists() else None
        if isinstance(pending, dict) and str(pending.get("event_id") or "") == event_id:
            _unlink_fsynced(pending_path)


@contextmanager
def _runtime_session_mutation(
    *,
    stores: Dict[str, Any],
    process_id: str,
    operation: str,
):
    """Use rollback's release -> shared -> snapshot lock order."""

    with (
        stores["release_store"].release_transaction(process_id),
        stores["shared_state_store"].transaction(process_id),
        stores["snapshot_store"].transaction(process_id),
    ):
        stores["release_store"].assert_mutation_allowed(
            process_id,
            operation=operation,
        )
        yield


def _record_runtime_session_event_locked(*, process_id: str, event: Any, stores: Dict[str, Any]) -> Dict[str, Any]:
    stores["release_store"].assert_mutation_allowed(
        process_id,
        operation="runtime session event ingestion",
    )
    process = get_runtime_process(process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{process_id}' not found")

    event.payload = {**dict(event.payload or {}), "canonical_event_id": event.event_id}
    expected_event_identity = _canonical_event_identity(event)
    receipt_path, lock_path, pending_path = _runtime_event_receipt_paths(
        stores=stores,
        process_id=process_id,
        event_id=event.event_id,
    )
    durable_mkdir(lock_path.parent)
    with lock_path.open("a+b") as lock_handle:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
        pending = json.loads(pending_path.read_text(encoding="utf-8")) if pending_path.exists() else None
        if isinstance(pending, dict) and str(pending.get("event_id") or "") not in {"", event.event_id}:
            raise RuntimeError(f"pending canonical session event must be recovered first: {pending.get('event_id')}")
        receipt = json.loads(receipt_path.read_text(encoding="utf-8")) if receipt_path.exists() else None
        receipt_existed = receipt is not None
        if receipt is not None:
            stored_event = CanonicalSessionEvent.model_validate(receipt["event"]) if hasattr(CanonicalSessionEvent, "model_validate") else CanonicalSessionEvent.parse_obj(receipt["event"])
            if _canonical_event_identity(stored_event) != _canonical_event_identity(event):
                raise ValueError(f"canonical event_id reuse with different payload: {event.event_id}")
            event = stored_event
            expected_event_identity = _canonical_event_identity(event)
        else:
            # If the inbox directory link was lost after other projections were
            # committed, those projections are still authoritative evidence for
            # event-id reuse. Never infer equality from the event id alone.
            projected_identities: List[Dict[str, Any]] = []
            for row in stores["journal"].load(process_id=process_id):
                payload = dict(row.payload or {})
                if str(payload.get("canonical_event_id") or "") != event.event_id:
                    continue
                identity = payload.get("canonical_event_identity")
                if not isinstance(identity, dict):
                    raise ValueError(
                        f"canonical event projection lacks recoverable identity: {event.event_id}"
                    )
                projected_identities.append(identity)
            for row in get_runtime_events(process_id, limit=1000):
                payload = dict(row.get("payload") or {})
                if str(payload.get("canonical_event_id") or "") != event.event_id:
                    continue
                identity = payload.get("canonical_event_identity")
                if not isinstance(identity, dict):
                    raise ValueError(
                        f"canonical event runtime projection lacks recoverable identity: {event.event_id}"
                    )
                projected_identities.append(identity)
            if any(identity != expected_event_identity for identity in projected_identities):
                raise ValueError(f"canonical event_id reuse with different payload: {event.event_id}")
        if pending is None:
            _write_runtime_event_receipt(
                pending_path,
                {"event_id": event.event_id, "process_id": process_id, "created_at": datetime.utcnow().isoformat(timespec="milliseconds") + "Z"},
            )
        if receipt is None:
            receipt = {
                "version": "runtime-session-inbox.v1",
                "event_id": event.event_id,
                "process_id": process_id,
                "status": "in_progress",
                "event": model_dump_compat(event),
                "projections": {},
                "created_at": datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
            }
            _write_runtime_event_receipt(receipt_path, receipt)

        projections = receipt.setdefault("projections", {})
        session_registry = stores["session_registry"]
        journal = stores["journal"]
        runtime_memory_store = stores["runtime_memory_store"]

        session = session_registry.get(process_id=process_id, session_id=str(event.session_id or process_id))
        session_already_applied = bool(
            session
            and session.last_event_kind == event.kind
            and session.last_event_at == event.ts
        )
        if not projections.get("session_registry") and not session_already_applied:
            session = session_registry.apply_event(event)
        else:
            session = session or session_registry.get(process_id=process_id, session_id=str(event.session_id or process_id))
        projections["session_registry"] = True
        _write_runtime_event_receipt(receipt_path, receipt)

        journal_events = journal.load(process_id=process_id)
        journal_event = next(
            (row for row in journal_events if str((row.payload or {}).get("canonical_event_id") or "") == event.event_id),
            None,
        )
        if not projections.get("journal") and journal_event is None:
            journal_event = journal.append(
                process_id=process_id,
                kind=event.kind,
                actor=event.tool,
                payload={
                    **dict(event.payload or {}),
                    "operator_summary": event.operator_summary,
                    "session_id": event.session_id,
                    "session_name": event.session_name,
                    "raw_event": event.raw_event,
                    "canonical_event_id": event.event_id,
                    "canonical_event_identity": expected_event_identity,
                },
            )
        projections["journal"] = True
        _write_runtime_event_receipt(receipt_path, receipt)

        scheduler_event_exists = any(
            str((row.get("payload") or {}).get("canonical_event_id") or "") == event.event_id
            for row in get_runtime_events(process_id, limit=1000)
        )
        if not projections.get("runtime_process") and not scheduler_event_exists:
            record_runtime_event(
                process_id,
                event.kind,
                {
                    **dict(event.payload or {}),
                    "operator_summary": event.operator_summary,
                    "canonical_event_id": event.event_id,
                    "canonical_event_identity": expected_event_identity,
                },
            )
        projections["runtime_process"] = True
        _write_runtime_event_receipt(receipt_path, receipt)

        current_shared = stores["shared_state_store"].load(process_id)
        shared_state = current_shared
        if not projections.get("shared_state") and str(((current_shared.metadata if current_shared else {}) or {}).get("last_session_event_id") or "") != event.event_id:
            shared_state = _upsert_runtime_shared_state_from_session_event(process_id, event, stores=stores)
        projections["shared_state"] = True
        _write_runtime_event_receipt(receipt_path, receipt)

        memory_path = runtime_memory_store._session_path(process_id, str(event.session_id or process_id))
        memory_contains_event = _file_tail_contains(memory_path, event.event_id)
        if not projections.get("memory") and not memory_contains_event:
            memory_path = runtime_memory_store.write_session_event(event)
        projections["memory"] = True
        _write_runtime_event_receipt(receipt_path, receipt)

        refreshed = get_runtime_process(process_id)
        current_snapshot = stores["snapshot_store"].load(process_id)
        snapshot = current_snapshot
        if not projections.get("snapshot") and str(((current_snapshot.metadata if current_snapshot else {}) or {}).get("last_session_event_id") or "") != event.event_id:
            snapshot = _upsert_runtime_snapshot_session_state(
                process_id=process_id,
                stores=stores,
                process=refreshed or process,
                event_id=event.event_id,
            )
        projections["snapshot"] = True
        _write_runtime_event_receipt(receipt_path, receipt)

        follow_up_summary = str(event.summary or event.operator_summary).strip() or event.kind
        follow_up_fingerprint = f"session:{process_id}:{event.session_id or process_id}:{event.kind}:{follow_up_summary}"
        follow_up = stores["follow_up_store"].get_by_fingerprint(
            process_id=process_id,
            runtime_kind="session",
            fingerprint=follow_up_fingerprint,
        )
        if follow_up is None:
            follow_up = _enqueue_session_follow_up(process=refreshed or process, event=event, stores=stores)
        projections["follow_up"] = True
        receipt["status"] = "committed"
        receipt["committed_at"] = datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
        _write_runtime_event_receipt(receipt_path, receipt)
        if pending_path.exists():
            _unlink_fsynced(pending_path)
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)

    return {
        "success": True,
        "process": refreshed or process,
        "session": session,
        "shared_state": shared_state,
        "snapshot": snapshot,
        "memory_path": str(memory_path),
        "event": event,
        "follow_up_dispatch": follow_up,
        "idempotent": receipt_existed,
    }


def _record_runtime_session_event(*, process_id: str, event: Any, stores: Dict[str, Any]) -> Dict[str, Any]:
    """Commit every session projection under the same rollback lock order."""

    with _runtime_session_mutation(
        stores=stores,
        process_id=process_id,
        operation="runtime session event ingestion",
    ):
        return _record_runtime_session_event_locked(
            process_id=process_id,
            event=event,
            stores=stores,
        )


def _preflight_runtime_session_event(event: Any, *, stores: Dict[str, Any]) -> None:
    """Validate deterministic downstream projections before inbox publication."""

    try:
        stores["session_registry"].validate_event_admission(event)
        event_bytes = len(
            json.dumps(
                model_dump_compat(event),
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8")
        )
        for name, model in (
            ("shared state", stores["shared_state_store"].load(event.process_id)),
            ("snapshot", stores["snapshot_store"].load(event.process_id)),
        ):
            if model is None:
                continue
            current_bytes = len(
                json.dumps(
                    model_dump_compat(model),
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                    allow_nan=False,
                ).encode("utf-8")
            )
            # Session-plane derivation adds bounded summaries and identifiers
            # in several nested projections. This conservative margin ensures
            # their complete replacement and history row remain admissible.
            if current_bytes + (4 * event_bytes) + 64 * 1024 > MAX_RUNTIME_DELIVERY_OBJECT_BYTES:
                raise ValueError(f"runtime session {name} projection exceeds immutable object quota")
    except (TypeError, ValueError) as exc:
        raise RuntimeMemoryLimitError(str(exc)) from exc


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


def _authorize_runtime_watcher_target(*, process: Dict[str, Any], kind: str, target: str) -> List[str]:
    if kind not in {"workspace", "log-pattern", "path-state"}:
        return []
    try:
        resolved_target = Path(target).expanduser().resolve(strict=False)
        roots = [Path(row).expanduser().resolve(strict=False) for row in _runtime_workspace_targets_from_process(process)]
    except (OSError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=403, detail="watcher target is not an authorized process workspace path") from exc
    if not roots or not any(resolved_target == root or resolved_target.is_relative_to(root) for root in roots):
        raise HTTPException(status_code=403, detail="watcher target is outside the authorized process workspace")
    return [str(root) for root in roots]


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
    if session.status == "stale":
        session = stores["session_registry"].heartbeat(
            process_id=process_id,
            session_id=session_id,
            stale_after_seconds=session.stale_after_seconds,
        )

    def ensure_watcher(registration: WatchRegistration) -> Any:
        existing = next(
            (
                row
                for row in stores["watcher_store"].list(process_id=process_id)
                if row.kind == registration.kind
                and row.target == registration.target
                and str(row.session_id or "") == str(registration.session_id or "")
            ),
            None,
        )
        if existing is not None:
            existing.enabled = True
            existing.metadata = {**dict(existing.metadata or {}), **dict(registration.metadata or {})}
            watcher = stores["watcher_store"].register(existing)
        else:
            watcher = stores["watcher_store"].register(registration)
        stores["session_registry"].attach_watcher(
            process_id=process_id,
            session_id=session_id,
            watcher_id=watcher.watch_id,
        )
        return watcher

    default_watchers: List[Dict[str, Any]] = []
    heartbeat_watcher = ensure_watcher(
        WatchRegistration(
            process_id=process_id,
            kind="session-heartbeat",
            target=session_id,
            session_id=session_id,
            session_name=session_name,
            tool=tool,
            stale_after_seconds=session.stale_after_seconds,
            metadata={"bootstrapped": True, "canonical": True},
        )
    )
    default_watchers.append(model_dump_compat(heartbeat_watcher))

    for target in _runtime_workspace_targets_from_process(process):
        authorized_roots = _authorize_runtime_watcher_target(process=process, kind="workspace", target=target)
        watcher = ensure_watcher(
            WatchRegistration(
                process_id=process_id,
                kind="workspace",
                target=target,
                session_id=session_id,
                session_name=session_name,
                tool="workspace",
                debounce_seconds=float(metadata.get("workspace_debounce_seconds") or 1.0),
                metadata={
                    "bootstrapped": True,
                    "canonical": True,
                    "cortex_authorized_roots": authorized_roots,
                    "cortex_workspace_attested_by": "server",
                },
            )
        )
        default_watchers.append(model_dump_compat(watcher))

    memory_marker = f"session-plane-bootstrap:{session_id}"
    process_note_path = stores["runtime_memory_store"]._process_path(process_id)
    existing_memory = process_note_path.read_text(encoding="utf-8", errors="ignore") if process_note_path.exists() else ""
    if memory_marker not in existing_memory:
        stores["runtime_memory_store"].write_process_note(
            process_id=process_id,
            title="Session plane bootstrapped",
            note=f"{memory_marker} tool={tool} watchers={len(default_watchers)}",
            metadata={"session_id": session_id, "watcher_count": len(default_watchers)},
        )

    bootstrap_events = [
        row
        for row in stores["journal"].load(process_id=process_id, kinds=["session.started"])
        if bool((row.payload or {}).get("bootstrapped"))
        and str((row.payload or {}).get("session_id") or process_id) == session_id
    ]
    canonical_event = normalize_session_event(
        process_id,
        "session.started",
        tool=tool,
        session_id=session_id,
        session_name=session_name,
        summary="runtime session plane bootstrapped",
        payload={"bootstrapped": True, "watcher_count": len(default_watchers)},
    )
    canonical_event.event_id = f"sessevt_bootstrap_{hashlib.sha256(f'{process_id}:{session_id}'.encode('utf-8')).hexdigest()[:16]}"
    receipt_path, _, _ = _runtime_event_receipt_paths(
        stores=stores,
        process_id=process_id,
        event_id=canonical_event.event_id,
    )
    receipt = json.loads(receipt_path.read_text(encoding="utf-8")) if receipt_path.exists() else None
    resume_canonical_event = isinstance(receipt, dict) and receipt.get("status") != "committed"
    event = None
    recorded: Dict[str, Any] = {}
    if not bootstrap_events or resume_canonical_event:
        event = canonical_event
        recorded = _record_runtime_session_event(process_id=process_id, event=event, stores=stores)
        session = recorded.get("session") or session
    else:
        _upsert_runtime_snapshot_session_state(process_id=process_id, stores=stores, process=process)
        recorded = {
            "session": stores["session_registry"].get(process_id=process_id, session_id=session_id),
            "shared_state": stores["shared_state_store"].load(process_id),
            "memory_path": None,
        }
    return {
        "session": model_dump_compat(recorded.get("session")),
        "shared_state": model_dump_compat(recorded.get("shared_state")) if recorded.get("shared_state") is not None else None,
        "memory_path": recorded.get("memory_path"),
        "watchers": default_watchers,
        "event": model_dump_compat(event) if event is not None else None,
    }


def _ensure_runtime_session_plane_bootstrap(process_id: str, *, process: Dict[str, Any], stores: Dict[str, Any]) -> Dict[str, Any]:
    with _runtime_session_mutation(
        stores=stores,
        process_id=process_id,
        operation="runtime session plane bootstrap",
    ):
        return _bootstrap_runtime_session_plane(
            process_id,
            process=get_runtime_process(process_id) or process,
            stores=stores,
        )


def _migrate_runtime_watcher_attestations(*, process_id: str, process: Dict[str, Any], stores: Dict[str, Any]) -> List[str]:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    workflow_metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    # Physical roots on legacy scoped-principal plans were caller controlled
    # and can never be promoted into server attestations.
    if isinstance(workflow_metadata.get("principal"), dict) or workflow_metadata.get("scope_credential_id"):
        return []
    migrated: List[str] = []
    invalid_ids = set(stores["watcher_store"].invalid_file_watcher_ids())
    for watcher in stores["watcher_store"].list(process_id=process_id):
        if watcher.kind not in {"workspace", "log-pattern", "path-state"} or watcher.watch_id not in invalid_ids:
            continue
        try:
            roots = _authorize_runtime_watcher_target(
                process=process,
                kind=watcher.kind,
                target=watcher.target,
            )
        except HTTPException:
            continue
        watcher.metadata = {
            **dict(watcher.metadata or {}),
            "cortex_authorized_roots": roots,
            "cortex_workspace_attested_by": "server",
            "cortex_attestation_migrated": True,
        }
        stores["watcher_store"].register(watcher)
        migrated.append(watcher.watch_id)
    return migrated


def _refresh_runtime_session_plane(
    *,
    stores: Dict[str, Any],
    now: Optional[datetime] = None,
    process_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    process_ids = sorted(
        {
            row.process_id
            for row in stores["session_registry"].list(process_id=process_id)
        }
        | {
            row.process_id
            for row in stores["watcher_store"].list(process_id=process_id)
        }
    )
    recorded: List[Dict[str, Any]] = []
    for active_process_id in process_ids:
        intent = stores["release_store"].load_rollback_intent(active_process_id)
        if intent and intent.get("status") in {"in_progress", "recovery_required"}:
            # The authoritative registry will be restored by rollback. Defer
            # watchdog-derived mutations until recovery commits.
            continue
        with _runtime_session_mutation(
            stores=stores,
            process_id=active_process_id,
            operation="runtime session and watcher reconciliation",
        ):
            active_process = get_runtime_process(active_process_id)
            if active_process is not None:
                _migrate_runtime_watcher_attestations(
                    process_id=active_process_id,
                    process=active_process,
                    stores=stores,
                )
            stale_rows = stores["session_registry"].detect_stale(
                now=now,
                process_id=active_process_id,
            )
            emitted = stores["watcher_store"].reconcile(
                session_registry=stores["session_registry"],
                now=now,
                process_id=active_process_id,
            )
            emitted_stale_sessions = {
                str(event.session_id or event.process_id)
                for event in emitted
                if event.kind == "session.stale"
            }
            for stale in stale_rows:
                if stale.session_id in emitted_stale_sessions:
                    continue
                event = normalize_session_event(
                    active_process_id,
                    "session.stale",
                    tool=stale.tool,
                    session_id=stale.session_id,
                    session_name=stale.session_name,
                    summary=stale.blocked_reason or "session heartbeat expired",
                    payload={"source": "session-registry"},
                )
                if now is not None:
                    event.ts = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
                emitted.append(event)
            for event in emitted:
                delivery = resilient_delivery_attempt(
                    "runtime_session_event_ingest",
                    lambda event=event: _record_runtime_session_event(
                        process_id=event.process_id,
                        event=event,
                        stores=stores,
                    ),
                    process_id=event.process_id,
                    event_kind=event.kind,
                    payload=model_dump_compat(event),
                    dlq_store=stores["delivery_dlq"],
                )
                recorded.append(
                    {
                        "event": model_dump_compat(event),
                        "delivery": {key: value for key, value in delivery.items() if key != "result"},
                    }
                )
    return recorded


def _runtime_session_plane_status(*, stores: Dict[str, Any], process_id: Optional[str] = None) -> Dict[str, Any]:
    _refresh_runtime_session_plane(stores=stores, process_id=process_id)
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


def _upsert_runtime_snapshot_session_state_locked(
    *,
    process_id: str,
    stores: Dict[str, Any],
    process: Optional[Dict[str, Any]] = None,
    event_id: Optional[str] = None,
) -> Optional[ProcessSnapshot]:
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
    snapshot.metadata = {
        **dict(snapshot.metadata or {}),
        "session_plane": {"status": session_state.get("status"), "watcher_count": session_state.get("watcher_count"), "session_count": len(session_state.get("sessions") or [])},
        **({"last_session_event_id": event_id} if event_id else {}),
    }
    snapshot.world_state = {**dict(snapshot.world_state or {}), "session_status": session_state.get("status"), "session_retry_count": session_state.get("retry_count")}
    return snapshot_store.save(snapshot)


def _upsert_runtime_snapshot_session_state(
    *,
    process_id: str,
    stores: Dict[str, Any],
    process: Optional[Dict[str, Any]] = None,
    event_id: Optional[str] = None,
) -> Optional[ProcessSnapshot]:
    """Merge session projections behind the same per-process snapshot fence as rollback."""

    snapshot_store = stores["snapshot_store"]
    with snapshot_store.transaction(process_id):
        return _upsert_runtime_snapshot_session_state_locked(
            process_id=process_id,
            stores=stores,
            process=process,
            event_id=event_id,
        )


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


def _production_policy_does_not_weaken(candidate_id: str, baseline_id: str) -> bool:
    """Return whether one immutable server policy is at least as strict as another."""

    candidate = build_unattended_profile(candidate_id)
    baseline = build_unattended_profile(baseline_id)
    minimum_fields = (
        "intended_duration_hours",
        "campaign_cycles",
        "min_agent_count",
        "min_handoff_count",
        "required_revision_history",
    )
    maximum_fields = (
        "max_checkpoint_age_seconds",
        "max_snapshot_event_gap",
        "max_dead_letters",
        "max_stale_leases",
        "max_inflight_age_seconds",
        "max_lease_heartbeat_lag_seconds",
    )
    if any(float(candidate[field]) < float(baseline[field]) for field in minimum_fields):
        return False
    if any(float(candidate[field]) > float(baseline[field]) for field in maximum_fields):
        return False
    candidate_watchdog = dict(candidate.get("watchdog") or {})
    baseline_watchdog = dict(baseline.get("watchdog") or {})
    if any(
        float(candidate_watchdog[field]) > float(baseline_watchdog[field])
        for field in ("lease_seconds", "heartbeat_grace_seconds")
    ):
        return False
    candidate_checkpoint = dict(candidate.get("checkpoint") or {})
    baseline_checkpoint = dict(baseline.get("checkpoint") or {})
    if float(candidate_checkpoint["snapshot_every_events"]) > float(
        baseline_checkpoint["snapshot_every_events"]
    ):
        return False
    return not bool(baseline_checkpoint.get("must_checkpoint_on_handoff")) or bool(
        candidate_checkpoint.get("must_checkpoint_on_handoff")
    )



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
            journal.append(
                process_id=process_id,
                kind="process_created",
                revision_id=shared_state.revision_id,
                actor="runtime_delivery_bootstrap",
                payload={"workflow_name": workflow.get("name"), "process_status": process.get("status")},
            )
            for node_id, agent_id in assigned_agents.items():
                journal.append(
                    process_id=process_id,
                    kind="agent_assigned",
                    revision_id=shared_state.revision_id,
                    actor="runtime_delivery_bootstrap",
                    payload={"node_id": node_id, "agent_id": agent_id},
                )
            for node_id in active_steps:
                journal.append(
                    process_id=process_id,
                    kind="step_started",
                    revision_id=shared_state.revision_id,
                    actor="runtime_delivery_bootstrap",
                    payload={"node_id": node_id},
                )
            for node_id in waiting_steps:
                journal.append(
                    process_id=process_id,
                    kind="process_waiting",
                    revision_id=shared_state.revision_id,
                    actor="runtime_delivery_bootstrap",
                    payload={"node_id": node_id},
                )
            for node_id in completed_steps:
                journal.append(
                    process_id=process_id,
                    kind="step_completed",
                    revision_id=shared_state.revision_id,
                    actor="runtime_delivery_bootstrap",
                    payload={"node_id": node_id},
                )
            for node_id in failed_steps:
                journal.append(
                    process_id=process_id,
                    kind="step_failed",
                    revision_id=shared_state.revision_id,
                    actor="runtime_delivery_bootstrap",
                    payload={"node_id": node_id},
                )
            if lifecycle_state == "completed":
                journal.append(
                    process_id=process_id,
                    kind="process_completed",
                    revision_id=shared_state.revision_id,
                    actor="runtime_delivery_bootstrap",
                    payload={},
                )
            elif lifecycle_state == "failed":
                journal.append(
                    process_id=process_id,
                    kind="process_failed",
                    revision_id=shared_state.revision_id,
                    actor="runtime_delivery_bootstrap",
                    payload={},
                )
            latest_event = journal.append(
                process_id=process_id,
                kind="world_state_updated",
                revision_id=shared_state.revision_id,
                actor="runtime_delivery_bootstrap",
                payload={"world_state": dict(shared_state.world_state)},
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
    configured_initial_stages = [
        str(value or "").strip()
        for value in (
            request.initial_release_stage,
            contract_metadata.get("initial_release_stage"),
        )
        if str(value or "").strip()
    ]
    if any(stage != "draft" for stage in configured_initial_stages):
        raise HTTPException(
            status_code=400,
            detail="ordinary runtime release initialization is restricted to draft",
        )
    initial_stage = "draft"
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
    return release_store.save(state, actor=request.controller_id, provenance={"source": "runtime_delivery_bootstrap_release"})


def _mandatory_runtime_delivery_completion_criteria(process_id: str, target_environment: str) -> List[Dict[str, Any]]:
    return [
        {
            "criterion_id": "release-target-stage",
            "summary": f"Release must reach {target_environment}",
            "kind": "release_stage",
            "stage": target_environment,
            "metadata": {"comparison": "equals", "server_mandated": True},
        },
        {
            "criterion_id": "release-canary-stage",
            "summary": "Release must pass the independently verified canary stage",
            "kind": "release_stage",
            "stage": "canary_verified",
            "metadata": {"comparison": "at_least", "server_mandated": True},
        },
        {
            "criterion_id": "release-bundle",
            "summary": "Revision-bound release bundle must exist",
            "kind": "artifact_present",
            "artifact_id": f"artifact_release_bundle:{process_id}",
            "metadata": {"server_mandated": True},
        },
        {
            "criterion_id": "smoke-report",
            "summary": "Canary smoke report must exist",
            "kind": "artifact_present",
            "artifact_id": f"artifact_smoke_report:{process_id}",
            "metadata": {"server_mandated": True},
        },
    ]



def _resolve_runtime_delivery_contract(
    process_id: str,
    *,
    process: Dict[str, Any],
    stores: Dict[str, Any],
    request: RuntimeDeliveryReconcileRequest,
    bootstrap_recovery_contract: Optional[ProductionBuildContract] = None,
) -> ProductionBuildContract:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    workflow_contract = metadata.get("production_build_loop") if isinstance(metadata.get("production_build_loop"), dict) else {}
    stored_contract = stores["loop_store"].load_contract(process_id)

    payload: Dict[str, Any] = {}
    if stored_contract is not None:
        payload.update(model_dump_compat(stored_contract))
    elif workflow_contract:
        payload.update({key: value for key, value in workflow_contract.items() if key != "contract_id"})
    baseline_policy_id = str(payload.get("dependability_profile") or "24h").strip().lower()
    if isinstance(request.contract, dict):
        if "contract_id" in request.contract:
            requested_contract_id = str(request.contract.get("contract_id") or "").strip()
            recovery_identity_matches = bool(
                stored_contract is None
                and bootstrap_recovery_contract is not None
                and requested_contract_id == bootstrap_recovery_contract.contract_id
                and request.contract == model_dump_compat(bootstrap_recovery_contract)
            )
            if not recovery_identity_matches and (
                stored_contract is None or requested_contract_id != stored_contract.contract_id
            ):
                raise HTTPException(status_code=409, detail="production contract_id is server-owned and immutable")
        payload.update({key: value for key, value in request.contract.items() if key != "contract_id"})

    if stored_contract is not None:
        payload["contract_id"] = stored_contract.contract_id
    elif bootstrap_recovery_contract is not None:
        payload["contract_id"] = bootstrap_recovery_contract.contract_id
    else:
        payload.pop("contract_id", None)

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
    candidate_policy_id = str(payload["dependability_profile"]).strip().lower()
    try:
        policy_does_not_weaken = _production_policy_does_not_weaken(
            candidate_policy_id,
            baseline_policy_id,
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail="production dependability_profile must identify an immutable server policy",
        ) from exc
    if not policy_does_not_weaken:
        raise HTTPException(
            status_code=409,
            detail=(
                "production dependability policy cannot be weakened: "
                f"active={baseline_policy_id}, requested={candidate_policy_id}"
            ),
        )
    payload["dependability_profile"] = candidate_policy_id
    target_environment = str(payload.get("target_environment") or "production").strip() or "production"
    mandatory_criteria = _mandatory_runtime_delivery_completion_criteria(process_id, target_environment)
    reserved_ids = {row["criterion_id"] for row in mandatory_criteria}
    configured_criteria = list(payload.get("completion_criteria") or [])
    payload["completion_criteria"] = [
        row for row in configured_criteria
        if not isinstance(row, dict) or str(row.get("criterion_id") or "").strip() not in reserved_ids
    ] + mandatory_criteria

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
        "loop_persistence_revision": int(loop_state.persistence_revision or 0) if loop_state is not None else 0,
        "release_id": release_state.release_id if release_state is not None else None,
        "release_stage": release_state.current_stage if release_state is not None else None,
        "release_status": release_state.status if release_state is not None else None,
        "release_persistence_revision": int(release_state.persistence_revision or 0) if release_state is not None else 0,
        "shared_state_revision_id": shared_state.revision_id if shared_state is not None else None,
        "snapshot_id": snapshot.snapshot_id if snapshot is not None else None,
        "snapshot_persistence_revision": int(snapshot.persistence_revision or 0) if snapshot is not None else 0,
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



def _sync_runtime_process_delivery_state_locked(
    process_id: str,
    *,
    process: Dict[str, Any],
    stores: Dict[str, Any],
    event_kind: str,
    event_payload: Optional[Dict[str, Any]] = None,
    projection_transaction_id: Optional[str] = None,
) -> Dict[str, Any]:
    snapshot = stores["snapshot_store"].load(process_id)
    shared_state = stores["shared_state_store"].load(process_id)
    contract = stores["loop_store"].load_contract(process_id)
    loop_state = stores["loop_store"].load_state(process_id)
    release_state = stores["release_store"].load(process_id)
    reports = stores["loop_store"].reports(process_id)
    latest_report = reports[-1] if reports else None

    progress_projection_exists = False
    transaction_id = str(projection_transaction_id or "").strip()
    if transaction_id:
        progress_projection_exists = any(
            str(row.get("kind") or "") == f"{event_kind}.progress"
            and str((row.get("payload") or {}).get("rollback_transaction_id") or "") == transaction_id
            for row in get_runtime_events(process_id, limit=1000)
            if isinstance(row, dict) and isinstance(row.get("payload"), dict)
        )

    if snapshot is not None and not progress_projection_exists:
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
                **({"rollback_transaction_id": transaction_id} if transaction_id else {}),
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
        rollback_transaction_id = str((release_state.metadata or {}).get("rollback_transaction_id") or "").strip()
        if rollback_transaction_id:
            desired_metadata["last_runtime_delivery_rollback_transaction_id"] = rollback_transaction_id
    if shared_state is not None:
        desired_metadata["delivery_revision_id"] = shared_state.revision_id
    if loop_state is not None:
        desired_metadata["delivery_continuation_mode"] = loop_state.continuation.get("mode") if isinstance(loop_state.continuation, dict) else None
        desired_metadata["delivery_follow_up_due_at"] = (loop_state.owed_follow_up or {}).get("due_at") if isinstance(loop_state.owed_follow_up, dict) else None
        desired_metadata["delivery_conversation_ownership"] = dict(loop_state.conversation_ownership or {})
        desired_metadata["delivery_follow_through"] = dict(loop_state.follow_through or {})
    if contract is not None:
        desired_metadata["production_build_loop"] = model_dump_compat(contract)
    if transaction_id and snapshot is not None:
        restored_policy = dict(desired_metadata.get("policy") or {})
        restored_policy["settings"] = dict(snapshot.runtime_policy or {})
        desired_metadata["policy"] = restored_policy

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


def _sync_runtime_process_delivery_state(
    process_id: str,
    *,
    process: Dict[str, Any],
    stores: Dict[str, Any],
    event_kind: str,
    event_payload: Optional[Dict[str, Any]] = None,
    projection_transaction_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Project release state only from a view owned by its release fence."""

    release_store = stores["release_store"]
    transaction_id = str(projection_transaction_id or "").strip()
    with release_store.release_transaction(process_id):
        intent = release_store.load_rollback_intent(process_id)
        if intent and intent.get("status") in {"in_progress", "recovery_required"}:
            intent_transaction_id = str(intent.get("transaction_id") or "").strip()
            if not transaction_id or not hmac.compare_digest(transaction_id, intent_transaction_id):
                release_store.assert_mutation_allowed(
                    process_id,
                    operation="runtime process delivery projection",
                )
            release_state = release_store.load(process_id)
            if (
                release_state is None
                or not hmac.compare_digest(
                    str((release_state.metadata or {}).get("rollback_transaction_id") or ""),
                    transaction_id,
                )
            ):
                raise RuntimeError("rollback runtime projection is not bound to the authoritative transaction")
        else:
            release_store.assert_mutation_allowed(
                process_id,
                operation="runtime process delivery projection",
            )
        authoritative_process = get_runtime_process(process_id) or process
        return _sync_runtime_process_delivery_state_locked(
            process_id,
            process=authoritative_process,
            stores=stores,
            event_kind=event_kind,
            event_payload=event_payload,
            projection_transaction_id=projection_transaction_id,
        )



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
    rollback_transaction_id: str,
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
    prior_report = next(
        (
            row for row in reversed(loop_store.reports(process_id))
            if str((row.metadata or {}).get("rollback_transaction_id") or "") == rollback_transaction_id
        ),
        None,
    )
    iteration = prior_report.iteration if prior_report is not None else int(existing.iteration_count or 0) + 1
    report = prior_report or loop_store.append_report(
        ProductionBuildLoopReport(
            report_id=f"report_{rollback_transaction_id}",
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
                    "rollback_transaction_id": rollback_transaction_id,
                    "revision_id": shared_state.revision_id,
                    "snapshot_id": snapshot.snapshot_id,
                }
            ],
            blockers=blockers,
            completion=completion,
            metadata={
                "rollback_reason": reason,
                "rollback_fencepost_id": rollback_fencepost_id,
                "rollback_transaction_id": rollback_transaction_id,
                "shared_state_revision_id": shared_state.revision_id,
                "snapshot_id": snapshot.snapshot_id,
            },
        )
    )
    if (
        prior_report is not None
        and current is not None
        and str((current.metadata or {}).get("last_rollback_transaction_id") or "") == rollback_transaction_id
    ):
        return {"state": current, "report": prior_report}
    updated = loop_store.save_state(
        ProductionBuildLoopState(
            loop_id=existing.loop_id,
            contract_id=contract.contract_id,
            process_id=process_id,
            persistence_revision=(current or existing).persistence_revision,
            status=status,
            iteration_count=iteration,
            checkpoint_count=(
                int(existing.checkpoint_count or 0)
                if str((existing.metadata or {}).get("last_rollback_transaction_id") or "") == rollback_transaction_id
                else int(existing.checkpoint_count or 0) + 1
            ),
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
                "last_rollback_transaction_id": rollback_transaction_id,
            },
        )
    )
    return {"state": updated, "report": report}


def _apply_runtime_delivery_rollback_projections(
    process_id: str,
    *,
    process: Dict[str, Any],
    stores: Dict[str, Any],
    actor: str,
    reason: str,
    applied_state: ReleaseWorkflowState,
    restored_snapshot: ProcessSnapshot,
    restored_shared_state: SharedProcessState,
    intent: Dict[str, Any],
) -> Dict[str, Any]:
    transaction_id = str(intent.get("transaction_id") or "").strip()
    if not transaction_id:
        raise ValueError("rollback projection requires transaction_id")
    rollback_fencepost_id = str(intent.get("selected_fencepost_id") or "").strip() or None
    release_store = stores["release_store"]
    rollback_checkpoint = _checkpoint_runtime_delivery_rollback(
        process_id,
        contract=stores["loop_store"].load_contract(process_id),
        stores=stores,
        release_state=applied_state,
        snapshot=restored_snapshot,
        shared_state=restored_shared_state,
        actor=actor,
        reason=reason,
        rollback_fencepost_id=rollback_fencepost_id,
        rollback_transaction_id=transaction_id,
    )
    release_store.save_rollback_intent(
        process_id,
        {
            **intent,
            "phase": "loop_projection_committed",
            "status": "in_progress",
            "completed_projections": ["production_loop"],
        },
    )

    current_process = get_runtime_process(process_id) or process
    workflow = current_process.get("workflow") if isinstance(current_process.get("workflow"), dict) else {}
    workflow_metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    if str(workflow_metadata.get("last_runtime_delivery_rollback_transaction_id") or "") != transaction_id:
        current_process = _sync_runtime_process_delivery_state(
            process_id,
            process=current_process,
            stores=stores,
            event_kind="runtime_delivery_rollback_applied",
            event_payload={
                "actor": actor,
                "reason": reason,
                "release_stage": applied_state.current_stage,
                "shared_state_revision_id": restored_shared_state.revision_id,
                "rollback_transaction_id": transaction_id,
            },
            projection_transaction_id=transaction_id,
        )
    release_store.save_rollback_intent(
        process_id,
        {
            **intent,
            "phase": "runtime_process_projection_committed",
            "status": "in_progress",
            "completed_projections": ["production_loop", "runtime_process"],
        },
    )
    return {
        "completed_projections": ["production_loop", "runtime_process"],
        "loop_checkpoint": rollback_checkpoint,
        "process": current_process,
    }


def _recover_runtime_delivery_rollbacks(*, stores: Optional[Dict[str, Any]] = None) -> List[str]:
    active_stores = stores or _runtime_delivery_stores()
    release_store = active_stores["release_store"]
    recovered: List[str] = []
    for process_id in release_store.pending_rollback_process_ids():
        intent = release_store.load_rollback_intent(process_id) or {}
        required_projections = [str(row) for row in intent.get("required_projections") or [] if str(row).strip()]
        if not required_projections:
            continue
        release_state = release_store.load(process_id)
        process = get_runtime_process(process_id)
        if release_state is None or process is None:
            raise RuntimeError(f"cannot recover rollback projections for missing runtime process: {process_id}")

        def _project(**projection: Any) -> Dict[str, Any]:
            return _apply_runtime_delivery_rollback_projections(
                process_id,
                process=get_runtime_process(process_id) or process,
                stores=active_stores,
                actor=str(intent.get("actor") or "rollback-recovery"),
                reason=str(intent.get("reason") or "rollback-recovery"),
                applied_state=projection["applied_state"],
                restored_snapshot=projection["restored_snapshot"],
                restored_shared_state=projection["restored_shared_state"],
                intent=projection["intent"],
            )

        apply_release_rollback_restore(
            release_state,
            snapshot_store=active_stores["snapshot_store"],
            shared_state_store=active_stores["shared_state_store"],
            release_store=release_store,
            journal=active_stores["journal"],
            session_registry=active_stores["session_registry"],
            watcher_store=active_stores["watcher_store"],
            actor=str(intent.get("actor") or "rollback-recovery"),
            reason=str(intent.get("reason") or "rollback-recovery"),
            required_projections=required_projections,
            projection_callback=_project,
        )
        recovered.append(process_id)
    return recovered


def _recover_runtime_delivery_bootstraps(*, stores: Optional[Dict[str, Any]] = None) -> List[str]:
    active_stores = stores or _runtime_delivery_stores()
    root = Path(active_stores["root"]) / "release_bootstrap_intents"
    recovered: List[str] = []
    if not root.exists():
        return recovered
    for target in sorted(root.glob("*.json")):
        payload = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or payload.get("version") != "cortex.runtime-delivery.release-bootstrap.v1":
            raise RuntimeError(f"invalid runtime delivery bootstrap intent: {target.name}")
        process_id = str(payload.get("process_id") or "").strip()
        request_payload = payload.get("request")
        contract_payload = payload.get("contract")
        if not process_id or not isinstance(request_payload, dict) or not isinstance(contract_payload, dict):
            raise RuntimeError(f"incomplete runtime delivery bootstrap intent: {target.name}")
        if target != _release_bootstrap_intent_target(
            stores=active_stores,
            process_id=process_id,
        ):
            raise RuntimeError(f"runtime delivery bootstrap intent path mismatch: {target.name}")
        try:
            recovery_contract = ProductionBuildContract.model_validate(contract_payload)
        except Exception as exc:
            raise RuntimeError(f"invalid runtime delivery bootstrap contract: {target.name}") from exc
        if recovery_contract.process_id != process_id:
            raise RuntimeError(f"runtime delivery bootstrap contract process mismatch: {target.name}")
        request_payload = {**request_payload, "contract": contract_payload, "initialize_release": True}
        request = RuntimeDeliveryReconcileRequest.model_validate(request_payload)
        _reconcile_runtime_delivery_sequence(
            process_id,
            request=request,
            stores=active_stores,
            bootstrap_recovery_contract=recovery_contract,
        )
        recovered.append(process_id)
    return recovered


@router.on_event("startup")
async def recover_runtime_delivery_rollbacks_on_startup() -> None:
    stores = _runtime_delivery_stores()
    # Allocate and verify the physical rollback reserve before readiness can
    # advertise the delivery plane, including on a completely fresh volume.
    with runtime_delivery_quota_transaction(Path(stores["root"])):
        pass
    _recover_runtime_delivery_bootstraps(stores=stores)
    _recover_runtime_delivery_rollbacks(stores=stores)
    for process in list_runtime_processes():
        process_id = str(process.get("process_id") or "").strip()
        if not process_id:
            continue
        with _runtime_session_mutation(
            stores=stores,
            process_id=process_id,
            operation="legacy watcher attestation migration",
        ):
            _migrate_runtime_watcher_attestations(
                process_id=process_id,
                process=get_runtime_process(process_id) or process,
                stores=stores,
            )



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



def _bridge_runtime_delivery_follow_up_locked(
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


def _bridge_runtime_delivery_follow_up(
    process_id: str,
    *,
    process: Dict[str, Any],
    stores: Dict[str, Any],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    with stores["release_store"].release_transaction(process_id):
        stores["release_store"].assert_mutation_allowed(
            process_id,
            operation="runtime delivery follow-up projection",
        )
        latest_process = get_runtime_process(process_id) or process
        return _bridge_runtime_delivery_follow_up_locked(
            process_id,
            process=latest_process,
            stores=stores,
            now=now,
        )



def _bridge_runtime_roadmap_follow_up_locked(
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


def _bridge_runtime_roadmap_follow_up(
    process_id: str,
    *,
    process: Dict[str, Any],
    stores: Dict[str, Any],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    with stores["release_store"].release_transaction(process_id):
        stores["release_store"].assert_mutation_allowed(
            process_id,
            operation="runtime roadmap follow-up projection",
        )
        latest_process = get_runtime_process(process_id) or process
        return _bridge_runtime_roadmap_follow_up_locked(
            process_id,
            process=latest_process,
            stores=stores,
            now=now,
        )


def _reconcile_runtime_roadmap_sequence(
    *,
    process_id: str,
    process: Dict[str, Any],
    stores: Dict[str, Any],
    contract: RoadmapObjectiveContract,
    controller_id: str,
    controller_session_id: str,
    now: Optional[datetime],
    bootstrap_runtime_state: bool,
    bootstrap_session_plane: bool = False,
    watchdog_context: Optional[Dict[str, Any]] = None,
    event_kind: str,
    event_payload: Optional[Dict[str, Any]] = None,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    """Run roadmap bootstrap, repair, dispatch, projection, and follow-up atomically."""

    with stores["release_store"].release_transaction(process_id):
        stores["release_store"].assert_mutation_allowed(
            process_id,
            operation="runtime roadmap reconciliation sequence",
        )
        process = get_runtime_process(process_id) or process
        if bootstrap_session_plane:
            _ensure_runtime_session_plane_bootstrap(process_id, process=process, stores=stores)
            if callable(progress_callback):
                progress_callback()
        if bootstrap_runtime_state:
            _bootstrap_runtime_delivery_state(process_id, process=process, stores=stores)
            if callable(progress_callback):
                progress_callback()
        snapshot = stores["snapshot_store"].load(process_id)
        shared_state = stores["shared_state_store"].load(process_id)
        if snapshot is None or shared_state is None:
            raise ValueError(f"runtime roadmap state missing for {process_id}; enable bootstrap_runtime_state to initialize it")
        reconciled = reconcile_roadmap_execution(
            contract,
            roadmap_store=stores["roadmap_store"],
            snapshot_store=stores["snapshot_store"],
            shared_state_store=stores["shared_state_store"],
            mailbox=stores["mailbox"],
            supervisor=stores["supervisor"],
            release_store=stores["release_store"],
            controller_id=controller_id,
            controller_session_id=controller_session_id,
            journal=stores["journal"],
            now=now,
            watchdog_context=watchdog_context,
        )
        if callable(progress_callback):
            progress_callback()
        state = reconciled.get("state") if isinstance(reconciled.get("state"), dict) else {}
        process = _sync_runtime_process_roadmap_state(
            process_id,
            process=get_runtime_process(process_id) or process,
            stores=stores,
            event_kind=event_kind,
            event_payload={
                **dict(event_payload or {}),
                "controller_id": controller_id,
                "controller_session_id": controller_session_id,
                "status": state.get("status"),
                "active_phase_id": state.get("active_phase_id"),
            },
        )
        if callable(progress_callback):
            progress_callback()
        follow_up = _bridge_runtime_roadmap_follow_up_locked(
            process_id,
            process=process,
            stores=stores,
            now=now,
        )
        if callable(progress_callback):
            progress_callback()
        return {
            "contract": contract,
            "reconciled": reconciled,
            "process": follow_up.get("process") or process,
            "follow_up": follow_up,
        }



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
    done_key = str(metadata.get("done_world_state_key") or f"maintenance_queue.{item.item_id}.done")
    metadata["done_world_state_key"] = done_key
    metadata.setdefault("maintenance_queue", {})
    if isinstance(metadata.get("maintenance_queue"), dict):
        metadata["maintenance_queue"] = {**dict(metadata.get("maintenance_queue") or {}), "item_id": item.item_id, "queue_name": item.queue_name}
    payload["metadata"] = metadata
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


_MAINTENANCE_DISPATCH_LEASE_SECONDS = 300


def _maintenance_dispatch_now() -> datetime:
    """Return trusted server time for dispatch fencing, never request simulation time."""
    return datetime.now().astimezone()


def _maintenance_dispatch_iso(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _renew_maintenance_dispatch_or_raise(
    queue_store: MaintenanceQueueStore,
    *,
    item_id: str,
    owner: str,
) -> str:
    renewed_at = _maintenance_dispatch_now()
    renewed_at_iso = _maintenance_dispatch_iso(renewed_at)
    lease_expires_at = _maintenance_dispatch_iso(
        renewed_at + timedelta(seconds=_MAINTENANCE_DISPATCH_LEASE_SECONDS)
    )
    if not queue_store.renew_dispatch(
        item_id,
        owner=owner,
        renewed_at=renewed_at_iso,
        lease_expires_at=lease_expires_at,
    ):
        raise RuntimeError(f"maintenance dispatch lease lost for '{item_id}'")
    return renewed_at_iso


def _runtime_maintenance_queue_sync(
    *,
    stores: Dict[str, Any],
    now: Optional[datetime] = None,
    allow_claim: bool = True,
) -> Dict[str, Any]:
    current_time = now or datetime.now().astimezone()
    now_iso = current_time.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    queue_store = stores["maintenance_queue_store"]
    # A claimant can disappear between the durable queue claim and roadmap
    # initialization. Expired dispatch leases make those records runnable
    # again while preventing a concurrent synchronizer from stealing a live
    # claim.
    dispatch_now = _maintenance_dispatch_now()
    queue_state = queue_store.recover_expired_dispatches(now=_maintenance_dispatch_iso(dispatch_now))
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
    # Persist refreshed projections/statuses with the captured version.  A CAS
    # failure means another writer won; reload on the next sync rather than
    # replacing its state.
    try:
        queue_state = queue_store.merge_items(list(by_id.values()), expected_updated_at=queue_state.updated_at)
    except RuntimeError:
        queue_state = queue_store.get_state()

    if allow_claim:
        claim_budget = max(0, capacity - sum(1 for row in queue_state.items if row.status == "active"))
        for _ in range(claim_budget):
            dispatch_owner = f"maintenance-queue:{uuid4().hex}"
            dispatch_started_at = _maintenance_dispatch_now()
            lease_expires_at = _maintenance_dispatch_iso(
                dispatch_started_at + timedelta(seconds=_MAINTENANCE_DISPATCH_LEASE_SECONDS)
            )
            item, claimed_state = queue_store.begin_dispatch(
                claimed_at=now_iso,
                lease_expires_at=lease_expires_at,
                owner=dispatch_owner,
                process_id_for_item=_maintenance_queue_process_id,
            )
            if item is None:
                queue_state = claimed_state
                break
            # The active transition above is the ownership fence. Only this
            # caller can cross it and perform non-idempotent dispatch work.
            try:
                guarded_at = _renew_maintenance_dispatch_or_raise(
                    queue_store, item_id=item.item_id, owner=dispatch_owner
                )
                with queue_store.dispatch_guard(
                    item.item_id, owner=dispatch_owner, guarded_at=guarded_at
                ):
                    process = get_runtime_process(item.process_id) if item.process_id else None
                    if process is None:
                        _renew_maintenance_dispatch_or_raise(
                            queue_store, item_id=item.item_id, owner=dispatch_owner
                        )
                        process = create_process_from_workflow(
                            _maintenance_queue_workflow(item),
                            process_id=item.process_id or _maintenance_queue_process_id(item),
                            owner="cortex",
                            session_key=str((item.source_message or {}).get("session_key") or "").strip() or None,
                        )
                    item.process_id = process.get("process_id")
                    _renew_maintenance_dispatch_or_raise(
                        queue_store, item_id=item.item_id, owner=dispatch_owner
                    )
                    contract = _maintenance_queue_contract_for_process(item, process_id=item.process_id)
                    _renew_maintenance_dispatch_or_raise(
                        queue_store, item_id=item.item_id, owner=dispatch_owner
                    )
                    sequence = _reconcile_runtime_roadmap_sequence(
                        process_id=item.process_id,
                        process=process,
                        stores=stores,
                        contract=contract,
                        controller_id="maintenance-queue",
                        controller_session_id=f"maintenance-queue:{item.item_id}",
                        now=current_time,
                        bootstrap_runtime_state=True,
                        bootstrap_session_plane=True,
                        event_kind="runtime_maintenance_queue_claimed",
                        event_payload={"item_id": item.item_id, "queue_name": item.queue_name},
                        progress_callback=lambda: _renew_maintenance_dispatch_or_raise(
                            queue_store,
                            item_id=item.item_id,
                            owner=dispatch_owner,
                        ),
                    )
                    reconciled = sequence["reconciled"]
                    process = sequence["process"]
                    follow_up_bridge = sequence["follow_up"]
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
                    confirmed_at = _renew_maintenance_dispatch_or_raise(
                        queue_store, item_id=item.item_id, owner=dispatch_owner
                    )
                    finished, queue_state = queue_store.finish_dispatch(
                        item, owner=dispatch_owner, confirmed_at=confirmed_at
                    )
                    if not finished:
                        raise RuntimeError(f"maintenance dispatch lease lost for '{item.item_id}'")
            except BaseException as exc:
                try:
                    released_at = _maintenance_dispatch_iso(_maintenance_dispatch_now())
                    queue_store.release_dispatch(
                        item.item_id,
                        owner=dispatch_owner,
                        released_at=released_at,
                        reason=f"{type(exc).__name__}:dispatch_failed",
                    )
                except Exception:
                    # Preserve the dispatch exception. A failed rollback remains
                    # protected by the durable lease and is recovered later.
                    pass
                raise
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

    persisted = list(queue_state.items)
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


RUNTIME_SESSION_EVENT_PAYLOAD_MAX_BYTES = 48 * 1024


def _bounded_runtime_session_payload(value: Dict[str, Any]) -> Dict[str, Any]:
    try:
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError("runtime session payload must be canonically JSON serializable") from exc
    if len(encoded) > RUNTIME_SESSION_EVENT_PAYLOAD_MAX_BYTES:
        raise ValueError(
            f"runtime session payload exceeds {RUNTIME_SESSION_EVENT_PAYLOAD_MAX_BYTES} bytes"
        )
    return value


class RuntimeSessionEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    event: str = Field(min_length=1, max_length=256)
    event_id: Optional[str] = Field(None, min_length=1, max_length=128)
    session_id: Optional[str] = Field(None, min_length=1, max_length=128)
    session_name: Optional[str] = Field(None, max_length=256)
    tool: Optional[str] = Field(None, max_length=256)
    summary: Optional[str] = Field(None, max_length=4096)
    status: Optional[str] = Field(None, max_length=256)
    payload: Dict[str, Any] = Field(default_factory=dict)

    _bounded_payload = field_validator("payload")(_bounded_runtime_session_payload)


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
    model_config = ConfigDict(extra="forbid")

    process_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
    tool: str = Field(min_length=1, max_length=256)
    event: str = Field(min_length=1, max_length=256)
    event_id: Optional[str] = Field(None, min_length=1, max_length=128)
    session_id: Optional[str] = Field(None, min_length=1, max_length=128)
    session_name: Optional[str] = Field(None, max_length=256)
    payload: Dict[str, Any] = Field(default_factory=dict)

    _bounded_payload = field_validator("payload")(_bounded_runtime_session_payload)


class RuntimePolicyApplyRequest(BaseModel):
    dry_run: bool = False
    allow_confirmation_required: bool = False
    settings: Optional[List[str]] = None
    metadata_overrides: Optional[Dict[str, Any]] = None


class RuntimePolicyRollbackRequest(BaseModel):
    dry_run: bool = False
    allow_confirmation_required: bool = False
    allow_intervening_revisions: bool = False


class RuntimeDeliveryDlqActionRequest(BaseModel):
    actor: str = "cortex"
    reason: str = "operator_reviewed"


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
    dependability_profile: Optional[str] = None
    execution_budget: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    candidate_ref: Optional[str] = None
    initial_release_stage: Optional[str] = None
    bootstrap_runtime_state: bool = True
    initialize_release: bool = True
    controller_id: str = "cortex"
    controller_session_id: Optional[str] = None
    now_iso: Optional[str] = None

    @field_validator("dependability_profile", mode="before")
    @classmethod
    def _uses_server_dependability_policy(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("production dependability_profile must be a server-owned policy identifier")
        policy_id = value.strip().lower()
        try:
            build_unattended_profile(policy_id)
        except KeyError as exc:
            raise ValueError(
                f"unknown server-owned production dependability policy: {value}"
            ) from exc
        return policy_id

    @field_validator("contract")
    @classmethod
    def _contract_uses_server_dependability_policy(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not isinstance(value, dict) or "dependability_profile" not in value:
            return value
        policy = value.get("dependability_profile")
        if not isinstance(policy, str):
            raise ValueError("production dependability_profile must be a server-owned policy identifier")
        policy_id = policy.strip().lower()
        try:
            build_unattended_profile(policy_id)
        except KeyError as exc:
            raise ValueError(
                f"unknown server-owned production dependability policy: {policy}"
            ) from exc
        return {**value, "dependability_profile": policy_id}

    @field_validator("initial_release_stage")
    @classmethod
    def _ordinary_initial_release_stage_is_draft(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stage = str(value or "").strip()
        if stage != "draft":
            raise ValueError("ordinary runtime release initialization is restricted to draft")
        return stage


class RuntimeDeliveryRollbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    idempotency_key: str = Field(min_length=1, max_length=256)
    stage: Optional[str] = None
    fencepost_id: Optional[str] = None
    reason: str = "operator_requested"
    actor: str = "cortex"


RUNTIME_DELIVERY_METADATA_MAX_BYTES = 256 * 1024
RUNTIME_DELIVERY_SIGNATURE_PATTERN = r"^[\x20-\x7e]+$"


def _bounded_runtime_delivery_mapping(value: Dict[str, Any], *, field_name: str) -> Dict[str, Any]:
    try:
        encoded = canonical_release_artifact_bytes(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be canonically JSON serializable") from exc
    if len(encoded) > RUNTIME_DELIVERY_METADATA_MAX_BYTES:
        raise ValueError(
            f"{field_name} exceeds maximum size of {RUNTIME_DELIVERY_METADATA_MAX_BYTES} bytes"
        )
    return value


class RuntimeDeliveryArtifactIngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    artifact_id: str = Field(min_length=1, max_length=256)
    payload: Any
    artifact_kind: str = Field(min_length=1, max_length=128)
    producer: str = Field(min_length=1, max_length=256)
    verifier: str = Field(min_length=1, max_length=256)
    # Treat a bounded, printable signature as an opaque credential here.  Its
    # exact HMAC shape and value are authenticated before durable publication.
    attestation_signature: str = Field(
        min_length=1,
        max_length=64,
        pattern=RUNTIME_DELIVERY_SIGNATURE_PATTERN,
    )
    validation_outcome: str = Field(default="passed", min_length=1, max_length=16)
    target_stage: Optional[str] = Field(default=None, min_length=1, max_length=64)
    claims: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(min_length=1, max_length=64)

    @field_validator("payload")
    @classmethod
    def _bounded_payload(cls, value: Any) -> Any:
        limits = release_artifact_storage_limits()
        encoded = canonical_release_artifact_bytes(value)
        if len(encoded) > limits.max_artifact_bytes:
            raise ValueError(
                f"payload exceeds maximum artifact size of {limits.max_artifact_bytes} bytes"
            )
        return value

    @field_validator("claims")
    @classmethod
    def _bounded_claims(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return _bounded_runtime_delivery_mapping(value, field_name="claims")


class RuntimeDeliveryHandoffClaimRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipient: str = Field(min_length=1, max_length=256)
    process_id: str = Field(min_length=1, max_length=256)
    expected_revision_id: str = Field(min_length=1, max_length=256)
    request_id: str = Field(min_length=1, max_length=256)
    requested_at: str = Field(min_length=1, max_length=64)
    recipient_signature: str = Field(
        min_length=1,
        max_length=64,
        pattern=RUNTIME_DELIVERY_SIGNATURE_PATTERN,
    )


class RuntimeDeliveryHandoffClaimNextRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipient: str = Field(min_length=1, max_length=256)
    request_id: str = Field(min_length=1, max_length=256)
    requested_at: str = Field(min_length=1, max_length=64)
    recipient_signature: str = Field(
        min_length=1,
        max_length=64,
        pattern=RUNTIME_DELIVERY_SIGNATURE_PATTERN,
    )


class RuntimeDeliveryManagerRollbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    release_id: str = Field(min_length=1, max_length=256)
    revision_id: str = Field(min_length=1, max_length=256)
    idempotency_key: str = Field(min_length=1, max_length=256)
    reason: str = Field(min_length=1, max_length=512)
    request_id: str = Field(min_length=1, max_length=256)
    requested_at: str = Field(min_length=1, max_length=64)
    manager_signature: str = Field(
        min_length=1,
        max_length=64,
        pattern=RUNTIME_DELIVERY_SIGNATURE_PATTERN,
    )


class RuntimeDeliveryVerifierCapabilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verifier: str = Field(min_length=1, max_length=256)
    request_id: str = Field(min_length=1, max_length=256)
    requested_at: str = Field(min_length=1, max_length=64)
    verifier_signature: str = Field(
        min_length=1,
        max_length=64,
        pattern=RUNTIME_DELIVERY_SIGNATURE_PATTERN,
    )


class RuntimeDeliveryArtifactFetchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipient: str = Field(min_length=1, max_length=256)
    process_id: str = Field(min_length=1, max_length=256)
    release_id: str = Field(min_length=1, max_length=256)
    revision_id: str = Field(min_length=1, max_length=256)
    artifact_ref: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    request_id: str = Field(min_length=1, max_length=256)
    requested_at: str = Field(min_length=1, max_length=64)
    recipient_signature: str = Field(
        min_length=1,
        max_length=64,
        pattern=RUNTIME_DELIVERY_SIGNATURE_PATTERN,
    )


class RuntimeDeliveryHandoffAcknowledgeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipient: str = Field(min_length=1, max_length=256)
    result_receipt: Dict[str, Any]
    recipient_signature: str = Field(
        min_length=1,
        max_length=64,
        pattern=RUNTIME_DELIVERY_SIGNATURE_PATTERN,
    )

    @field_validator("result_receipt")
    @classmethod
    def _bounded_result_receipt(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return _bounded_runtime_delivery_mapping(value, field_name="result_receipt")


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


def _belief_scope_from_http_request(request: Optional[Request]) -> Optional[Dict[str, str]]:
    state = getattr(request, "state", None)
    principal = getattr(state, "cortex_principal", None) or getattr(state, "cortex_read_principal", None)
    if principal is None or getattr(principal, "role", "") != "principal":
        return None
    return {
        "tenant_id": str(principal.tenant_id),
        "workspace_id": str(principal.storage_workspace_id),
        "agent_id": str(principal.agent_id),
        "user_id": str(principal.user_id),
        "channel_id": str(principal.channel_id),
        "session_id": str(principal.session_id),
    }


def _belief_scope_from_workflow_metadata(metadata: Optional[Dict[str, Any]]) -> Optional[Dict[str, str]]:
    principal = (metadata or {}).get("principal")
    if not isinstance(principal, dict):
        return None
    scope = {
        "tenant_id": str(principal.get("tenant_id") or "").strip(),
        "workspace_id": str(principal.get("storage_workspace_id") or "").strip(),
        "agent_id": str(principal.get("agent_id") or "").strip(),
        "user_id": str(principal.get("user_id") or "").strip(),
        "channel_id": str(principal.get("channel_id") or "").strip(),
        "session_id": str(principal.get("session_id") or "").strip(),
    }
    return scope if all(scope.values()) else None


def _belief_scope_or_denied(scope: Optional[Dict[str, str]]) -> Dict[str, str]:
    if scope is not None:
        return scope
    denied = "denied-no-auth-principal"
    return {
        "tenant_id": denied,
        "workspace_id": denied,
        "agent_id": denied,
        "user_id": denied,
        "channel_id": denied,
        "session_id": denied,
    }


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
    scope = _belief_scope_from_workflow_metadata(metadata)
    selected = [] if scope is None else select_influential_beliefs(
        task_id=task_id,
        subjects=subjects or None,
        predicates=predicates or None,
        query=query,
        limit=8,
        scope=scope,
    )
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



def _store_workflow_from_plan(
    graph: ReasoningPlanGraph,
    *,
    belief_scope: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    try:
        workflow = runtime_workflows.build_workflow_from_plan(
            graph,
            compile_plan_to_workflow_fn=compile_plan_to_workflow,
            compile_plan_to_reasoning_task_fn=compile_plan_to_reasoning_task,
            model_dump_compat_fn=model_dump_compat,
            build_workflow_policy_fn=partial(build_workflow_policy, belief_scope=belief_scope),
        )
    except PlanGraphError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _stats["workflows_created"] += 1
    _persist_workflow(workflow)
    return workflow



def _step_index_for_node(workflow: Dict[str, Any], node_id: str) -> int:
    return runtime_workflows.step_index_for_node(workflow, node_id)



def _record_runtime_beliefs(
    *,
    process_id: str,
    task_id: Optional[str],
    node_id: str,
    step_result: Dict[str, Any],
    workflow_metadata: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    scope = _belief_scope_from_workflow_metadata(workflow_metadata)
    if scope is None:
        return []
    return runtime_workflows.record_runtime_beliefs(
        process_id=process_id,
        task_id=task_id,
        node_id=node_id,
        step_result=step_result,
        upsert_belief_fn=upsert_belief,
        scope=scope,
    )


def _reasoning_scheduler_tick_fenced(*, now_iso: Optional[str] = None, limit: int = 50) -> Dict[str, Any]:
    stores = _runtime_delivery_stores()
    process_ids = sorted(
        {
            str(row.get("process_id") or "").strip()
            for row in list_runtime_processes()
            if str(row.get("process_id") or "").strip()
        }
    )
    with ExitStack() as stack:
        for process_id in process_ids:
            stack.enter_context(stores["release_store"].release_transaction(process_id))
            stores["release_store"].assert_mutation_allowed(
                process_id,
                operation="reasoning scheduler tick",
            )
        return reasoning_scheduler_tick(now_iso=now_iso, limit=limit)


async def _execute_runtime_batch(*, limit: int = 25, now_iso: Optional[str] = None) -> Dict[str, Any]:
    stores = _runtime_delivery_stores()

    @asynccontextmanager
    async def _execution_fence(process_id: str):
        transaction = stores["release_store"].release_transaction(process_id, nonblocking=True)
        transaction.__enter__()
        try:
            stores["release_store"].assert_mutation_allowed(
                process_id,
                operation="reasoning runtime execution",
            )
            yield
        finally:
            transaction.__exit__(None, None, None)

    return await runtime_workflows.execute_runtime_batch(
        limit=limit,
        now_iso=now_iso,
        scheduler_tick_fn=_reasoning_scheduler_tick_fenced,
        get_runtime_process_fn=get_runtime_process,
        mark_node_running_fn=mark_node_running,
        execute_step_with_retry_fn=_execute_step_with_retry,
        step_index_for_node_fn=_step_index_for_node,
        step_belief_context_fn=_step_belief_context,
        record_runtime_beliefs_fn=_record_runtime_beliefs,
        record_node_result_fn=record_node_result,
        workflow_policy_settings_fn=_workflow_policy_settings,
        scheduler_error_cls=ReasoningSchedulerError,
        process_execution_fence_fn=_execution_fence,
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



def _reconcile_runtime_delivery_watchdog_sequence(
    *,
    process_id: str,
    process: Dict[str, Any],
    contract: ProductionBuildContract,
    decision: Dict[str, Any],
    stores: Dict[str, Any],
    now: datetime,
) -> Dict[str, Any]:
    with stores["release_store"].release_transaction(process_id):
        stores["release_store"].assert_mutation_allowed(
            process_id,
            operation="runtime delivery watchdog sequence",
        )
        if stores["snapshot_store"].load(process_id) is None or stores["shared_state_store"].load(process_id) is None:
            _bootstrap_runtime_delivery_state(process_id, process=process, stores=stores)
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
            event_payload={
                "decision": decision.get("decision"),
                "classification": decision.get("classification"),
                "status": (reconciled.get("state") or {}).get("status"),
            },
        )
        follow_up = _bridge_runtime_delivery_follow_up(
            process_id,
            process=process,
            stores=stores,
            now=now,
        )
        return {
            "reconciled": reconciled,
            "process": follow_up.get("process") or process,
            "follow_up": follow_up,
        }


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
            bootstrap_runtime_state = snapshot is None or shared_state is None
            contract = _resolve_runtime_roadmap_contract(process_id, process=process, stores=stores, request=RuntimeRoadmapReconcileRequest())
            state = stores["roadmap_store"].load_state(process_id)
            decision = _runtime_roadmap_watchdog_decision(process=process, contract=contract, state=state, now=now)
            if decision is not None:
                sequence = _reconcile_runtime_roadmap_sequence(
                    process_id=process_id,
                    process=process,
                    stores=stores,
                    contract=contract,
                    controller_id="runtime-watchdog",
                    controller_session_id=f"runtime-watchdog:{process_id}",
                    now=now,
                    bootstrap_runtime_state=bootstrap_runtime_state,
                    watchdog_context={**decision, "source": "runtime_tick", "process_id": process_id},
                    event_kind="runtime_roadmap_watchdog",
                    event_payload={
                        "decision": decision.get("decision"),
                        "classification": decision.get("classification"),
                    },
                )
                reconciled = sequence["reconciled"]
                process = sequence["process"]
                follow_up_bridge = sequence["follow_up"]
                actions.append({"kind": "roadmap", "process_id": process_id, "decision": decision, "status": (reconciled.get("state") or {}).get("status"), "report": (reconciled.get("report") or {}).get("kind") if isinstance(reconciled.get("report"), dict) else None, "follow_up_dispatch": follow_up_bridge.get("dispatch")})
                continue
        if (stores["loop_store"].load_contract(process_id) is not None or stores["loop_store"].load_state(process_id) is not None or isinstance(metadata.get("production_build_loop"), dict)) and (snapshot is not None or shared_state is not None):
            contract = _resolve_runtime_delivery_contract(process_id, process=process, stores=stores, request=RuntimeDeliveryReconcileRequest())
            state = stores["loop_store"].load_state(process_id)
            decision = _runtime_delivery_watchdog_decision(process=process, contract=contract, state=state, now=now)
            if decision is not None:
                try:
                    sequence = _reconcile_runtime_delivery_watchdog_sequence(
                        process_id=process_id,
                        process=process,
                        contract=contract,
                        decision=decision,
                        stores=stores,
                        now=now,
                    )
                except (PermissionError, RuntimeError) as exc:
                    actions.append(
                        {
                            "kind": "delivery_owner_held",
                            "process_id": process_id,
                            "decision": decision,
                            "status": state.status if state is not None else None,
                            "detail": str(exc),
                        }
                    )
                    continue
                reconciled = sequence["reconciled"]
                process = sequence["process"]
                follow_up_bridge = sequence["follow_up"]
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
async def schedule_plan_runtime(request: RuntimePlanRequest, http_request: Request = None):
    """Store a plan graph as a managed reasoning process without executing it yet."""
    principal = getattr(getattr(http_request, "state", None), "cortex_principal", None)
    if principal is not None and getattr(principal, "role", "") == "principal":
        principal_metadata = {
            "tenant_id": principal.tenant_id,
            "workspace_id": principal.workspace_id,
            "storage_workspace_id": principal.storage_workspace_id,
            "agent_id": principal.agent_id,
            "user_id": principal.user_id,
            "channel_id": principal.channel_id,
            "session_id": principal.session_id,
            "scope_credential_id": principal.credential_id,
            "owner": principal.user_id,
        }
        supplied_metadata = dict(request.graph.metadata or {})
        for physical_root_field in ("workspace_path", "workspace_root", "repo_root", "repo_path", "target_path", "workspace_paths"):
            supplied_metadata.pop(physical_root_field, None)
        request.graph.metadata = {
            **supplied_metadata,
            **principal_metadata,
            "principal": dict(principal_metadata),
        }
        request.options.owner = principal.user_id
        request.options.session_key = principal.session_id
    belief_scope = None
    if principal is not None and getattr(principal, "role", "") == "principal":
        belief_scope = {
            "tenant_id": principal.tenant_id,
            "workspace_id": principal.storage_workspace_id,
            "agent_id": principal.agent_id,
            "user_id": principal.user_id,
            "channel_id": principal.channel_id,
            "session_id": principal.session_id,
        }
    workflow = _store_workflow_from_plan(request.graph, belief_scope=belief_scope)
    try:
        scheduled = runtime_service.schedule_runtime_plan(
            request,
            workflow=workflow,
            create_approval_grant_fn=create_approval_grant,
            build_workflow_policy_fn=partial(build_workflow_policy, belief_scope=belief_scope),
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
    try:
        if not bool(request.execute):
            tick = _reasoning_scheduler_tick_fenced(now_iso=request.now_iso, limit=request.limit)
            watchdog = _run_runtime_no_silent_idle_watchdog(now_iso=request.now_iso, limit=request.limit)
            session_watchdog = await reconcile_runtime_watchers(RuntimeWatcherReconcileRequest(now_iso=request.now_iso))
            return {"success": True, "tick": tick, "executed": [], "executed_count": 0, "watchdog": watchdog, "session_watchdog": session_watchdog, "session_plane": _runtime_session_plane_status(stores=stores)}
        batch = await _execute_runtime_batch(limit=request.limit, now_iso=request.now_iso)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
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
    try:
        with _runtime_session_mutation(
            stores=stores,
            process_id=request.process_id,
            operation="runtime session registration",
        ):
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
            _upsert_runtime_snapshot_session_state_locked(
                process_id=request.process_id,
                stores=stores,
                process=get_runtime_process(request.process_id) or process,
            )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"success": True, "process": process, "session": model_dump_compat(record)}


@router.get("/runtime/sessions")
async def list_runtime_sessions(process_id: Optional[str] = None):
    stores = _runtime_delivery_stores()
    _refresh_runtime_session_plane(stores=stores, process_id=process_id)
    return {"success": True, "sessions": [model_dump_compat(row) for row in stores["session_registry"].list(process_id=process_id)]}


@router.post("/runtime/session/event")
async def record_runtime_session_event(request: RuntimeSessionEventRequest):
    stores = _runtime_delivery_stores()
    if get_runtime_process(request.process_id) is None:
        raise HTTPException(status_code=404, detail=f"Runtime process '{request.process_id}' not found")
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
    if request.event_id:
        event_id = str(request.event_id).strip()
        if not event_id:
            raise HTTPException(status_code=422, detail="event_id must be non-empty when supplied")
        event.event_id = event_id
    try:
        with (
            _runtime_session_mutation(
                stores=stores,
                process_id=request.process_id,
                operation="runtime session event ingestion",
            ),
            stores["session_registry"]._transaction(),
        ):
            _preflight_runtime_session_event(event, stores=stores)
            with stores["runtime_memory_store"].session_event_admission(event):
                delivery = resilient_delivery_attempt(
                    "runtime_session_event_ingest",
                    lambda: _record_runtime_session_event_locked(process_id=request.process_id, event=event, stores=stores),
                    process_id=request.process_id,
                    event_kind=event.kind,
                    payload=model_dump_compat(event),
                    dlq_store=stores["delivery_dlq"],
                )
    except RuntimeMemoryLimitError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (PermissionError, RuntimeError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
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
    try:
        with _runtime_session_mutation(
            stores=stores,
            process_id=request.process_id,
            operation="runtime session heartbeat",
        ):
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
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {
        "success": True,
        "session": model_dump_compat(result.get("session")),
        "event": model_dump_compat(result.get("event")),
        "memory_path": result.get("memory_path"),
    }


@router.post("/runtime/watchers/register")
async def register_runtime_watcher(request: RuntimeWatcherRegisterRequest, http_request: Request = None):
    stores = _runtime_delivery_stores()
    process = get_runtime_process(request.process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{request.process_id}' not found")
    try:
        with _runtime_session_mutation(
            stores=stores,
            process_id=request.process_id,
            operation="runtime watcher registration",
        ):
            principal = getattr(getattr(http_request, "state", None), "cortex_principal", None)
            if (
                request.kind in {"workspace", "log-pattern", "path-state"}
                and principal is not None
                and getattr(principal, "role", "") == "principal"
            ):
                raise HTTPException(status_code=403, detail="principal-created file watchers require a server-attested workspace capability")
            authorized_roots = _authorize_runtime_watcher_target(
                process=get_runtime_process(request.process_id) or process,
                kind=request.kind,
                target=request.target,
            )
            watcher_metadata = dict(request.metadata or {})
            if authorized_roots:
                watcher_metadata["cortex_authorized_roots"] = authorized_roots
                watcher_metadata["cortex_workspace_attested_by"] = "server"
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
                    metadata=watcher_metadata,
                )
            )
            if request.session_id:
                try:
                    stores["session_registry"].attach_watcher(process_id=request.process_id, session_id=request.session_id, watcher_id=watcher.watch_id)
                except KeyError:
                    pass
            _upsert_runtime_snapshot_session_state_locked(
                process_id=request.process_id,
                stores=stores,
                process=get_runtime_process(request.process_id) or process,
            )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"success": True, "watcher": model_dump_compat(watcher)}


@router.get("/runtime/watchers")
async def list_runtime_watchers(process_id: Optional[str] = None):
    stores = _runtime_delivery_stores()
    return {"success": True, "watchers": [model_dump_compat(row) for row in stores["watcher_store"].list(process_id=process_id)]}


@router.post("/runtime/watchers/reconcile")
async def reconcile_runtime_watchers(request: RuntimeWatcherReconcileRequest = RuntimeWatcherReconcileRequest()):
    stores = _runtime_delivery_stores()
    now_dt = _parse_optional_dt(request.now_iso)
    recorded = _refresh_runtime_session_plane(stores=stores, now=now_dt)
    return {"success": True, "emitted_count": len(recorded), "emitted": recorded}


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
    if get_runtime_process(request.process_id) is None:
        raise HTTPException(status_code=404, detail=f"Runtime process '{request.process_id}' not found")
    event = adapt_tool_event(
        request.process_id,
        tool=request.tool,
        event=request.event,
        session_id=request.session_id,
        session_name=request.session_name,
        payload=request.payload,
    )
    if request.event_id:
        event_id = str(request.event_id).strip()
        if not event_id:
            raise HTTPException(status_code=422, detail="event_id must be non-empty when supplied")
        event.event_id = event_id
    try:
        with (
            _runtime_session_mutation(
                stores=stores,
                process_id=request.process_id,
                operation="runtime tool event ingestion",
            ),
            stores["session_registry"]._transaction(),
        ):
            _preflight_runtime_session_event(event, stores=stores)
            with stores["runtime_memory_store"].session_event_admission(event):
                delivery = resilient_delivery_attempt(
                    "runtime_tool_event_ingest",
                    lambda: _record_runtime_session_event_locked(process_id=request.process_id, event=event, stores=stores),
                    process_id=request.process_id,
                    event_kind=event.kind,
                    payload=model_dump_compat(event),
                    dlq_store=stores["delivery_dlq"],
                )
    except RuntimeMemoryLimitError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (PermissionError, RuntimeError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
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


def _runtime_delivery_dlq_ack_path(stores: Dict[str, Any]) -> Path:
    return Path(stores["root"]) / "delivery_dlq_acknowledgements.json"


def _load_runtime_delivery_dlq_acks(stores: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    path = _runtime_delivery_dlq_ack_path(stores)
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {str(key): dict(value) for key, value in data.items() if isinstance(value, dict)} if isinstance(data, dict) else {}


def _ack_runtime_delivery_dlq(*, stores: Dict[str, Any], entry_id: str, actor: str, reason: str, replayed: bool) -> Dict[str, Any]:
    ack_path = _runtime_delivery_dlq_ack_path(stores)
    lock_path = ack_path.with_suffix(ack_path.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        acknowledgements = _load_runtime_delivery_dlq_acks(stores)
        record = acknowledgements.get(entry_id) or {
            "entry_id": entry_id,
            "acknowledged_at": datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
            "actor": str(actor or "cortex").strip() or "cortex",
            "reason": str(reason or "operator_reviewed").strip() or "operator_reviewed",
            "replayed": bool(replayed),
        }
        acknowledgements[entry_id] = record
        _write_runtime_event_receipt(ack_path, acknowledgements)
        return record


def _runtime_delivery_recipient_credentials_or_503() -> Dict[str, str]:
    try:
        credentials = runtime_delivery_recipient_credentials()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    missing = [recipient for recipient in REQUIRED_RELEASE_HANDOFF_RECIPIENTS if not credentials.get(recipient)]
    if missing:
        raise HTTPException(
            status_code=503,
            detail={
                "reason": "release_recipient_credentials_not_ready",
                "missing_recipients": missing,
            },
        )
    return credentials


def _runtime_delivery_handoff_claim_paths(
    *,
    stores: Dict[str, Any],
    recipient: str,
    request_id: str,
) -> tuple[Path, Path]:
    request_digest = hashlib.sha256(f"{recipient}:{request_id}".encode("utf-8")).hexdigest()
    root = Path(stores["root"]) / "handoff_claim_receipts"
    # Capacity enforcement and nonce creation must be atomic across every
    # recipient, not merely across requests for one recipient.
    return root / f"{request_digest}.json", root / ".journal.lock"


def _runtime_delivery_handoff_claim_max_skew_seconds() -> int:
    try:
        configured_skew = int(os.getenv("CORTEX_HANDOFF_CLAIM_MAX_SKEW_SECONDS", "300"))
    except ValueError:
        configured_skew = 300
    return min(max(configured_skew, 30), 900)


def _prune_runtime_delivery_handoff_claim_receipts(*, stores: Dict[str, Any]) -> int:
    root = Path(stores["root"]) / "handoff_claim_receipts"
    if not root.exists():
        return 0
    now = datetime.now().astimezone()
    retention_seconds = _runtime_delivery_handoff_claim_max_skew_seconds()
    receipts = []
    for target in root.glob("*.json"):
        try:
            stat = target.stat()
        except FileNotFoundError:
            continue
        try:
            payload = json.loads(target.read_text(encoding="utf-8"))
            expires_at = _parse_optional_dt(str((payload or {}).get("expires_at") or ""))
        except (OSError, json.JSONDecodeError, ValueError):
            # A malformed nonce record cannot be safely discarded or ignored;
            # count it against bounded capacity and let readiness expose it.
            receipts.append((stat.st_mtime, target))
            continue
        expired = (
            expires_at is not None
            and expires_at.tzinfo is not None
            and now > expires_at.astimezone(now.tzinfo)
        )
        if expires_at is None:
            expired = now.timestamp() - stat.st_mtime > retention_seconds
        if expired:
            _unlink_fsynced(target)
            continue
        receipts.append((stat.st_mtime, target))
    return len(receipts)


def _consume_runtime_delivery_handoff_request(
    *,
    stores: Dict[str, Any],
    receipt_path: Path,
    recipient: str,
    request_id: str,
    requested_at: str,
    request_kind: str,
) -> Dict[str, Any]:
    """Durably consume an authenticated nonce before mailbox inspection."""

    # Freshness and replay state must be evaluated while the caller owns the
    # global journal lock.  A request that waited behind that lock may have
    # expired since transport authentication; never prune its old receipt and
    # then admit it as a new nonce.
    if receipt_path.exists():
        raise HTTPException(status_code=409, detail=f"handoff {request_kind} request was already consumed")
    requested = _parse_optional_dt(requested_at)
    if requested is None or requested.tzinfo is None:
        raise HTTPException(status_code=422, detail="requested_at must be an ISO-8601 timestamp with a timezone")
    now = datetime.now().astimezone()
    maximum_skew = _runtime_delivery_handoff_claim_max_skew_seconds()
    if abs((now - requested).total_seconds()) > maximum_skew:
        raise HTTPException(status_code=403, detail="handoff claim timestamp is outside the allowed window")
    receipt_count = _prune_runtime_delivery_handoff_claim_receipts(stores=stores)
    if receipt_path.exists():
        raise HTTPException(status_code=409, detail=f"handoff {request_kind} request was already consumed")
    maximum = 4096
    if receipt_count >= maximum:
        raise HTTPException(status_code=503, detail="handoff request nonce journal is at capacity")
    expires_at = requested + timedelta(seconds=maximum_skew)
    consumed_at = now.isoformat(timespec="milliseconds")
    receipt = {
        "version": "cortex.runtime_delivery.handoff_request_receipt.v2",
        "status": "consumed",
        "request_kind": request_kind,
        "recipient": recipient,
        "request_id": request_id,
        "requested_at": requested_at,
        "consumed_at": consumed_at,
        "expires_at": expires_at.isoformat(timespec="milliseconds"),
    }
    _write_runtime_event_receipt(receipt_path, receipt)
    return receipt


def _validate_runtime_delivery_handoff_claim_freshness(requested_at: str) -> None:
    requested = _parse_optional_dt(requested_at)
    if requested is None or requested.tzinfo is None:
        raise HTTPException(status_code=422, detail="requested_at must be an ISO-8601 timestamp with a timezone")
    max_skew_seconds = _runtime_delivery_handoff_claim_max_skew_seconds()
    observed_skew = abs((datetime.now().astimezone() - requested).total_seconds())
    if observed_skew > max_skew_seconds:
        raise HTTPException(status_code=403, detail="handoff claim timestamp is outside the allowed window")


@router.get("/runtime/delivery/dlq")
async def get_runtime_delivery_dlq(dependency: Optional[str] = None):
    stores = _runtime_delivery_stores()
    acknowledgements = _load_runtime_delivery_dlq_acks(stores)
    entries = [model_dump_compat(row) for row in stores["delivery_dlq"].list(dependency=dependency)]
    return {
        "success": True,
        "entries": [row for row in entries if row["entry_id"] not in acknowledgements],
        "acknowledged": [acknowledgements[row["entry_id"]] for row in entries if row["entry_id"] in acknowledgements],
    }


@router.post("/runtime/delivery/dlq/{entry_id}/replay")
async def replay_runtime_delivery_dlq(entry_id: str, request: Optional[RuntimeDeliveryDlqActionRequest] = None):
    request = request or RuntimeDeliveryDlqActionRequest(reason="operator_replay")
    stores = _runtime_delivery_stores()
    entry = next((row for row in stores["delivery_dlq"].list() if row.entry_id == entry_id), None)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Runtime delivery DLQ entry '{entry_id}' not found")
    if entry.dependency not in {"runtime_session_event_ingest", "runtime_tool_event_ingest"}:
        raise HTTPException(status_code=409, detail=f"DLQ dependency '{entry.dependency}' is not replayable by the session projection inbox")
    event = CanonicalSessionEvent.model_validate(entry.payload) if hasattr(CanonicalSessionEvent, "model_validate") else CanonicalSessionEvent.parse_obj(entry.payload)
    result = _record_runtime_session_event(process_id=event.process_id, event=event, stores=stores)
    acknowledgement = _ack_runtime_delivery_dlq(
        stores=stores,
        entry_id=entry.entry_id,
        actor=request.actor,
        reason=request.reason,
        replayed=True,
    )
    return {"success": True, "entry_id": entry.entry_id, "event": model_dump_compat(result["event"]), "acknowledgement": acknowledgement}


@router.post("/runtime/delivery/dlq/{entry_id}/acknowledge")
async def acknowledge_runtime_delivery_dlq(entry_id: str, request: Optional[RuntimeDeliveryDlqActionRequest] = None):
    request = request or RuntimeDeliveryDlqActionRequest()
    stores = _runtime_delivery_stores()
    entry = next((row for row in stores["delivery_dlq"].list() if row.entry_id == entry_id), None)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Runtime delivery DLQ entry '{entry_id}' not found")
    acknowledgement = _ack_runtime_delivery_dlq(
        stores=stores,
        entry_id=entry_id,
        actor=request.actor,
        reason=request.reason,
        replayed=False,
    )
    canonical_event_id = str((entry.payload or {}).get("event_id") or "").strip()
    canonical_process_id = str(entry.process_id or (entry.payload or {}).get("process_id") or "").strip()
    if canonical_event_id and canonical_process_id:
        _clear_runtime_event_pending(
            stores=stores,
            process_id=canonical_process_id,
            event_id=canonical_event_id,
        )
    return {"success": True, "entry_id": entry_id, "acknowledgement": acknowledgement}


async def explain_runtime_process(process_id: str, *, belief_scope: Optional[Dict[str, str]] = None):
    belief_scope = _belief_scope_or_denied(belief_scope)
    return await runtime_service.explain_runtime_process(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        assemble_runtime_process_explain_fn=runtime_explain.assemble_runtime_process_explain,
        beliefs_for_task_fn=partial(beliefs_for_task, scope=belief_scope),
        summarize_beliefs_fn=partial(summarize_beliefs, scope=belief_scope),
        explain_belief_fn=partial(explain_belief, scope=belief_scope),
        get_belief_fn=partial(get_belief, scope=belief_scope),
        select_influential_beliefs_fn=partial(select_influential_beliefs, scope=belief_scope),
    )


@router.get("/runtime/process/{process_id}")
async def get_runtime_process_view(process_id: str, http_request: Request = None, events_limit: int = 25):
    belief_scope = _belief_scope_or_denied(_belief_scope_from_http_request(http_request))
    response = await runtime_service.runtime_process_view(
        process_id,
        events_limit=events_limit,
        get_runtime_process_fn=get_runtime_process,
        assemble_runtime_process_view_fn=runtime_explain.assemble_runtime_process_view,
        get_runtime_events_fn=get_runtime_events,
        beliefs_for_task_fn=partial(beliefs_for_task, scope=belief_scope),
        summarize_beliefs_fn=partial(summarize_beliefs, scope=belief_scope),
        explain_belief_fn=partial(explain_belief, scope=belief_scope),
        get_belief_fn=partial(get_belief, scope=belief_scope),
        select_influential_beliefs_fn=partial(select_influential_beliefs, scope=belief_scope),
    )
    stores = _runtime_delivery_stores()
    response["session_plane"] = {
        "status": _runtime_session_plane_status(stores=stores, process_id=process_id),
        "sessions": [model_dump_compat(row) for row in stores["session_registry"].list(process_id=process_id)],
        "watchers": [model_dump_compat(row) for row in stores["watcher_store"].list(process_id=process_id)],
    }
    return response


@router.get("/runtime-delivery/readiness")
async def get_runtime_delivery_readiness(http_request: Request = None):
    from fastapi.responses import JSONResponse

    shared_probe = getattr(getattr(http_request, "app", None), "state", None)
    shared_probe = getattr(shared_probe, "async_readiness_payload", None)
    if callable(shared_probe):
        service_payload = await shared_probe()
        runtime_check = dict((service_payload.get("checks") or {}).get("runtimeDelivery") or {})
        payload = {
            "status": runtime_check.get("status") or "not_ready",
            "ready": bool(runtime_check.get("ok")),
            "service": "cortex-runtime-delivery",
            "checks": runtime_check.get("checks") or {},
            **({"error": runtime_check.get("error")} if runtime_check.get("error") else {}),
        }
    else:
        try:
            payload = await asyncio.wait_for(
                asyncio.to_thread(probe_runtime_delivery_readiness, _runtime_delivery_root()),
                timeout=5.0,
            )
        except Exception as exc:
            payload = {
                "status": "not_ready",
                "ready": False,
                "service": "cortex-runtime-delivery",
                "checks": {},
                "error": f"{type(exc).__name__}: {exc}",
            }
    return JSONResponse(status_code=200 if payload["ready"] else 503, content=payload)


def _reconcile_acknowledged_release_handoff_locked(message, *, stores: Dict[str, Any]) -> Dict[str, Any]:
    """Advance durable release state after an authenticated external ack."""

    release_state = stores["release_store"].load(message.process_id)
    target_stage = str((message.metadata or {}).get("target_stage") or "").strip()
    release_id = str((message.metadata or {}).get("release_id") or "").strip()
    if (
        release_state is None
        or message.delivery_status != "acked"
        or not target_stage
        or release_id != release_state.release_id
        or str(message.revision_id or "") != release_state.revision_id
        or target_stage not in RELEASE_STAGE_TOPOLOGY
        or release_state.current_stage not in RELEASE_STAGE_TOPOLOGY
        or RELEASE_STAGE_TOPOLOGY.index(release_state.current_stage)
        >= RELEASE_STAGE_TOPOLOGY.index(target_stage)
    ):
        return {"reconciled": False, "reason": "handoff_already_applied_or_not_current"}
    process = get_runtime_process(message.process_id)
    if not process:
        raise RuntimeError(f"runtime process is missing for acknowledged release {message.process_id}")
    contract = _resolve_runtime_delivery_contract(
        message.process_id,
        process=process,
        stores=stores,
        request=RuntimeDeliveryReconcileRequest(
            bootstrap_runtime_state=False,
            initialize_release=False,
        ),
    )
    loop_state = stores["loop_store"].load_state(message.process_id)
    controller_id = (
        loop_state.controller.controller_id
        if loop_state is not None and loop_state.controller is not None
        else "cortex"
    )
    controller_session_id = (
        loop_state.controller.session_id
        if loop_state is not None and loop_state.controller is not None
        else f"runtime-delivery:{message.process_id}"
    )
    passes = []
    for _ in range(2):
        reconciled = reconcile_production_build_loop(
            contract,
            loop_store=stores["loop_store"],
            snapshot_store=stores["snapshot_store"],
            shared_state_store=stores["shared_state_store"],
            journal=stores["journal"],
            mailbox=stores["mailbox"],
            supervisor=stores["supervisor"],
            release_store=stores["release_store"],
            controller_id=controller_id,
            controller_session_id=controller_session_id,
        )
        passes.append(reconciled)
        if not list(reconciled.get("stage_changes") or []):
            break
    current_process = _sync_runtime_process_delivery_state(
        message.process_id,
        process=get_runtime_process(message.process_id) or process,
        stores=stores,
        event_kind="runtime_delivery_handoff_reconciled",
        event_payload={
            "message_id": message.message_id,
            "recipient": message.to_agent,
            "target_stage": target_stage,
        },
    )
    follow_up = _bridge_runtime_delivery_follow_up(
        message.process_id,
        process=current_process,
        stores=stores,
        now=None,
    )
    current_release = stores["release_store"].load(message.process_id)
    return {
        "reconciled": True,
        "process_id": message.process_id,
        "release_stage": current_release.current_stage if current_release is not None else None,
        "pass_count": len(passes),
        "follow_up_dispatch": follow_up.get("dispatch"),
    }


def _reconcile_acknowledged_release_handoff(message, *, stores: Dict[str, Any]) -> Dict[str, Any]:
    with stores["release_store"].release_transaction(message.process_id):
        stores["release_store"].assert_mutation_allowed(
            message.process_id,
            operation="release handoff reconciliation",
        )
        return _reconcile_acknowledged_release_handoff_locked(message, stores=stores)


def _recover_acknowledged_release_handoffs(recipient: str, *, stores: Dict[str, Any]) -> List[Dict[str, Any]]:
    recovered = []
    for message in stores["mailbox"].list(
        to_agent=recipient,
        delivery_statuses=["acked"],
    ):
        intent = stores["release_store"].load_rollback_intent(message.process_id)
        if intent and intent.get("status") in {"in_progress", "recovery_required"}:
            continue
        result = _reconcile_acknowledged_release_handoff(message, stores=stores)
        if result.get("reconciled"):
            recovered.append(result)
    return recovered


def _claim_runtime_delivery_handoffs_locked(
    *,
    stores: Dict[str, Any],
    recipient: str,
    process_id: str,
    expected_revision_id: str,
    request_id: str,
    requested_at: str,
) -> Dict[str, Any]:
    release_state = stores["release_store"].load(process_id)
    if release_state is None:
        raise HTTPException(status_code=404, detail=f"Runtime delivery release state '{process_id}' not found")
    if not hmac.compare_digest(str(release_state.revision_id or ""), expected_revision_id):
        raise HTTPException(status_code=409, detail="handoff claim revision does not match the active release")
    receipt_path, lock_path = _runtime_delivery_handoff_claim_paths(
        stores=stores,
        recipient=recipient,
        request_id=request_id,
    )
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        receipt = _consume_runtime_delivery_handoff_request(
            stores=stores,
            receipt_path=receipt_path,
            recipient=recipient,
            request_id=request_id,
            requested_at=requested_at,
            request_kind="claim",
        )
        received = stores["mailbox"].receive(
            to_agent=recipient,
            process_id=process_id,
            include_inflight=True,
            expected_revision_id=expected_revision_id,
            reject_stale_revision=True,
        )
        release_handoffs = []
        for message in received:
            if (message.metadata or {}).get("target_stage"):
                bound_payload = {
                    **dict(message.payload or {}),
                    "artifact_receipts": [
                        dict(row)
                        for row in (release_state.metadata.get("release_artifacts") or [])
                        if isinstance(row, dict)
                        and str(row.get("release_id") or "") == release_state.release_id
                        and str(row.get("revision_id") or "") == release_state.revision_id
                    ],
                }
                message = stores["mailbox"].bind_claim_payload(
                    message.message_id,
                    payload=bound_payload,
                    expected_revision_id=expected_revision_id,
                )
                release_handoffs.append(message)
            else:
                stores["mailbox"].retry(message.message_id)
        response = {
            "success": True,
            "authentication": "hmac-sha256",
            "recipient": recipient,
            "process_id": process_id,
            "expected_revision_id": expected_revision_id,
            "request_id": request_id,
            "claimed_at": datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
            "messages": [model_dump_compat(message) for message in release_handoffs],
        }
        _write_runtime_event_receipt(
            receipt_path,
            {**receipt, "status": "committed", **response},
        )
        return response


@router.post("/runtime/delivery/handoffs/claim")
async def claim_runtime_delivery_handoffs(request: RuntimeDeliveryHandoffClaimRequest):
    recipient = str(request.recipient or "").strip()
    process_id = str(request.process_id or "").strip()
    expected_revision_id = str(request.expected_revision_id or "").strip()
    request_id = str(request.request_id or "").strip()
    requested_at = str(request.requested_at or "").strip()
    if not all((recipient, process_id, expected_revision_id, request_id, requested_at, request.recipient_signature)):
        raise HTTPException(status_code=422, detail="handoff claim fields must be non-empty")
    if recipient not in REQUIRED_RELEASE_HANDOFF_RECIPIENTS:
        raise HTTPException(status_code=403, detail="recipient is not a release handoff consumer")
    credentials = _runtime_delivery_recipient_credentials_or_503()
    expected_signature = runtime_delivery_handoff_claim_signature(
        recipient=recipient,
        process_id=process_id,
        expected_revision_id=expected_revision_id,
        request_id=request_id,
        requested_at=requested_at,
        secret=credentials[recipient],
    )
    if not hmac.compare_digest(str(request.recipient_signature or ""), expected_signature):
        raise HTTPException(status_code=403, detail="authenticated recipient signature required")
    _validate_runtime_delivery_handoff_claim_freshness(requested_at)

    process = get_runtime_process(process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{process_id}' not found")
    stores = _runtime_delivery_stores()
    try:
        with stores["release_store"].release_transaction(process_id):
            stores["release_store"].assert_mutation_allowed(
                process_id,
                operation="release handoff claim",
            )
            return _claim_runtime_delivery_handoffs_locked(
                stores=stores,
                recipient=recipient,
                process_id=process_id,
                expected_revision_id=expected_revision_id,
                request_id=request_id,
                requested_at=requested_at,
            )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/runtime/delivery/handoffs/claim-next")
async def claim_next_runtime_delivery_handoff(request: RuntimeDeliveryHandoffClaimNextRequest):
    """Discover and claim release work using recipient credentials alone."""

    recipient = str(request.recipient or "").strip()
    request_id = str(request.request_id or "").strip()
    requested_at = str(request.requested_at or "").strip()
    if not all((recipient, request_id, requested_at, request.recipient_signature)):
        raise HTTPException(status_code=422, detail="handoff discovery fields must be non-empty")
    if recipient not in REQUIRED_RELEASE_HANDOFF_RECIPIENTS:
        raise HTTPException(status_code=403, detail="recipient is not a release handoff consumer")
    credentials = _runtime_delivery_recipient_credentials_or_503()
    expected_signature = runtime_delivery_handoff_discovery_signature(
        recipient=recipient,
        request_id=request_id,
        requested_at=requested_at,
        secret=credentials[recipient],
    )
    if not hmac.compare_digest(str(request.recipient_signature or ""), expected_signature):
        raise HTTPException(status_code=403, detail="authenticated recipient signature required")
    _validate_runtime_delivery_handoff_claim_freshness(requested_at)

    stores = _runtime_delivery_stores()
    receipt_path, lock_path = _runtime_delivery_handoff_claim_paths(
        stores=stores,
        recipient=recipient,
        request_id=request_id,
    )
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        receipt = _consume_runtime_delivery_handoff_request(
            stores=stores,
            receipt_path=receipt_path,
            recipient=recipient,
            request_id=request_id,
            requested_at=requested_at,
            request_kind="discovery",
        )
        recovered_progress = _recover_acknowledged_release_handoffs(
            recipient,
            stores=stores,
        )
        release_handoffs = []
        candidate_process_ids = sorted({
            message.process_id
            for message in stores["mailbox"].list(
                to_agent=recipient,
                delivery_statuses=["queued", "inflight"],
            )
        })
        # Claim each process independently behind its release transaction.
        # Pending rollback work remains queued and cannot perturb the mailbox
        # revision that rollback recovery will reconcile.
        for process_id in candidate_process_ids:
            with stores["release_store"].release_transaction(process_id):
                try:
                    stores["release_store"].assert_mutation_allowed(
                        process_id,
                        operation="release handoff discovery",
                    )
                except RuntimeError:
                    continue
                received = stores["mailbox"].receive(
                    to_agent=recipient,
                    process_id=process_id,
                    include_inflight=True,
                )
                for message in received:
                    metadata = dict(message.metadata or {})
                    if not metadata.get("target_stage"):
                        stores["mailbox"].retry(message.message_id)
                        continue
                    state = stores["release_store"].load(message.process_id)
                    if (
                        state is None
                        or not hmac.compare_digest(str(state.release_id), str(metadata.get("release_id") or ""))
                        or not hmac.compare_digest(str(state.revision_id), str(message.revision_id or ""))
                    ):
                        stores["mailbox"].dead_letter(message.message_id)
                        continue
                    bound_payload = {
                        **dict(message.payload or {}),
                        "artifact_receipts": [
                            dict(row)
                            for row in (state.metadata.get("release_artifacts") or [])
                            if isinstance(row, dict)
                            and str(row.get("release_id") or "") == state.release_id
                            and str(row.get("revision_id") or "") == state.revision_id
                        ],
                    }
                    message = stores["mailbox"].bind_claim_payload(
                        message.message_id,
                        payload=bound_payload,
                        expected_revision_id=state.revision_id,
                    )
                    release_handoffs.append(message)
        claimed_at = datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
        controller_process_ids = sorted({
            message.process_id
            for message in stores["mailbox"].list()
            if message.to_agent in REQUIRED_RELEASE_HANDOFF_RECIPIENTS
        })
        verification_releases: List[Dict[str, Any]] = []
        managed_releases: List[Dict[str, Any]] = []
        for controller_process_id in controller_process_ids:
            controller_state = stores["release_store"].load(controller_process_id)
            if controller_state is None:
                continue
            controller_receipts = [
                dict(row)
                for row in (controller_state.metadata.get("release_artifacts") or [])
                if isinstance(row, dict)
                and str(row.get("release_id") or "") == controller_state.release_id
                and str(row.get("revision_id") or "") == controller_state.revision_id
            ]
            view = {
                "process_id": controller_state.process_id,
                "candidate_ref": controller_state.candidate_ref,
                "release_id": controller_state.release_id,
                "revision_id": controller_state.revision_id,
                "current_stage": controller_state.current_stage,
                "target_environment": controller_state.target_environment,
                "artifact_receipts": controller_receipts,
            }
            if recipient == "release-verifier":
                target_stage = (
                    "canary_verified"
                    if controller_state.current_stage == "build_verified"
                    else controller_state.target_environment
                    if controller_state.current_stage == "canary_verified"
                    else None
                )
                has_evidence = any(
                    row.get("artifact_kind") == "canary_evidence"
                    and row.get("target_stage") == target_stage
                    and row.get("validation_outcome") == "passed"
                    for row in controller_receipts
                )
                if target_stage and not has_evidence:
                    verification_releases.append({**view, "target_stage": target_stage})
            elif recipient == "release-manager" and controller_state.current_stage == controller_state.target_environment:
                managed_releases.append(view)
        response = {
            "success": True,
            "authentication": "hmac-sha256",
            "recipient": recipient,
            "request_id": request_id,
            "claimed_at": claimed_at,
            "recovered_release_progress": recovered_progress,
            "messages": [model_dump_compat(message) for message in release_handoffs],
            "verification_releases": verification_releases,
            "managed_releases": managed_releases,
        }
        _write_runtime_event_receipt(
            receipt_path,
            {**receipt, "status": "committed", **response},
        )
    return response


@router.post("/runtime/delivery/handoffs/manager-rollback/{process_id}")
async def manager_rollback_runtime_delivery(
    process_id: str,
    request: RuntimeDeliveryManagerRollbackRequest,
):
    credentials = _runtime_delivery_recipient_credentials_or_503()
    manager_secret = credentials["release-manager"]
    expected = runtime_delivery_manager_rollback_signature(
        process_id=process_id,
        release_id=request.release_id,
        revision_id=request.revision_id,
        idempotency_key=request.idempotency_key,
        reason=request.reason,
        request_id=request.request_id,
        requested_at=request.requested_at,
        secret=manager_secret,
    )
    if not hmac.compare_digest(str(request.manager_signature or ""), expected):
        raise HTTPException(status_code=403, detail="authenticated release-manager signature required")
    _validate_runtime_delivery_handoff_claim_freshness(request.requested_at)
    stores = _runtime_delivery_stores()
    state = stores["release_store"].load(process_id)
    if state is None:
        raise HTTPException(status_code=404, detail="release workflow not found")
    if not (
        hmac.compare_digest(state.release_id, request.release_id)
        and hmac.compare_digest(state.revision_id, request.revision_id)
    ):
        raise HTTPException(status_code=409, detail="manager rollback does not match the active release revision")
    return await rollback_runtime_delivery(
        process_id,
        RuntimeDeliveryRollbackRequest(
            idempotency_key=request.idempotency_key,
            reason=request.reason,
            actor="release-manager",
        ),
    )


@router.post("/runtime/delivery/handoffs/verifier-capability")
async def verify_runtime_delivery_verifier_capability(
    request: RuntimeDeliveryVerifierCapabilityRequest,
):
    try:
        credentials = runtime_delivery_verifier_credentials()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    secret = str(credentials.get(request.verifier) or "")
    expected = runtime_delivery_verifier_capability_signature(
        verifier=request.verifier,
        request_id=request.request_id,
        requested_at=request.requested_at,
        secret=secret,
    )
    if not secret or not hmac.compare_digest(request.verifier_signature, expected):
        raise HTTPException(status_code=403, detail="authenticated release-verifier capability required")
    _validate_runtime_delivery_handoff_claim_freshness(request.requested_at)
    return {
        "success": True,
        "capability": "revision-bound-artifact-attestation",
        "verifier": request.verifier,
        "request_id": request.request_id,
    }


@router.post("/runtime/delivery/handoffs/artifacts/resolve")
async def resolve_runtime_delivery_handoff_artifact(request: RuntimeDeliveryArtifactFetchRequest):
    recipient = str(request.recipient or "").strip()
    if recipient not in REQUIRED_RELEASE_HANDOFF_RECIPIENTS:
        raise HTTPException(status_code=403, detail="recipient is not a release handoff consumer")
    credentials = _runtime_delivery_recipient_credentials_or_503()
    expected_signature = runtime_delivery_artifact_fetch_signature(
        recipient=recipient,
        process_id=request.process_id,
        release_id=request.release_id,
        revision_id=request.revision_id,
        artifact_ref=request.artifact_ref,
        request_id=request.request_id,
        requested_at=request.requested_at,
        secret=credentials[recipient],
    )
    if not hmac.compare_digest(str(request.recipient_signature or ""), expected_signature):
        raise HTTPException(status_code=403, detail="authenticated recipient signature required")
    _validate_runtime_delivery_handoff_claim_freshness(request.requested_at)

    stores = _runtime_delivery_stores()
    state = stores["release_store"].load(request.process_id)
    if state is None:
        raise HTTPException(status_code=404, detail="release workflow not found")
    if not (
        hmac.compare_digest(str(state.release_id), str(request.release_id or ""))
        and hmac.compare_digest(str(state.revision_id), str(request.revision_id or ""))
    ):
        raise HTTPException(status_code=409, detail="artifact request does not match the active release revision")
    receipt = next(
        (
            dict(row)
            for row in (state.metadata.get("release_artifacts") or [])
            if isinstance(row, dict)
            and str(row.get("release_id") or "") == state.release_id
            and str(row.get("revision_id") or "") == state.revision_id
            and hmac.compare_digest(str(row.get("artifact_ref") or ""), str(request.artifact_ref or ""))
        ),
        None,
    )
    if receipt is None:
        raise HTTPException(status_code=404, detail="release artifact receipt not found")
    authorized_handoff = any(
        message.to_agent == recipient
        and str((message.metadata or {}).get("release_id") or "") == state.release_id
        and str(message.revision_id or "") == state.revision_id
        and bool((message.metadata or {}).get("target_stage"))
        for message in stores["mailbox"].list(process_id=request.process_id, to_agent=recipient)
    )
    if not authorized_handoff:
        raise HTTPException(status_code=403, detail="recipient has no release handoff for this revision")
    try:
        encoded = stores["release_store"].artifact_store().resolve(request.artifact_ref)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {
        "success": True,
        "artifact_ref": request.artifact_ref,
        "content_hash": receipt.get("content_hash"),
        "encoding": "base64",
        "payload": base64.b64encode(encoded).decode("ascii"),
        "receipt": receipt,
    }


def _acknowledge_runtime_delivery_handoff_locked(
    *,
    message_id: str,
    recipient: str,
    request: RuntimeDeliveryHandoffAcknowledgeRequest,
    stores: Dict[str, Any],
) -> Dict[str, Any]:
    message = next((row for row in stores["mailbox"].list() if row.message_id == message_id), None)
    if message is None or not (message.metadata or {}).get("target_stage"):
        raise HTTPException(status_code=404, detail=f"Release handoff '{message_id}' not found")
    if not hmac.compare_digest(recipient, message.to_agent):
        raise HTTPException(status_code=403, detail="only the intended recipient may acknowledge a handoff")
    try:
        acknowledged = stores["mailbox"].acknowledge(
            message_id,
            actor=recipient,
            result_receipt=request.result_receipt,
            actor_signature=request.recipient_signature,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    try:
        release_progress = _reconcile_acknowledged_release_handoff(
            acknowledged,
            stores=stores,
        )
    except (KeyError, PermissionError, RuntimeError, ValueError) as exc:
        # The acknowledgement is already durable. Claim-next retries this
        # reconciliation until release state records the external progress.
        raise HTTPException(
            status_code=503,
            detail=f"handoff acknowledged; durable release reconciliation pending: {exc}",
        ) from exc
    return {
        "success": True,
        "process_id": acknowledged.process_id,
        "message": model_dump_compat(acknowledged),
        "release_progress": release_progress,
    }


@router.post("/runtime/delivery/handoffs/{message_id}/acknowledge")
async def acknowledge_runtime_delivery_handoff(
    message_id: str,
    request: RuntimeDeliveryHandoffAcknowledgeRequest,
):
    recipient = str(request.recipient or "").strip()
    if recipient not in REQUIRED_RELEASE_HANDOFF_RECIPIENTS:
        raise HTTPException(status_code=403, detail="recipient is not a release handoff consumer")
    _runtime_delivery_recipient_credentials_or_503()
    stores = _runtime_delivery_stores()
    message = next((row for row in stores["mailbox"].list() if row.message_id == message_id), None)
    if message is None or not (message.metadata or {}).get("target_stage"):
        raise HTTPException(status_code=404, detail=f"Release handoff '{message_id}' not found")
    try:
        with stores["release_store"].release_transaction(message.process_id):
            stores["release_store"].assert_mutation_allowed(
                message.process_id,
                operation="release handoff acknowledgement",
            )
            return _acknowledge_runtime_delivery_handoff_locked(
                message_id=message_id,
                recipient=recipient,
                request=request,
                stores=stores,
            )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/runtime/delivery/{process_id}")
async def get_runtime_delivery_status(process_id: str):
    process = get_runtime_process(process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{process_id}' not found")
    stores = _runtime_delivery_stores()
    delivery = _runtime_delivery_status_payload(process_id, process=process, stores=stores)
    # Keep the detailed top-level status contract used by runtime controllers,
    # while also exposing the same reconciliation envelope used by public
    # release-handoff consumers.  An acknowledgement can advance the release
    # without another mutating reconcile request, so consumers must be able to
    # observe both the loop state and durable delivery projection via GET.
    return {
        **delivery,
        "state": delivery.get("loop_state"),
        "delivery": delivery,
    }


def _reconcile_runtime_delivery_sequence(
    process_id: str,
    *,
    request: RuntimeDeliveryReconcileRequest,
    stores: Dict[str, Any],
    bootstrap_recovery_contract: Optional[ProductionBuildContract] = None,
) -> Dict[str, Any]:
    """Commit reconciliation, reasoning projection, and follow-up atomically."""

    release_store = stores["release_store"]
    with release_store.release_transaction(process_id):
        release_store.assert_mutation_allowed(
            process_id,
            operation="runtime delivery reconciliation sequence",
        )
        process = get_runtime_process(process_id)
        if not process:
            raise HTTPException(status_code=404, detail=f"Runtime process '{process_id}' not found")
        if request.bootstrap_runtime_state:
            _bootstrap_runtime_delivery_state(process_id, process=process, stores=stores)
        snapshot = stores["snapshot_store"].load(process_id)
        shared_state = stores["shared_state_store"].load(process_id)
        if snapshot is None or shared_state is None:
            raise HTTPException(status_code=400, detail=f"runtime delivery state missing for {process_id}; enable bootstrap_runtime_state to initialize it")
        release_state = release_store.load(process_id)
        if not request.initialize_release and release_state is None:
            raise HTTPException(
                status_code=400,
                detail="initialize_release=false is invalid before durable release workflow initialization",
            )
        contract = _resolve_runtime_delivery_contract(
            process_id,
            process=process,
            stores=stores,
            request=request,
            bootstrap_recovery_contract=bootstrap_recovery_contract,
        )
        bootstrap_intent = _release_bootstrap_intent_target(
            stores=stores,
            process_id=process_id,
        ).exists()
        if release_state is None:
            if bootstrap_recovery_contract is None:
                _save_release_bootstrap_intent(
                    stores=stores,
                    process_id=process_id,
                    request=request,
                    contract=contract,
                )
            bootstrap_intent = True
        # Establish the immutable contract identity before release creation,
        # dependability campaigns, promotion, or any other side effect.
        contract = stores["loop_store"].save_contract(contract)
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
        follow_up_bridge = _bridge_runtime_delivery_follow_up(
            process_id,
            process=process,
            stores=stores,
            now=_parse_optional_dt(request.now_iso),
        )
        process = follow_up_bridge.get("process") or process
        if bootstrap_intent:
            _clear_release_bootstrap_intent(stores=stores, process_id=process_id)
        return {
            "success": True,
            "process_id": process_id,
            "process": process,
            "contract": model_dump_compat(contract),
            **reconciled,
            "follow_up_dispatch": follow_up_bridge.get("dispatch"),
            "delivery": _runtime_delivery_status_payload(process_id, process=process, stores=stores),
        }


@router.post("/runtime/delivery/reconcile/{process_id}")
async def reconcile_runtime_delivery(process_id: str, request: Optional[RuntimeDeliveryReconcileRequest] = None):
    request = request or RuntimeDeliveryReconcileRequest()
    try:
        return _reconcile_runtime_delivery_sequence(
            process_id,
            request=request,
            stores=_runtime_delivery_stores(),
        )
    except (PermissionError, RuntimeError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/runtime/delivery/artifacts/{process_id}")
async def ingest_runtime_delivery_artifact(
    process_id: str,
    request: RuntimeDeliveryArtifactIngestRequest,
):
    process = get_runtime_process(process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{process_id}' not found")
    stores = _runtime_delivery_stores()
    if stores["release_store"].load(process_id) is None:
        raise HTTPException(status_code=404, detail=f"Runtime delivery release state '{process_id}' not found")
    try:
        ingested = ingest_production_release_artifact(
            release_store=stores["release_store"],
            process_id=process_id,
            artifact_id=request.artifact_id,
            payload=request.payload,
            artifact_kind=request.artifact_kind,
            producer=request.producer,
            verifier=request.verifier,
            attestation_signature=request.attestation_signature,
            validation_outcome=request.validation_outcome,
            target_stage=request.target_stage,
            claims=request.claims,
            created_at=request.created_at,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "success": True,
        "process_id": process_id,
        "receipt": model_dump_compat(ingested["receipt"]),
        "release_state": model_dump_compat(ingested["state"]),
    }


@router.post("/runtime/delivery/rollback/{process_id}")
async def rollback_runtime_delivery(process_id: str, request: RuntimeDeliveryRollbackRequest):
    process = get_runtime_process(process_id)
    if not process:
        raise HTTPException(status_code=404, detail=f"Runtime process '{process_id}' not found")
    stores = _runtime_delivery_stores()
    release_state = stores["release_store"].load(process_id)
    if release_state is None:
        raise HTTPException(status_code=404, detail=f"Runtime delivery release state '{process_id}' not found")

    def _project_rollback(**projection: Any) -> Dict[str, Any]:
        return _apply_runtime_delivery_rollback_projections(
            process_id,
            process=get_runtime_process(process_id) or process,
            stores=stores,
            actor=request.actor,
            reason=request.reason,
            applied_state=projection["applied_state"],
            restored_snapshot=projection["restored_snapshot"],
            restored_shared_state=projection["restored_shared_state"],
            intent=projection["intent"],
        )

    rolled = apply_release_rollback_restore(
        release_state,
        snapshot_store=stores["snapshot_store"],
        shared_state_store=stores["shared_state_store"],
        release_store=stores["release_store"],
        journal=stores["journal"],
        session_registry=stores["session_registry"],
        watcher_store=stores["watcher_store"],
        stage=request.stage,
        fencepost_id=request.fencepost_id,
        actor=request.actor,
        reason=request.reason,
        required_projections=["production_loop", "runtime_process"],
        projection_callback=_project_rollback,
        idempotency_key=request.idempotency_key,
    )
    rollback_checkpoint = (rolled.get("rollback_projections") or {}).get("loop_checkpoint")
    process = (rolled.get("rollback_projections") or {}).get("process") or get_runtime_process(process_id) or process
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
    contract = _resolve_runtime_roadmap_contract(process_id, process=process, stores=stores, request=request)
    try:
        sequence = _reconcile_runtime_roadmap_sequence(
            process_id=process_id,
            process=process,
            stores=stores,
            contract=contract,
            controller_id=request.controller_id,
            controller_session_id=request.controller_session_id or f"runtime-roadmap:{process_id}",
            now=_parse_optional_dt(request.now_iso),
            bootstrap_runtime_state=request.bootstrap_runtime_state,
            event_kind="runtime_roadmap_reconciled",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    reconciled = sequence["reconciled"]
    process = sequence["process"]
    follow_up_bridge = sequence["follow_up"]
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
async def explain_runtime_policy(process_id: str, http_request: Request = None):
    belief_scope = _belief_scope_or_denied(_belief_scope_from_http_request(http_request))
    return await runtime_service.runtime_policy_explain(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        get_runtime_events_fn=get_runtime_events,
        explain_runtime_process_fn=partial(explain_runtime_process, belief_scope=belief_scope),
        assemble_runtime_policy_response_fn=runtime_explain.assemble_runtime_policy_response,
        policy_patch_history_fn=runtime_explain.policy_patch_history,
        explain_belief_fn=partial(explain_belief, scope=belief_scope),
        get_belief_fn=partial(get_belief, scope=belief_scope),
    )


@router.get("/runtime/policy-history/{process_id}")
async def get_runtime_policy_history(process_id: str):
    return runtime_service.runtime_policy_history(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        get_runtime_events_fn=get_runtime_events,
        policy_patch_history_fn=runtime_explain.policy_patch_history,
    )


@asynccontextmanager
async def _runtime_policy_mutation_fence(*, process_id: str, operation: str, stores: Dict[str, Any]):
    transaction = stores["release_store"].release_transaction(process_id, nonblocking=True)
    transaction.__enter__()
    try:
        stores["release_store"].assert_mutation_allowed(process_id, operation=operation)
        yield
    finally:
        transaction.__exit__(None, None, None)


def _sync_runtime_policy_snapshot(*, process_id: str, stores: Dict[str, Any]) -> None:
    with (
        stores["shared_state_store"].transaction(process_id),
        stores["snapshot_store"].transaction(process_id),
    ):
        snapshot = stores["snapshot_store"].load(process_id)
        process = get_runtime_process(process_id)
        if snapshot is None or process is None:
            return
        workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
        metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
        settings = dict(((metadata.get("policy") or {}).get("settings") or {}))
        if settings == dict(snapshot.runtime_policy or {}):
            return
        stores["snapshot_store"].save(
            snapshot.model_copy(update={"runtime_policy": settings}),
            expected_persistence_revision=snapshot.persistence_revision,
        )


@router.post("/runtime/policy-rollback/{process_id}/{revision_id}")
async def rollback_runtime_policy_patch(process_id: str, revision_id: str, req: Optional[RuntimePolicyRollbackRequest] = None):
    req = req or RuntimePolicyRollbackRequest()
    stores = _runtime_delivery_stores()
    async with _runtime_policy_mutation_fence(process_id=process_id, operation="runtime policy rollback", stores=stores):
        result = await runtime_service.rollback_runtime_policy_patch(
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
        if not req.dry_run:
            _sync_runtime_policy_snapshot(process_id=process_id, stores=stores)
        return result


@router.post("/runtime/policy-apply/{process_id}")
async def apply_runtime_policy_patch(process_id: str, req: Optional[RuntimePolicyApplyRequest] = None):
    req = req or RuntimePolicyApplyRequest()
    stores = _runtime_delivery_stores()
    async with _runtime_policy_mutation_fence(process_id=process_id, operation="runtime policy apply", stores=stores):
        result = await runtime_service.apply_runtime_policy_patch(
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
        if not req.dry_run:
            _sync_runtime_policy_snapshot(process_id=process_id, stores=stores)
        return result


@router.post("/runtime/homeostasis/freeze/{process_id}")
async def freeze_runtime_homeostasis(process_id: str, req: Optional[RuntimeHomeostasisControlRequest] = None):
    req = req or RuntimeHomeostasisControlRequest()
    stores = _runtime_delivery_stores()
    async with _runtime_policy_mutation_fence(process_id=process_id, operation="runtime homeostasis freeze", stores=stores):
        result = await runtime_service.runtime_homeostasis_freeze_control(
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
        if not req.dry_run:
            _sync_runtime_policy_snapshot(process_id=process_id, stores=stores)
        return result


@router.post("/runtime/homeostasis/rollback/{process_id}")
async def rollback_runtime_homeostasis(process_id: str, req: Optional[RuntimeHomeostasisControlRequest] = None):
    req = req or RuntimeHomeostasisControlRequest()
    stores = _runtime_delivery_stores()
    async with _runtime_policy_mutation_fence(process_id=process_id, operation="runtime homeostasis rollback", stores=stores):
        result = await runtime_service.runtime_homeostasis_rollback_control(
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
        if not req.dry_run:
            _sync_runtime_policy_snapshot(process_id=process_id, stores=stores)
        return result


@router.post("/runtime/homeostasis/resume/{process_id}")
async def resume_runtime_homeostasis(process_id: str, req: Optional[RuntimeHomeostasisControlRequest] = None):
    req = req or RuntimeHomeostasisControlRequest()
    stores = _runtime_delivery_stores()
    async with _runtime_policy_mutation_fence(process_id=process_id, operation="runtime homeostasis resume", stores=stores):
        result = runtime_service.runtime_homeostasis_resume_control(
        process_id,
        get_runtime_process_fn=get_runtime_process,
        resume_process_fn=resume_runtime_process,
        record_runtime_event_fn=record_runtime_event,
        actor_id=req.actor_id,
        actor_session_key=req.actor_session_key,
        reason=req.reason,
        )
        _sync_runtime_policy_snapshot(process_id=process_id, stores=stores)
        return result

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
async def get_runtime_belief_conflicts(http_request: Request = None, subject: Optional[str] = None, predicate: Optional[str] = None, limit: int = 50):
    scope = _belief_scope_or_denied(_belief_scope_from_http_request(http_request))
    return runtime_service.runtime_belief_conflicts(
        subject=subject,
        predicate=predicate,
        limit=limit,
        belief_conflicts_fn=partial(belief_conflicts, scope=scope),
    )


@router.get("/runtime/belief-lineage/{claim_id}")
async def get_runtime_belief_lineage(claim_id: str, http_request: Request = None):
    scope = _belief_scope_or_denied(_belief_scope_from_http_request(http_request))
    return runtime_service.runtime_belief_lineage(claim_id, trace_belief_lineage_fn=partial(trace_belief_lineage, scope=scope))


@router.get("/runtime/belief/{claim_id}")
async def get_runtime_belief(claim_id: str, http_request: Request = None):
    scope = _belief_scope_or_denied(_belief_scope_from_http_request(http_request))
    return runtime_service.runtime_belief_detail(claim_id, explain_belief_fn=partial(explain_belief, scope=scope))


@router.get("/runtime/beliefs")
async def get_runtime_beliefs(http_request: Request = None, query: Optional[str] = None, task_id: Optional[str] = None, limit: int = 50):
    scope = _belief_scope_or_denied(_belief_scope_from_http_request(http_request))
    return runtime_service.runtime_beliefs(
        query=query,
        task_id=task_id,
        limit=limit,
        search_beliefs_fn=partial(search_beliefs, scope=scope),
        beliefs_for_task_fn=partial(beliefs_for_task, scope=scope),
        list_beliefs_fn=partial(list_beliefs, scope=scope),
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
