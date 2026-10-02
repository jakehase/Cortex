"""L22 compatibility router.

Provides stable endpoints expected by OpenClaw config:
- POST /l22/store
- POST /l22/search

Plus novelty-aware extensions:
- POST /l22/store_novel
- POST /l22/search_novel
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from typing import Any, Callable, Dict, List, Optional, TypeVar
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager, nullcontext
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
    MemorySearchFilterRequest,
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
    prepare_memory_metadata_for_storage,
    prepare_governed_memory_write,
    finalize_governed_memory_write,
    parse_memory_search_filters,
    _supersession_recovery_metadata,
    _memory_scope,
    _authenticated_memory_principal_scope,
    _memory_scope_auth_ready,
    _production_memory_mode,
    _quota_fallback_rows,
    supersede_memory_records,
    delete_principal_memory_projections,
    MemoryAdmissionRejected,
    MemoryFilterError,
    MemoryGovernanceError,
)
from cortex_server.runtime.memory_governance import (
    MemoryDeletionError,
    MemoryGovernanceStore,
    MemoryPromotionError,
    evaluate_recall,
    refresh_temporal_verification,
)
from cortex_server.modules.sensitive_data_redaction import redact_sensitive_text
from cortex_server.modules.memory_scope import (
    memory_principal_for_request,
    principal_memory_where,
    request_memory_idempotency_key,
    require_authenticated_memory_principal,
    scoped_memory_metadata,
)
from cortex_server.modules.bounded_health_probe import (
    HealthProbeBusy,
    HealthProbeTimedOut,
    SingleFlightHealthProbe,
    bounded_principal_metadata_probe,
)
from cortex_server.runtime.assurance_receipt_ledger import (
    delete_assurance_receipts_matching_scope,
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
_L22_HEALTH_PROBE_TIMEOUT_SECONDS = 2.0
_L22_HEALTH_PRINCIPAL_SCAN_MAX_ROWS = 256
_L22_HEALTH_STRUCTURED_MAX_ROWS = 64
_MEMORY_STORE_OPERATION_CONTRACT = "cortex.memory-store-operation.v1"
_MEMORY_STORE_OPERATION_MAX_ROWS = 100_000
_L22_STATUS_PROBE = SingleFlightHealthProbe("l22-status")
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


def _l22_health_probe_timeout_seconds() -> float:
    try:
        configured = float(
            os.getenv(
                "CORTEX_HEALTH_PROBE_TIMEOUT_SECONDS",
                str(_L22_HEALTH_PROBE_TIMEOUT_SECONDS),
            )
        )
    except (TypeError, ValueError):
        configured = _L22_HEALTH_PROBE_TIMEOUT_SECONDS
    return min(10.0, max(0.01, configured))


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


def _memory_store_operation_db_path() -> Path:
    configured = str(os.getenv("CORTEX_L22_MEMORY_OPERATION_DB", "")).strip()
    if configured:
        return Path(configured)
    structured = _structured_memory_db_path()
    return structured.with_name("l22_memory_store_operations.sqlite3")


class MemoryStoreOperationError(RuntimeError):
    """The durable store/cancel authority is unavailable or inconsistent."""


class MemoryStoreOperationConflict(MemoryStoreOperationError):
    """An operation identity was reused with different immutable inputs."""


class MemoryStoreOperationCancelled(MemoryStoreOperationError):
    """A durable principal-scoped cancellation fence won publication."""


def _memory_store_operation_connection() -> sqlite3.Connection:
    db_path = _memory_store_operation_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(db_path), timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=FULL")
    connection.execute("PRAGMA busy_timeout=30000")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS memory_store_operations (
            tenant_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            memory_principal_key TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            memory_id TEXT NOT NULL,
            request_hash TEXT NOT NULL DEFAULT '',
            fact_key TEXT NOT NULL DEFAULT '',
            generation INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL CHECK(status IN ('prepared', 'committed', 'cancelled')),
            projection_status TEXT NOT NULL DEFAULT 'not_required'
                CHECK(projection_status IN ('not_required', 'pending', 'complete')),
            reason TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (
                tenant_id, workspace_id, memory_principal_key, idempotency_key
            ),
            UNIQUE (tenant_id, workspace_id, memory_principal_key, memory_id)
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_memory_store_operations_recovery "
        "ON memory_store_operations(status, projection_status, updated_at)"
    )
    connection.commit()
    return connection


def _memory_store_operation_principal_key(
    metadata: Dict[str, Any], tenant: str, workspace: str
) -> str:
    principal_key = str(metadata.get("memory_principal_key") or "").strip()
    if principal_key:
        return principal_key
    # Direct local callers predate authenticated principal metadata. They still
    # receive a stable scope-local fence; HTTP routes always use the stronger
    # server-derived memory_principal_key above.
    return "scope:" + sha256(f"{tenant}\0{workspace}".encode("utf-8")).hexdigest()


def _memory_store_operation_identity(
    *,
    tenant: str,
    workspace: str,
    memory_principal_key: str,
    idempotency_key: str,
    memory_id: str,
    request_hash: str = "",
    fact_key: str = "",
    generation: int = 0,
) -> Dict[str, Any]:
    normalized_generation = int(generation)
    if normalized_generation < 0 or normalized_generation >= 2**63:
        raise ValueError("operation_generation must be a non-negative 64-bit integer")
    normalized_fact_key = str(fact_key or "").strip()
    if len(normalized_fact_key.encode("utf-8")) > 1024:
        raise ValueError("fact_key exceeds byte limit")
    identity = {
        "tenant_id": str(tenant),
        "workspace_id": str(workspace),
        "memory_principal_key": str(memory_principal_key),
        "idempotency_key": str(idempotency_key),
        "memory_id": str(memory_id),
        "request_hash": str(request_hash or ""),
        "fact_key": normalized_fact_key,
        "generation": normalized_generation,
    }
    if any(not identity[field] for field in (
        "tenant_id", "workspace_id", "memory_principal_key",
        "idempotency_key", "memory_id",
    )):
        raise ValueError("memory store operation identity is incomplete")
    return identity


def _validate_memory_store_operation_row(
    row: sqlite3.Row, identity: Dict[str, Any], *, allow_unbound_cancel: bool = True
) -> None:
    for field in (
        "tenant_id", "workspace_id", "memory_principal_key",
        "idempotency_key", "memory_id",
    ):
        if str(row[field]) != str(identity[field]):
            raise MemoryStoreOperationConflict(
                "memory store operation identity conflicts with durable state"
            )
    # Status/cancel callers do not know the request payload hash, and a cancel
    # may durably fence an operation before the corresponding store arrives.
    # That is the only field allowed to be unbound.  ``fact_key`` and
    # ``generation`` are caller-visible identity fields; treating their valid
    # empty/zero values as wildcards would let a stale request address another
    # generation of the same principal-local operation.
    durable_hash = str(row["request_hash"] or "")
    supplied_hash = str(identity["request_hash"] or "")
    if durable_hash and supplied_hash and durable_hash != supplied_hash:
        raise MemoryStoreOperationConflict(
            "memory store operation payload conflicts with durable state"
        )
    if not allow_unbound_cancel and durable_hash != supplied_hash:
        raise MemoryStoreOperationConflict(
            "memory store operation payload is not fully bound"
        )
    if str(row["fact_key"] or "") != str(identity["fact_key"] or ""):
        raise MemoryStoreOperationConflict(
            "memory store operation fact identity conflicts with durable state"
        )
    durable_generation = int(row["generation"] or 0)
    supplied_generation = int(identity["generation"] or 0)
    if durable_generation != supplied_generation:
        raise MemoryStoreOperationConflict(
            "memory store operation generation conflicts with durable state"
        )


def _select_memory_store_operation(
    connection: sqlite3.Connection, identity: Dict[str, Any]
) -> Optional[sqlite3.Row]:
    return connection.execute(
        "SELECT * FROM memory_store_operations WHERE tenant_id = ? AND "
        "workspace_id = ? AND memory_principal_key = ? AND idempotency_key = ?",
        (
            identity["tenant_id"], identity["workspace_id"],
            identity["memory_principal_key"], identity["idempotency_key"],
        ),
    ).fetchone()


def _prepare_memory_store_operation(identity: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    connection = _memory_store_operation_connection()
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = _select_memory_store_operation(connection, identity)
        if row is None:
            count = int(connection.execute(
                "SELECT COUNT(*) FROM memory_store_operations"
            ).fetchone()[0])
            if count >= _MEMORY_STORE_OPERATION_MAX_ROWS:
                raise MemoryStoreOperationError(
                    "memory store operation authority reached its durable bound"
                )
            connection.execute(
                "INSERT INTO memory_store_operations(tenant_id, workspace_id, "
                "memory_principal_key, idempotency_key, memory_id, request_hash, "
                "fact_key, generation, status, projection_status, reason, "
                "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "
                "'prepared', 'not_required', '', ?, ?)",
                (
                    identity["tenant_id"], identity["workspace_id"],
                    identity["memory_principal_key"], identity["idempotency_key"],
                    identity["memory_id"], identity["request_hash"],
                    identity["fact_key"], identity["generation"], now, now,
                ),
            )
        else:
            _validate_memory_store_operation_row(row, identity)
            if str(row["status"]) == "cancelled":
                raise MemoryStoreOperationCancelled(
                    "memory store operation was durably cancelled"
                )
        connection.commit()
        row = _select_memory_store_operation(connection, identity)
        if row is None:  # pragma: no cover - guarded by the same transaction
            raise MemoryStoreOperationError("memory store operation prepare was lost")
        return dict(row)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


@contextmanager
def _memory_store_publication(identity: Dict[str, Any]):
    """Serialize final publication against cancel across processes.

    The WAL row is prepared in a short transaction first so status can report a
    timeout as pending. This second write transaction remains open through the
    external Chroma/fallback publication. A concurrent cancel either commits
    first (and publication observes cancelled) or waits and retires the fully
    committed result; there is no unlocked check/write gap.
    """

    connection = _memory_store_operation_connection()
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = _select_memory_store_operation(connection, identity)
        if row is None:
            raise MemoryStoreOperationError("memory store operation was not prepared")
        _validate_memory_store_operation_row(row, identity)
        if str(row["status"]) == "cancelled":
            raise MemoryStoreOperationCancelled(
                "memory store operation was durably cancelled"
            )
        yield connection, row
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _commit_memory_store_operation(
    connection: sqlite3.Connection, identity: Dict[str, Any]
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    cursor = connection.execute(
        "UPDATE memory_store_operations SET status = 'committed', "
        "projection_status = 'not_required', reason = '', updated_at = ? "
        "WHERE tenant_id = ? AND workspace_id = ? AND memory_principal_key = ? "
        "AND idempotency_key = ? AND status = 'prepared'",
        (
            now, identity["tenant_id"], identity["workspace_id"],
            identity["memory_principal_key"], identity["idempotency_key"],
        ),
    )
    if int(cursor.rowcount or 0) != 1:
        raise MemoryStoreOperationError(
            "memory store operation could not commit its visibility fence"
        )


def _cancel_memory_store_operation(
    identity: Dict[str, Any], *, reason: str
) -> Dict[str, Any]:
    normalized_reason = str(reason or "source_deleted_or_revoked").strip()
    if not normalized_reason or len(normalized_reason.encode("utf-8")) > 240:
        raise ValueError("cancellation reason must be a bounded non-empty string")
    now = datetime.now(timezone.utc).isoformat()
    connection = _memory_store_operation_connection()
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = _select_memory_store_operation(connection, identity)
        if row is None:
            count = int(connection.execute(
                "SELECT COUNT(*) FROM memory_store_operations"
            ).fetchone()[0])
            if count >= _MEMORY_STORE_OPERATION_MAX_ROWS:
                raise MemoryStoreOperationError(
                    "memory store operation authority reached its durable bound"
                )
            connection.execute(
                "INSERT INTO memory_store_operations(tenant_id, workspace_id, "
                "memory_principal_key, idempotency_key, memory_id, request_hash, "
                "fact_key, generation, status, projection_status, reason, "
                "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "
                "'cancelled', 'pending', ?, ?, ?)",
                (
                    identity["tenant_id"], identity["workspace_id"],
                    identity["memory_principal_key"], identity["idempotency_key"],
                    identity["memory_id"], identity["request_hash"],
                    identity["fact_key"], identity["generation"],
                    normalized_reason, now, now,
                ),
            )
        else:
            _validate_memory_store_operation_row(row, identity)
            connection.execute(
                "UPDATE memory_store_operations SET status = 'cancelled', "
                "projection_status = CASE WHEN projection_status = 'complete' "
                "THEN 'complete' ELSE 'pending' END, reason = CASE "
                "WHEN status = 'cancelled' AND reason != '' THEN reason ELSE ? END, "
                "updated_at = CASE WHEN status = 'cancelled' THEN updated_at ELSE ? END "
                "WHERE tenant_id = ? AND workspace_id = ? AND "
                "memory_principal_key = ? AND idempotency_key = ?",
                (
                    normalized_reason, now, identity["tenant_id"],
                    identity["workspace_id"], identity["memory_principal_key"],
                    identity["idempotency_key"],
                ),
            )
        connection.commit()
        row = _select_memory_store_operation(connection, identity)
        if row is None:  # pragma: no cover - guarded by the same transaction
            raise MemoryStoreOperationError("memory store cancellation was lost")
        return dict(row)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _complete_memory_store_cancellation(identity: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    connection = _memory_store_operation_connection()
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = _select_memory_store_operation(connection, identity)
        if row is None:
            raise MemoryStoreOperationError("memory store cancellation is missing")
        _validate_memory_store_operation_row(row, identity)
        if str(row["status"]) != "cancelled":
            raise MemoryStoreOperationError("memory store operation is not cancelled")
        connection.execute(
            "UPDATE memory_store_operations SET projection_status = 'complete', "
            "updated_at = ? WHERE tenant_id = ? AND workspace_id = ? AND "
            "memory_principal_key = ? AND idempotency_key = ?",
            (
                now, identity["tenant_id"], identity["workspace_id"],
                identity["memory_principal_key"], identity["idempotency_key"],
            ),
        )
        connection.commit()
        updated = _select_memory_store_operation(connection, identity)
        return dict(updated) if updated is not None else {}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _get_memory_store_operation(identity: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    connection = _memory_store_operation_connection()
    try:
        row = _select_memory_store_operation(connection, identity)
        if row is None:
            return None
        _validate_memory_store_operation_row(row, identity)
        return dict(row)
    finally:
        connection.close()


def memory_store_operation_for_metadata(
    metadata: Dict[str, Any], *, memory_id: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Resolve the authoritative visibility row for contracted metadata.

    Missing, corrupt, or mismatched authority is an error rather than evidence
    that whichever backend answered first may expose the row.
    """

    if str(metadata.get("memory_operation_contract") or "") != _MEMORY_STORE_OPERATION_CONTRACT:
        return None
    tenant = str(metadata.get("tenant_id") or "").strip()
    workspace = str(
        metadata.get("storage_workspace_id") or metadata.get("workspace_id") or ""
    ).strip()
    principal_key = _memory_store_operation_principal_key(metadata, tenant, workspace)
    operation_id = str(metadata.get("memory_operation_id") or "").strip()
    if memory_id is not None and operation_id != str(memory_id):
        raise MemoryStoreOperationConflict(
            "memory row does not match its durable operation identity"
        )
    identity = _memory_store_operation_identity(
        tenant=tenant,
        workspace=workspace,
        memory_principal_key=principal_key,
        idempotency_key=str(metadata.get("idempotency_key") or ""),
        memory_id=operation_id,
        request_hash=str(metadata.get("idempotency_hash") or ""),
        fact_key=str(metadata.get("fact_key") or ""),
        generation=int(metadata.get("memory_operation_generation") or 0),
    )
    row = _get_memory_store_operation(identity)
    if row is None:
        raise MemoryStoreOperationError(
            "contracted memory row has no durable operation authority"
        )
    _validate_memory_store_operation_row(row, identity, allow_unbound_cancel=False)
    return row


def _memory_store_operation_metadata(identity: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "memory_operation_contract": _MEMORY_STORE_OPERATION_CONTRACT,
        "memory_operation_id": identity["memory_id"],
        "memory_operation_generation": identity["generation"],
    }


def _validate_durable_idempotent_metadata(
    metadata: Any,
    identity: Dict[str, Any],
    *,
    require_operation_contract: bool,
) -> Dict[str, Any]:
    """Validate the independently durable replay projection.

    The bounded ``memory_idempotency`` result cache may be evicted.  Chroma is
    therefore an acceptable replay source only when its deterministic row,
    request hash, scope, principal, fact generation, and operation contract all
    agree with the permanent operation authority.
    """

    if not isinstance(metadata, dict):
        raise MemoryStoreOperationError(
            "durable memory replay metadata is missing or invalid"
        )
    durable = dict(metadata)
    stored_workspace = str(
        durable.get("storage_workspace_id")
        or durable.get("workspace_id")
        or ""
    )
    if (
        str(durable.get("tenant_id") or "") != identity["tenant_id"]
        or stored_workspace != identity["workspace_id"]
        or str(durable.get("idempotency_key") or "")
        != identity["idempotency_key"]
        or str(durable.get("idempotency_hash") or "")
        != identity["request_hash"]
        or str(durable.get("fact_key") or "") != identity["fact_key"]
    ):
        raise MemoryStoreOperationError(
            "durable memory replay identity conflicts with operation authority"
        )
    stored_principal = str(durable.get("memory_principal_key") or "")
    expected_principal = str(identity["memory_principal_key"])
    if (
        (expected_principal.startswith("principal:") and stored_principal != expected_principal)
        or (stored_principal and stored_principal != expected_principal)
    ):
        raise MemoryStoreOperationError(
            "durable memory replay principal conflicts with operation authority"
        )

    contract = str(durable.get("memory_operation_contract") or "")
    operation_id = str(durable.get("memory_operation_id") or "")
    operation_generation = durable.get("memory_operation_generation")
    any_contract_field = bool(contract or operation_id) or operation_generation is not None
    if any_contract_field:
        if (
            contract != _MEMORY_STORE_OPERATION_CONTRACT
            or operation_id != identity["memory_id"]
            or not isinstance(operation_generation, int)
            or isinstance(operation_generation, bool)
            or operation_generation != identity["generation"]
        ):
            raise MemoryStoreOperationError(
                "durable memory replay contract conflicts with operation authority"
            )
    elif require_operation_contract:
        raise MemoryStoreOperationError(
            "durable memory replay is missing its operation contract"
        )
    return durable


def _read_memory_idempotency_result(
    identity: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            row = connection.execute(
                "SELECT request_hash, record_json FROM memory_idempotency "
                "WHERE tenant_id = ? AND workspace_id = ? AND idempotency_key = ?",
                (
                    identity["tenant_id"], identity["workspace_id"],
                    identity["idempotency_key"],
                ),
            ).fetchone()
        finally:
            connection.close()
    if row is None:
        return None
    if str(row["request_hash"] or "") != identity["request_hash"]:
        raise MemoryStoreOperationError(
            "durable memory replay cache conflicts with operation authority"
        )
    try:
        result = json.loads(str(row["record_json"] or ""))
    except (TypeError, ValueError) as exc:
        raise MemoryStoreOperationError(
            "durable memory replay cache is corrupt"
        ) from exc
    if (
        not isinstance(result, dict)
        or str(result.get("id") or "") != identity["memory_id"]
    ):
        raise MemoryStoreOperationError(
            "durable memory replay cache has an invalid result identity"
        )
    metadata = _validate_durable_idempotent_metadata(
        result.get("metadata"),
        identity,
        require_operation_contract=False,
    )
    return {**result, "metadata": metadata}


def _recover_durable_idempotent_result(
    identity: Dict[str, Any],
) -> Dict[str, Any]:
    """Recover a replay from exact Chroma + quota proof and bind its fence.

    This path also migrates a pre-operation-contract row.  Contract metadata is
    made durable before the operation can transition to ``committed``, so a
    later cancellation is visible to every current-read filter even if its
    physical retirement projection is interrupted.
    """

    try:
        durable = collection.get(
            ids=[identity["memory_id"]], include=["metadatas"]
        )
    except Exception as exc:
        raise MemoryStoreOperationError(
            "durable memory replay backend is unavailable"
        ) from exc
    ids = [str(value) for value in (durable.get("ids") or [])]
    metadatas = list(durable.get("metadatas") or [])
    if ids != [identity["memory_id"]] or len(metadatas) != 1:
        raise MemoryStoreOperationError(
            "durable memory replay record is missing"
        )
    metadata = _validate_durable_idempotent_metadata(
        metadatas[0], identity, require_operation_contract=False
    )

    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            quota = connection.execute(
                "SELECT * FROM l22_quota_records WHERE memory_id = ?",
                (identity["memory_id"],),
            ).fetchone()
            if (
                quota is None
                or str(quota["tenant_id"]) != identity["tenant_id"]
                or str(quota["workspace_id"]) != identity["workspace_id"]
                or str(quota["status"]) not in {"reserved", "committed"}
            ):
                raise MemoryStoreOperationError(
                    "durable memory replay quota proof is missing"
                )
            quota_hash = str(quota["payload_hash"] or "")
            if quota_hash != identity["request_hash"]:
                if not quota_hash.startswith("legacy:"):
                    raise MemoryStoreOperationError(
                        "durable memory replay quota identity conflicts"
                    )
                connection.execute(
                    "UPDATE l22_quota_records SET payload_hash = ? "
                    "WHERE memory_id = ? AND payload_hash = ?",
                    (identity["request_hash"], identity["memory_id"], quota_hash),
                )
            connection.commit()
            quota_status = str(quota["status"])
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    if quota_status == "reserved":
        # The operation transaction serializes us against the original writer.
        # Exact durable Chroma proof makes a stranded reservation safe to adopt.
        _finalize_memory_quota(identity["memory_id"], require_owner=False)

    contract_fields = _memory_store_operation_metadata(identity)
    if any(metadata.get(key) != value for key, value in contract_fields.items()):
        try:
            collection.update(
                ids=[identity["memory_id"]],
                metadatas=[{**metadata, **contract_fields}],
            )
            verified = collection.get(
                ids=[identity["memory_id"]], include=["metadatas"]
            )
        except Exception as exc:
            raise MemoryStoreOperationError(
                "durable memory replay contract could not be persisted"
            ) from exc
        verified_ids = [str(value) for value in (verified.get("ids") or [])]
        verified_metadatas = list(verified.get("metadatas") or [])
        if verified_ids != [identity["memory_id"]] or len(verified_metadatas) != 1:
            raise MemoryStoreOperationError(
                "durable memory replay contract readback failed"
            )
        metadata = _validate_durable_idempotent_metadata(
            verified_metadatas[0], identity, require_operation_contract=True
        )
    else:
        metadata = _validate_durable_idempotent_metadata(
            metadata, identity, require_operation_contract=True
        )

    return {
        "id": identity["memory_id"],
        "status": "stored",
        "metadata": metadata,
        "idempotent_replay": True,
        "operation_status": "committed",
    }


def _durable_idempotent_result(identity: Dict[str, Any]) -> Dict[str, Any]:
    """Return a replay only after the physical record is proved durable.

    The bounded SQLite row is a conflict/result cache, not a copy of the
    memory payload.  It may prove that a key was used, but it cannot honestly
    report ``stored`` after the principal-scoped Chroma row disappeared.
    Validate any retained cache row first, then always require the independent
    Chroma and quota proof used after cache eviction.
    """

    # Parsing the cache still rejects corrupt/conflicting rows.  Do not require
    # its copy to have the latest contract yet: physical recovery below owns
    # the fail-closed migration of legacy durable metadata.
    _read_memory_idempotency_result(identity)
    return _recover_durable_idempotent_result(identity)


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
) -> Dict[str, Any]:
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
        or str(metadata.get("idempotency_key") or "") != key
        or str(metadata.get("idempotency_hash") or "") != request_hash
        or str(metadata.get("memory_operation_contract") or "")
        != _MEMORY_STORE_OPERATION_CONTRACT
        or str(metadata.get("memory_operation_id") or "") != expected_id
        or not isinstance(metadata.get("memory_operation_generation"), int)
        or isinstance(metadata.get("memory_operation_generation"), bool)
    ):
        raise RuntimeError(
            "historical L22 idempotency rows require migration before retention pruning"
        )
    try:
        identity = _memory_store_operation_identity(
            tenant=tenant,
            workspace=workspace,
            memory_principal_key=_memory_store_operation_principal_key(
                metadata, tenant, workspace
            ),
            idempotency_key=key,
            memory_id=expected_id,
            request_hash=request_hash,
            fact_key=str(metadata.get("fact_key") or ""),
            generation=int(metadata["memory_operation_generation"]),
        )
        _validate_durable_idempotent_metadata(
            metadata,
            identity,
            require_operation_contract=True,
        )
        operation = _get_memory_store_operation(identity)
        operation_status = str((operation or {}).get("status") or "")
        if operation is None or operation_status not in {"committed", "cancelled"}:
            raise MemoryStoreOperationError(
                "durable memory operation is neither committed nor cancelled"
            )
        _validate_memory_store_operation_row(
            operation,
            identity,
            allow_unbound_cancel=False,
        )
    except (MemoryStoreOperationError, ValueError, TypeError) as exc:
        raise RuntimeError(
            "L22 idempotency rows require a committed or cancelled fully-bound "
            "principal-scoped operation ledger before retention pruning"
        ) from exc
    return {**identity, "operation_status": operation_status}


def _assert_idempotency_rows_replay_safe(
    connection: sqlite3.Connection,
    rows: List[sqlite3.Row],
    *,
    tenant: str,
    workspace: str,
) -> None:
    """Prove the exact durable fallback before any ledger row is evicted.

    The ledger's own JSON is not evidence that Chroma still has the record.
    Require the permanent principal-scoped operation authority, deterministic
    ID, matching request/fact/generation contract in Chroma, and a committed
    quota row whose payload hash can admit the replay. A legacy quota hash is
    migrated only after every stronger proof succeeds.
    """

    identities = {
        str(row["idempotency_key"]): _idempotency_row_replay_identity(
            row,
            tenant=tenant,
            workspace=workspace,
        )
        for row in rows
    }
    committed_rows = [
        row
        for row in rows
        if identities[str(row["idempotency_key"])]["operation_status"]
        == "committed"
    ]
    # A fully-bound cancelled operation is itself the permanent replay fence:
    # every later store with that key is rejected before consulting this
    # bounded cache.  Its physical row may already be retired, so requiring a
    # live Chroma replay result would make safe cache eviction impossible and
    # could starve the next fact generation.
    for offset in range(0, len(committed_rows), 256):
        chunk = committed_rows[offset : offset + 256]
        ids = [
            str(identities[str(row["idempotency_key"])]["memory_id"])
            for row in chunk
        ]
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
            identity = identities[key]
            memory_id = str(identity["memory_id"])
            request_hash = str(identity["request_hash"])
            metadata = metadata_by_id.get(memory_id)
            quota = quota_rows.get(memory_id)
            try:
                _validate_durable_idempotent_metadata(
                    metadata,
                    identity,
                    require_operation_contract=True,
                )
            except MemoryStoreOperationError as exc:
                raise RuntimeError(
                    "L22 idempotency rows require a verified durable replay "
                    "fallback before retention pruning"
                ) from exc
            if (
                quota is None
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
        metadata_states = [metadata]
        if str(metadata.get("fact_key") or "").strip():
            # These exact pure transitions are also used by durable writes
            # and recovery. Validate every representation before authority is
            # reserved, and conservatively charge the largest physical state.
            metadata_states.extend(
                _supersession_recovery_metadata(metadata, stage=stage)
                for stage in ("pending", "active")
            )
        metadata_bytes = max(
            len(json.dumps(
                prepare_memory_metadata_for_storage(state),
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8"))
            for state in metadata_states
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
            prepare_memory_metadata_for_storage(metadata),
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


def _quota_side_effect_marker(
    *,
    memory_id: str,
    tenant: str,
    workspace: str,
    transaction_id: str,
    payload_hash: str,
    charge_bytes: int,
    create: bool,
) -> None:
    expected_metadata = {
        "type": "quota_side_effect",
        "transaction_id": transaction_id,
        "payload_hash": payload_hash,
        "charge_bytes": charge_bytes,
    }
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM structured_memory WHERE id = ?", (memory_id,)
            ).fetchone()
            if row is None:
                if not create:
                    raise MemoryStoreOperationError(
                        "durable quota side-effect marker is missing"
                    )
                connection.execute(
                    "INSERT INTO structured_memory(id, tenant_id, workspace_id, "
                    "memory_type, lookup_key, content, metadata_json, created_at) "
                    "VALUES (?, ?, ?, 'quota_side_effect', ?, ?, ?, ?)",
                    (
                        memory_id,
                        tenant,
                        workspace,
                        transaction_id,
                        payload_hash,
                        json.dumps(
                            expected_metadata,
                            ensure_ascii=True,
                            sort_keys=True,
                        ),
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
            else:
                try:
                    stored_metadata = json.loads(str(row["metadata_json"] or ""))
                except (TypeError, ValueError) as exc:
                    raise MemoryStoreOperationError(
                        "durable quota side-effect marker is corrupt"
                    ) from exc
                if (
                    str(row["tenant_id"]) != tenant
                    or str(row["workspace_id"]) != workspace
                    or str(row["memory_type"]) != "quota_side_effect"
                    or str(row["lookup_key"]) != transaction_id
                    or str(row["content"]) != payload_hash
                    or stored_metadata != expected_metadata
                ):
                    raise MemoryStoreOperationConflict(
                        "durable quota side-effect marker conflicts with replay"
                    )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


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
    if reservation_status not in {"new", "reserved", "committed"}:
        raise HTTPException(
            status_code=409,
            detail="L22 side-effect quota reservation is not publishable",
        )
    if reservation_status == "new":
        _fence_memory_quota(memory_id, normalized_hash)
    try:
        _quota_side_effect_marker(
            memory_id=memory_id,
            tenant=tenant,
            workspace=workspace,
            transaction_id=normalized_transaction,
            payload_hash=normalized_hash,
            charge_bytes=requested_bytes,
            create=reservation_status == "new",
        )
        result = publish()
        if reservation_status != "committed":
            _finalize_memory_quota(memory_id, require_owner=False)
        return result
    except Exception:
        # Once the structured marker exists, publication may be partial. Keep
        # both its replay intent and complete capacity charge. A retry validates
        # that marker and resumes the idempotent journal projection without a
        # second charge.
        try:
            _quota_side_effect_marker(
                memory_id=memory_id,
                tenant=tenant,
                workspace=workspace,
                transaction_id=normalized_transaction,
                payload_hash=normalized_hash,
                charge_bytes=requested_bytes,
                create=False,
            )
        except Exception:
            if reservation_status == "new":
                _settle_failed_memory_write(memory_id)
        else:
            try:
                _finalize_memory_quota(memory_id, require_owner=False)
            except Exception:
                pass
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
    limit: Optional[int] = None,
) -> int:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    params: List[object] = [tenant, workspace]
    if limit is None:
        query = (
            "SELECT COUNT(*) FROM structured_memory "
            "WHERE tenant_id = ? AND workspace_id = ?"
        )
    else:
        query = (
            "SELECT COUNT(*) FROM (SELECT 1 FROM structured_memory "
            "WHERE tenant_id = ? AND workspace_id = ? LIMIT ?)"
        )
        params.append(max(1, min(int(limit), 1000)))
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            return int(connection.execute(query, params).fetchone()[0])
        finally:
            connection.close()


def prepare_memory_store_request(
    *,
    content: str,
    memory_type: Optional[str] = "memory",
    tags: Optional[List[str]] = None,
    metadata: Optional[dict] = None,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    operation_generation: int = 0,
) -> dict:
    """Pure full-request storage preflight shared with the actual writer."""
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
    if (
        not isinstance(operation_generation, int)
        or isinstance(operation_generation, bool)
        or operation_generation < 0
        or operation_generation >= 2**63
    ):
        raise HTTPException(
            status_code=422,
            detail="operation_generation must be a non-negative 64-bit integer",
        )

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
            "operation_generation": operation_generation,
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
    return {
        "tenant": tenant, "workspace": workspace,
        "idempotency_key": normalized_idempotency_key,
        "operation_generation": operation_generation,
        "record_metadata": record_metadata, "request_hash": request_hash,
        "charge_bytes": charge_bytes, "credential": credential,
    }


def store_memory_record(
    *,
    content: str,
    memory_type: Optional[str] = "memory",
    tags: Optional[List[str]] = None,
    metadata: Optional[dict] = None,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    operation_generation: int = 0,
) -> dict:
    prepared = prepare_memory_store_request(
        content=content, memory_type=memory_type, tags=tags, metadata=metadata,
        tenant_id=tenant_id, workspace_id=workspace_id,
        idempotency_key=idempotency_key,
        operation_generation=operation_generation,
    )
    tenant, workspace = prepared["tenant"], prepared["workspace"]
    normalized_idempotency_key = prepared["idempotency_key"]
    operation_generation = prepared["operation_generation"]
    record_metadata, request_hash = prepared["record_metadata"], prepared["request_hash"]
    charge_bytes, credential = prepared["charge_bytes"], prepared["credential"]
    principal_key = _memory_store_operation_principal_key(
        record_metadata, tenant, workspace
    )
    if normalized_idempotency_key:
        memory_id = str(uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"cortex:l22:{tenant}:{workspace}:{normalized_idempotency_key}",
        ))
        fact_key = str(record_metadata.get("fact_key") or "").strip()
        record_metadata.update({
            "memory_operation_contract": _MEMORY_STORE_OPERATION_CONTRACT,
            "memory_operation_id": memory_id,
            "memory_operation_generation": operation_generation,
        })
        try:
            _validate_memory_metadata(record_metadata)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        charge_bytes = _memory_charge_bytes(
            content,
            record_metadata,
            idempotency_key=normalized_idempotency_key,
        )
        identity = _memory_store_operation_identity(
            tenant=tenant,
            workspace=workspace,
            memory_principal_key=principal_key,
            idempotency_key=normalized_idempotency_key,
            memory_id=memory_id,
            request_hash=request_hash,
            fact_key=fact_key,
            generation=operation_generation,
        )
        try:
            operation_seed = _prepare_memory_store_operation(identity)
        except MemoryStoreOperationCancelled as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except MemoryStoreOperationConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except MemoryStoreOperationError as exc:
            raise HTTPException(
                status_code=503, detail="memory store operation authority unavailable"
            ) from exc
        operation_time = str(
            operation_seed.get("created_at") or datetime.now(timezone.utc).isoformat()
        )
        # Every retry of one idempotent operation must stage the same governed
        # payload hash. ``recorded_at`` is server authority, while caller-
        # supplied observed/known times remain meaningful and are preserved.
        record_metadata["recorded_at"] = operation_time
        record_metadata.setdefault("observed_at", operation_time)
        record_metadata.setdefault("known_at", operation_time)
        governance_operation_id = "l22:" + memory_id
        try:
            record_metadata = prepare_governed_memory_write(
                principal_key=principal_key,
                content=content,
                metadata=record_metadata,
                operation_id=governance_operation_id,
            )
            _validate_memory_metadata(record_metadata)
        except MemoryAdmissionRejected as exc:
            try:
                _cancel_memory_store_operation(identity, reason="privacy_admission_quarantined")
                _complete_memory_store_cancellation(identity)
            except Exception:
                pass
            raise HTTPException(status_code=422, detail=exc.decision.public_dict()) from exc
        except (MemoryGovernanceError, ValueError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        charge_bytes = _memory_charge_bytes(
            content,
            record_metadata,
            idempotency_key=normalized_idempotency_key,
        )

        durable_record = False
        quota_reserved = False
        try:
            with _memory_store_publication(identity) as (operation_connection, operation_row):
                if str(operation_row["status"]) == "committed":
                    return _durable_idempotent_result(identity)

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
                        connection.commit()
                    except Exception:
                        connection.rollback()
                        raise
                    finally:
                        connection.close()
                if prior is not None:
                    if str(prior["request_hash"]) != request_hash:
                        raise HTTPException(
                            status_code=409,
                            detail="idempotency_key was already used for a different memory write",
                        )
                    replay = _durable_idempotent_result(identity)
                    _commit_memory_store_operation(operation_connection, identity)
                    return replay

                reservation_status = _reserve_memory_quota(
                    memory_id=memory_id,
                    tenant=tenant,
                    workspace=workspace,
                    credential=credential,
                    charge_bytes=charge_bytes,
                    payload_hash=request_hash,
                )
                quota_reserved = True
                existing = collection.get(ids=[memory_id], include=["metadatas"])
                existing_ids = existing.get("ids") or []
                existing_metas = existing.get("metadatas") or []
                result_metadata = record_metadata
                if memory_id in existing_ids:
                    durable_record = True
                    index = existing_ids.index(memory_id)
                    existing_metadata = (
                        existing_metas[index] if index < len(existing_metas) else {}
                    )
                    if str((existing_metadata or {}).get("idempotency_hash") or "") != request_hash:
                        raise HTTPException(
                            status_code=409,
                            detail="deterministic memory id conflicts with another write",
                        )
                    result_metadata = {**(existing_metadata or {}), **{
                        key: record_metadata[key]
                        for key in (
                            "memory_operation_contract", "memory_operation_id",
                            "memory_operation_generation",
                        )
                    }}
                    if result_metadata != (existing_metadata or {}):
                        collection.update(ids=[memory_id], metadatas=[result_metadata])
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
                    "operation_status": "committed",
                }
                try:
                    finalize_governed_memory_write(
                        principal_key=principal_key,
                        memory_id=memory_id,
                        content=content,
                        metadata=result_metadata,
                        operation_id=governance_operation_id,
                        receipt_id=memory_id,
                    )
                except Exception as exc:
                    raise MemoryStoreOperationError(
                        "memory governance finalization remains replay-pending"
                    ) from exc
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
                            connection.rollback()
                            _finalize_memory_quota(memory_id, require_owner=False)
                            replay = _durable_idempotent_result(identity)
                            _commit_memory_store_operation(operation_connection, identity)
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
                # A replay after process death can inherit a reservation owned
                # by the prior writer. Exact deterministic Chroma metadata has
                # already been verified above, so adopt that stranded charge
                # instead of forcing one artificial failing retry.
                _finalize_memory_quota(
                    memory_id,
                    require_owner=reservation_status == "new",
                )
                _commit_memory_store_operation(operation_connection, identity)
                return result
        except MemoryStoreOperationCancelled as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except MemoryStoreOperationConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except MemoryStoreOperationError as exc:
            raise HTTPException(
                status_code=503, detail="memory store operation authority unavailable"
            ) from exc
        except Exception:
            if quota_reserved:
                if durable_record:
                    _finalize_memory_quota(memory_id, require_owner=False)
                else:
                    _settle_failed_memory_write(memory_id)
            raise

    memory_id = str(uuid.uuid4())
    governance_operation_id = "l22:" + memory_id
    try:
        record_metadata = prepare_governed_memory_write(
            principal_key=principal_key,
            content=content,
            metadata=record_metadata,
            operation_id=governance_operation_id,
        )
        _validate_memory_metadata(record_metadata)
    except MemoryAdmissionRejected as exc:
        raise HTTPException(status_code=422, detail=exc.decision.public_dict()) from exc
    except (MemoryGovernanceError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    charge_bytes = _memory_charge_bytes(content, record_metadata)
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
        finalize_governed_memory_write(
            principal_key=principal_key,
            memory_id=memory_id,
            content=content,
            metadata=record_metadata,
            operation_id=governance_operation_id,
            receipt_id=memory_id,
        )
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
    operation_generation: int = 0,
) -> Optional[dict]:
    """Return only an exact, already-durable idempotency outcome."""

    prepared = prepare_memory_store_request(
        content=content,
        memory_type=memory_type,
        tags=tags,
        metadata=metadata,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        idempotency_key=idempotency_key,
        operation_generation=operation_generation,
    )
    tenant, workspace = prepared["tenant"], prepared["workspace"]
    normalized_key = prepared["idempotency_key"]
    if not normalized_key:
        return None
    request_hash = prepared["request_hash"]
    record_metadata = prepared["record_metadata"]
    memory_id = str(uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"cortex:l22:{tenant}:{workspace}:{normalized_key}",
    ))
    principal_key = _memory_store_operation_principal_key(
        record_metadata, tenant, workspace
    )
    identity = _memory_store_operation_identity(
        tenant=tenant,
        workspace=workspace,
        memory_principal_key=principal_key,
        idempotency_key=normalized_key,
        memory_id=memory_id,
        request_hash=request_hash,
        fact_key=str(record_metadata.get("fact_key") or "").strip(),
        generation=operation_generation,
    )
    try:
        _prepare_memory_store_operation(identity)
        with _memory_store_publication(identity) as (operation_connection, operation_row):
            if str(operation_row["status"]) == "committed":
                return _durable_idempotent_result(identity)
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
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
                finally:
                    connection.close()
            if prior is not None:
                if str(prior["request_hash"]) != request_hash:
                    raise HTTPException(
                        status_code=409,
                        detail="idempotency_key was already used for a different memory write",
                    )
                replay = _durable_idempotent_result(identity)
                _commit_memory_store_operation(operation_connection, identity)
                return replay

            existing = collection.get(ids=[memory_id], include=["metadatas"])
            existing_ids = existing.get("ids") or []
            existing_metas = existing.get("metadatas") or []
            if memory_id not in existing_ids:
                return None
            result = _durable_idempotent_result(identity)
            _commit_memory_store_operation(operation_connection, identity)
            return result
    except MemoryStoreOperationCancelled as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except MemoryStoreOperationConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except MemoryStoreOperationError as exc:
        raise HTTPException(
            status_code=503, detail="memory store operation authority unavailable"
        ) from exc


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
    operation_generation: int = Field(0, ge=0, lt=2**63)

    _bounded_metadata = field_validator("metadata")(_validate_memory_metadata)


class L22StoreOperationRequest(BaseModel):
    idempotency_key: str = Field(..., min_length=1, max_length=256)
    expected_id: str = Field(..., min_length=1, max_length=256)
    fact_key: str = Field("", max_length=1024)
    operation_generation: int = Field(0, ge=0, lt=2**63)
    reason: str = Field("owner_source_deleted_or_revoked", min_length=1, max_length=240)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class L22SearchRequest(BaseModel):
    query: str = Field(..., max_length=16_384)
    n_results: int = Field(5, ge=1, le=100)
    filters: Optional[MemorySearchFilterRequest] = None
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
    filters: Optional[MemorySearchFilterRequest] = None
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class L22PrincipalHardDeleteRequest(BaseModel):
    confirmation: str = Field(
        ...,
        pattern=r"^HARD_DELETE_CORTEX_MEMORY$",
        description="Explicit destructive-action confirmation token.",
    )
    reason: str = Field("principal_requested_erasure", min_length=1, max_length=240)
    preserve_source_files: bool = True
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class L22ConflictRequest(BaseModel):
    memory_ids: List[str] = Field(..., min_length=1, max_length=200)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class L22VerificationRequest(BaseModel):
    memory_id: str = Field(..., min_length=1, max_length=256)
    source_revision: Optional[str] = Field(None, max_length=128)
    evidence: str = Field("exact_read_plus_semantic_exact_id", max_length=128)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class L22PromotionReviewRequest(BaseModel):
    memory_id: str = Field(..., min_length=1, max_length=256)
    approved: bool
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class L22RecallBenchmarkRequest(BaseModel):
    cases: List[dict] = Field(..., min_length=1, max_length=100)
    n_results: int = Field(5, ge=1, le=25)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)

    @field_validator("cases")
    @classmethod
    def _bounded_cases(cls, value: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        _validate_memory_metadata(value)  # shared bounded finite-JSON walk
        return value


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
        L22StoreOperationRequest,
        L22SearchRequest,
        L22NovelStoreRequest,
        L22NovelSearchRequest,
        L22PrincipalHardDeleteRequest,
        L22ConflictRequest,
        L22VerificationRequest,
        L22PromotionReviewRequest,
        L22RecallBenchmarkRequest,
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


def _store_operation_identity_for_principal(
    request: L22StoreOperationRequest,
    principal,
    http_request: Optional[Request],
) -> Dict[str, Any]:
    resolved_key = (
        request_memory_idempotency_key(http_request, request.idempotency_key)
        if http_request is not None
        else request.idempotency_key
    )
    expected_id = str(uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"cortex:l22:{principal.tenant_id}:{principal.storage_workspace_id}:{resolved_key}",
    ))
    if request.expected_id != expected_id:
        # Do not turn a guessed foreign operation ID into an existence oracle.
        raise HTTPException(
            status_code=403,
            detail="store operation identity does not belong to the authenticated principal",
        )
    return _memory_store_operation_identity(
        tenant=principal.tenant_id,
        workspace=principal.storage_workspace_id,
        memory_principal_key=principal.memory_principal_key,
        idempotency_key=resolved_key,
        memory_id=expected_id,
        fact_key=request.fact_key,
        generation=request.operation_generation,
    )


def _hard_delete_principal_memory(principal) -> Dict[str, Any]:
    """Converge every server-side Cortex memory projection for one principal."""

    governance = MemoryGovernanceStore()
    fence = governance.create_deletion_fence(principal.memory_principal_key)
    owner_lock_path = Path(
        os.getenv(
            "CORTEX_OWNER_MEMORY_RECEIPT_LOCK_PATH",
            "/var/lib/cortex/owner-file-index.lock",
        )
    )
    owner_lock_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with owner_lock_path.open("a+b") as owner_lock:
            fcntl.flock(owner_lock.fileno(), fcntl.LOCK_EX)
            return _hard_delete_principal_memory_locked(principal, governance, fence)
    except Exception as exc:
        # The fence intentionally survives a partial failure so an old replay
        # cannot resurrect data while a repeated request finishes convergence.
        raise MemoryDeletionError(
            "principal memory deletion is fenced but cross-store convergence is incomplete"
        ) from exc


def _hard_delete_principal_memory_locked(
    principal,
    governance: MemoryGovernanceStore,
    fence,
) -> Dict[str, Any]:
    counts: Dict[str, int] = {}
    try:
        counts.update(delete_principal_memory_projections(principal))

        with _STRUCTURED_MEMORY_LOCK:
            connection = _structured_memory_connection()
            try:
                connection.execute("BEGIN IMMEDIATE")
                quota_rows = connection.execute(
                    "SELECT * FROM l22_quota_records WHERE tenant_id = ? AND workspace_id = ?",
                    (principal.tenant_id, principal.storage_workspace_id),
                ).fetchall()
                for row in quota_rows:
                    _quota_release_row(connection, row)
                counts["quota_records"] = len(quota_rows)
                structured = connection.execute(
                    "DELETE FROM structured_memory WHERE tenant_id = ? AND workspace_id = ?",
                    (principal.tenant_id, principal.storage_workspace_id),
                )
                idempotency = connection.execute(
                    "DELETE FROM memory_idempotency WHERE tenant_id = ? AND workspace_id = ?",
                    (principal.tenant_id, principal.storage_workspace_id),
                )
                counts["structured_records"] = int(structured.rowcount or 0)
                counts["idempotency_records"] = int(idempotency.rowcount or 0)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()

        operation_connection = _memory_store_operation_connection()
        try:
            operation_connection.execute("BEGIN IMMEDIATE")
            deleted = operation_connection.execute(
                "DELETE FROM memory_store_operations WHERE tenant_id = ? "
                "AND workspace_id = ? AND memory_principal_key = ?",
                (
                    principal.tenant_id,
                    principal.storage_workspace_id,
                    principal.memory_principal_key,
                ),
            )
            counts["memory_store_operations"] = int(deleted.rowcount or 0)
            operation_connection.commit()
        except Exception:
            operation_connection.rollback()
            raise
        finally:
            operation_connection.close()

        assurance_path = Path(
            os.getenv(
                "NEXUS_ASSURANCE_RECEIPT_STATE_PATH",
                "/opt/clawdbot/state/nexus_assurance_receipts.sqlite3",
            )
        )
        codec_path = Path(
            os.getenv(
                "NEXUS_CODEC_EVENTS_IDEMPOTENCY_STATE_PATH",
                "/opt/clawdbot/state/nexus_codec_events_idempotency.sqlite3",
            )
        )
        counts["assurance_receipts"] = (
            delete_assurance_receipts_matching_scope(
                assurance_path,
                # Credential rotation must not strand receipts for the same
                # authenticated principal. Match stable scope/isolation fields,
                # not the currently presented credential ID.
                required_scope={
                    **principal.scope,
                    "storage_workspace_id": principal.storage_workspace_id,
                    "memory_principal_key": principal.memory_principal_key,
                },
            )
            if assurance_path.exists()
            else 0
        )
        counts["codec_event_receipts"] = (
            delete_assurance_receipts_matching_scope(
                codec_path,
                required_scope=principal.scope,
            )
            if codec_path.exists()
            else 0
        )
        counts.update(_delete_owner_index_receipt(principal, lock_held=True))
        return governance.purge_principal(fence, surface_counts=counts)
    except Exception as exc:
        # The fence intentionally survives a partial failure so an old replay
        # cannot resurrect data while a repeated request finishes convergence.
        raise MemoryDeletionError(
            "principal memory deletion is fenced but cross-store convergence is incomplete"
        ) from exc


def _delete_owner_index_receipt(
    principal, *, lock_held: bool = False
) -> Dict[str, int]:
    """Delete principal-bound owner-index replay state, never source files."""

    receipt_path = Path(
        os.getenv(
            "CORTEX_OWNER_MEMORY_RECEIPT_PATH",
            "/var/lib/cortex/owner-file-index-20260927.json",
        )
    )
    lock_path = Path(
        os.getenv(
            "CORTEX_OWNER_MEMORY_RECEIPT_LOCK_PATH",
            "/var/lib/cortex/owner-file-index.lock",
        )
    )
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    deleted_receipts = 0
    deleted_temporary = 0
    lock_context = nullcontext(None) if lock_held else lock_path.open("a+b")
    with lock_context as lock_file:
        if lock_file is not None:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        expected_scope_digest = sha256(
            json.dumps(
                principal.scope,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            ).encode("utf-8")
        ).hexdigest()

        def receipt_belongs_to_principal(candidate: Path) -> bool:
            if candidate.is_symlink() or not candidate.is_file():
                raise MemoryDeletionError("owner index receipt is not a regular file")
            raw = candidate.read_bytes()
            if len(raw) > 2 * 1024 * 1024:
                raise MemoryDeletionError("owner index receipt exceeds its byte bound")
            try:
                receipt = json.loads(raw)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise MemoryDeletionError("owner index receipt is invalid") from exc
            if not isinstance(receipt, dict):
                raise MemoryDeletionError("owner index receipt is invalid")
            stored_scope_digest = str(receipt.get("scopeDigest") or "")
            has_state = any(
                bool(receipt.get(field))
                for field in ("accepted", "pending", "retired", "sources")
            )
            if not stored_scope_digest and has_state:
                raise MemoryDeletionError(
                    "owner index receipt has unproven principal state"
                )
            return not stored_scope_digest or stored_scope_digest == expected_scope_digest

        if receipt_path.is_symlink():
            raise MemoryDeletionError("owner index receipt is not a regular file")
        if receipt_path.exists() and receipt_belongs_to_principal(receipt_path):
            receipt_path.unlink()
            deleted_receipts = 1

        entries = list(receipt_path.parent.iterdir())
        if len(entries) > 4096:
            raise MemoryDeletionError("owner index receipt directory exceeds its inode bound")
        temporary_prefix = f".{receipt_path.name}.tmp-"
        for candidate in entries:
            if not candidate.name.startswith(temporary_prefix):
                continue
            if receipt_belongs_to_principal(candidate):
                candidate.unlink()
                deleted_temporary += 1
        directory_fd = os.open(receipt_path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    return {
        "owner_index_receipts": deleted_receipts,
        "owner_index_temporary_receipts": deleted_temporary,
    }


def _store_operation_public_payload(row: Optional[Dict[str, Any]], identity: Dict[str, Any]) -> Dict[str, Any]:
    if row is None:
        return {
            "known": False,
            "status": "unknown",
            "id": identity["memory_id"],
            "operation_generation": identity["generation"],
            "visibility_fenced": False,
            "projection_status": "unknown",
        }
    status = str(row.get("status") or "unknown")
    projection = str(row.get("projection_status") or "not_required")
    return {
        "known": True,
        "status": status,
        "id": identity["memory_id"],
        "operation_generation": int(row.get("generation") or 0),
        "visibility_fenced": status in {"committed", "cancelled"},
        "projection_status": projection,
        "reason": str(row.get("reason") or "") or None,
        "updated_at": row.get("updated_at"),
    }


def _cancel_projection_transaction_id(identity: Dict[str, Any]) -> str:
    material = "\0".join((
        identity["tenant_id"], identity["workspace_id"],
        identity["memory_principal_key"], identity["idempotency_key"],
        identity["memory_id"], str(identity["generation"]),
    ))
    return "cancel-" + sha256(material.encode("utf-8")).hexdigest()


def _project_cancelled_memory_store_operation(
    identity: Dict[str, Any], *, reason: str, credential_id: str
) -> Dict[str, Any]:
    operation = _get_memory_store_operation(identity)
    if operation is None or str(operation.get("status") or "") != "cancelled":
        raise MemoryStoreOperationError(
            "memory store cancellation is not durably fenced"
        )
    # Cancellation retries use a deterministic transaction ID. Bind every
    # projected byte to the first durable cancellation timestamp as well, so a
    # crash after either store is updated can replay the same quota marker and
    # fallback tombstone instead of conflicting with a fresh timestamp.
    retired_at = str(
        operation.get("updated_at") or operation.get("created_at") or ""
    ).strip()
    if not retired_at:
        raise MemoryStoreOperationError(
            "memory store cancellation has no durable projection timestamp"
        )
    supersede_memory_records(
        [identity["memory_id"]],
        reason=reason,
        tenant_id=identity["tenant_id"],
        workspace_id=identity["workspace_id"],
        quota_credential_id=credential_id,
        memory_principal_key=identity["memory_principal_key"],
        transaction_id=_cancel_projection_transaction_id(identity),
        durable_tombstone=True,
        operation_generation=identity["generation"],
        retired_at=retired_at,
    )
    return _complete_memory_store_cancellation(identity)


def _l22_status_payload(principal) -> Dict[str, Any]:
    semantic = bounded_principal_metadata_probe(
        collection,
        where=principal_memory_where(principal),
        principal_key=principal.memory_principal_key,
        max_rows=_L22_HEALTH_PRINCIPAL_SCAN_MAX_ROWS,
    )
    semantic_ready = bool(semantic.get("available"))
    semantic_error = None
    if not semantic_ready:
        semantic_error = "semantic_memory_backend_unavailable"
        logger.warning("L22 semantic status probe failed")

    structured_error = None
    try:
        structured_records = list_structured_memory_records(
            memory_type="codec_state",
            lookup_key=principal.codec_session_key,
            limit=_L22_HEALTH_STRUCTURED_MAX_ROWS,
            tenant_id=principal.tenant_id,
            workspace_id=principal.storage_workspace_id,
        )
        # Preserve the accumulated backend-readiness check without restoring an
        # unbounded COUNT scan. The bounded session lookup above remains the
        # only structured metric exposed to the caller.
        count_structured_memory_records(
            tenant_id=principal.tenant_id,
            workspace_id=principal.storage_workspace_id,
            limit=_L22_HEALTH_STRUCTURED_MAX_ROWS,
        )
        structured_memory_count = len(structured_records)
        structured_ready = True
    except Exception as exc:
        structured_memory_count = None
        structured_ready = False
        structured_error = "structured_memory_backend_unavailable"
        logger.warning("L22 structured status probe failed: %s", type(exc).__name__)

    scope_auth_ready = _memory_scope_auth_ready()
    active = scope_auth_ready and semantic_ready and structured_ready
    any_backend_ready = semantic_ready or structured_ready
    status = (
        "active"
        if active
        else "degraded"
        if scope_auth_ready and any_backend_ready
        else "unavailable"
    )
    payload = {
        "success": active,
        "level": 22,
        "name": "Mnemosyne",
        "status": status,
        "checks": {
            "semantic_memory": {
                "ok": semantic_ready,
                "count": semantic.get("count"),
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
            "temporal_truth",
            "privacy_admission",
            "principal_hard_delete",
            "typed_pre_retrieval_filters",
            "fact_conflict_edges",
            "review_gated_promotion",
            "recall_evaluation",
        ],
        "memory_count": semantic.get("count"),
        "memory_count_is_lower_bound": bool(semantic.get("countIsLowerBound")),
        "memory_scan_limit": semantic.get("scanLimit"),
        "structured_memory_count": structured_memory_count,
        "structured_memory_scan_limit": _L22_HEALTH_STRUCTURED_MAX_ROWS,
        "principal_scoped": True,
        "aggregate_storage_metrics": "withheld",
        "structured_memory_backend": "l22_structured_sqlite_v1",
        "scope_auth_ready": scope_auth_ready,
        "novelty_version": "l7l22.v1.1",
    }
    if semantic_error:
        payload["semantic_memory_error"] = semantic_error
    return payload


def _l22_probe_failure(error: BaseException) -> Dict[str, Any]:
    if isinstance(error, HealthProbeTimedOut):
        probe_status = "timeout"
    elif isinstance(error, HealthProbeBusy):
        probe_status = "busy"
    else:
        probe_status = "error"
    return {
        "success": False,
        "level": 22,
        "name": "Mnemosyne",
        "status": "unavailable",
        "memory_count": None,
        "structured_memory_count": None,
        "principal_scoped": True,
        "aggregate_storage_metrics": "withheld",
        "scope_auth_ready": _memory_scope_auth_ready(),
        "probe_status": probe_status,
        "error": f"health_probe_{probe_status}:{type(error).__name__}",
    }


@router.get("/status")
async def l22_status(http_request: Request):
    principal = memory_principal_for_request(http_request)
    try:
        return await _L22_STATUS_PROBE.run(
            key=principal.memory_principal_key,
            function=lambda: _l22_status_payload(principal),
            timeout_seconds=_l22_health_probe_timeout_seconds(),
        )
    except Exception as exc:
        return _l22_probe_failure(exc)


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
        operation_generation=request.operation_generation,
    )


@router.post("/store/status")
async def l22_store_status(
    request: L22StoreOperationRequest,
    http_request: Request = None,
):
    principal = _route_memory_principal(request, http_request)
    identity = _store_operation_identity_for_principal(
        request, principal, http_request
    )
    try:
        row = _get_memory_store_operation(identity)
        if (
            row is not None
            and str(row.get("status")) == "cancelled"
            and str(row.get("projection_status")) != "complete"
        ):
            try:
                row = _project_cancelled_memory_store_operation(
                    identity,
                    reason=str(row.get("reason") or request.reason),
                    credential_id=principal.credential_id,
                )
            except Exception:
                # The durable fence is still authoritative. Report incomplete
                # physical convergence honestly and let a repeated status or
                # cancel resume the actionable journal.
                row = _get_memory_store_operation(identity)
        return _store_operation_public_payload(row, identity)
    except MemoryStoreOperationConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except MemoryStoreOperationError as exc:
        raise HTTPException(
            status_code=503,
            detail="memory store operation authority unavailable",
        ) from exc


@router.post("/store/cancel")
async def l22_cancel_store(
    request: L22StoreOperationRequest,
    http_request: Request = None,
):
    principal = _route_memory_principal(request, http_request)
    identity = _store_operation_identity_for_principal(
        request, principal, http_request
    )
    try:
        row = _cancel_memory_store_operation(identity, reason=request.reason)
    except MemoryStoreOperationConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except MemoryStoreOperationError as exc:
        raise HTTPException(
            status_code=503,
            detail="memory store cancellation authority unavailable",
        ) from exc
    if str(row.get("projection_status") or "") == "complete":
        return _store_operation_public_payload(row, identity)
    try:
        row = _project_cancelled_memory_store_operation(
            identity,
            reason=str(row.get("reason") or request.reason),
            credential_id=principal.credential_id,
        )
    except Exception as exc:
        # Cancellation already won the durable visibility fence. Do not claim
        # cross-store convergence until the journal has replayed both targets.
        raise HTTPException(
            status_code=503,
            detail="memory store cancelled; cross-store recovery remains pending",
        ) from exc
    return _store_operation_public_payload(row, identity)


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
    governance_operation_id = "l22-novel:" + memory_id
    try:
        metadata = prepare_governed_memory_write(
            principal_key=principal.memory_principal_key,
            content=request.content,
            metadata=_normalize_memory_metadata(
                metadata, tenant_id=tenant, workspace_id=workspace
            ),
            operation_id=governance_operation_id,
        )
    except MemoryAdmissionRejected as exc:
        raise HTTPException(status_code=422, detail=exc.decision.public_dict()) from exc
    except MemoryGovernanceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
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
        finalize_governed_memory_write(
            principal_key=principal.memory_principal_key,
            memory_id=memory_id,
            content=request.content,
            metadata=result["metadata"],
            operation_id=governance_operation_id,
            receipt_id=memory_id,
        )
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


@router.post("/delete-principal")
async def l22_delete_principal_memory(
    request: L22PrincipalHardDeleteRequest,
    http_request: Request = None,
):
    """Hard-delete Cortex projections while preserving owner source files."""

    if request.preserve_source_files is not True:
        raise HTTPException(
            status_code=422,
            detail="source-file deletion is a separate explicit filesystem action",
        )
    principal = _route_memory_principal(request, http_request)
    try:
        result = _hard_delete_principal_memory(principal)
    except MemoryDeletionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        **result,
        "source_files_preserved": True,
        "client_spool_purge_required": True,
        "truth_boundary": (
            "Server projections, caches, ledgers, and replay state are deleted and "
            "fenced. The calling bridge must purge its encrypted local spool before "
            "claiming client-side convergence."
        ),
    }


@router.post("/facts/conflicts")
async def l22_fact_conflicts(
    request: L22ConflictRequest,
    http_request: Request = None,
):
    principal = _route_memory_principal(request, http_request)
    requested_ids = list(dict.fromkeys(str(item) for item in request.memory_ids))
    found = collection.get(
        ids=requested_ids,
        where=principal_memory_where(principal),
        include=["metadatas"],
    )
    found_ids = [str(item) for item in (found.get("ids") or [])]
    if set(found_ids) != set(requested_ids):
        raise HTTPException(status_code=404, detail="one or more memory records are unavailable")
    projection = MemoryGovernanceStore().conflict_projection(
        principal_key=principal.memory_principal_key,
        memory_ids=found_ids,
    )
    return {"records": projection, "count": len(projection)}


@router.post("/verify")
async def l22_mark_memory_verified(
    request: L22VerificationRequest,
    http_request: Request = None,
):
    principal = _route_memory_principal(request, http_request)
    found = collection.get(
        ids=[request.memory_id],
        where=principal_memory_where(principal),
        include=["documents", "metadatas"],
    )
    ids = found.get("ids") or []
    documents = found.get("documents") or []
    metadatas = found.get("metadatas") or []
    if ids != [request.memory_id] or len(documents) != 1 or len(metadatas) != 1:
        raise HTTPException(status_code=404, detail="memory record is unavailable")
    metadata = dict(metadatas[0] or {})
    if request.source_revision and str(metadata.get("source_revision") or "") != request.source_revision:
        raise HTTPException(status_code=409, detail="source revision does not match the record")
    verified_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )
    metadata = refresh_temporal_verification(metadata, verified_at=verified_at)
    metadata["verification_evidence"] = request.evidence
    collection.update(ids=[request.memory_id], metadatas=[metadata])
    fact_projection = MemoryGovernanceStore().record_fact(
        principal_key=principal.memory_principal_key,
        memory_id=request.memory_id,
        content=str(documents[0] or ""),
        metadata=metadata,
    )
    return {
        "id": request.memory_id,
        "last_verified_at": verified_at,
        "source_revision": metadata.get("source_revision"),
        "evidence": request.evidence,
        "fact_winner_id": (
            fact_projection.active_winner_id if fact_projection is not None else None
        ),
    }


@router.get("/promotions")
async def l22_list_promotions(
    http_request: Request,
    status: Optional[str] = Query(None, max_length=32),
    limit: int = Query(100, ge=1, le=500),
):
    principal = memory_principal_for_request(http_request)
    try:
        records = MemoryGovernanceStore().list_promotions(
            principal_key=principal.memory_principal_key,
            status=status,
            limit=limit,
        )
    except MemoryPromotionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"records": records, "count": len(records), "review_required": True}


@router.post("/promotions/review")
async def l22_review_promotion(
    request: L22PromotionReviewRequest,
    http_request: Request = None,
):
    principal = _route_memory_principal(request, http_request)
    found = collection.get(
        ids=[request.memory_id],
        where=principal_memory_where(principal),
        include=["documents", "metadatas"],
    )
    ids = found.get("ids") or []
    documents = found.get("documents") or []
    metadatas = found.get("metadatas") or []
    if ids != [request.memory_id] or len(documents) != 1 or len(metadatas) != 1:
        raise HTTPException(status_code=404, detail="promotion candidate is unavailable")
    store = MemoryGovernanceStore()
    try:
        current_metadata = dict(metadatas[0] or {})
        if request.approved:
            memory_status = str(
                current_metadata.get("memory_status")
                or current_metadata.get("status")
                or "active"
            ).strip().casefold()
            conflict = store.conflict_projection(
                principal_key=principal.memory_principal_key,
                memory_ids=[request.memory_id],
            ).get(request.memory_id)
            if memory_status != "active" or (
                conflict is not None and conflict.get("fact_status") != "active"
            ):
                raise MemoryPromotionError(
                    "only the current active fact may be approved"
                )
        review = store.review_promotion(
            principal_key=principal.memory_principal_key,
            memory_id=request.memory_id,
            approved=request.approved,
            reviewer=principal.credential_id,
        )
        if request.approved:
            metadata = refresh_temporal_verification(
                current_metadata,
                verified_at=review["reviewed_at"],
            )
            try:
                prior_authority = int(metadata.get("authority_rank", 0))
            except (TypeError, ValueError):
                prior_authority = 0
            metadata.update(
                {
                    "candidate_fact": False,
                    "quality": "curated",
                    "independently_verified": True,
                    "operator_reviewed": True,
                    "authority_rank": max(70, min(100, prior_authority)),
                    "promoted_at": review["reviewed_at"],
                    "promotion_reviewer": principal.credential_id,
                }
            )
            collection.update(ids=[request.memory_id], metadatas=[metadata])
            store.record_fact(
                principal_key=principal.memory_principal_key,
                memory_id=request.memory_id,
                content=str(documents[0] or ""),
                metadata=metadata,
            )
            store.mark_promoted(
                principal_key=principal.memory_principal_key,
                memory_id=request.memory_id,
            )
            review["status"] = "promoted"
    except MemoryPromotionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except MemoryGovernanceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return review


@router.post("/recall/evaluate")
async def l22_evaluate_recall(
    request: L22RecallBenchmarkRequest,
    http_request: Request = None,
):
    """Run bounded, principal-scoped owner-question recall evaluation."""

    principal = _route_memory_principal(request, http_request)
    results: Dict[str, List[Dict[str, Any]]] = {}
    normalized_cases: List[Dict[str, Any]] = []
    seen_case_ids: set[str] = set()
    allowed_case_fields = {
        "id",
        "query",
        "filters",
        "expected_ids",
        "expected_source_ids",
        "expected_source_paths",
        "expected_fact_keys",
        "forbidden_source_ids",
        "forbidden_source_paths",
        "forbidden_projects",
        "expected_winner_id",
        "expected_winner_fact_key",
    }
    for raw_case in request.cases:
        case = dict(raw_case)
        case_id = str(case.get("id") or "").strip()
        query = str(case.get("query") or "").strip()
        if (
            not case_id
            or case_id in seen_case_ids
            or len(case_id.encode("utf-8")) > 256
            or not query
            or len(query.encode("utf-8")) > 16_384
            or set(case) - allowed_case_fields
        ):
            raise HTTPException(status_code=422, detail="recall case id/query is invalid")
        if (
            redact_sensitive_text(case_id) != case_id
            or redact_sensitive_text(query) != query
        ):
            raise HTTPException(
                status_code=422,
                detail="recall case failed the no-sensitive-data admission gate",
            )
        for winner_field in ("expected_winner_id", "expected_winner_fact_key"):
            winner_value = case.get(winner_field)
            if winner_value is not None and (
                not isinstance(winner_value, str)
                or not winner_value.strip()
                or len(winner_value.encode("utf-8")) > 512
            ):
                raise HTTPException(
                    status_code=422,
                    detail=f"recall case {winner_field} is invalid",
                )
        if case.get("expected_winner_id") and case.get("expected_winner_fact_key"):
            raise HTTPException(
                status_code=422,
                detail="recall case may declare only one expected contradiction winner",
            )
        for list_field in allowed_case_fields - {
            "id",
            "query",
            "filters",
            "expected_winner_id",
            "expected_winner_fact_key",
        }:
            values = case.get(list_field) or []
            if (
                not isinstance(values, list)
                or len(values) > 128
                or any(
                    not isinstance(item, str)
                    or not item.strip()
                    or len(item.encode("utf-8")) > 512
                    for item in values
                )
            ):
                raise HTTPException(
                    status_code=422,
                    detail=f"recall case {list_field} is invalid",
                )
        seen_case_ids.add(case_id)
        try:
            filters = parse_memory_search_filters(case.get("filters"))
            outcome = robust_search(
                query=query,
                n_results=request.n_results,
                allow_fallback=True,
                tenant_id=principal.tenant_id,
                workspace_id=principal.storage_workspace_id,
                memory_principal_key=principal.memory_principal_key,
                filters=filters,
            )
        except MemoryFilterError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except MemoryGovernanceError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        rows = [dict(row) for row in (outcome.get("results") or [])]
        if rows:
            rows[0]["selected_answer"] = True
        results[case_id] = rows
        normalized_cases.append(case)
    evaluation = evaluate_recall(normalized_cases, results).as_dict()
    return {
        "evaluation": evaluation,
        "result_counts": {key: len(value) for key, value in results.items()},
        "truth_boundary": (
            "These metrics describe only the submitted principal-scoped cases and "
            "current retrieval path; they do not prove global recall quality."
        ),
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
    try:
        result = robust_search(
            query=request.query,
            n_results=request.n_results,
            allow_fallback=True,
            tenant_id=tenant,
            workspace_id=workspace,
            memory_principal_key=principal.memory_principal_key,
            filters=parse_memory_search_filters(request.filters),
        )
    except MemoryFilterError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MemoryGovernanceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
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
    try:
        ranked = search_with_novelty(
            query=request.query,
            n_results=request.n_results,
            novelty_weight=request.novelty_weight,
            semantic_weight=request.semantic_weight,
            min_novelty=request.min_novelty,
            tenant_id=tenant,
            workspace_id=workspace,
            memory_principal_key=principal.memory_principal_key,
            filters=parse_memory_search_filters(request.filters),
        )
    except MemoryFilterError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MemoryGovernanceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "query": request.query,
        "novelty_weight": ranked.get("novelty_weight"),
        "semantic_weight": ranked.get("semantic_weight"),
        "results": ranked.get("results", []),
    }
