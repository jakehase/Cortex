from __future__ import annotations

import fcntl
import json
import os
import re
import stat
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple

from cortex_server.runtime.session_contract import CanonicalSessionEvent


JsonDict = Dict[str, object]

_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_MEMORY_STORE_LOCK = threading.RLock()


class RuntimeMemoryLimitError(ValueError):
    """A runtime-memory write would exceed a configured durability bound."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _day_slug() -> str:
    return _now().strftime("%Y-%m-%d")


class RuntimeMemoryStore:
    def __init__(
        self,
        root: str | Path,
        *,
        max_event_bytes: Optional[int] = None,
        max_shard_bytes: Optional[int] = None,
        max_total_bytes: Optional[int] = None,
        max_rotations: Optional[int] = None,
        retention_days: Optional[int] = None,
    ):
        self.root = Path(root).expanduser().resolve()
        self.hot_path = self.root / "MEMORY.md"
        self.process_dir = self.root / "processes"
        self.session_dir = self.root / "sessions"
        self.daily_dir = self.root / "daily"
        self.max_event_bytes = max_event_bytes or int(os.getenv("CORTEX_RUNTIME_MEMORY_MAX_EVENT_BYTES", "65536"))
        self.max_shard_bytes = max_shard_bytes or int(os.getenv("CORTEX_RUNTIME_MEMORY_MAX_SHARD_BYTES", str(4 * 1024 * 1024)))
        self.max_total_bytes = max_total_bytes or int(os.getenv("CORTEX_RUNTIME_MEMORY_MAX_TOTAL_BYTES", str(64 * 1024 * 1024)))
        self.max_rotations = max_rotations if max_rotations is not None else int(os.getenv("CORTEX_RUNTIME_MEMORY_MAX_ROTATIONS", "3"))
        self.retention_days = retention_days if retention_days is not None else int(os.getenv("CORTEX_RUNTIME_MEMORY_RETENTION_DAYS", "30"))
        if min(self.max_event_bytes, self.max_shard_bytes, self.max_total_bytes) <= 0:
            raise ValueError("runtime memory byte limits must be positive")
        if self.max_event_bytes > self.max_shard_bytes or self.max_shard_bytes > self.max_total_bytes:
            raise ValueError("runtime memory limits must satisfy event <= shard <= total")
        if self.max_rotations < 0 or self.retention_days < 0:
            raise ValueError("runtime memory retention limits cannot be negative")

    @property
    def _lock_path(self) -> Path:
        return self.root / ".runtime-memory.lock"

    @contextmanager
    def _transaction(self):
        with _MEMORY_STORE_LOCK:
            self.ensure_layout()
            flags = os.O_WRONLY | os.O_CREAT
            if hasattr(os, "O_CLOEXEC"):
                flags |= os.O_CLOEXEC
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            descriptor = os.open(self._lock_path, flags, 0o600)
            try:
                if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                    raise ValueError("runtime memory lock must be a regular file")
                fcntl.flock(descriptor, fcntl.LOCK_EX)
                yield
            finally:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
                os.close(descriptor)

    def _assert_contained(self, path: Path, *, parent: Path) -> Path:
        resolved_parent = parent.resolve()
        resolved = path.resolve(strict=False)
        try:
            resolved.relative_to(resolved_parent)
        except ValueError as exc:
            raise ValueError("runtime memory path escapes its configured shard root") from exc
        return resolved

    @staticmethod
    def _identifier(value: str, *, field: str) -> str:
        normalized = str(value or "").strip()
        if normalized in {"", ".", ".."} or not _IDENTIFIER_RE.fullmatch(normalized):
            raise ValueError(f"{field} must be a bounded opaque identifier")
        return normalized

    def ensure_layout(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.process_dir.mkdir(parents=True, exist_ok=True)
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.daily_dir.mkdir(parents=True, exist_ok=True)
        for directory in (self.process_dir, self.session_dir, self.daily_dir):
            self._assert_contained(directory, parent=self.root)
            if directory.is_symlink():
                raise ValueError("runtime memory shard directories cannot be symlinks")
        if not self.hot_path.exists():
            self.hot_path.write_text(
                "# Runtime Memory\n\n"
                "> Non-authoritative runtime notes only.\n\n"
                "Authoritative runtime state lives in snapshots, shared state, and the process journal.\n\n"
                "Hot pointers only. Detailed runtime memory lives in:\n"
                "- processes/\n"
                "- sessions/\n"
                "- daily/\n",
                encoding="utf-8",
            )

    def _append(self, path: Path, content: bytes) -> None:
        self._assert_contained(path, parent=path.parent)
        flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT
        if hasattr(os, "O_CLOEXEC"):
            flags |= os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(path, flags, 0o600)
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise ValueError("runtime memory shards must be regular files")
            view = memoryview(content)
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    raise OSError("runtime memory append made no progress")
                view = view[written:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def _rotation_path(self, path: Path, generation: int) -> Path:
        return path.with_name(f"{path.name}.{generation}")

    def _rotation_drop_bytes(self, path: Path) -> int:
        if self.max_rotations <= 0:
            return path.stat().st_size if path.exists() else 0
        oldest = self._rotation_path(path, self.max_rotations)
        return oldest.stat().st_size if oldest.exists() else 0

    def _rotate(self, path: Path) -> None:
        if not path.exists():
            return
        if self.max_rotations <= 0:
            path.unlink()
            return
        oldest = self._rotation_path(path, self.max_rotations)
        if oldest.exists():
            oldest.unlink()
        for generation in range(self.max_rotations - 1, 0, -1):
            source = self._rotation_path(path, generation)
            if source.exists():
                os.replace(source, self._rotation_path(path, generation + 1))
        os.replace(path, self._rotation_path(path, 1))

    def _prune_expired(self) -> None:
        cutoff = _now().timestamp() - (self.retention_days * 86400)
        for directory in (self.process_dir, self.session_dir, self.daily_dir):
            for path in directory.iterdir():
                try:
                    if path.is_file() and path.stat().st_mtime < cutoff:
                        path.unlink()
                except FileNotFoundError:
                    continue

    def _stored_bytes(self) -> int:
        total = 0
        for directory in (self.process_dir, self.session_dir, self.daily_dir):
            for path in directory.iterdir():
                try:
                    if path.is_file() and not path.is_symlink():
                        total += path.stat().st_size
                except FileNotFoundError:
                    continue
        return total

    def _append_bounded(self, writes: Iterable[Tuple[Path, bytes]]) -> None:
        pending = list(writes)
        if not pending:
            return
        if any(len(content) > self.max_event_bytes for _, content in pending):
            raise RuntimeMemoryLimitError("runtime memory event exceeds the configured byte limit")

        rotate_paths = []
        for path, content in pending:
            self._assert_contained(path, parent=path.parent)
            current = path.stat().st_size if path.exists() else 0
            if current + len(content) > self.max_shard_bytes:
                rotate_paths.append(path)
            if len(content) > self.max_shard_bytes:
                raise RuntimeMemoryLimitError("runtime memory event exceeds the shard byte limit")

        projected = self._stored_bytes() + sum(len(content) for _, content in pending)
        projected -= sum(self._rotation_drop_bytes(path) for path in rotate_paths)
        if projected > self.max_total_bytes:
            raise RuntimeMemoryLimitError("runtime memory store exceeds the configured total byte quota")

        for path in rotate_paths:
            self._rotate(path)
        for path, content in pending:
            self._append(path, content)

    def _process_path(self, process_id: str) -> Path:
        identifier = self._identifier(process_id, field="process_id")
        return self._assert_contained(self.process_dir / f"{identifier}.md", parent=self.process_dir)

    def _session_path(self, process_id: str, session_id: str) -> Path:
        process = self._identifier(process_id, field="process_id")
        session = self._identifier(session_id, field="session_id")
        return self._assert_contained(self.session_dir / f"{process}__{session}.md", parent=self.session_dir)

    def _daily_path(self) -> Path:
        return self._assert_contained(self.daily_dir / f"{_day_slug()}.md", parent=self.daily_dir)

    def write_process_note(self, *, process_id: str, title: str, note: str, metadata: Optional[JsonDict] = None) -> Path:
        process = self._identifier(process_id, field="process_id")
        title_text = str(title or "").strip()
        note_text = str(note or "").strip()
        metadata_text = ""
        if metadata:
            metadata_text = json.dumps(metadata, ensure_ascii=False, sort_keys=True, allow_nan=False)
        text = (
            f"## {_now().isoformat()} {title_text}\n"
            "authority: non-authoritative\n"
            f"{note_text}\n"
        )
        if metadata_text:
            text += f"meta: {metadata_text}\n"
        text += "\n"
        path = self._process_path(process)
        daily = f"- process {process}: {title_text} — {note_text}\n"
        with self._transaction():
            self._prune_expired()
            self._append_bounded(((path, text.encode("utf-8")), (self._daily_path(), daily.encode("utf-8"))))
        return path

    def write_session_event(self, event: CanonicalSessionEvent) -> Path:
        process_id = self._identifier(event.process_id, field="process_id")
        session_id = self._identifier(event.session_id or event.process_id, field="session_id")
        payload = json.dumps(event.payload, ensure_ascii=False, sort_keys=True, allow_nan=False)
        text = (
            f"## {event.ts} {event.kind}\n"
            "authority: non-authoritative\n"
            f"tool: {event.tool or 'unknown'}\n"
            f"summary: {event.summary or event.operator_summary}\n"
            f"operator_summary: {event.operator_summary}\n"
            f"payload: {payload}\n\n"
        )
        path = self._session_path(process_id, session_id)
        daily = f"- session {session_id} ({process_id}): {event.operator_summary}\n"
        with self._transaction():
            self._prune_expired()
            self._append_bounded(((path, text.encode("utf-8")), (self._daily_path(), daily.encode("utf-8"))))
        return path


__all__ = ["RuntimeMemoryLimitError", "RuntimeMemoryStore"]
