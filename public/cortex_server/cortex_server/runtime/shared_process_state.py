from __future__ import annotations

import json
import fcntl
import os
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from cortex_server.runtime.durable_files import durable_mkdir, fsync_directory
from cortex_server.runtime.runtime_delivery_quota import (
    assert_runtime_delivery_capacity,
    assert_process_count,
    bounded_jsonl_payload,
    encoded_json,
    read_recoverable_jsonl,
    runtime_delivery_quota_transaction,
)


MAX_SHARED_STATE_HISTORY_RECORDS = 4096
MAX_SHARED_STATE_HISTORY_BYTES = 128 * 1024 * 1024



def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"



def _state_id() -> str:
    return f"state_{uuid4().hex[:16]}"


class SharedStateConflictError(RuntimeError):
    def __init__(self, *, process_id: str, expected_revision_id: Optional[str], observed_revision_id: Optional[str], message: Optional[str] = None):
        self.process_id = str(process_id or "").strip()
        self.expected_revision_id = str(expected_revision_id or "").strip() or None
        self.observed_revision_id = str(observed_revision_id or "").strip() or None
        super().__init__(message or f"shared state conflict for {self.process_id}: expected {self.expected_revision_id}, observed {self.observed_revision_id}")


class OpenDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision_id: str
    title: str
    status: str = "open"
    options: List[str] = Field(default_factory=list)
    rationale: Optional[str] = None
    owner: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("decision_id", "title", "status")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value


class SharedProcessState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state_id: str = Field(default_factory=_state_id)
    process_id: str
    revision_id: str
    updated_at: str = Field(default_factory=_now_iso)
    goals: List[str] = Field(default_factory=list)
    active_plan_node_ids: List[str] = Field(default_factory=list)
    open_decisions: List[OpenDecision] = Field(default_factory=list)
    runtime_constraints: Dict[str, Any] = Field(default_factory=dict)
    world_state: Dict[str, Any] = Field(default_factory=dict)
    belief_refs: List[str] = Field(default_factory=list)
    open_questions: List[str] = Field(default_factory=list)
    agent_ownership: Dict[str, str] = Field(default_factory=dict)
    operator_overrides: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("state_id", "process_id", "revision_id")
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

    @field_validator("goals", "active_plan_node_ids", "belief_refs", "open_questions")
    @classmethod
    def _validate_text_rows(cls, rows: List[str]) -> List[str]:
        cleaned = [str(row or "").strip() for row in (rows or [])]
        if any(not row for row in cleaned):
            raise ValueError("list values must not be empty")
        return cleaned


class SharedStateRevisionRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_id: str
    revision_id: str
    parent_revision_id: Optional[str] = None
    actor: Optional[str] = None
    provenance: Dict[str, Any] = Field(default_factory=dict)
    change_set: Dict[str, Any] = Field(default_factory=dict)
    state: Dict[str, Any]
    recorded_at: str = Field(default_factory=_now_iso)

    @field_validator("process_id", "revision_id", "recorded_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value



def _model_validate_compat(data: Dict[str, Any]) -> SharedProcessState:
    if hasattr(SharedProcessState, "model_validate"):
        return SharedProcessState.model_validate(data)
    return SharedProcessState.parse_obj(data)



def _model_dump_compat(model: SharedProcessState) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _revision_record_validate_compat(data: Dict[str, Any]) -> SharedStateRevisionRecord:
    if hasattr(SharedStateRevisionRecord, "model_validate"):
        return SharedStateRevisionRecord.model_validate(data)
    return SharedStateRevisionRecord.parse_obj(data)



def _revision_record_dump_compat(model: SharedStateRevisionRecord) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _dedupe_rows(rows: List[str]) -> List[str]:
    out: List[str] = []
    for row in rows or []:
        text = str(row or "").strip()
        if text and text not in out:
            out.append(text)
    return out



def _dict_change(before: Any, after: Any) -> Dict[str, Any]:
    before_dict = dict(before or {}) if isinstance(before, dict) else {}
    after_dict = dict(after or {}) if isinstance(after, dict) else {}
    changed = []
    for key in sorted(set(before_dict) | set(after_dict)):
        if before_dict.get(key) != after_dict.get(key):
            changed.append({"field": key, "before": before_dict.get(key), "after": after_dict.get(key)})
    return {"count": len(changed), "changes": changed}



def _list_change(before: Any, after: Any) -> Dict[str, Any]:
    before_rows = _dedupe_rows([str(x) for x in (before or [])])
    after_rows = _dedupe_rows([str(x) for x in (after or [])])
    added = [row for row in after_rows if row not in before_rows]
    removed = [row for row in before_rows if row not in after_rows]
    return {"count": len(added) + len(removed), "added": added, "removed": removed}



def _state_change_set(before: Optional[SharedProcessState], after: SharedProcessState) -> Dict[str, Any]:
    if before is None:
        return {
            "created": True,
            "from_revision_id": None,
            "to_revision_id": after.revision_id,
            "world_state": _dict_change({}, after.world_state),
            "runtime_constraints": _dict_change({}, after.runtime_constraints),
            "agent_ownership": _dict_change({}, after.agent_ownership),
            "operator_overrides": _dict_change({}, after.operator_overrides),
            "goals": _list_change([], after.goals),
            "active_plan_node_ids": _list_change([], after.active_plan_node_ids),
            "belief_refs": _list_change([], after.belief_refs),
            "open_questions": _list_change([], after.open_questions),
        }
    return {
        "created": False,
        "from_revision_id": before.revision_id,
        "to_revision_id": after.revision_id,
        "world_state": _dict_change(before.world_state, after.world_state),
        "runtime_constraints": _dict_change(before.runtime_constraints, after.runtime_constraints),
        "agent_ownership": _dict_change(before.agent_ownership, after.agent_ownership),
        "operator_overrides": _dict_change(before.operator_overrides, after.operator_overrides),
        "goals": _list_change(before.goals, after.goals),
        "active_plan_node_ids": _list_change(before.active_plan_node_ids, after.active_plan_node_ids),
        "belief_refs": _list_change(before.belief_refs, after.belief_refs),
        "open_questions": _list_change(before.open_questions, after.open_questions),
    }


class SharedProcessStateStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._thread_lock = threading.RLock()
        self._transaction_state = threading.local()

    def _target(self, process_id: Optional[str] = None) -> Path:
        if self.path.suffix:
            return self.path
        if not process_id:
            raise ValueError("process_id required when store path is a directory")
        return self.path / f"{process_id}.json"

    def _history_target(self, process_id: str) -> Path:
        process_id = str(process_id or "").strip()
        if not process_id:
            raise ValueError("process_id required for history target")
        if self.path.suffix:
            return self.path.with_name(self.path.name + f".{process_id}.history.jsonl")
        return self.path / "history" / f"{process_id}.jsonl"

    def _lock_target(self, process_id: str) -> Path:
        target = self._target(process_id)
        return target.with_name(f".{target.name}.transaction.lock")

    @contextmanager
    def transaction(self, process_id: str):
        """Serialize load/CAS/publish/history across threads and processes."""

        with self._thread_lock:
            active_processes = set(getattr(self._transaction_state, "active_processes", set()))
            if process_id in active_processes:
                yield
                return
            lock_target = self._lock_target(process_id)
            durable_mkdir(lock_target.parent)
            with lock_target.open("a+b") as handle:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                active_processes.add(process_id)
                self._transaction_state.active_processes = active_processes
                try:
                    yield
                finally:
                    active_processes.remove(process_id)
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    @staticmethod
    def _atomic_replace(path: Path, payload: bytes) -> None:
        durable_mkdir(path.parent)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            fsync_directory(path.parent)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def _history_payload(self, record: SharedStateRevisionRecord) -> bytes:
        target = self._history_target(record.process_id)
        return bounded_jsonl_payload(
            target,
            _revision_record_dump_compat(record),
            max_records=MAX_SHARED_STATE_HISTORY_RECORDS,
            max_bytes=MAX_SHARED_STATE_HISTORY_BYTES,
        )

    def history(self, process_id: str) -> List[SharedStateRevisionRecord]:
        target = self._history_target(process_id)
        if not target.exists():
            return []
        return [
            _revision_record_validate_compat(row)
            for row in read_recoverable_jsonl(target)
        ]

    def load(self, process_id: Optional[str] = None) -> Optional[SharedProcessState]:
        target = self._target(process_id)
        if not target.exists():
            return None
        return _model_validate_compat(json.loads(target.read_text(encoding="utf-8")))

    def detect_conflict(self, *, process_id: str, expected_revision_id: Optional[str]) -> Dict[str, Any]:
        current = self.load(process_id)
        expected = str(expected_revision_id or "").strip() or None
        observed = current.revision_id if current else None
        conflict = expected is not None and observed is not None and expected != observed
        return {
            "process_id": process_id,
            "expected_revision_id": expected,
            "observed_revision_id": observed,
            "conflict": conflict,
            "operator_summary": (
                f"shared state conflict for {process_id}: expected {expected}, observed {observed}"
                if conflict
                else f"shared state write accepted for {process_id}: {observed or expected}"
            ),
        }

    def save(
        self,
        state: SharedProcessState | Dict[str, Any],
        *,
        expected_revision_id: Optional[str] = None,
        actor: Optional[str] = None,
        provenance: Optional[Dict[str, Any]] = None,
    ) -> SharedProcessState:
        record = state if isinstance(state, SharedProcessState) else _model_validate_compat(dict(state))
        with self.transaction(record.process_id):
            current = self.load(record.process_id)
            expected = str(expected_revision_id or "").strip() or None
            observed = current.revision_id if current else None
            if expected is not None and observed is not None and expected != observed:
                raise SharedStateConflictError(
                    process_id=record.process_id,
                    expected_revision_id=expected,
                    observed_revision_id=observed,
                )
            target = self._target(record.process_id)
            state_payload = _model_dump_compat(record)
            revision_record = SharedStateRevisionRecord(
                process_id=record.process_id,
                revision_id=record.revision_id,
                parent_revision_id=current.revision_id if current else None,
                actor=str(actor or "").strip() or None,
                provenance=dict(provenance or {}),
                change_set=_state_change_set(current, record),
                state=state_payload,
            )
            state_encoded = encoded_json(state_payload, pretty=True)
            history_target = self._history_target(record.process_id)
            store_root = self.path.parent if self.path.suffix else self.path
            delivery_root = self.path.parent
            with runtime_delivery_quota_transaction(delivery_root):
                assert_process_count(
                    store_root,
                    record.process_id,
                    delivery_root=delivery_root,
                )
                history_payload = self._history_payload(revision_record)
                history_row_bytes = len(encoded_json(_revision_record_dump_compat(revision_record)))
                assert_runtime_delivery_capacity(
                    delivery_root=delivery_root,
                    store_root=store_root,
                    process_id=record.process_id,
                    object_bytes=max(len(state_encoded), history_row_bytes),
                    additional_bytes=len(state_encoded) + len(history_payload),
                    replacements=(
                        (target, len(state_encoded)),
                        (history_target, len(history_payload)),
                    ),
                )
                self._atomic_replace(target, state_encoded)
                self._atomic_replace(history_target, history_payload)
        return record

    def load_revision(self, process_id: str, revision_id: str) -> Optional[SharedProcessState]:
        revision = str(revision_id or "").strip()
        if not revision:
            raise ValueError("revision_id must be non-empty")
        current = self.load(process_id)
        if current and current.revision_id == revision:
            return current
        for row in reversed(self.history(process_id)):
            if row.revision_id == revision:
                return _model_validate_compat(dict(row.state))
        return None

    def rollback(
        self,
        *,
        process_id: str,
        to_revision_id: str,
        actor: Optional[str] = None,
        reason: str = "rollback",
        new_revision_id: Optional[str] = None,
        provenance: Optional[Dict[str, Any]] = None,
    ) -> SharedProcessState:
        with self.transaction(process_id):
            current = self.load(process_id)
            if current is None:
                raise KeyError(f"shared state not found: {process_id}")
            target = self.load_revision(process_id, to_revision_id)
            if target is None:
                raise KeyError(f"shared state revision not found: {process_id}:{to_revision_id}")
            rollback_revision_id = str(new_revision_id or f"{to_revision_id}_rollback").strip()
            rolled = SharedProcessState(
                process_id=target.process_id,
                revision_id=rollback_revision_id,
                goals=list(target.goals),
                active_plan_node_ids=list(target.active_plan_node_ids),
                open_decisions=list(target.open_decisions),
                runtime_constraints=dict(target.runtime_constraints),
                world_state=dict(target.world_state),
                belief_refs=list(target.belief_refs),
                open_questions=list(target.open_questions),
                agent_ownership=dict(target.agent_ownership),
                operator_overrides=dict(target.operator_overrides),
                metadata={
                    **dict(target.metadata),
                    "rollback_from_revision_id": current.revision_id,
                    "rollback_to_revision_id": target.revision_id,
                    "rollback_reason": str(reason or "rollback").strip() or "rollback",
                    **(
                        {
                            "rollback_transaction_id": str((provenance or {}).get("rollback_transaction_id") or ""),
                            "rollback_fencepost_id": str((provenance or {}).get("fencepost_id") or ""),
                        }
                        if (provenance or {}).get("rollback_transaction_id")
                        else {}
                    ),
                },
            )
            return self.save(
                rolled,
                expected_revision_id=current.revision_id,
                actor=actor,
                provenance={**dict(provenance or {}), "rollback": True, "to_revision_id": target.revision_id},
            )


__all__ = [
    "OpenDecision",
    "SharedProcessState",
    "SharedProcessStateStore",
    "SharedStateConflictError",
    "SharedStateRevisionRecord",
    "ValidationError",
]
