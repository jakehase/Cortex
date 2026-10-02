from __future__ import annotations

import fcntl
import json
import os
import re
import stat
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple

from cortex_server.runtime.runtime_delivery_quota import (
    MAX_SESSION_EVENT_PROJECTION_BYTES,
    RuntimeDeliveryQuotaError,
    assert_process_count,
    assert_runtime_delivery_volume_capacity,
    runtime_delivery_capacity_reservation,
    runtime_delivery_quota_transaction,
)
from cortex_server.runtime.session_contract import CanonicalSessionEvent


JsonDict = Dict[str, object]

_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_IDENTIFIER_PATTERN = r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"
_PROCESS_SHARD_RE = re.compile(
    rf"^{_IDENTIFIER_PATTERN}\.md(?:\.[1-9][0-9]*)?$"
)
_SESSION_SHARD_RE = re.compile(
    rf"^{_IDENTIFIER_PATTERN}__{_IDENTIFIER_PATTERN}\.md(?:\.[1-9][0-9]*)?$"
)
_DAILY_SHARD_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}\.md(?:\.[1-9][0-9]*)?$")
_AUTHORITY_MARKER = b"authority: non-authoritative\n"
_MEMORY_STORE_LOCK = threading.RLock()
_RETENTION_RUNTIME_ERRORS: Dict[str, list[str]] = {}
_MAX_EVENT_BYTES = 64 * 1024
_MAX_SHARD_BYTES = 4 * 1024 * 1024
_MAX_TOTAL_BYTES = 64 * 1024 * 1024
_MAX_FILES = 1000
_MAX_ROTATIONS = 3
_MAX_RETENTION_DAYS = 30


class RuntimeMemoryLimitError(ValueError):
    """A runtime-memory write would exceed a configured durability bound."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _day_slug() -> str:
    return _now().strftime("%Y-%m-%d")


def _configured_limit(
    explicit: Optional[int],
    *,
    environment: str,
    default: int,
    maximum: int,
    minimum: int = 1,
) -> int:
    raw: object = explicit
    if raw is None:
        raw = os.getenv(environment, str(default))
    if isinstance(raw, bool) or len(str(raw)) > 20:
        raise ValueError(f"{environment} must be a bounded integer")
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{environment} must be a bounded integer") from exc
    if value < minimum or value > maximum:
        raise ValueError(
            f"{environment} must be between {minimum} and {maximum}"
        )
    return value


class RuntimeMemoryStore:
    def __init__(
        self,
        root: str | Path,
        *,
        max_event_bytes: Optional[int] = None,
        max_shard_bytes: Optional[int] = None,
        max_total_bytes: Optional[int] = None,
        max_files: Optional[int] = None,
        max_rotations: Optional[int] = None,
        retention_days: Optional[int] = None,
        delivery_root: Optional[str | Path] = None,
    ):
        self.root = Path(root).expanduser().resolve()
        self.hot_path = self.root / "MEMORY.md"
        self.process_dir = self.root / "processes"
        self.session_dir = self.root / "sessions"
        self.daily_dir = self.root / "daily"
        self.retention_state_path = self.root / ".retention-health.json"
        self.delivery_root = Path(delivery_root).resolve() if delivery_root is not None else self.root.parent
        self.max_event_bytes = _configured_limit(
            max_event_bytes,
            environment="CORTEX_RUNTIME_MEMORY_MAX_EVENT_BYTES",
            default=_MAX_EVENT_BYTES,
            maximum=_MAX_EVENT_BYTES,
        )
        self.max_shard_bytes = _configured_limit(
            max_shard_bytes,
            environment="CORTEX_RUNTIME_MEMORY_MAX_SHARD_BYTES",
            default=_MAX_SHARD_BYTES,
            maximum=_MAX_SHARD_BYTES,
        )
        self.max_total_bytes = _configured_limit(
            max_total_bytes,
            environment="CORTEX_RUNTIME_MEMORY_MAX_TOTAL_BYTES",
            default=_MAX_TOTAL_BYTES,
            maximum=_MAX_TOTAL_BYTES,
        )
        self.max_files = _configured_limit(
            max_files,
            environment="CORTEX_RUNTIME_MEMORY_MAX_FILES",
            default=_MAX_FILES,
            maximum=_MAX_FILES,
        )
        self.max_rotations = _configured_limit(
            max_rotations,
            environment="CORTEX_RUNTIME_MEMORY_MAX_ROTATIONS",
            default=_MAX_ROTATIONS,
            maximum=_MAX_ROTATIONS,
            minimum=0,
        )
        self.retention_days = _configured_limit(
            retention_days,
            environment="CORTEX_RUNTIME_MEMORY_RETENTION_DAYS",
            default=_MAX_RETENTION_DAYS,
            maximum=_MAX_RETENTION_DAYS,
            minimum=0,
        )
        self._transaction_local = threading.local()
        if self.max_event_bytes > self.max_shard_bytes or self.max_shard_bytes > self.max_total_bytes:
            raise ValueError("runtime memory limits must satisfy event <= shard <= total")

    @property
    def _lock_path(self) -> Path:
        return self.root / ".runtime-memory.lock"

    @contextmanager
    def _transaction(self):
        with _MEMORY_STORE_LOCK:
            if int(getattr(self._transaction_local, "depth", 0)) > 0:
                self._transaction_local.depth += 1
                try:
                    yield
                finally:
                    self._transaction_local.depth -= 1
                return
            with runtime_delivery_quota_transaction(self.delivery_root):
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
                    self._transaction_local.depth = 1
                    yield
                finally:
                    self._transaction_local.depth = 0
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
        initial = (
            "# Runtime Memory\n\n"
            "> Non-authoritative runtime notes only.\n\n"
            "Authoritative runtime state lives in snapshots, shared state, and the process journal.\n\n"
            "Hot pointers only. Detailed runtime memory lives in:\n"
            "- processes/\n"
            "- sessions/\n"
            "- daily/\n"
        ).encode("utf-8")
        flags = (
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0)
        )
        created = False
        if not self.hot_path.exists():
            assert_runtime_delivery_volume_capacity(
                self.delivery_root,
                additional_bytes=len(initial),
            )
        try:
            descriptor = os.open(self.hot_path, flags, 0o600)
            created = True
        except FileExistsError:
            try:
                descriptor = os.open(
                    self.hot_path,
                    os.O_RDONLY
                    | getattr(os, "O_CLOEXEC", 0)
                    | getattr(os, "O_NOFOLLOW", 0),
                )
            except OSError as exc:
                raise ValueError(
                    "runtime memory hot index must be a regular non-symlink file"
                ) from exc
        except OSError as exc:
            raise ValueError(
                "runtime memory hot index must be a regular non-symlink file"
            ) from exc
        try:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                raise ValueError(
                    "runtime memory hot index must be a regular non-symlink file"
                )
            if created:
                offset = 0
                while offset < len(initial):
                    offset += os.write(descriptor, initial[offset:])
                os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def _append(self, path: Path, content: bytes) -> None:
        self._assert_contained(path, parent=path.parent)
        flags = os.O_RDWR | os.O_APPEND
        if hasattr(os, "O_CLOEXEC"):
            flags |= os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        created = False
        try:
            descriptor = os.open(path, flags | os.O_CREAT | os.O_EXCL, 0o600)
            created = True
        except FileExistsError:
            descriptor = os.open(path, flags)
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise ValueError("runtime memory shards must be regular files")
            if not created and not self._descriptor_is_managed_shard(path, descriptor):
                raise RuntimeMemoryLimitError(
                    "runtime memory write target is not owned by the note store"
                )
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
        for occupied in [
            path,
            *(self._rotation_path(path, generation) for generation in range(1, self.max_rotations + 1)),
        ]:
            if occupied.exists() and not self._is_managed_shard(occupied):
                raise RuntimeMemoryLimitError(
                    "runtime memory rotation target is not owned by the note store"
                )
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

    def _legacy_daily_content(self, content: bytes) -> bool:
        try:
            lines = content.decode("utf-8", errors="strict").splitlines()
        except UnicodeDecodeError:
            return False
        meaningful = [line for line in lines if line.strip()]
        return (
            bool(meaningful)
            and "\x00" not in "\n".join(meaningful)
            and (
                meaningful[0].startswith("- process ")
                or meaningful[0].startswith("- session ")
            )
        )

    def _descriptor_is_managed_shard(self, path: Path, descriptor: int) -> bool:
        patterns = {
            self.process_dir: _PROCESS_SHARD_RE,
            self.session_dir: _SESSION_SHARD_RE,
            self.daily_dir: _DAILY_SHARD_RE,
        }
        pattern = patterns.get(path.parent)
        if not pattern or not pattern.fullmatch(path.name):
            return False
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_nlink != 1
            or metadata.st_mode & 0o077
            or (hasattr(os, "getuid") and metadata.st_uid != os.getuid())
        ):
            return False
        prefix = os.pread(descriptor, min(metadata.st_size, 4096), 0)
        if path.parent in (self.process_dir, self.session_dir):
            first_line_end = prefix.find(b"\n")
            if (
                prefix.startswith(b"## ")
                and first_line_end >= 3
                and prefix[first_line_end + 1 :].startswith(_AUTHORITY_MARKER)
            ):
                return True
        elif path.parent == self.daily_dir and prefix.startswith(_AUTHORITY_MARKER):
            first_record = prefix[len(_AUTHORITY_MARKER) :]
            if first_record.startswith((b"- process ", b"- session ")):
                return True
        if metadata.st_size > self.max_shard_bytes:
            return False
        content = bytearray()
        offset = 0
        while offset < metadata.st_size:
            chunk = os.pread(
                descriptor,
                min(64 * 1024, metadata.st_size - offset),
                offset,
            )
            if not chunk:
                return False
            content.extend(chunk)
            offset += len(chunk)
        return (
            path.parent == self.daily_dir
            and metadata.st_mode & 0o077 == 0
            and self._legacy_daily_content(content)
        )

    def _is_managed_shard(self, path: Path) -> bool:
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags)
        try:
            return self._descriptor_is_managed_shard(path, descriptor)
        finally:
            os.close(descriptor)

    def _managed_files(self) -> list[Path]:
        files: list[Path] = []
        for directory in (self.process_dir, self.session_dir, self.daily_dir):
            if not directory.exists():
                continue
            if directory.is_symlink():
                raise ValueError("runtime memory shard directories cannot be symlinks")
            for path in directory.iterdir():
                try:
                    if (
                        path.is_file()
                        and not path.is_symlink()
                        and self._is_managed_shard(path)
                    ):
                        files.append(path)
                except FileNotFoundError:
                    continue
        return files

    def _control_file_errors(self) -> list[str]:
        errors: list[str] = []
        controls = (
            (self.hot_path, True),
            (self._lock_path, False),
            (self.retention_state_path, False),
        )
        for path, required in controls:
            try:
                metadata = path.lstat()
            except FileNotFoundError:
                if required:
                    errors.append(f"required runtime memory control file is missing: {path}")
                continue
            except OSError as exc:
                errors.append(f"runtime memory control file {path}: {exc}")
                continue
            if (
                stat.S_ISLNK(metadata.st_mode)
                or not stat.S_ISREG(metadata.st_mode)
                or metadata.st_nlink != 1
            ):
                errors.append(f"runtime memory control path is not a regular non-symlink file: {path}")
        if not errors and self.hot_path.exists():
            try:
                with self.hot_path.open("rb") as source:
                    header = source.read(len(b"# Runtime Memory\n"))
                if header != b"# Runtime Memory\n":
                    errors.append("runtime memory hot index has an unrecognized ownership header")
            except OSError as exc:
                errors.append(f"runtime memory hot index: {exc}")
        return errors

    def _retained_files(self) -> list[Path]:
        """Return every quota-bearing file below the runtime-note root.

        Only the fixed hot index, lock, and retention-health state are control
        files. Unknown or legacy files remain quota-bearing and make health fail
        closed; pruning never deletes an unrecognized path.
        """

        if not self.root.exists():
            return []
        control_errors = self._control_file_errors()
        if control_errors:
            raise ValueError("; ".join(control_errors))
        controls = {self.hot_path, self._lock_path, self.retention_state_path}
        files: list[Path] = []
        for path in self.root.rglob("*"):
            try:
                if path in controls:
                    continue
                if path.is_symlink():
                    raise ValueError("runtime memory retention tree cannot contain symlinks")
                if path.is_file():
                    files.append(path)
                elif not path.is_dir():
                    raise ValueError(
                        "runtime memory retention tree contains an unsupported special entry"
                    )
            except FileNotFoundError:
                continue
        return files

    def _assert_owned_write_targets(
        self,
        pending: list[Tuple[Path, bytes]],
        managed: set[Path],
    ) -> set[Path]:
        protected: set[Path] = set()
        for path, _content in pending:
            protected.add(path)
            if path.exists() and path not in managed:
                raise RuntimeMemoryLimitError(
                    "runtime memory write target is not owned by the note store"
                )
            for generation in range(1, self.max_rotations + 1):
                rotated = self._rotation_path(path, generation)
                protected.add(rotated)
                if rotated.exists() and rotated not in managed:
                    raise RuntimeMemoryLimitError(
                        "runtime memory rotation target is not owned by the note store"
                    )
        return protected

    def _project_pending_state(
        self,
        state: Dict[Path, Tuple[int, float]],
        pending: list[Tuple[Path, bytes]],
    ) -> Tuple[Dict[Path, Tuple[int, float]], list[Path]]:
        projected = dict(state)
        combined: Dict[Path, int] = {}
        for path, content in pending:
            combined[path] = combined.get(path, 0) + len(content)
        if any(size > self.max_shard_bytes for size in combined.values()):
            raise RuntimeMemoryLimitError(
                "runtime memory write set exceeds the shard byte limit"
            )
        rotations: list[Path] = []
        now = _now().timestamp()
        for path, pending_bytes in combined.items():
            current_size, current_mtime = projected.get(path, (0, now))
            if current_size + pending_bytes <= self.max_shard_bytes:
                projected[path] = (current_size + pending_bytes, current_mtime)
                continue
            rotations.append(path)
            old_generations = {
                generation: projected.get(self._rotation_path(path, generation))
                for generation in range(1, self.max_rotations + 1)
            }
            projected.pop(path, None)
            for generation in range(1, self.max_rotations + 1):
                projected.pop(self._rotation_path(path, generation), None)
            if self.max_rotations > 0:
                projected[self._rotation_path(path, 1)] = (
                    current_size,
                    current_mtime,
                )
                for generation in range(2, self.max_rotations + 1):
                    prior = old_generations.get(generation - 1)
                    if prior is not None:
                        projected[self._rotation_path(path, generation)] = prior
            projected[path] = (pending_bytes, now)
        return projected, rotations

    def _plan_retention(
        self,
        pending: list[Tuple[Path, bytes]],
    ) -> Tuple[list[Path], list[Path]]:
        retained = self._retained_files()
        managed = set(self._managed_files())
        protected = self._assert_owned_write_targets(pending, managed)
        state: Dict[Path, Tuple[int, float]] = {}
        for path in retained:
            try:
                metadata = path.stat()
            except FileNotFoundError:
                continue
            state[path] = (int(metadata.st_size), float(metadata.st_mtime))

        cutoff = _now().timestamp() - (self.retention_days * 86400)
        selected = {
            path
            for path in managed
            if path in state
            and (
                state[path][1] < cutoff
                or state[path][0] > self.max_shard_bytes
            )
        }
        candidates = sorted(
            (
                (state[path][1], str(path), path)
                for path in managed
                if path in state and path not in protected and path not in selected
            ),
            key=lambda row: (row[0], row[1]),
        )

        while True:
            remaining = {
                path: metadata
                for path, metadata in state.items()
                if path not in selected
            }
            projected, rotations = self._project_pending_state(remaining, pending)
            projected_bytes = sum(size for size, _mtime in projected.values())
            if len(projected) <= self.max_files and projected_bytes <= self.max_total_bytes:
                return sorted(selected, key=str), rotations
            if not candidates:
                raise RuntimeMemoryLimitError(
                    "runtime memory store cannot satisfy configured file and byte quotas"
                )
            _mtime, _name, candidate = candidates.pop(0)
            selected.add(candidate)

    def _apply_prune_plan(
        self,
        paths: list[Path],
    ) -> Tuple[int, int, list[str]]:
        deleted = 0
        deleted_bytes = 0
        errors: list[str] = []
        for path in paths:
            try:
                metadata = path.stat()
                if not self._is_managed_shard(path):
                    raise RuntimeMemoryLimitError(
                        "planned retention target is no longer store-owned"
                    )
                path.unlink()
                deleted += 1
                deleted_bytes += int(metadata.st_size)
            except FileNotFoundError:
                continue
            except (OSError, RuntimeMemoryLimitError) as exc:
                errors.append(f"{path}: {exc}")
        return deleted, deleted_bytes, errors

    def _load_retention_state(self) -> Tuple[JsonDict, list[str]]:
        if not self.retention_state_path.exists():
            return {}, []
        try:
            if self.retention_state_path.is_symlink():
                raise ValueError("retention health state cannot be a symlink")
            value = json.loads(self.retention_state_path.read_text(encoding="utf-8"))
            if not isinstance(value, dict):
                raise ValueError("retention health state must be an object")
            for field in (
                "totalPrunedFiles",
                "totalPrunedBytes",
                "lastPrunedFiles",
                "lastPrunedBytes",
            ):
                if int(value.get(field, 0) or 0) < 0:
                    raise ValueError("retention health counters cannot be negative")
            if not isinstance(value.get("errors", []), list):
                raise ValueError("retention health errors must be a list")
            return value, []
        except (OSError, TypeError, ValueError) as exc:
            return {}, [f"retention health state: {exc}"]

    def _record_retention_result(
        self,
        *,
        pruned_files: int,
        pruned_bytes: int,
        errors: list[str],
    ) -> None:
        prior, state_errors = self._load_retention_state()
        payload = {
            "totalPrunedFiles": int(prior.get("totalPrunedFiles", 0) or 0) + pruned_files,
            "totalPrunedBytes": int(prior.get("totalPrunedBytes", 0) or 0) + pruned_bytes,
            "lastPrunedFiles": pruned_files,
            "lastPrunedBytes": pruned_bytes,
            "lastPrunedAt": _now().isoformat(),
            "errors": [
                str(error)[:512] for error in [*state_errors, *errors][-20:]
            ],
        }
        encoded = json.dumps(payload, ensure_ascii=True, sort_keys=True).encode("utf-8")
        temporary = self.retention_state_path.with_name(
            f".{self.retention_state_path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
        )
        try:
            descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            try:
                view = memoryview(encoded)
                while view:
                    written = os.write(descriptor, view)
                    if written <= 0:
                        raise OSError("runtime memory retention state write made no progress")
                    view = view[written:]
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            os.replace(temporary, self.retention_state_path)
            directory_fd = os.open(self.root, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            _RETENTION_RUNTIME_ERRORS.pop(str(self.root), None)
        except OSError as exc:
            _RETENTION_RUNTIME_ERRORS[str(self.root)] = [str(exc)[:512]]
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def _stored_bytes(self) -> int:
        total = 0
        for path in self._retained_files():
            try:
                total += path.stat().st_size
            except FileNotFoundError:
                continue
        return total

    def _validate_write_shapes(self, pending: list[Tuple[Path, bytes]]) -> None:
        if not pending:
            return
        if any(len(content) > self.max_event_bytes for _, content in pending):
            raise RuntimeMemoryLimitError("runtime memory event exceeds the configured byte limit")
        for path, content in pending:
            self._assert_contained(path, parent=path.parent)
            if len(content) > self.max_shard_bytes:
                raise RuntimeMemoryLimitError("runtime memory event exceeds the shard byte limit")

    def _validate_bounded(self, pending: list[Tuple[Path, bytes]]) -> list[Path]:
        """Validate an exact write set without creating any durable side effect."""

        self._validate_write_shapes(pending)
        if not pending:
            return []
        _prune_paths, rotate_paths = self._plan_retention(pending)
        return rotate_paths

    def _append_bounded(self, writes: Iterable[Tuple[Path, bytes]]) -> None:
        pending = list(writes)
        self._validate_write_shapes(pending)
        # Complete every deterministic admission check before pruning any
        # existing shard. A rejected write must never consume retention data.
        prune_paths, rotate_paths = self._plan_retention(pending)
        released_bytes = sum(
            path.stat().st_size for path in prune_paths if path.exists()
        )
        for path in rotate_paths:
            dropped = (
                path
                if self.max_rotations <= 0
                else self._rotation_path(path, self.max_rotations)
            )
            if dropped.exists() and dropped not in prune_paths:
                released_bytes += dropped.stat().st_size
        assert_runtime_delivery_volume_capacity(
            self.delivery_root,
            additional_bytes=max(
                0,
                sum(len(content) for _path, content in pending) - released_bytes,
            ),
        )
        pruned_files, pruned_bytes, prune_errors = self._apply_prune_plan(prune_paths)
        self._record_retention_result(
            pruned_files=pruned_files,
            pruned_bytes=pruned_bytes,
            errors=prune_errors,
        )
        if prune_errors:
            raise RuntimeMemoryLimitError("runtime memory retention prune failed")
        remaining_prunes, rotate_paths = self._plan_retention(pending)
        if remaining_prunes:
            raise RuntimeMemoryLimitError(
                "runtime memory retention state changed after the validated prune"
            )
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
        daily = (
            "authority: non-authoritative\n"
            f"- process {process}: {title_text} — {note_text}\n"
        )
        with self._transaction():
            assert_process_count(self.root, process, delivery_root=self.delivery_root)
            self._append_bounded(((path, text.encode("utf-8")), (self._daily_path(), daily.encode("utf-8"))))
        return path

    def write_session_event(self, event: CanonicalSessionEvent) -> Path:
        path, writes = self._session_event_writes(event)
        with self._transaction():
            assert_process_count(self.root, event.process_id, delivery_root=self.delivery_root)
            self._append_bounded(writes)
        return path

    def _session_event_writes(self, event: CanonicalSessionEvent) -> Tuple[Path, list[Tuple[Path, bytes]]]:
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
        daily = (
            "authority: non-authoritative\n"
            f"- session {session_id} ({process_id}): {event.operator_summary}\n"
        )
        return path, [(path, text.encode("utf-8")), (self._daily_path(), daily.encode("utf-8"))]

    @contextmanager
    def session_event_admission(self, event: CanonicalSessionEvent):
        """Hold total-store admission from validation through all projections."""

        _path, writes = self._session_event_writes(event)
        # Deterministic request-shape failures leave no durable trace.
        self._validate_write_shapes(writes)
        try:
            with runtime_delivery_capacity_reservation(
                self.root.parent,
                reserved_bytes=MAX_SESSION_EVENT_PROJECTION_BYTES,
            ):
                with self._transaction():
                    assert_process_count(self.root, event.process_id, delivery_root=self.delivery_root)
                    self._plan_retention(writes)
                    yield
        except RuntimeDeliveryQuotaError as exc:
            raise RuntimeMemoryLimitError(str(exc)) from exc

    def retention_health(self) -> JsonDict:
        """Report the enforceable non-authoritative note-retention contract."""

        state, state_errors = self._load_retention_state()
        errors = [*state_errors]
        errors.extend(str(value) for value in (state.get("errors") or []))
        errors.extend(_RETENTION_RUNTIME_ERRORS.get(str(self.root), []))
        if not self.root.exists():
            return {
                "ok": False,
                "path": str(self.root),
                "fileCount": 0,
                "sizeBytes": 0,
                "oldestModifiedAt": None,
                "retention": {
                    "maxFiles": self.max_files,
                    "maxBytes": self.max_total_bytes,
                    "maxShardBytes": self.max_shard_bytes,
                    "maxRotations": self.max_rotations,
                    "retentionDays": self.retention_days,
                    "currentFiles": 0,
                    "managedFiles": 0,
                    "unmanagedFiles": 0,
                    "currentBytes": 0,
                    "expiredFiles": 0,
                    "oversizedFiles": 0,
                    "withinPolicy": False,
                    "pruned": {
                        "totalFiles": int(state.get("totalPrunedFiles", 0) or 0),
                        "totalBytes": int(state.get("totalPrunedBytes", 0) or 0),
                        "lastFiles": int(state.get("lastPrunedFiles", 0) or 0),
                        "lastBytes": int(state.get("lastPrunedBytes", 0) or 0),
                        "lastAt": state.get("lastPrunedAt"),
                    },
                    "errors": errors,
                },
            }

        all_files: list[Path] = []
        try:
            for path in self.root.rglob("*"):
                try:
                    if path.is_file() and not path.is_symlink():
                        all_files.append(path)
                except OSError as exc:
                    errors.append(f"{path}: {exc}")
            managed = self._managed_files()
            retained = self._retained_files()
        except (OSError, ValueError) as exc:
            errors.append(str(exc))
            managed = []
            retained = []

        current_bytes = 0
        mtimes: list[float] = []
        oversized_files = 0
        for path in retained:
            try:
                path_stat = path.stat()
                current_bytes += int(path_stat.st_size)
                mtimes.append(float(path_stat.st_mtime))
                if int(path_stat.st_size) > self.max_shard_bytes:
                    oversized_files += 1
            except OSError as exc:
                errors.append(f"{path}: {exc}")
        cutoff = _now().timestamp() - (self.retention_days * 86400)
        expired_files = sum(1 for mtime in mtimes if mtime < cutoff)
        unmanaged_files = max(0, len(retained) - len(managed))
        within_policy = (
            len(retained) <= self.max_files
            and current_bytes <= self.max_total_bytes
            and expired_files == 0
            and oversized_files == 0
            and unmanaged_files == 0
            and not errors
        )
        oldest = (
            datetime.fromtimestamp(min(mtimes), tz=timezone.utc).isoformat()
            if mtimes
            else None
        )
        total_size = 0
        for path in all_files:
            try:
                total_size += int(path.stat().st_size)
            except OSError as exc:
                errors.append(f"{path}: {exc}")
        return {
            "ok": within_policy and not errors,
            "path": str(self.root),
            "fileCount": len(all_files),
            "sizeBytes": total_size,
            "oldestModifiedAt": oldest,
            "retention": {
                "maxFiles": self.max_files,
                "maxBytes": self.max_total_bytes,
                "maxShardBytes": self.max_shard_bytes,
                "maxRotations": self.max_rotations,
                "retentionDays": self.retention_days,
                "currentFiles": len(retained),
                "managedFiles": len(managed),
                "unmanagedFiles": unmanaged_files,
                "currentBytes": current_bytes,
                "expiredFiles": expired_files,
                "oversizedFiles": oversized_files,
                "withinPolicy": within_policy and not errors,
                "pruned": {
                    "totalFiles": int(state.get("totalPrunedFiles", 0) or 0),
                    "totalBytes": int(state.get("totalPrunedBytes", 0) or 0),
                    "lastFiles": int(state.get("lastPrunedFiles", 0) or 0),
                    "lastBytes": int(state.get("lastPrunedBytes", 0) or 0),
                    "lastAt": state.get("lastPrunedAt"),
                },
                "errors": errors,
            },
        }


__all__ = ["RuntimeMemoryLimitError", "RuntimeMemoryStore"]
