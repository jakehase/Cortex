from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from cortex_server.runtime.session_contract import CanonicalSessionEvent, normalize_session_event
from cortex_server.runtime.session_registry import SessionRegistryStore


JsonDict = Dict[str, Any]


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now_dt().isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _watch_id() -> str:
    return f"watch_{uuid4().hex[:16]}"


class WatchRegistration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    watch_id: str = Field(default_factory=_watch_id)
    process_id: str
    kind: str
    target: str
    session_id: Optional[str] = None
    session_name: Optional[str] = None
    tool: Optional[str] = None
    debounce_seconds: float = 1.0
    stale_after_seconds: int = 900
    keywords: List[str] = Field(default_factory=list)
    enabled: bool = True
    created_at: str = Field(default_factory=_now_iso)
    metadata: JsonDict = Field(default_factory=dict)

    @field_validator("watch_id", "process_id", "kind", "target", "created_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text


class WatcherRuntimeStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _load(self) -> Dict[str, Any]:
        if not self.path.exists():
            return {"version": "watchers.v1", "registrations": [], "runtime": {}}
        data = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"version": "watchers.v1", "registrations": [], "runtime": {}}
        data.setdefault("version", "watchers.v1")
        data.setdefault("registrations", [])
        data.setdefault("runtime", {})
        return data

    def _write(self, data: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    def register(self, registration: WatchRegistration | Dict[str, Any]) -> WatchRegistration:
        model = registration if isinstance(registration, WatchRegistration) else (WatchRegistration.model_validate(registration) if hasattr(WatchRegistration, "model_validate") else WatchRegistration.parse_obj(registration))
        data = self._load()
        rows = data.get("registrations") if isinstance(data.get("registrations"), list) else []
        rows = [row for row in rows if isinstance(row, dict) and str(row.get("watch_id") or "") != model.watch_id]
        rows.append(model.model_dump() if hasattr(model, "model_dump") else model.dict())
        data["registrations"] = rows
        self._write(data)
        return model

    def list(self, *, process_id: Optional[str] = None) -> List[WatchRegistration]:
        data = self._load()
        rows = []
        for row in data.get("registrations") or []:
            if not isinstance(row, dict):
                continue
            model = WatchRegistration.model_validate(row) if hasattr(WatchRegistration, "model_validate") else WatchRegistration.parse_obj(row)
            if process_id and model.process_id != process_id:
                continue
            rows.append(model)
        rows.sort(key=lambda item: (item.process_id, item.watch_id))
        return rows

    def _runtime_row(self, data: Dict[str, Any], watch_id: str) -> Dict[str, Any]:
        runtime = data.setdefault("runtime", {})
        row = runtime.setdefault(watch_id, {})
        return row if isinstance(row, dict) else {}

    def reconcile(
        self,
        *,
        session_registry: Optional[SessionRegistryStore] = None,
        now: Optional[datetime] = None,
    ) -> List[CanonicalSessionEvent]:
        now_dt = now or _now_dt()
        now_iso = now_dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        data = self._load()
        emitted: List[CanonicalSessionEvent] = []

        registrations = self.list()
        for registration in registrations:
            if not registration.enabled:
                continue
            runtime_row = self._runtime_row(data, registration.watch_id)
            target_path = Path(registration.target)

            if registration.kind == "workspace":
                signature = None
                if target_path.exists():
                    stat = target_path.stat()
                    signature = f"{stat.st_mtime_ns}:{stat.st_size}"
                previous_signature = runtime_row.get("signature")
                if signature != previous_signature:
                    runtime_row["signature"] = signature
                    runtime_row["last_changed_at"] = now_iso
                    already_emitted = runtime_row.get("last_emitted_signature") == signature
                    if previous_signature is not None and signature and not already_emitted:
                        event = normalize_session_event(
                            registration.process_id,
                            "workspace.changed",
                            tool=registration.tool or "workspace",
                            session_id=registration.session_id,
                            session_name=registration.session_name,
                            summary=f"workspace changed: {registration.target}",
                            payload={"path": registration.target, "watcher_id": registration.watch_id, "signature": signature},
                        )
                        emitted.append(event)
                        runtime_row["last_emitted_signature"] = signature
                        runtime_row["last_emitted_at"] = now_iso

            elif registration.kind == "session-heartbeat" and session_registry is not None:
                if not registration.session_id:
                    continue
                current = session_registry.get(process_id=registration.process_id, session_id=registration.session_id)
                if current is not None and current.status == "stale":
                    stale_marker = str(runtime_row.get("last_stale_revision") or "").strip()
                    current_marker = f"{current.process_id}:{current.session_id}:{current.last_event_at or current.heartbeat_at or current.registered_at}"
                    if stale_marker != current_marker:
                        event = normalize_session_event(
                            registration.process_id,
                            "session.stale",
                            tool=registration.tool or current.tool,
                            session_id=current.session_id,
                            session_name=current.session_name,
                            summary=current.blocked_reason or "session heartbeat expired",
                            payload={"watcher_id": registration.watch_id, "source": "session-heartbeat"},
                        )
                        emitted.append(event)
                        runtime_row["last_stale_revision"] = current_marker
                        runtime_row["last_emitted_at"] = now_iso

            elif registration.kind == "log-pattern":
                if not target_path.exists():
                    continue
                content = target_path.read_text(encoding="utf-8", errors="ignore")
                previous_offset = int(runtime_row.get("offset", 0) or 0)
                new_offset = min(len(content), max(0, previous_offset))
                appended = content[new_offset:]
                hits: List[str] = []
                if appended:
                    for line in appended.splitlines():
                        lower_line = line.lower()
                        for keyword in registration.keywords:
                            if str(keyword or "").strip() and str(keyword).lower() in lower_line:
                                if line not in hits:
                                    hits.append(line)
                runtime_row["offset"] = len(content)
                if hits:
                    event = normalize_session_event(
                        registration.process_id,
                        "blocked",
                        tool=registration.tool or "log-monitor",
                        session_id=registration.session_id,
                        session_name=registration.session_name,
                        summary=hits[0],
                        payload={"watcher_id": registration.watch_id, "keywords": list(registration.keywords), "hits": hits},
                    )
                    emitted.append(event)
                    runtime_row["last_emitted_at"] = now_iso

            elif registration.kind == "path-state":
                expected_exists = bool((registration.metadata or {}).get("expected_exists", True))
                event_name = str((registration.metadata or {}).get("event") or ("workspace.changed" if expected_exists else "retry-needed")).strip() or ("workspace.changed" if expected_exists else "retry-needed")
                summary = str((registration.metadata or {}).get("summary") or (f"path {'present' if expected_exists else 'missing'}: {registration.target}")).strip()
                exists = target_path.exists()
                observed_state = "present" if exists else "missing"
                previous_state = str(runtime_row.get("path_state") or "").strip() or None
                runtime_row["path_state"] = observed_state
                if exists == expected_exists and previous_state != observed_state:
                    event = normalize_session_event(
                        registration.process_id,
                        event_name,
                        tool=registration.tool or "path-state",
                        session_id=registration.session_id,
                        session_name=registration.session_name,
                        summary=summary,
                        payload={"watcher_id": registration.watch_id, "path": registration.target, "expected_exists": expected_exists, "observed_exists": exists},
                    )
                    emitted.append(event)
                    runtime_row["last_emitted_at"] = now_iso

        self._write(data)
        return emitted


__all__ = ["WatchRegistration", "WatcherRuntimeStore", "ValidationError"]
