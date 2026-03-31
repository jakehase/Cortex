from __future__ import annotations

import json
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
    lifecycle_state: str = "created"
    active_steps: List[str] = Field(default_factory=list)
    waiting_steps: List[str] = Field(default_factory=list)
    completed_steps: List[str] = Field(default_factory=list)
    failed_steps: List[str] = Field(default_factory=list)
    assigned_agents: Dict[str, str] = Field(default_factory=dict)
    runtime_policy: Dict[str, Any] = Field(default_factory=dict)
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

    @field_validator("event_count")
    @classmethod
    def _validate_event_count(cls, value: int) -> int:
        value = int(value or 0)
        if value < 0:
            raise ValueError("event_count must be non-negative")
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
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _target(self, process_id: Optional[str] = None) -> Path:
        if self.path.suffix:
            return self.path
        if not process_id:
            raise ValueError("process_id required when store path is a directory")
        return self.path / f"{process_id}.json"

    def save(self, snapshot: ProcessSnapshot | Dict[str, Any]) -> ProcessSnapshot:
        record = snapshot if isinstance(snapshot, ProcessSnapshot) else _model_validate_compat(dict(snapshot))
        target = self._target(record.process_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(_model_dump_compat(record), sort_keys=True, indent=2) + "\n", encoding="utf-8")
        return record

    def load(self, process_id: Optional[str] = None) -> Optional[ProcessSnapshot]:
        target = self._target(process_id)
        if not target.exists():
            return None
        return _model_validate_compat(json.loads(target.read_text(encoding="utf-8")))


__all__ = ["ProcessSnapshot", "ProcessSnapshotStore", "ValidationError"]
