from __future__ import annotations

import fcntl
import json
import os
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator



def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"



def _snapshot_id() -> str:
    return f"snap_{uuid4().hex[:16]}"


class ProcessSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    snapshot_id: str = Field(default_factory=_snapshot_id)
    process_id: str
    ts: str = Field(default_factory=_now_iso)
    last_event_id: Optional[str] = None
    event_count: int = 0
    persistence_revision: int = 0
    lifecycle_state: str = "created"
    active_steps: List[str] = Field(default_factory=list)
    waiting_steps: List[str] = Field(default_factory=list)
    completed_steps: List[str] = Field(default_factory=list)
    failed_steps: List[str] = Field(default_factory=list)
    assigned_agents: Dict[str, str] = Field(default_factory=dict)
    runtime_policy: Dict[str, Any] = Field(default_factory=dict)
    session_state: Dict[str, Any] = Field(default_factory=dict)
    world_state: Dict[str, Any] = Field(default_factory=dict)
    belief_refs: List[str] = Field(default_factory=list)
    artifact_refs: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("snapshot_id", "process_id", "lifecycle_state")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value

    @field_validator("ts")
    @classmethod
    def _validate_timestamp(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("timestamp must be non-empty")
        try:
            datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("timestamp must be ISO-8601") from exc
        return text

    @field_validator("event_count", "persistence_revision")
    @classmethod
    def _validate_event_count(cls, value: int) -> int:
        value = int(value or 0)
        if value < 0:
            raise ValueError("snapshot counters must be non-negative")
        return value



def _model_validate_compat(data: Dict[str, Any]) -> ProcessSnapshot:
    if hasattr(ProcessSnapshot, "model_validate"):
        return ProcessSnapshot.model_validate(data)
    return ProcessSnapshot.parse_obj(data)



def _model_dump_compat(model: ProcessSnapshot) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


class ProcessSnapshotStore:
    _thread_state = threading.local()

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _target(self, process_id: Optional[str] = None) -> Path:
        if self.path.suffix:
            return self.path
        if not process_id:
            raise ValueError("process_id required when store path is a directory")
        return self.path / f"{process_id}.json"

    def _lock_target(self, process_id: str) -> Path:
        target = self._target(process_id)
        return target.with_name(f".{target.name}.lock")

    @contextmanager
    def transaction(self, process_id: str):
        process = str(process_id or "").strip()
        if not process:
            raise ValueError("process_id must be non-empty")
        lock_target = self._lock_target(process)
        key = str(lock_target.resolve())
        active = dict(getattr(self._thread_state, "active", {}))
        if active.get(key, 0):
            active[key] += 1
            self._thread_state.active = active
            try:
                yield
            finally:
                active[key] -= 1
                self._thread_state.active = active
            return
        lock_target.parent.mkdir(parents=True, exist_ok=True)
        with lock_target.open("a+b") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            active[key] = 1
            self._thread_state.active = active
            try:
                yield
            finally:
                active.pop(key, None)
                self._thread_state.active = active
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    @staticmethod
    def _atomic_replace(path: Path, payload: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            directory_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def save(
        self,
        snapshot: ProcessSnapshot | Dict[str, Any],
        *,
        expected_persistence_revision: Optional[int] = None,
    ) -> ProcessSnapshot:
        record = snapshot if isinstance(snapshot, ProcessSnapshot) else _model_validate_compat(dict(snapshot))
        target = self._target(record.process_id)
        with self.transaction(record.process_id):
            current = self.load(record.process_id)
            observed = int(current.persistence_revision if current else 0)
            expected = int(record.persistence_revision if expected_persistence_revision is None else expected_persistence_revision)
            if observed != expected:
                raise RuntimeError(
                    f"snapshot persistence conflict for {record.process_id}: expected {expected}, observed {observed}"
                )
            payload = _model_dump_compat(record)
            payload["persistence_revision"] = observed + 1
            committed = _model_validate_compat(payload)
            self._atomic_replace(
                target,
                (json.dumps(_model_dump_compat(committed), sort_keys=True, indent=2) + "\n").encode("utf-8"),
            )
            return committed

    def load(self, process_id: Optional[str] = None) -> Optional[ProcessSnapshot]:
        target = self._target(process_id)
        if not target.exists():
            return None
        return _model_validate_compat(json.loads(target.read_text(encoding="utf-8")))


__all__ = ["ProcessSnapshot", "ProcessSnapshotStore", "ValidationError"]
