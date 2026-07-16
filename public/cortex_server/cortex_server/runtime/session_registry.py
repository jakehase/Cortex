from __future__ import annotations

import json
import os
import fcntl
import threading
from contextlib import contextmanager
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
    def __init__(self, path: str | Path, *, max_sessions: int = 1000, max_questions: int = 50, max_question_bytes: int = 8192, max_metadata_bytes: int = 65536, max_state_bytes: int = 4_000_000):
        self.path = Path(path)
        self.max_sessions = max(1, int(max_sessions)); self.max_questions = max(1, int(max_questions))
        self.max_question_bytes = max(1, int(max_question_bytes)); self.max_metadata_bytes = max(2, int(max_metadata_bytes))
        self.max_state_bytes = max(1024, int(max_state_bytes)); self._mutex = threading.RLock(); self._lock_depth = 0

    @contextmanager
    def _transaction(self):
        with self._mutex:
            if self._lock_depth:
                self._lock_depth += 1
                try: yield
                finally: self._lock_depth -= 1
                return
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.with_suffix(self.path.suffix + ".lock").open("a+b") as handle:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX); self._lock_depth = 1
                try: yield
                finally: self._lock_depth = 0

    def _load_all(self) -> List[SessionRecord]:
        if not self.path.exists():
            return []
        with self.path.open("rb") as handle:
            raw = handle.read(self.max_state_bytes + 1)
        if len(raw) > self.max_state_bytes: raise ValueError("session registry exceeds size limit")
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, list): raise ValueError("session registry state must be a list")
        if len(data) > self.max_sessions: raise ValueError("session registry record count exceeds limit")
        rows = data
        out: List[SessionRecord] = []
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError("session registry entries must be objects")
            self._validate_persisted_row(row)
            if hasattr(SessionRecord, "model_validate"):
                out.append(SessionRecord.model_validate(row))
            else:
                out.append(SessionRecord.parse_obj(row))
        return out

    def _validate_persisted_row(self, row: JsonDict) -> None:
        string_fields = {"process_id", "session_id", "status", "source", "registered_at"}
        optional_string_fields = {
            "session_name", "tool", "last_event_kind", "last_event_at", "heartbeat_at", "blocked_reason"
        }
        integer_fields = {"stale_after_seconds", "retry_count"}
        for field in string_fields:
            if field in row and not isinstance(row[field], str):
                raise ValueError(f"session registry {field} must be a string")
        for field in optional_string_fields:
            if field in row and row[field] is not None and not isinstance(row[field], str):
                raise ValueError(f"session registry {field} must be a string or null")
        for field in integer_fields:
            if field in row and (not isinstance(row[field], int) or isinstance(row[field], bool)):
                raise ValueError(f"session registry {field} must be an integer")

        questions = row.get("open_questions", [])
        if not isinstance(questions, list):
            raise ValueError("session registry open_questions must be a list")
        if len(questions) > self.max_questions:
            raise ValueError("session question count exceeds limit")
        if any(not isinstance(question, str) for question in questions):
            raise ValueError("session registry questions must be strings")
        if any(len(question.encode("utf-8")) > self.max_question_bytes for question in questions):
            raise ValueError("session question exceeds size limit")

        watcher_ids = row.get("watcher_ids", [])
        if not isinstance(watcher_ids, list) or any(not isinstance(watcher_id, str) for watcher_id in watcher_ids):
            raise ValueError("session registry watcher_ids must be a list of strings")
        parent_process = row.get("parent_process")
        if parent_process is not None and not isinstance(parent_process, dict):
            raise ValueError("session registry parent_process must be an object or null")
        metadata = row.get("metadata", {})
        if not isinstance(metadata, dict):
            raise ValueError("session registry metadata must be an object")
        if len(json.dumps(metadata, ensure_ascii=False).encode("utf-8")) > self.max_metadata_bytes:
            raise ValueError("session metadata exceeds size limit")

    def _write_all(self, rows: List[SessionRecord]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        active = [r for r in rows if r.status not in {"finished", "failed"}]
        terminal = sorted((r for r in rows if r.status in {"finished", "failed"}), key=lambda r: (r.last_event_at or r.registered_at, r.process_id, r.session_id), reverse=True)
        if len(active) > self.max_sessions: raise ValueError("active session count exceeds limit")
        rows[:] = active + terminal[: self.max_sessions - len(active)]
        for row in rows:
            if len(row.open_questions) > self.max_questions: row.open_questions = row.open_questions[-self.max_questions:]
            if any(len(q.encode("utf-8")) > self.max_question_bytes for q in row.open_questions): raise ValueError("session question exceeds size limit")
            if len(json.dumps(row.metadata, ensure_ascii=False).encode("utf-8")) > self.max_metadata_bytes: raise ValueError("session metadata exceeds size limit")
        def serialize() -> bytes:
            payload = [(row.model_dump() if hasattr(row, "model_dump") else row.dict()) for row in rows]
            return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
        encoded = serialize()
        while len(encoded) > self.max_state_bytes:
            terminal = [r for r in rows if r.status in {"finished", "failed"}]
            if not terminal: raise ValueError("active session registry exceeds size limit")
            oldest = min(terminal, key=lambda r: (r.last_event_at or r.registered_at, r.process_id, r.session_id))
            rows.remove(oldest)
            encoded = serialize()
        tmp = self.path.with_name(f".{self.path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        try:
            with tmp.open("xb") as handle: handle.write(encoded); handle.flush(); os.fsync(handle.fileno())
            os.replace(tmp, self.path)
            directory = os.open(self.path.parent, os.O_RDONLY)
            try: os.fsync(directory)
            finally: os.close(directory)
        finally:
            if tmp.exists(): tmp.unlink()

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
        with self._transaction():
            return self._register_locked(process_id=process_id, session_id=session_id, session_name=session_name, tool=tool, source=source, stale_after_seconds=stale_after_seconds, parent_process=parent_process, metadata=metadata)

    def _register_locked(self, *, process_id: str, session_id: str, session_name=None, tool=None, source="runtime", stale_after_seconds=None, parent_process=None, metadata=None) -> SessionRecord:
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
        rows = self._load_all()
        current = self._find(rows, process_id=event.process_id, session_id=session_id)
        if current is None:
            current = SessionRecord(
                process_id=event.process_id,
                session_id=session_id,
                session_name=event.session_name,
                tool=event.tool,
                heartbeat_at=_now_iso(),
                metadata={"last_operator_summary": event.operator_summary},
            )
            rows.append(current)
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

    def detect_stale(self, *, now: Optional[datetime] = None, process_id: Optional[str] = None) -> List[SessionRecord]:
        now_dt = now or _now()
        rows = self._load_all()
        stale_rows: List[SessionRecord] = []
        changed = False
        for row in rows:
            if process_id and row.process_id != process_id:
                continue
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


def _transactional(method):
    def wrapped(self, *args, **kwargs):
        with self._transaction():
            return method(self, *args, **kwargs)
    return wrapped


# These methods perform read-modify-write operations and must hold one process
# lock across the complete operation (nested register calls are re-entrant).
SessionRegistryStore.heartbeat = _transactional(SessionRegistryStore.heartbeat)
SessionRegistryStore.attach_watcher = _transactional(SessionRegistryStore.attach_watcher)
SessionRegistryStore.apply_event = _transactional(SessionRegistryStore.apply_event)
SessionRegistryStore.detect_stale = _transactional(SessionRegistryStore.detect_stale)

__all__ = ["SessionRecord", "SessionRegistryStore", "ValidationError"]
