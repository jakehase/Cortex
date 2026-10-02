"""Durable, cross-process admission ledger for Celery API submissions."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


CAPACITY_STATES = (
    "dispatching",
    "dispatch_unknown",
    "scheduled",
    "pending",
    "cancellation_requested",
)
TERMINAL_STATES = ("success", "failure", "cancelled")


class QueueAdmissionStoreError(RuntimeError):
    """The durable admission ledger could not be read or mutated safely."""


class QueueCapacityUnavailable(RuntimeError):
    def __init__(self, capacity: int):
        super().__init__("queue capacity exhausted")
        self.capacity = capacity


class QueueIdempotencyConflict(RuntimeError):
    """An idempotency key was reused for a different request digest."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect(db_path: Path | str) -> sqlite3.Connection:
    path = Path(str(db_path))
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(path), timeout=2.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=2000")
        try:
            connection.execute("PRAGMA journal_mode=WAL")
        except sqlite3.OperationalError as exc:
            if "locked" not in str(exc).lower():
                raise
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS queue_admissions (
                idempotency_key TEXT PRIMARY KEY,
                request_digest TEXT NOT NULL,
                status TEXT NOT NULL,
                task_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_admissions_task "
            "ON queue_admissions(task_id) WHERE task_id IS NOT NULL"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_queue_admissions_status_updated "
            "ON queue_admissions(status, updated_at)"
        )
        return connection
    except (OSError, sqlite3.Error) as exc:
        raise QueueAdmissionStoreError("queue admission ledger unavailable") from exc


def _row_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    return dict(row) if row is not None else None


def _placeholders(values: Iterable[str]) -> str:
    return ",".join("?" for _value in values)


def _trim_terminal(
    connection: sqlite3.Connection, *, max_records: int
) -> None:
    row = connection.execute("SELECT COUNT(*) AS total FROM queue_admissions").fetchone()
    total = int(row["total"] if row is not None else 0)
    excess = max(0, total - max_records)
    if excess <= 0:
        return
    terminal = tuple(TERMINAL_STATES)
    connection.execute(
        "DELETE FROM queue_admissions WHERE idempotency_key IN ("
        "SELECT idempotency_key FROM queue_admissions "
        f"WHERE status IN ({_placeholders(terminal)}) "
        "ORDER BY updated_at ASC LIMIT ?)",
        (*terminal, excess),
    )


def reserve(
    db_path: Path | str,
    *,
    idempotency_key: str,
    request_digest: str,
    capacity: int,
    max_records: int,
) -> tuple[Dict[str, Any], bool]:
    """Atomically deduplicate and reserve one capacity slot."""

    connection = _connect(db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            "SELECT * FROM queue_admissions WHERE idempotency_key = ?",
            (idempotency_key,),
        ).fetchone()
        if existing is not None:
            record = dict(existing)
            if str(record.get("request_digest") or "") != request_digest:
                raise QueueIdempotencyConflict
            connection.execute(
                "UPDATE queue_admissions SET updated_at = ? WHERE idempotency_key = ?",
                (_now_iso(), idempotency_key),
            )
            connection.commit()
            return record, True

        states = tuple(CAPACITY_STATES)
        count_row = connection.execute(
            "SELECT COUNT(*) AS total FROM queue_admissions "
            f"WHERE status IN ({_placeholders(states)})",
            states,
        ).fetchone()
        pending = int(count_row["total"] if count_row is not None else 0)
        if pending >= capacity:
            raise QueueCapacityUnavailable(capacity)

        now = _now_iso()
        connection.execute(
            "INSERT INTO queue_admissions("
            "idempotency_key, request_digest, status, task_id, created_at, updated_at"
            ") VALUES (?, ?, 'dispatching', NULL, ?, ?)",
            (idempotency_key, request_digest, now, now),
        )
        _trim_terminal(connection, max_records=max_records)
        connection.commit()
        return {
            "idempotency_key": idempotency_key,
            "request_digest": request_digest,
            "status": "dispatching",
            "task_id": None,
            "created_at": now,
            "updated_at": now,
        }, False
    except (QueueCapacityUnavailable, QueueIdempotencyConflict):
        connection.rollback()
        raise
    except sqlite3.Error as exc:
        connection.rollback()
        raise QueueAdmissionStoreError("queue admission reservation failed") from exc
    finally:
        connection.close()


def update(
    db_path: Path | str,
    idempotency_key: str,
    *,
    status: str,
    task_id: Optional[str] = None,
    max_records: int,
) -> Dict[str, Any]:
    connection = _connect(db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        if task_id:
            connection.execute(
                "UPDATE queue_admissions SET status = ?, task_id = ?, updated_at = ? "
                "WHERE idempotency_key = ?",
                (status, task_id, _now_iso(), idempotency_key),
            )
        else:
            connection.execute(
                "UPDATE queue_admissions SET status = ?, updated_at = ? "
                "WHERE idempotency_key = ?",
                (status, _now_iso(), idempotency_key),
            )
        _trim_terminal(connection, max_records=max_records)
        row = connection.execute(
            "SELECT * FROM queue_admissions WHERE idempotency_key = ?",
            (idempotency_key,),
        ).fetchone()
        connection.commit()
        return dict(row) if row is not None else {}
    except sqlite3.Error as exc:
        connection.rollback()
        raise QueueAdmissionStoreError("queue admission update failed") from exc
    finally:
        connection.close()


def get_by_task(db_path: Path | str, task_id: str) -> Optional[Dict[str, Any]]:
    connection = _connect(db_path)
    try:
        return _row_dict(
            connection.execute(
                "SELECT * FROM queue_admissions WHERE task_id = ?", (task_id,)
            ).fetchone()
        )
    except sqlite3.Error as exc:
        raise QueueAdmissionStoreError("queue admission lookup failed") from exc
    finally:
        connection.close()


def counts(db_path: Path | str, *, capacity: int) -> tuple[int, int, int]:
    connection = _connect(db_path)
    try:
        states = tuple(CAPACITY_STATES)
        row = connection.execute(
            "SELECT COUNT(*) AS total FROM queue_admissions "
            f"WHERE status IN ({_placeholders(states)})",
            states,
        ).fetchone()
        pending = int(row["total"] if row is not None else 0)
        return pending, capacity, max(0, capacity - pending)
    except sqlite3.Error as exc:
        raise QueueAdmissionStoreError("queue admission count failed") from exc
    finally:
        connection.close()


def list_reconcilable(
    db_path: Path | str, *, limit: int
) -> List[Dict[str, Any]]:
    connection = _connect(db_path)
    try:
        rows = connection.execute(
            "SELECT * FROM queue_admissions "
            "WHERE task_id IS NOT NULL "
            "AND status IN ('scheduled', 'pending', 'cancellation_requested') "
            "ORDER BY updated_at ASC LIMIT ?",
            (max(1, int(limit)),),
        ).fetchall()
        return [dict(row) for row in rows]
    except sqlite3.Error as exc:
        raise QueueAdmissionStoreError("queue admission reconciliation lookup failed") from exc
    finally:
        connection.close()


def clear(db_path: Path | str) -> None:
    connection = _connect(db_path)
    try:
        connection.execute("DELETE FROM queue_admissions")
        connection.commit()
    except sqlite3.Error as exc:
        raise QueueAdmissionStoreError("queue admission reset failed") from exc
    finally:
        connection.close()


__all__ = [
    "CAPACITY_STATES",
    "TERMINAL_STATES",
    "QueueAdmissionStoreError",
    "QueueCapacityUnavailable",
    "QueueIdempotencyConflict",
    "clear",
    "counts",
    "get_by_task",
    "list_reconcilable",
    "reserve",
    "update",
]
