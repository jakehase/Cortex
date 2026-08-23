"""L22 compatibility router.

Provides stable endpoints expected by OpenClaw config:
- POST /l22/store
- POST /l22/search

Plus novelty-aware extensions:
- POST /l22/store_novel
- POST /l22/search_novel
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from typing import Callable, List, Optional, TypeVar
from datetime import datetime, timedelta, timezone
import fcntl
import json
import logging
import os
from hashlib import sha256
from pathlib import Path
import sqlite3
import threading
import time
import uuid
from cortex_server.routers.librarian import (
    CHROMA_DIR,
    DEFAULT_TENANT_ID,
    DEFAULT_WORKSPACE_ID,
    MemoryPrincipalScope,
    MemoryScopeId,
    collection,
    index_with_novelty,
    robust_search,
    search_with_novelty,
    _normalize_memory_metadata,
    _add_memory_with_supersession,
    FactSupersessionError,
    MemoryTag,
    _validate_memory_metadata,
    _memory_scope,
    _authenticated_memory_principal_scope,
    _memory_scope_auth_ready,
    _production_memory_mode,
    _quota_fallback_rows,
)
from cortex_server.modules.memory_scope import (
    memory_principal_for_request,
    principal_memory_where,
    request_memory_idempotency_key,
    require_authenticated_memory_principal,
    scoped_memory_metadata,
)

router = APIRouter(dependencies=[Depends(require_authenticated_memory_principal)])
logger = logging.getLogger(__name__)
_STRUCTURED_MEMORY_LOCK = threading.RLock()
_L22_MAX_CONTENT_BYTES = 1_000_000
_L22_QUOTA_FIXED_RECORD_BYTES = 4096
_L22_QUOTA_RESERVATION_TIMEOUT_SECONDS = 10 * 60
_L22_RECOVERY_RESERVE_BYTES = 256 * 1024 * 1024
_L22_PHYSICAL_RESERVE_FILE = ".l22-physical-recovery-reserve"
_L22_QUOTA_BACKFILL_VERSION = "v2-complete"
_L22_IDEMPOTENCY_TTL_SECONDS = 30 * 24 * 60 * 60
_L22_IDEMPOTENCY_MAX_RECORDS = 100_000
_L22_IDEMPOTENCY_MAX_BYTES = 64 * 1024 * 1024
_L22_IDEMPOTENCY_FIXED_RECORD_BYTES = 256
_L22_QUOTA_LIMIT_DEFAULTS = {
    "workspace_records": 100_000,
    "workspace_bytes": 512 * 1024 * 1024,
    "credential_records": 200_000,
    "credential_bytes": 1024 * 1024 * 1024,
    "tenant_records": 250_000,
    "tenant_bytes": 2 * 1024 * 1024 * 1024,
    "global_records": 1_000_000,
    "global_bytes": 8 * 1024 * 1024 * 1024,
}
_QUOTA_WRITER_IDENTITY_LOCK = threading.Lock()
_QUOTA_WRITER_IDENTITY: dict[str, object] = {}
_QuotaWriteResult = TypeVar("_QuotaWriteResult")


@router.on_event("startup")
async def initialize_l22_quota_recovery_reserve() -> None:
    if _l22_reserve_enabled():
        connection = _structured_memory_connection()
        connection.close()
    if _production_memory_mode():
        _backfill_l22_quota_ledger()
    _reconcile_l22_quota_reservations()
    _prune_memory_idempotency_ledger()


def _structured_memory_db_path() -> Path:
    return Path(os.getenv("CORTEX_L22_STRUCTURED_DB", str(Path(CHROMA_DIR) / "l22_structured.sqlite3")))


def _structured_memory_connection() -> sqlite3.Connection:
    db_path = _structured_memory_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    _ensure_l22_physical_reserve(db_path.parent)
    connection = sqlite3.connect(str(db_path), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=10000")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS structured_memory (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL DEFAULT 'cortex-local',
            workspace_id TEXT NOT NULL DEFAULT 'default',
            memory_type TEXT NOT NULL,
            lookup_key TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL,
            metadata_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    columns = {
        str(row[1])
        for row in connection.execute("PRAGMA table_info(structured_memory)").fetchall()
    }
    added_tenant = "tenant_id" not in columns
    added_workspace = "workspace_id" not in columns
    if added_tenant:
        connection.execute(
            "ALTER TABLE structured_memory ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'cortex-local'"
        )
    if added_workspace:
        connection.execute(
            "ALTER TABLE structured_memory ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default'"
        )
    if added_tenant:
        connection.execute("UPDATE structured_memory SET tenant_id = ?", (DEFAULT_TENANT_ID,))
    else:
        connection.execute(
            "UPDATE structured_memory SET tenant_id = ? WHERE tenant_id IS NULL OR tenant_id = ''",
            (DEFAULT_TENANT_ID,),
        )
    if added_workspace:
        connection.execute("UPDATE structured_memory SET workspace_id = ?", (DEFAULT_WORKSPACE_ID,))
    else:
        connection.execute(
            "UPDATE structured_memory SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id = ''",
            (DEFAULT_WORKSPACE_ID,),
        )
    connection.execute(
        "CREATE TABLE IF NOT EXISTS memory_idempotency ("
        "tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, "
        "request_hash TEXT NOT NULL, record_json TEXT NOT NULL, created_at TEXT NOT NULL, "
        "PRIMARY KEY (tenant_id, workspace_id, idempotency_key))"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_memory_idempotency_scope_created "
        "ON memory_idempotency(tenant_id, workspace_id, created_at DESC)"
    )
    connection.execute(
        "CREATE TABLE IF NOT EXISTS l22_quota_records ("
        "memory_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, "
        "credential_id TEXT NOT NULL, charge_bytes INTEGER NOT NULL, payload_hash TEXT NOT NULL, "
        "status TEXT NOT NULL CHECK(status IN ('reserved', 'committed')), created_at REAL NOT NULL, "
        "owner_token TEXT NOT NULL DEFAULT '', writer_pid INTEGER NOT NULL DEFAULT 0, "
        "writer_start_ticks TEXT NOT NULL DEFAULT '', writer_boot_id TEXT NOT NULL DEFAULT '', "
        "lease_expires_at REAL NOT NULL DEFAULT 0)"
    )
    quota_columns = {
        str(row[1])
        for row in connection.execute("PRAGMA table_info(l22_quota_records)").fetchall()
    }
    quota_column_migrations = {
        "owner_token": "TEXT NOT NULL DEFAULT ''",
        "writer_pid": "INTEGER NOT NULL DEFAULT 0",
        "writer_start_ticks": "TEXT NOT NULL DEFAULT ''",
        "writer_boot_id": "TEXT NOT NULL DEFAULT ''",
        "lease_expires_at": "REAL NOT NULL DEFAULT 0",
    }
    for column, definition in quota_column_migrations.items():
        if column not in quota_columns:
            connection.execute(
                f"ALTER TABLE l22_quota_records ADD COLUMN {column} {definition}"
            )
    connection.execute(
        "CREATE TABLE IF NOT EXISTS l22_quota_usage ("
        "scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, record_count INTEGER NOT NULL, "
        "byte_count INTEGER NOT NULL, PRIMARY KEY(scope_type, scope_id))"
    )
    connection.execute(
        "CREATE TABLE IF NOT EXISTS l22_quota_state ("
        "key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_structured_memory_type_key_created "
        "ON structured_memory(memory_type, lookup_key, created_at DESC)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_structured_memory_scope_type_key_created "
        "ON structured_memory(tenant_id, workspace_id, memory_type, lookup_key, created_at DESC)"
    )
    connection.commit()
    return connection


def _bounded_quota_setting(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    if not raw.isdecimal() or int(raw) <= 0:
        raise RuntimeError(f"{name} must be a positive integer")
    # Quotas may be reduced for a deployment, but cannot be configured into an
    # unbounded durable-amplification surface.
    return min(int(raw), int(default))


def _l22_idempotency_limits() -> dict[str, int]:
    return {
        "ttl_seconds": _bounded_quota_setting(
            "CORTEX_L22_IDEMPOTENCY_TTL_SECONDS",
            _L22_IDEMPOTENCY_TTL_SECONDS,
        ),
        "max_records": _bounded_quota_setting(
            "CORTEX_L22_IDEMPOTENCY_MAX_RECORDS",
            _L22_IDEMPOTENCY_MAX_RECORDS,
        ),
        "max_bytes": _bounded_quota_setting(
            "CORTEX_L22_IDEMPOTENCY_MAX_BYTES",
            _L22_IDEMPOTENCY_MAX_BYTES,
        ),
    }


def _idempotency_row_bytes(row: sqlite3.Row) -> int:
    return (
        len(str(row["idempotency_key"] or "").encode("utf-8"))
        + len(str(row["request_hash"] or "").encode("utf-8"))
        + len(str(row["record_json"] or "").encode("utf-8"))
        + len(str(row["created_at"] or "").encode("utf-8"))
        + _L22_IDEMPOTENCY_FIXED_RECORD_BYTES
    )


def _idempotency_row_replay_identity(
    row: sqlite3.Row,
    *,
    tenant: str,
    workspace: str,
) -> tuple[str, str]:
    """Validate the ledger claim and return its deterministic durable identity."""

    key = str(row["idempotency_key"] or "")
    request_hash = str(row["request_hash"] or "")
    expected_id = str(
        uuid.uuid5(uuid.NAMESPACE_URL, f"cortex:l22:{tenant}:{workspace}:{key}")
    )
    try:
        record = json.loads(str(row["record_json"] or ""))
        metadata = record.get("metadata") if isinstance(record, dict) else None
    except (TypeError, ValueError) as exc:
        raise RuntimeError(
            "historical L22 idempotency rows require migration before retention pruning"
        ) from exc
    if (
        not isinstance(record, dict)
        or str(record.get("id") or "") != expected_id
        or not isinstance(metadata, dict)
        or str(metadata.get("idempotency_hash") or "") != request_hash
    ):
        raise RuntimeError(
            "historical L22 idempotency rows require migration before retention pruning"
        )
    return expected_id, request_hash


def _assert_idempotency_rows_replay_safe(
    connection: sqlite3.Connection,
    rows: List[sqlite3.Row],
    *,
    tenant: str,
    workspace: str,
) -> None:
    """Prove the exact durable fallback before any ledger row is evicted.

    The ledger's own JSON is not evidence that Chroma still has the record.
    Require the deterministic ID, matching request hash and scope in Chroma,
    plus a committed quota row whose payload hash can admit the replay.  A
    legacy quota hash is migrated only after the Chroma proof succeeds.
    """

    identities = {
        str(row["idempotency_key"]): _idempotency_row_replay_identity(
            row,
            tenant=tenant,
            workspace=workspace,
        )
        for row in rows
    }
    for offset in range(0, len(rows), 256):
        chunk = rows[offset : offset + 256]
        ids = [identities[str(row["idempotency_key"])][0] for row in chunk]
        try:
            durable = collection.get(ids=ids, include=["metadatas"])
        except Exception as exc:
            raise RuntimeError(
                "L22 idempotency retention could not verify the durable replay fallback"
            ) from exc
        durable_ids = [str(value) for value in (durable.get("ids") or [])]
        durable_metadata = list(durable.get("metadatas") or [])
        metadata_by_id = {
            memory_id: (
                dict(durable_metadata[index] or {})
                if index < len(durable_metadata)
                else {}
            )
            for index, memory_id in enumerate(durable_ids)
        }
        placeholders = ",".join("?" for _value in ids)
        quota_rows = {
            str(quota["memory_id"]): quota
            for quota in connection.execute(
                "SELECT memory_id, tenant_id, workspace_id, payload_hash, status "
                f"FROM l22_quota_records WHERE memory_id IN ({placeholders})",
                ids,
            ).fetchall()
        }
        for row in chunk:
            key = str(row["idempotency_key"])
            memory_id, request_hash = identities[key]
            metadata = metadata_by_id.get(memory_id)
            quota = quota_rows.get(memory_id)
            stored_tenant = str((metadata or {}).get("tenant_id") or "")
            stored_workspace = str(
                (metadata or {}).get("storage_workspace_id")
                or (metadata or {}).get("workspace_id")
                or ""
            )
            default_scope = tenant == DEFAULT_TENANT_ID and workspace == DEFAULT_WORKSPACE_ID
            scope_matches = (
                (stored_tenant == tenant and stored_workspace == workspace)
                or (default_scope and not stored_tenant and not stored_workspace)
            )
            if (
                metadata is None
                or str(metadata.get("idempotency_hash") or "") != request_hash
                or not scope_matches
                or quota is None
                or str(quota["tenant_id"]) != tenant
                or str(quota["workspace_id"]) != workspace
                or str(quota["status"]) != "committed"
            ):
                raise RuntimeError(
                    "L22 idempotency rows require a verified durable replay fallback before retention pruning"
                )
            quota_hash = str(quota["payload_hash"] or "")
            if quota_hash != request_hash:
                if not quota_hash.startswith("legacy:"):
                    raise RuntimeError(
                        "L22 idempotency quota identity conflicts with the durable replay fallback"
                    )
                connection.execute(
                    "UPDATE l22_quota_records SET payload_hash = ? "
                    "WHERE memory_id = ? AND payload_hash = ? AND status = 'committed'",
                    (request_hash, memory_id, quota_hash),
                )


def _prune_memory_idempotency_scope(
    connection: sqlite3.Connection,
    *,
    tenant: str,
    workspace: str,
    protected_key: str = "",
    now: Optional[datetime] = None,
) -> int:
    """Apply the finite replay-ledger policy inside the caller's transaction.

    Semantic writes use a deterministic scoped UUID and persist their request
    hash in Chroma metadata. Consequently, an evicted ledger row still has an
    exact durable replay/conflict fallback and can be removed without weakening
    the idempotency boundary.
    """

    limits = _l22_idempotency_limits()
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(
        seconds=limits["ttl_seconds"]
    )
    params: List[object] = [tenant, workspace, cutoff.isoformat()]
    protected_clause = ""
    if protected_key:
        protected_clause = " AND idempotency_key != ?"
        params.append(protected_key)
    expired_rows = connection.execute(
        "SELECT idempotency_key, request_hash, record_json, created_at "
        "FROM memory_idempotency "
        "WHERE tenant_id = ? AND workspace_id = ? "
        "AND julianday(created_at) < julianday(?)" + protected_clause,
        params,
    ).fetchall()
    _assert_idempotency_rows_replay_safe(
        connection,
        expired_rows,
        tenant=tenant,
        workspace=workspace,
    )
    if expired_rows:
        connection.executemany(
            "DELETE FROM memory_idempotency "
            "WHERE tenant_id = ? AND workspace_id = ? AND idempotency_key = ?",
            [
                (tenant, workspace, str(row["idempotency_key"]))
                for row in expired_rows
            ],
        )
    deleted = len(expired_rows)

    rows = connection.execute(
        "SELECT idempotency_key, request_hash, record_json, created_at "
        "FROM memory_idempotency WHERE tenant_id = ? AND workspace_id = ? "
        "ORDER BY CASE WHEN idempotency_key = ? THEN 1 ELSE 0 END DESC, "
        "created_at DESC, idempotency_key DESC",
        (tenant, workspace, protected_key),
    ).fetchall()
    if protected_key:
        protected_row = next(
            (
                row
                for row in rows
                if str(row["idempotency_key"]) == protected_key
            ),
            None,
        )
        if (
            protected_row is not None
            and _idempotency_row_bytes(protected_row) > limits["max_bytes"]
        ):
            raise RuntimeError(
                "configured L22 idempotency byte limit cannot retain the active replay row"
            )
    kept_records = 0
    kept_bytes = 0
    evicted: List[str] = []
    for row in rows:
        row_bytes = _idempotency_row_bytes(row)
        if (
            kept_records >= limits["max_records"]
            or kept_bytes + row_bytes > limits["max_bytes"]
        ):
            evicted.append(str(row["idempotency_key"]))
            continue
        kept_records += 1
        kept_bytes += row_bytes
    if evicted:
        rows_by_key = {str(row["idempotency_key"]): row for row in rows}
        _assert_idempotency_rows_replay_safe(
            connection,
            [rows_by_key[key] for key in evicted],
            tenant=tenant,
            workspace=workspace,
        )
        connection.executemany(
            "DELETE FROM memory_idempotency "
            "WHERE tenant_id = ? AND workspace_id = ? AND idempotency_key = ?",
            [(tenant, workspace, key) for key in evicted],
        )
        deleted += len(evicted)
    return deleted


def _prune_memory_idempotency_ledger() -> int:
    """Converge every legacy scope to the finite policy during startup."""

    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            scopes = connection.execute(
                "SELECT DISTINCT tenant_id, workspace_id FROM memory_idempotency"
            ).fetchall()
            deleted = sum(
                _prune_memory_idempotency_scope(
                    connection,
                    tenant=str(row["tenant_id"]),
                    workspace=str(row["workspace_id"]),
                )
                for row in scopes
            )
            connection.commit()
            return deleted
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def _l22_quota_limits() -> dict[str, int]:
    return {
        key: _bounded_quota_setting(f"CORTEX_L22_{key.upper()}", default)
        for key, default in _L22_QUOTA_LIMIT_DEFAULTS.items()
    }


def _memory_charge_bytes(content: str, metadata: dict, *, idempotency_key: str = "") -> int:
    content_bytes = len(str(content or "").encode("utf-8"))
    if content_bytes > _bounded_quota_setting(
        "CORTEX_L22_MAX_CONTENT_BYTES", _L22_MAX_CONTENT_BYTES
    ):
        raise HTTPException(status_code=413, detail="memory content exceeds byte limit")
    try:
        metadata_bytes = len(
            json.dumps(
                metadata,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8")
        )
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="memory metadata must be finite JSON") from exc
    return (
        content_bytes
        + metadata_bytes
        + len(str(idempotency_key or "").encode("utf-8"))
        + _L22_QUOTA_FIXED_RECORD_BYTES
    )


def _quota_scopes(tenant: str, workspace: str, credential: str) -> tuple[tuple[str, str], ...]:
    return (
        ("workspace", f"{tenant}\x1f{workspace}"),
        ("credential", f"{tenant}\x1f{credential}"),
        ("tenant", tenant),
        ("global", "*"),
    )


def _quota_credential(metadata: dict) -> str:
    return str(metadata.get("scope_credential_id") or "uncredentialed")[:128]


def _l22_volume_usage() -> int:
    root = _structured_memory_db_path().parent
    total = 0
    if not root.exists():
        return 0
    for candidate in root.rglob("*"):
        try:
            if (
                candidate.name != _L22_PHYSICAL_RESERVE_FILE
                and candidate.is_file()
                and not candidate.is_symlink()
            ):
                total += candidate.stat().st_size
        except FileNotFoundError:
            continue
    return total


def _l22_reserve_enabled() -> bool:
    return os.getenv("CORTEX_L22_PREALLOCATE_RECOVERY_RESERVE", "false").strip().lower() in {
        "1", "true", "yes", "on",
    }


def _l22_recovery_reserve_bytes() -> int:
    return _bounded_quota_setting(
        "CORTEX_L22_RECOVERY_RESERVE_BYTES",
        _L22_RECOVERY_RESERVE_BYTES,
    )


def _ensure_l22_physical_reserve(root: Path) -> None:
    if not _l22_reserve_enabled():
        return
    target = Path(root).resolve() / _L22_PHYSICAL_RESERVE_FILE
    requested = _l22_recovery_reserve_bytes()
    lock_path = target.with_name(f"{target.name}.lock")
    with lock_path.open("a+b") as lock_handle:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
        try:
            try:
                stat = target.stat()
                if (
                    target.is_file()
                    and not target.is_symlink()
                    and int(stat.st_size) == requested
                    and int(stat.st_blocks) * 512 >= requested
                ):
                    return
            except FileNotFoundError:
                pass
            temporary = target.with_name(
                f".{target.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
            )
            try:
                fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
                try:
                    if not hasattr(os, "posix_fallocate"):
                        raise OSError("posix_fallocate is required for the L22 recovery reserve")
                    os.posix_fallocate(fd, 0, requested)
                    os.fsync(fd)
                finally:
                    os.close(fd)
                os.replace(temporary, target)
                directory_fd = os.open(target.parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            except OSError as exc:
                raise RuntimeError("L22 physical recovery reserve could not be allocated") from exc
            finally:
                try:
                    temporary.unlink()
                except FileNotFoundError:
                    pass
        finally:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)


def _l22_filesystem_available() -> int:
    root = _structured_memory_db_path().parent.resolve()
    probe = root if root.exists() else root.parent
    stat = os.statvfs(probe)
    return int(stat.f_bavail) * int(stat.f_frsize)


def _quota_adjust_usage(
    connection: sqlite3.Connection,
    scopes: tuple[tuple[str, str], ...],
    *,
    records: int,
    bytes_delta: int,
) -> None:
    for scope_type, scope_id in scopes:
        connection.execute(
            "INSERT INTO l22_quota_usage(scope_type, scope_id, record_count, byte_count) "
            "VALUES (?, ?, ?, ?) ON CONFLICT(scope_type, scope_id) DO UPDATE SET "
            "record_count = record_count + excluded.record_count, "
            "byte_count = byte_count + excluded.byte_count",
            (scope_type, scope_id, records, bytes_delta),
        )
        row = connection.execute(
            "SELECT record_count, byte_count FROM l22_quota_usage WHERE scope_type = ? AND scope_id = ?",
            (scope_type, scope_id),
        ).fetchone()
        if row is None or int(row["record_count"]) < 0 or int(row["byte_count"]) < 0:
            raise RuntimeError("L22 quota ledger usage became inconsistent")


def _quota_release_row(connection: sqlite3.Connection, row: sqlite3.Row) -> None:
    scopes = _quota_scopes(
        str(row["tenant_id"]),
        str(row["workspace_id"]),
        str(row["credential_id"]),
    )
    _quota_adjust_usage(
        connection,
        scopes,
        records=-1,
        bytes_delta=-int(row["charge_bytes"]),
    )
    connection.execute("DELETE FROM l22_quota_records WHERE memory_id = ?", (row["memory_id"],))


def _backfill_quota_row(
    connection: sqlite3.Connection,
    *,
    memory_id: str,
    tenant: str,
    workspace: str,
    metadata: dict,
    content: str,
) -> None:
    if connection.execute(
        "SELECT 1 FROM l22_quota_records WHERE memory_id = ?", (memory_id,)
    ).fetchone() is not None:
        return
    try:
        metadata_bytes = json.dumps(
            metadata,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"legacy L22 metadata is not finite JSON: {memory_id}") from exc
    charge_bytes = (
        len(str(content or "").encode("utf-8"))
        + len(metadata_bytes)
        + _L22_QUOTA_FIXED_RECORD_BYTES
    )
    credential = _quota_credential(metadata)
    connection.execute(
        "INSERT INTO l22_quota_records(memory_id, tenant_id, workspace_id, credential_id, "
        "charge_bytes, payload_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'committed', ?)",
        (
            memory_id,
            tenant,
            workspace,
            credential,
            charge_bytes,
            "legacy:" + sha256(
                memory_id.encode("utf-8") + b"\0" + str(content or "").encode("utf-8")
            ).hexdigest(),
            time.time(),
        ),
    )
    _quota_adjust_usage(
        connection,
        _quota_scopes(tenant, workspace, credential),
        records=1,
        bytes_delta=charge_bytes,
    )


def _backfill_l22_quota_ledger() -> None:
    """Account every pre-quota durable row before production accepts writes."""

    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            complete = connection.execute(
                "SELECT value FROM l22_quota_state WHERE key = 'legacy_backfill'"
            ).fetchone()
            if (
                complete is not None
                and str(complete["value"]) == _L22_QUOTA_BACKFILL_VERSION
            ):
                connection.commit()
                return

            cursor = connection.execute(
                "SELECT id, tenant_id, workspace_id, content, metadata_json "
                "FROM structured_memory ORDER BY id"
            )
            while True:
                batch = cursor.fetchmany(256)
                if not batch:
                    break
                for row in batch:
                    _backfill_quota_row(
                        connection,
                        memory_id=str(row["id"]),
                        tenant=str(row["tenant_id"]),
                        workspace=str(row["workspace_id"]),
                        metadata=json.loads(str(row["metadata_json"])),
                        content=str(row["content"]),
                    )

            offset = 0
            while True:
                page = collection.get(
                    limit=256,
                    offset=offset,
                    include=["metadatas", "documents"],
                )
                ids = [str(value) for value in (page.get("ids") or [])]
                metadatas = list(page.get("metadatas") or [])
                documents = list(page.get("documents") or [])
                for index, memory_id in enumerate(ids):
                    metadata = dict(metadatas[index] or {}) if index < len(metadatas) else {}
                    tenant = str(metadata.get("tenant_id") or DEFAULT_TENANT_ID)
                    workspace = str(
                        metadata.get("storage_workspace_id")
                        or metadata.get("workspace_id")
                        or DEFAULT_WORKSPACE_ID
                    )
                    _backfill_quota_row(
                        connection,
                        memory_id=memory_id,
                        tenant=tenant,
                        workspace=workspace,
                        metadata=metadata,
                        content=str(documents[index] or "") if index < len(documents) else "",
                    )
                if len(ids) < 256:
                    break
                offset += len(ids)

            for row in _quota_fallback_rows():
                if str(row.get("kind") or "memory") != "memory":
                    continue
                memory_id = str(row.get("id") or "").strip()
                if not memory_id:
                    raise RuntimeError("legacy fallback memory has no durable identity")
                metadata = dict(row.get("metadata") or {})
                tenant = str(metadata.get("tenant_id") or DEFAULT_TENANT_ID)
                workspace = str(
                    metadata.get("storage_workspace_id")
                    or metadata.get("workspace_id")
                    or DEFAULT_WORKSPACE_ID
                )
                _backfill_quota_row(
                    connection,
                    memory_id=memory_id,
                    tenant=tenant,
                    workspace=workspace,
                    metadata=metadata,
                    content=str(row.get("text") or ""),
                )

            connection.execute(
                "INSERT INTO l22_quota_state(key, value) VALUES ('legacy_backfill', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (_L22_QUOTA_BACKFILL_VERSION,),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def _assert_l22_quota_backfill_ready(connection: sqlite3.Connection) -> None:
    if not _production_memory_mode():
        return
    row = connection.execute(
        "SELECT value FROM l22_quota_state WHERE key = 'legacy_backfill'"
    ).fetchone()
    if row is None or str(row["value"]) != _L22_QUOTA_BACKFILL_VERSION:
        raise HTTPException(status_code=503, detail="L22 legacy quota reconciliation is incomplete")


def _process_start_ticks(pid: int) -> str:
    raw = Path(f"/proc/{int(pid)}/stat").read_text(encoding="utf-8")
    fields = raw.rsplit(")", 1)[1].strip().split()
    if len(fields) <= 19:
        raise RuntimeError("process identity stat is incomplete")
    return str(fields[19])


def _boot_id() -> str:
    return Path("/proc/sys/kernel/random/boot_id").read_text(encoding="utf-8").strip()


def _quota_writer_identity() -> dict[str, object]:
    """Return an immutable per-process identity that survives PID reuse checks."""

    pid = os.getpid()
    with _QUOTA_WRITER_IDENTITY_LOCK:
        if int(_QUOTA_WRITER_IDENTITY.get("pid", 0) or 0) != pid:
            _QUOTA_WRITER_IDENTITY.clear()
            _QUOTA_WRITER_IDENTITY.update(
                {
                    "token": uuid.uuid4().hex,
                    "pid": pid,
                    "start_ticks": _process_start_ticks(pid),
                    "boot_id": _boot_id(),
                }
            )
        return dict(_QUOTA_WRITER_IDENTITY)


def _quota_owner_proven_dead(row: sqlite3.Row) -> bool:
    """Return true only when kernel process identity proves the owner is gone."""

    owner_boot_id = str(row["writer_boot_id"] or "")
    owner_start_ticks = str(row["writer_start_ticks"] or "")
    owner_pid = int(row["writer_pid"] or 0)
    if not owner_boot_id or not owner_start_ticks or owner_pid <= 0:
        # Legacy or foreign reservations without a complete identity are kept;
        # quota leakage is safer than admitting an unaccounted durable write.
        return False
    try:
        current_boot_id = _boot_id()
    except OSError:
        return False
    if owner_boot_id != current_boot_id:
        return True
    try:
        observed_start_ticks = _process_start_ticks(owner_pid)
    except FileNotFoundError:
        return True
    except (OSError, RuntimeError):
        return False
    return observed_start_ticks != owner_start_ticks


def _reconcile_stale_quota_reservations(connection: sqlite3.Connection) -> None:
    now = time.time()
    rows = connection.execute(
        "SELECT * FROM l22_quota_records WHERE status = 'reserved' "
        "AND lease_expires_at <= ? ORDER BY lease_expires_at LIMIT 256",
        (now,),
    ).fetchall()
    if not rows:
        return
    ids = [str(row["memory_id"]) for row in rows]
    placeholders = ",".join("?" for _ in ids)
    structured_ids = {
        str(row[0])
        for row in connection.execute(
            f"SELECT id FROM structured_memory WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
    }
    try:
        fallback_ids = {
            str(row.get("id") or "")
            for row in _quota_fallback_rows()
            if str(row.get("kind") or "memory") == "memory"
        }
        fallback_authoritative = True
    except Exception:
        fallback_ids = set()
        fallback_authoritative = False
    try:
        existing = collection.get(ids=ids, include=["metadatas"])
        existing_ids = set(existing.get("ids") or [])
    except Exception:
        existing_ids = set()
        chroma_authoritative = False
    else:
        chroma_authoritative = True
    for row in rows:
        memory_id = str(row["memory_id"])
        if (
            memory_id in existing_ids
            or memory_id in structured_ids
            or memory_id in fallback_ids
        ):
            connection.execute(
                "UPDATE l22_quota_records SET status = 'committed' WHERE memory_id = ?",
                (row["memory_id"],),
            )
        elif (
            chroma_authoritative
            and fallback_authoritative
            and _quota_owner_proven_dead(row)
        ):
            _quota_release_row(connection, row)


def _reconcile_l22_quota_reservations() -> None:
    """Reconcile one bounded reservation page during every process restart."""

    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            _reconcile_stale_quota_reservations(connection)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def _reserve_memory_quota(
    *,
    memory_id: str,
    tenant: str,
    workspace: str,
    credential: str,
    charge_bytes: int,
    payload_hash: str,
) -> str:
    limits = _l22_quota_limits()
    writer = _quota_writer_identity()
    now = time.time()
    lease_expires_at = now + _L22_QUOTA_RESERVATION_TIMEOUT_SECONDS
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            _assert_l22_quota_backfill_ready(connection)
            _reconcile_stale_quota_reservations(connection)
            existing = connection.execute(
                "SELECT * FROM l22_quota_records WHERE memory_id = ?", (memory_id,)
            ).fetchone()
            if existing is not None:
                if not hmac_compare(str(existing["payload_hash"]), payload_hash):
                    raise HTTPException(status_code=409, detail="memory identity conflicts with quota reservation")
                if (
                    str(existing["status"]) == "reserved"
                    and str(existing["owner_token"] or "") == str(writer["token"])
                ):
                    updated = connection.execute(
                        "UPDATE l22_quota_records SET lease_expires_at = ? "
                        "WHERE memory_id = ? AND status = 'reserved' AND owner_token = ?",
                        (lease_expires_at, memory_id, writer["token"]),
                    )
                    if updated.rowcount != 1:
                        raise HTTPException(status_code=409, detail="memory quota lease was fenced")
                    connection.commit()
                    return "new"
                connection.commit()
                return str(existing["status"])
            scopes = _quota_scopes(tenant, workspace, credential)
            for scope_type, scope_id in scopes:
                usage = connection.execute(
                    "SELECT record_count, byte_count FROM l22_quota_usage WHERE scope_type = ? AND scope_id = ?",
                    (scope_type, scope_id),
                ).fetchone()
                records = int(usage["record_count"]) if usage else 0
                used_bytes = int(usage["byte_count"]) if usage else 0
                if records + 1 > limits[f"{scope_type}_records"]:
                    raise HTTPException(status_code=507, detail=f"L22 {scope_type} record quota exceeded")
                if used_bytes + charge_bytes > limits[f"{scope_type}_bytes"]:
                    raise HTTPException(status_code=507, detail=f"L22 {scope_type} byte quota exceeded")
            reserved_bytes = int(connection.execute(
                "SELECT COALESCE(SUM(charge_bytes), 0) FROM l22_quota_records WHERE status = 'reserved'"
            ).fetchone()[0])
            if _l22_volume_usage() + reserved_bytes + charge_bytes > limits["global_bytes"]:
                raise HTTPException(status_code=507, detail="L22 durable volume byte quota exceeded")
            required_headroom = charge_bytes + (
                0 if _l22_reserve_enabled() else _l22_recovery_reserve_bytes()
            )
            if _l22_filesystem_available() < required_headroom:
                raise HTTPException(
                    status_code=507,
                    detail="L22 filesystem recovery reserve would be consumed",
                )
            connection.execute(
                "INSERT INTO l22_quota_records(memory_id, tenant_id, workspace_id, credential_id, "
                "charge_bytes, payload_hash, status, created_at, owner_token, writer_pid, "
                "writer_start_ticks, writer_boot_id, lease_expires_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?)",
                (
                    memory_id,
                    tenant,
                    workspace,
                    credential,
                    charge_bytes,
                    payload_hash,
                    now,
                    writer["token"],
                    writer["pid"],
                    writer["start_ticks"],
                    writer["boot_id"],
                    lease_expires_at,
                ),
            )
            _quota_adjust_usage(connection, scopes, records=1, bytes_delta=charge_bytes)
            connection.commit()
            return "new"
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def hmac_compare(left: str, right: str) -> bool:
    # sha256 hex values have fixed public length; compare without data-dependent
    # early exit because they also bind deterministic memory identities.
    import hmac
    return hmac.compare_digest(left, right)


def _fence_memory_quota(memory_id: str, payload_hash: str) -> None:
    """Renew and compare-and-swap the owned lease immediately before publication."""

    writer = _quota_writer_identity()
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            updated = connection.execute(
                "UPDATE l22_quota_records SET lease_expires_at = ? "
                "WHERE memory_id = ? AND payload_hash = ? AND status = 'reserved' AND owner_token = ?",
                (
                    time.time() + _L22_QUOTA_RESERVATION_TIMEOUT_SECONDS,
                    memory_id,
                    payload_hash,
                    writer["token"],
                ),
            )
            if updated.rowcount != 1:
                raise HTTPException(status_code=409, detail="memory quota publication lease was fenced")
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def _finalize_memory_quota(memory_id: str, *, require_owner: bool = True) -> None:
    writer = _quota_writer_identity()
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            updated = connection.execute(
                "UPDATE l22_quota_records SET status = 'committed' "
                "WHERE memory_id = ? AND status = 'reserved'"
                + (" AND owner_token = ?" if require_owner else ""),
                (memory_id, writer["token"]) if require_owner else (memory_id,),
            )
            if updated.rowcount != 1:
                existing = connection.execute(
                    "SELECT status FROM l22_quota_records WHERE memory_id = ?", (memory_id,)
                ).fetchone()
                if existing is None:
                    raise HTTPException(status_code=503, detail="memory quota reservation is missing")
                if str(existing["status"]) != "committed":
                    raise HTTPException(status_code=409, detail="memory quota finalization lease was fenced")
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def _release_memory_quota(memory_id: str, *, committed: bool = False) -> None:
    writer = _quota_writer_identity()
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM l22_quota_records WHERE memory_id = ?", (memory_id,)
            ).fetchone()
            if row is not None and (
                committed
                or (
                    str(row["status"]) == "reserved"
                    and str(row["owner_token"] or "") == str(writer["token"])
                )
            ):
                _quota_release_row(connection, row)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def _settle_failed_memory_write(memory_id: str) -> None:
    """Never release an admission when durable publication is uncertain."""

    try:
        connection = _structured_memory_connection()
        try:
            structured_exists = connection.execute(
                "SELECT 1 FROM structured_memory WHERE id = ?", (memory_id,)
            ).fetchone() is not None
        finally:
            connection.close()
    except Exception:
        return
    if structured_exists:
        try:
            _finalize_memory_quota(memory_id, require_owner=False)
        except Exception:
            pass
        return
    try:
        fallback_exists = memory_id in {
            str(row.get("id") or "")
            for row in _quota_fallback_rows()
            if str(row.get("kind") or "memory") == "memory"
        }
    except Exception:
        # An unreadable publication target is uncertain, so keep its admission.
        return
    if fallback_exists:
        try:
            _finalize_memory_quota(memory_id, require_owner=False)
        except Exception:
            pass
        return
    try:
        existing = collection.get(ids=[memory_id], include=["metadatas"])
    except Exception:
        # A retained reservation is safe and restart reconciliation will settle
        # it once Chroma can answer authoritatively.
        return
    if memory_id in set(existing.get("ids") or []):
        try:
            _finalize_memory_quota(memory_id, require_owner=False)
        except Exception:
            pass
    else:
        try:
            _release_memory_quota(memory_id)
        except Exception:
            pass


def run_l22_quota_controlled_write(
    *,
    memory_id: str,
    content: str,
    metadata: dict,
    tenant_id: str,
    workspace_id: str,
    publish: Callable[[dict], _QuotaWriteResult],
    idempotency_key: str = "",
    payload_hash: Optional[str] = None,
) -> _QuotaWriteResult:
    """Reserve, fence, publish, and settle one durable memory identity."""

    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    try:
        scoped_metadata = _normalize_memory_metadata(
            metadata,
            tenant_id=tenant,
            workspace_id=workspace,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    canonical_hash = payload_hash or sha256(
        json.dumps(
            {"content": content, "metadata": scoped_metadata},
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    ).hexdigest()
    reservation_status = _reserve_memory_quota(
        memory_id=memory_id,
        tenant=tenant,
        workspace=workspace,
        credential=_quota_credential(scoped_metadata),
        charge_bytes=_memory_charge_bytes(
            content,
            scoped_metadata,
            idempotency_key=idempotency_key,
        ),
        payload_hash=canonical_hash,
    )
    if reservation_status != "new":
        raise HTTPException(status_code=409, detail="memory quota reservation is not publishable")
    try:
        _fence_memory_quota(memory_id, canonical_hash)
        result = publish(scoped_metadata)
        _finalize_memory_quota(memory_id)
        return result
    except Exception:
        _settle_failed_memory_write(memory_id)
        raise


def run_l22_quota_controlled_side_effect(
    *,
    transaction_id: str,
    charge_bytes: int,
    payload_hash: str,
    tenant_id: str,
    workspace_id: str,
    credential_id: str,
    publish: Callable[[], _QuotaWriteResult],
) -> _QuotaWriteResult:
    """Reserve complete amplified bytes and retain a durable publication intent."""

    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    normalized_transaction = str(transaction_id or "").strip()
    normalized_hash = str(payload_hash or "").strip()
    requested_bytes = int(charge_bytes)
    if (
        not normalized_transaction
        or len(normalized_transaction) > 256
        or requested_bytes <= 0
        or not _is_sha256_hex(normalized_hash)
    ):
        raise ValueError("invalid L22 quota-controlled side effect")
    memory_id = str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"cortex:l22:side-effect:{tenant}:{workspace}:{normalized_transaction}",
        )
    )
    reservation_status = _reserve_memory_quota(
        memory_id=memory_id,
        tenant=tenant,
        workspace=workspace,
        credential=str(credential_id or "uncredentialed")[:128],
        charge_bytes=requested_bytes,
        payload_hash=normalized_hash,
    )
    if reservation_status != "new":
        raise HTTPException(
            status_code=409,
            detail="L22 side-effect quota reservation is not publishable",
        )
    marker_published = False
    publication_started = False
    try:
        _fence_memory_quota(memory_id, normalized_hash)
        with _STRUCTURED_MEMORY_LOCK:
            connection = _structured_memory_connection()
            try:
                connection.execute(
                    "INSERT INTO structured_memory(id, tenant_id, workspace_id, memory_type, lookup_key, content, metadata_json, created_at) "
                    "VALUES (?, ?, ?, 'quota_side_effect', ?, ?, ?, ?)",
                    (
                        memory_id,
                        tenant,
                        workspace,
                        normalized_transaction,
                        normalized_hash,
                        json.dumps(
                            {
                                "type": "quota_side_effect",
                                "transaction_id": normalized_transaction,
                                "payload_hash": normalized_hash,
                                "charge_bytes": requested_bytes,
                            },
                            ensure_ascii=True,
                            sort_keys=True,
                        ),
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
                connection.commit()
                marker_published = True
            finally:
                connection.close()
        publication_started = True
        result = publish()
        _finalize_memory_quota(memory_id)
        return result
    except Exception:
        if marker_published and publication_started:
            # Publication may be partial. Retain both its durable intent and
            # complete capacity charge rather than falsely freeing bytes.
            try:
                _finalize_memory_quota(memory_id, require_owner=False)
            except Exception:
                pass
        else:
            if marker_published:
                with _STRUCTURED_MEMORY_LOCK:
                    connection = _structured_memory_connection()
                    try:
                        connection.execute(
                            "DELETE FROM structured_memory WHERE id = ? AND memory_type = 'quota_side_effect'",
                            (memory_id,),
                        )
                        connection.commit()
                    finally:
                        connection.close()
            _settle_failed_memory_write(memory_id)
        raise


def _is_sha256_hex(value: str) -> bool:
    return len(value) == 64 and all(character in "0123456789abcdef" for character in value)


def store_structured_memory_record(
    *,
    content: str,
    memory_type: Optional[str] = "memory",
    tags: Optional[List[str]] = None,
    metadata: Optional[dict] = None,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> dict:
    """Persist exact-lookup L22 state without invoking the semantic embedding path.

    Structured snapshots such as Codec session state are retrieved by metadata key,
    not similarity. Keeping them in this indexed L22 ledger avoids expensive Chroma
    scans/embeddings while preserving process-restart durability.
    """
    if not (content or "").strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    memory_id = str(uuid.uuid4())
    record_metadata = _normalize_memory_metadata(
        metadata, tenant_id=tenant, workspace_id=workspace
    )
    resolved_type = str(memory_type or record_metadata.get("type") or "memory")
    record_metadata.setdefault("type", resolved_type)
    if tags:
        record_metadata.setdefault("tags", list(tags))
    record_metadata.setdefault("persistence_backend", "l22_structured_sqlite_v1")
    lookup_key = str(record_metadata.get("codec_session_key") or record_metadata.get("lookup_key") or "")
    created_at = str(record_metadata.get("codec_generated_at") or record_metadata.get("generated_at") or datetime.now(timezone.utc).isoformat())
    payload_hash = sha256(json.dumps(
        {"content": content, "memory_type": resolved_type, "metadata": record_metadata},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")).hexdigest()
    _reserve_memory_quota(
        memory_id=memory_id,
        tenant=tenant,
        workspace=workspace,
        credential=_quota_credential(record_metadata),
        charge_bytes=_memory_charge_bytes(content, record_metadata),
        payload_hash=payload_hash,
    )
    try:
        _fence_memory_quota(memory_id, payload_hash)
        with _STRUCTURED_MEMORY_LOCK:
            connection = _structured_memory_connection()
            try:
                connection.execute(
                    "INSERT INTO structured_memory(id, tenant_id, workspace_id, memory_type, lookup_key, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (memory_id, tenant, workspace, resolved_type, lookup_key, content, json.dumps(record_metadata, ensure_ascii=False, sort_keys=True), created_at),
                )
                connection.commit()
            finally:
                connection.close()
        _finalize_memory_quota(memory_id)
    except Exception:
        _settle_failed_memory_write(memory_id)
        raise
    return {"id": memory_id, "status": "stored", "metadata": record_metadata, "backend": "l22_structured_sqlite_v1"}


def list_structured_memory_records(
    *,
    memory_type: Optional[str] = None,
    lookup_key: Optional[str] = None,
    limit: int = 25,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> List[dict]:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    clauses = ["tenant_id = ?", "workspace_id = ?"]
    params: List[object] = [tenant, workspace]
    if memory_type:
        clauses.append("memory_type = ?")
        params.append(str(memory_type))
    if lookup_key is not None:
        clauses.append("lookup_key = ?")
        params.append(str(lookup_key))
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    query = f"SELECT id, tenant_id, workspace_id, memory_type, lookup_key, content, metadata_json, created_at FROM structured_memory{where} ORDER BY created_at DESC LIMIT ?"
    params.append(max(1, min(int(limit), 1000)))

    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            rows = connection.execute(query, params).fetchall()
        finally:
            connection.close()
    records = []
    for row in rows:
        try:
            metadata = json.loads(row["metadata_json"] or "{}")
        except Exception:
            metadata = {}
        records.append({
            "id": row["id"],
            "tenant_id": row["tenant_id"],
            "workspace_id": row["workspace_id"],
            "type": row["memory_type"],
            "lookup_key": row["lookup_key"],
            "content": row["content"],
            "metadata": metadata,
            "created_at": row["created_at"],
        })
    return records


def delete_structured_memory_records(
    ids: List[str],
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> int:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    normalized = [str(value) for value in ids if str(value or "").strip()]
    if not normalized:
        return 0
    placeholders = ",".join("?" for _ in normalized)
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            existing_ids = {
                str(row[0])
                for row in connection.execute(
                    f"SELECT id FROM structured_memory WHERE tenant_id = ? AND workspace_id = ? AND id IN ({placeholders})",
                    [tenant, workspace, *normalized],
                ).fetchall()
            }
            cursor = connection.execute(
                f"DELETE FROM structured_memory WHERE tenant_id = ? AND workspace_id = ? AND id IN ({placeholders})",
                [tenant, workspace, *normalized],
            )
            for memory_id in existing_ids:
                quota_row = connection.execute(
                    "SELECT * FROM l22_quota_records WHERE memory_id = ?",
                    (memory_id,),
                ).fetchone()
                if quota_row is not None:
                    _quota_release_row(connection, quota_row)
            connection.commit()
            deleted = int(cursor.rowcount or 0)
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
    return deleted


def count_structured_memory_records(
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> int:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            return int(connection.execute(
                "SELECT COUNT(*) FROM structured_memory WHERE tenant_id = ? AND workspace_id = ?",
                (tenant, workspace),
            ).fetchone()[0])
        finally:
            connection.close()


def store_memory_record(
    *,
    content: str,
    memory_type: Optional[str] = "memory",
    tags: Optional[List[str]] = None,
    metadata: Optional[dict] = None,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> dict:
    if not (content or "").strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    content_bytes = len(content.encode("utf-8"))
    if content_bytes > _bounded_quota_setting(
        "CORTEX_L22_MAX_CONTENT_BYTES", _L22_MAX_CONTENT_BYTES
    ):
        raise HTTPException(status_code=413, detail="memory content exceeds byte limit")

    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    normalized_idempotency_key = str(idempotency_key or "").strip()
    if idempotency_key is not None and not normalized_idempotency_key:
        raise HTTPException(status_code=422, detail="idempotency_key cannot be blank")
    if len(normalized_idempotency_key.encode("utf-8")) > 256:
        raise HTTPException(status_code=422, detail="idempotency_key exceeds byte limit")

    resolved_memory_type = str(memory_type or "memory")
    normalized_tags = list(tags or [])
    raw_metadata = dict(metadata or {})
    try:
        if len(resolved_memory_type.encode("utf-8")) > 128:
            raise ValueError("memory_type exceeds byte limit")
        _validate_memory_metadata({"tags": normalized_tags})
        _validate_memory_metadata(raw_metadata)
        record_metadata = _normalize_memory_metadata(
            raw_metadata, tenant_id=tenant, workspace_id=workspace
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    record_metadata.setdefault("type", resolved_memory_type)
    if tags:
        record_metadata.setdefault("tags", normalized_tags)
    try:
        _validate_memory_metadata(record_metadata)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    request_hash = sha256(json.dumps(
        {
            "content": content,
            "memory_type": resolved_memory_type,
            "tags": normalized_tags,
            "metadata": raw_metadata,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")).hexdigest()
    if normalized_idempotency_key:
        record_metadata["idempotency_key"] = normalized_idempotency_key
        record_metadata["idempotency_hash"] = request_hash
        try:
            _validate_memory_metadata(record_metadata)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    charge_bytes = _memory_charge_bytes(
        content,
        record_metadata,
        idempotency_key=normalized_idempotency_key,
    )
    credential = _quota_credential(record_metadata)
    if normalized_idempotency_key:
        memory_id = str(uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"cortex:l22:{tenant}:{workspace}:{normalized_idempotency_key}",
        ))
        with _STRUCTURED_MEMORY_LOCK:
            connection = _structured_memory_connection()
            try:
                connection.execute("BEGIN IMMEDIATE")
                _prune_memory_idempotency_scope(
                    connection,
                    tenant=tenant,
                    workspace=workspace,
                )
                prior = connection.execute(
                    "SELECT request_hash, record_json FROM memory_idempotency "
                    "WHERE tenant_id = ? AND workspace_id = ? AND idempotency_key = ?",
                    (tenant, workspace, normalized_idempotency_key),
                ).fetchone()
                if prior is not None:
                    if str(prior["request_hash"]) != request_hash:
                        raise HTTPException(
                            status_code=409,
                            detail="idempotency_key was already used for a different memory write",
                        )
                    replay = json.loads(prior["record_json"])
                    replay["idempotent_replay"] = True
                    connection.commit()
                    return replay
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()

        reservation_status = _reserve_memory_quota(
            memory_id=memory_id,
            tenant=tenant,
            workspace=workspace,
            credential=credential,
            charge_bytes=charge_bytes,
            payload_hash=request_hash,
        )
        durable_record = False
        try:
            existing = collection.get(ids=[memory_id], include=["metadatas"])
            existing_ids = existing.get("ids") or []
            existing_metas = existing.get("metadatas") or []
            result_metadata = record_metadata
            if memory_id in existing_ids:
                durable_record = True
                index = existing_ids.index(memory_id)
                existing_metadata = existing_metas[index] if index < len(existing_metas) else {}
                if str((existing_metadata or {}).get("idempotency_hash") or "") != request_hash:
                    raise HTTPException(
                        status_code=409,
                        detail="deterministic memory id conflicts with another write",
                    )
                result_metadata = existing_metadata or record_metadata
            elif reservation_status != "new":
                raise HTTPException(
                    status_code=409,
                    detail="idempotent memory write remains in progress",
                )
            else:
                try:
                    _fence_memory_quota(memory_id, request_hash)
                    _add_memory_with_supersession(
                        memory_id,
                        content,
                        record_metadata,
                        tenant_id=tenant,
                        workspace_id=workspace,
                    )
                    durable_record = True
                except FactSupersessionError as exc:
                    raise HTTPException(status_code=503, detail=str(exc)) from exc
            result = {
                "id": memory_id,
                "status": "stored",
                "metadata": result_metadata,
                "idempotent_replay": bool(existing_ids),
            }
            with _STRUCTURED_MEMORY_LOCK:
                connection = _structured_memory_connection()
                try:
                    connection.execute("BEGIN IMMEDIATE")
                    prior = connection.execute(
                        "SELECT request_hash, record_json FROM memory_idempotency "
                        "WHERE tenant_id = ? AND workspace_id = ? AND idempotency_key = ?",
                        (tenant, workspace, normalized_idempotency_key),
                    ).fetchone()
                    if prior is not None:
                        if str(prior["request_hash"]) != request_hash:
                            raise HTTPException(
                                status_code=409,
                                detail="idempotency_key was already used for a different memory write",
                            )
                        replay = json.loads(prior["record_json"])
                        replay["idempotent_replay"] = True
                        connection.rollback()
                        _finalize_memory_quota(memory_id, require_owner=False)
                        return replay
                    connection.execute(
                        "INSERT INTO memory_idempotency(tenant_id, workspace_id, idempotency_key, request_hash, record_json, created_at) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        (
                            tenant,
                            workspace,
                            normalized_idempotency_key,
                            request_hash,
                            json.dumps(result, ensure_ascii=False, sort_keys=True),
                            datetime.now(timezone.utc).isoformat(),
                        ),
                    )
                    _prune_memory_idempotency_scope(
                        connection,
                        tenant=tenant,
                        workspace=workspace,
                        protected_key=normalized_idempotency_key,
                    )
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
                finally:
                    connection.close()
            _finalize_memory_quota(memory_id)
            return result
        except Exception:
            if durable_record:
                _finalize_memory_quota(memory_id, require_owner=False)
            else:
                _settle_failed_memory_write(memory_id)
            raise

    memory_id = str(uuid.uuid4())
    _reserve_memory_quota(
        memory_id=memory_id,
        tenant=tenant,
        workspace=workspace,
        credential=credential,
        charge_bytes=charge_bytes,
        payload_hash=request_hash,
    )
    try:
        _fence_memory_quota(memory_id, request_hash)
        _add_memory_with_supersession(
            memory_id,
            content,
            record_metadata,
            tenant_id=tenant,
            workspace_id=workspace,
        )
        _finalize_memory_quota(memory_id)
    except FactSupersessionError as exc:
        _settle_failed_memory_write(memory_id)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception:
        _settle_failed_memory_write(memory_id)
        raise
    return {"id": memory_id, "status": "stored", "metadata": record_metadata}


def lookup_idempotent_memory_record(
    *,
    content: str,
    memory_type: Optional[str] = "memory",
    tags: Optional[List[str]] = None,
    metadata: Optional[dict] = None,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    idempotency_key: str,
) -> Optional[dict]:
    """Return only an exact, already-durable idempotency outcome."""

    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    normalized_key = str(idempotency_key or "").strip()
    if not normalized_key or len(normalized_key.encode("utf-8")) > 256:
        return None
    raw_metadata = dict(metadata or {})
    content_bytes = len(content.encode("utf-8"))
    if content_bytes > _bounded_quota_setting(
        "CORTEX_L22_MAX_CONTENT_BYTES", _L22_MAX_CONTENT_BYTES
    ):
        raise HTTPException(status_code=413, detail="memory content exceeds byte limit")
    try:
        resolved_memory_type = str(memory_type or "memory")
        normalized_tags = list(tags or [])
        if len(resolved_memory_type.encode("utf-8")) > 128:
            raise ValueError("memory_type exceeds byte limit")
        _validate_memory_metadata({"tags": normalized_tags})
        _validate_memory_metadata(raw_metadata)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    request_hash = sha256(json.dumps(
        {
            "content": content,
            "memory_type": resolved_memory_type,
            "tags": normalized_tags,
            "metadata": raw_metadata,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")).hexdigest()
    memory_id = str(uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"cortex:l22:{tenant}:{workspace}:{normalized_key}",
    ))
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            _prune_memory_idempotency_scope(
                connection,
                tenant=tenant,
                workspace=workspace,
            )
            prior = connection.execute(
                "SELECT request_hash, record_json FROM memory_idempotency "
                "WHERE tenant_id = ? AND workspace_id = ? AND idempotency_key = ?",
                (tenant, workspace, normalized_key),
            ).fetchone()
            if prior is not None:
                if str(prior["request_hash"]) != request_hash:
                    raise HTTPException(
                        status_code=409,
                        detail="idempotency_key was already used for a different memory write",
                    )
                replay = json.loads(prior["record_json"])
                replay["idempotent_replay"] = True
                connection.commit()
                return replay
            connection.commit()
            existing = collection.get(ids=[memory_id], include=["metadatas"])
            existing_ids = existing.get("ids") or []
            existing_metas = existing.get("metadatas") or []
            if memory_id not in existing_ids:
                return None
            index = existing_ids.index(memory_id)
            existing_metadata = existing_metas[index] if index < len(existing_metas) else {}
            if str((existing_metadata or {}).get("idempotency_hash") or "") != request_hash:
                raise HTTPException(
                    status_code=409,
                    detail="deterministic memory id conflicts with another write",
                )
            result = {
                "id": memory_id,
                "status": "stored",
                "metadata": existing_metadata or {},
                "idempotent_replay": True,
            }
            return result
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


class L22StoreRequest(BaseModel):
    type: Optional[str] = Field("memory", max_length=128)
    content: str = Field(..., max_length=1_000_000)
    tags: Optional[List[MemoryTag]] = Field(None, max_length=100)
    metadata: Optional[dict] = None
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)
    idempotency_key: Optional[str] = Field(None, min_length=1, max_length=256)

    _bounded_metadata = field_validator("metadata")(_validate_memory_metadata)


class L22SearchRequest(BaseModel):
    query: str = Field(..., max_length=16_384)
    n_results: int = Field(5, ge=1, le=100)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class L22NovelStoreRequest(BaseModel):
    type: Optional[str] = Field("memory", max_length=128)
    content: str = Field(..., max_length=1_000_000)
    tags: Optional[List[MemoryTag]] = Field(None, max_length=100)
    metadata: Optional[dict] = None
    novelty_tags: Optional[List[MemoryTag]] = Field(None, max_length=100)
    compare_window: int = Field(40, ge=1, le=500)
    min_novelty: float = 0.0
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)
    idempotency_key: Optional[str] = Field(None, min_length=1, max_length=256)

    _bounded_metadata = field_validator("metadata")(_validate_memory_metadata)


class L22NovelSearchRequest(BaseModel):
    query: str = Field(..., max_length=16_384)
    n_results: int = Field(5, ge=1, le=100)
    novelty_weight: float = 0.35
    semantic_weight: float = 0.65
    min_novelty: float = 0.0
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


_IMPORT_CHROMA_DIR = CHROMA_DIR
_IMPORT_DEFAULT_TENANT_ID = DEFAULT_TENANT_ID
_IMPORT_DEFAULT_WORKSPACE_ID = DEFAULT_WORKSPACE_ID


def _activate_runtime_configuration() -> None:
    """Refresh copied Librarian persistence/scope defaults in place."""

    global CHROMA_DIR, DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID
    from cortex_server.routers import librarian

    if CHROMA_DIR == _IMPORT_CHROMA_DIR:
        CHROMA_DIR = librarian.CHROMA_DIR
    if DEFAULT_TENANT_ID == _IMPORT_DEFAULT_TENANT_ID:
        DEFAULT_TENANT_ID = librarian.DEFAULT_TENANT_ID
    if DEFAULT_WORKSPACE_ID == _IMPORT_DEFAULT_WORKSPACE_ID:
        DEFAULT_WORKSPACE_ID = librarian.DEFAULT_WORKSPACE_ID
    for model in (
        L22StoreRequest,
        L22SearchRequest,
        L22NovelStoreRequest,
        L22NovelSearchRequest,
    ):
        defaults_changed = False
        for field_name, activated_default, import_default in (
            ("tenant_id", DEFAULT_TENANT_ID, _IMPORT_DEFAULT_TENANT_ID),
            ("workspace_id", DEFAULT_WORKSPACE_ID, _IMPORT_DEFAULT_WORKSPACE_ID),
        ):
            field = model.model_fields[field_name]
            if field.default == import_default:
                field.default = activated_default
                defaults_changed = True
        if defaults_changed:
            model.model_rebuild(force=True)


def _route_memory_principal(request, http_request: Optional[Request]):
    if http_request is not None:
        return memory_principal_for_request(http_request)
    return _authenticated_memory_principal_scope(
        request.tenant_id,
        request.workspace_id,
        request.scope_signature,
        scope=request.scope,
        scope_credential_id=request.scope_credential_id,
    )


@router.get("/status")
async def l22_status(http_request: Request):
    principal = memory_principal_for_request(http_request)
    semantic_error = None
    try:
        scoped = collection.get(
            where=principal_memory_where(principal),
            include=["metadatas"],
        )
        memory_count = sum(
            1
            for metadata in (scoped.get("metadatas") or [])
            if isinstance(metadata, dict)
            and str(metadata.get("memory_principal_key") or "") == principal.memory_principal_key
        )
    except Exception as exc:
        memory_count = None
        semantic_error = "semantic_memory_backend_unavailable"
        logger.warning("L22 semantic status probe failed: %s", type(exc).__name__)
    structured_error = None
    try:
        structured_memory_count = count_structured_memory_records(
            tenant_id=principal.tenant_id,
            workspace_id=principal.storage_workspace_id,
        )
    except Exception as exc:
        structured_memory_count = None
        structured_error = "structured_memory_backend_unavailable"
        logger.warning("L22 structured status probe failed: %s", type(exc).__name__)

    scope_auth_ready = _memory_scope_auth_ready()
    semantic_ready = memory_count is not None
    structured_ready = structured_memory_count is not None
    active = scope_auth_ready and semantic_ready and structured_ready
    any_backend_ready = semantic_ready or structured_ready
    status = (
        "active"
        if active
        else "degraded"
        if scope_auth_ready and any_backend_ready
        else "unavailable"
    )
    return {
        "success": active,
        "level": 22,
        "name": "Mnemosyne",
        "status": status,
        "checks": {
            "semantic_memory": {
                "ok": semantic_ready,
                "count": memory_count,
                "error": semantic_error,
            },
            "structured_memory": {
                "ok": structured_ready,
                "count": structured_memory_count,
                "error": structured_error,
            },
            "scope_authorization": {
                "ok": scope_auth_ready,
                "error": None if scope_auth_ready else "memory scope authorization is not configured",
            },
        },
        "capabilities": [
            "store",
            "search",
            "store_novel",
            "search_novel",
            "canonical_persistence",
            "exact_structured_persistence",
        ],
        "memory_count": memory_count,
        "structured_memory_count": structured_memory_count,
        "principal_scoped": True,
        "aggregate_storage_metrics": "withheld",
        "structured_memory_backend": "l22_structured_sqlite_v1",
        "scope_auth_ready": scope_auth_ready,
        "novelty_version": "l7l22.v1.1",
    }


@router.post("/store")
async def l22_store(
    request: L22StoreRequest,
    http_request: Request = None,
):
    principal = _route_memory_principal(request, http_request)
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    return store_memory_record(
        content=request.content,
        memory_type=request.type,
        tags=request.tags,
        metadata=scoped_memory_metadata(principal, request.metadata),
        tenant_id=tenant,
        workspace_id=workspace,
        idempotency_key=(
            request_memory_idempotency_key(http_request, request.idempotency_key)
            if http_request is not None
            else request.idempotency_key
        ),
    )


@router.post("/store_novel")
async def l22_store_novel(
    request: L22NovelStoreRequest,
    http_request: Request = None,
):
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    principal = _route_memory_principal(request, http_request)
    resolved_idempotency_key = (
        request_memory_idempotency_key(http_request, request.idempotency_key)
        if http_request is not None
        else request.idempotency_key
    )
    if resolved_idempotency_key:
        raise HTTPException(
            status_code=422,
            detail=(
                "idempotent novelty writes are unavailable; use the "
                "principal-scoped /l22/store route"
            ),
        )
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    metadata = scoped_memory_metadata(principal, request.metadata)
    metadata.setdefault("type", request.type or "memory")
    if request.tags:
        metadata.setdefault("tags", request.tags)

    memory_id = str(uuid.uuid4())
    payload_hash = sha256(json.dumps(
        {
            "content": request.content,
            "memory_type": request.type or "memory",
            "tags": list(request.tags or []),
            "novelty_tags": list(request.novelty_tags or []),
            "metadata": metadata,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")).hexdigest()
    _reserve_memory_quota(
        memory_id=memory_id,
        tenant=tenant,
        workspace=workspace,
        credential=_quota_credential(metadata),
        charge_bytes=_memory_charge_bytes(request.content, metadata),
        payload_hash=payload_hash,
    )
    try:
        _fence_memory_quota(memory_id, payload_hash)
        result = index_with_novelty(
            text=request.content,
            metadata=metadata,
            novelty_tags=request.novelty_tags,
            source_scope="l22",
            compare_window=request.compare_window,
            tenant_id=tenant,
            workspace_id=workspace,
            memory_id=memory_id,
            memory_principal_key=principal.memory_principal_key,
        )
        _finalize_memory_quota(memory_id)
    except Exception:
        _settle_failed_memory_write(memory_id)
        raise

    novelty_score = float(result["metadata"].get("novelty_score", 0.0))
    status = "stored" if novelty_score >= float(request.min_novelty) else "stored_below_threshold"

    return {
        "id": result["id"],
        "status": status,
        "novelty_score": novelty_score,
        "novelty_bucket": result["metadata"].get("novelty_bucket"),
        "novelty_fingerprint": result["metadata"].get("novelty_fingerprint"),
        "metadata": result["metadata"],
    }


@router.post("/search")
async def l22_search(
    request: L22SearchRequest,
    http_request: Request = None,
):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    principal = _route_memory_principal(request, http_request)
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    result = robust_search(
        query=request.query,
        n_results=request.n_results,
        allow_fallback=True,
        tenant_id=tenant,
        workspace_id=workspace,
        memory_principal_key=principal.memory_principal_key,
    )
    return {
        "query": request.query,
        "results": result.get("results", []),
        "search_mode": result.get("search_mode", "semantic"),
        "degraded": bool(result.get("degraded", False)),
        "warning": result.get("warning"),
    }


@router.post("/search_novel")
async def l22_search_novel(
    request: L22NovelSearchRequest,
    http_request: Request = None,
):
    principal = _route_memory_principal(request, http_request)
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    ranked = search_with_novelty(
        query=request.query,
        n_results=request.n_results,
        novelty_weight=request.novelty_weight,
        semantic_weight=request.semantic_weight,
        min_novelty=request.min_novelty,
        tenant_id=tenant,
        workspace_id=workspace,
        memory_principal_key=principal.memory_principal_key,
    )
    return {
        "query": request.query,
        "novelty_weight": ranked.get("novelty_weight"),
        "semantic_weight": ranked.get("semantic_weight"),
        "results": ranked.get("results", []),
    }
