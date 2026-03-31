from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator



def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"



def _handoff_id() -> str:
    return f"handoff_{uuid4().hex[:16]}"


class HandoffEvidenceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ref_id: str
    kind: str = "evidence"
    summary: Optional[str] = None
    confidence: Optional[float] = None
    provenance: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("ref_id", "kind")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value


class HandoffArtifactRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    artifact_id: str
    path: Optional[str] = None
    kind: str = "artifact"
    summary: Optional[str] = None

    @field_validator("artifact_id", "kind")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value


class HandoffContract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    handoff_id: str = Field(default_factory=_handoff_id)
    process_id: str
    from_agent: str
    to_agent: str
    source_revision: str
    objective: str
    scope: str = "task"
    assumptions: List[str] = Field(default_factory=list)
    relevant_evidence: List[HandoffEvidenceRef] = Field(default_factory=list)
    relevant_artifacts: List[HandoffArtifactRef] = Field(default_factory=list)
    open_questions: List[str] = Field(default_factory=list)
    expected_output: str
    timeout_seconds: Optional[int] = None
    lease_seconds: Optional[int] = None
    created_at: str = Field(default_factory=_now_iso)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator(
        "handoff_id",
        "process_id",
        "from_agent",
        "to_agent",
        "source_revision",
        "objective",
        "scope",
        "expected_output",
    )
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value

    @field_validator("created_at")
    @classmethod
    def _validate_created_at(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("created_at must be non-empty")
        try:
            datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("created_at must be ISO-8601") from exc
        return text

    @field_validator("assumptions", "open_questions")
    @classmethod
    def _validate_text_rows(cls, rows: List[str]) -> List[str]:
        cleaned = [str(row or "").strip() for row in (rows or [])]
        if any(not row for row in cleaned):
            raise ValueError("list values must not be empty")
        return cleaned

    @field_validator("timeout_seconds", "lease_seconds")
    @classmethod
    def _validate_durations(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            return None
        value = int(value)
        if value <= 0:
            raise ValueError("duration values must be positive")
        return value


__all__ = [
    "HandoffArtifactRef",
    "HandoffContract",
    "HandoffEvidenceRef",
    "ValidationError",
]
