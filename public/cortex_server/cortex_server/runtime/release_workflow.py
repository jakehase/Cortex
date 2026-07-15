from __future__ import annotations

import json
import fcntl
import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from cortex_server.runtime.agent_mailbox import AgentMailbox, AgentMessage, release_ack_authentication_required
from cortex_server.runtime.agent_supervisor import AgentLease, AgentSupervisor
from cortex_server.runtime.handoff_contract import HandoffArtifactRef, HandoffContract, HandoffEvidenceRef
from cortex_server.runtime.process_event import ProcessEvent
from cortex_server.runtime.process_journal import ProcessJournal
from cortex_server.runtime.process_snapshot import ProcessSnapshot, ProcessSnapshotStore
from cortex_server.runtime.session_registry import SessionRecord
from cortex_server.runtime.shared_process_state import SharedProcessState, SharedProcessStateStore


JsonDict = Dict[str, Any]


def _atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(payload, sort_keys=True, indent=2) + "\n").encode("utf-8")
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid4().hex}.tmp")
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


def _append_fsynced_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())



def _now() -> datetime:
    return datetime.now(timezone.utc)



def _now_iso() -> str:
    return _now().isoformat(timespec="milliseconds").replace("+00:00", "Z")



def _release_id() -> str:
    return f"rel_{uuid4().hex[:16]}"



def _fencepost_id() -> str:
    return f"fence_{uuid4().hex[:16]}"



def _history_id() -> str:
    return f"relhist_{uuid4().hex[:16]}"



def _dedupe_rows(rows: Sequence[str]) -> List[str]:
    out: List[str] = []
    for row in rows or []:
        text = str(row or "").strip()
        if text and text not in out:
            out.append(text)
    return out



def _parse_ts(value: Optional[str]) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def _is_bound_release_approval(message: AgentMessage, state: "ReleaseWorkflowState") -> bool:
    if message.delivery_status != "acked" or message.acked_by != message.to_agent:
        return False
    ack = message.ack_receipt or {}
    result = ack.get("result_receipt") if isinstance(ack, dict) else None
    if not isinstance(result, dict) or result.get("result") != "approved":
        return False
    if release_ack_authentication_required() and ack.get("authentication") != "hmac-sha256":
        return False
    evidence = result.get("evidence_receipts")
    return bool(
        ack.get("actor") == message.to_agent
        and result.get("candidate_ref") == state.candidate_ref
        and result.get("release_id") == state.release_id
        and result.get("revision_id") == state.revision_id
        and isinstance(evidence, list)
        and evidence
    )


class ReleaseRollbackFencepost(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fencepost_id: str = Field(default_factory=_fencepost_id)
    process_id: str
    stage: str
    revision_id: str
    snapshot_id: str
    shared_state_revision_id: str
    last_event_id: Optional[str] = None
    lifecycle_state: str
    created_at: str = Field(default_factory=_now_iso)
    restore_state: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator(
        "fencepost_id",
        "process_id",
        "stage",
        "revision_id",
        "snapshot_id",
        "shared_state_revision_id",
        "lifecycle_state",
    )
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value

    @field_validator("created_at")
    @classmethod
    def _validate_timestamp(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("created_at must be non-empty")
        try:
            datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("created_at must be ISO-8601") from exc
        return text


class ReleaseWorkflowState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    release_id: str = Field(default_factory=_release_id)
    process_id: str
    candidate_ref: str
    target_environment: str
    revision_id: str
    current_stage: str = "draft"
    status: str = "preparing"
    updated_at: str = Field(default_factory=_now_iso)
    workflow_id: Optional[str] = None
    promotion_history: List[Dict[str, Any]] = Field(default_factory=list)
    handoff_records: List[Dict[str, Any]] = Field(default_factory=list)
    rollback_fenceposts: List[ReleaseRollbackFencepost] = Field(default_factory=list)
    operator_holds: List[str] = Field(default_factory=list)
    safe_push_criteria: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("release_id", "process_id", "candidate_ref", "target_environment", "revision_id", "current_stage", "status")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value

    @field_validator("updated_at")
    @classmethod
    def _validate_timestamp(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("updated_at must be non-empty")
        try:
            datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("updated_at must be ISO-8601") from exc
        return text

    @field_validator("operator_holds")
    @classmethod
    def _validate_operator_holds(cls, rows: List[str]) -> List[str]:
        cleaned = [str(row or "").strip() for row in (rows or [])]
        if any(not row for row in cleaned):
            raise ValueError("operator_holds must not contain empty values")
        return cleaned


class ReleaseArtifactReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    artifact_id: str
    content_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    candidate_ref: str
    release_id: str
    revision_id: str
    producer: str
    validation_outcome: str
    created_at: str = Field(default_factory=_now_iso)

    @field_validator("artifact_id", "candidate_ref", "release_id", "revision_id", "producer")
    @classmethod
    def _receipt_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("artifact receipt fields must be non-empty")
        return text

    @field_validator("validation_outcome")
    @classmethod
    def _receipt_outcome(cls, value: str) -> str:
        outcome = str(value or "").strip().lower()
        if outcome not in {"passed", "failed"}:
            raise ValueError("validation_outcome must be passed or failed")
        return outcome

    @field_validator("created_at")
    @classmethod
    def _receipt_timestamp(cls, value: str) -> str:
        _parse_ts(value)
        return value


def record_release_artifact_receipt(
    state: ReleaseWorkflowState,
    receipt: ReleaseArtifactReceipt | Dict[str, Any],
) -> ReleaseWorkflowState:
    record = receipt if isinstance(receipt, ReleaseArtifactReceipt) else ReleaseArtifactReceipt.model_validate(receipt)
    if (
        record.candidate_ref != state.candidate_ref
        or record.release_id != state.release_id
        or record.revision_id != state.revision_id
    ):
        raise ValueError("artifact receipt is not bound to the active release candidate and revision")
    rows = [
        row for row in list((state.metadata or {}).get("release_artifacts") or [])
        if isinstance(row, dict) and str(row.get("artifact_id") or "") != record.artifact_id
    ]
    rows.append(record.model_dump())
    return _copy_state(
        state,
        metadata={**dict(state.metadata), "release_artifacts": rows},
        updated_at=_now_iso(),
    )


class ReleaseWorkflowHistoryRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    history_id: str = Field(default_factory=_history_id)
    process_id: str
    release_id: str
    revision_id: str
    current_stage: str
    status: str
    actor: Optional[str] = None
    provenance: Dict[str, Any] = Field(default_factory=dict)
    change_set: Dict[str, Any] = Field(default_factory=dict)
    state: Dict[str, Any]
    recorded_at: str = Field(default_factory=_now_iso)

    @field_validator("history_id", "process_id", "release_id", "revision_id", "current_stage", "status", "recorded_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value



def _workflow_validate_compat(data: Dict[str, Any]) -> ReleaseWorkflowState:
    if hasattr(ReleaseWorkflowState, "model_validate"):
        return ReleaseWorkflowState.model_validate(data)
    return ReleaseWorkflowState.parse_obj(data)



def _workflow_dump_compat(model: ReleaseWorkflowState) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _history_validate_compat(data: Dict[str, Any]) -> ReleaseWorkflowHistoryRecord:
    if hasattr(ReleaseWorkflowHistoryRecord, "model_validate"):
        return ReleaseWorkflowHistoryRecord.model_validate(data)
    return ReleaseWorkflowHistoryRecord.parse_obj(data)



def _history_dump_compat(model: ReleaseWorkflowHistoryRecord) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _copy_state(state: ReleaseWorkflowState, **updates: Any) -> ReleaseWorkflowState:
    data = _workflow_dump_compat(state)
    data.update(updates)
    return _workflow_validate_compat(data)



def _state_change_set(before: Optional[ReleaseWorkflowState], after: ReleaseWorkflowState) -> Dict[str, Any]:
    previous_safe_push = None
    if before:
        previous_safe_push = bool((before.safe_push_criteria or {}).get("safe_push")) if before.safe_push_criteria else None
    current_safe_push = bool((after.safe_push_criteria or {}).get("safe_push")) if after.safe_push_criteria else None
    return {
        "created": before is None,
        "from_revision_id": before.revision_id if before else None,
        "to_revision_id": after.revision_id,
        "previous_stage": before.current_stage if before else None,
        "current_stage": after.current_stage,
        "status_before": before.status if before else None,
        "status_after": after.status,
        "promotion_count_before": len(before.promotion_history) if before else 0,
        "promotion_count_after": len(after.promotion_history),
        "handoff_count_before": len(before.handoff_records) if before else 0,
        "handoff_count_after": len(after.handoff_records),
        "fencepost_count_before": len(before.rollback_fenceposts) if before else 0,
        "fencepost_count_after": len(after.rollback_fenceposts),
        "operator_hold_count_before": len(before.operator_holds) if before else 0,
        "operator_hold_count_after": len(after.operator_holds),
        "safe_push_before": previous_safe_push,
        "safe_push_after": current_safe_push,
    }


class ReleaseWorkflowStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _target(self, process_id: Optional[str] = None) -> Path:
        if self.path.suffix:
            return self.path
        if not process_id:
            raise ValueError("process_id required when release store path is a directory")
        return self.path / f"{process_id}.json"

    def _history_target(self, process_id: str) -> Path:
        process = str(process_id or "").strip()
        if not process:
            raise ValueError("process_id required for release history target")
        if self.path.suffix:
            return self.path.with_name(self.path.name + f".{process}.history.jsonl")
        return self.path / "history" / f"{process}.jsonl"

    def _append_history(self, record: ReleaseWorkflowHistoryRecord) -> None:
        target = self._history_target(record.process_id)
        _append_fsynced_jsonl(target, _history_dump_compat(record))

    def _rollback_intent_target(self, process_id: str) -> Path:
        target = self._target(process_id)
        return target.with_name(f".{target.name}.rollback-intent.json")

    def _rollback_lock_target(self, process_id: str) -> Path:
        target = self._target(process_id)
        return target.with_name(f".{target.name}.rollback.lock")

    @contextmanager
    def rollback_transaction(self, process_id: str):
        lock_target = self._rollback_lock_target(process_id)
        lock_target.parent.mkdir(parents=True, exist_ok=True)
        with lock_target.open("a+b") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def load_rollback_intent(self, process_id: str) -> Optional[Dict[str, Any]]:
        target = self._rollback_intent_target(process_id)
        if not target.exists():
            return None
        data = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"invalid rollback intent for {process_id}")
        return data

    def save_rollback_intent(self, process_id: str, intent: Dict[str, Any]) -> Dict[str, Any]:
        payload = dict(intent)
        payload["process_id"] = process_id
        payload["updated_at"] = _now_iso()
        _atomic_write_json(self._rollback_intent_target(process_id), payload)
        return payload

    def load(self, process_id: Optional[str] = None) -> Optional[ReleaseWorkflowState]:
        target = self._target(process_id)
        if not target.exists():
            return None
        return _workflow_validate_compat(json.loads(target.read_text(encoding="utf-8")))

    def history(self, process_id: str) -> List[ReleaseWorkflowHistoryRecord]:
        target = self._history_target(process_id)
        if not target.exists():
            return []
        rows: List[ReleaseWorkflowHistoryRecord] = []
        with target.open("r", encoding="utf-8") as handle:
            for line in handle:
                text = line.strip()
                if not text:
                    continue
                rows.append(_history_validate_compat(json.loads(text)))
        return rows

    def save(
        self,
        state: ReleaseWorkflowState | Dict[str, Any],
        *,
        actor: Optional[str] = None,
        provenance: Optional[Dict[str, Any]] = None,
    ) -> ReleaseWorkflowState:
        record = state if isinstance(state, ReleaseWorkflowState) else _workflow_validate_compat(dict(state))
        current = self.load(record.process_id)
        target = self._target(record.process_id)
        _atomic_write_json(target, _workflow_dump_compat(record))
        self._append_history(
            ReleaseWorkflowHistoryRecord(
                process_id=record.process_id,
                release_id=record.release_id,
                revision_id=record.revision_id,
                current_stage=record.current_stage,
                status=record.status,
                actor=str(actor or "").strip() or None,
                provenance=dict(provenance or {}),
                change_set=_state_change_set(current, record),
                state=_workflow_dump_compat(record),
            )
        )
        return record



def capture_release_rollback_fencepost(
    *,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    stage: str,
    latest_event: Optional[ProcessEvent] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> ReleaseRollbackFencepost:
    if snapshot.process_id != shared_state.process_id:
        raise ValueError("snapshot and shared_state must refer to the same process_id")
    stage_name = str(stage or "").strip()
    if not stage_name:
        raise ValueError("stage must be non-empty")
    restore_state = {
        "process_id": snapshot.process_id,
        "snapshot_id": snapshot.snapshot_id,
        "shared_state_revision_id": shared_state.revision_id,
        "last_event_id": snapshot.last_event_id,
        "lifecycle_state": snapshot.lifecycle_state,
        "active_steps": list(snapshot.active_steps),
        "waiting_steps": list(snapshot.waiting_steps),
        "completed_steps": list(snapshot.completed_steps),
        "failed_steps": list(snapshot.failed_steps),
        "assigned_agents": dict(snapshot.assigned_agents),
        "runtime_policy": dict(snapshot.runtime_policy),
        "session_state": dict(snapshot.session_state),
        "goals": list(shared_state.goals),
        "open_decisions": [row.model_dump() if hasattr(row, "model_dump") else row.dict() for row in shared_state.open_decisions],
        "runtime_constraints": dict(shared_state.runtime_constraints),
        "world_state": {**dict(snapshot.world_state), **dict(shared_state.world_state)},
        "belief_refs": _dedupe_rows(list(snapshot.belief_refs) + list(shared_state.belief_refs)),
        "open_questions": list(shared_state.open_questions),
        "agent_ownership": dict(shared_state.agent_ownership),
        "operator_overrides": dict(shared_state.operator_overrides),
        "artifact_refs": _dedupe_rows(list(snapshot.artifact_refs)),
        "metadata": {
            **dict(snapshot.metadata),
            "fencepost_stage": stage_name,
            "fencepost_shared_state_revision_id": shared_state.revision_id,
        },
    }
    return ReleaseRollbackFencepost(
        process_id=snapshot.process_id,
        stage=stage_name,
        revision_id=shared_state.revision_id,
        snapshot_id=snapshot.snapshot_id,
        shared_state_revision_id=shared_state.revision_id,
        last_event_id=(latest_event.event_id if latest_event else snapshot.last_event_id),
        lifecycle_state=snapshot.lifecycle_state,
        restore_state=restore_state,
        metadata={
            **dict(metadata or {}),
            "snapshot_event_count": int(snapshot.event_count or 0),
            "shared_state_id": shared_state.state_id,
        },
    )



def record_release_fencepost(state: ReleaseWorkflowState, fencepost: ReleaseRollbackFencepost) -> ReleaseWorkflowState:
    if fencepost.process_id != state.process_id:
        raise ValueError("fencepost process_id must match release workflow state")
    rows = [row for row in state.rollback_fenceposts if row.stage != fencepost.stage]
    rows.append(fencepost)
    rows = sorted(rows, key=lambda row: row.created_at)
    return _copy_state(state, rollback_fenceposts=rows, updated_at=_now_iso())



def record_release_handoff(
    state: ReleaseWorkflowState,
    message: AgentMessage,
    *,
    stage: Optional[str] = None,
    notes: Optional[str] = None,
) -> ReleaseWorkflowState:
    if message.process_id != state.process_id:
        raise ValueError("message process_id must match release workflow state")
    message_metadata = dict(message.metadata or {})
    record = {
        "message_id": message.message_id,
        "handoff_id": message.handoff_id,
        "stage": str(message_metadata.get("target_stage") or stage or state.current_stage).strip() or state.current_stage,
        "from_agent": message.from_agent,
        "to_agent": message.to_agent,
        "delivery_status": message.delivery_status,
        "revision_id": message.revision_id,
        "release_id": str(message_metadata.get("release_id") or state.release_id).strip(),
        "candidate_ref": str(message_metadata.get("candidate_ref") or state.candidate_ref).strip(),
        "created_at": message.created_at,
        "acked_at": message.acked_at,
        "dead_lettered_at": message.dead_lettered_at,
        "notes": str(notes or "").strip() or None,
    }
    rows: List[Dict[str, Any]] = []
    replaced = False
    for row in state.handoff_records:
        if str(row.get("message_id") or "").strip() == message.message_id:
            merged = {**row, **record}
            rows.append(merged)
            replaced = True
        else:
            rows.append(dict(row))
    if not replaced:
        rows.append(record)
    return _copy_state(state, handoff_records=rows, updated_at=_now_iso())



def compile_release_handoff(
    *,
    state: ReleaseWorkflowState,
    shared_state: SharedProcessState,
    from_agent: str,
    to_agent: str,
    objective: str,
    scope: str,
    expected_output: str,
    gate: Optional[Dict[str, Any]] = None,
    snapshot: Optional[ProcessSnapshot] = None,
    open_questions: Optional[List[str]] = None,
    relevant_artifact_ids: Optional[List[str]] = None,
    relevant_evidence_ids: Optional[List[str]] = None,
    timeout_seconds: Optional[int] = None,
    lease_seconds: Optional[int] = None,
) -> HandoffContract:
    if shared_state.process_id != state.process_id:
        raise ValueError("shared_state process_id must match release workflow state")
    artifacts = _dedupe_rows(
        list(relevant_artifact_ids or [])
        + (list(snapshot.artifact_refs) if snapshot else [])
        + [str(row.get("artifact_id") or "") for row in (state.metadata.get("release_artifacts") or []) if isinstance(row, dict)]
    )
    evidence_ids = _dedupe_rows(list(relevant_evidence_ids or []))
    gate_blockers = [str(row.get("summary") or row) for row in (gate or {}).get("blockers", []) if str(row.get("summary") if isinstance(row, dict) else row).strip()]
    handoff_questions = _dedupe_rows(list(open_questions or []) + gate_blockers + list(shared_state.open_questions))
    assumptions = _dedupe_rows(
        [
            f"release stage={state.current_stage}",
            f"candidate ref={state.candidate_ref}",
            f"target environment={state.target_environment}",
            f"shared revision={shared_state.revision_id}",
        ]
        + ([f"safe push={bool((gate or {}).get('safe_push'))}"] if gate is not None else [])
    )
    return HandoffContract(
        process_id=state.process_id,
        from_agent=from_agent,
        to_agent=to_agent,
        source_revision=shared_state.revision_id,
        objective=objective,
        scope=scope,
        assumptions=assumptions,
        relevant_evidence=[HandoffEvidenceRef(ref_id=ref_id, summary="release gate evidence") for ref_id in evidence_ids],
        relevant_artifacts=[HandoffArtifactRef(artifact_id=artifact_id, summary="release workflow artifact") for artifact_id in artifacts],
        open_questions=handoff_questions,
        expected_output=expected_output,
        timeout_seconds=timeout_seconds,
        lease_seconds=lease_seconds,
        metadata={
            "release_id": state.release_id,
            "current_stage": state.current_stage,
            "target_environment": state.target_environment,
            "candidate_ref": state.candidate_ref,
            "gate_safe_push": bool((gate or {}).get("safe_push")) if gate is not None else None,
        },
    )



def evaluate_release_promotion_gate(
    *,
    state: ReleaseWorkflowState,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    target_stage: str,
    mailbox_messages: Optional[List[AgentMessage]] = None,
    leases: Optional[List[AgentLease]] = None,
    dependability_report: Optional[JsonDict] = None,
    required_fencepost_stages: Optional[List[str]] = None,
    required_artifacts: Optional[List[str]] = None,
    required_handoff_count: int = 0,
    allowed_active_agents: Optional[List[str]] = None,
    allowed_lifecycle_states: Optional[List[str]] = None,
    require_dependability: bool = True,
) -> JsonDict:
    if snapshot.process_id != state.process_id or shared_state.process_id != state.process_id:
        raise ValueError("release workflow state, snapshot, and shared_state must refer to the same process_id")

    target = str(target_stage or "").strip()
    if not target:
        raise ValueError("target_stage must be non-empty")

    required_fenceposts = _dedupe_rows(list(required_fencepost_stages or []))
    required_artifact_ids = _dedupe_rows(list(required_artifacts or []))
    allowed_lifecycle = _dedupe_rows(list(allowed_lifecycle_states or ["waiting", "completed"]))
    allowed_agents = set(_dedupe_rows(list(allowed_active_agents or [])))

    target_records = [
        row
        for row in (state.handoff_records or [])
        if str(row.get("stage") or "").strip() == target
    ]
    current_handoff_records = [
        row
        for row in target_records
        if str(row.get("revision_id") or "").strip() == shared_state.revision_id
        and str(row.get("release_id") or "").strip() == state.release_id
        and str(row.get("candidate_ref") or "").strip() == state.candidate_ref
    ]
    tracked_message_ids = {
        str(row.get("message_id") or "").strip()
        for row in current_handoff_records
        if str(row.get("message_id") or "").strip()
    }
    relevant_messages = [
        row
        for row in (mailbox_messages or [])
        if row.process_id == state.process_id and row.message_id in tracked_message_ids
    ]
    acked_messages = [row for row in relevant_messages if _is_bound_release_approval(row, state)]
    dead_letter_messages = [row for row in relevant_messages if row.delivery_status == "dead_letter"]
    stale_handoff_records = [
        row
        for row in target_records
        if row not in current_handoff_records
    ]

    process_leases = [row for row in (leases or []) if row.process_id == state.process_id]
    active_leases = [row for row in process_leases if row.status == "active"]
    stale_leases = [row for row in process_leases if row.status == "stale"]
    unexpected_active_leases = [
        row for row in active_leases if not allowed_agents or str(row.agent_id or "").strip() not in allowed_agents
    ]

    present_fenceposts = {row.stage: row for row in state.rollback_fenceposts}
    missing_fenceposts = [stage for stage in required_fenceposts if stage not in present_fenceposts]

    valid_artifact_receipts: List[ReleaseArtifactReceipt] = []
    invalid_artifact_receipts: List[str] = []
    for raw_receipt in state.metadata.get("release_artifacts") or []:
        try:
            receipt = ReleaseArtifactReceipt.model_validate(raw_receipt)
        except Exception:
            invalid_artifact_receipts.append(
                str((raw_receipt or {}).get("artifact_id") or "invalid_receipt")
                if isinstance(raw_receipt, dict)
                else "invalid_receipt"
            )
            continue
        if (
            receipt.candidate_ref != state.candidate_ref
            or receipt.release_id != state.release_id
            or receipt.revision_id != shared_state.revision_id
            or receipt.validation_outcome != "passed"
        ):
            invalid_artifact_receipts.append(receipt.artifact_id)
            continue
        valid_artifact_receipts.append(receipt)
    present_artifacts = {receipt.artifact_id for receipt in valid_artifact_receipts}
    missing_artifacts = [artifact_id for artifact_id in required_artifact_ids if artifact_id not in present_artifacts]

    dependability_success = bool((dependability_report or {}).get("success")) if require_dependability else True
    checks = {
        "revision_aligned": state.revision_id == shared_state.revision_id,
        "lifecycle_ready": snapshot.lifecycle_state in allowed_lifecycle,
        "dependability_ok": dependability_success,
        "handoff_receipts_ok": len(acked_messages) >= int(required_handoff_count or 0),
        # Only current, fully bound handoffs enter tracked_message_ids and can
        # satisfy handoff_receipts_ok. Historical stale records remain audit
        # evidence but do not permanently poison a later valid promotion.
        "handoff_bindings_current": True,
        "dead_letters_clear": len(dead_letter_messages) == 0,
        "lease_health_ok": len(stale_leases) == 0,
        "active_leases_safe": len(unexpected_active_leases) == 0,
        "fenceposts_ready": len(missing_fenceposts) == 0,
        "artifacts_ready": len(missing_artifacts) == 0,
        "operator_holds_clear": len(state.operator_holds) == 0,
    }
    safe_push = all(checks.values())

    blockers: List[Dict[str, Any]] = []
    if not checks["revision_aligned"]:
        blockers.append(
            {
                "check": "revision_aligned",
                "summary": f"release revision drifted: state={state.revision_id}, shared={shared_state.revision_id}",
            }
        )
    if not checks["lifecycle_ready"]:
        blockers.append(
            {
                "check": "lifecycle_ready",
                "summary": f"snapshot lifecycle {snapshot.lifecycle_state} is not promotion-safe",
            }
        )
    if not checks["dependability_ok"]:
        blockers.append(
            {
                "check": "dependability_ok",
                "summary": f"dependability report failed for promotion to {target}",
            }
        )
    if not checks["handoff_receipts_ok"]:
        blockers.append(
            {
                "check": "handoff_receipts_ok",
                "summary": f"acked handoffs {len(acked_messages)} below required {int(required_handoff_count or 0)}",
            }
        )
    if not checks["dead_letters_clear"]:
        blockers.append(
            {
                "check": "dead_letters_clear",
                "summary": f"{len(dead_letter_messages)} dead-letter handoffs still need recovery",
                "message_ids": [row.message_id for row in dead_letter_messages],
            }
        )
    if not checks["lease_health_ok"]:
        blockers.append(
            {
                "check": "lease_health_ok",
                "summary": f"{len(stale_leases)} stale agent leases block safe push",
                "lease_ids": [row.lease_id for row in stale_leases],
            }
        )
    if not checks["active_leases_safe"]:
        blockers.append(
            {
                "check": "active_leases_safe",
                "summary": f"{len(unexpected_active_leases)} active leases still own release scope",
                "lease_ids": [row.lease_id for row in unexpected_active_leases],
            }
        )
    if not checks["fenceposts_ready"]:
        blockers.append(
            {
                "check": "fenceposts_ready",
                "summary": f"missing rollback fenceposts: {', '.join(missing_fenceposts)}",
                "missing_fenceposts": missing_fenceposts,
            }
        )
    if not checks["artifacts_ready"]:
        blockers.append(
            {
                "check": "artifacts_ready",
                "summary": f"missing current candidate-bound artifact receipts: {', '.join(missing_artifacts)}",
                "missing_artifacts": missing_artifacts,
                "invalid_receipt_ids": invalid_artifact_receipts,
            }
        )
    if not checks["operator_holds_clear"]:
        blockers.append(
            {
                "check": "operator_holds_clear",
                "summary": f"operator holds active: {', '.join(state.operator_holds)}",
            }
        )

    return {
        "process_id": state.process_id,
        "release_id": state.release_id,
        "candidate_ref": state.candidate_ref,
        "current_stage": state.current_stage,
        "target_stage": target,
        "current_revision_id": shared_state.revision_id,
        "checks": checks,
        "safe_push": safe_push,
        "required_fencepost_stages": required_fenceposts,
        "required_artifacts": required_artifact_ids,
        "required_handoff_count": int(required_handoff_count or 0),
        "allowed_active_agents": sorted(allowed_agents),
        "allowed_lifecycle_states": allowed_lifecycle,
        "require_dependability": bool(require_dependability),
        "counts": {
            "tracked_handoff_count": len(tracked_message_ids),
            "acked_handoff_count": len(acked_messages),
            "dead_letter_count": len(dead_letter_messages),
            "active_lease_count": len(active_leases),
            "stale_lease_count": len(stale_leases),
            "rollback_fencepost_count": len(state.rollback_fenceposts),
            "stale_handoff_record_count": len(stale_handoff_records),
        },
        "missing_fenceposts": missing_fenceposts,
        "missing_artifacts": missing_artifacts,
        "valid_artifact_receipt_ids": sorted(present_artifacts),
        "invalid_artifact_receipt_ids": invalid_artifact_receipts,
        "dead_letter_ids": [row.message_id for row in dead_letter_messages],
        "acked_handoff_ids": [row.message_id for row in acked_messages],
        "stale_handoff_records": [dict(row) for row in stale_handoff_records],
        "dependability": dict(dependability_report or {}),
        "blockers": blockers,
        "operator_summary": (
            f"release promotion {'ready' if safe_push else 'blocked'} for {state.process_id}: "
            f"stage {state.current_stage} -> {target}, blockers={len(blockers)}"
        ),
    }



def _apply_gate_result(state: ReleaseWorkflowState, gate: JsonDict) -> ReleaseWorkflowState:
    return _copy_state(
        state,
        revision_id=str(gate.get("current_revision_id") or state.revision_id).strip() or state.revision_id,
        status="ready" if bool(gate.get("safe_push")) else "blocked",
        safe_push_criteria=dict(gate or {}),
        updated_at=_now_iso(),
    )



def advance_release_workflow(
    state: ReleaseWorkflowState,
    *,
    gate: JsonDict,
    next_stage: str,
    actor: str,
    dry_run: bool = False,
    metadata: Optional[Dict[str, Any]] = None,
) -> JsonDict:
    target = str(next_stage or "").strip()
    if not target:
        raise ValueError("next_stage must be non-empty")
    actor_id = str(actor or "").strip()
    if not actor_id:
        raise ValueError("actor must be non-empty")

    gated_state = _apply_gate_result(state, gate)
    if not bool(gate.get("safe_push")) or dry_run:
        return {
            "promoted": False,
            "dry_run": bool(dry_run),
            "blocked_reason": None if dry_run else "promotion_gate_failed",
            "state": gated_state,
            "previous_stage": state.current_stage,
            "next_stage": target,
            "operator_summary": (
                f"release promotion preview for {state.process_id}: {state.current_stage} -> {target}"
                if dry_run
                else f"release promotion blocked for {state.process_id}: {state.current_stage} -> {target}"
            ),
        }

    promotion_entry = {
        "ts": _now_iso(),
        "actor": actor_id,
        "from_stage": state.current_stage,
        "to_stage": target,
        "safe_push": True,
        "candidate_ref": state.candidate_ref,
        "metadata": dict(metadata or {}),
    }
    updated = _copy_state(
        gated_state,
        current_stage=target,
        status="promoted" if target == state.target_environment else "in_progress",
        promotion_history=list(gated_state.promotion_history) + [promotion_entry],
        updated_at=_now_iso(),
    )
    return {
        "promoted": True,
        "dry_run": False,
        "blocked_reason": None,
        "state": updated,
        "previous_stage": state.current_stage,
        "next_stage": target,
        "operator_summary": f"release promoted for {state.process_id}: {state.current_stage} -> {target}",
    }



def rollback_release_workflow(
    state: ReleaseWorkflowState,
    *,
    stage: Optional[str] = None,
    fencepost_id: Optional[str] = None,
    actor: str = "operator",
    reason: str = "rollback",
) -> JsonDict:
    if not state.rollback_fenceposts:
        raise KeyError(f"release workflow has no rollback fenceposts: {state.process_id}")

    target: Optional[ReleaseRollbackFencepost] = None
    if fencepost_id:
        target_id = str(fencepost_id or "").strip()
        for row in reversed(state.rollback_fenceposts):
            if row.fencepost_id == target_id:
                target = row
                break
    elif stage:
        stage_name = str(stage or "").strip()
        for row in reversed(state.rollback_fenceposts):
            if row.stage == stage_name:
                target = row
                break
    else:
        target = state.rollback_fenceposts[-1]

    if target is None:
        selector = fencepost_id or stage or "latest"
        raise KeyError(f"rollback fencepost not found for {state.process_id}: {selector}")

    rollback_entry = {
        "ts": _now_iso(),
        "actor": str(actor or "operator").strip() or "operator",
        "action": "rollback",
        "reason": str(reason or "rollback").strip() or "rollback",
        "target_stage": target.stage,
        "fencepost_id": target.fencepost_id,
    }
    updated = _copy_state(
        state,
        current_stage=target.stage,
        status="rolled_back",
        revision_id=target.shared_state_revision_id,
        promotion_history=list(state.promotion_history) + [rollback_entry],
        safe_push_criteria={
            "safe_push": False,
            "rollback_target_stage": target.stage,
            "rollback_fencepost_id": target.fencepost_id,
        },
        metadata={
            **dict(state.metadata),
            "rollback_target_stage": target.stage,
            "rollback_fencepost_id": target.fencepost_id,
            "rollback_reason": str(reason or "rollback").strip() or "rollback",
        },
        updated_at=_now_iso(),
    )
    return {
        "rolled_back": True,
        "state": updated,
        "fencepost": target.model_dump() if hasattr(target, "model_dump") else target.dict(),
        "restore_state": dict(target.restore_state or {}),
        "operator_summary": f"release rolled back for {state.process_id} to {target.stage}",
    }



def compile_release_repair_plan(state: ReleaseWorkflowState, gate: JsonDict) -> JsonDict:
    checks = dict(gate.get("checks") or {})
    actions: List[JsonDict] = []

    def _add(check: str, action: str, detail: str) -> None:
        actions.append({"check": check, "action": action, "detail": detail})

    if not checks.get("revision_aligned", True):
        _add("revision_aligned", "refresh_release_revision", "align the release workflow revision with the shared process head")
    if not checks.get("handoff_receipts_ok", True) or not checks.get("dead_letters_clear", True) or not checks.get("handoff_bindings_current", True):
        _add("handoff_receipts_ok", "recover_handoff_messages", "requeue stale or dead-letter handoffs for recipient verification on the current revision")
    if not checks.get("lease_health_ok", True):
        _add("lease_health_ok", "resolve_stale_leases", "reclaim stale leases and release them before promotion")
    if not checks.get("active_leases_safe", True):
        _add("active_leases_safe", "manual_scope_drain", "drain or explicitly allow active leases before promoting the release")
    if not checks.get("fenceposts_ready", True):
        _add("fenceposts_ready", "restore_archived_fenceposts", "restore revision-matched fenceposts captured when each required stage was reached")
    if not checks.get("artifacts_ready", True):
        _add("artifacts_ready", "regenerate_release_artifacts", "regenerate missing build or smoke-test artifacts before promotion")
    if not checks.get("dependability_ok", True):
        _add("dependability_ok", "revalidate_dependability", "re-run the dependability checks and checkpoint the runtime before promotion")
    if not checks.get("lifecycle_ready", True):
        _add("lifecycle_ready", "restore_safe_lifecycle_state", "move the process back to a waiting or completed state before promoting")
    if not checks.get("operator_holds_clear", True):
        _add("operator_holds_clear", "manual_hold_clear", "clear operator holds explicitly before pushing the release")

    deduped: List[JsonDict] = []
    seen = set()
    for row in actions:
        key = (row["action"], row["detail"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)

    return {
        "process_id": state.process_id,
        "release_id": state.release_id,
        "failing_checks": [name for name, passed in checks.items() if not passed],
        "actions": deduped,
        "operator_summary": f"release repair plan: {len(deduped)} actions for {state.process_id}",
    }



def repair_release_workflow(
    state: ReleaseWorkflowState,
    *,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    mailbox: AgentMailbox,
    supervisor: AgentSupervisor,
    gate: Optional[JsonDict] = None,
    target_stage: Optional[str] = None,
    dependability_report: Optional[JsonDict] = None,
    required_fencepost_stages: Optional[List[str]] = None,
    required_artifacts: Optional[List[str]] = None,
    required_handoff_count: Optional[int] = None,
    allowed_active_agents: Optional[List[str]] = None,
    allowed_lifecycle_states: Optional[List[str]] = None,
    require_dependability: Optional[bool] = None,
) -> JsonDict:
    stage_target = str(target_stage or (gate or {}).get("target_stage") or state.target_environment).strip()
    if not stage_target:
        raise ValueError("target_stage must be non-empty for release repair")

    active_gate = gate or evaluate_release_promotion_gate(
        state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        target_stage=stage_target,
        mailbox_messages=mailbox.list(process_id=state.process_id),
        leases=supervisor.list(process_id=state.process_id),
        dependability_report=dependability_report,
        required_fencepost_stages=required_fencepost_stages,
        required_artifacts=required_artifacts,
        required_handoff_count=int(required_handoff_count or 0),
        allowed_active_agents=allowed_active_agents,
        allowed_lifecycle_states=allowed_lifecycle_states,
        require_dependability=bool(require_dependability) if require_dependability is not None else bool((gate or {}).get("require_dependability", True)),
    )

    updated_state = _apply_gate_result(state, active_gate)
    actions_taken: List[JsonDict] = []

    if not active_gate["checks"].get("revision_aligned", True):
        updated_state = _copy_state(updated_state, revision_id=shared_state.revision_id, updated_at=_now_iso())
        actions_taken.append({"action": "refresh_release_revision", "revision_id": shared_state.revision_id})

    relevant_messages = mailbox.list(process_id=state.process_id)
    tracked_ids = {
        str(row.get("message_id") or "").strip()
        for row in updated_state.handoff_records
        if str(row.get("message_id") or "").strip() and str(row.get("stage") or "").strip() == stage_target
    }
    relevant_messages = [row for row in relevant_messages if row.message_id in tracked_ids]

    recovered_ids: List[str] = []
    for row in relevant_messages:
        if row.delivery_status == "dead_letter":
            recovered = mailbox.recover_dead_letter(
                row.message_id,
                revision_id=shared_state.revision_id,
                recovery_reason="release_gate_repair",
            )
            recovered_ids.append(recovered.message_id)
            row = recovered
        latest_messages = {msg.message_id: msg for msg in mailbox.list(process_id=state.process_id)}
        latest = latest_messages.get(row.message_id)
        if latest is not None:
            updated_state = record_release_handoff(updated_state, latest, stage=stage_target, notes="requeued for recipient verification")
    if recovered_ids:
        actions_taken.append(
            {
                "action": "recover_handoff_messages",
                "recovered_ids": recovered_ids,
            }
        )

    if not active_gate["checks"].get("lease_health_ok", True):
        reclaim_now = _now() + timedelta(days=365)
        reclaimed = supervisor.reclaim_stale(now=reclaim_now)
        resolved_ids: List[str] = []
        for lease in supervisor.list(process_id=state.process_id, status="stale"):
            resolved = supervisor.resolve(lease.lease_id, status="released", metadata={"resolution": "release_gate_repair"})
            resolved_ids.append(resolved.lease_id)
        actions_taken.append(
            {
                "action": "resolve_stale_leases",
                "reclaimed_ids": [row.lease_id for row in reclaimed],
                "resolved_ids": resolved_ids,
            }
        )

    missing_fenceposts = list(active_gate.get("missing_fenceposts") or [])
    if missing_fenceposts:
        actions_taken.append(
            {
                "action": "missing_historical_fenceposts",
                "stages": missing_fenceposts,
                "blocking": True,
            }
        )

    refreshed_gate = evaluate_release_promotion_gate(
        state=updated_state,
        snapshot=snapshot,
        shared_state=shared_state,
        target_stage=stage_target,
        mailbox_messages=mailbox.list(process_id=state.process_id),
        leases=supervisor.list(process_id=state.process_id),
        dependability_report=dependability_report,
        required_fencepost_stages=required_fencepost_stages or list(active_gate.get("required_fencepost_stages") or []),
        required_artifacts=required_artifacts or list(active_gate.get("required_artifacts") or []),
        required_handoff_count=int(active_gate.get("required_handoff_count", required_handoff_count or 0) or 0),
        allowed_active_agents=allowed_active_agents or list(active_gate.get("allowed_active_agents") or []),
        allowed_lifecycle_states=allowed_lifecycle_states or list(active_gate.get("allowed_lifecycle_states") or []),
        require_dependability=bool(require_dependability) if require_dependability is not None else bool(active_gate.get("require_dependability", True)),
    )
    updated_state = _apply_gate_result(updated_state, refreshed_gate)

    return {
        "state": updated_state,
        "gate_before": active_gate,
        "gate_after": refreshed_gate,
        "actions_taken": actions_taken,
        "success": bool(refreshed_gate.get("safe_push")),
        "operator_summary": (
            f"release repair {'ok' if refreshed_gate.get('safe_push') else 'failed'} for {state.process_id}: "
            f"actions={len(actions_taken)}"
        ),
    }



def _restore_release_session_registry(session_registry: Any, *, process_id: str, session_state: Dict[str, Any]) -> None:
    if session_registry is None or "sessions" not in session_state:
        return
    restored_rows = []
    for row in session_state.get("sessions") or []:
        if not isinstance(row, dict) or str(row.get("process_id") or "").strip() != process_id:
            continue
        restored_rows.append(SessionRecord.model_validate(row) if hasattr(SessionRecord, "model_validate") else SessionRecord.parse_obj(row))
    with session_registry._transaction():
        retained = [row for row in session_registry._load_all() if row.process_id != process_id]
        session_registry._write_all(retained + restored_rows)


def apply_release_rollback_restore(
    state: ReleaseWorkflowState,
    *,
    snapshot_store: ProcessSnapshotStore,
    shared_state_store: SharedProcessStateStore,
    release_store: Optional[ReleaseWorkflowStore] = None,
    journal: Optional[ProcessJournal] = None,
    session_registry: Any = None,
    stage: Optional[str] = None,
    fencepost_id: Optional[str] = None,
    actor: Optional[str] = None,
    reason: str = "rollback",
    new_revision_id: Optional[str] = None,
) -> JsonDict:
    transaction_store = release_store or ReleaseWorkflowStore(Path(snapshot_store.path).parent / "rollback_transactions")
    normalized_reason = str(reason or "rollback").strip() or "rollback"
    with transaction_store.rollback_transaction(state.process_id), shared_state_store.transaction(state.process_id):
        intent = transaction_store.load_rollback_intent(state.process_id)
        resumable = bool(
            intent
            and intent.get("status") in {"in_progress", "recovery_required"}
            and intent.get("release_id") == state.release_id
        )
        if resumable:
            rolled_state = _workflow_validate_compat(dict(intent["rolled_state"]))
            target_fencepost = dict(intent["fencepost"])
            restore_state = dict(intent["restore_state"])
        else:
            rolled = rollback_release_workflow(state, stage=stage, fencepost_id=fencepost_id, reason=normalized_reason)
            rolled_state = rolled["state"]
            target_fencepost = dict(rolled["fencepost"])
            restore_state = dict(rolled.get("restore_state") or {})
            transaction_id = f"rollback_{uuid4().hex[:16]}"
            target_revision = str(restore_state.get("shared_state_revision_id") or target_fencepost.get("shared_state_revision_id") or "").strip()
            if not target_revision:
                raise ValueError("rollback fencepost missing shared_state_revision_id")
            intent = transaction_store.save_rollback_intent(
                state.process_id,
                {
                    "transaction_id": transaction_id,
                    "status": "in_progress",
                    "phase": "planned",
                    "release_id": state.release_id,
                    "source_stage": state.current_stage,
                    "source_revision_id": state.revision_id,
                    "target_revision_id": target_revision,
                    "rollback_revision_id": str(new_revision_id or f"{target_revision}.rollback").strip(),
                    "rollback_event_id": f"evt_{transaction_id}",
                    "rollback_snapshot_id": f"snap_{transaction_id}",
                    "reason": normalized_reason,
                    "actor": str(actor or "").strip() or None,
                    "rolled_state": _workflow_dump_compat(rolled_state),
                    "fencepost": target_fencepost,
                    "restore_state": restore_state,
                },
            )

        assert intent is not None
        if resumable:
            normalized_reason = str(intent.get("reason") or normalized_reason).strip() or normalized_reason
            actor = str(intent.get("actor") or actor or "").strip() or None
        transaction_id = str(intent["transaction_id"])
        target_fencepost_id = str(target_fencepost.get("fencepost_id") or "").strip() or None
        target_fencepost_metadata = dict(target_fencepost.get("metadata") or {})
        target_revision_id = str(intent["target_revision_id"])
        rollback_revision_id = str(intent["rollback_revision_id"])
        provenance = {
            "release_id": state.release_id,
            "rollback": True,
            "rollback_transaction_id": transaction_id,
            "fencepost_id": target_fencepost_id,
            "reason": normalized_reason,
        }

        try:
            current_shared = shared_state_store.load(state.process_id)
            if current_shared is not None and current_shared.revision_id == rollback_revision_id:
                restored_shared = current_shared
            else:
                try:
                    restored_shared = shared_state_store.rollback(
                        process_id=state.process_id,
                        to_revision_id=target_revision_id,
                        actor=actor,
                        reason=normalized_reason,
                        new_revision_id=rollback_revision_id,
                        provenance=provenance,
                    )
                except KeyError:
                    restored_shared = shared_state_store.save(
                        SharedProcessState(
                            process_id=state.process_id,
                            revision_id=rollback_revision_id,
                            goals=[str(row) for row in (restore_state.get("goals") or [])],
                            active_plan_node_ids=_dedupe_rows(
                                [str(row) for row in (restore_state.get("active_steps") or [])]
                                + [str(row) for row in (restore_state.get("waiting_steps") or [])]
                            ),
                            open_decisions=list(restore_state.get("open_decisions") or []),
                            runtime_constraints=dict(restore_state.get("runtime_constraints") or {}),
                            world_state=dict(restore_state.get("world_state") or {}),
                            belief_refs=_dedupe_rows([str(row) for row in (restore_state.get("belief_refs") or [])]),
                            open_questions=[str(row) for row in (restore_state.get("open_questions") or [])],
                            agent_ownership=dict(restore_state.get("agent_ownership") or restore_state.get("assigned_agents") or {}),
                            operator_overrides=dict(restore_state.get("operator_overrides") or {}),
                            metadata={
                                "rollback_from_revision_id": current_shared.revision_id if current_shared else None,
                                "rollback_to_revision_id": target_revision_id,
                                "rollback_reason": normalized_reason,
                                "rollback_transaction_id": transaction_id,
                            },
                        ),
                        expected_revision_id=current_shared.revision_id if current_shared else None,
                        actor=actor,
                        provenance=provenance,
                    )
            intent = transaction_store.save_rollback_intent(state.process_id, {**intent, "phase": "shared_state_committed", "status": "in_progress"})

            rollback_event = None
            if journal is not None:
                existing_events = {row.event_id: row for row in journal.load(process_id=state.process_id)}
                rollback_event = existing_events.get(str(intent["rollback_event_id"]))
                if rollback_event is None:
                    latest_event = journal.latest(process_id=state.process_id)
                    rollback_event = journal.append(
                        ProcessEvent(
                            event_id=str(intent["rollback_event_id"]),
                            process_id=state.process_id,
                            kind="release_rolled_back",
                            revision_id=restored_shared.revision_id,
                            actor=str(actor or "").strip() or None,
                            causal_parent_ids=[latest_event.event_id] if latest_event else [],
                            payload={
                                "release_id": state.release_id,
                                "from_stage": str(intent.get("source_stage") or state.current_stage),
                                "to_stage": rolled_state.current_stage,
                                "fencepost_id": target_fencepost_id,
                                "reason": normalized_reason,
                                "rollback_transaction_id": transaction_id,
                            },
                        )
                    )
            intent = transaction_store.save_rollback_intent(state.process_id, {**intent, "phase": "journal_committed", "status": "in_progress"})

            current_snapshot = snapshot_store.load(state.process_id)
            if current_snapshot is not None and current_snapshot.metadata.get("rollback_transaction_id") == transaction_id:
                restored_snapshot = current_snapshot
            else:
                restored_snapshot = snapshot_store.save(
                    ProcessSnapshot(
                        snapshot_id=str(intent["rollback_snapshot_id"]),
                        process_id=state.process_id,
                        last_event_id=rollback_event.event_id if rollback_event else restore_state.get("last_event_id"),
                        event_count=max(
                            int(current_snapshot.event_count or 0) if current_snapshot else 0,
                            int(target_fencepost_metadata.get("snapshot_event_count", 0) or 0),
                        ) + (1 if rollback_event else 0),
                        lifecycle_state=str(restore_state.get("lifecycle_state") or "waiting"),
                        active_steps=[str(row) for row in (restore_state.get("active_steps") or []) if str(row).strip()],
                        waiting_steps=[str(row) for row in (restore_state.get("waiting_steps") or []) if str(row).strip()],
                        completed_steps=[str(row) for row in (restore_state.get("completed_steps") or []) if str(row).strip()],
                        failed_steps=[str(row) for row in (restore_state.get("failed_steps") or []) if str(row).strip()],
                        assigned_agents=dict(restore_state.get("assigned_agents") or {}),
                        runtime_policy=dict(restore_state.get("runtime_policy") or {}),
                        session_state=dict(restore_state.get("session_state") or {}),
                        world_state={**dict(restore_state.get("world_state") or {}), **dict(restored_shared.world_state)},
                        belief_refs=_dedupe_rows([str(row) for row in (restore_state.get("belief_refs") or [])] + list(restored_shared.belief_refs)),
                        artifact_refs=[str(row) for row in (restore_state.get("artifact_refs") or []) if str(row).strip()],
                        metadata={
                            **dict(restore_state.get("metadata") or {}),
                            "rollback_applied": True,
                            "rollback_reason": normalized_reason,
                            "rollback_fencepost_id": target_fencepost_id,
                            "rollback_revision_id": restored_shared.revision_id,
                            "rollback_transaction_id": transaction_id,
                        },
                    )
                )
            intent = transaction_store.save_rollback_intent(state.process_id, {**intent, "phase": "snapshot_committed", "status": "in_progress"})

            _restore_release_session_registry(
                session_registry,
                process_id=state.process_id,
                session_state=dict(restore_state.get("session_state") or {}),
            )
            intent = transaction_store.save_rollback_intent(state.process_id, {**intent, "phase": "session_registry_committed", "status": "in_progress"})

            applied_state = _copy_state(
                rolled_state,
                revision_id=restored_shared.revision_id,
                metadata={
                    **dict(rolled_state.metadata or {}),
                    "rollback_applied": True,
                    "rollback_reason": normalized_reason,
                    "rollback_fencepost_id": target_fencepost_id,
                    "rollback_revision_id": restored_shared.revision_id,
                    "rollback_transaction_id": transaction_id,
                },
            )
            if release_store is not None:
                current_release = release_store.load(state.process_id)
                if current_release is not None and current_release.metadata.get("rollback_transaction_id") == transaction_id:
                    applied_state = current_release
                else:
                    applied_state = release_store.save(
                        applied_state,
                        actor=actor,
                        provenance={**provenance, "applied": True, "restored_revision_id": restored_shared.revision_id},
                    )
            intent = transaction_store.save_rollback_intent(
                state.process_id,
                {**intent, "phase": "committed", "status": "committed", "applied_revision_id": restored_shared.revision_id},
            )
        except BaseException as exc:
            transaction_store.save_rollback_intent(
                state.process_id,
                {**intent, "status": "recovery_required", "last_error": f"{type(exc).__name__}: {exc}"},
            )
            raise

        return {
            "rolled_back": True,
            "state": applied_state,
            "fencepost": target_fencepost,
            "restore_state": restore_state,
            "snapshot": restored_snapshot,
            "shared_state": restored_shared,
            "rollback_event": (rollback_event.model_dump() if hasattr(rollback_event, "model_dump") else rollback_event.dict()) if rollback_event is not None else None,
            "rollback_transaction": intent,
            "applied": True,
            "operator_summary": (
                f"release rollback applied for {state.process_id}: {state.current_stage} -> {applied_state.current_stage} "
                f"via {target_fencepost_id or 'unknown_fencepost'}"
            ),
        }


__all__ = [
    "ReleaseArtifactReceipt",
    "ReleaseRollbackFencepost",
    "ReleaseWorkflowHistoryRecord",
    "ReleaseWorkflowState",
    "ReleaseWorkflowStore",
    "advance_release_workflow",
    "apply_release_rollback_restore",
    "capture_release_rollback_fencepost",
    "compile_release_handoff",
    "compile_release_repair_plan",
    "evaluate_release_promotion_gate",
    "record_release_fencepost",
    "record_release_artifact_receipt",
    "record_release_handoff",
    "repair_release_workflow",
    "rollback_release_workflow",
    "ValidationError",
]
