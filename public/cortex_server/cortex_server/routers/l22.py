"""L22 compatibility router.

Provides stable endpoints expected by OpenClaw config:
- POST /l22/store
- POST /l22/search

Plus novelty-aware extensions:
- POST /l22/store_novel
- POST /l22/search_novel
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from datetime import datetime, timezone
import fcntl
import json
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
)

router = APIRouter()
_STRUCTURED_MEMORY_LOCK = threading.RLock()
_L22_MAX_CONTENT_BYTES = 1_000_000
_L22_QUOTA_FIXED_RECORD_BYTES = 4096
_L22_QUOTA_RESERVATION_TIMEOUT_SECONDS = 10 * 60
_L22_RECOVERY_RESERVE_BYTES = 256 * 1024 * 1024
_L22_PHYSICAL_RESERVE_FILE = ".l22-physical-recovery-reserve"
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


@router.on_event("startup")
async def initialize_l22_quota_recovery_reserve() -> None:
    if _l22_reserve_enabled():
        connection = _structured_memory_connection()
        connection.close()
    if _production_memory_mode():
        _backfill_l22_quota_ledger()


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
        "CREATE TABLE IF NOT EXISTS l22_quota_records ("
        "memory_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, "
        "credential_id TEXT NOT NULL, charge_bytes INTEGER NOT NULL, payload_hash TEXT NOT NULL, "
        "status TEXT NOT NULL CHECK(status IN ('reserved', 'committed')), created_at REAL NOT NULL)"
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
            if complete is not None and str(complete["value"]) == "v1-complete":
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

            connection.execute(
                "INSERT INTO l22_quota_state(key, value) VALUES ('legacy_backfill', 'v1-complete') "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
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
    if row is None or str(row["value"]) != "v1-complete":
        raise HTTPException(status_code=503, detail="L22 legacy quota reconciliation is incomplete")


def _reconcile_stale_quota_reservations(connection: sqlite3.Connection) -> None:
    cutoff = time.time() - _L22_QUOTA_RESERVATION_TIMEOUT_SECONDS
    rows = connection.execute(
        "SELECT * FROM l22_quota_records WHERE status = 'reserved' AND created_at <= ? ORDER BY created_at LIMIT 256",
        (cutoff,),
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
        existing = collection.get(ids=ids, include=["metadatas"])
        existing_ids = set(existing.get("ids") or [])
    except Exception:
        # Unavailable storage cannot safely be interpreted as an absent write.
        return
    for row in rows:
        if str(row["memory_id"]) in existing_ids or str(row["memory_id"]) in structured_ids:
            connection.execute(
                "UPDATE l22_quota_records SET status = 'committed' WHERE memory_id = ?",
                (row["memory_id"],),
            )
        else:
            _quota_release_row(connection, row)


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
                "charge_bytes, payload_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?)",
                (memory_id, tenant, workspace, credential, charge_bytes, payload_hash, time.time()),
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


def _finalize_memory_quota(memory_id: str) -> None:
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "UPDATE l22_quota_records SET status = 'committed' WHERE memory_id = ?",
                (memory_id,),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def _release_memory_quota(memory_id: str, *, committed: bool = False) -> None:
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM l22_quota_records WHERE memory_id = ?", (memory_id,)
            ).fetchone()
            if row is not None and (committed or str(row["status"]) == "reserved"):
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
            _finalize_memory_quota(memory_id)
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
            _finalize_memory_quota(memory_id)
        except Exception:
            pass
    else:
        try:
            _release_memory_quota(memory_id)
        except Exception:
            pass


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
            connection.commit()
            deleted = int(cursor.rowcount or 0)
        finally:
            connection.close()
    for memory_id in existing_ids:
        _release_memory_quota(memory_id, committed=True)
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

    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    normalized_idempotency_key = str(idempotency_key or "").strip()
    if idempotency_key is not None and not normalized_idempotency_key:
        raise HTTPException(status_code=422, detail="idempotency_key cannot be blank")
    if len(normalized_idempotency_key) > 256:
        raise HTTPException(status_code=422, detail="idempotency_key exceeds byte limit")

    raw_metadata = dict(metadata or {})
    request_hash = sha256(json.dumps(
        {
            "content": content,
            "memory_type": memory_type or "memory",
            "tags": list(tags or []),
            "metadata": raw_metadata,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")).hexdigest()
    try:
        record_metadata = _normalize_memory_metadata(
            raw_metadata, tenant_id=tenant, workspace_id=workspace
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    record_metadata.setdefault("type", memory_type or "memory")
    if tags:
        record_metadata.setdefault("tags", tags)
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
        record_metadata["idempotency_key"] = normalized_idempotency_key
        record_metadata["idempotency_hash"] = request_hash
        with _STRUCTURED_MEMORY_LOCK:
            connection = _structured_memory_connection()
            try:
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
                    return replay
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
                        _finalize_memory_quota(memory_id)
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
                _finalize_memory_quota(memory_id)
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
    if not normalized_key or len(normalized_key) > 256:
        return None
    raw_metadata = dict(metadata or {})
    request_hash = sha256(json.dumps(
        {
            "content": content,
            "memory_type": memory_type or "memory",
            "tags": list(tags or []),
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
                return replay
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
            return {
                "id": memory_id,
                "status": "stored",
                "metadata": existing_metadata or {},
                "idempotent_replay": True,
            }
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


@router.get("/status")
async def l22_status():
    try:
        memory_count = int(collection.count())
    except Exception:
        memory_count = None
    try:
        structured_memory_count = count_structured_memory_records()
    except Exception:
        structured_memory_count = None

    scope_auth_ready = _memory_scope_auth_ready()
    available = (memory_count is not None or structured_memory_count is not None) and scope_auth_ready
    return {
        "success": available,
        "level": 22,
        "name": "Mnemosyne",
        "status": "active" if available else "unavailable",
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
        "structured_memory_backend": "l22_structured_sqlite_v1",
        "scope_auth_ready": scope_auth_ready,
        "novelty_version": "l7l22.v1.1",
    }


@router.post("/store")
async def l22_store(request: L22StoreRequest):
    principal = _authenticated_memory_principal_scope(
        request.tenant_id,
        request.workspace_id,
        request.scope_signature,
        scope=request.scope,
        scope_credential_id=request.scope_credential_id,
    )
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    return store_memory_record(
        content=request.content,
        memory_type=request.type,
        tags=request.tags,
        metadata={**dict(request.metadata or {}), **principal.storage_metadata},
        tenant_id=tenant,
        workspace_id=workspace,
        idempotency_key=request.idempotency_key,
    )


@router.post("/store_novel")
async def l22_store_novel(request: L22NovelStoreRequest):
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    principal = _authenticated_memory_principal_scope(
        request.tenant_id,
        request.workspace_id,
        request.scope_signature,
        scope=request.scope,
        scope_credential_id=request.scope_credential_id,
    )
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    metadata = {**dict(request.metadata or {}), **principal.storage_metadata}
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
        result = index_with_novelty(
            text=request.content,
            metadata=metadata,
            novelty_tags=request.novelty_tags,
            source_scope="l22",
            compare_window=request.compare_window,
            tenant_id=tenant,
            workspace_id=workspace,
            memory_id=memory_id,
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
async def l22_search(request: L22SearchRequest):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    principal = _authenticated_memory_principal_scope(
        request.tenant_id,
        request.workspace_id,
        request.scope_signature,
        scope=request.scope,
        scope_credential_id=request.scope_credential_id,
    )
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    result = robust_search(
        query=request.query,
        n_results=request.n_results,
        allow_fallback=True,
        tenant_id=tenant,
        workspace_id=workspace,
    )
    return {
        "query": request.query,
        "results": result.get("results", []),
        "search_mode": result.get("search_mode", "semantic"),
        "degraded": bool(result.get("degraded", False)),
        "warning": result.get("warning"),
    }


@router.post("/search_novel")
async def l22_search_novel(request: L22NovelSearchRequest):
    principal = _authenticated_memory_principal_scope(
        request.tenant_id,
        request.workspace_id,
        request.scope_signature,
        scope=request.scope,
        scope_credential_id=request.scope_credential_id,
    )
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    ranked = search_with_novelty(
        query=request.query,
        n_results=request.n_results,
        novelty_weight=request.novelty_weight,
        semantic_weight=request.semantic_weight,
        min_novelty=request.min_novelty,
        tenant_id=tenant,
        workspace_id=workspace,
    )
    return {
        "query": request.query,
        "novelty_weight": ranked.get("novelty_weight"),
        "semantic_weight": ranked.get("semantic_weight"),
        "results": ranked.get("results", []),
    }
