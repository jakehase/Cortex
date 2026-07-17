"""Durable atomic reservation ledger for Nexus commit-assurance receipts."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from typing import Any, Mapping, Optional


_SCHEMA_VERSION = 4
_LEDGER_LOCK = threading.RLock()
_LOCK_RETRY_SECONDS = 10.0
_LOCK_RETRY_INTERVAL_SECONDS = 0.01
_MAX_LEDGER_ROWS = 65_536
_MAX_SCOPE_ROWS = 4_096
_MAX_RESULT_BYTES = 256 * 1024
_MAX_RESULT_STORAGE_BYTES = 256 * 1024 * 1024
_CONSUMED_RETENTION_AFTER_EXPIRY_SECONDS = 24 * 60 * 60
_ABANDONED_RETENTION_AFTER_EXPIRY_SECONDS = 7 * 24 * 60 * 60
_RECOVERY_CLAIM_TIMEOUT_SECONDS = 30
_RECOVERY_ROW_RESERVE = 1024
_MAX_RECOVERY_RESULT_STORAGE_BYTES = _RECOVERY_ROW_RESERVE * _MAX_RESULT_BYTES


class AssuranceReceiptLedgerUnavailable(RuntimeError):
    """Raised when replay protection cannot be durably consulted or updated."""


@dataclass(frozen=True)
class AssuranceReceiptReservation:
    scope_digest: str
    scope_json: str
    jti: str
    token: str
    expires_at: int


def _canonical_scope(scope: Mapping[str, Any]) -> tuple[str, str]:
    scope_json = json.dumps(
        {str(key): str(value) for key, value in scope.items()},
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(
        f"nexus.commit-receipt.scope.v1\0{scope_json}".encode("utf-8")
    ).hexdigest()
    return digest, scope_json


def _is_sqlite_lock_contention(exc: sqlite3.OperationalError) -> bool:
    error_code = getattr(exc, "sqlite_errorcode", None)
    if not isinstance(error_code, int):
        return False
    primary_error_code = error_code & 0xFF
    return primary_error_code in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED)


def _enable_wal(connection: sqlite3.Connection) -> None:
    """Enable WAL even when another process is initializing the same ledger."""

    deadline = time.monotonic() + _LOCK_RETRY_SECONDS
    while True:
        try:
            current_mode = connection.execute("PRAGMA journal_mode").fetchone()
            if current_mode is not None and str(current_mode[0]).lower() == "wal":
                return
            configured_mode = connection.execute("PRAGMA journal_mode=WAL").fetchone()
            if configured_mode is None or str(configured_mode[0]).lower() != "wal":
                raise sqlite3.OperationalError("unable to enable WAL journal mode")
            return
        except sqlite3.OperationalError as exc:
            if not _is_sqlite_lock_contention(exc) or time.monotonic() >= deadline:
                raise
            time.sleep(_LOCK_RETRY_INTERVAL_SECONDS)


def _connect(state_path: Path) -> sqlite3.Connection:
    state_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        os.chmod(state_path.parent, 0o700)
    except OSError:
        pass
    connection: Optional[sqlite3.Connection] = None
    try:
        connection = sqlite3.connect(str(state_path), timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=10000")
        _enable_wal(connection)
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS assurance_receipt_ledger (
                scope_digest TEXT NOT NULL,
                scope_json TEXT NOT NULL,
                jti TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('reserved', 'consumed')),
                reservation_token TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                result_json TEXT,
                result_capacity_bytes INTEGER NOT NULL DEFAULT 0,
                result_capacity_pool TEXT NOT NULL DEFAULT 'normal'
                    CHECK (result_capacity_pool IN ('normal', 'recovery')),
                recovery_token TEXT,
                recovery_started_at INTEGER,
                schema_version INTEGER NOT NULL,
                PRIMARY KEY (scope_digest, jti)
            )
            """
        )
        columns = {
            str(row[1])
            for row in connection.execute("PRAGMA table_info(assurance_receipt_ledger)").fetchall()
        }
        if "result_json" not in columns:
            connection.execute("ALTER TABLE assurance_receipt_ledger ADD COLUMN result_json TEXT")
        if "result_capacity_bytes" not in columns:
            connection.execute(
                "ALTER TABLE assurance_receipt_ledger "
                "ADD COLUMN result_capacity_bytes INTEGER NOT NULL DEFAULT 0"
            )
        if "result_capacity_pool" not in columns:
            connection.execute(
                "ALTER TABLE assurance_receipt_ledger "
                "ADD COLUMN result_capacity_pool TEXT NOT NULL DEFAULT 'normal'"
            )
        if "recovery_token" not in columns:
            connection.execute("ALTER TABLE assurance_receipt_ledger ADD COLUMN recovery_token TEXT")
        if "recovery_started_at" not in columns:
            connection.execute("ALTER TABLE assurance_receipt_ledger ADD COLUMN recovery_started_at INTEGER")
        # Reservations admitted by an older schema did not carry a result-byte
        # allocation.  Grandfather them into the bounded recovery pool so an
        # upgrade cannot strand a durable write that still needs finalization.
        connection.execute(
            "UPDATE assurance_receipt_ledger SET result_capacity_bytes = ?, "
            "result_capacity_pool = 'recovery', schema_version = ? "
            "WHERE status = 'reserved' AND result_capacity_bytes = 0",
            (_MAX_RESULT_BYTES, _SCHEMA_VERSION),
        )
    except Exception:
        if connection is not None:
            connection.close()
        raise
    try:
        os.chmod(state_path, 0o600)
    except OSError:
        pass
    return connection


def _compact_and_assert_capacity(
    connection: sqlite3.Connection,
    *,
    current_time: int,
    scope_digest: Optional[str] = None,
    admitting: bool = False,
) -> None:
    """Bound replay state while retaining every still-usable recovery tombstone."""

    connection.execute(
        "DELETE FROM assurance_receipt_ledger WHERE status = 'consumed' AND expires_at < ?",
        (current_time - _CONSUMED_RETENTION_AFTER_EXPIRY_SECONDS,),
    )
    connection.execute(
        "DELETE FROM assurance_receipt_ledger WHERE status = 'reserved' AND expires_at < ? "
        "AND (recovery_token IS NULL OR recovery_started_at < ?)",
        (
            current_time - _ABANDONED_RETENTION_AFTER_EXPIRY_SECONDS,
            current_time - max(
                _ABANDONED_RETENTION_AFTER_EXPIRY_SECONDS,
                _RECOVERY_CLAIM_TIMEOUT_SECONDS,
            ),
        ),
    )
    if not admitting:
        return
    total_rows = int(connection.execute("SELECT COUNT(*) FROM assurance_receipt_ledger").fetchone()[0])
    if total_rows >= _MAX_LEDGER_ROWS:
        raise AssuranceReceiptLedgerUnavailable("assurance_receipt_ledger_global_quota_exceeded")
    if scope_digest:
        scope_rows = int(
            connection.execute(
                "SELECT COUNT(*) FROM assurance_receipt_ledger WHERE scope_digest = ?",
                (scope_digest,),
            ).fetchone()[0]
        )
        if scope_rows >= _MAX_SCOPE_ROWS:
            raise AssuranceReceiptLedgerUnavailable("assurance_receipt_ledger_scope_quota_exceeded")
    result_storage = int(
        connection.execute(
            "SELECT COALESCE(SUM(CASE WHEN status = 'reserved' THEN result_capacity_bytes "
            "ELSE LENGTH(CAST(result_json AS BLOB)) END), 0) "
            "FROM assurance_receipt_ledger WHERE result_capacity_pool = 'normal'"
        ).fetchone()[0]
    )
    if result_storage + _MAX_RESULT_BYTES > _MAX_RESULT_STORAGE_BYTES:
        raise AssuranceReceiptLedgerUnavailable("assurance_receipt_ledger_result_quota_exceeded")


def reserve_assurance_receipt(
    state_path: Path,
    *,
    scope: Mapping[str, Any],
    jti: str,
    expires_at: int,
    now: Optional[int] = None,
) -> AssuranceReceiptReservation:
    """Atomically reserve one signed scope/JTI before its durable memory write."""

    current_time = int(time.time()) if now is None else int(now)
    normalized_jti = str(jti or "")
    normalized_expiry = int(expires_at)
    if not normalized_jti or normalized_expiry < current_time:
        raise ValueError("expired_receipt")
    scope_digest, scope_json = _canonical_scope(scope)
    token = secrets.token_hex(32)
    connection: Optional[sqlite3.Connection] = None
    try:
        with _LEDGER_LOCK:
            connection = _connect(Path(state_path))
            connection.execute("BEGIN IMMEDIATE")
            _compact_and_assert_capacity(connection, current_time=current_time)
            # Never discard an expired reservation automatically. It may mark
            # a durable L22 write whose response/finalization was interrupted;
            # losing it would falsely authorize a fresh JTI and a duplicate.
            existing = connection.execute(
                "SELECT scope_json, status FROM assurance_receipt_ledger "
                "WHERE scope_digest = ? AND jti = ?",
                (scope_digest, normalized_jti),
            ).fetchone()
            if existing is not None:
                if str(existing["scope_json"]) != scope_json:
                    raise AssuranceReceiptLedgerUnavailable(
                        "receipt_scope_digest_collision"
                    )
                raise ValueError(
                    "receipt_already_consumed"
                    if str(existing["status"]) == "consumed"
                    else "receipt_commit_in_progress"
                )
            _compact_and_assert_capacity(
                connection,
                current_time=current_time,
                scope_digest=scope_digest,
                admitting=True,
            )
            connection.execute(
                "INSERT INTO assurance_receipt_ledger("
                "scope_digest, scope_json, jti, status, reservation_token, expires_at, updated_at, "
                "result_capacity_bytes, result_capacity_pool, schema_version"
                ") VALUES (?, ?, ?, 'reserved', ?, ?, ?, ?, 'normal', ?)",
                (
                    scope_digest,
                    scope_json,
                    normalized_jti,
                    token,
                    normalized_expiry,
                    current_time,
                    _MAX_RESULT_BYTES,
                    _SCHEMA_VERSION,
                ),
            )
            connection.commit()
    except ValueError:
        if connection is not None:
            connection.rollback()
        raise
    except AssuranceReceiptLedgerUnavailable:
        if connection is not None:
            connection.rollback()
        raise
    except (OSError, sqlite3.Error, TypeError) as exc:
        if connection is not None:
            connection.rollback()
        raise AssuranceReceiptLedgerUnavailable(
            "assurance_receipt_ledger_unavailable"
        ) from exc
    finally:
        if connection is not None:
            connection.close()
    return AssuranceReceiptReservation(
        scope_digest=scope_digest,
        scope_json=scope_json,
        jti=normalized_jti,
        token=token,
        expires_at=normalized_expiry,
    )


def finalize_assurance_receipt(
    state_path: Path,
    reservation: AssuranceReceiptReservation,
    *,
    result: Mapping[str, Any],
    now: Optional[int] = None,
) -> None:
    """Atomically make a successful reservation permanently consumed until expiry."""

    current_time = int(time.time()) if now is None else int(now)
    result_json = json.dumps(dict(result), ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    result_bytes = len(result_json.encode("utf-8"))
    if result_bytes > _MAX_RESULT_BYTES:
        raise AssuranceReceiptLedgerUnavailable("assurance_receipt_result_too_large")
    connection: Optional[sqlite3.Connection] = None
    try:
        with _LEDGER_LOCK:
            connection = _connect(Path(state_path))
            connection.execute("BEGIN IMMEDIATE")
            _compact_and_assert_capacity(connection, current_time=current_time)
            allocated = connection.execute(
                "SELECT result_capacity_bytes FROM assurance_receipt_ledger "
                "WHERE scope_digest = ? AND jti = ? AND scope_json = ? "
                "AND reservation_token = ? AND status = 'reserved'",
                (
                    reservation.scope_digest,
                    reservation.jti,
                    reservation.scope_json,
                    reservation.token,
                ),
            ).fetchone()
            if allocated is None:
                raise AssuranceReceiptLedgerUnavailable(
                    "assurance_receipt_reservation_lost"
                )
            if result_bytes > int(allocated["result_capacity_bytes"] or 0):
                raise AssuranceReceiptLedgerUnavailable(
                    "assurance_receipt_result_capacity_missing"
                )
            cursor = connection.execute(
                "UPDATE assurance_receipt_ledger SET status = 'consumed', updated_at = ?, result_json = ?, "
                "result_capacity_bytes = 0, recovery_token = NULL, recovery_started_at = NULL, schema_version = ? "
                "WHERE scope_digest = ? AND jti = ? AND scope_json = ? "
                "AND reservation_token = ? AND status = 'reserved'",
                (
                    current_time,
                    result_json,
                    _SCHEMA_VERSION,
                    reservation.scope_digest,
                    reservation.jti,
                    reservation.scope_json,
                    reservation.token,
                ),
            )
            if cursor.rowcount != 1:
                raise AssuranceReceiptLedgerUnavailable(
                    "assurance_receipt_reservation_lost"
                )
            connection.commit()
    except AssuranceReceiptLedgerUnavailable:
        if connection is not None:
            connection.rollback()
        raise
    except (OSError, sqlite3.Error) as exc:
        if connection is not None:
            connection.rollback()
        raise AssuranceReceiptLedgerUnavailable(
            "assurance_receipt_ledger_unavailable"
        ) from exc
    finally:
        if connection is not None:
            connection.close()


def recover_assurance_receipt(
    state_path: Path,
    *,
    scope: Mapping[str, Any],
    jti: str,
    now: Optional[int] = None,
    restore_expires_at: Optional[int] = None,
) -> AssuranceReceiptReservation:
    """Claim finalization after the caller has proven the exact L22 write exists.

    The claim rotates the reservation token once. A crashed recovery claimant can
    itself be replaced after a bounded timeout; ordinary concurrent commits
    cannot steal the live reservation because they never call this path before
    obtaining an idempotent L22 replay result.
    """

    current_time = int(time.time()) if now is None else int(now)
    scope_digest, scope_json = _canonical_scope(scope)
    normalized_jti = str(jti or "")
    token = secrets.token_hex(32)
    connection: Optional[sqlite3.Connection] = None
    try:
        with _LEDGER_LOCK:
            connection = _connect(Path(state_path))
            connection.execute("BEGIN IMMEDIATE")
            _compact_and_assert_capacity(connection, current_time=current_time)
            row = connection.execute(
                "SELECT scope_json, status, expires_at, recovery_token, recovery_started_at "
                "FROM assurance_receipt_ledger WHERE scope_digest = ? AND jti = ?",
                (scope_digest, normalized_jti),
            ).fetchone()
            if row is None:
                if restore_expires_at is None:
                    raise AssuranceReceiptLedgerUnavailable("assurance_receipt_recovery_state_missing")
                total_rows = int(
                    connection.execute("SELECT COUNT(*) FROM assurance_receipt_ledger").fetchone()[0]
                )
                if total_rows >= _MAX_LEDGER_ROWS + _RECOVERY_ROW_RESERVE:
                    raise AssuranceReceiptLedgerUnavailable("assurance_receipt_ledger_recovery_quota_exceeded")
                scope_rows = int(
                    connection.execute(
                        "SELECT COUNT(*) FROM assurance_receipt_ledger WHERE scope_digest = ?",
                        (scope_digest,),
                    ).fetchone()[0]
                )
                if scope_rows >= _MAX_SCOPE_ROWS + _RECOVERY_ROW_RESERVE:
                    raise AssuranceReceiptLedgerUnavailable("assurance_receipt_ledger_scope_recovery_quota_exceeded")
                recovery_result_storage = int(
                    connection.execute(
                        "SELECT COALESCE(SUM(CASE WHEN status = 'reserved' THEN result_capacity_bytes "
                        "ELSE LENGTH(CAST(result_json AS BLOB)) END), 0) "
                        "FROM assurance_receipt_ledger WHERE result_capacity_pool = 'recovery'"
                    ).fetchone()[0]
                )
                if (
                    recovery_result_storage + _MAX_RESULT_BYTES
                    > _MAX_RECOVERY_RESULT_STORAGE_BYTES
                ):
                    raise AssuranceReceiptLedgerUnavailable(
                        "assurance_receipt_ledger_result_recovery_quota_exceeded"
                    )
                expires_at = int(restore_expires_at)
                connection.execute(
                    "INSERT INTO assurance_receipt_ledger("
                    "scope_digest, scope_json, jti, status, reservation_token, expires_at, updated_at, "
                    "result_capacity_bytes, result_capacity_pool, recovery_token, recovery_started_at, schema_version"
                    ") VALUES (?, ?, ?, 'reserved', ?, ?, ?, ?, 'recovery', ?, ?, ?)",
                    (
                        scope_digest,
                        scope_json,
                        normalized_jti,
                        token,
                        expires_at,
                        current_time,
                        _MAX_RESULT_BYTES,
                        token,
                        current_time,
                        _SCHEMA_VERSION,
                    ),
                )
                connection.commit()
                row = None
            if row is None:
                # The exact durable L22 proof authorized restoration above.
                pass
            elif str(row["scope_json"]) != scope_json:
                raise AssuranceReceiptLedgerUnavailable("receipt_scope_digest_collision")
            elif str(row["status"]) != "reserved":
                raise ValueError("receipt_already_consumed")
            else:
                recovery_started_at = int(row["recovery_started_at"] or 0)
                if row["recovery_token"] and current_time - recovery_started_at < _RECOVERY_CLAIM_TIMEOUT_SECONDS:
                    raise ValueError("receipt_commit_in_progress")
                cursor = connection.execute(
                    "UPDATE assurance_receipt_ledger SET reservation_token = ?, recovery_token = ?, "
                    "recovery_started_at = ?, updated_at = ?, schema_version = ? "
                    "WHERE scope_digest = ? AND jti = ? AND scope_json = ? AND status = 'reserved' "
                    "AND (recovery_token IS NULL OR recovery_started_at <= ?)",
                    (
                        token,
                        token,
                        current_time,
                        current_time,
                        _SCHEMA_VERSION,
                        scope_digest,
                        normalized_jti,
                        scope_json,
                        current_time - _RECOVERY_CLAIM_TIMEOUT_SECONDS,
                    ),
                )
                if cursor.rowcount != 1:
                    raise ValueError("receipt_commit_in_progress")
                connection.commit()
                expires_at = int(row["expires_at"])
    except (ValueError, AssuranceReceiptLedgerUnavailable):
        if connection is not None:
            connection.rollback()
        raise
    except (OSError, sqlite3.Error, TypeError) as exc:
        if connection is not None:
            connection.rollback()
        raise AssuranceReceiptLedgerUnavailable("assurance_receipt_ledger_unavailable") from exc
    finally:
        if connection is not None:
            connection.close()
    return AssuranceReceiptReservation(
        scope_digest=scope_digest,
        scope_json=scope_json,
        jti=normalized_jti,
        token=token,
        expires_at=expires_at,
    )


def consumed_assurance_receipt_result(
    state_path: Path,
    *,
    scope: Mapping[str, Any],
    jti: str,
) -> Optional[dict[str, Any]]:
    """Return the exact prior commit result for a consumed same-scope JTI."""

    scope_digest, scope_json = _canonical_scope(scope)
    connection: Optional[sqlite3.Connection] = None
    try:
        with _LEDGER_LOCK:
            connection = _connect(Path(state_path))
            row = connection.execute(
                "SELECT scope_json, status, result_json FROM assurance_receipt_ledger "
                "WHERE scope_digest = ? AND jti = ?",
                (scope_digest, str(jti or "")),
            ).fetchone()
            if row is None:
                return None
            if str(row["scope_json"]) != scope_json:
                raise AssuranceReceiptLedgerUnavailable("receipt_scope_digest_collision")
            if str(row["status"]) != "consumed":
                return None
            raw_result = str(row["result_json"] or "")
            if not raw_result:
                raise AssuranceReceiptLedgerUnavailable("consumed_receipt_result_missing")
            parsed = json.loads(raw_result)
            if not isinstance(parsed, dict):
                raise AssuranceReceiptLedgerUnavailable("consumed_receipt_result_invalid")
            return parsed
    except AssuranceReceiptLedgerUnavailable:
        raise
    except (OSError, sqlite3.Error, json.JSONDecodeError, TypeError) as exc:
        raise AssuranceReceiptLedgerUnavailable("assurance_receipt_ledger_unavailable") from exc
    finally:
        if connection is not None:
            connection.close()


def assurance_receipt_status(
    state_path: Path,
    *,
    scope: Mapping[str, Any],
    jti: str,
) -> Optional[str]:
    """Return reserved/consumed only for the exact canonical receipt scope."""

    scope_digest, scope_json = _canonical_scope(scope)
    connection: Optional[sqlite3.Connection] = None
    try:
        with _LEDGER_LOCK:
            connection = _connect(Path(state_path))
            row = connection.execute(
                "SELECT scope_json, status FROM assurance_receipt_ledger "
                "WHERE scope_digest = ? AND jti = ?",
                (scope_digest, str(jti or "")),
            ).fetchone()
            if row is None:
                return None
            if str(row["scope_json"]) != scope_json:
                raise AssuranceReceiptLedgerUnavailable("receipt_scope_digest_collision")
            status = str(row["status"] or "")
            if status not in {"reserved", "consumed"}:
                raise AssuranceReceiptLedgerUnavailable("assurance_receipt_status_invalid")
            return status
    except AssuranceReceiptLedgerUnavailable:
        raise
    except (OSError, sqlite3.Error, TypeError) as exc:
        raise AssuranceReceiptLedgerUnavailable("assurance_receipt_ledger_unavailable") from exc
    finally:
        if connection is not None:
            connection.close()


def release_assurance_receipt(
    state_path: Path,
    reservation: AssuranceReceiptReservation,
) -> None:
    """Safely release only the caller's still-pending reservation after a failed write."""

    connection: Optional[sqlite3.Connection] = None
    try:
        with _LEDGER_LOCK:
            connection = _connect(Path(state_path))
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "DELETE FROM assurance_receipt_ledger "
                "WHERE scope_digest = ? AND jti = ? AND scope_json = ? "
                "AND reservation_token = ? AND status = 'reserved'",
                (
                    reservation.scope_digest,
                    reservation.jti,
                    reservation.scope_json,
                    reservation.token,
                ),
            )
            connection.commit()
    except (OSError, sqlite3.Error) as exc:
        if connection is not None:
            connection.rollback()
        raise AssuranceReceiptLedgerUnavailable(
            "assurance_receipt_ledger_unavailable"
        ) from exc
    finally:
        if connection is not None:
            connection.close()
