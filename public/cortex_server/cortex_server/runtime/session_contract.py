from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


JsonDict = Dict[str, Any]


_EVENT_MAP = {
    "started": "session.started",
    "session.started": "session.started",
    "agent.started": "session.started",
    "finished": "session.finished",
    "session.finished": "session.finished",
    "agent.finished": "session.finished",
    "failed": "session.failed",
    "session.failed": "session.failed",
    "agent.failed": "session.failed",
    "tool.failed": "session.failed",
    "pull-request.failed": "session.failed",
    "blocked": "session.blocked",
    "session.blocked": "session.blocked",
    "question.requested": "session.blocked",
    "session.idle": "session.blocked",
    "retry-needed": "session.retry-needed",
    "session.retry-needed": "session.retry-needed",
    "pr-created": "session.pr-created",
    "session.pr-created": "session.pr-created",
    "pull-request.created": "session.pr-created",
    "test-started": "session.test-started",
    "session.test-started": "session.test-started",
    "test.started": "session.test-started",
    "test-finished": "session.test-finished",
    "session.test-finished": "session.test-finished",
    "test.finished": "session.test-finished",
    "test-failed": "session.test-failed",
    "session.test-failed": "session.test-failed",
    "test.failed": "session.test-failed",
    "handoff-needed": "session.handoff-needed",
    "session.handoff-needed": "session.handoff-needed",
    "heartbeat": "session.heartbeat",
    "session.heartbeat": "session.heartbeat",
    "stale": "session.stale",
    "session.stale": "session.stale",
    "workspace.changed": "session.workspace-changed",
    "session.workspace-changed": "session.workspace-changed",
}


def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"


def _event_id() -> str:
    return f"sessevt_{uuid4().hex[:16]}"


def _normalize_raw_event_name(raw_event: str) -> str:
    text = str(raw_event or "").strip()
    if not text:
        raise ValueError("raw_event must be non-empty")
    return _EVENT_MAP.get(text, text if text.startswith("session.") else "session.custom")


class CanonicalSessionEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(default_factory=_event_id)
    process_id: str
    raw_event: str
    kind: str
    ts: str = Field(default_factory=_now_iso)
    tool: Optional[str] = None
    session_id: Optional[str] = None
    session_name: Optional[str] = None
    summary: Optional[str] = None
    status: Optional[str] = None
    operator_summary: str
    payload: JsonDict = Field(default_factory=dict)

    @field_validator("event_id", "process_id", "raw_event", "kind", "ts", "operator_summary")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("ts")
    @classmethod
    def _validate_ts(cls, value: str) -> str:
        text = str(value or "").strip()
        try:
            datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("timestamp must be ISO-8601") from exc
        return text


class SessionIngressEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_id: str
    event: str
    tool: Optional[str] = None
    session_id: Optional[str] = None
    session_name: Optional[str] = None
    summary: Optional[str] = None
    status: Optional[str] = None
    payload: JsonDict = Field(default_factory=dict)

    @field_validator("process_id", "event")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text


def compile_operator_summary(event: CanonicalSessionEvent) -> str:
    tool = str(event.tool or "session").strip() or "session"
    session_name = str(event.session_name or event.session_id or event.process_id).strip()
    summary = str(event.summary or "").strip()
    status = str(event.status or "").strip()
    kind_tail = event.kind.split("session.", 1)[-1]
    descriptor = kind_tail.replace("-", " ")
    base = f"{tool}:{session_name} {descriptor}"
    if summary:
        return f"{base} — {summary}"
    if status:
        return f"{base} ({status})"
    return base


def normalize_session_event(
    process_id: str,
    raw_event: str,
    *,
    tool: Optional[str] = None,
    session_id: Optional[str] = None,
    session_name: Optional[str] = None,
    summary: Optional[str] = None,
    status: Optional[str] = None,
    payload: Optional[JsonDict] = None,
) -> CanonicalSessionEvent:
    canonical_kind = _normalize_raw_event_name(raw_event)
    merged_payload = dict(payload or {})
    merged_payload.setdefault("raw_event", str(raw_event or "").strip())
    merged_payload.setdefault("contract_event", canonical_kind)
    if tool is not None:
        merged_payload.setdefault("tool", tool)
    if session_id is not None:
        merged_payload.setdefault("session_id", session_id)
    if session_name is not None:
        merged_payload.setdefault("session_name", session_name)
    if summary is not None:
        merged_payload.setdefault("summary", summary)
    if status is not None:
        merged_payload.setdefault("status", status)

    event = CanonicalSessionEvent(
        process_id=str(process_id or "").strip(),
        raw_event=str(raw_event or "").strip(),
        kind=canonical_kind,
        tool=str(tool or "").strip() or None,
        session_id=str(session_id or "").strip() or None,
        session_name=str(session_name or "").strip() or None,
        summary=str(summary or "").strip() or None,
        status=str(status or "").strip() or None,
        operator_summary="pending",
        payload=merged_payload,
    )
    event.operator_summary = compile_operator_summary(event)
    return event


__all__ = [
    "CanonicalSessionEvent",
    "SessionIngressEvent",
    "ValidationError",
    "compile_operator_summary",
    "normalize_session_event",
]
