from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator



def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"



def _message_id() -> str:
    return f"msg_{uuid4().hex[:16]}"


class AgentMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: str = Field(default_factory=_message_id)
    process_id: str
    from_agent: str
    to_agent: str
    kind: str = "handoff"
    payload: Dict[str, Any] = Field(default_factory=dict)
    causal_parent_ids: List[str] = Field(default_factory=list)
    handoff_id: Optional[str] = None
    revision_id: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    delivery_status: str = "queued"
    attempt_count: int = 0
    last_attempt_at: Optional[str] = None
    acked_at: Optional[str] = None
    dead_lettered_at: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("message_id", "process_id", "from_agent", "to_agent", "kind", "delivery_status")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value

    @field_validator("created_at", "last_attempt_at", "acked_at", "dead_lettered_at")
    @classmethod
    def _validate_timestamp(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = str(value or "").strip()
        if not text:
            raise ValueError("timestamp must be non-empty when provided")
        try:
            datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("timestamp must be ISO-8601") from exc
        return text

    @field_validator("causal_parent_ids")
    @classmethod
    def _validate_parent_ids(cls, rows: List[str]) -> List[str]:
        cleaned = [str(row or "").strip() for row in (rows or [])]
        if any(not row for row in cleaned):
            raise ValueError("causal_parent_ids must not contain empty values")
        return cleaned

    @field_validator("attempt_count")
    @classmethod
    def _validate_attempt_count(cls, value: int) -> int:
        value = int(value or 0)
        if value < 0:
            raise ValueError("attempt_count must be non-negative")
        return value



def _model_validate_compat(data: Dict[str, Any]) -> AgentMessage:
    if hasattr(AgentMessage, "model_validate"):
        return AgentMessage.model_validate(data)
    return AgentMessage.parse_obj(data)



def _model_dump_compat(model: AgentMessage) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


class AgentMailbox:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _read_all(self) -> List[AgentMessage]:
        if not self.path.exists():
            return []
        data = json.loads(self.path.read_text(encoding="utf-8"))
        rows = data if isinstance(data, list) else []
        return [_model_validate_compat(dict(row)) for row in rows if isinstance(row, dict)]

    def _write_all(self, rows: List[AgentMessage]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = [_model_dump_compat(row) for row in rows]
        self.path.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8")

    def send(self, message: Optional[AgentMessage | Dict[str, Any]] = None, **kwargs: Any) -> AgentMessage:
        if isinstance(message, AgentMessage):
            if kwargs:
                raise TypeError("cannot pass both message and keyword fields")
            record = message
        elif isinstance(message, dict):
            if kwargs:
                raise TypeError("cannot pass both message mapping and keyword fields")
            record = _model_validate_compat(message)
        else:
            record = AgentMessage(**kwargs)
        rows = self._read_all()
        rows.append(record)
        self._write_all(rows)
        return record

    def list(
        self,
        *,
        process_id: Optional[str] = None,
        to_agent: Optional[str] = None,
        from_agent: Optional[str] = None,
        delivery_statuses: Optional[Sequence[str]] = None,
    ) -> List[AgentMessage]:
        rows = self._read_all()
        allowed = {str(x).strip() for x in (delivery_statuses or []) if str(x).strip()}
        filtered: List[AgentMessage] = []
        for row in rows:
            if process_id and row.process_id != process_id:
                continue
            if to_agent and row.to_agent != to_agent:
                continue
            if from_agent and row.from_agent != from_agent:
                continue
            if allowed and row.delivery_status not in allowed:
                continue
            filtered.append(row)
        return filtered

    def receive(
        self,
        *,
        to_agent: str,
        process_id: Optional[str] = None,
        include_inflight: bool = False,
        expected_revision_id: Optional[str] = None,
        reject_stale_revision: bool = False,
    ) -> List[AgentMessage]:
        claimable_statuses = ["queued"] + (["inflight"] if include_inflight else [])
        rows = self.list(process_id=process_id, to_agent=to_agent, delivery_statuses=claimable_statuses)
        updated = self._read_all()
        by_id = {row.message_id: row for row in updated}
        now = _now_iso()
        expected = str(expected_revision_id or "").strip() or None
        for row in rows:
            stored = by_id.get(row.message_id)
            if not stored:
                continue
            observed = str(stored.revision_id or "").strip() or None
            stale_revision = bool(expected and observed and observed != expected)
            if stale_revision:
                metadata = dict(stored.metadata or {})
                metadata.update(
                    {
                        "rejection_reason": "stale_revision",
                        "expected_revision_id": expected,
                        "observed_revision_id": observed,
                    }
                )
                stored.metadata = metadata
                if reject_stale_revision and stored.delivery_status != "dead_letter":
                    stored.delivery_status = "dead_letter"
                    stored.dead_lettered_at = now
                continue
            if stored.delivery_status == "queued":
                stored.delivery_status = "inflight"
                stored.attempt_count += 1
                stored.last_attempt_at = now
        self._write_all(list(by_id.values()))
        accepted = self.list(process_id=process_id, to_agent=to_agent, delivery_statuses=["inflight"])
        if expected:
            accepted = [row for row in accepted if not row.revision_id or str(row.revision_id).strip() == expected]
        return accepted

    def _mutate(self, message_id: str, mutate_fn) -> AgentMessage:
        rows = self._read_all()
        for row in rows:
            if row.message_id == message_id:
                mutate_fn(row)
                self._write_all(rows)
                return row
        raise KeyError(f"message not found: {message_id}")

    def acknowledge(self, message_id: str) -> AgentMessage:
        now = _now_iso()
        return self._mutate(message_id, lambda row: (setattr(row, "delivery_status", "acked"), setattr(row, "acked_at", now)))

    def retry(self, message_id: str) -> AgentMessage:
        return self._mutate(message_id, lambda row: (setattr(row, "delivery_status", "queued"), setattr(row, "dead_lettered_at", None)))

    def dead_letter(self, message_id: str) -> AgentMessage:
        now = _now_iso()
        return self._mutate(message_id, lambda row: (setattr(row, "delivery_status", "dead_letter"), setattr(row, "dead_lettered_at", now)))


__all__ = ["AgentMailbox", "AgentMessage", "ValidationError"]
