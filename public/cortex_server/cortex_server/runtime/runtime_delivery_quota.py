"""Shared bounded persistence admission for the runtime-delivery volume."""

from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import threading
import time
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple
from uuid import uuid4

from cortex_server.runtime.durable_files import durable_mkdir, fsync_directory


MAX_RUNTIME_DELIVERY_OBJECT_BYTES = 4 * 1024 * 1024
MAX_RUNTIME_DELIVERY_PROCESS_BYTES = 64 * 1024 * 1024
MAX_RUNTIME_DELIVERY_STORE_BYTES = 512 * 1024 * 1024
MAX_RUNTIME_DELIVERY_VOLUME_BYTES = 1536 * 1024 * 1024
RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES = 128 * 1024 * 1024
RUNTIME_DELIVERY_RECOVERY_TRANSACTION_BYTES = 32 * 1024 * 1024
MAX_RUNTIME_DELIVERY_PROCESSES = 4096
MAX_HISTORY_RECORDS = 256
MAX_HISTORY_BYTES = 32 * 1024 * 1024
MAX_REPORT_RECORDS = 256
MAX_REPORT_BYTES = 16 * 1024 * 1024
MAX_SESSION_EVENT_PROJECTION_BYTES = 32 * 1024 * 1024
RUNTIME_DELIVERY_RESERVATION_TIMEOUT_SECONDS = 10 * 60
RUNTIME_DELIVERY_PHYSICAL_RESERVE_FILE = ".runtime-delivery-physical-recovery-reserve"

_LOCKS: Dict[str, threading.RLock] = {}
_LOCKS_GUARD = threading.Lock()
_TRANSACTION_STATE = threading.local()


class RuntimeDeliveryQuotaError(ValueError):
    """A write would consume bounded operational or recovery capacity."""


def encoded_json(payload: Dict[str, Any], *, pretty: bool = False) -> bytes:
    return (
        json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            indent=2 if pretty else None,
            separators=None if pretty else (",", ":"),
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def _usage(root: Path) -> int:
    total = 0
    if not root.exists():
        return 0
    try:
        if root.is_file() and not root.is_symlink():
            return int(root.stat().st_size)
    except FileNotFoundError:
        return 0
    for candidate in root.rglob("*"):
        try:
            if ".runtime-delivery-reservations" in candidate.parts:
                continue
            if candidate.name == RUNTIME_DELIVERY_PHYSICAL_RESERVE_FILE:
                continue
            if candidate.is_file() and not candidate.is_symlink():
                total += candidate.stat().st_size
        except FileNotFoundError:
            continue
    return total


def _process_owned_paths(delivery_root: Path, process_id: str) -> List[Path]:
    """Return exact durable paths owned by one immutable process identity."""

    if not delivery_root.exists():
        return []
    process_digest = hashlib.sha256(process_id.encode("utf-8")).hexdigest()
    canonical_names = {
        f"{process_id}.json",
        f"{process_id}.jsonl",
        f".{process_id}.json.rollback-intent.json",
        f".{process_id}.json.save-intent.json",
    }
    owned: List[Path] = []
    for candidate in delivery_root.rglob("*"):
        try:
            if not candidate.is_file() or candidate.is_symlink():
                continue
            relative_parts = candidate.relative_to(delivery_root).parts
            canonical = candidate.name in canonical_names
            hashed_rollback_result = (
                len(relative_parts) >= 3
                and relative_parts[-3] == "rollback_results"
                and relative_parts[-2] == process_digest
                and candidate.suffix == ".json"
            )
            if canonical or hashed_rollback_result:
                owned.append(candidate)
        except FileNotFoundError:
            continue
    return owned


def _resolved_replacements(
    delivery_root: Path,
    replacements: Sequence[Tuple[Path, int]],
) -> List[Tuple[Path, int]]:
    resolved: List[Tuple[Path, int]] = []
    seen: set[Path] = set()
    for raw_path, raw_size in replacements:
        target = Path(raw_path).resolve()
        try:
            target.relative_to(delivery_root)
        except ValueError as exc:
            raise ValueError("runtime delivery replacement must be inside delivery_root") from exc
        if target in seen:
            raise ValueError("runtime delivery replacement paths must be unique")
        size = int(raw_size)
        if size < 0:
            raise ValueError("runtime delivery replacement size must be non-negative")
        seen.add(target)
        resolved.append((target, size))
    return resolved


def _volume_usage(delivery_root: Path) -> int:
    """Account the capacity-isolated runtime-delivery tree."""

    return _usage(Path(delivery_root).resolve())


def _physical_reserve_enabled() -> bool:
    return os.getenv("CORTEX_RUNTIME_DELIVERY_PREALLOCATE_RECOVERY_RESERVE", "false").strip().lower() in {
        "1", "true", "yes", "on",
    }


def _physical_reserve_path(delivery_root: Path) -> Path:
    return Path(delivery_root).resolve() / RUNTIME_DELIVERY_PHYSICAL_RESERVE_FILE


def _physical_reserve_bytes(delivery_root: Path) -> int:
    target = _physical_reserve_path(delivery_root)
    try:
        return int(target.stat().st_size) if target.is_file() and not target.is_symlink() else 0
    except FileNotFoundError:
        return 0


def _physical_reserve_allocated_bytes(delivery_root: Path) -> int:
    target = _physical_reserve_path(delivery_root)
    try:
        stat = target.stat()
        if not target.is_file() or target.is_symlink():
            return 0
        # POSIX st_blocks is reported in 512-byte units and proves the reserve
        # is allocated rather than merely a sparse logical file.
        return int(stat.st_blocks) * 512
    except FileNotFoundError:
        return 0


def _resize_physical_reserve(delivery_root: Path, size: int) -> None:
    if not _physical_reserve_enabled():
        return
    root = Path(delivery_root).resolve()
    durable_mkdir(root)
    target = _physical_reserve_path(root)
    requested = max(0, int(size))
    if (
        _physical_reserve_bytes(root) == requested
        and _physical_reserve_allocated_bytes(root) >= requested
    ):
        return
    if target.is_file() and not target.is_symlink():
        try:
            flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
            fd = os.open(target, flags)
            try:
                current = int(os.fstat(fd).st_size)
                if requested >= current:
                    if not hasattr(os, "posix_fallocate"):
                        raise OSError("posix_fallocate is required for the recovery reserve")
                    os.posix_fallocate(fd, 0, requested)
                os.ftruncate(fd, requested)
                os.fsync(fd)
            finally:
                os.close(fd)
            fsync_directory(root)
            return
        except OSError as exc:
            raise RuntimeDeliveryQuotaError(
                "runtime delivery physical recovery reserve could not be resized"
            ) from exc
    temporary = target.with_name(f".{target.name}.{os.getpid()}.{uuid4().hex}.tmp")
    try:
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
        try:
            if not hasattr(os, "posix_fallocate"):
                raise OSError("posix_fallocate is required for the recovery reserve")
            os.posix_fallocate(fd, 0, requested)
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(temporary, target)
        fsync_directory(root)
    except OSError as exc:
        raise RuntimeDeliveryQuotaError(
            "runtime delivery physical recovery reserve could not be allocated"
        ) from exc
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _filesystem_available(delivery_root: Path) -> int:
    root = Path(delivery_root).resolve()
    probe = root if root.exists() else root.parent
    stats = os.statvfs(probe)
    return int(stats.f_bavail) * int(stats.f_frsize)


def runtime_delivery_capacity(delivery_root: Path) -> Dict[str, int | bool]:
    root = Path(delivery_root).resolve()
    used = _volume_usage(root)
    reserved = _active_reservation_bytes_unlocked(root, prune_stale=False)
    available = _filesystem_available(root)
    operational_limit = MAX_RUNTIME_DELIVERY_VOLUME_BYTES - RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES
    physical_reserve = _physical_reserve_bytes(root)
    physical_reserve_allocated = _physical_reserve_allocated_bytes(root)
    reserve_enforced = _physical_reserve_enabled()
    return {
        "ok": (
            used + reserved <= operational_limit
            and (
                physical_reserve == RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES
                and physical_reserve_allocated >= RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES
                if reserve_enforced
                else available - reserved >= RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES
            )
        ),
        "usedBytes": used,
        "reservedBytes": reserved,
        "operationalLimitBytes": operational_limit,
        "volumeLimitBytes": MAX_RUNTIME_DELIVERY_VOLUME_BYTES,
        "recoveryReserveBytes": RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES,
        "filesystemAvailableBytes": available,
        "physicalRecoveryReserveBytes": physical_reserve,
        "physicalRecoveryReserveAllocatedBytes": physical_reserve_allocated,
        "physicalRecoveryReserveEnforced": reserve_enforced,
        "operationalRemainingBytes": max(0, operational_limit - used - reserved),
        "recoveryRemainingBytes": max(0, MAX_RUNTIME_DELIVERY_VOLUME_BYTES - used - reserved),
    }


@contextmanager
def runtime_delivery_quota_transaction(delivery_root: Path) -> Iterator[None]:
    root = Path(delivery_root).resolve()
    durable_mkdir(root)
    lock_target = root / ".runtime-delivery-volume-quota.lock"
    lock_key = str(lock_target)
    with _LOCKS_GUARD:
        thread_lock = _LOCKS.setdefault(lock_key, threading.RLock())
    with thread_lock:
        depths = dict(getattr(_TRANSACTION_STATE, "depths", {}))
        if int(depths.get(lock_key, 0) or 0) > 0:
            depths[lock_key] += 1
            _TRANSACTION_STATE.depths = depths
            try:
                yield
            finally:
                depths[lock_key] -= 1
                _TRANSACTION_STATE.depths = depths
            return
        with lock_target.open("a+b") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            depths[lock_key] = 1
            _TRANSACTION_STATE.depths = depths
            try:
                if not _recovery_admission(root):
                    _resize_physical_reserve(
                        root,
                        RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES,
                    )
                yield
            finally:
                depths.pop(lock_key, None)
                _TRANSACTION_STATE.depths = depths
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _pending_recovery_intent(
    delivery_root: Path,
    *,
    process_id: str,
    transaction_id: str,
    intent_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    process = str(process_id or "").strip()
    transaction = str(transaction_id or "").strip()
    if not process or not transaction:
        return None
    candidates: List[Path] = []
    if intent_path is not None:
        candidates.append(Path(intent_path))
    roots = (
        delivery_root / "release_workflow",
        delivery_root / "rollback_transactions",
    )
    for root in roots:
        if not root.exists():
            continue
        candidates.extend(root.glob(".*.rollback-intent.json"))
    for target in candidates:
        try:
            payload = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if (
            isinstance(payload, dict)
            and str(payload.get("process_id") or "") == process
            and str(payload.get("transaction_id") or "") == transaction
            and payload.get("status") in {"in_progress", "recovery_required"}
        ):
            return payload
    return None


@contextmanager
def runtime_delivery_recovery_transaction(
    delivery_root: Path,
    *,
    process_id: str,
    transaction_id: str,
    intent_path: Optional[Path] = None,
) -> Iterator[None]:
    """Admit bounded reserve writes only for an already durable rollback."""

    root = Path(delivery_root).resolve()
    lock_key = str(root / ".runtime-delivery-volume-quota.lock")
    with runtime_delivery_quota_transaction(root):
        intent = _pending_recovery_intent(
            root,
            process_id=process_id,
            transaction_id=transaction_id,
            intent_path=intent_path,
        )
        if intent is None:
            raise RuntimeDeliveryQuotaError(
                "runtime delivery recovery reserve requires a durable pending rollback intent"
            )
        recoveries = dict(getattr(_TRANSACTION_STATE, "recoveries", {}))
        existing = recoveries.get(lock_key)
        if existing is not None and existing != (str(process_id), str(transaction_id)):
            raise RuntimeDeliveryQuotaError("runtime delivery recovery transaction identity conflict")
        recoveries[lock_key] = (str(process_id), str(transaction_id))
        _TRANSACTION_STATE.recoveries = recoveries
        _resize_physical_reserve(
            root,
            max(
                0,
                RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES
                - RUNTIME_DELIVERY_RECOVERY_TRANSACTION_BYTES,
            ),
        )
        try:
            yield
        finally:
            if existing is None:
                recoveries.pop(lock_key, None)
            else:
                recoveries[lock_key] = existing
            _TRANSACTION_STATE.recoveries = recoveries
            try:
                _resize_physical_reserve(root, RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES)
            except RuntimeDeliveryQuotaError:
                # The rollback itself is already durably committed. Readiness
                # remains failed until capacity cleanup permits replenishment;
                # never rewrite a committed intent as recovery-required solely
                # because post-commit reserve replenishment is unavailable.
                pass


def _recovery_admission(delivery_root: Path) -> bool:
    lock_key = str(Path(delivery_root).resolve() / ".runtime-delivery-volume-quota.lock")
    return lock_key in dict(getattr(_TRANSACTION_STATE, "recoveries", {}))


def _assert_volume_projection(root: Path, *, additional_bytes: int) -> None:
    reservations = _active_reservation_bytes_unlocked(root, prune_stale=True)
    additional = max(0, int(additional_bytes))
    projected_volume = _volume_usage(root) + reservations + additional
    recovery = _recovery_admission(root)
    operational_limit = MAX_RUNTIME_DELIVERY_VOLUME_BYTES - RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES
    admission_limit = (
        min(
            MAX_RUNTIME_DELIVERY_VOLUME_BYTES,
            operational_limit + RUNTIME_DELIVERY_RECOVERY_TRANSACTION_BYTES,
        )
        if recovery
        else operational_limit
    )
    if projected_volume > admission_limit:
        detail = "bounded rollback recovery capacity exceeded" if recovery else "recovery reserve preserved"
        raise RuntimeDeliveryQuotaError(f"runtime delivery volume quota exceeded; {detail}")
    if _physical_reserve_enabled():
        required_filesystem_headroom = 0
    else:
        required_filesystem_headroom = max(
            0,
            RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES
            - (RUNTIME_DELIVERY_RECOVERY_TRANSACTION_BYTES if recovery else 0),
        )
    if _filesystem_available(root) - reservations - additional < required_filesystem_headroom:
        raise RuntimeDeliveryQuotaError(
            "runtime delivery filesystem headroom is below the bounded recovery reserve"
            if recovery
            else "runtime delivery filesystem headroom is below the recovery reserve"
        )


def _active_reservation_bytes_unlocked(delivery_root: Path, *, prune_stale: bool) -> int:
    reservation_root = delivery_root / ".runtime-delivery-reservations"
    if not reservation_root.exists():
        return 0
    current_time = time.time()
    total = 0
    for target in reservation_root.glob("*.json"):
        try:
            payload = json.loads(target.read_text(encoding="utf-8"))
            pid = int(payload["pid"])
            created_at = float(payload["created_at"])
            reserved_bytes = int(payload["reserved_bytes"])
            if reserved_bytes <= 0:
                raise ValueError("invalid reservation size")
            owner_alive = True
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                owner_alive = False
            except PermissionError:
                owner_alive = True
            if not owner_alive or current_time - created_at > RUNTIME_DELIVERY_RESERVATION_TIMEOUT_SECONDS:
                if prune_stale:
                    target.unlink()
                continue
            total += reserved_bytes
        except (KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
            # An invalid reservation cannot safely be treated as free capacity.
            total += MAX_SESSION_EVENT_PROJECTION_BYTES
    return total


@contextmanager
def runtime_delivery_capacity_reservation(
    delivery_root: Path,
    *,
    reserved_bytes: int,
) -> Iterator[None]:
    root = Path(delivery_root).resolve()
    requested = int(reserved_bytes)
    if requested <= 0:
        raise ValueError("runtime delivery reservation must be positive")
    token = uuid4().hex
    target = root / ".runtime-delivery-reservations" / f"{token}.json"
    with runtime_delivery_quota_transaction(root):
        assert_runtime_delivery_volume_capacity(root, additional_bytes=requested)
        _atomic_write_bytes(
            target,
            encoded_json(
                {
                    "version": "cortex.runtime-delivery-reservation.v1",
                    "pid": os.getpid(),
                    "created_at": time.time(),
                    "reserved_bytes": requested,
                }
            ),
        )
    try:
        yield
    finally:
        with runtime_delivery_quota_transaction(root):
            try:
                target.unlink()
            except FileNotFoundError:
                pass
            else:
                fsync_directory(target.parent)


def assert_runtime_delivery_capacity(
    *,
    delivery_root: Path,
    store_root: Path,
    process_id: str,
    object_bytes: int,
    additional_bytes: int,
    replacing: Optional[Path] = None,
    replacements: Optional[Sequence[Tuple[Path, int]]] = None,
) -> None:
    if object_bytes > MAX_RUNTIME_DELIVERY_OBJECT_BYTES:
        raise ValueError(
            f"runtime delivery object exceeds {MAX_RUNTIME_DELIVERY_OBJECT_BYTES} bytes"
        )
    process = str(process_id or "").strip()
    if not process:
        raise ValueError("runtime delivery process_id is required for quota admission")
    root = Path(delivery_root).resolve()
    store = Path(store_root).resolve()
    projected_replacements = list(replacements or [])
    if replacing is not None:
        projected_replacements.append((replacing, int(additional_bytes)))
    projected_replacements = _resolved_replacements(root, projected_replacements)
    current_replaced = sum(
        path.stat().st_size
        for path, _new_size in projected_replacements
        if path.exists()
    )
    final_replacement_bytes = sum(new_size for _path, new_size in projected_replacements)
    final_added = final_replacement_bytes if projected_replacements else int(additional_bytes)
    store_usage = _usage(store)
    projected_store = store_usage - current_replaced + final_added
    if projected_store > MAX_RUNTIME_DELIVERY_STORE_BYTES:
        raise ValueError("runtime delivery store quota exceeded")
    # Process ownership is derived from exact server-owned layouts across the
    # complete delivery root.  Canonical projections use an exact basename;
    # rollback idempotency results use the exact SHA-256 process namespace.
    # Explicit replacement targets cover suffix-style stores and are projected
    # atomically even when their basename does not embed the process identity.
    process_paths = set(_process_owned_paths(root, process))
    process_paths.update(path for path, _new_size in projected_replacements if path.exists())
    process_usage = sum(
        path.stat().st_size
        for path in process_paths
        if path.exists() and path.is_file() and not path.is_symlink()
    )
    process_replaced = sum(
        path.stat().st_size
        for path, _new_size in projected_replacements
        if path.exists() and path.is_file() and not path.is_symlink()
    )
    process_added = sum(
        new_size
        for _path, new_size in projected_replacements
    ) if projected_replacements else int(additional_bytes)
    projected_process = process_usage - process_replaced + process_added
    if projected_process > MAX_RUNTIME_DELIVERY_PROCESS_BYTES:
        raise ValueError("runtime delivery process quota exceeded")
    # Atomic replacement temporarily needs the old and new object together.
    _assert_volume_projection(root, additional_bytes=additional_bytes)


def assert_runtime_delivery_volume_capacity(delivery_root: Path, *, additional_bytes: int) -> None:
    root = Path(delivery_root).resolve()
    _assert_volume_projection(root, additional_bytes=additional_bytes)


def assert_process_count(store_root: Path, process_id: str, *, delivery_root: Optional[Path] = None) -> None:
    contracts = Path(store_root) / "contracts"
    target = contracts / f"{process_id}.json"
    root = Path(delivery_root).resolve() if delivery_root is not None else Path(store_root).resolve()
    process_ids = {
        candidate.stem
        for candidate in root.rglob("contracts/*.json")
        if candidate.is_file() and not candidate.is_symlink()
    }
    release_root = root / "release_workflow"
    if release_root.exists():
        process_ids.update(
            candidate.stem
            for candidate in release_root.glob("*.json")
            if candidate.is_file() and not candidate.is_symlink() and not candidate.name.startswith(".")
        )
    registry_target = root / ".runtime-delivery-processes.json"
    if registry_target.exists():
        try:
            registry = json.loads(registry_target.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("runtime delivery process registry is corrupt") from exc
        if (
            not isinstance(registry, dict)
            or registry.get("version") != "cortex.runtime-delivery-processes.v1"
            or not isinstance(registry.get("process_ids"), list)
            or any(not isinstance(value, str) or not value for value in registry["process_ids"])
        ):
            raise ValueError("runtime delivery process registry is invalid")
        process_ids.update(registry["process_ids"])
    if process_id not in process_ids and len(process_ids) >= MAX_RUNTIME_DELIVERY_PROCESSES:
        raise ValueError("runtime delivery process count exceeds immutable limit")
    if process_id in process_ids and registry_target.exists():
        return
    process_ids.add(process_id)
    encoded = encoded_json(
        {
            "version": "cortex.runtime-delivery-processes.v1",
            "process_ids": sorted(process_ids),
        },
        pretty=True,
    )
    if len(encoded) > MAX_RUNTIME_DELIVERY_OBJECT_BYTES:
        raise ValueError("runtime delivery process registry exceeds immutable object quota")
    _assert_volume_projection(root, additional_bytes=len(encoded))
    _atomic_write_bytes(registry_target, encoded)


def read_recoverable_jsonl(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    raw = path.read_bytes()
    rows: List[Dict[str, Any]] = []
    lines = raw.splitlines(keepends=True)
    for index, line in enumerate(lines):
        if not line.endswith(b"\n"):
            if index == len(lines) - 1:
                break
            raise ValueError(f"incomplete non-final JSONL record in {path}")
        try:
            row = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            if index == len(lines) - 1:
                break
            raise ValueError(f"invalid non-final JSONL record in {path}") from exc
        if not isinstance(row, dict):
            raise ValueError(f"JSONL record in {path} must be an object")
        rows.append(row)
    return rows


def _atomic_write_bytes(path: Path, payload: bytes) -> None:
    durable_mkdir(path.parent)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        if temporary.exists():
            temporary.unlink()


def append_bounded_jsonl(
    path: Path,
    row: Dict[str, Any],
    *,
    max_records: int,
    max_bytes: int,
) -> None:
    _atomic_write_bytes(
        path,
        bounded_jsonl_payload(
            path,
            row,
            max_records=max_records,
            max_bytes=max_bytes,
        ),
    )


def bounded_jsonl_payload(
    path: Path,
    row: Dict[str, Any],
    *,
    max_records: int,
    max_bytes: int,
) -> bytes:
    rows = read_recoverable_jsonl(path)
    rows.append(dict(row))
    rows = rows[-max_records:]
    encoded_rows = [encoded_json(candidate) for candidate in rows]
    while encoded_rows and sum(len(candidate) for candidate in encoded_rows) > max_bytes:
        encoded_rows.pop(0)
    if not encoded_rows:
        raise ValueError(f"runtime delivery JSONL record exceeds {max_bytes} bytes")
    return b"".join(encoded_rows)


__all__ = [
    "MAX_HISTORY_BYTES",
    "MAX_HISTORY_RECORDS",
    "MAX_REPORT_BYTES",
    "MAX_REPORT_RECORDS",
    "MAX_SESSION_EVENT_PROJECTION_BYTES",
    "MAX_RUNTIME_DELIVERY_OBJECT_BYTES",
    "RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES",
    "RUNTIME_DELIVERY_RECOVERY_TRANSACTION_BYTES",
    "RUNTIME_DELIVERY_PHYSICAL_RESERVE_FILE",
    "RuntimeDeliveryQuotaError",
    "append_bounded_jsonl",
    "bounded_jsonl_payload",
    "assert_process_count",
    "assert_runtime_delivery_capacity",
    "assert_runtime_delivery_volume_capacity",
    "encoded_json",
    "read_recoverable_jsonl",
    "runtime_delivery_capacity",
    "runtime_delivery_capacity_reservation",
    "runtime_delivery_quota_transaction",
    "runtime_delivery_recovery_transaction",
]
