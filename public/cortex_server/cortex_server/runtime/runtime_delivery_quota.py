"""Shared bounded persistence admission for the runtime-delivery volume."""

from __future__ import annotations

from contextlib import contextmanager
import fcntl
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
MAX_RUNTIME_DELIVERY_PROCESSES = 4096
MAX_HISTORY_RECORDS = 256
MAX_HISTORY_BYTES = 32 * 1024 * 1024
MAX_REPORT_RECORDS = 256
MAX_REPORT_BYTES = 16 * 1024 * 1024
MAX_SESSION_EVENT_PROJECTION_BYTES = 32 * 1024 * 1024
RUNTIME_DELIVERY_RESERVATION_TIMEOUT_SECONDS = 10 * 60

_LOCKS: Dict[str, threading.RLock] = {}
_LOCKS_GUARD = threading.Lock()


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
    for candidate in root.rglob("*"):
        try:
            if ".runtime-delivery-reservations" in candidate.parts:
                continue
            if candidate.is_file() and not candidate.is_symlink():
                total += candidate.stat().st_size
        except FileNotFoundError:
            continue
    return total


def _volume_usage(delivery_root: Path) -> int:
    """Account the mounted state volume, including sibling databases."""

    root = Path(delivery_root).resolve()
    volume_root = root.parent if root.name == "runtime_delivery" else root
    return _usage(volume_root)


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
    return {
        "ok": (
            used + reserved <= operational_limit
            and available - reserved >= RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES
        ),
        "usedBytes": used,
        "reservedBytes": reserved,
        "operationalLimitBytes": operational_limit,
        "volumeLimitBytes": MAX_RUNTIME_DELIVERY_VOLUME_BYTES,
        "recoveryReserveBytes": RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES,
        "filesystemAvailableBytes": available,
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
        with lock_target.open("a+b") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


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
    process_usage = 0
    if store.exists():
        for candidate in store.rglob(f"{process}.*"):
            try:
                if candidate.is_file() and not candidate.is_symlink():
                    process_usage += candidate.stat().st_size
            except FileNotFoundError:
                continue
    process_replaced = sum(
        path.stat().st_size
        for path, _new_size in projected_replacements
        if path.exists() and process in path.name
    )
    process_added = sum(
        new_size
        for path, new_size in projected_replacements
        if process in path.name
    ) if projected_replacements else int(additional_bytes)
    projected_process = process_usage - process_replaced + process_added
    if projected_process > MAX_RUNTIME_DELIVERY_PROCESS_BYTES:
        raise ValueError("runtime delivery process quota exceeded")
    # Atomic replacement temporarily needs the old and new object together.
    projected_volume = (
        _volume_usage(root)
        + _active_reservation_bytes_unlocked(root, prune_stale=True)
        + max(0, int(additional_bytes))
    )
    operational_limit = MAX_RUNTIME_DELIVERY_VOLUME_BYTES - RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES
    if projected_volume > operational_limit:
        raise RuntimeDeliveryQuotaError("runtime delivery volume quota exceeded; recovery reserve preserved")
    if (
        _filesystem_available(root)
        - _active_reservation_bytes_unlocked(root, prune_stale=True)
        - max(0, int(additional_bytes))
        < RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES
    ):
        raise RuntimeDeliveryQuotaError("runtime delivery filesystem headroom is below the recovery reserve")


def assert_runtime_delivery_volume_capacity(delivery_root: Path, *, additional_bytes: int) -> None:
    root = Path(delivery_root).resolve()
    projected_volume = (
        _volume_usage(root)
        + _active_reservation_bytes_unlocked(root, prune_stale=True)
        + max(0, int(additional_bytes))
    )
    operational_limit = MAX_RUNTIME_DELIVERY_VOLUME_BYTES - RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES
    if projected_volume > operational_limit:
        raise RuntimeDeliveryQuotaError("runtime delivery volume quota exceeded; recovery reserve preserved")
    if (
        _filesystem_available(root)
        - _active_reservation_bytes_unlocked(root, prune_stale=True)
        - max(0, int(additional_bytes))
        < RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES
    ):
        raise RuntimeDeliveryQuotaError("runtime delivery filesystem headroom is below the recovery reserve")


def assert_process_count(store_root: Path, process_id: str, *, delivery_root: Optional[Path] = None) -> None:
    contracts = Path(store_root) / "contracts"
    target = contracts / f"{process_id}.json"
    if target.exists():
        return
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
    if process_id not in process_ids and len(process_ids) >= MAX_RUNTIME_DELIVERY_PROCESSES:
        raise ValueError("runtime delivery process count exceeds immutable limit")


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
]
