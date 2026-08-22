from __future__ import annotations

import json
import os
import fcntl
import hashlib
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from cortex_server.runtime.session_contract import CanonicalSessionEvent
from cortex_server.runtime.runtime_delivery_quota import (
    assert_process_count,
    assert_runtime_delivery_capacity,
    runtime_delivery_quota_transaction,
)


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
    server_principal_id: str
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

    @field_validator(
        "process_id",
        "session_id",
        "server_principal_id",
        "status",
        "source",
        "registered_at",
    )
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text


class SessionRegistryStore:
    def __init__(
        self,
        path: str | Path,
        *,
        max_sessions: int = 1000,
        max_sessions_per_process: Optional[int] = None,
        max_sessions_per_principal: Optional[int] = None,
        max_active_bytes_per_process: Optional[int] = None,
        max_active_bytes_per_principal: Optional[int] = None,
        recovery_reserve_sessions: Optional[int] = None,
        recovery_reserve_bytes: Optional[int] = None,
        max_questions: int = 50,
        max_question_bytes: int = 8192,
        max_metadata_bytes: int = 65536,
        max_state_bytes: int = 4_000_000,
        delivery_root: Optional[str | Path] = None,
    ):
        self.path = Path(path)
        self.max_sessions = max(1, int(max_sessions))
        self.max_questions = max(1, int(max_questions))
        self.max_question_bytes = max(1, int(max_question_bytes))
        self.max_metadata_bytes = max(2, int(max_metadata_bytes))
        self.max_state_bytes = max(1024, int(max_state_bytes))

        default_session_reserve = self.max_sessions // 16 if self.max_sessions >= 16 else 0
        configured_session_reserve = (
            default_session_reserve
            if recovery_reserve_sessions is None
            else max(default_session_reserve, int(recovery_reserve_sessions))
        )
        self.recovery_reserve_sessions = min(
            configured_session_reserve,
            max(0, self.max_sessions - 1),
        )
        operational_sessions = self.max_sessions - self.recovery_reserve_sessions
        principal_session_ceiling = max(1, operational_sessions // 2)
        self.max_sessions_per_principal = min(
            principal_session_ceiling,
            max(
                1,
                int(max_sessions_per_principal)
                if max_sessions_per_principal is not None
                else min(256, principal_session_ceiling),
            ),
        )
        self.max_sessions_per_process = min(
            self.max_sessions_per_principal,
            max(
                1,
                int(max_sessions_per_process)
                if max_sessions_per_process is not None
                else min(64, self.max_sessions_per_principal),
            ),
        )

        default_byte_reserve = (
            min(512 * 1024, self.max_state_bytes // 8)
            if self.max_state_bytes >= 8192
            else 0
        )
        configured_byte_reserve = (
            default_byte_reserve
            if recovery_reserve_bytes is None
            else max(default_byte_reserve, int(recovery_reserve_bytes))
        )
        self.recovery_reserve_bytes = min(
            configured_byte_reserve,
            max(0, self.max_state_bytes - 512),
        )
        operational_bytes = self.max_state_bytes - self.recovery_reserve_bytes
        principal_byte_ceiling = max(256, operational_bytes // 2)
        self.max_active_bytes_per_principal = min(
            principal_byte_ceiling,
            max(
                256,
                int(max_active_bytes_per_principal)
                if max_active_bytes_per_principal is not None
                else min(1024 * 1024, principal_byte_ceiling),
            ),
        )
        self.max_active_bytes_per_process = min(
            self.max_active_bytes_per_principal,
            max(
                256,
                int(max_active_bytes_per_process)
                if max_active_bytes_per_process is not None
                else min(512 * 1024, self.max_active_bytes_per_principal),
            ),
        )
        self._mutex = threading.RLock()
        self._lock_depth = 0
        self.delivery_root = Path(delivery_root) if delivery_root is not None else None

    @staticmethod
    def _fallback_server_principal_id(process_id: str) -> str:
        process = str(process_id or "").strip()
        return hashlib.sha256(
            f"cortex.session-registry.process-principal.v1\0{process}".encode("utf-8")
        ).hexdigest()

    @classmethod
    def server_bound_principal_id(
        cls,
        *,
        process_id: str,
        process: Optional[Mapping[str, Any]] = None,
    ) -> str:
        """Derive a stable identifier only from server-persisted process state."""
        process = process if isinstance(process, Mapping) else {}
        workflow = process.get("workflow") if isinstance(process.get("workflow"), Mapping) else {}
        metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), Mapping) else {}
        quota_principal = str(metadata.get("_reasoning_quota_principal_hash") or "").strip().lower()
        if len(quota_principal) == 64 and all(char in "0123456789abcdef" for char in quota_principal):
            return quota_principal

        scopes = [process, metadata]
        for container in (process, metadata):
            for key in ("principal", "principal_scope", "scope"):
                value = container.get(key) if isinstance(container, Mapping) else None
                if isinstance(value, Mapping):
                    scopes.append(value)
        identity = {}
        for field in (
            "tenant_id",
            "storage_workspace_id",
            "owner",
            "user_id",
            "agent_id",
            "channel_id",
            "session_id",
        ):
            values = {
                str(scope.get(field) or "").strip()
                for scope in scopes
                if str(scope.get(field) or "").strip()
            }
            if len(values) == 1:
                identity[field] = next(iter(values))
        required = {"tenant_id", "storage_workspace_id", "owner", "user_id", "agent_id"}
        if required.issubset(identity):
            encoded = json.dumps(
                identity,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
            return hashlib.sha256(b"cortex.session-registry.principal.v1\0" + encoded).hexdigest()
        return cls._fallback_server_principal_id(process_id)

    @staticmethod
    def _normalize_server_principal_id(value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized or len(normalized.encode("utf-8")) > 256:
            raise ValueError("server principal identity must be a bounded non-empty string")
        return normalized

    def _bind_process_principal(
        self,
        rows: List[SessionRecord],
        *,
        process_id: str,
        server_principal_id: Optional[str],
    ) -> str:
        process = str(process_id or "").strip()
        legacy_principal_id = self._fallback_server_principal_id(process)
        supplied_principal_id = (
            self._normalize_server_principal_id(server_principal_id)
            if server_principal_id is not None
            else None
        )
        process_rows = [row for row in rows if row.process_id == process]
        process_principals = {row.server_principal_id for row in process_rows}
        if len(process_principals) > 1:
            raise ValueError("session process server principal binding is immutable")
        if supplied_principal_id is not None and process_principals not in (
            set(),
            {supplied_principal_id},
        ):
            if process_principals == {legacy_principal_id}:
                # One-time upgrade of pre-binding rows using the trusted
                # server process identity supplied by the runtime boundary.
                for row in process_rows:
                    row.server_principal_id = supplied_principal_id
            else:
                raise ValueError("session process server principal binding is immutable")
        return supplied_principal_id or (
            next(iter(process_principals)) if process_principals else legacy_principal_id
        )

    def migrate_legacy_principals(
        self,
        process_principals: Mapping[str, str],
    ) -> List[str]:
        """Atomically upgrade source-format process fallbacks during recovery.

        The caller must derive every supplied principal from authoritative
        server process state.  All candidate bindings are quota-preflighted as
        one registry image; an invalid or over-quota recovery leaves the
        durable source byte-for-byte unchanged so startup readiness fails
        closed instead of publishing a partial migration.
        """

        if len(process_principals) > self.max_sessions:
            raise ValueError("session principal recovery process count exceeds limit")
        normalized = {
            str(process_id or "").strip(): self._normalize_server_principal_id(principal_id)
            for process_id, principal_id in process_principals.items()
        }
        if any(not process_id for process_id in normalized):
            raise ValueError("session principal recovery process_id must be non-empty")

        with self._transaction():
            rows = self._load_all()
            migrated: List[str] = []
            for process_id, principal_id in sorted(normalized.items()):
                legacy_principal_id = self._fallback_server_principal_id(process_id)
                process_rows = [row for row in rows if row.process_id == process_id]
                bindings = {row.server_principal_id for row in process_rows}
                if len(bindings) > 1:
                    raise ValueError("session process server principal binding is immutable")
                if bindings == {legacy_principal_id} and principal_id != legacy_principal_id:
                    for row in process_rows:
                        row.server_principal_id = principal_id
                    migrated.append(process_id)
                elif bindings and bindings != {principal_id}:
                    raise ValueError("session process server principal binding is immutable")

            authoritative_process_ids = set(normalized)
            for row in rows:
                if (
                    row.process_id not in authoritative_process_ids
                    and row.server_principal_id
                    == self._fallback_server_principal_id(row.process_id)
                    and row.status not in {"finished", "failed"}
                ):
                    row.status = "failed"
                    row.blocked_reason = (
                        "legacy fallback principal quarantined: authoritative process state unavailable"
                    )
                    row.metadata = {
                        **dict(row.metadata or {}),
                        "legacy_principal_quarantined": True,
                    }
                    if row.process_id not in migrated:
                        migrated.append(row.process_id)

            if migrated:
                self._write_all(rows)
            else:
                # Recovery must still reject pre-existing state that violates
                # current active quotas, without rewriting a legacy file.
                self._bounded_payload(rows)
            return sorted(migrated)

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
            row = dict(row)
            row.setdefault(
                "server_principal_id",
                self._fallback_server_principal_id(str(row.get("process_id") or "")),
            )
            self._validate_persisted_row(row)
            if hasattr(SessionRecord, "model_validate"):
                out.append(SessionRecord.model_validate(row))
            else:
                out.append(SessionRecord.parse_obj(row))
        return out

    def _validate_persisted_row(self, row: JsonDict) -> None:
        string_fields = {
            "process_id",
            "session_id",
            "server_principal_id",
            "status",
            "source",
            "registered_at",
        }
        optional_string_fields = {
            "session_name", "tool", "last_event_kind", "last_event_at", "heartbeat_at", "blocked_reason"
        }
        integer_fields = {"stale_after_seconds", "retry_count"}
        for field in string_fields:
            if field in row and not isinstance(row[field], str):
                raise ValueError(f"session registry {field} must be a string")
        if "server_principal_id" in row:
            self._normalize_server_principal_id(row["server_principal_id"])
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
        encoded = self._bounded_payload(rows)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        def commit() -> None:
            tmp = self.path.with_name(f".{self.path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
            try:
                with tmp.open("xb") as handle: handle.write(encoded); handle.flush(); os.fsync(handle.fileno())
                os.replace(tmp, self.path)
                directory = os.open(self.path.parent, os.O_RDONLY)
                try: os.fsync(directory)
                finally: os.close(directory)
            finally:
                if tmp.exists(): tmp.unlink()
        if self.delivery_root is None:
            commit()
        else:
            with runtime_delivery_quota_transaction(self.delivery_root):
                process_ids = sorted({row.process_id for row in rows})
                for process_id in process_ids:
                    assert_process_count(self.path, process_id, delivery_root=self.delivery_root)
                assert_runtime_delivery_capacity(
                    delivery_root=self.delivery_root,
                    store_root=self.path,
                    process_id=process_ids[0] if process_ids else "session-system",
                    object_bytes=len(encoded),
                    additional_bytes=len(encoded),
                    replacing=self.path,
                )
                commit()

    @staticmethod
    def _record_payload(row: SessionRecord) -> JsonDict:
        return row.model_dump() if hasattr(row, "model_dump") else row.dict()

    @classmethod
    def _serialize_rows(cls, rows: List[SessionRecord]) -> bytes:
        payload = [cls._record_payload(row) for row in rows]
        return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")

    @classmethod
    def _active_record_bytes(cls, row: SessionRecord) -> int:
        return len(
            json.dumps(
                cls._record_payload(row),
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        )

    def _assert_active_quotas(self, rows: List[SessionRecord]) -> None:
        active = [row for row in rows if row.status not in {"finished", "failed"}]
        operational_session_limit = self.max_sessions - self.recovery_reserve_sessions
        if len(active) > operational_session_limit:
            raise ValueError("active session count exceeds limit")
        active_payload_bytes = len(self._serialize_rows(active))
        if active_payload_bytes > self.max_state_bytes - self.recovery_reserve_bytes:
            raise ValueError("active session bytes exceed aggregate admission limit")

        process_counts: Dict[str, int] = {}
        principal_counts: Dict[str, int] = {}
        process_bytes: Dict[str, int] = {}
        principal_bytes: Dict[str, int] = {}
        for row in active:
            row_bytes = self._active_record_bytes(row)
            process_counts[row.process_id] = process_counts.get(row.process_id, 0) + 1
            principal_counts[row.server_principal_id] = principal_counts.get(row.server_principal_id, 0) + 1
            process_bytes[row.process_id] = process_bytes.get(row.process_id, 0) + row_bytes
            principal_bytes[row.server_principal_id] = principal_bytes.get(row.server_principal_id, 0) + row_bytes

        if any(count > self.max_sessions_per_process for count in process_counts.values()):
            raise ValueError("active session process count exceeds limit")
        if any(count > self.max_sessions_per_principal for count in principal_counts.values()):
            raise ValueError("active session principal count exceeds limit")
        if any(size > self.max_active_bytes_per_process for size in process_bytes.values()):
            raise ValueError("active session process bytes exceed limit")
        if any(size > self.max_active_bytes_per_principal for size in principal_bytes.values()):
            raise ValueError("active session principal bytes exceed limit")

    def _assert_immutable_process_principals(self, rows: List[SessionRecord]) -> None:
        bindings: Dict[str, set[str]] = {}
        for row in rows:
            principal_id = self._normalize_server_principal_id(row.server_principal_id)
            bindings.setdefault(row.process_id, set()).add(principal_id)
        if any(len(principals) != 1 for principals in bindings.values()):
            raise ValueError("session process server principal binding is immutable")

    def _bounded_payload(self, rows: List[SessionRecord]) -> bytes:
        active = [r for r in rows if r.status not in {"finished", "failed"}]
        terminal = sorted((r for r in rows if r.status in {"finished", "failed"}), key=lambda r: (r.last_event_at or r.registered_at, r.process_id, r.session_id), reverse=True)
        self._assert_immutable_process_principals(rows)
        self._assert_active_quotas(rows)
        rows[:] = active + terminal[: self.max_sessions - len(active)]
        for row in rows:
            if len(row.open_questions) > self.max_questions: row.open_questions = row.open_questions[-self.max_questions:]
            if any(len(q.encode("utf-8")) > self.max_question_bytes for q in row.open_questions): raise ValueError("session question exceeds size limit")
            if len(json.dumps(row.metadata, ensure_ascii=False).encode("utf-8")) > self.max_metadata_bytes: raise ValueError("session metadata exceeds size limit")
        encoded = self._serialize_rows(rows)
        while len(encoded) > self.max_state_bytes:
            terminal = [r for r in rows if r.status in {"finished", "failed"}]
            if not terminal: raise ValueError("active session registry exceeds size limit")
            oldest = min(terminal, key=lambda r: (r.last_event_at or r.registered_at, r.process_id, r.session_id))
            rows.remove(oldest)
            encoded = self._serialize_rows(rows)
        return encoded

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
        server_principal_id: Optional[str] = None,
    ) -> SessionRecord:
        with self._transaction():
            return self._register_locked(process_id=process_id, session_id=session_id, session_name=session_name, tool=tool, source=source, stale_after_seconds=stale_after_seconds, parent_process=parent_process, metadata=metadata, server_principal_id=server_principal_id)

    def _register_locked(self, *, process_id: str, session_id: str, session_name=None, tool=None, source="runtime", stale_after_seconds=None, parent_process=None, metadata=None, server_principal_id=None) -> SessionRecord:
        rows = self._load_all()
        effective_principal_id = self._bind_process_principal(
            rows,
            process_id=process_id,
            server_principal_id=server_principal_id,
        )
        existing = self._find(rows, process_id=process_id, session_id=session_id)
        if existing is not None:
            if existing.server_principal_id != effective_principal_id:
                raise ValueError("session server principal binding is immutable")
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
            server_principal_id=effective_principal_id,
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

    def heartbeat(
        self,
        *,
        process_id: str,
        session_id: str,
        server_principal_id: str,
        stale_after_seconds: Optional[int] = None,
    ) -> SessionRecord:
        rows = self._load_all()
        effective_principal_id = self._bind_process_principal(
            rows,
            process_id=process_id,
            server_principal_id=server_principal_id,
        )
        record = self._find(rows, process_id=process_id, session_id=session_id)
        if record is None:
            record = SessionRecord(
                process_id=process_id,
                session_id=session_id,
                server_principal_id=effective_principal_id,
                stale_after_seconds=max(1, int(stale_after_seconds or 900)),
                heartbeat_at=_now_iso(),
            )
            rows.append(record)
        elif record.server_principal_id != effective_principal_id:
            raise ValueError("session server principal binding is immutable")
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

    def _project_event(
        self,
        rows: List[SessionRecord],
        event: CanonicalSessionEvent,
        *,
        server_principal_id: Optional[str] = None,
    ) -> SessionRecord:
        session_id = str(event.session_id or event.process_id).strip()
        effective_principal_id = self._bind_process_principal(
            rows,
            process_id=event.process_id,
            server_principal_id=server_principal_id,
        )
        current = self._find(rows, process_id=event.process_id, session_id=session_id)
        if current is None:
            current = SessionRecord(
                process_id=event.process_id,
                session_id=session_id,
                server_principal_id=effective_principal_id,
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
        return current

    def validate_event_admission(
        self,
        event: CanonicalSessionEvent,
        *,
        server_principal_id: Optional[str] = None,
    ) -> None:
        """Validate the exact registry projection without publishing it."""

        with self._transaction():
            rows = self._load_all()
            self._project_event(
                rows,
                event,
                server_principal_id=server_principal_id,
            )
            self._bounded_payload(rows)

    def apply_event(
        self,
        event: CanonicalSessionEvent,
        *,
        server_principal_id: Optional[str] = None,
    ) -> SessionRecord:
        rows = self._load_all()
        current = self._project_event(
            rows,
            event,
            server_principal_id=server_principal_id,
        )
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
