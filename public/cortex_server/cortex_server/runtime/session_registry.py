from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from cortex_server.runtime.session_contract import CanonicalSessionEvent


JsonDict = Dict[str, Any]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parse_ts(value: Optional[str]) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


class SessionRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_id: str
    session_id: str
    session_name: Optional[str] = None
    tool: Optional[str] = None
    status: str = "registered"
    source: str = "runtime"
    stale_after_seconds: int = 900
    registered_at: str = Field(default_factory=_now_iso)
    last_event_kind: Optional[str] = None
    last_event_at: Optional[str] = None
    heartbeat_at: Optional[str] = None
    blocked_reason: Optional[str] = None
    retry_count: int = 0
    open_questions: List[str] = Field(default_factory=list)
    watcher_ids: List[str] = Field(default_factory=list)
    parent_process: Optional[JsonDict] = None
    metadata: JsonDict = Field(default_factory=dict)

    @field_validator("process_id", "session_id", "status", "source", "registered_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text


class SessionRegistryStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _load_all(self) -> List[SessionRecord]:
        if not self.path.exists():
            return []
        data = json.loads(self.path.read_text(encoding="utf-8"))
        rows = data if isinstance(data, list) else []
        out: List[SessionRecord] = []
        for row in rows:
            if isinstance(row, dict):
                if hasattr(SessionRecord, "model_validate"):
                    out.append(SessionRecord.model_validate(row))
                else:
                    out.append(SessionRecord.parse_obj(row))
        return out

    def _write_all(self, rows: List[SessionRecord]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = [(row.model_dump() if hasattr(row, "model_dump") else row.dict()) for row in rows]
        self.path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    def _find(self, rows: List[SessionRecord], *, process_id: str, session_id: str) -> Optional[SessionRecord]:
        for row in rows:
            if row.process_id == process_id and row.session_id == session_id:
                return row
        return None

    def register(
        self,
        *,
        process_id: str,
        session_id: str,
        session_name: Optional[str] = None,
        tool: Optional[str] = None,
        source: str = "runtime",
        stale_after_seconds: Optional[int] = None,
        parent_process: Optional[JsonDict] = None,
        metadata: Optional[JsonDict] = None,
    ) -> SessionRecord:
        rows = self._load_all()
        existing = self._find(rows, process_id=process_id, session_id=session_id)
        if existing is not None:
            if session_name:
                existing.session_name = session_name
            if tool:
                existing.tool = tool
            existing.source = source or existing.source
            if stale_after_seconds is not None:
                existing.stale_after_seconds = max(1, int(stale_after_seconds))
            if parent_process is not None:
                existing.parent_process = dict(parent_process)
            if metadata:
                existing.metadata = {**dict(existing.metadata or {}), **dict(metadata)}
            self._write_all(rows)
            return existing
        record = SessionRecord(
            process_id=process_id,
            session_id=session_id,
            session_name=session_name,
            tool=tool,
            source=source,
            stale_after_seconds=max(1, int(stale_after_seconds or 900)),
            heartbeat_at=_now_iso(),
            parent_process=dict(parent_process or {}) or None,
            metadata=dict(metadata or {}),
        )
        rows.append(record)
        self._write_all(rows)
        return record

    def get(self, *, process_id: str, session_id: str) -> Optional[SessionRecord]:
        rows = self._load_all()
        return self._find(rows, process_id=process_id, session_id=session_id)

    def list(self, *, process_id: Optional[str] = None) -> List[SessionRecord]:
        rows = self._load_all()
        out = [row for row in rows if not process_id or row.process_id == process_id]
        out.sort(key=lambda row: (row.process_id, row.session_id))
        return out

    def heartbeat(self, *, process_id: str, session_id: str, stale_after_seconds: Optional[int] = None) -> SessionRecord:
        rows = self._load_all()
        record = self._find(rows, process_id=process_id, session_id=session_id)
        if record is None:
            record = self.register(process_id=process_id, session_id=session_id, stale_after_seconds=stale_after_seconds or 900)
            rows = self._load_all()
            record = self._find(rows, process_id=process_id, session_id=session_id)
        record.heartbeat_at = _now_iso()
        if stale_after_seconds is not None:
            record.stale_after_seconds = max(1, int(stale_after_seconds))
        if record.status == "stale":
            record.status = "running"
        self._write_all(rows)
        return record

    def attach_watcher(self, *, process_id: str, session_id: str, watcher_id: str) -> SessionRecord:
        rows = self._load_all()
        record = self._find(rows, process_id=process_id, session_id=session_id)
        if record is None:
            raise KeyError(f"session not found: {process_id}/{session_id}")
        if watcher_id not in record.watcher_ids:
            record.watcher_ids.append(watcher_id)
        self._write_all(rows)
        return record

    def apply_event(self, event: CanonicalSessionEvent) -> SessionRecord:
        session_id = str(event.session_id or event.process_id).strip()
        record = self.register(
            process_id=event.process_id,
            session_id=session_id,
            session_name=event.session_name,
            tool=event.tool,
            metadata={"last_operator_summary": event.operator_summary},
        )
        rows = self._load_all()
        current = self._find(rows, process_id=event.process_id, session_id=session_id)
        assert current is not None
        current.last_event_kind = event.kind
        current.last_event_at = event.ts
        current.heartbeat_at = event.ts
        if event.session_name:
            current.session_name = event.session_name
        if event.tool:
            current.tool = event.tool
        summary = str(event.summary or event.payload.get("summary") or "").strip() or None
        if event.kind == "session.started":
            current.status = "running"
            current.blocked_reason = None
        elif event.kind == "session.finished":
            current.status = "finished"
            current.blocked_reason = None
        elif event.kind == "session.failed":
            current.status = "failed"
            current.blocked_reason = summary
        elif event.kind == "session.blocked":
            current.status = "blocked"
            current.blocked_reason = summary or current.blocked_reason
            if summary and summary not in current.open_questions:
                current.open_questions.append(summary)
        elif event.kind == "session.retry-needed":
            current.status = "retry-needed"
            current.retry_count = int(current.retry_count or 0) + 1
            current.blocked_reason = summary or current.blocked_reason
        elif event.kind == "session.handoff-needed":
            current.status = "handoff-needed"
            if summary and summary not in current.open_questions:
                current.open_questions.append(summary)
        elif event.kind == "session.test-started":
            current.status = "testing"
        elif event.kind == "session.test-finished":
            current.status = "running"
        elif event.kind == "session.test-failed":
            current.status = "test-failed"
            current.blocked_reason = summary or current.blocked_reason
        elif event.kind == "session.stale":
            current.status = "stale"
            current.blocked_reason = summary or "session heartbeat expired"
        elif event.kind == "session.heartbeat":
            if current.status in {"registered", "stale"}:
                current.status = "running"
        elif event.kind == "session.workspace-changed":
            if current.status == "registered":
                current.status = "running"
        current.metadata = {**dict(current.metadata or {}), "last_operator_summary": event.operator_summary}
        self._write_all(rows)
        return current

    def detect_stale(self, *, now: Optional[datetime] = None) -> List[SessionRecord]:
        now_dt = now or _now()
        rows = self._load_all()
        stale_rows: List[SessionRecord] = []
        changed = False
        for row in rows:
            if row.status in {"finished", "failed"}:
                continue
            heartbeat_at = _parse_ts(row.heartbeat_at or row.last_event_at or row.registered_at)
            if heartbeat_at is None:
                continue
            if heartbeat_at + timedelta(seconds=max(1, int(row.stale_after_seconds or 900))) <= now_dt:
                if row.status != "stale":
                    row.status = "stale"
                    row.blocked_reason = row.blocked_reason or "session heartbeat expired"
                    changed = True
                stale_rows.append(row)
        if changed:
            self._write_all(rows)
        return stale_rows


__all__ = ["SessionRecord", "SessionRegistryStore", "ValidationError"]
