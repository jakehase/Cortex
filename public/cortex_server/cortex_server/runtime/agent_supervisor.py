from __future__ import annotations

import json
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

    def _read_all(self) -> List[AgentLease]:
        if not self.path.exists():
            return []
        data = json.loads(self.path.read_text(encoding="utf-8"))
        rows = data if isinstance(data, list) else []
        return [_model_validate_compat(dict(row)) for row in rows if isinstance(row, dict)]

    def _write_all(self, rows: List[AgentLease]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = [_model_dump_compat(row) for row in rows]
        self.path.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8")

    def assign(self, *, process_id: str, scope: str, agent_id: str, lease_seconds: int, metadata: Optional[Dict[str, Any]] = None) -> AgentLease:
        if int(lease_seconds) <= 0:
            raise ValueError("lease_seconds must be positive")
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
        rows = self._read_all()
        rows.append(record)
        self._write_all(rows)
        return record

    def list(self, *, process_id: Optional[str] = None, status: Optional[str] = None) -> List[AgentLease]:
        rows = self._read_all()
        filtered: List[AgentLease] = []
        for row in rows:
            if process_id and row.process_id != process_id:
                continue
            if status and row.status != status:
                continue
            filtered.append(row)
        return filtered

    def _mutate(self, lease_id: str, mutate_fn) -> AgentLease:
        rows = self._read_all()
        for row in rows:
            if row.lease_id == lease_id:
                mutate_fn(row)
                self._write_all(rows)
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

    def reclaim_stale(self, *, now: Optional[datetime] = None) -> List[AgentLease]:
        now_dt = now or _now()
        rows = self._read_all()
        reclaimed: List[AgentLease] = []
        changed = False
        for row in rows:
            if row.status == "active" and _parse_ts(row.expires_at) <= now_dt:
                row.status = "stale"
                reclaimed.append(row)
                changed = True
        if changed:
            self._write_all(rows)
        return reclaimed


__all__ = ["AgentLease", "AgentSupervisor", "ValidationError"]
