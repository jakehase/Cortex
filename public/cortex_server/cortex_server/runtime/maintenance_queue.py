from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


JsonDict = Dict[str, Any]
ALLOWED_QUEUE_STATUSES = {"pending", "active", "completed", "blocked"}



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")



def _item_id() -> str:
    return f"maint_{uuid4().hex[:16]}"


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

    @field_validator("max_active_items")
    @classmethod
    def _validate_capacity(cls, value: int) -> int:
        number = int(value or 0)
        if number < 1:
            raise ValueError("max_active_items must be at least 1")
        return number



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
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _load_state(self) -> MaintenanceQueueState:
        if not self.path.exists():
            return MaintenanceQueueState()
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        return _state_validate(payload if isinstance(payload, dict) else {})

    def _write_state(self, state: MaintenanceQueueState) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = _state_dump(state)
        self.path.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8")

    def get_state(self) -> MaintenanceQueueState:
        return self._load_state()

    def configure(self, *, max_active_items: Optional[int] = None) -> MaintenanceQueueState:
        state = self._load_state()
        if max_active_items is not None:
            state.max_active_items = int(max_active_items)
        state.updated_at = _now_iso()
        self._write_state(state)
        return state

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
        record = item if isinstance(item, MaintenanceQueueItem) else _item_validate(item)
        state = self._load_state()
        if max_active_items is not None:
            state.max_active_items = int(max_active_items)
        for existing in state.items:
            if existing.item_id == record.item_id:
                return existing
        state.items.append(record)
        state.updated_at = _now_iso()
        self._write_state(state)
        return record

    def replace_items(self, items: Sequence[MaintenanceQueueItem | JsonDict], *, max_active_items: Optional[int] = None) -> MaintenanceQueueState:
        state = self._load_state()
        if max_active_items is not None:
            state.max_active_items = int(max_active_items)
        state.items = [row if isinstance(row, MaintenanceQueueItem) else _item_validate(row) for row in items]
        state.updated_at = _now_iso()
        self._write_state(state)
        return state

    def save(self, item: MaintenanceQueueItem | JsonDict, *, max_active_items: Optional[int] = None) -> MaintenanceQueueItem:
        record = item if isinstance(item, MaintenanceQueueItem) else _item_validate(item)
        state = self._load_state()
        if max_active_items is not None:
            state.max_active_items = int(max_active_items)
        replaced = False
        new_items: List[MaintenanceQueueItem] = []
        for existing in state.items:
            if existing.item_id == record.item_id:
                new_items.append(record)
                replaced = True
            else:
                new_items.append(existing)
        if not replaced:
            new_items.append(record)
        state.items = new_items
        state.updated_at = _now_iso()
        self._write_state(state)
        return record


__all__ = [
    "ALLOWED_QUEUE_STATUSES",
    "MaintenanceQueueItem",
    "MaintenanceQueueState",
    "MaintenanceQueueStore",
]
