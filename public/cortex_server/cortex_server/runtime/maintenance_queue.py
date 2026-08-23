from __future__ import annotations

import json
import fcntl
import threading
import hashlib
import re
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from cortex_server.runtime.runtime_delivery_quota import (
    assert_process_count,
    assert_runtime_delivery_capacity,
    runtime_delivery_quota_transaction,
)
from cortex_server.runtime.resilient_json_state import (
    ResilientJSONStateStore,
    StateCorruptionError,
)


JsonDict = Dict[str, Any]
ALLOWED_QUEUE_STATUSES = {"pending", "active", "completed", "blocked"}
MAX_PROCESS_ID_LENGTH = 128


def _requeue_process_id(item: "MaintenanceQueueItem", metadata: JsonDict, generation: int) -> tuple[str, str]:
    """Return a bounded ID derived from one stable base, never its predecessor."""
    stored_base = str(metadata.get("mission_control_process_id_base") or "").strip()
    current = str(item.process_id or "").strip()
    # Old queue files did not persist a base and may already contain a recursive
    # chain.  Peel every generated suffix during the one-time migration.
    base = stored_base or re.sub(r"(?:_rq\d+)+$", "", current) or f"proc_{item.item_id}"
    suffix = f"_rq{generation}"
    if len(base) + len(suffix) <= MAX_PROCESS_ID_LENGTH:
        return f"{base}{suffix}", base
    digest = hashlib.sha256(base.encode("utf-8")).hexdigest()[:16]
    room = MAX_PROCESS_ID_LENGTH - len(suffix) - len(digest) - 1
    bounded_base = f"{base[:max(1, room)]}_{digest}"
    return f"{bounded_base}{suffix}", base



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")



def _item_id() -> str:
    return f"maint_{uuid4().hex[:16]}"


def _parse_iso_timestamp(value: Any) -> datetime:
    parsed = datetime.fromisoformat(str(value or "").strip().replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _next_version(previous: str) -> str:
    candidate = _now_iso()
    previous_at = _parse_iso_timestamp(previous)
    candidate_at = _parse_iso_timestamp(candidate)
    if candidate_at > previous_at:
        return candidate
    return (previous_at + timedelta(milliseconds=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _validate_max_active_items(value: Any) -> int:
    if type(value) is not int or value < 1:
        raise ValueError("max_active_items must be a positive integer")
    return value


class MaintenanceQueueItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: str = Field(default_factory=_item_id)
    queue_name: str = "maintenance"
    status: str = "pending"
    priority: int = 100
    objective: str
    summary: Optional[str] = None
    item_kind: str = "maintenance"
    source_text: str
    source_message: JsonDict = Field(default_factory=dict)
    roadmap_contract: JsonDict = Field(default_factory=dict)
    process_id: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    claimed_at: Optional[str] = None
    completed_at: Optional[str] = None
    blocked_at: Optional[str] = None
    last_transition_at: str = Field(default_factory=_now_iso)
    projection: JsonDict = Field(default_factory=dict)
    metadata: JsonDict = Field(default_factory=dict)

    @field_validator("item_id", "queue_name", "status", "objective", "item_kind", "source_text", "created_at", "last_transition_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("status")
    @classmethod
    def _validate_status(cls, value: str) -> str:
        text = str(value or "").strip()
        if text not in ALLOWED_QUEUE_STATUSES:
            raise ValueError(f"status must be one of {sorted(ALLOWED_QUEUE_STATUSES)}")
        return text

    @field_validator("priority")
    @classmethod
    def _validate_priority(cls, value: int) -> int:
        return int(value or 0)

    @field_validator("created_at", "claimed_at", "completed_at", "blocked_at", "last_transition_at")
    @classmethod
    def _validate_timestamp(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = str(value or "").strip()
        if not text:
            raise ValueError("timestamp must be non-empty when provided")
        datetime.fromisoformat(text.replace("Z", "+00:00"))
        return text


class MaintenanceQueueState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str = "cortex.maintenance_queue.v1"
    updated_at: str = Field(default_factory=_now_iso)
    max_active_items: int = 1
    items: List[MaintenanceQueueItem] = Field(default_factory=list)

    @field_validator("version", "updated_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("updated_at")
    @classmethod
    def _validate_timestamp(cls, value: str) -> str:
        text = str(value or "").strip()
        datetime.fromisoformat(text.replace("Z", "+00:00"))
        return text

    @field_validator("max_active_items", mode="before")
    @classmethod
    def _validate_capacity(cls, value: Any) -> int:
        return _validate_max_active_items(value)



def _state_validate(data: JsonDict) -> MaintenanceQueueState:
    if hasattr(MaintenanceQueueState, "model_validate"):
        return MaintenanceQueueState.model_validate(data)
    return MaintenanceQueueState.parse_obj(data)



def _state_dump(model: MaintenanceQueueState) -> JsonDict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _item_validate(data: JsonDict) -> MaintenanceQueueItem:
    if hasattr(MaintenanceQueueItem, "model_validate"):
        return MaintenanceQueueItem.model_validate(data)
    return MaintenanceQueueItem.parse_obj(data)



def _item_dump(model: MaintenanceQueueItem) -> JsonDict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


class MaintenanceQueueStore:
    def __init__(self, path: str | Path, *, max_items: int = 1000, max_state_bytes: int = 4_000_000, delivery_root: Optional[str | Path] = None):
        self.path = Path(path)
        self.max_items = max(1, int(max_items))
        self.max_state_bytes = max(1024, int(max_state_bytes))
        self._mutex = threading.RLock()
        self._lock_depth = 0
        self._guarded_dispatches: set[tuple[str, str]] = set()
        self.delivery_root = Path(delivery_root) if delivery_root is not None else None
        self._state_store = ResilientJSONStateStore(
            self.path,
            validator=self._validate_state_payload,
            max_state_bytes=self.max_state_bytes,
        )

    def _validate_state_payload(self, payload: Any) -> JsonDict:
        if not isinstance(payload, dict):
            raise ValueError("maintenance queue state must be an object")
        items = payload.get("items", [])
        if not isinstance(items, list):
            raise ValueError("maintenance queue items must be a list")
        if len(items) > self.max_items:
            raise ValueError("maintenance queue item count exceeds limit")
        if any(not isinstance(item, dict) for item in items):
            raise ValueError("maintenance queue items must be objects")
        return _state_dump(_state_validate(payload))

    @contextmanager
    def _lock(self):
        with self._mutex:
            if self._lock_depth:
                self._lock_depth += 1
                try:
                    yield
                finally:
                    self._lock_depth -= 1
                return
            with self._state_store._exclusive():
                self._lock_depth = 1
                try:
                    yield
                finally:
                    self._lock_depth = 0

    def _mutate(self, operation):
        with self._lock():
            state = self._load_state()
            result = operation(state)
            self._write_state(state)
            return result

    @contextmanager
    def _dispatch_item_lock(self, item_id: str, *, blocking: bool):
        digest = hashlib.sha256(str(item_id or "").encode("utf-8")).hexdigest()
        lock_path = self.path.parent / f".{self.path.name}.dispatch.{digest}.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+b") as handle:
            flags = fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB)
            try:
                fcntl.flock(handle.fileno(), flags)
            except BlockingIOError:
                yield False
                return
            try:
                yield True
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def _load_state(self) -> MaintenanceQueueState:
        with self._lock():
            try:
                payload = self._state_store._load_locked(
                    default_factory=lambda: _state_dump(MaintenanceQueueState())
                )
            except StateCorruptionError as exc:
                # Keep the public validation contract useful without exposing
                # file paths or silently replacing the malformed evidence.
                cause: Optional[BaseException] = exc
                messages = []
                while cause is not None and len(messages) < 8:
                    messages.append(str(cause))
                    cause = cause.__cause__ or cause.__context__
                details = " ".join(messages)
                if "state exceeds" in details and "byte limit" in details:
                    message = "maintenance queue state exceeds size limit"
                elif "item count exceeds limit" in details:
                    message = "maintenance queue item count exceeds limit"
                elif "state must be an object" in details:
                    message = "maintenance queue state must be an object"
                elif "items must be a list" in details:
                    message = "maintenance queue items must be a list"
                elif "items must be objects" in details:
                    message = "maintenance queue items must be objects"
                else:
                    message = "maintenance queue state requires recovery"
                raise ValueError(message) from exc
            return _state_validate(payload)

    def _write_state(self, state: MaintenanceQueueState) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Active records are never discarded; oldest terminal records go first.
        if len(state.items) > self.max_items:
            active = [row for row in state.items if row.status in {"pending", "active"}]
            terminal = sorted((row for row in state.items if row.status not in {"pending", "active"}), key=lambda row: (row.last_transition_at, row.item_id), reverse=True)
            if len(active) > self.max_items:
                raise ValueError("active maintenance queue exceeds item limit")
            state.items = active + terminal[: self.max_items - len(active)]
        def encode() -> bytes:
            return (
                json.dumps(
                    _state_dump(state),
                    ensure_ascii=False,
                    sort_keys=True,
                    indent=2,
                    allow_nan=False,
                )
                + "\n"
            ).encode("utf-8")

        encoded = encode()
        while len(encoded) > self.max_state_bytes:
            terminal = [row for row in state.items if row.status not in {"pending", "active"}]
            if not terminal:
                raise ValueError("active maintenance queue state exceeds size limit")
            oldest = min(terminal, key=lambda row: (row.last_transition_at, row.item_id))
            state.items.remove(oldest)
            encoded = encode()
        self._validate_state_payload(_state_dump(state))
        if self.delivery_root is None:
            self._state_store._save_encoded_locked(encoded)
        else:
            with runtime_delivery_quota_transaction(self.delivery_root):
                process_ids = sorted({row.process_id for row in state.items})
                for process_id in process_ids:
                    assert_process_count(self.path, process_id, delivery_root=self.delivery_root)
                assert_runtime_delivery_capacity(
                    delivery_root=self.delivery_root,
                    store_root=self.path,
                    process_id=process_ids[0] if process_ids else "maintenance-system",
                    object_bytes=len(encoded),
                    additional_bytes=len(encoded),
                    replacing=self.path,
                )
                self._state_store._save_encoded_locked(encoded)

    def persistence_health(self) -> JsonDict:
        return self._state_store.health

    def get_state(self) -> MaintenanceQueueState:
        return self._load_state()

    def configure(self, *, max_active_items: Optional[int] = None) -> MaintenanceQueueState:
        capacity = None if max_active_items is None else _validate_max_active_items(max_active_items)
        def change(state):
            if capacity is not None: state.max_active_items = capacity
            state.updated_at = _next_version(state.updated_at); return state
        return self._mutate(change)

    def list(
        self,
        *,
        statuses: Optional[Sequence[str]] = None,
        queue_name: Optional[str] = None,
    ) -> List[MaintenanceQueueItem]:
        allowed = {str(row or "").strip() for row in (statuses or []) if str(row or "").strip()}
        rows = []
        for item in self._load_state().items:
            if queue_name and item.queue_name != queue_name:
                continue
            if allowed and item.status not in allowed:
                continue
            rows.append(item)
        rows.sort(key=lambda row: (int(row.priority), str(row.created_at), str(row.item_id)))
        return rows

    def get(self, item_id: str) -> Optional[MaintenanceQueueItem]:
        target = str(item_id or "").strip()
        if not target:
            return None
        for item in self._load_state().items:
            if item.item_id == target:
                return item
        return None

    def enqueue(self, item: MaintenanceQueueItem | JsonDict, *, max_active_items: Optional[int] = None) -> MaintenanceQueueItem:
        capacity = None if max_active_items is None else _validate_max_active_items(max_active_items)
        record = item if isinstance(item, MaintenanceQueueItem) else _item_validate(item)
        def change(state):
            if capacity is not None: state.max_active_items = capacity
            existing = next((x for x in state.items if x.item_id == record.item_id), None)
            if existing is not None: return existing
            state.items.append(record); state.updated_at = _next_version(state.updated_at); return record
        return self._mutate(change)

    def replace_items(self, items: Sequence[MaintenanceQueueItem | JsonDict], *, max_active_items: Optional[int] = None, expected_updated_at: Optional[str] = None) -> MaintenanceQueueState:
        capacity = None if max_active_items is None else _validate_max_active_items(max_active_items)
        records = [row if isinstance(row, MaintenanceQueueItem) else _item_validate(row) for row in items]
        def change(state):
            if expected_updated_at is not None and state.updated_at != expected_updated_at:
                raise RuntimeError("stale maintenance queue version")
            if capacity is not None:
                state.max_active_items = capacity
            state.items = records
            state.updated_at = _next_version(state.updated_at)
            return state
        return self._mutate(change)

    def merge_items(self, items: Sequence[MaintenanceQueueItem | JsonDict], *, expected_updated_at: str) -> MaintenanceQueueState:
        """CAS-update individual records without replacing concurrently added records."""
        records = [row if isinstance(row, MaintenanceQueueItem) else _item_validate(row) for row in items]
        def change(state):
            if state.updated_at != expected_updated_at:
                raise RuntimeError("stale maintenance queue version")
            by_id = {row.item_id: row for row in state.items}
            for record in records:
                if record.item_id in by_id:
                    by_id[record.item_id] = record
            state.items = list(by_id.values())
            state.updated_at = _next_version(state.updated_at)
            return state
        return self._mutate(change)

    def claim_next(self, *, claimed_at: str, process_id_for_item) -> tuple[Optional[MaintenanceQueueItem], MaintenanceQueueState]:
        """Atomically reserve one capacity slot and return only the winning claim."""
        claimed = None
        with self._lock():
            state = self._load_state()
            active_count = sum(1 for row in state.items if row.status == "active")
            if active_count < max(1, int(state.max_active_items or 1)):
                pending = sorted(
                    (row for row in state.items if row.status == "pending"),
                    key=lambda row: (int(row.priority), str(row.created_at), str(row.item_id)),
                )
                if pending:
                    claimed = pending[0]
                    claimed.status = "active"
                    claimed.process_id = claimed.process_id or str(process_id_for_item(claimed))
                    claimed.claimed_at = claimed.claimed_at or claimed_at
                    claimed.last_transition_at = claimed_at
                    state.updated_at = _next_version(state.updated_at)
                    self._write_state(state)
            return claimed, state

    def begin_dispatch(
        self,
        *,
        claimed_at: str,
        lease_expires_at: str,
        owner: str,
        process_id_for_item,
    ) -> tuple[Optional[MaintenanceQueueItem], MaintenanceQueueState]:
        """Atomically claim one item and attach a recoverable dispatch lease."""
        normalized_owner = str(owner or "").strip()
        if not normalized_owner:
            raise ValueError("maintenance dispatch owner must be non-empty")
        # Validate before taking the lock so malformed leases never mutate state.
        _parse_iso_timestamp(lease_expires_at)
        claimed = None
        with self._lock():
            state = self._load_state()
            active_count = sum(1 for row in state.items if row.status == "active")
            if active_count < max(1, int(state.max_active_items or 1)):
                pending = sorted(
                    (row for row in state.items if row.status == "pending"),
                    key=lambda row: (int(row.priority), str(row.created_at), str(row.item_id)),
                )
                if pending:
                    claimed = pending[0]
                    claimed.status = "active"
                    claimed.process_id = claimed.process_id or str(process_id_for_item(claimed))
                    claimed.claimed_at = claimed_at
                    claimed.last_transition_at = claimed_at
                    claimed.metadata = {
                        **dict(claimed.metadata or {}),
                        "maintenance_dispatch_state": "dispatching",
                        "maintenance_dispatch_owner": normalized_owner,
                        "maintenance_dispatch_lease_expires_at": lease_expires_at,
                    }
                    state.updated_at = _next_version(state.updated_at)
                    self._write_state(state)
            return claimed, state

    def release_dispatch(self, item_id: str, *, owner: str, released_at: str, reason: str) -> bool:
        """Return an owned, unfinished dispatch to pending without clobbering another writer."""
        released = False
        with self._lock():
            state = self._load_state()
            item = next((row for row in state.items if row.item_id == item_id), None)
            metadata = dict(item.metadata or {}) if item is not None else {}
            if (
                item is not None
                and item.status == "active"
                and metadata.get("maintenance_dispatch_state") == "dispatching"
                and metadata.get("maintenance_dispatch_owner") == owner
            ):
                metadata.pop("maintenance_dispatch_owner", None)
                metadata.pop("maintenance_dispatch_lease_expires_at", None)
                metadata.update(
                    {
                        "maintenance_dispatch_state": "pending",
                        "maintenance_dispatch_last_failure": str(reason or "dispatch_failed"),
                        "maintenance_dispatch_last_failure_at": released_at,
                    }
                )
                item.status = "pending"
                item.claimed_at = None
                item.last_transition_at = released_at
                item.metadata = metadata
                state.updated_at = _next_version(state.updated_at)
                self._write_state(state)
                released = True
        return released

    def renew_dispatch(
        self,
        item_id: str,
        *,
        owner: str,
        renewed_at: str,
        lease_expires_at: str,
    ) -> bool:
        """Extend a live dispatch lease only while its owner remains fenced in."""
        renewed_at_dt = _parse_iso_timestamp(renewed_at)
        lease_expires_at_dt = _parse_iso_timestamp(lease_expires_at)
        if lease_expires_at_dt <= renewed_at_dt:
            raise ValueError("maintenance dispatch lease expiry must follow renewal time")

        with self._lock():
            state = self._load_state()
            item = next((row for row in state.items if row.item_id == item_id), None)
            metadata = dict(item.metadata or {}) if item is not None else {}
            try:
                current_expiry = _parse_iso_timestamp(metadata.get("maintenance_dispatch_lease_expires_at"))
            except (TypeError, ValueError):
                return False
            if (
                item is None
                or item.status != "active"
                or metadata.get("maintenance_dispatch_state") != "dispatching"
                or metadata.get("maintenance_dispatch_owner") != owner
                or (
                    current_expiry <= renewed_at_dt
                    and (item_id, owner) not in self._guarded_dispatches
                )
            ):
                return False
            metadata.update(
                {
                    "maintenance_dispatch_lease_renewed_at": renewed_at,
                    "maintenance_dispatch_lease_expires_at": lease_expires_at,
                }
            )
            item.metadata = metadata
            state.updated_at = _next_version(state.updated_at)
            self._write_state(state)
            return True

    @contextmanager
    def dispatch_guard(self, item_id: str, *, owner: str, guarded_at: str):
        """Hold a crash-released per-item fence throughout dispatch side effects."""
        guarded_at_dt = _parse_iso_timestamp(guarded_at)
        with self._dispatch_item_lock(item_id, blocking=True) as acquired:
            if not acquired:
                raise RuntimeError(f"maintenance dispatch guard unavailable for '{item_id}'")
            with self._lock():
                state = self._load_state()
                item = next((row for row in state.items if row.item_id == item_id), None)
                metadata = dict(item.metadata or {}) if item is not None else {}
                try:
                    lease_expires_at = _parse_iso_timestamp(metadata.get("maintenance_dispatch_lease_expires_at"))
                except (TypeError, ValueError):
                    raise RuntimeError(f"maintenance dispatch lease lost for '{item_id}'") from None
                if (
                    item is None
                    or item.status != "active"
                    or metadata.get("maintenance_dispatch_state") != "dispatching"
                    or metadata.get("maintenance_dispatch_owner") != owner
                    or lease_expires_at <= guarded_at_dt
                ):
                    raise RuntimeError(f"maintenance dispatch lease lost for '{item_id}'")
                guard_key = (item_id, owner)
                self._guarded_dispatches.add(guard_key)
            try:
                yield
            finally:
                with self._lock():
                    self._guarded_dispatches.discard(guard_key)

    def recover_expired_dispatches(self, *, now: str) -> MaintenanceQueueState:
        """Requeue dispatches whose owner disappeared before durable confirmation."""
        now_at = _parse_iso_timestamp(now)
        with self._lock():
            state = self._load_state()
            changed = False
            for item in state.items:
                metadata = dict(item.metadata or {})
                if item.status != "active" or metadata.get("maintenance_dispatch_state") != "dispatching":
                    continue
                try:
                    expires_at = _parse_iso_timestamp(metadata.get("maintenance_dispatch_lease_expires_at"))
                    expired = expires_at <= now_at
                except (TypeError, ValueError):
                    # A malformed/missing recovery fence must fail closed rather
                    # than permanently consume queue capacity.
                    expired = True
                if not expired:
                    continue
                with self._dispatch_item_lock(item.item_id, blocking=False) as acquired:
                    if not acquired:
                        continue
                    metadata.pop("maintenance_dispatch_owner", None)
                    metadata.pop("maintenance_dispatch_lease_expires_at", None)
                    metadata.update(
                        {
                            "maintenance_dispatch_state": "pending",
                            "maintenance_dispatch_last_failure": "dispatch_lease_expired",
                            "maintenance_dispatch_last_failure_at": now,
                        }
                    )
                    item.status = "pending"
                    item.claimed_at = None
                    item.last_transition_at = now
                    item.metadata = metadata
                    changed = True
            if changed:
                state.updated_at = _next_version(state.updated_at)
                self._write_state(state)
            return state

    def finish_dispatch(self, item: MaintenanceQueueItem | JsonDict, *, owner: str, confirmed_at: str) -> tuple[bool, MaintenanceQueueState]:
        """Publish dispatch results only while the caller still owns the item lease."""
        record = item if isinstance(item, MaintenanceQueueItem) else _item_validate(item)
        confirmed_at_dt = _parse_iso_timestamp(confirmed_at)
        with self._lock():
            state = self._load_state()
            current = next((row for row in state.items if row.item_id == record.item_id), None)
            metadata = dict(current.metadata or {}) if current is not None else {}
            try:
                lease_expires_at = _parse_iso_timestamp(metadata.get("maintenance_dispatch_lease_expires_at"))
            except (TypeError, ValueError):
                return False, state
            if (
                current is None
                or current.status != "active"
                or metadata.get("maintenance_dispatch_state") != "dispatching"
                or metadata.get("maintenance_dispatch_owner") != owner
                or (
                    lease_expires_at <= confirmed_at_dt
                    and (record.item_id, owner) not in self._guarded_dispatches
                )
            ):
                return False, state
            completed_metadata = {**metadata, **dict(record.metadata or {})}
            completed_metadata.pop("maintenance_dispatch_owner", None)
            completed_metadata.pop("maintenance_dispatch_lease_expires_at", None)
            completed_metadata.update(
                {
                    "maintenance_dispatch_state": "confirmed",
                    "maintenance_dispatch_confirmed_at": confirmed_at,
                }
            )
            record.metadata = completed_metadata
            state.items = [record if row.item_id == record.item_id else row for row in state.items]
            state.updated_at = _next_version(state.updated_at)
            self._write_state(state)
            return True, state

    def requeue(
        self,
        item_id: str,
        *,
        actor: str,
        reason: str,
        requeued_at: Optional[str] = None,
        before_publish: Optional[Callable[[Optional[str]], None]] = None,
    ) -> tuple[MaintenanceQueueItem, Optional[str]]:
        """Atomically start the next generation after its predecessor is quiescent."""
        target = str(item_id or "").strip()
        if not target:
            raise ValueError("maintenance queue item_id must be non-empty")
        transition_at = str(requeued_at or _now_iso()).strip()
        normalized_actor = str(actor or "cortex").strip() or "cortex"
        normalized_reason = str(reason or "operator_requeue").strip() or "operator_requeue"

        with self._lock():
            state = self._load_state()
            item = next((row for row in state.items if row.item_id == target), None)
            if item is None:
                raise KeyError(target)
            if item.status not in {"blocked", "completed"}:
                raise RuntimeError(f"maintenance item '{target}' is not requeueable from status '{item.status}'")

            old_process_id = str(item.process_id or "").strip() or None
            # Keep the terminal item non-claimable and retain exclusive queue
            # ownership until the caller has made the prior generation safe.
            # If the callback raises (including process crash/persistence
            # failure), no queue mutation is written and requeue can be retried.
            if before_publish is not None:
                before_publish(old_process_id)
            metadata = dict(item.metadata or {})
            generation = int(metadata.get("mission_control_requeue_count", 0) or 0) + 1
            next_process_id, process_id_base = _requeue_process_id(item, metadata, generation)
            metadata.update(
                {
                    "mission_control_requeue_count": generation,
                    "mission_control_process_id_base": process_id_base,
                    "mission_control_last_requeue_at": transition_at,
                    "mission_control_last_requeue_reason": normalized_reason,
                    "mission_control_last_requeue_actor": normalized_actor,
                    "mission_control_previous_process_id": old_process_id,
                }
            )
            item.status = "pending"
            item.process_id = next_process_id
            item.claimed_at = None
            item.completed_at = None
            item.blocked_at = None
            item.last_transition_at = transition_at
            item.projection = {}
            item.metadata = metadata
            state.updated_at = _next_version(state.updated_at)
            self._write_state(state)
            return item, old_process_id

    def save(self, item: MaintenanceQueueItem | JsonDict, *, max_active_items: Optional[int] = None, expected_updated_at: Optional[str] = None) -> MaintenanceQueueItem:
        capacity = None if max_active_items is None else _validate_max_active_items(max_active_items)
        record = item if isinstance(item, MaintenanceQueueItem) else _item_validate(item)
        with self._lock():
            current = self._load_state()
            if expected_updated_at is not None and current.updated_at != expected_updated_at:
                raise RuntimeError("stale maintenance queue version")
            by_id = {row.item_id: row for row in current.items}
            by_id[record.item_id] = record
            current.items = list(by_id.values())
            if capacity is not None: current.max_active_items = capacity
            current.updated_at = _next_version(current.updated_at)
            self._write_state(current)
        return record


__all__ = [
    "ALLOWED_QUEUE_STATUSES",
    "MaintenanceQueueItem",
    "MaintenanceQueueState",
    "MaintenanceQueueStore",
]
