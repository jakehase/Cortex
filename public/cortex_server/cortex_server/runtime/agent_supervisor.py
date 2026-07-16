from __future__ import annotations

import json
import os
import fcntl
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from cortex_server.runtime.runtime_delivery_quota import (
    assert_process_count,
    assert_runtime_delivery_capacity,
    runtime_delivery_quota_transaction,
)



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
    generation: int = 1
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

    @field_validator("generation")
    @classmethod
    def _validate_generation(cls, value: int) -> int:
        generation = int(value or 0)
        if generation <= 0:
            raise ValueError("generation must be positive")
        return generation



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
    def __init__(
        self,
        path: str | Path,
        *,
        clock_fn: Optional[Callable[[], datetime]] = None,
        delivery_root: Optional[str | Path] = None,
    ):
        self.path = Path(path)
        self.lock_path = self.path.with_name(f"{self.path.name}.lock")
        self._clock_fn = clock_fn or _now
        self.delivery_root = Path(delivery_root) if delivery_root is not None else None

    def _trusted_now(self) -> datetime:
        observed = self._clock_fn()
        if observed.tzinfo is None:
            raise ValueError("agent supervisor clock must be timezone-aware")
        return observed.astimezone(timezone.utc)

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
        def commit() -> None:
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
                    process_id=process_ids[0] if process_ids else "lease-system",
                    object_bytes=len(encoded),
                    additional_bytes=len(encoded),
                    replacing=self.path,
                )
                commit()
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
            now = self._trusted_now()
            generation = max(
                (row.generation for row in rows if row.process_id == process_id and row.scope == scope),
                default=0,
            ) + 1
            record = AgentLease(
                process_id=process_id,
                scope=scope,
                agent_id=agent_id,
                assigned_at=now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                heartbeat_at=now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                expires_at=(now + timedelta(seconds=int(lease_seconds))).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                generation=generation,
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
        now = self._trusted_now()
        def _apply(row: AgentLease) -> None:
            if row.status != "active":
                raise RuntimeError(f"cannot heartbeat non-active lease: {lease_id}")
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

    def takeover_stale(
        self,
        lease_id: str,
        *,
        agent_id: str,
        lease_seconds: int,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> tuple[AgentLease, AgentLease]:
        """Atomically fence a stale generation and persist its successor."""

        if int(lease_seconds) <= 0:
            raise ValueError("lease_seconds must be positive")
        successor_agent = str(agent_id or "").strip()
        if not successor_agent:
            raise ValueError("agent_id must be non-empty")
        with self._locked(exclusive=True):
            revision, rows = self._read_envelope()
            stale = next((row for row in rows if row.lease_id == lease_id), None)
            if stale is None:
                raise KeyError(f"lease not found: {lease_id}")
            if stale.status != "stale":
                raise RuntimeError(f"lease is not stale: {lease_id}")
            if any(
                row.status == "active"
                and row.process_id == stale.process_id
                and row.scope == stale.scope
                for row in rows
            ):
                raise RuntimeError(f"active successor already exists for {stale.process_id}:{stale.scope}")
            generation = max(
                (row.generation for row in rows if row.process_id == stale.process_id and row.scope == stale.scope),
                default=stale.generation,
            ) + 1
            now = self._trusted_now()
            successor = AgentLease(
                process_id=stale.process_id,
                scope=stale.scope,
                agent_id=successor_agent,
                assigned_at=now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                heartbeat_at=now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                expires_at=(now + timedelta(seconds=int(lease_seconds))).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                generation=generation,
                metadata={
                    **dict(metadata or {}),
                    "takeover_of_lease_id": stale.lease_id,
                    "takeover_of_generation": stale.generation,
                },
            )
            stale.status = "superseded"
            stale.metadata = {
                **dict(stale.metadata or {}),
                "superseded_by_lease_id": successor.lease_id,
                "superseded_by_generation": successor.generation,
            }
            rows.append(successor)
            self._write_all(rows, expected_revision=revision)
            return stale, successor

    def reclaim_stale(self, *, process_id: str) -> List[AgentLease]:
        process = str(process_id or "").strip()
        if not process:
            raise ValueError("process_id must be non-empty")
        now_dt = self._trusted_now()
        with self._locked(exclusive=True):
            revision, rows = self._read_envelope()
            reclaimed: List[AgentLease] = []
            for row in rows:
                if row.process_id == process and row.status == "active" and _parse_ts(row.expires_at) <= now_dt:
                    row.status = "stale"
                    reclaimed.append(row)
            if reclaimed:
                self._write_all(rows, expected_revision=revision)
            return reclaimed

    def complete_active_generation(
        self,
        lease_id: str,
        *,
        generation: int,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> AgentLease:
        """Release only the live generation proven by a completed handoff."""

        with self._locked(exclusive=True):
            revision, rows = self._read_envelope()
            row = next((item for item in rows if item.lease_id == lease_id), None)
            if row is None:
                raise KeyError(f"lease not found: {lease_id}")
            if int(row.generation) != int(generation):
                raise RuntimeError("lease generation no longer matches the acknowledged handoff")
            if row.status != "active":
                raise RuntimeError(f"lease is not active: {row.status}")
            if _parse_ts(row.expires_at) <= self._trusted_now():
                row.status = "stale"
                self._write_all(rows, expected_revision=revision)
                raise RuntimeError("acknowledged lease expired before completion was committed")
            row.status = "released"
            row.metadata = {**dict(row.metadata or {}), **dict(metadata or {})}
            self._write_all(rows, expected_revision=revision)
            return row

    @contextmanager
    def promotion_snapshot(
        self,
        *,
        process_id: str,
        minimum_remaining_seconds: float = 1.0,
    ) -> Iterator[tuple[int, List[AgentLease]]]:
        """Hold lease state stable while a release promotion is committed.

        Expired or near-expiry active leases are projected as stale from the
        trusted clock without mutating the journal under a read lock.
        """

        process = str(process_id or "").strip()
        if not process:
            raise ValueError("process_id must be non-empty")
        margin = max(0.0, float(minimum_remaining_seconds or 0.0))
        with self._locked(exclusive=False):
            revision, rows = self._read_envelope()
            cutoff = self._trusted_now() + timedelta(seconds=margin)
            projected: List[AgentLease] = []
            for row in rows:
                if row.process_id != process:
                    continue
                payload = _model_dump_compat(row)
                if row.status == "active" and _parse_ts(row.expires_at) <= cutoff:
                    payload["status"] = "stale"
                projected.append(_model_validate_compat(payload))
            yield revision, projected


__all__ = ["AgentLease", "AgentSupervisor", "ValidationError"]
