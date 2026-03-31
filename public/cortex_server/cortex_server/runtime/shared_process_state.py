from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator



def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"



def _state_id() -> str:
    return f"state_{uuid4().hex[:16]}"


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



def _model_validate_compat(data: Dict[str, Any]) -> SharedProcessState:
    if hasattr(SharedProcessState, "model_validate"):
        return SharedProcessState.model_validate(data)
    return SharedProcessState.parse_obj(data)



def _model_dump_compat(model: SharedProcessState) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


class SharedProcessStateStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _target(self, process_id: Optional[str] = None) -> Path:
        if self.path.suffix:
            return self.path
        if not process_id:
            raise ValueError("process_id required when store path is a directory")
        return self.path / f"{process_id}.json"

    def save(self, state: SharedProcessState | Dict[str, Any]) -> SharedProcessState:
        record = state if isinstance(state, SharedProcessState) else _model_validate_compat(dict(state))
        target = self._target(record.process_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(_model_dump_compat(record), sort_keys=True, indent=2) + "\n", encoding="utf-8")
        return record

    def load(self, process_id: Optional[str] = None) -> Optional[SharedProcessState]:
        target = self._target(process_id)
        if not target.exists():
            return None
        return _model_validate_compat(json.loads(target.read_text(encoding="utf-8")))


__all__ = [
    "OpenDecision",
    "SharedProcessState",
    "SharedProcessStateStore",
    "ValidationError",
]
