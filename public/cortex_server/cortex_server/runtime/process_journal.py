from __future__ import annotations

import fcntl
import json
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence
from uuid import uuid4

from cortex_server.runtime.process_event import ProcessEvent
from cortex_server.runtime.durable_files import fsync_directory
from cortex_server.runtime.runtime_delivery_quota import (
    MAX_RUNTIME_DELIVERY_OBJECT_BYTES,
    assert_runtime_delivery_volume_capacity,
    runtime_delivery_quota_transaction,
)


JsonDict = Dict[str, Any]
MAX_PROCESS_JOURNAL_RECORDS = 65_536
MAX_PROCESS_JOURNAL_BYTES = 256 * 1024 * 1024
MAX_PROCESS_JOURNAL_RECORDS_PER_PROCESS = 4096
MAX_PROCESS_JOURNAL_BYTES_PER_PROCESS = 64 * 1024 * 1024



def _model_validate_compat(data: JsonDict) -> ProcessEvent:
    if hasattr(ProcessEvent, "model_validate"):
        return ProcessEvent.model_validate(data)
    return ProcessEvent.parse_obj(data)



def _model_dump_compat(model: ProcessEvent) -> JsonDict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _coerce_event(event: Optional[ProcessEvent | JsonDict] = None, **kwargs: Any) -> ProcessEvent:
    if isinstance(event, ProcessEvent):
        if kwargs:
            raise TypeError("cannot pass both event and keyword fields")
        return event
    if event is None:
        return ProcessEvent(**kwargs)
    if isinstance(event, dict):
        if kwargs:
            raise TypeError("cannot pass both event mapping and keyword fields")
        return _model_validate_compat(event)
    raise TypeError("event must be ProcessEvent, mapping, or None")


class ProcessJournal:
    def __init__(self, path: str | Path, *, delivery_root: Optional[str | Path] = None):
        self.path = Path(path)
        self.delivery_root = Path(delivery_root) if delivery_root is not None else self.path.parent

    @property
    def _lock_path(self) -> Path:
        return self.path.with_name(f".{self.path.name}.lock")

    @contextmanager
    def _locked(self, *, exclusive: bool):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock_path.open("a+b") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    @staticmethod
    def _fsync_directory(path: Path) -> None:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def _committed_payloads_unlocked(self) -> List[JsonDict]:
        if not self.path.exists():
            return []
        encoded = self.path.read_bytes()
        rows: List[JsonDict] = []
        lines = encoded.splitlines(keepends=True)
        for index, raw_line in enumerate(lines):
            complete = raw_line.endswith(b"\n")
            if index == len(lines) - 1 and not complete:
                # Newline is the commit frame. A valid-looking unterminated
                # object can still be only a prefix of the intended append.
                break
            text = raw_line.strip()
            if not text:
                continue
            try:
                payload = json.loads(text.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise ValueError(f"corrupt committed process journal record at line {index + 1}")
            if not isinstance(payload, dict):
                raise ValueError(f"process journal record at line {index + 1} must be an object")
            rows.append(payload)
        return rows

    def _repair_torn_tail_unlocked(self) -> None:
        if not self.path.exists():
            return
        encoded = self.path.read_bytes()
        if not encoded or encoded.endswith(b"\n"):
            return
        # Validate the committed prefix before removing only the unframed tail.
        self._committed_payloads_unlocked()
        committed_length = encoded.rfind(b"\n") + 1
        with self.path.open("r+b") as handle:
            handle.truncate(committed_length)
            handle.flush()
            os.fsync(handle.fileno())

    def _append_payloads_unlocked(self, payloads: List[JsonDict]) -> None:
        committed = self._committed_payloads_unlocked()
        new_encoded_rows = [(json.dumps(payload, sort_keys=True) + "\n").encode("utf-8") for payload in payloads]
        if any(len(row) > MAX_RUNTIME_DELIVERY_OBJECT_BYTES for row in new_encoded_rows):
            raise ValueError("process journal record exceeds immutable object quota")
        if (
            len(new_encoded_rows) > MAX_PROCESS_JOURNAL_RECORDS
            or sum(len(row) for row in new_encoded_rows) > MAX_PROCESS_JOURNAL_BYTES
        ):
            raise ValueError("process journal append exceeds immutable journal quota")
        for process_id in {str(payload.get("process_id") or "") for payload in payloads}:
            process_rows = [
                row
                for payload, row in zip(payloads, new_encoded_rows)
                if str(payload.get("process_id") or "") == process_id
            ]
            if (
                len(process_rows) > MAX_PROCESS_JOURNAL_RECORDS_PER_PROCESS
                or sum(len(row) for row in process_rows) > MAX_PROCESS_JOURNAL_BYTES_PER_PROCESS
            ):
                raise ValueError("process journal append exceeds per-process quota")
        combined = [
            (payload, (json.dumps(payload, sort_keys=True) + "\n").encode("utf-8"))
            for payload in committed
        ] + list(zip(payloads, new_encoded_rows))
        compact = False
        for process_id in {str(payload.get("process_id") or "") for payload in payloads}:
            process_indexes = [
                index
                for index, (payload, _row) in enumerate(combined)
                if str(payload.get("process_id") or "") == process_id
            ]
            process_bytes = sum(len(combined[index][1]) for index in process_indexes)
            while (
                len(process_indexes) > MAX_PROCESS_JOURNAL_RECORDS_PER_PROCESS
                or process_bytes > MAX_PROCESS_JOURNAL_BYTES_PER_PROCESS
            ):
                removed_index = process_indexes.pop(0)
                process_bytes -= len(combined[removed_index][1])
                combined[removed_index] = ({}, b"")
                compact = True
        combined = [(payload, row) for payload, row in combined if row]
        encoded_rows = [row for _payload, row in combined]
        compact = compact or len(encoded_rows) > MAX_PROCESS_JOURNAL_RECORDS or sum(
            len(row) for row in encoded_rows
        ) > MAX_PROCESS_JOURNAL_BYTES
        if not compact:
            encoded = b"".join(new_encoded_rows)
            with runtime_delivery_quota_transaction(self.delivery_root):
                assert_runtime_delivery_volume_capacity(
                    self.delivery_root,
                    additional_bytes=len(encoded),
                )
                self._repair_torn_tail_unlocked()
                created = not self.path.exists()
                fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
                try:
                    view = memoryview(encoded)
                    while view:
                        written = os.write(fd, view)
                        if written <= 0:
                            raise OSError("process journal append made no progress")
                        view = view[written:]
                    os.fsync(fd)
                finally:
                    os.close(fd)
                if created:
                    self._fsync_directory(self.path.parent)
            return
        encoded_rows = encoded_rows[-MAX_PROCESS_JOURNAL_RECORDS:]
        total_bytes = sum(len(row) for row in encoded_rows)
        while encoded_rows and total_bytes > MAX_PROCESS_JOURNAL_BYTES:
            total_bytes -= len(encoded_rows[0])
            encoded_rows.pop(0)
        if not encoded_rows or len(encoded_rows) < len(payloads):
            raise ValueError("process journal append exceeds immutable journal quota")
        encoded = b"".join(encoded_rows)
        temporary = self.path.with_name(f".{self.path.name}.{os.getpid()}.{uuid4().hex}.tmp")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with runtime_delivery_quota_transaction(self.delivery_root):
                assert_runtime_delivery_volume_capacity(
                    self.delivery_root,
                    additional_bytes=len(encoded),
                )
                with temporary.open("xb") as handle:
                    os.fchmod(handle.fileno(), 0o600)
                    handle.write(encoded)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, self.path)
                fsync_directory(self.path.parent)
        finally:
            if temporary.exists():
                temporary.unlink()

    def append(self, event: Optional[ProcessEvent | JsonDict] = None, **kwargs: Any) -> ProcessEvent:
        record = _coerce_event(event, **kwargs)
        with self._locked(exclusive=True):
            self._append_payloads_unlocked([_model_dump_compat(record)])
        return record

    def append_many(self, events: Iterable[ProcessEvent | JsonDict]) -> List[ProcessEvent]:
        rows = [_coerce_event(event) for event in events]
        if not rows:
            return []
        with self._locked(exclusive=True):
            self._append_payloads_unlocked([_model_dump_compat(row) for row in rows])
        return rows

    def load(self, *, process_id: Optional[str] = None, kinds: Optional[Sequence[str]] = None) -> List[ProcessEvent]:
        rows: List[ProcessEvent] = []
        allowed_kinds = {str(kind).strip() for kind in (kinds or []) if str(kind).strip()}
        with self._locked(exclusive=False):
            payloads = self._committed_payloads_unlocked()
        for payload in payloads:
            record = _model_validate_compat(payload)
            if process_id and record.process_id != process_id:
                continue
            if allowed_kinds and record.kind not in allowed_kinds:
                continue
            rows.append(record)
        return rows

    def latest(self, *, process_id: Optional[str] = None) -> Optional[ProcessEvent]:
        rows = self.load(process_id=process_id)
        return rows[-1] if rows else None


__all__ = ["ProcessJournal"]
