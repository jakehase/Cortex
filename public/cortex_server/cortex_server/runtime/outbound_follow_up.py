from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


JsonDict = Dict[str, Any]



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")



def _dispatch_id() -> str:
    return f"followup_{uuid4().hex[:16]}"


class RuntimeFollowUpDispatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dispatch_id: str = Field(default_factory=_dispatch_id)
    process_id: str
    runtime_kind: str
    fingerprint: str
    update_kind: str
    title: str
    message: str
    status: str
    channel: Optional[str] = None
    owner: Optional[str] = None
    session_key: Optional[str] = None
    conversation_id: Optional[str] = None
    objective: Optional[str] = None
    report_id: Optional[str] = None
    due_at: Optional[str] = None
    summary: Optional[str] = None
    delivery_status: str = "queued"
    attempt_count: int = 0
    created_at: str = Field(default_factory=_now_iso)
    last_attempt_at: Optional[str] = None
    sent_at: Optional[str] = None
    last_error: Optional[str] = None
    metadata: JsonDict = Field(default_factory=dict)

    @field_validator(
        "dispatch_id",
        "process_id",
        "runtime_kind",
        "fingerprint",
        "update_kind",
        "title",
        "message",
        "status",
        "delivery_status",
    )
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("attempt_count")
    @classmethod
    def _validate_attempt_count(cls, value: int) -> int:
        number = int(value or 0)
        if number < 0:
            raise ValueError("attempt_count must be non-negative")
        return number

    @field_validator("created_at", "last_attempt_at", "sent_at", "due_at")
    @classmethod
    def _validate_timestamp(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = str(value or "").strip()
        if not text:
            raise ValueError("timestamp must be non-empty when provided")
        datetime.fromisoformat(text.replace("Z", "+00:00"))
        return text



def _model_validate_compat(data: JsonDict) -> RuntimeFollowUpDispatch:
    if hasattr(RuntimeFollowUpDispatch, "model_validate"):
        return RuntimeFollowUpDispatch.model_validate(data)
    return RuntimeFollowUpDispatch.parse_obj(data)



def _model_dump_compat(model: RuntimeFollowUpDispatch) -> JsonDict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


class RuntimeFollowUpStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _read_all(self) -> List[RuntimeFollowUpDispatch]:
        if not self.path.exists():
            return []
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        rows = payload if isinstance(payload, list) else []
        return [_model_validate_compat(dict(row)) for row in rows if isinstance(row, dict)]

    def _write_all(self, rows: List[RuntimeFollowUpDispatch]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = [_model_dump_compat(row) for row in rows]
        self.path.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8")

    def enqueue(self, record: RuntimeFollowUpDispatch | JsonDict) -> RuntimeFollowUpDispatch:
        dispatch = record if isinstance(record, RuntimeFollowUpDispatch) else _model_validate_compat(record)
        rows = self._read_all()
        for row in rows:
            if row.process_id == dispatch.process_id and row.runtime_kind == dispatch.runtime_kind and row.fingerprint == dispatch.fingerprint:
                return row
        rows.append(dispatch)
        self._write_all(rows)
        return dispatch

    def list(
        self,
        *,
        process_id: Optional[str] = None,
        runtime_kind: Optional[str] = None,
        delivery_statuses: Optional[Sequence[str]] = None,
    ) -> List[RuntimeFollowUpDispatch]:
        rows = self._read_all()
        allowed = {str(row or "").strip() for row in (delivery_statuses or []) if str(row or "").strip()}
        filtered: List[RuntimeFollowUpDispatch] = []
        for row in rows:
            if process_id and row.process_id != process_id:
                continue
            if runtime_kind and row.runtime_kind != runtime_kind:
                continue
            if allowed and row.delivery_status not in allowed:
                continue
            filtered.append(row)
        return filtered

    def get_by_fingerprint(self, *, process_id: str, runtime_kind: str, fingerprint: str) -> Optional[RuntimeFollowUpDispatch]:
        for row in self._read_all():
            if row.process_id == process_id and row.runtime_kind == runtime_kind and row.fingerprint == fingerprint:
                return row
        return None

    def _mutate(self, dispatch_id: str, mutate_fn) -> RuntimeFollowUpDispatch:
        rows = self._read_all()
        for row in rows:
            if row.dispatch_id == dispatch_id:
                mutate_fn(row)
                self._write_all(rows)
                return row
        raise KeyError(f"dispatch not found: {dispatch_id}")

    def mark_sent(self, dispatch_id: str, *, when_iso: Optional[str] = None) -> RuntimeFollowUpDispatch:
        now_iso = str(when_iso or _now_iso())

        def _mark(row: RuntimeFollowUpDispatch) -> None:
            row.delivery_status = "sent"
            row.attempt_count = int(row.attempt_count or 0) + 1
            row.last_attempt_at = now_iso
            row.sent_at = now_iso
            row.last_error = None

        return self._mutate(dispatch_id, _mark)

    def mark_failed(self, dispatch_id: str, *, error: str, when_iso: Optional[str] = None) -> RuntimeFollowUpDispatch:
        now_iso = str(when_iso or _now_iso())
        text = str(error or "send_failed").strip() or "send_failed"

        def _mark(row: RuntimeFollowUpDispatch) -> None:
            row.delivery_status = "failed"
            row.attempt_count = int(row.attempt_count or 0) + 1
            row.last_attempt_at = now_iso
            row.last_error = text

        return self._mutate(dispatch_id, _mark)

    def mark_skipped(self, dispatch_id: str, *, reason: str, when_iso: Optional[str] = None) -> RuntimeFollowUpDispatch:
        now_iso = str(when_iso or _now_iso())
        text = str(reason or "skipped").strip() or "skipped"

        def _mark(row: RuntimeFollowUpDispatch) -> None:
            row.delivery_status = "skipped"
            row.last_attempt_at = now_iso
            row.last_error = text

        return self._mutate(dispatch_id, _mark)
