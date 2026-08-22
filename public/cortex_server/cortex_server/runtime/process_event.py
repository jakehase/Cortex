from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator



def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"



def _event_id() -> str:
    return f"evt_{uuid4().hex[:16]}"


class ProcessEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(default_factory=_event_id)
    process_id: str
    ts: str = Field(default_factory=_now_iso)
    kind: str
    causal_parent_ids: List[str] = Field(default_factory=list)
    actor: Optional[str] = None
    revision_id: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("event_id", "process_id", "kind")
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

    @field_validator("causal_parent_ids")
    @classmethod
    def _validate_parent_ids(cls, value: List[str]) -> List[str]:
        rows = [str(row or "").strip() for row in (value or [])]
        if any(not row for row in rows):
            raise ValueError("causal_parent_ids must not contain empty values")
        return rows


__all__ = ["ProcessEvent", "ValidationError"]
