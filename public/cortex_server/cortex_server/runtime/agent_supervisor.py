from __future__ import annotations

import json
import os
import fcntl
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator



def _now() -> datetime:
    return datetime.now(timezone.utc)



def _now_iso() -> str:
    return _now().isoformat(timespec="milliseconds").replace("+00:00", "Z")



def _lease_id() -> str:
    return f"lease_{uuid4().hex[:16]}"


class AgentLease(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lease_id: str = Field(default_factory=_lease_id)
    process_id: str
    scope: str
    agent_id: str
    assigned_at: str = Field(default_factory=_now_iso)
    heartbeat_at: str = Field(default_factory=_now_iso)
    expires_at: str
    status: str = "active"
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("lease_id", "process_id", "scope", "agent_id", "assigned_at", "heartbeat_at", "expires_at", "status")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value

    @field_validator("assigned_at", "heartbeat_at", "expires_at")
    @classmethod
    def _validate_timestamp(cls, value: str) -> str:
        text = str(value or "").strip()
        try:
            datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("timestamp must be ISO-8601") from exc
        return text



def _parse_ts(text: str) -> datetime:
    return datetime.fromisoformat(str(text).replace("Z", "+00:00"))



def _model_validate_compat(data: Dict[str, Any]) -> AgentLease:
    if hasattr(AgentLease, "model_validate"):
        return AgentLease.model_validate(data)
    return AgentLease.parse_obj(data)



def _model_dump_compat(model: AgentLease) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


class AgentSupervisor:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.lock_path = self.path.with_name(f"{self.path.name}.lock")

    @contextmanager
    def _locked(self, *, exclusive: bool):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.lock_path.open("a+b") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def _read_envelope(self) -> tuple[int, List[AgentLease]]:
        if not self.path.exists():
            return 0, []
        data = json.loads(self.path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            revision, rows = 0, data
        elif isinstance(data, dict) and data.get("version") == "cortex.agent-leases.v2":
            revision, rows = data.get("revision"), data.get("leases")
            if type(revision) is not int or revision < 0 or not isinstance(rows, list):
                raise ValueError("agent lease envelope is invalid")
        else:
            raise ValueError("agent lease state is invalid")
        return int(revision), [_model_validate_compat(dict(row)) for row in rows if isinstance(row, dict)]

    def _write_all(self, rows: List[AgentLease], *, expected_revision: int) -> int:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        current_revision, _ = self._read_envelope()
        if current_revision != expected_revision:
            raise RuntimeError("agent lease revision conflict")
        next_revision = current_revision + 1
        payload = {
            "version": "cortex.agent-leases.v2",
            "revision": next_revision,
            "leases": [_model_dump_compat(row) for row in rows],
        }
        encoded = (json.dumps(payload, sort_keys=True, indent=2) + "\n").encode("utf-8")
        temporary = self.path.with_name(f".{self.path.name}.{os.getpid()}.{uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
            directory_fd = os.open(self.path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
        return next_revision

    def assign(self, *, process_id: str, scope: str, agent_id: str, lease_seconds: int, metadata: Optional[Dict[str, Any]] = None) -> AgentLease:
        if int(lease_seconds) <= 0:
            raise ValueError("lease_seconds must be positive")
        with self._locked(exclusive=True):
            revision, rows = self._read_envelope()
            for row in rows:
                if row.process_id != process_id or row.scope != scope or row.status != "active":
                    continue
                if row.agent_id == agent_id:
                    return row
                raise ValueError(f"active claim exists for {process_id}:{scope} via {row.agent_id}")
            now = _now()
            record = AgentLease(
                process_id=process_id,
                scope=scope,
                agent_id=agent_id,
                assigned_at=now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                heartbeat_at=now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                expires_at=(now + timedelta(seconds=int(lease_seconds))).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                metadata=dict(metadata or {}),
            )
            rows.append(record)
            self._write_all(rows, expected_revision=revision)
            return record

    def list(self, *, process_id: Optional[str] = None, status: Optional[str] = None) -> List[AgentLease]:
        _, rows = self.list_with_revision()
        filtered: List[AgentLease] = []
        for row in rows:
            if process_id and row.process_id != process_id:
                continue
            if status and row.status != status:
                continue
            filtered.append(row)
        return filtered

    def list_with_revision(self) -> tuple[int, List[AgentLease]]:
        with self._locked(exclusive=False):
            revision, rows = self._read_envelope()
            return revision, rows

    def revision(self) -> int:
        revision, _ = self.list_with_revision()
        return revision

    def _mutate(self, lease_id: str, mutate_fn) -> AgentLease:
        with self._locked(exclusive=True):
            revision, rows = self._read_envelope()
            for row in rows:
                if row.lease_id == lease_id:
                    mutate_fn(row)
                    self._write_all(rows, expected_revision=revision)
                    return row
        raise KeyError(f"lease not found: {lease_id}")

    def heartbeat(self, lease_id: str, *, lease_seconds: Optional[int] = None) -> AgentLease:
        now = _now()
        def _apply(row: AgentLease) -> None:
            row.heartbeat_at = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
            if lease_seconds is not None:
                if int(lease_seconds) <= 0:
                    raise ValueError("lease_seconds must be positive")
                row.expires_at = (now + timedelta(seconds=int(lease_seconds))).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            row.status = "active"
        return self._mutate(lease_id, _apply)

    def release(self, lease_id: str) -> AgentLease:
        return self._mutate(lease_id, lambda row: setattr(row, "status", "released"))

    def resolve(self, lease_id: str, *, status: str = "released", metadata: Optional[Dict[str, Any]] = None) -> AgentLease:
        resolved_status = str(status or "").strip() or "released"

        def _apply(row: AgentLease) -> None:
            row.status = resolved_status
            if metadata:
                row.metadata = {**dict(row.metadata or {}), **dict(metadata)}

        return self._mutate(lease_id, _apply)

    def reclaim_stale(self, *, now: Optional[datetime] = None) -> List[AgentLease]:
        now_dt = now or _now()
        with self._locked(exclusive=True):
            revision, rows = self._read_envelope()
            reclaimed: List[AgentLease] = []
            for row in rows:
                if row.status == "active" and _parse_ts(row.expires_at) <= now_dt:
                    row.status = "stale"
                    reclaimed.append(row)
            if reclaimed:
                self._write_all(rows, expected_revision=revision)
            return reclaimed


__all__ = ["AgentLease", "AgentSupervisor", "ValidationError"]
