from __future__ import annotations

import fcntl
import json
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

from cortex_server.runtime.process_event import ProcessEvent


JsonDict = Dict[str, Any]



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
    def __init__(self, path: str | Path):
        self.path = Path(path)

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
        self._repair_torn_tail_unlocked()
        created = not self.path.exists()
        flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND
        fd = os.open(self.path, flags, 0o600)
        try:
            encoded = b"".join(
                (json.dumps(payload, sort_keys=True) + "\n").encode("utf-8")
                for payload in payloads
            )
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
