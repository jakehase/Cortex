from __future__ import annotations

import json
import fcntl
import hashlib
import hmac
import os
import secrets
import stat as stat_module
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from cortex_server.runtime.session_contract import CanonicalSessionEvent, normalize_session_event
from cortex_server.runtime.session_registry import SessionRegistryStore
from cortex_server.runtime.runtime_delivery_quota import (
    assert_process_count,
    assert_runtime_delivery_capacity,
    assert_runtime_delivery_volume_capacity,
    runtime_delivery_quota_transaction,
)


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
    def __init__(self, path: str | Path, *, delivery_root: Optional[str | Path] = None):
        self.path = Path(path)
        self.delivery_root = Path(delivery_root) if delivery_root is not None else None
        self._mutex = threading.RLock()
        self._lock_depth = 0

    def _attestation_key(self) -> bytes:
        target = self.path.with_suffix(self.path.suffix + ".attestation.key")
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            def create_key() -> None:
                try:
                    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                except FileExistsError:
                    return
                try:
                    os.write(descriptor, secrets.token_bytes(32))
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
                directory_fd = os.open(target.parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            if self.delivery_root is None:
                create_key()
            else:
                with runtime_delivery_quota_transaction(self.delivery_root):
                    assert_runtime_delivery_volume_capacity(self.delivery_root, additional_bytes=32)
                    create_key()
        key = target.read_bytes()
        if len(key) != 32:
            raise RuntimeError("watcher attestation key is invalid")
        return key

    @staticmethod
    def _attestation_body(registration: WatchRegistration) -> bytes:
        roots = sorted(
            str(Path(str(row)).expanduser())
            for row in ((registration.metadata or {}).get("cortex_authorized_roots") or [])
            if str(row or "").strip()
        )
        payload = {
            "watch_id": registration.watch_id,
            "process_id": registration.process_id,
            "kind": registration.kind,
            "target": str((registration.metadata or {}).get("cortex_canonical_target") or ""),
            "roots": roots,
        }
        return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")

    def _attest_registration(self, registration: WatchRegistration) -> WatchRegistration:
        if registration.kind not in {"workspace", "log-pattern", "path-state"}:
            return registration
        metadata = dict(registration.metadata or {})
        metadata.pop("cortex_workspace_attestation", None)
        if metadata.get("cortex_workspace_attested_by") == "server" and metadata.get("cortex_authorized_roots"):
            metadata["cortex_authorized_roots"] = sorted(
                str(Path(str(row)).expanduser().resolve(strict=False))
                for row in metadata.get("cortex_authorized_roots") or []
                if str(row or "").strip()
            )
            metadata["cortex_canonical_target"] = str(Path(registration.target).expanduser().resolve(strict=False))
            registration.metadata = metadata
            metadata["cortex_workspace_attestation"] = hmac.new(
                self._attestation_key(),
                self._attestation_body(registration),
                hashlib.sha256,
            ).hexdigest()
        registration.metadata = metadata
        return registration

    def _registration_attestation_valid(self, registration: WatchRegistration) -> bool:
        if registration.kind not in {"workspace", "log-pattern", "path-state"}:
            return True
        supplied = str((registration.metadata or {}).get("cortex_workspace_attestation") or "")
        if not supplied:
            return False
        expected = hmac.new(self._attestation_key(), self._attestation_body(registration), hashlib.sha256).hexdigest()
        return hmac.compare_digest(supplied, expected)

    @contextmanager
    def _open_attested_target(self, registration: WatchRegistration):
        """Open the attested target without following any path component."""

        metadata = dict(registration.metadata or {})
        target = Path(str(metadata.get("cortex_canonical_target") or ""))
        roots = [Path(str(row)) for row in metadata.get("cortex_authorized_roots") or []]
        root = next((row for row in roots if target == row or target.is_relative_to(row)), None)
        if root is None or not root.is_absolute() or not target.is_absolute():
            yield None
            return
        descriptors: List[int] = []
        opened = None
        try:
            current = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
            descriptors.append(current)
            for component in root.parts[1:]:
                current = os.open(
                    component,
                    os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
                    dir_fd=current,
                )
                descriptors.append(current)
            relative_parts = target.relative_to(root).parts
            for index, component in enumerate(relative_parts):
                is_last = index == len(relative_parts) - 1
                flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
                if not is_last:
                    flags |= os.O_DIRECTORY
                else:
                    flags |= getattr(os, "O_NONBLOCK", 0)
                current = os.open(component, flags, dir_fd=current)
                descriptors.append(current)
            observed_stat = os.fstat(current)
            if stat_module.S_ISREG(observed_stat.st_mode) or stat_module.S_ISDIR(observed_stat.st_mode):
                opened = (current, observed_stat)
        except (FileNotFoundError, NotADirectoryError, OSError):
            opened = None
        try:
            yield opened
        finally:
            for descriptor in reversed(descriptors):
                try:
                    os.close(descriptor)
                except OSError:
                    pass

    def invalid_file_watcher_ids(self) -> List[str]:
        with self._transaction():
            return [
                row.watch_id
                for row in self.list()
                if row.kind in {"workspace", "log-pattern", "path-state"}
                and not self._registration_attestation_valid(row)
            ]

    @contextmanager
    def _transaction(self):
        with self._mutex:
            if self._lock_depth:
                self._lock_depth += 1
                try:
                    yield
                finally:
                    self._lock_depth -= 1
                return
            self.path.parent.mkdir(parents=True, exist_ok=True)
            lock_path = self.path.with_suffix(self.path.suffix + ".lock")
            with lock_path.open("a+b") as handle:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                self._lock_depth = 1
                try:
                    yield
                finally:
                    self._lock_depth = 0
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

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
        encoded = (json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
        def commit() -> None:
            temporary = self.path.with_name(f".{self.path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
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
                if temporary.exists():
                    temporary.unlink()
        if self.delivery_root is None:
            commit()
        else:
            with runtime_delivery_quota_transaction(self.delivery_root):
                registrations = data.get("registrations") if isinstance(data.get("registrations"), list) else []
                process_ids = sorted({
                    str(row.get("process_id") or "")
                    for row in registrations
                    if isinstance(row, dict) and str(row.get("process_id") or "")
                })
                for process_id in process_ids:
                    assert_process_count(self.path, process_id, delivery_root=self.delivery_root)
                assert_runtime_delivery_capacity(
                    delivery_root=self.delivery_root,
                    store_root=self.path,
                    process_id=process_ids[0] if process_ids else "watcher-system",
                    object_bytes=len(encoded),
                    additional_bytes=len(encoded),
                    replacing=self.path,
                )
                commit()

    def register(self, registration: WatchRegistration | Dict[str, Any]) -> WatchRegistration:
        with self._transaction():
            model = registration if isinstance(registration, WatchRegistration) else (WatchRegistration.model_validate(registration) if hasattr(WatchRegistration, "model_validate") else WatchRegistration.parse_obj(registration))
            model = self._attest_registration(model)
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

    def replace_process(
        self,
        *,
        process_id: str,
        registrations: List[WatchRegistration | Dict[str, Any]],
    ) -> List[WatchRegistration]:
        """Atomically restore one process's rollback-owned watcher projection."""

        process = str(process_id or "").strip()
        if not process:
            raise ValueError("process_id must be non-empty")
        restored = [
            row
            if isinstance(row, WatchRegistration)
            else (WatchRegistration.model_validate(row) if hasattr(WatchRegistration, "model_validate") else WatchRegistration.parse_obj(row))
            for row in registrations
        ]
        if any(row.process_id != process for row in restored):
            raise ValueError("watcher restore contains a different process")
        with self._transaction():
            data = self._load()
            current = [row for row in data.get("registrations") or [] if isinstance(row, dict)]
            removed_ids = {
                str(row.get("watch_id") or "")
                for row in current
                if str(row.get("process_id") or "").strip() == process
            }
            retained = [row for row in current if str(row.get("process_id") or "").strip() != process]
            restored_payloads = [row.model_dump() if hasattr(row, "model_dump") else row.dict() for row in restored]
            data["registrations"] = retained + restored_payloads
            runtime = data.get("runtime") if isinstance(data.get("runtime"), dict) else {}
            for watch_id in removed_ids | {row.watch_id for row in restored}:
                runtime.pop(watch_id, None)
            data["runtime"] = runtime
            self._write(data)
        return restored

    def _runtime_row(self, data: Dict[str, Any], watch_id: str) -> Dict[str, Any]:
        runtime = data.setdefault("runtime", {})
        row = runtime.setdefault(watch_id, {})
        return row if isinstance(row, dict) else {}

    def reconcile(
        self,
        *,
        session_registry: Optional[SessionRegistryStore] = None,
        now: Optional[datetime] = None,
        process_id: Optional[str] = None,
    ) -> List[CanonicalSessionEvent]:
        with self._transaction():
            return self._reconcile_locked(
                session_registry=session_registry,
                now=now,
                process_id=process_id,
            )

    def _reconcile_locked(
        self,
        *,
        session_registry: Optional[SessionRegistryStore],
        now: Optional[datetime],
        process_id: Optional[str],
    ) -> List[CanonicalSessionEvent]:
        now_dt = now or _now_dt()
        now_iso = now_dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        data = self._load()
        emitted: List[CanonicalSessionEvent] = []

        registrations = self.list()
        for registration in registrations:
            if process_id and registration.process_id != process_id:
                continue
            if not registration.enabled:
                continue
            runtime_row = self._runtime_row(data, registration.watch_id)
            if registration.kind in {"workspace", "log-pattern", "path-state"}:
                if not self._registration_attestation_valid(registration):
                    continue

            if registration.kind == "workspace":
                signature = None
                with self._open_attested_target(registration) as opened:
                    if opened is not None:
                        _, observed_stat = opened
                        signature = f"{observed_stat.st_mtime_ns}:{observed_stat.st_size}"
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
                with self._open_attested_target(registration) as opened:
                    if opened is None or not stat_module.S_ISREG(opened[1].st_mode):
                        continue
                    descriptor = opened[0]
                    os.lseek(descriptor, 0, os.SEEK_SET)
                    content_bytes = os.read(descriptor, 8 * 1024 * 1024 + 1)
                if len(content_bytes) > 8 * 1024 * 1024:
                    continue
                content = content_bytes.decode("utf-8", errors="ignore")
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
                with self._open_attested_target(registration) as opened:
                    exists = opened is not None
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
