"""Small durable JSON state store for singleton runtime components.

The store deliberately keeps policy out of the persistence primitive. Callers
provide a validator and decide whether an unrecoverable load should prevent
startup or leave a component available in a degraded, read-only state.
"""

from __future__ import annotations

import copy
import fcntl
import hashlib
import hmac
import json
import os
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from uuid import uuid4


JsonValidator = Callable[[Any], Any]
_PATH_LOCKS: Dict[str, threading.RLock] = {}
_PATH_LOCKS_GUARD = threading.Lock()


class ResilientJSONStateError(RuntimeError):
    """Base error for durable JSON state operations."""


class StateCorruptionError(ResilientJSONStateError):
    """Neither the primary state nor its last-known-good backup was usable."""


class StateRecoveryRequiredError(ResilientJSONStateError):
    """A caller must reload/reconcile state before it may be overwritten."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _path_mutex(path: Path) -> threading.RLock:
    key = str(path.absolute())
    with _PATH_LOCKS_GUARD:
        return _PATH_LOCKS.setdefault(key, threading.RLock())


class ResilientJSONStateStore:
    """Locked, bounded, atomic JSON storage with recovery evidence.

    Every successful primary commit is copied atomically to ``.bak``. Invalid
    primary bytes are copied to a unique quarantine file before any recovery.
    If a valid backup exists, it is restored atomically. Otherwise writes from
    this store instance remain blocked so a default in-memory state cannot
    silently erase the malformed evidence.
    """

    def __init__(
        self,
        path: str | Path,
        *,
        validator: JsonValidator,
        max_state_bytes: int = 4_000_000,
        json_default: Optional[Callable[[Any], Any]] = None,
    ) -> None:
        self.path = Path(path)
        self.backup_path = self.path.with_suffix(self.path.suffix + ".bak")
        self.lock_path = self.path.with_suffix(self.path.suffix + ".lock")
        self.validator = validator
        self.max_state_bytes = max(1024, int(max_state_bytes))
        self.json_default = json_default
        self._mutex = _path_mutex(self.path)
        self._write_blocked = False
        self._observation = "unobserved"
        self._observed_primary_sha256: Optional[str] = None
        self._last_load_source = "unloaded"
        self._last_recovery: Optional[Dict[str, Any]] = None
        self._health: Dict[str, Any] = {
            "status": "healthy",
            "reason": "not_loaded",
            "source": "unloaded",
            "quarantine_path": None,
            "quarantine_path_sha256": None,
            "recovered_from_backup": False,
            "updated_at": _now_iso(),
            "last_recovery": None,
        }

    @property
    def last_load_source(self) -> str:
        return self._last_load_source

    @property
    def health(self) -> Dict[str, Any]:
        with self._mutex:
            health = copy.deepcopy(self._health)
            health["write_blocked"] = self._write_blocked
            return health

    def _set_health(
        self,
        status: str,
        reason: str,
        *,
        source: str,
        quarantine_path: Optional[Path] = None,
        recovered_from_backup: bool = False,
        recovery_event: bool = False,
    ) -> None:
        quarantine_digest = (
            hashlib.sha256(os.fsencode(str(quarantine_path.absolute()))).hexdigest()
            if quarantine_path is not None
            else None
        )
        public_quarantine_path = "[REDACTED]" if quarantine_path is not None else None
        if recovery_event:
            self._last_recovery = {
                "reason": reason,
                "source": source,
                "quarantine_path": public_quarantine_path,
                "quarantine_path_sha256": quarantine_digest,
                "recovered_from_backup": bool(recovered_from_backup),
                "at": _now_iso(),
            }
        self._health = {
            "status": status,
            "reason": reason,
            "source": source,
            "quarantine_path": public_quarantine_path,
            "quarantine_path_sha256": quarantine_digest,
            "recovered_from_backup": bool(recovered_from_backup),
            "updated_at": _now_iso(),
            "last_recovery": copy.deepcopy(self._last_recovery),
        }

    def _observe_primary(self, raw: bytes) -> None:
        self._observation = "primary"
        self._observed_primary_sha256 = hashlib.sha256(raw).hexdigest()

    def _observe_missing(self) -> None:
        self._observation = "missing"
        self._observed_primary_sha256 = None

    @contextmanager
    def _exclusive(self):
        with self._mutex:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(
                self.lock_path,
                os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0),
                0o600,
            )
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX)
                yield
            finally:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                finally:
                    os.close(descriptor)

    def _fsync_parent(self, path: Path) -> None:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        descriptor = os.open(path.parent, flags)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def _atomic_write(self, target: Path, encoded: bytes) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
        descriptor: Optional[int] = None
        try:
            descriptor = os.open(
                temporary,
                os.O_WRONLY
                | os.O_CREAT
                | os.O_EXCL
                | getattr(os, "O_CLOEXEC", 0),
                0o600,
            )
            with os.fdopen(descriptor, "wb") as handle:
                descriptor = None
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
            self._fsync_parent(target)
        finally:
            if descriptor is not None:
                os.close(descriptor)
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def _read_bytes(self, path: Path) -> bytes:
        with path.open("rb") as handle:
            raw = handle.read(self.max_state_bytes + 1)
        if len(raw) > self.max_state_bytes:
            raise ValueError(f"state exceeds {self.max_state_bytes} byte limit")
        return raw

    def _decode(self, raw: bytes, *, source: Path) -> Any:
        del source
        try:
            payload = json.loads(raw.decode("utf-8"))
            validated = self.validator(payload)
        except Exception as exc:
            raise ValueError(f"invalid JSON state ({type(exc).__name__})") from exc
        return payload if validated is None else validated

    def _validated_file(self, path: Path) -> tuple[Any, bytes]:
        raw = self._read_bytes(path)
        return self._decode(raw, source=path), raw

    def _quarantine(self, source: Path, *, label: str) -> Path:
        # Name evidence by content so repeated loads/restarts do not copy the
        # same malformed bytes indefinitely. The process lock held by every
        # caller keeps the source stable while it is hashed and copied.
        digest = hashlib.sha256()
        with source.open("rb") as existing:
            while True:
                chunk = existing.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        quarantine = source.with_name(
            f"{source.name}.{label}.{digest.hexdigest()}.evidence"
        )
        if quarantine.exists():
            existing_digest = hashlib.sha256()
            with quarantine.open("rb") as existing:
                while True:
                    chunk = existing.read(1024 * 1024)
                    if not chunk:
                        break
                    existing_digest.update(chunk)
            if hmac.compare_digest(existing_digest.digest(), digest.digest()):
                return quarantine
            quarantine = source.with_name(
                f"{source.name}.{label}.{digest.hexdigest()}.{uuid4().hex[:8]}.evidence"
            )
        descriptor: Optional[int] = None
        try:
            descriptor = os.open(
                quarantine,
                os.O_WRONLY
                | os.O_CREAT
                | os.O_EXCL
                | getattr(os, "O_CLOEXEC", 0),
                0o600,
            )
            with os.fdopen(descriptor, "wb") as target:
                descriptor = None
                with source.open("rb") as existing:
                    while True:
                        chunk = existing.read(1024 * 1024)
                        if not chunk:
                            break
                        target.write(chunk)
                target.flush()
                os.fsync(target.fileno())
            self._fsync_parent(quarantine)
            return quarantine
        except Exception:
            try:
                quarantine.unlink()
            except FileNotFoundError:
                pass
            raise
        finally:
            if descriptor is not None:
                os.close(descriptor)

    def _recover_primary(self, primary_error: Exception) -> Any:
        quarantine: Optional[Path] = None
        try:
            quarantine = self._quarantine(self.path, label="corrupt")
        except Exception as exc:
            self._write_blocked = True
            self._set_health(
                "degraded",
                f"primary_corrupt_quarantine_failed:{type(exc).__name__}",
                source="primary",
                recovery_event=True,
            )
            raise StateCorruptionError(
                "invalid state could not be quarantined"
            ) from exc

        if self.backup_path.exists():
            try:
                recovered, backup_raw = self._validated_file(self.backup_path)
            except Exception as backup_error:
                try:
                    self._quarantine(self.backup_path, label="corrupt")
                except Exception:
                    pass
                self._write_blocked = True
                self._set_health(
                    "degraded",
                    "primary_and_backup_invalid",
                    source="primary",
                    quarantine_path=quarantine,
                    recovery_event=True,
                )
                raise StateCorruptionError(
                    "primary and backup state are invalid"
                ) from backup_error

            try:
                self._atomic_write(self.path, backup_raw)
            except Exception as restore_error:
                # A valid backup is recovery evidence, not corrupt input. Keep it
                # in place so an operator or a later restart can retry recovery.
                self._write_blocked = True
                self._set_health(
                    "degraded",
                    f"primary_corrupt_backup_restore_failed:{type(restore_error).__name__}",
                    source="backup",
                    quarantine_path=quarantine,
                    recovered_from_backup=False,
                    recovery_event=True,
                )
                raise StateCorruptionError(
                    "valid backup could not restore invalid primary"
                ) from restore_error

            self._write_blocked = False
            self._last_load_source = "backup"
            self._observe_primary(backup_raw)
            self._set_health(
                "degraded",
                "primary_corrupt_recovered_from_backup",
                source="backup",
                quarantine_path=quarantine,
                recovered_from_backup=True,
                recovery_event=True,
            )
            return recovered

        self._write_blocked = True
        self._set_health(
            "degraded",
            "primary_corrupt_no_backup",
            source="primary",
            quarantine_path=quarantine,
            recovery_event=True,
        )
        raise StateCorruptionError(
            "invalid state has no last-known-good backup"
        ) from primary_error

    def _restore_missing_primary(self) -> Any:
        try:
            value, backup_raw = self._validated_file(self.backup_path)
        except Exception as backup_error:
            quarantine: Optional[Path] = None
            try:
                quarantine = self._quarantine(self.backup_path, label="corrupt")
            except Exception as quarantine_error:
                self._write_blocked = True
                self._set_health(
                    "degraded",
                    f"primary_missing_backup_quarantine_failed:{type(quarantine_error).__name__}",
                    source="backup",
                    recovery_event=True,
                )
                raise StateCorruptionError(
                    "invalid backup could not be quarantined"
                ) from quarantine_error
            self._write_blocked = True
            self._set_health(
                "degraded",
                "primary_missing_backup_invalid",
                source="backup",
                quarantine_path=quarantine,
                recovery_event=True,
            )
            raise StateCorruptionError(
                "primary state is missing and backup is invalid"
            ) from backup_error

        try:
            self._atomic_write(self.path, backup_raw)
        except Exception as restore_error:
            self._write_blocked = True
            self._set_health(
                "degraded",
                f"primary_missing_backup_restore_failed:{type(restore_error).__name__}",
                source="backup",
                recovery_event=True,
            )
            raise StateCorruptionError(
                "valid backup could not restore missing primary"
            ) from restore_error

        self._write_blocked = False
        self._last_load_source = "backup"
        self._observe_primary(backup_raw)
        self._set_health(
            "degraded",
            "primary_missing_recovered_from_backup",
            source="backup",
            recovered_from_backup=True,
            recovery_event=True,
        )
        return value

    def _ensure_last_known_good(self, primary_raw: bytes) -> None:
        """Seed or repair the LKG while a validated primary remains authoritative."""
        if not self.backup_path.exists():
            try:
                self._atomic_write(self.backup_path, primary_raw)
            except Exception as backup_error:
                self._set_health(
                    "degraded",
                    f"backup_seed_failed:{type(backup_error).__name__}",
                    source="primary",
                )
            return

        try:
            _backup_value, backup_raw = self._validated_file(self.backup_path)
        except Exception as backup_error:
            backup_error_type = type(backup_error).__name__
            try:
                quarantine = self._quarantine(self.backup_path, label="corrupt")
            except Exception as quarantine_error:
                self._set_health(
                    "degraded",
                    f"backup_invalid_quarantine_failed:{type(quarantine_error).__name__}",
                    source="primary",
                    recovery_event=True,
                )
                return
        else:
            if backup_raw == primary_raw:
                return
            # A previous backup commit may have failed after the primary was
            # already durable. A semantically valid but stale backup is not a
            # last-known-good copy of the current state and must be repaired
            # before a later primary corruption can roll work backward.
            try:
                self._atomic_write(self.backup_path, primary_raw)
            except Exception as repair_error:
                self._set_health(
                    "degraded",
                    f"stale_backup_repair_failed:{type(repair_error).__name__}",
                    source="primary",
                )
                return
            self._set_health(
                "degraded",
                "stale_backup_replaced",
                source="primary",
                recovered_from_backup=False,
                recovery_event=True,
            )
            return

        try:
            self._atomic_write(self.backup_path, primary_raw)
        except Exception as repair_error:
            self._set_health(
                "degraded",
                f"backup_repair_failed:{type(repair_error).__name__}",
                source="primary",
                quarantine_path=quarantine,
                recovery_event=True,
            )
            return

        self._set_health(
            "degraded",
            f"invalid_backup_replaced:{backup_error_type}",
            source="primary",
            quarantine_path=quarantine,
            recovered_from_backup=False,
            recovery_event=True,
        )

    def _load_locked(self, *, default_factory: Callable[[], Any]) -> Any:
        """Load while ``_exclusive`` is already held by this store.

        The split lets compound read/modify/write owners, such as the
        maintenance queue, keep one process lock across the entire transition
        instead of reopening a race between ``load`` and ``save``.
        """

        if self.path.exists():
            try:
                value, primary_raw = self._validated_file(self.path)
            except Exception as exc:
                return self._recover_primary(exc)
            self._write_blocked = False
            self._last_load_source = "primary"
            self._observe_primary(primary_raw)
            self._set_health("healthy", "loaded_primary", source="primary")
            self._ensure_last_known_good(primary_raw)
            return value

        if self.backup_path.exists():
            return self._restore_missing_primary()

        value = default_factory()
        try:
            validated = self.validator(value)
        except Exception as exc:
            raise ValueError(f"invalid default state ({type(exc).__name__})") from exc
        self._write_blocked = False
        self._last_load_source = "missing"
        self._observe_missing()
        self._set_health("healthy", "state_missing", source="missing")
        return value if validated is None else validated

    def load(self, *, default_factory: Callable[[], Any]) -> Any:
        with self._exclusive():
            return self._load_locked(default_factory=default_factory)

    def _encode(self, payload: Any) -> bytes:
        validated = self.validator(payload)
        value = payload if validated is None else validated
        encoded = (
            json.dumps(
                value,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
                allow_nan=False,
                default=self.json_default,
            )
            + "\n"
        ).encode("utf-8")
        if len(encoded) > self.max_state_bytes:
            raise ValueError(f"state exceeds {self.max_state_bytes} byte limit")
        return encoded

    def _save_encoded_locked(self, encoded: bytes) -> None:
        """Commit validated bytes while ``_exclusive`` is already held."""

        if self._write_blocked:
            raise StateRecoveryRequiredError(
                "state writes are blocked until malformed state is explicitly recovered"
            )

        if self.path.exists():
            try:
                _current_value, current_raw = self._validated_file(self.path)
            except Exception as exc:
                self._recover_primary(exc)
                self._write_blocked = True
                raise StateRecoveryRequiredError(
                    "state changed or was recovered; reload before saving"
                ) from exc
            current_digest = hashlib.sha256(current_raw).hexdigest()
            if (
                self._observation != "primary"
                or not self._observed_primary_sha256
                or self._observed_primary_sha256 != current_digest
            ):
                self._write_blocked = True
                self._set_health(
                    "degraded",
                    "stale_snapshot_conflict",
                    source="primary",
                )
                raise StateRecoveryRequiredError(
                    "state changed since it was loaded; reload before saving"
                )
        elif self.backup_path.exists():
            try:
                self._restore_missing_primary()
            except Exception as exc:
                raise StateRecoveryRequiredError(
                    "primary state is missing and backup must be reconciled"
                ) from exc
            self._write_blocked = True
            raise StateRecoveryRequiredError(
                "state was recovered from backup; reload before saving"
            )
        elif self._observation == "primary":
            self._write_blocked = True
            self._set_health(
                "degraded",
                "observed_primary_missing",
                source="missing",
            )
            raise StateRecoveryRequiredError(
                "state disappeared since it was loaded; reload before saving"
            )

        try:
            self._atomic_write(self.path, encoded)
        except Exception as exc:
            self._set_health(
                "degraded",
                f"primary_write_failed:{type(exc).__name__}",
                source="primary",
            )
            raise
        self._observe_primary(encoded)

        try:
            self._atomic_write(self.backup_path, encoded)
        except Exception as exc:
            # The primary commit is durable. Surface reduced recoverability
            # without inviting a retry that could duplicate an outer action.
            self._set_health(
                "degraded",
                f"backup_write_failed:{type(exc).__name__}",
                source="primary",
            )
            return

        self._last_load_source = "primary"
        self._set_health("healthy", "committed", source="primary")

    def save(self, payload: Any) -> None:
        encoded = self._encode(payload)
        with self._exclusive():
            self._save_encoded_locked(encoded)


__all__ = [
    "ResilientJSONStateError",
    "ResilientJSONStateStore",
    "StateCorruptionError",
    "StateRecoveryRequiredError",
]
