from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from cortex_server.modules.route_health import ROUTE_HEALTH, RouteHealthMonitor
from cortex_server.runtime.runtime_delivery_quota import (
    MAX_RUNTIME_DELIVERY_OBJECT_BYTES,
    append_bounded_jsonl,
    assert_runtime_delivery_volume_capacity,
    bounded_jsonl_payload,
    encoded_json,
    read_recoverable_jsonl,
    runtime_delivery_quota_transaction,
)


JsonDict = Dict[str, Any]
MAX_DELIVERY_DEAD_LETTERS = 4096
MAX_DELIVERY_DEAD_LETTER_BYTES = 32 * 1024 * 1024


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _entry_id() -> str:
    return f"dlq_{uuid4().hex[:16]}"


class DeliveryDeadLetterEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entry_id: str = Field(default_factory=_entry_id)
    dependency: str
    process_id: Optional[str] = None
    target: Optional[str] = None
    event_kind: Optional[str] = None
    error: str
    payload: JsonDict = Field(default_factory=dict)
    created_at: str = Field(default_factory=_now_iso)

    @field_validator("entry_id", "dependency", "error", "created_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text


class DeliveryDeadLetterStore:
    def __init__(self, path: str | Path, *, delivery_root: Optional[str | Path] = None):
        self.path = Path(path)
        self.delivery_root = Path(delivery_root) if delivery_root is not None else self.path.parent

    def append(self, entry: DeliveryDeadLetterEntry | Dict[str, Any]) -> DeliveryDeadLetterEntry:
        model = entry if isinstance(entry, DeliveryDeadLetterEntry) else (DeliveryDeadLetterEntry.model_validate(entry) if hasattr(DeliveryDeadLetterEntry, "model_validate") else DeliveryDeadLetterEntry.parse_obj(entry))
        payload = model.model_dump() if hasattr(model, "model_dump") else model.dict()
        encoded = encoded_json(payload)
        if len(encoded) > MAX_RUNTIME_DELIVERY_OBJECT_BYTES:
            raise ValueError("delivery dead-letter record exceeds immutable object quota")
        with runtime_delivery_quota_transaction(self.delivery_root):
            projected = bounded_jsonl_payload(
                self.path,
                payload,
                max_records=MAX_DELIVERY_DEAD_LETTERS,
                max_bytes=MAX_DELIVERY_DEAD_LETTER_BYTES,
            )
            assert_runtime_delivery_volume_capacity(
                self.delivery_root,
                additional_bytes=len(projected),
            )
            append_bounded_jsonl(
                self.path,
                payload,
                max_records=MAX_DELIVERY_DEAD_LETTERS,
                max_bytes=MAX_DELIVERY_DEAD_LETTER_BYTES,
            )
        return model

    def list(self, *, dependency: Optional[str] = None) -> List[DeliveryDeadLetterEntry]:
        if not self.path.exists():
            return []
        rows: List[DeliveryDeadLetterEntry] = []
        for raw in read_recoverable_jsonl(self.path):
            if dependency and str(raw.get("dependency") or "") != dependency:
                continue
            rows.append(DeliveryDeadLetterEntry.model_validate(raw) if hasattr(DeliveryDeadLetterEntry, "model_validate") else DeliveryDeadLetterEntry.parse_obj(raw))
        return rows


def resilient_delivery_attempt(
    dependency: str,
    operation: Callable[[], Any],
    *,
    process_id: Optional[str] = None,
    target: Optional[str] = None,
    event_kind: Optional[str] = None,
    payload: Optional[JsonDict] = None,
    route_health: Optional[RouteHealthMonitor] = None,
    dlq_store: Optional[DeliveryDeadLetterStore] = None,
) -> JsonDict:
    monitor = route_health or ROUTE_HEALTH
    gate = monitor.allow(dependency)
    if not gate.get("allowed"):
        entry = None
        if dlq_store is not None:
            entry = dlq_store.append(
                DeliveryDeadLetterEntry(
                    dependency=dependency,
                    process_id=process_id,
                    target=target,
                    event_kind=event_kind,
                    error=str(gate.get("reason") or "breaker_open"),
                    payload=dict(payload or {}),
                )
            )
        return {
            "success": False,
            "dependency": dependency,
            "queued": True,
            "state": gate.get("state"),
            "reason": gate.get("reason"),
            "seconds_remaining": gate.get("seconds_remaining"),
            "dlq_entry_id": entry.entry_id if entry is not None else None,
        }

    started = time.perf_counter()
    try:
        result = operation()
        latency_ms = (time.perf_counter() - started) * 1000.0
        monitor.record_success(dependency, latency_ms=latency_ms)
        return {
            "success": True,
            "dependency": dependency,
            "queued": False,
            "latency_ms": round(latency_ms, 2),
            "result": result,
        }
    except Exception as exc:
        latency_ms = (time.perf_counter() - started) * 1000.0
        monitor.record_failure(dependency, error=str(exc), latency_ms=latency_ms)
        entry = None
        if dlq_store is not None:
            entry = dlq_store.append(
                DeliveryDeadLetterEntry(
                    dependency=dependency,
                    process_id=process_id,
                    target=target,
                    event_kind=event_kind,
                    error=str(exc),
                    payload=dict(payload or {}),
                )
            )
        return {
            "success": False,
            "dependency": dependency,
            "queued": bool(entry is not None),
            "error": str(exc),
            "latency_ms": round(latency_ms, 2),
            "dlq_entry_id": entry.entry_id if entry is not None else None,
        }


__all__ = [
    "DeliveryDeadLetterEntry",
    "DeliveryDeadLetterStore",
    "ValidationError",
    "resilient_delivery_attempt",
]
