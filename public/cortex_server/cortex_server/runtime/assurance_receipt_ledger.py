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


_SCHEMA_VERSION = 1
_LEDGER_LOCK = threading.RLock()


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
        connection.execute("PRAGMA journal_mode=WAL")
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
                schema_version INTEGER NOT NULL,
                PRIMARY KEY (scope_digest, jti)
            )
            """
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
            connection.execute(
                "DELETE FROM assurance_receipt_ledger WHERE expires_at < ?",
                (current_time,),
            )
            existing = connection.execute(
                "SELECT scope_json FROM assurance_receipt_ledger "
                "WHERE scope_digest = ? AND jti = ?",
                (scope_digest, normalized_jti),
            ).fetchone()
            if existing is not None:
                if str(existing["scope_json"]) != scope_json:
                    raise AssuranceReceiptLedgerUnavailable(
                        "receipt_scope_digest_collision"
                    )
                raise ValueError("receipt_already_consumed")
            connection.execute(
                "INSERT INTO assurance_receipt_ledger("
                "scope_digest, scope_json, jti, status, reservation_token, expires_at, updated_at, schema_version"
                ") VALUES (?, ?, ?, 'reserved', ?, ?, ?, ?)",
                (
                    scope_digest,
                    scope_json,
                    normalized_jti,
                    token,
                    normalized_expiry,
                    current_time,
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
    now: Optional[int] = None,
) -> None:
    """Atomically make a successful reservation permanently consumed until expiry."""

    current_time = int(time.time()) if now is None else int(now)
    connection: Optional[sqlite3.Connection] = None
    try:
        with _LEDGER_LOCK:
            connection = _connect(Path(state_path))
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "UPDATE assurance_receipt_ledger SET status = 'consumed', updated_at = ? "
                "WHERE scope_digest = ? AND jti = ? AND scope_json = ? "
                "AND reservation_token = ? AND status = 'reserved'",
                (
                    current_time,
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
