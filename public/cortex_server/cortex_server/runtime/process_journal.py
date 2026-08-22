from __future__ import annotations

import fcntl
import hashlib
import json
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence
from uuid import uuid4

from cortex_server.runtime.process_event import ProcessEvent
from cortex_server.runtime.durable_files import durable_mkdir, fsync_directory
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
PROCESS_JOURNAL_CHECKPOINT_VERSION = "cortex.process-journal-checkpoint.v1"
PROCESS_JOURNAL_CHECKPOINT_ANCHOR_KIND = "journal_checkpoint_anchor"



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

    @property
    def _checkpoint_root(self) -> Path:
        return self.path.with_name(f".{self.path.name}.checkpoints")

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

    @staticmethod
    def _encoded_row(payload: JsonDict) -> bytes:
        return (json.dumps(payload, sort_keys=True) + "\n").encode("utf-8")

    @staticmethod
    def _is_checkpoint_anchor(payload: JsonDict) -> bool:
        return str(payload.get("kind") or "") == PROCESS_JOURNAL_CHECKPOINT_ANCHOR_KIND

    def _checkpoint_payload_unlocked(self, anchor: JsonDict) -> JsonDict:
        anchor_payload = anchor.get("payload")
        if not isinstance(anchor_payload, dict):
            raise ValueError("process journal checkpoint anchor payload is invalid")
        checkpoint_ref = str(anchor_payload.get("checkpoint_ref") or "")
        checkpoint_digest = str(anchor_payload.get("checkpoint_digest") or "")
        if (
            not checkpoint_ref.startswith("sha256:")
            or not checkpoint_digest.startswith("sha256:")
            or checkpoint_ref != checkpoint_digest
        ):
            raise ValueError("process journal checkpoint anchor digest is invalid")
        digest = checkpoint_ref.removeprefix("sha256:")
        if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
            raise ValueError("process journal checkpoint anchor digest is invalid")
        target = self._checkpoint_root / f"{digest}.json"
        try:
            encoded = target.read_bytes()
        except FileNotFoundError as exc:
            raise ValueError("process journal checkpoint anchor target is missing") from exc
        observed_digest = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
        if observed_digest != checkpoint_digest:
            raise ValueError("process journal checkpoint digest mismatch")
        try:
            checkpoint = json.loads(encoded)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("process journal checkpoint is corrupt") from exc
        if not isinstance(checkpoint, dict):
            raise ValueError("process journal checkpoint must be an object")
        process_id = str(anchor.get("process_id") or "")
        state = checkpoint.get("state")
        if (
            checkpoint.get("version") != PROCESS_JOURNAL_CHECKPOINT_VERSION
            or str(checkpoint.get("process_id") or "") != process_id
            or not isinstance(state, dict)
            or str(state.get("process_id") or "") != process_id
            or int(checkpoint.get("cumulative_event_count", -1)) < 0
            or int(state.get("event_count", -1)) != int(checkpoint.get("cumulative_event_count", -1))
            or state.get("last_event_id") != checkpoint.get("last_event_id")
            or checkpoint.get("prefix_hash") != anchor_payload.get("prefix_hash")
            or checkpoint.get("last_event_id") != anchor_payload.get("last_event_id")
            or int(checkpoint.get("cumulative_event_count", -1))
            != int(anchor_payload.get("cumulative_event_count", -2))
        ):
            raise ValueError("process journal checkpoint does not match its anchor")
        return checkpoint

    def _checkpoint_for_process_unlocked(
        self,
        process_id: str,
        payloads: Sequence[JsonDict],
    ) -> Optional[JsonDict]:
        anchors = [
            payload
            for payload in payloads
            if str(payload.get("process_id") or "") == process_id
            and self._is_checkpoint_anchor(payload)
        ]
        if len(anchors) > 1:
            raise ValueError(f"multiple process journal checkpoint anchors for {process_id}")
        return self._checkpoint_payload_unlocked(anchors[0]) if anchors else None

    def _replay_payloads_unlocked(
        self,
        process_id: str,
        payloads: Sequence[JsonDict],
    ) -> JsonDict:
        from cortex_server.runtime.process_replay import apply_event, default_process_state

        checkpoint = self._checkpoint_for_process_unlocked(process_id, payloads)
        state = dict(checkpoint["state"]) if checkpoint else default_process_state(process_id)
        for payload in payloads:
            if str(payload.get("process_id") or "") != process_id or self._is_checkpoint_anchor(payload):
                continue
            state = apply_event(state, _model_validate_compat(payload))
        return state

    def _prefix_hash_unlocked(
        self,
        process_id: str,
        payloads: Sequence[JsonDict],
    ) -> str:
        checkpoint = self._checkpoint_for_process_unlocked(process_id, payloads)
        digest = hashlib.sha256()
        if checkpoint:
            previous = str(checkpoint.get("prefix_hash") or "").removeprefix("sha256:")
            if len(previous) != 64:
                raise ValueError("process journal checkpoint prefix hash is invalid")
            digest.update(bytes.fromhex(previous))
        for payload in payloads:
            if str(payload.get("process_id") or "") == process_id and not self._is_checkpoint_anchor(payload):
                digest.update(self._encoded_row(payload))
        return f"sha256:{digest.hexdigest()}"

    def _sealed_checkpoint_unlocked(
        self,
        process_id: str,
        prefix_payloads: Sequence[JsonDict],
    ) -> tuple[JsonDict, bytes, Path]:
        existing_anchor = next(
            (
                payload
                for payload in prefix_payloads
                if str(payload.get("process_id") or "") == process_id
                and self._is_checkpoint_anchor(payload)
            ),
            None,
        )
        actual_events = [
            payload
            for payload in prefix_payloads
            if str(payload.get("process_id") or "") == process_id
            and not self._is_checkpoint_anchor(payload)
        ]
        if not actual_events and existing_anchor is not None:
            checkpoint = self._checkpoint_payload_unlocked(existing_anchor)
            digest = str(existing_anchor["payload"]["checkpoint_digest"])
            return existing_anchor, (self._checkpoint_root / f"{digest.removeprefix('sha256:')}.json").read_bytes(), self._checkpoint_root / f"{digest.removeprefix('sha256:')}.json"
        state = self._replay_payloads_unlocked(process_id, prefix_payloads)
        checkpoint = {
            "version": PROCESS_JOURNAL_CHECKPOINT_VERSION,
            "process_id": process_id,
            "cumulative_event_count": int(state.get("event_count", 0) or 0),
            "last_event_id": state.get("last_event_id"),
            "prefix_hash": self._prefix_hash_unlocked(process_id, prefix_payloads),
            "state": state,
        }
        encoded = (json.dumps(checkpoint, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        if len(encoded) > MAX_RUNTIME_DELIVERY_OBJECT_BYTES:
            raise ValueError("process journal replay checkpoint exceeds immutable object quota")
        digest = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
        target = self._checkpoint_root / f"{digest.removeprefix('sha256:')}.json"
        anchor = _model_dump_compat(
            ProcessEvent(
                event_id=f"checkpoint_{digest.removeprefix('sha256:')[:16]}",
                process_id=process_id,
                kind=PROCESS_JOURNAL_CHECKPOINT_ANCHOR_KIND,
                causal_parent_ids=[str(state.get("last_event_id"))] if state.get("last_event_id") else [],
                payload={
                    "version": PROCESS_JOURNAL_CHECKPOINT_VERSION,
                    "checkpoint_ref": digest,
                    "checkpoint_digest": digest,
                    "cumulative_event_count": checkpoint["cumulative_event_count"],
                    "last_event_id": checkpoint["last_event_id"],
                    "prefix_hash": checkpoint["prefix_hash"],
                },
            )
        )
        return anchor, encoded, target

    def _write_checkpoint_unlocked(self, target: Path, encoded: bytes) -> None:
        durable_created = not target.exists()
        if not durable_created:
            if target.read_bytes() != encoded:
                raise ValueError("immutable process journal checkpoint collision")
            return
        durable_mkdir(self._checkpoint_root)
        temporary = target.with_name(f".{target.name}.{os.getpid()}.{uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as handle:
                os.fchmod(handle.fileno(), 0o600)
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
            fsync_directory(target.parent)
        finally:
            if temporary.exists():
                temporary.unlink()

    def _append_payloads_unlocked(self, payloads: List[JsonDict]) -> None:
        committed = self._committed_payloads_unlocked()
        new_encoded_rows = [self._encoded_row(payload) for payload in payloads]
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
        combined_payloads = [*committed, *payloads]
        combined_rows = [self._encoded_row(payload) for payload in combined_payloads]
        process_ids = {str(payload.get("process_id") or "") for payload in combined_payloads}
        affected_processes = {
            process_id
            for process_id in process_ids
            if (
                sum(1 for payload in combined_payloads if str(payload.get("process_id") or "") == process_id)
                > MAX_PROCESS_JOURNAL_RECORDS_PER_PROCESS
                or sum(
                    len(row)
                    for payload, row in zip(combined_payloads, combined_rows)
                    if str(payload.get("process_id") or "") == process_id
                )
                > MAX_PROCESS_JOURNAL_BYTES_PER_PROCESS
            )
        }
        global_compaction = (
            len(combined_rows) > MAX_PROCESS_JOURNAL_RECORDS
            or sum(len(row) for row in combined_rows) > MAX_PROCESS_JOURNAL_BYTES
        )
        if global_compaction:
            # A global suffix cut can erase another process's only history.
            # Seal every existing process first or reject the append.
            affected_processes.update(
                str(payload.get("process_id") or "") for payload in committed
            )
        if not affected_processes:
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
        checkpoint_rows: Dict[str, JsonDict] = {}
        checkpoint_files: Dict[Path, bytes] = {}
        retained_rows: Dict[str, Optional[JsonDict]] = {}
        for process_id in sorted(affected_processes):
            committed_for_process = [
                payload
                for payload in committed
                if str(payload.get("process_id") or "") == process_id
            ]
            actual_committed = [
                payload for payload in committed_for_process
                if not self._is_checkpoint_anchor(payload)
            ]
            retained = actual_committed[-1] if actual_committed else None
            prefix = [
                payload
                for payload in committed_for_process
                if retained is None or payload is not retained
            ]
            if not prefix:
                raise ValueError(
                    "process journal append exceeds immutable quota and has no safe checkpointable prefix"
                )
            anchor, checkpoint_encoded, checkpoint_target = self._sealed_checkpoint_unlocked(
                process_id,
                prefix,
            )
            checkpoint_rows[process_id] = anchor
            checkpoint_files[checkpoint_target] = checkpoint_encoded
            retained_rows[process_id] = retained

        rebuilt_committed: List[JsonDict] = []
        emitted: set[str] = set()
        for payload in committed:
            process_id = str(payload.get("process_id") or "")
            if process_id not in affected_processes:
                rebuilt_committed.append(payload)
                continue
            if process_id in emitted:
                continue
            rebuilt_committed.append(checkpoint_rows[process_id])
            if retained_rows[process_id] is not None:
                rebuilt_committed.append(retained_rows[process_id])
            emitted.add(process_id)
        rebuilt = [*rebuilt_committed, *payloads]
        rebuilt_rows = [self._encoded_row(payload) for payload in rebuilt]
        if (
            len(rebuilt_rows) > MAX_PROCESS_JOURNAL_RECORDS
            or sum(len(row) for row in rebuilt_rows) > MAX_PROCESS_JOURNAL_BYTES
        ):
            raise ValueError("process journal append exceeds immutable journal quota after safe checkpointing")
        for process_id in {str(payload.get("process_id") or "") for payload in rebuilt}:
            process_rows = [
                row
                for payload, row in zip(rebuilt, rebuilt_rows)
                if str(payload.get("process_id") or "") == process_id
            ]
            if (
                len(process_rows) > MAX_PROCESS_JOURNAL_RECORDS_PER_PROCESS
                or sum(len(row) for row in process_rows) > MAX_PROCESS_JOURNAL_BYTES_PER_PROCESS
            ):
                raise ValueError("process journal append exceeds per-process quota after safe checkpointing")
        encoded = b"".join(rebuilt_rows)
        temporary = self.path.with_name(f".{self.path.name}.{os.getpid()}.{uuid4().hex}.tmp")
        durable_mkdir(self.path.parent)
        try:
            with runtime_delivery_quota_transaction(self.delivery_root):
                checkpoint_peak_bytes = sum(
                    len(checkpoint_encoded)
                    for checkpoint_target, checkpoint_encoded in checkpoint_files.items()
                    if not checkpoint_target.exists()
                )
                assert_runtime_delivery_volume_capacity(
                    self.delivery_root,
                    additional_bytes=len(encoded) + checkpoint_peak_bytes,
                )
                for checkpoint_target, checkpoint_encoded in checkpoint_files.items():
                    self._write_checkpoint_unlocked(checkpoint_target, checkpoint_encoded)
                with temporary.open("xb") as handle:
                    os.fchmod(handle.fileno(), 0o600)
                    handle.write(encoded)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, self.path)
                fsync_directory(self.path.parent)
                referenced = {
                    str(payload["payload"]["checkpoint_digest"]).removeprefix("sha256:")
                    for payload in rebuilt
                    if self._is_checkpoint_anchor(payload)
                }
                if self._checkpoint_root.exists():
                    removed = False
                    for checkpoint_target in self._checkpoint_root.glob("*.json"):
                        if checkpoint_target.stem not in referenced:
                            checkpoint_target.unlink()
                            removed = True
                    if removed:
                        fsync_directory(self._checkpoint_root)
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
            if self._is_checkpoint_anchor(payload):
                # Validate the anchor even though callers consume only real
                # domain events from the suffix.
                self._checkpoint_payload_unlocked(payload)
                continue
            record = _model_validate_compat(payload)
            if process_id and record.process_id != process_id:
                continue
            if allowed_kinds and record.kind not in allowed_kinds:
                continue
            rows.append(record)
        return rows

    def checkpoint_state(self, process_id: str) -> Optional[JsonDict]:
        process = str(process_id or "").strip()
        if not process:
            raise ValueError("process_id must be non-empty")
        with self._locked(exclusive=False):
            payloads = self._committed_payloads_unlocked()
            checkpoint = self._checkpoint_for_process_unlocked(process, payloads)
        return json.loads(json.dumps(checkpoint)) if checkpoint is not None else None

    def latest(self, *, process_id: Optional[str] = None) -> Optional[ProcessEvent]:
        rows = self.load(process_id=process_id)
        return rows[-1] if rows else None


__all__ = ["ProcessJournal"]
