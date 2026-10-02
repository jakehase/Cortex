"""The Librarian - Vector Memory Plugin for The Cortex.

Provides semantic memory storage and retrieval using ChromaDB.
Includes novelty-aware indexing and retrieval helpers used by L7/L22.
Adds resilient fallback recall paths when embedding providers fail.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from typing import Annotated, List, Optional, Dict, Any
import asyncio
import importlib
import inspect
import uuid
import os as _stdlib_os
import stat
import shutil
import re
import json
import logging
import threading
import fcntl
from contextlib import contextmanager
from hashlib import sha256
from datetime import datetime, timezone
from pathlib import Path
from dataclasses import asdict

from cortex_server.modules import runtime_pressure
from cortex_server.modules.memory_scope import (
    AuthenticatedMemoryPrincipal,
    MemoryScopeAuthError,
    PRINCIPAL_FIELDS,
    authenticate_memory_principal,
    memory_principal_for_request,
    principal_memory_where,
    require_authenticated_memory_principal,
    scoped_memory_metadata,
)
from cortex_server.construction import (
    construction_config,
    runtime_construction_active,
)
from cortex_server.runtime.memory_governance import (
    MemoryAdmissionRejected,
    MemoryDeletionError,
    MemoryFilterError,
    MemoryGovernanceError,
    MemoryGovernanceStore,
    MemorySearchFilters,
    canonical_json,
    canonical_value_hash,
    compile_chroma_where,
    normalize_filterable_metadata,
    parse_timestamp,
    row_matches_filters,
    sha256_text,
    temporal_visibility,
)


class _OSFacade:
    """Keep fault-injection of Librarian filesystem calls module-local.

    Tests and health probes replace ``librarian.os.open`` to model permission
    failures. Mutating the process-global ``os.open`` can also break asyncio's
    wakeup pipe while a status request is running, so expose a narrow facade
    whose attributes can be replaced without altering the interpreter module.
    """

    open = staticmethod(_stdlib_os.open)

    def __getattr__(self, name: str):
        return getattr(_stdlib_os, name)


os = _OSFacade()

router = APIRouter(dependencies=[Depends(require_authenticated_memory_principal)])
logger = logging.getLogger(__name__)


class _LazyChromaModule:
    """Import Chroma only when the runtime backend is explicitly resolved."""

    def __getattr__(self, name: str):
        return getattr(importlib.import_module("chromadb"), name)


chromadb = _LazyChromaModule()


def build_embedding_function():
    from cortex_server.modules.librarian_embedding import (
        build_embedding_function as build_runtime_embedding_function,
    )

    return build_runtime_embedding_function()

# Initialize ChromaDB client with persistent storage
# Use host-mounted /app path for durability across container rebuilds.
LEGACY_CHROMA_DIR = "/root/cortex_server/chroma_db"
CHROMA_DATABASE_NAME = "chroma.sqlite3"
CHROMA_AUTHORITY_SENTINEL = ".cortex-memory-authority"
CHROMA_AUTHORITY_SCHEMA = "cortex.memory-authority.v1"
COLLECTION_NAME = "cortex_memory"
READINESS_COLLECTION_NAME = "cortex-durability-readiness"


def _production_memory_mode() -> bool:
    # This predicate is also used by request handlers and readiness probes
    # after the application-construction context has exited.  Read the live
    # environment here; schema-only construction still receives deterministic
    # defaults because construction.py temporarily masks os.getenv.
    environment = str(
        os.getenv(
            "CORTEX_ENV",
            os.getenv("CORTEX_ENVIRONMENT", "development"),
        )
    ).strip().lower()
    strict = str(os.getenv("CORTEX_REQUIRE_DURABLE_MEMORY", "")).strip().lower()
    return environment in {"production", "prod", "staging"} or strict in {"1", "true", "yes", "on"}


def _default_chroma_dir() -> str:
    if not runtime_construction_active():
        return "/tmp/cortex-schema-inventory/chroma_db"
    configured = construction_config("CORTEX_CHROMA_DIR")
    if configured:
        path = Path(configured).expanduser()
        if not path.is_absolute():
            raise RuntimeError("CORTEX_CHROMA_DIR must be an absolute durable path")
        return str(path)
    if _production_memory_mode():
        raise RuntimeError("CORTEX_CHROMA_DIR is required for durable production memory")
    isolated_graph_path = str(construction_config("CORTEX_DB_PATH", "")).strip()
    if isolated_graph_path:
        graph_path = Path(isolated_graph_path).expanduser()
        if graph_path.is_absolute():
            return str(graph_path.parent / "chroma_db")
    preferred = Path("/app/cortex_server/chroma_db")
    existing_parent = next(
        (
            candidate
            for candidate in (preferred.parent, *preferred.parents)
            if candidate.exists()
        ),
        None,
    )
    if existing_parent is not None and os.access(str(existing_parent), os.W_OK):
        return str(preferred)
    return str(Path.home() / ".cache" / "cortex_server" / "chroma_db")


def _chroma_authority_binding(mount_id: str) -> str:
    return f"{CHROMA_AUTHORITY_SCHEMA}:{mount_id}:{COLLECTION_NAME}"

CHROMA_DIR = _default_chroma_dir()


def _validate_chroma_storage(path_value: str) -> None:
    path = Path(path_value)
    try:
        if _production_memory_mode():
            if path.is_symlink() or not path.is_dir():
                raise RuntimeError("configured Cortex memory volume is missing or invalid")
            expected_mount_id = os.getenv("CORTEX_CHROMA_MOUNT_ID", "").strip()
            marker_name = os.getenv(
                "CORTEX_CHROMA_MOUNT_MARKER", ".cortex-durable-memory"
            ).strip()
            if (
                not expected_mount_id
                or not marker_name
                or Path(marker_name).name != marker_name
            ):
                raise RuntimeError(
                    "CORTEX_CHROMA_MOUNT_ID and a safe mount marker are required in production"
                )
            marker_path = path / marker_name
            if (
                marker_path.is_symlink()
                or not marker_path.is_file()
                or marker_path.read_text(encoding="utf-8").strip() != expected_mount_id
            ):
                raise RuntimeError("configured Cortex memory mount identity does not match")
            authority_path = path / CHROMA_AUTHORITY_SENTINEL
            if (
                authority_path.is_symlink()
                or not authority_path.is_file()
                or authority_path.read_text(encoding="utf-8").strip()
                != _chroma_authority_binding(expected_mount_id)
            ):
                raise RuntimeError("configured Cortex memory authority is missing or mismatched")
            database_path = path / CHROMA_DATABASE_NAME
            if database_path.is_symlink() or not database_path.is_file():
                raise RuntimeError("configured Cortex memory authority database is missing or invalid")
        else:
            path.mkdir(parents=True, exist_ok=True)
        probe = path / f".cortex-durability-probe-{uuid.uuid4().hex}"
        descriptor = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            os.write(descriptor, b"durable-memory-probe\n")
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        probe.unlink()
        if _production_memory_mode():
            directory_descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"configured Cortex memory path is not durably writable: {path}") from exc


def _load_memory_collection(chroma_client, embedding_function):
    if _production_memory_mode():
        return chroma_client.get_collection(
            name=COLLECTION_NAME,
            embedding_function=embedding_function,
        )
    return chroma_client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=embedding_function,
    )


class _MemoryBackend:
    def __init__(self, chroma_client, embedding_function, memory_collection):
        self.client = chroma_client
        self.embed_fn = embedding_function
        self.collection = memory_collection


_MEMORY_BACKEND: Optional[_MemoryBackend] = None
_MEMORY_BACKEND_LOCK = threading.Lock()


def get_memory_backend() -> _MemoryBackend:
    """Construct the persistent Chroma dependencies at a runtime boundary."""

    global _MEMORY_BACKEND
    if _MEMORY_BACKEND is not None:
        return _MEMORY_BACKEND
    with _MEMORY_BACKEND_LOCK:
        if _MEMORY_BACKEND is None:
            if os.path.exists(LEGACY_CHROMA_DIR) and not os.path.exists(CHROMA_DIR):
                try:
                    shutil.copytree(LEGACY_CHROMA_DIR, CHROMA_DIR)
                except Exception:
                    pass
            _validate_chroma_storage(CHROMA_DIR)
            chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
            # Keep one embedding function so ONNX sessions are not recreated
            # for every semantic lookup.
            embedding_function = build_embedding_function()
            memory_collection = _load_memory_collection(
                chroma_client, embedding_function
            )
            _MEMORY_BACKEND = _MemoryBackend(
                chroma_client, embedding_function, memory_collection
            )
        return _MEMORY_BACKEND


class _LazyMemoryResource:
    """Compatibility facade for callers importing the historical globals."""

    def __init__(self, attribute: str):
        self._attribute = attribute

    def resolve(self):
        return getattr(get_memory_backend(), self._attribute)

    def __getattr__(self, name: str):
        return getattr(self.resolve(), name)

    def __call__(self, *args, **kwargs):
        return self.resolve()(*args, **kwargs)

    def _dispatch(self, method: str, *args, **kwargs):
        resource = self.resolve()
        if self._attribute == "collection":
            return _dispatch_memory_storage(resource, method, args, kwargs)
        return getattr(resource, method)(*args, **kwargs)

    # Declare the Chroma surface explicitly so monkeypatching a historical
    # global method does not resolve persistence merely to inspect the old
    # attribute. Instance-level test/operator overrides still take precedence.
    def add(self, *args, **kwargs):
        return self._dispatch("add", *args, **kwargs)

    def count(self, *args, **kwargs):
        return self._dispatch("count", *args, **kwargs)

    def delete(self, *args, **kwargs):
        return self._dispatch("delete", *args, **kwargs)

    def get(self, *args, **kwargs):
        return self._dispatch("get", *args, **kwargs)

    def get_collection(self, *args, **kwargs):
        return self._dispatch("get_collection", *args, **kwargs)

    def get_or_create_collection(self, *args, **kwargs):
        return self._dispatch("get_or_create_collection", *args, **kwargs)

    def query(self, *args, **kwargs):
        return self._dispatch("query", *args, **kwargs)

    def update(self, *args, **kwargs):
        return self._dispatch("update", *args, **kwargs)

    def upsert(self, *args, **kwargs):
        return self._dispatch("upsert", *args, **kwargs)


client = _LazyMemoryResource("client")
embed_fn = _LazyMemoryResource("embed_fn")
collection = _LazyMemoryResource("collection")

_FALLBACK_LOG_PATH = Path(construction_config("LIBRARIAN_FALLBACK_LOG_PATH", f"{CHROMA_DIR}/librarian_fallback.jsonl"))
_FALLBACK_MAX_BYTES = int(construction_config("LIBRARIAN_FALLBACK_MAX_BYTES", str(16 * 1024 * 1024)))
_FALLBACK_MAX_ROWS = int(construction_config("LIBRARIAN_FALLBACK_MAX_ROWS", "5000"))
_FALLBACK_MAX_ROW_BYTES = int(construction_config("LIBRARIAN_FALLBACK_MAX_ROW_BYTES", str(1100 * 1024)))
_FALLBACK_READ_MAX_BYTES = int(construction_config("LIBRARIAN_FALLBACK_READ_MAX_BYTES", str(4 * 1024 * 1024)))
_LOCAL_FILE_MEMORY_ROOTS_ENV = "LIBRARIAN_LOCAL_FILE_MEMORY_ROOTS"
_SCOPED_LOCAL_FILE_MEMORY_ROOTS_ENV = "LIBRARIAN_SCOPED_LOCAL_FILE_MEMORY_ROOTS"
_DEFAULT_LOCAL_FILE_MEMORY_ROOTS = (
    "/root/clawd/memory",
    "/root/clawd/clients",
)
_LOCAL_FILE_MEMORY_EXTENSIONS = {".md", ".txt"}
_LOCAL_FILE_MEMORY_MAX_FILES = int(construction_config("LIBRARIAN_LOCAL_FILE_MAX_FILES", "900"))
_LOCAL_FILE_MEMORY_MAX_BYTES = int(construction_config("LIBRARIAN_LOCAL_FILE_MAX_BYTES", str(768 * 1024)))
_LOCAL_FILE_MEMORY_MIN_SCORE = float(construction_config("LIBRARIAN_LOCAL_FILE_MIN_SCORE", "0.18"))
_LOW_SIGNAL_LOCAL_MEMORY_QUERY_TOKENS = {
    "what", "when", "where", "which", "who", "why", "how",
    "should", "could", "would", "about", "with", "from", "into", "under", "over",
    "for", "and", "the", "but", "not", "are", "was", "has", "had", "have",
    "this", "that", "there", "their", "they", "them", "were", "been", "being",
    "please", "tell", "find", "search", "look", "check", "need", "want",
    "jake", "cortex", "assistant",
}
_EMBEDDING_HEALTH_LOCK = threading.Lock()
_FACT_SUPERSESSION_LOCK = threading.RLock()
_FALLBACK_STORE_LOCK = threading.RLock()
_EMBEDDING_HEALTH: Dict[str, Any] = {
    "status": "ok",
    "last_error": "",
    "last_error_at": "",
    "fallback_writes": 0,
    "fallback_searches": 0,
}
_COLLECTION_HEALTH_TIMEOUT_SECONDS = 1.0

MAX_MEMORY_SCOPE_ID_LENGTH = 128
_MEMORY_SCOPE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$")
DEFAULT_TENANT_ID = str(construction_config("CORTEX_DEFAULT_TENANT_ID", "cortex-local")).strip() or "cortex-local"
DEFAULT_WORKSPACE_ID = str(construction_config("CORTEX_DEFAULT_WORKSPACE_ID", "default")).strip() or "default"
MemoryScopeId = Annotated[str, Field(min_length=1, max_length=MAX_MEMORY_SCOPE_ID_LENGTH, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:@/-]*$")]


class FactSupersessionError(RuntimeError):
    """A new fact was removed because prior versions could not be superseded."""


class FallbackPersistenceError(RuntimeError):
    """The bounded fallback store could not durably commit a memory row."""


class _RetirementJournalCleanupPending(FactSupersessionError):
    """Both retirement projections committed but journal cleanup remains."""


_ACTIVE_LIFECYCLE_STALE_FIELDS = frozenset({
    "tombstoned",
    "tombstoned_at",
    "supersession_pending",
    "superseded",
    "superseded_at",
    "superseded_by",
    "supersession_reason",
})


def _normalize_scope_id(value: Optional[str], *, field: str, default: str) -> str:
    normalized = str(value if value is not None else default).strip()
    if not _MEMORY_SCOPE_RE.fullmatch(normalized):
        raise ValueError(f"{field} must be a bounded opaque identifier")
    return normalized


def _memory_scope(tenant_id: Optional[str] = None, workspace_id: Optional[str] = None) -> tuple[str, str]:
    return (
        _normalize_scope_id(tenant_id, field="tenant_id", default=DEFAULT_TENANT_ID),
        _normalize_scope_id(workspace_id, field="workspace_id", default=DEFAULT_WORKSPACE_ID),
    )


def _scope_key(tenant_id: str, workspace_id: str) -> str:
    return sha256(f"{tenant_id}\0{workspace_id}".encode("utf-8")).hexdigest()


def _is_default_scope(tenant_id: str, workspace_id: str) -> bool:
    return tenant_id == DEFAULT_TENANT_ID and workspace_id == DEFAULT_WORKSPACE_ID


def _metadata_matches_scope(metadata: Optional[Dict[str, Any]], tenant_id: str, workspace_id: str) -> bool:
    metadata = metadata or {}
    stored_tenant = metadata.get("tenant_id")
    stored_workspace = metadata.get("storage_workspace_id", metadata.get("workspace_id"))
    if stored_tenant is None and stored_workspace is None:
        return _is_default_scope(tenant_id, workspace_id)
    return str(stored_tenant) == tenant_id and str(stored_workspace) == workspace_id


def _scope_where(tenant_id: str, workspace_id: str) -> Optional[Dict[str, str]]:
    # Legacy records are explicitly assigned to the reserved local scope during
    # reads. A Chroma filter would hide them before that migration boundary can
    # be applied, so only non-default scopes use the indexed filter.
    if _is_default_scope(tenant_id, workspace_id):
        return None
    return {"memory_scope_key": _scope_key(tenant_id, workspace_id)}


def _scoped_call_kwargs(tenant_id: str, workspace_id: str) -> Dict[str, str]:
    if _is_default_scope(tenant_id, workspace_id):
        return {}
    return {"tenant_id": tenant_id, "workspace_id": workspace_id}


def _memory_scope_auth_ready() -> bool:
    return bool(os.getenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", "").strip()) or not _production_memory_mode()


class MemoryPrincipalScope(BaseModel):
    model_config = {"extra": "forbid"}

    tenant_id: MemoryScopeId
    workspace_id: MemoryScopeId
    agent_id: MemoryScopeId
    user_id: MemoryScopeId
    channel_id: MemoryScopeId
    session_id: MemoryScopeId


def _authenticated_memory_principal_scope(
    tenant_id: Optional[str],
    workspace_id: Optional[str],
    scope_signature: Optional[str],
    *,
    scope: Optional[MemoryPrincipalScope | Dict[str, Any]] = None,
    scope_credential_id: Optional[str] = None,
) -> AuthenticatedMemoryPrincipal:
    raw_scope: Optional[Dict[str, Any]]
    if scope is None:
        raw_scope = None
    elif hasattr(scope, "model_dump"):
        raw_scope = scope.model_dump()
    elif hasattr(scope, "dict"):
        raw_scope = scope.dict()
    else:
        raw_scope = dict(scope)
    try:
        return authenticate_memory_principal(
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            scope=raw_scope,
            credential_id=scope_credential_id,
            signature=scope_signature,
            production=_production_memory_mode(),
            allow_local_development=True,
        )
    except MemoryScopeAuthError as exc:
        status_code = 503 if "not configured" in str(exc) else 403
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


def _route_memory_principal(
    request: Any,
    http_request: Optional[Request],
) -> AuthenticatedMemoryPrincipal:
    """Prefer the shared HTTP dependency while preserving direct-call fixtures."""

    if http_request is not None:
        return memory_principal_for_request(http_request)
    return _authenticated_memory_principal_scope(
        request.tenant_id,
        request.workspace_id,
        request.scope_signature,
        scope=request.scope,
        scope_credential_id=request.scope_credential_id,
    )


def _authenticated_memory_scope(
    tenant_id: Optional[str],
    workspace_id: Optional[str],
    scope_signature: Optional[str],
) -> tuple[str, str]:
    principal = _authenticated_memory_principal_scope(
        tenant_id,
        workspace_id,
        scope_signature,
    )
    return principal.tenant_id, principal.storage_workspace_id


def _fact_supersession_lock_path() -> Path:
    configured = os.getenv("CORTEX_FACT_SUPERSESSION_LOCK_PATH")
    return Path(configured) if configured else Path(CHROMA_DIR) / ".fact-supersession.lock"


def _fact_supersession_journal_dir() -> Path:
    configured = os.getenv("CORTEX_FACT_SUPERSESSION_JOURNAL_DIR")
    return Path(configured) if configured else Path(CHROMA_DIR) / ".fact-supersession-journal"


def _fact_revision_retirement_transaction_id(transaction_id: str) -> str:
    return "fact-retirement-" + sha256(str(transaction_id).encode("utf-8")).hexdigest()


@contextmanager
def _fact_supersession_transaction():
    """Serialize a complete fact revision across threads and processes.

    The in-process lock is always acquired first. ``flock`` ownership belongs to
    the open file description and is released by the kernel when a process dies,
    so a crashed writer cannot leave a stale durable lock behind.
    """
    with _FACT_SUPERSESSION_LOCK:
        lock_path = _fact_supersession_lock_path()
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+b") as lock_file:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_fact_supersession_journal(entry: Dict[str, Any]) -> Path:
    """Durably publish a transaction intent before changing Chroma state."""
    journal_dir = _fact_supersession_journal_dir()
    journal_dir_existed = journal_dir.exists()
    journal_dir.mkdir(parents=True, exist_ok=True)
    if not journal_dir_existed:
        _sync_directory(journal_dir.parent)
    transaction_id = str(entry["transaction_id"])
    journal_path = journal_dir / f"{transaction_id}.json"
    temporary_path = journal_dir / f".{transaction_id}.{uuid.uuid4().hex}.tmp"
    try:
        encoded = json.dumps(entry, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        descriptor = os.open(temporary_path, flags, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as journal_file:
                journal_file.write(encoded)
                journal_file.flush()
                os.fsync(journal_file.fileno())
        except Exception:
            try:
                os.close(descriptor)
            except OSError:
                pass
            raise
        os.replace(temporary_path, journal_path)
        _sync_directory(journal_dir)
        return journal_path
    except Exception:
        try:
            temporary_path.unlink()
        except OSError:
            pass
        raise


def _remove_fact_supersession_journal(journal_path: Path) -> None:
    journal_path.unlink()
    _sync_directory(journal_path.parent)


def _read_fact_supersession_journal(journal_path: Path) -> Dict[str, Any]:
    try:
        entry = json.loads(journal_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise FactSupersessionError(f"invalid fact supersession journal: {journal_path.name}") from exc
    if not isinstance(entry, dict) or entry.get("version") not in {1, 2, 3}:
        raise FactSupersessionError(f"invalid fact supersession journal: {journal_path.name}")
    transaction_id = entry.get("transaction_id")
    if (
        not isinstance(transaction_id, str)
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", transaction_id)
        or journal_path.stem != transaction_id
    ):
        raise FactSupersessionError(f"invalid fact supersession journal: {journal_path.name}")
    operation = str(entry.get("operation") or "fact_revision")
    if entry.get("version") == 1 and operation == "fact_revision":
        required_strings = ("fact_key", "memory_id", "text")
        if any(not isinstance(entry.get(key), str) or not entry[key] for key in required_strings):
            raise FactSupersessionError(f"invalid fact supersession journal: {journal_path.name}")
        if (
            not isinstance(entry.get("metadata"), dict)
            or not isinstance(entry.get("created_at"), str)
            or not entry["created_at"]
            or len(entry["created_at"].encode("utf-8")) > 80
        ):
            raise FactSupersessionError(f"invalid fact supersession journal: {journal_path.name}")
        return entry
    if entry.get("version") not in {2, 3} or operation != "retire_ids":
        raise FactSupersessionError(f"invalid fact supersession journal: {journal_path.name}")
    memory_ids = entry.get("memory_ids")
    if (
        not isinstance(memory_ids, list)
        or not memory_ids
        or len(memory_ids) > MAX_SUPERSESSION_RECORDS
        or any(
            not isinstance(value, str)
            or not value
            or len(value.encode("utf-8")) > MAX_SUPERSESSION_ID_BYTES
            for value in memory_ids
        )
        or len(set(memory_ids)) != len(memory_ids)
        or not isinstance(entry.get("reason"), str)
        or not entry["reason"]
        or len(entry["reason"].encode("utf-8")) > 240
        or not isinstance(entry.get("tenant_id"), str)
        or not entry["tenant_id"]
        or not isinstance(entry.get("workspace_id"), str)
        or not entry["workspace_id"]
        or not isinstance(entry.get("memory_principal_key", ""), str)
        or len(entry.get("memory_principal_key", "").encode("utf-8")) > 256
        or not isinstance(entry.get("created_at"), str)
        or not entry["created_at"]
        or len(entry["created_at"].encode("utf-8")) > 80
        or (
            entry.get("superseded_by") is not None
            and (
                not isinstance(entry.get("superseded_by"), str)
                or not entry["superseded_by"]
                or len(entry["superseded_by"].encode("utf-8"))
                > MAX_SUPERSESSION_ID_BYTES
            )
        )
        or (
            entry.get("operation_generation") is not None
            and (
                not isinstance(entry.get("operation_generation"), int)
                or isinstance(entry.get("operation_generation"), bool)
                or entry["operation_generation"] < 0
                or entry["operation_generation"] >= 2**63
            )
        )
    ):
        raise FactSupersessionError(f"invalid fact supersession journal: {journal_path.name}")
    if entry.get("version") == 3 and (
        not isinstance(entry.get("quota_transaction_id"), str)
        or not entry["quota_transaction_id"]
        or len(entry["quota_transaction_id"].encode("utf-8")) > 256
        or not isinstance(entry.get("quota_charge_bytes"), int)
        or isinstance(entry.get("quota_charge_bytes"), bool)
        or entry["quota_charge_bytes"] <= 0
        or not isinstance(entry.get("quota_payload_hash"), str)
        or not re.fullmatch(r"[0-9a-f]{64}", entry["quota_payload_hash"])
        or not isinstance(entry.get("quota_credential_id"), str)
        or not entry["quota_credential_id"]
        or len(entry["quota_credential_id"].encode("utf-8")) > 128
    ):
        raise FactSupersessionError(f"invalid fact supersession journal: {journal_path.name}")
    return entry


def _supersession_recovery_metadata(
    metadata: Dict[str, Any], *, stage: str
) -> Dict[str, Any]:
    """Return the metadata state used by durable supersession recovery.

    Keeping this transition pure lets health checks replay the same fail-closed
    state machine without writing a probe row into the authoritative store.
    """

    recovered = dict(metadata)
    if stage == "pending":
        recovered.update(
            memory_status="tombstoned",
            tombstoned=True,
            supersession_pending=True,
        )
        return recovered
    if stage == "active":
        for field in _ACTIVE_LIFECYCLE_STALE_FIELDS:
            recovered.pop(field, None)
        recovered["memory_status"] = "active"
        return recovered
    raise ValueError("supersession recovery stage must be pending or active")


def _retirement_primary_projection(
    entry: Dict[str, Any], data: Dict[str, Any]
) -> tuple[List[str], List[Dict[str, Any]]]:
    tenant_id, workspace_id = _memory_scope(
        entry.get("tenant_id"), entry.get("workspace_id")
    )
    memory_principal_key = str(entry.get("memory_principal_key") or "").strip() or None
    found_ids = list(data.get("ids") or [])
    metadatas = list(data.get("metadatas") or [])
    scoped_ids: List[str] = []
    retired_metadatas: List[Dict[str, Any]] = []
    retired_at = str(entry.get("created_at") or _utc_iso())
    for index, memory_id in enumerate(found_ids):
        prior = dict(metadatas[index] or {}) if index < len(metadatas) else {}
        if not _metadata_in_requested_scope(
            prior,
            tenant_id,
            workspace_id,
            memory_principal_key,
        ):
            continue
        # Legacy rows may not have a recorded_at value. Normalization normally
        # fills it from the wall clock, which would make the quota payload hash
        # differ between admission, publication, and crash replay. Bind that
        # missing field to the durable retirement timestamp instead.
        prior.setdefault("recorded_at", retired_at)
        metadata = _normalize_memory_metadata(
            prior, tenant_id=tenant_id, workspace_id=workspace_id
        )
        metadata.update({
            "memory_status": "superseded",
            "superseded": True,
            "superseded_at": retired_at,
            "supersession_reason": entry["reason"],
            "lifecycle_transaction_id": entry["transaction_id"],
        })
        _close_temporal_validity(metadata, retired_at)
        superseded_by = str(entry.get("superseded_by") or "").strip()
        if superseded_by:
            metadata["superseded_by"] = superseded_by
        generation = entry.get("operation_generation")
        if isinstance(generation, int) and not isinstance(generation, bool):
            metadata["retired_operation_generation"] = generation
        _validate_memory_metadata(metadata)
        scoped_ids.append(str(memory_id))
        retired_metadatas.append(metadata)
    return scoped_ids, retired_metadatas


def _recover_retirement_journal_locked(
    entry: Dict[str, Any], journal_path: Path
) -> None:
    memory_ids = list(entry["memory_ids"])
    tenant_id, workspace_id = _memory_scope(
        entry.get("tenant_id"), entry.get("workspace_id")
    )
    memory_principal_key = str(entry.get("memory_principal_key") or "").strip() or None
    retired_at = str(entry.get("created_at") or _utc_iso())
    get_kwargs: Dict[str, Any] = {
        "ids": memory_ids,
        "include": ["metadatas"],
    }
    namespace_where = _memory_namespace_where(memory_principal_key)
    if namespace_where:
        get_kwargs["where"] = namespace_where
    data = collection.get(**get_kwargs)
    scoped_ids, retired_metadatas = _retirement_primary_projection(entry, data)
    if scoped_ids:
        collection.update(ids=scoped_ids, metadatas=retired_metadatas)
    _append_fallback_id_tombstone(
        memory_ids,
        superseded_by=(str(entry.get("superseded_by") or "").strip() or None),
        reason=entry["reason"],
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        memory_principal_key=memory_principal_key,
        transaction_id=entry["transaction_id"],
        operation_generation=entry.get("operation_generation"),
        stored_at=retired_at,
    )
    try:
        _remove_fact_supersession_journal(journal_path)
    except Exception as exc:
        # Primary and fallback projections are already durable and replayable.
        # Keep cleanup debt visible in the journal without misreporting either
        # projection as failed or compensating only one store.
        logger.warning(
            "memory retirement committed; recovery journal cleanup remains pending "
            "(journal_sha256=%s error_type=%s)",
            sha256(journal_path.name.encode("utf-8")).hexdigest(),
            type(exc).__name__,
        )
        raise _RetirementJournalCleanupPending(
            "memory retirement committed; recovery journal cleanup remains pending"
        ) from exc


def _recover_retirement_journal_with_quota_locked(
    entry: Dict[str, Any], journal_path: Path
) -> None:
    """Replay a retirement only through its durable quota admission envelope."""

    if entry.get("version") != 3:
        raise FactSupersessionError(
            "legacy memory retirement journal requires quota migration"
        )
    from cortex_server.routers.l22 import run_l22_quota_controlled_side_effect

    run_l22_quota_controlled_side_effect(
        transaction_id=str(entry["quota_transaction_id"]),
        charge_bytes=int(entry["quota_charge_bytes"]),
        payload_hash=str(entry["quota_payload_hash"]),
        tenant_id=str(entry["tenant_id"]),
        workspace_id=str(entry["workspace_id"]),
        credential_id=str(entry["quota_credential_id"]),
        publish=lambda: _recover_retirement_journal_locked(entry, journal_path),
    )


def _recover_fact_supersessions_locked() -> None:
    """Roll forward every durable intent. Caller must hold the process lock."""
    journal_dir = _fact_supersession_journal_dir()
    if not journal_dir.exists():
        return
    try:
        journal_paths = sorted(journal_dir.glob("*.json"))
    except OSError as exc:
        raise FactSupersessionError("fact supersession journal is unavailable") from exc
    for journal_path in journal_paths:
        # A parent fact-revision replay can complete and remove its deterministic
        # child retirement journal while this startup scan still holds the old
        # directory snapshot.
        if not journal_path.exists():
            continue
        entry = _read_fact_supersession_journal(journal_path)
        if str(entry.get("operation") or "fact_revision") == "retire_ids":
            try:
                _recover_retirement_journal_with_quota_locked(entry, journal_path)
            except FactSupersessionError:
                raise
            except Exception as exc:
                raise FactSupersessionError(
                    f"could not recover memory retirement transaction {entry['transaction_id']}"
                ) from exc
            continue
        fact_key = entry["fact_key"]
        memory_id = entry["memory_id"]
        tenant_id, workspace_id = _memory_scope(entry.get("tenant_id"), entry.get("workspace_id"))
        metadata = _normalize_memory_metadata(
            entry["metadata"], tenant_id=tenant_id, workspace_id=workspace_id
        )
        memory_principal_key = str(
            metadata.get("memory_principal_key") or ""
        ).strip() or None
        try:
            operation = _memory_operation_lifecycle(
                metadata, memory_id=memory_id
            )
            if operation is not None and str(operation.get("status")) == "cancelled":
                current = collection.get(
                    ids=[memory_id],
                    **({"where": _memory_namespace_where(memory_principal_key)} if memory_principal_key else {}),
                    include=["metadatas"],
                )
                current_ids = list(current.get("ids") or [])
                current_metas = list(current.get("metadatas") or [])
                if memory_id in current_ids:
                    index = current_ids.index(memory_id)
                    prior = current_metas[index] if index < len(current_metas) else metadata
                    retired = _normalize_memory_metadata(
                        prior, tenant_id=tenant_id, workspace_id=workspace_id
                    )
                    retired.update({
                        "memory_status": "superseded",
                        "superseded": True,
                        "superseded_at": _utc_iso(),
                        "supersession_reason": "store_operation_cancelled",
                    })
                    _close_temporal_validity(retired, str(retired["superseded_at"]))
                    collection.update(ids=[memory_id], metadatas=[retired])
                _append_fallback_id_tombstone(
                    [memory_id],
                    superseded_by=None,
                    reason="store_operation_cancelled",
                    tenant_id=tenant_id,
                    workspace_id=workspace_id,
                    memory_principal_key=memory_principal_key,
                    transaction_id="cancelled-" + entry["transaction_id"],
                    operation_generation=metadata.get("memory_operation_generation"),
                    stored_at=str(entry.get("created_at") or _utc_iso()),
                )
                _remove_fact_supersession_journal(journal_path)
                continue
            current = _collection_fact_rows(
                fact_key,
                tenant_id,
                workspace_id,
                memory_principal_key,
            )
            current_ids = list(current.get("ids") or [])
            if memory_id not in current_ids:
                pending_metadata = _supersession_recovery_metadata(
                    metadata, stage="pending"
                )
                collection.add(ids=[memory_id], documents=[entry["text"]], metadatas=[pending_metadata])
                current_ids.append(memory_id)
            prior_ids = [row_id for row_id in current_ids if row_id != memory_id]
            supersede_memory_records(
                prior_ids,
                superseded_by=memory_id,
                reason="newer_fact_key_revision",
                _skip_recovery=True,
                tenant_id=tenant_id,
                workspace_id=workspace_id,
                memory_principal_key=memory_principal_key,
                transaction_id=_fact_revision_retirement_transaction_id(
                    entry["transaction_id"]
                ),
                retired_at=entry["created_at"],
            )
            active_metadata = _supersession_recovery_metadata(
                metadata, stage="active"
            )
            collection.update(ids=[memory_id], metadatas=[active_metadata])
            _append_fallback_fact_supersession(
                fact_key,
                superseded_by=memory_id,
                tenant_id=tenant_id,
                workspace_id=workspace_id,
                memory_principal_key=memory_principal_key,
            )
            _remove_fact_supersession_journal(journal_path)
        except FactSupersessionError:
            raise
        except Exception as exc:
            raise FactSupersessionError(
                f"could not recover fact supersession transaction {entry['transaction_id']}"
            ) from exc


def _recover_fact_supersessions() -> None:
    with _fact_supersession_transaction():
        _recover_fact_supersessions_locked()


MAX_MEMORY_METADATA_BYTES = 65_536
MAX_MEMORY_METADATA_DEPTH = 8
MAX_MEMORY_METADATA_NODES = 1_000
MAX_MEMORY_METADATA_STRING = 16_384
MAX_SUPERSESSION_RECORDS = 500
MAX_SUPERSESSION_ID_BYTES = 256
MemoryTag = Annotated[str, Field(max_length=256)]
MemoryRecordId = Annotated[str, Field(min_length=1, max_length=MAX_SUPERSESSION_ID_BYTES)]


def _validate_memory_metadata(value: Any) -> Any:
    if value is None:
        return value
    nodes = 0

    def visit(item: Any, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > MAX_MEMORY_METADATA_NODES:
            raise ValueError("metadata has too many values")
        if depth > MAX_MEMORY_METADATA_DEPTH:
            raise ValueError("metadata is too deeply nested")
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str) or len(key) > 256:
                    raise ValueError("metadata keys must be bounded strings")
                visit(child, depth + 1)
        elif isinstance(item, list):
            for child in item:
                visit(child, depth + 1)
        elif isinstance(item, str):
            if len(item) > MAX_MEMORY_METADATA_STRING:
                raise ValueError("metadata string is too long")
        elif item is not None and not isinstance(item, (bool, int, float)):
            raise ValueError("metadata contains an unsupported value")

    visit(value, 0)
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError("metadata must be finite JSON") from exc
    if len(encoded) > MAX_MEMORY_METADATA_BYTES:
        raise ValueError("metadata exceeds byte limit")
    return value


# Chroma accepts scalar metadata and homogeneous primitive lists, while the
# public memory contract accepts bounded finite JSON. Keep indexable fields
# native and carry only unsupported values in a reversible storage envelope.
_STORAGE_METADATA_VERSION = "cortex.chroma-metadata.v1"
_STORAGE_METADATA_SCHEMA_KEY = "__cortex_storage_metadata_schema"
_STORAGE_METADATA_FIELDS_KEY = "__cortex_storage_metadata_fields"
_STORAGE_METADATA_RESERVED = frozenset({
    _STORAGE_METADATA_SCHEMA_KEY, _STORAGE_METADATA_FIELDS_KEY,
})
_STORAGE_METADATA_PROTECTED = frozenset(PRINCIPAL_FIELDS) | frozenset({
    "storage_workspace_id", "memory_principal_key", "memory_scope_key",
    "scope_credential_id", "codec_session_key", "fact_key", "scoped_fact_key",
    "memory_status", "authority_rank", "supersession_pending", "superseded",
    "quarantined", "memory_schema_version", "idempotency_hash", "idempotency_key",
    "memory_operation_contract", "memory_operation_id", "memory_operation_generation",
    "scope", "scope_signature", "scope_credential_id", "source", "status", "tombstoned",
    "canonical_project_memory", "correction_memory", "quality", "tier",
    "source_id", "chunk_id", "source_revision", "claim_key", "memory_type", "project",
    "source_classification", "privacy_classification", "observed_at", "known_at", "valid_from", "valid_until",
    "last_verified_at", "stale_after", "time_precision", "valid_time_state",
    "freshness_state",
    "observed_at_epoch", "known_at_epoch", "valid_from_epoch", "valid_until_epoch",
    "last_verified_at_epoch", "stale_after_epoch", "temporal_index_version",
    "valid_time_known", "freshness_known",
})
_STORAGE_METADATA_LOCK = threading.RLock()

# Authenticated scope fields are server-authoritative routing metadata, not
# caller memory content. They are validated and overwritten by
# scoped_memory_metadata() before this module receives them. Exclude them from
# sensitive-field admission scanning so a legitimate credential identifier is
# not mistaken for a secret payload. Raw content and every caller-controlled
# metadata field remain subject to the privacy gate.
_MEMORY_ADMISSION_INTERNAL_METADATA = frozenset(PRINCIPAL_FIELDS) | frozenset({
    "scope_credential_id",
    "storage_workspace_id",
    "memory_principal_key",
})


def _storage_metadata_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def _native_chroma_metadata_value(value: Any) -> bool:
    if type(value) in (str, bool, int, float):
        return True
    return (
        isinstance(value, list) and bool(value)
        and type(value[0]) in (str, bool, int, float)
        and all(type(item) is type(value[0]) for item in value)
    )


def _matching_metadata_scope_copy(value: Any, native: Dict[str, Any]) -> bool:
    return (
        isinstance(value, dict) and set(value) == set(PRINCIPAL_FIELDS)
        and all(isinstance(value[field], str) and value[field] == native.get(field)
                for field in PRINCIPAL_FIELDS)
    )


def prepare_memory_metadata_for_storage(metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Pure, bounded preflight and lossless Chroma metadata projection.

    This does not resolve a backend, acquire a lock, mutate input, or write an
    intent. Receipt callers can therefore validate before reserving authority.
    """
    if metadata is not None and not isinstance(metadata, dict):
        raise ValueError("memory metadata must be an object")
    _validate_memory_metadata(metadata)
    native: Dict[str, Any] = {}
    fields: Dict[str, Any] = {}
    reserved: Dict[str, Any] = {}
    for key, value in (metadata or {}).items():
        if key in _STORAGE_METADATA_RESERVED:
            reserved[key] = value
        elif _native_chroma_metadata_value(value):
            native[key] = list(value) if isinstance(value, list) else value
        elif key == "scope" and _matching_metadata_scope_copy(value, metadata):
            fields[key] = value
        elif key in _STORAGE_METADATA_PROTECTED:
            raise ValueError("memory principal and filter metadata must remain native")
        else:
            fields[key] = value
    if fields or reserved or not native:
        native[_STORAGE_METADATA_SCHEMA_KEY] = _STORAGE_METADATA_VERSION
        native[_STORAGE_METADATA_FIELDS_KEY] = _storage_metadata_json({
            "fields": fields, "reserved": reserved,
        })
    if len(_storage_metadata_json(native).encode("utf-8")) > MAX_MEMORY_METADATA_BYTES:
        raise ValueError("encoded memory metadata exceeds byte limit")
    return native


def _decode_memory_metadata_from_storage(metadata: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if metadata is None:
        return None
    if not isinstance(metadata, dict):
        raise ValueError("memory metadata storage envelope is invalid")
    if metadata.get(_STORAGE_METADATA_SCHEMA_KEY) != _STORAGE_METADATA_VERSION:
        return dict(metadata)
    try:
        raw = metadata[_STORAGE_METADATA_FIELDS_KEY]
        if not isinstance(raw, str) or len(_storage_metadata_json(metadata).encode("utf-8")) > MAX_MEMORY_METADATA_BYTES:
            raise ValueError()
        envelope = json.loads(raw)
        if not isinstance(envelope, dict) or set(envelope) != {"fields", "reserved"}:
            raise ValueError()
        fields, reserved = envelope["fields"], envelope["reserved"]
        if not isinstance(fields, dict) or not isinstance(reserved, dict):
            raise ValueError()
        native = {key: value for key, value in metadata.items() if key not in _STORAGE_METADATA_RESERVED}
        for key, value in fields.items():
            scope_copy = key == "scope" and _matching_metadata_scope_copy(value, native)
            if (key in native or key in _STORAGE_METADATA_RESERVED
                    or (key in _STORAGE_METADATA_PROTECTED and not scope_copy)
                    or _native_chroma_metadata_value(value)):
                raise ValueError()
            native[key] = value
        if not set(reserved).issubset(_STORAGE_METADATA_RESERVED):
            raise ValueError()
        native.update(reserved)
        _validate_memory_metadata(native)
        return native
    except (KeyError, TypeError, ValueError, RecursionError) as exc:
        raise ValueError("memory metadata storage envelope is invalid") from exc


def _decode_memory_metadata_result(result: Any) -> Any:
    if not isinstance(result, dict) or "metadatas" not in result:
        return result

    def decode(value):
        if isinstance(value, list):
            return [decode(item) for item in value]
        return _decode_memory_metadata_from_storage(value)

    return {**result, "metadatas": decode(result["metadatas"])}


@contextmanager
def _memory_metadata_storage_transaction():
    # Separate from the enclosing fact-supersession flock: the latter is not
    # recursively flock-safe across new open-file descriptions.
    with _STORAGE_METADATA_LOCK:
        lock_path = Path(CHROMA_DIR) / ".metadata-storage.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+b") as lock_file:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def _dispatch_memory_storage(resource, method: str, args, kwargs):
    target = getattr(resource, method)
    if method in {"get", "query"}:
        return _decode_memory_metadata_result(target(*args, **kwargs))
    if method not in {"add", "update", "upsert", "delete"}:
        return target(*args, **kwargs)
    bound = inspect.signature(target).bind_partial(*args, **kwargs)
    metadatas = bound.arguments.get("metadatas")
    if metadatas is not None:
        metadatas = [metadatas] if isinstance(metadatas, dict) else list(metadatas)
        for metadata in metadatas:
            if metadata is not None:
                if method in {"update", "upsert"}:
                    # None is a native update/upsert tombstone, including for
                    # principal fields; validate the merged value below.
                    if not isinstance(metadata, dict):
                        raise ValueError("memory metadata must be an object")
                    _validate_memory_metadata(metadata)
                else:
                    prepare_memory_metadata_for_storage(metadata)
    with _memory_metadata_storage_transaction():
        if metadatas is not None:
            ids = bound.arguments.get("ids", [])
            ids = [ids] if isinstance(ids, str) else list(ids)
            if len(ids) != len(metadatas):
                raise ValueError("memory metadata count does not match record IDs")
            prior = {}
            if method in {"update", "upsert"}:
                stored = resource.get(ids=ids, include=["metadatas"])
                prior = dict(zip(stored.get("ids") or [], stored.get("metadatas") or []))
            projected = []
            for memory_id, metadata in zip(ids, metadatas):
                if metadata is None:
                    projected.append(None)
                    continue
                previous = prior.get(memory_id)
                if method in {"update", "upsert"} and memory_id in prior:
                    logical = dict(_decode_memory_metadata_from_storage(previous) or {})
                    for key, value in metadata.items():
                        if value is None:
                            logical.pop(key, None)
                        else:
                            logical[key] = value
                    if str(
                        logical.get("memory_status") or logical.get("status") or "active"
                    ).strip().lower() == "active":
                        # Active rows must not retain recovery or historical
                        # lifecycle state. The native update below emits
                        # tombstones for every stale native key.
                        for key in _ACTIVE_LIFECYCLE_STALE_FIELDS:
                            logical.pop(key, None)
                    encoded = prepare_memory_metadata_for_storage(logical)
                    # Native update/upsert merge metadata. Remove obsolete
                    # envelope/native representations using native tombstones.
                    for key in previous or {}:
                        if key not in encoded:
                            encoded[key] = None
                else:
                    logical = ({key: value for key, value in metadata.items() if value is not None}
                               if method in {"update", "upsert"} else metadata)
                    encoded = prepare_memory_metadata_for_storage(logical)
                projected.append(encoded)
            bound.arguments["metadatas"] = projected
        return target(*bound.args, **bound.kwargs)
class EmbedRequest(BaseModel):
    text: str = Field(..., max_length=1_000_000)
    metadata: Optional[dict] = None
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)

    _bounded_metadata = field_validator("metadata")(_validate_memory_metadata)


class EmbedResponse(BaseModel):
    id: str
    status: str


class MemorySearchFilterRequest(BaseModel):
    """Typed, allowlisted filters applied before semantic ranking."""

    source_ids: Optional[List[MemoryRecordId]] = Field(None, max_length=128)
    source_paths: Optional[List[MemoryTag]] = Field(None, max_length=128)
    memory_types: Optional[List[MemoryTag]] = Field(None, max_length=128)
    tags: Optional[List[MemoryTag]] = Field(None, max_length=128)
    fact_keys: Optional[List[MemoryRecordId]] = Field(None, max_length=128)
    claim_keys: Optional[List[MemoryRecordId]] = Field(None, max_length=128)
    projects: Optional[List[MemoryTag]] = Field(None, max_length=128)
    classifications: Optional[List[MemoryTag]] = Field(None, max_length=16)
    statuses: Optional[List[MemoryTag]] = Field(None, max_length=16)
    as_of: Optional[str] = Field(None, max_length=64)
    as_known_at: Optional[str] = Field(None, max_length=64)
    include_stale: bool = False
    include_unknown_time: bool = True
    include_conflicts: bool = False


class SearchRequest(BaseModel):
    query: str = Field(..., max_length=16_384)
    n_results: int = Field(3, ge=1, le=100)
    allow_fallback: bool = True
    filters: Optional[MemorySearchFilterRequest] = None
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class RecordReadRequest(BaseModel):
    id: str = Field(..., min_length=1, max_length=256, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$")
    from_line: int = Field(1, ge=1, strict=True)
    lines: int = Field(100, ge=1, le=200, strict=True)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class MemoryResult(BaseModel):
    id: str
    text: str
    distance: float
    metadata: Optional[dict]


class SearchResponse(BaseModel):
    query: str
    results: List[MemoryResult]
    search_mode: str = "semantic"
    degraded: bool = False
    warning: Optional[str] = None


class NovelEmbedRequest(BaseModel):
    text: str = Field(..., max_length=1_000_000)
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


class NovelEmbedResponse(BaseModel):
    id: str
    status: str
    novelty_score: float
    novelty_bucket: str
    novelty_fingerprint: str


class NovelSearchRequest(BaseModel):
    query: str = Field(..., max_length=16_384)
    n_results: int = Field(5, ge=1, le=100)
    novelty_weight: float = 0.28
    semantic_weight: float = 0.72
    min_novelty: float = 0.0
    allow_fallback: bool = True
    filters: Optional[MemorySearchFilterRequest] = None
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class NovelSearchResult(BaseModel):
    id: str
    text: str
    distance: float
    relevance_score: float
    novelty_score: float
    combined_score: float
    metadata: Optional[dict]


class NovelSearchResponse(BaseModel):
    query: str
    novelty_weight: float
    semantic_weight: float
    results: List[NovelSearchResult]
    search_mode: str = "semantic+novelty"
    degraded: bool = False
    warning: Optional[str] = None


class RecallRequest(BaseModel):
    query: str = Field(..., max_length=16_384)
    n_results: int = Field(5, ge=1, le=100)
    filters: Optional[MemorySearchFilterRequest] = None
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class RecallResponse(BaseModel):
    query: str
    mode: str
    results: List[MemoryResult]
    degraded: bool = False
    warning: Optional[str] = None


class SupersedeRequest(BaseModel):
    memory_ids: List[MemoryRecordId] = Field(
        ..., min_length=1, max_length=MAX_SUPERSESSION_RECORDS
    )
    superseded_by: Optional[MemoryRecordId] = None
    reason: str = Field("explicit_correction", max_length=240)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)

    @field_validator("memory_ids")
    @classmethod
    def _bounded_memory_ids(cls, values: List[str]) -> List[str]:
        normalized = [str(value).strip() for value in values]
        if any(
            not value or len(value.encode("utf-8")) > MAX_SUPERSESSION_ID_BYTES
            for value in normalized
        ):
            raise ValueError("memory IDs must be bounded non-empty UTF-8 values")
        return normalized

    @field_validator("superseded_by")
    @classmethod
    def _bounded_superseded_by(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        if (
            not normalized
            or len(normalized.encode("utf-8")) > MAX_SUPERSESSION_ID_BYTES
        ):
            raise ValueError("superseded_by must be a bounded non-empty UTF-8 value")
        return normalized

    @field_validator("reason")
    @classmethod
    def _bounded_reason(cls, value: str) -> str:
        normalized = str(value or "").strip() or "explicit_correction"
        if len(normalized.encode("utf-8")) > 240:
            raise ValueError("supersession reason exceeds its immutable byte bound")
        return normalized


_CANONICAL_PROJECT_INDEX = Path(construction_config("CORTEX_CANONICAL_PROJECT_INDEX", "/root/clawd/memory/projects/INDEX.md"))

_IMPORT_CONFIGURATION = {
    name: globals()[name]
    for name in (
        "CHROMA_DIR",
        "_FALLBACK_LOG_PATH",
        "_FALLBACK_MAX_BYTES",
        "_FALLBACK_MAX_ROWS",
        "_FALLBACK_MAX_ROW_BYTES",
        "_FALLBACK_READ_MAX_BYTES",
        "_LOCAL_FILE_MEMORY_MAX_FILES",
        "_LOCAL_FILE_MEMORY_MAX_BYTES",
        "_LOCAL_FILE_MEMORY_MIN_SCORE",
        "DEFAULT_TENANT_ID",
        "DEFAULT_WORKSPACE_ID",
        "_CANONICAL_PROJECT_INDEX",
    )
}


def _activate_runtime_configuration() -> None:
    """Rebind neutral import defaults without replacing the router module.

    Explicit caller overrides are retained. This lets documentation and test
    discovery import the router without reading ambient state while a later
    runtime factory can still capture its configured persistence boundaries.
    """

    global CHROMA_DIR, _FALLBACK_LOG_PATH, _FALLBACK_MAX_BYTES
    global _FALLBACK_MAX_ROWS, _FALLBACK_MAX_ROW_BYTES, _FALLBACK_READ_MAX_BYTES
    global _LOCAL_FILE_MEMORY_MAX_FILES, _LOCAL_FILE_MEMORY_MAX_BYTES
    global _LOCAL_FILE_MEMORY_MIN_SCORE, DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID
    global _CANONICAL_PROJECT_INDEX

    def configured(name: str, candidate: Any) -> Any:
        current = globals()[name]
        return candidate if current == _IMPORT_CONFIGURATION[name] else current

    CHROMA_DIR = configured("CHROMA_DIR", _default_chroma_dir())
    _FALLBACK_LOG_PATH = configured(
        "_FALLBACK_LOG_PATH",
        Path(
            construction_config(
                "LIBRARIAN_FALLBACK_LOG_PATH",
                f"{CHROMA_DIR}/librarian_fallback.jsonl",
            )
        ),
    )
    _FALLBACK_MAX_BYTES = configured(
        "_FALLBACK_MAX_BYTES",
        int(construction_config("LIBRARIAN_FALLBACK_MAX_BYTES", str(16 * 1024 * 1024))),
    )
    _FALLBACK_MAX_ROWS = configured(
        "_FALLBACK_MAX_ROWS",
        int(construction_config("LIBRARIAN_FALLBACK_MAX_ROWS", "5000")),
    )
    _FALLBACK_MAX_ROW_BYTES = configured(
        "_FALLBACK_MAX_ROW_BYTES",
        int(construction_config("LIBRARIAN_FALLBACK_MAX_ROW_BYTES", str(1100 * 1024))),
    )
    _FALLBACK_READ_MAX_BYTES = configured(
        "_FALLBACK_READ_MAX_BYTES",
        int(construction_config("LIBRARIAN_FALLBACK_READ_MAX_BYTES", str(4 * 1024 * 1024))),
    )
    _LOCAL_FILE_MEMORY_MAX_FILES = configured(
        "_LOCAL_FILE_MEMORY_MAX_FILES",
        int(construction_config("LIBRARIAN_LOCAL_FILE_MAX_FILES", "900")),
    )
    _LOCAL_FILE_MEMORY_MAX_BYTES = configured(
        "_LOCAL_FILE_MEMORY_MAX_BYTES",
        int(construction_config("LIBRARIAN_LOCAL_FILE_MAX_BYTES", str(768 * 1024))),
    )
    _LOCAL_FILE_MEMORY_MIN_SCORE = configured(
        "_LOCAL_FILE_MEMORY_MIN_SCORE",
        float(construction_config("LIBRARIAN_LOCAL_FILE_MIN_SCORE", "0.18")),
    )
    DEFAULT_TENANT_ID = configured(
        "DEFAULT_TENANT_ID",
        str(construction_config("CORTEX_DEFAULT_TENANT_ID", "cortex-local")).strip()
        or "cortex-local",
    )
    DEFAULT_WORKSPACE_ID = configured(
        "DEFAULT_WORKSPACE_ID",
        str(construction_config("CORTEX_DEFAULT_WORKSPACE_ID", "default")).strip()
        or "default",
    )
    _CANONICAL_PROJECT_INDEX = configured(
        "_CANONICAL_PROJECT_INDEX",
        Path(
            construction_config(
                "CORTEX_CANONICAL_PROJECT_INDEX",
                "/root/clawd/memory/projects/INDEX.md",
            )
        ),
    )

    for model in (
        EmbedRequest,
        SearchRequest,
        RecordReadRequest,
        NovelEmbedRequest,
        NovelSearchRequest,
        RecallRequest,
        SupersedeRequest,
    ):
        defaults_changed = False
        for field_name, activated_default, import_default in (
            ("tenant_id", DEFAULT_TENANT_ID, _IMPORT_CONFIGURATION["DEFAULT_TENANT_ID"]),
            (
                "workspace_id",
                DEFAULT_WORKSPACE_ID,
                _IMPORT_CONFIGURATION["DEFAULT_WORKSPACE_ID"],
            ),
        ):
            field = model.model_fields[field_name]
            if field.default == import_default:
                field.default = activated_default
                defaults_changed = True
        if defaults_changed:
            model.model_rebuild(force=True)

_CURRENT_QUERY_PATTERNS = re.compile(
    r"\b(current|latest|now|next|recommend|roadmap|should we|what remains|remaining|status|state|done|completed|proven)\b",
    re.IGNORECASE,
)
_HISTORICAL_QUERY_PATTERNS = re.compile(
    r"\b(history|historical|timeline|previous|earlier|used to|at the time|superseded|tombstone|what happened)\b",
    re.IGNORECASE,
)


def _query_wants_historical_memory(query: str) -> bool:
    return bool(_HISTORICAL_QUERY_PATTERNS.search(str(query or "")))


def _memory_status(metadata: Optional[Dict[str, Any]]) -> str:
    meta = metadata or {}
    status = str(meta.get("memory_status") or meta.get("status") or "active").strip().lower()
    if bool(meta.get("tombstoned")):
        return "tombstoned"
    if bool(meta.get("superseded")) and status == "active":
        return "superseded"
    return status if status in {"active", "superseded", "tombstoned", "historical"} else "active"


def _memory_operation_lifecycle(
    metadata: Optional[Dict[str, Any]], *, memory_id: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    meta = metadata or {}
    if not str(meta.get("memory_operation_contract") or "").strip():
        return None
    try:
        # Imported lazily because l22 imports this router's storage helpers.
        from cortex_server.routers.l22 import memory_store_operation_for_metadata

        return memory_store_operation_for_metadata(meta, memory_id=memory_id)
    except Exception as exc:
        raise FactSupersessionError(
            "durable memory operation authority is unavailable or inconsistent"
        ) from exc


def _memory_visible_for_query(
    query: str,
    metadata: Optional[Dict[str, Any]],
    filters: Optional[MemorySearchFilters] = None,
) -> bool:
    """Keep uncommitted rows private and expose history only on explicit request."""

    meta = metadata or {}
    if bool(meta.get("supersession_pending")):
        return False
    operation = _memory_operation_lifecycle(meta)
    if operation is not None:
        operation_status = str(operation.get("status") or "")
        if operation_status == "prepared":
            return False
        if operation_status == "cancelled":
            return (
                _query_wants_historical_memory(query)
                and str(operation.get("projection_status") or "") == "complete"
                and _memory_status(meta) != "active"
            )
        if operation_status != "committed":
            raise FactSupersessionError(
                "durable memory operation has an invalid lifecycle state"
            )
    status = _memory_status(meta)
    if filters and filters.statuses:
        return status in filters.statuses
    if filters and (filters.as_of or filters.as_known_at):
        # Temporal queries may legitimately select an older superseded
        # projection. Hard tombstones remain hidden unless explicitly named in
        # the status filter above.
        return status != "tombstoned"
    if _query_wants_historical_memory(query):
        return True
    return status == "active"


def _authority_rank(metadata: Optional[Dict[str, Any]]) -> int:
    meta = metadata or {}
    explicit = meta.get("authority_rank")
    try:
        if explicit is not None:
            return max(0, min(100, int(explicit)))
    except Exception:
        pass
    source = str(meta.get("source") or "").strip().lower()
    if source == "live_source_of_record":
        return 100
    if source == "canonical_project_file" or bool(meta.get("canonical_project_memory")):
        return 90
    if bool(meta.get("correction_memory")) or "correction" in _metadata_tags(meta):
        return 80
    if _is_curated_memory(meta):
        return 65
    if source == "local_file_memory":
        return 55
    return 30


def _canonical_project_registry_with_diagnostics() -> tuple[List[Dict[str, Any]], List[str]]:
    """Parse the canonical registry and report every mapping row we cannot prove."""
    try:
        text = _CANONICAL_PROJECT_INDEX.read_text(encoding="utf-8")
    except Exception as exc:
        return [], [f"canonical index: {type(exc).__name__}: {exc}"]
    rows: List[Dict[str, Any]] = []
    errors: List[str] = []
    alias_bindings: Dict[str, tuple[str, int]] = {}
    in_registry_table = False
    workspace_root = (
        _CANONICAL_PROJECT_INDEX.parents[2]
        if len(_CANONICAL_PROJECT_INDEX.parents) >= 3
        else Path("/root/clawd")
    )
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.lstrip().startswith("|"):
            in_registry_table = False
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if not in_registry_table:
            first_header = cells[0].lower() if cells else ""
            second_header = cells[1].lower() if len(cells) > 1 else ""
            in_registry_table = (
                "project" in first_header
                and "canonical" in second_header
                and ("file" in second_header or "path" in second_header)
            )
            if in_registry_table:
                continue
            if "memory/projects/" not in line:
                continue
        if cells and all(re.fullmatch(r":?-{3,}:?", cell or "") for cell in cells):
            continue
        if len(cells) < 2:
            errors.append(
                f"line {line_number}: canonical mapping row has fewer than two cells"
            )
            continue
        aliases = [part.strip() for part in re.split(r",|/", cells[0]) if part.strip()]
        match = re.search(r"`([^`]+)`", cells[1])
        if not aliases:
            errors.append(f"line {line_number}: canonical mapping has no project alias")
            continue
        if not match:
            errors.append(
                f"line {line_number}: canonical mapping path must be backtick-delimited"
            )
            continue
        rel_path = match.group(1).strip()
        rel = Path(rel_path)
        if (
            not rel_path.startswith("memory/projects/")
            or rel.is_absolute()
            or ".." in rel.parts
        ):
            errors.append(
                f"line {line_number}: canonical mapping path must stay under memory/projects"
            )
            continue
        path = workspace_root / rel
        for alias in aliases:
            normalized_alias = " ".join(alias.casefold().split())
            prior = alias_bindings.get(normalized_alias)
            if prior is not None and prior[0] != rel_path:
                errors.append(
                    f"line {line_number}: canonical alias conflicts with line {prior[1]}"
                )
            else:
                alias_bindings[normalized_alias] = (rel_path, line_number)
        rows.append({"aliases": aliases, "path": path, "rel_path": rel_path})
    return rows, errors


def _canonical_project_registry() -> List[Dict[str, Any]]:
    """Parse the user-maintained canonical registry instead of duplicating it in code."""

    rows, _errors = _canonical_project_registry_with_diagnostics()
    return rows


def _matching_canonical_projects(query: str) -> List[Dict[str, Any]]:
    normalized = " ".join(_tokenize(query))
    matches = []
    for row in _canonical_project_registry():
        aliases = row.get("aliases") or []
        for alias in aliases:
            token_list = _tokenize(str(alias))
            alias_tokens = " ".join(token_list)
            distinctive_tokens = [token.lower() for token in re.findall(r"[A-Z0-9][A-Z0-9_-]{3,}", str(alias))]
            contextual_tokens = [token for token in token_list if token not in distinctive_tokens and len(token) >= 4]
            distinctive_match = any(token in normalized.split() for token in distinctive_tokens) and any(token in normalized.split() for token in contextual_tokens)
            if alias_tokens and (alias_tokens in normalized or distinctive_match):
                matches.append(row)
                break
    return matches


def _canonical_section_chunks(path: Path, query: str, max_chunks: int = 6) -> List[Dict[str, Any]]:
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return []
    sections: List[tuple[str, int, List[str]]] = []
    heading = "Document"
    start = 1
    buf: List[str] = []
    for number, line in enumerate(lines, start=1):
        if _is_markdown_heading(line):
            if buf:
                sections.append((heading, start, buf))
            heading = re.sub(r"^\s*#+\s*", "", line).strip()
            start = number
            buf = [line]
        else:
            buf.append(line)
    if buf:
        sections.append((heading, start, buf))

    current_query = bool(_CURRENT_QUERY_PATTERNS.search(str(query or "")))
    priority_heading = re.compile(r"\b(current|correction|already proven|completed|next|remaining|blocker)\b", re.IGNORECASE)
    ranked = []
    for section_heading, line, content in sections:
        text = "\n".join(part.rstrip() for part in content if part.strip()).strip()[:5000]
        if not text:
            continue
        lexical = _lexical_score(query, f"{section_heading} {text}")
        priority = 0.35 if current_query and priority_heading.search(section_heading) else 0.0
        query_identifiers = {token for token in _tokenize(query) if any(char.isdigit() for char in token)}
        identifier_hits = sum(1 for token in query_identifiers if token in set(_tokenize(f"{section_heading} {text}")))
        identifier_boost = min(0.5, identifier_hits * 0.45)
        if lexical <= 0 and priority <= 0 and identifier_boost <= 0:
            continue
        ranked.append({"line": line, "heading": section_heading, "text": text[:1800], "score": min(1.0, lexical + priority + identifier_boost)})
    ranked.sort(key=lambda item: (item["score"], -item["line"]), reverse=True)
    return ranked[: max(1, int(max_chunks))]


def _canonical_project_search_rows(
    query: str,
    n_results: int = 8,
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    if not _is_default_scope(tenant, workspace):
        return []
    rows: List[Dict[str, Any]] = []
    for project in _matching_canonical_projects(query):
        path = project["path"]
        for chunk in _canonical_section_chunks(path, query, max_chunks=max(4, n_results)):
            section_status = "superseded" if re.search(r"\bsuperseded\b", str(chunk["heading"]), re.IGNORECASE) else "active"
            rows.append({
                "id": f"canonical-{_fingerprint(str(path))}-{chunk['line']}",
                "text": chunk["text"],
                "distance": round(max(0.0, 1.0 - float(chunk["score"])), 4),
                "metadata": {
                    "source": "canonical_project_file",
                    "quality": "curated",
                    "canonical_project_memory": True,
                    "authority_rank": 90,
                    "memory_status": section_status,
                    "path": str(path),
                    "relPath": project["rel_path"],
                    "line": int(chunk["line"]),
                    "section": chunk["heading"],
                    "lexical_score": round(float(chunk["score"]), 4),
                    "canonical_priority_score": round(float(chunk["score"]), 4),
                    "recall_mode": "canonical_registry_direct_read",
                    "tags": ["canonical_project_memory", "durable_memory", "source_of_truth"],
                },
                "_score": float(chunk["score"]),
            })
    return rows[: max(1, int(n_results))]


def _normalize_memory_metadata(
    metadata: Optional[Dict[str, Any]],
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> Dict[str, Any]:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    normalized = dict(metadata or {})
    supplied_tenant = normalized.get("tenant_id")
    if supplied_tenant is not None and str(supplied_tenant) != tenant:
        raise ValueError("metadata tenant_id does not match the authenticated memory scope")
    supplied_storage_workspace = normalized.get("storage_workspace_id")
    if supplied_storage_workspace is not None and str(supplied_storage_workspace) != workspace:
        raise ValueError("metadata storage scope does not match the authenticated memory principal")
    principal_identity_present = any(
        field in normalized for field in ("agent_id", "user_id", "channel_id", "session_id")
    )
    principal_fields_present = [field for field in PRINCIPAL_FIELDS if field in normalized]
    if principal_identity_present and len(principal_fields_present) != len(PRINCIPAL_FIELDS):
        raise ValueError("memory principal metadata must contain every principal dimension")
    normalized["tenant_id"] = tenant
    normalized.setdefault("workspace_id", workspace)
    normalized["storage_workspace_id"] = workspace
    normalized["memory_scope_key"] = _scope_key(tenant, workspace)
    fact_key = str(normalized.get("fact_key") or "").strip()
    if fact_key:
        normalized["scoped_fact_key"] = sha256(
            f"{tenant}\0{workspace}\0{fact_key}".encode("utf-8")
        ).hexdigest()
    normalized.setdefault("memory_status", "active")
    normalized.setdefault("authority_rank", _authority_rank(normalized))
    normalized.setdefault("memory_schema_version", "cortex.memory.governance.v1")
    normalized.setdefault("recorded_at", _utc_iso())
    return normalized


def _memory_namespace_where(
    memory_principal_key: Optional[str],
) -> Optional[Dict[str, Any]]:
    key = str(memory_principal_key or "").strip()
    return {"memory_principal_key": key} if key else None


def _combine_memory_where(
    base: Dict[str, Any],
    memory_principal_key: Optional[str],
) -> Dict[str, Any]:
    scoped = _memory_namespace_where(memory_principal_key)
    if not scoped:
        return base
    if not base:
        return scoped
    if set(base) == {"$and"} and isinstance(base.get("$and"), list):
        return {"$and": [*base["$and"], scoped]}
    return {"$and": [base, scoped]}


def _metadata_in_memory_namespace(
    metadata: object,
    memory_principal_key: Optional[str],
) -> bool:
    key = str(memory_principal_key or "").strip()
    if not key:
        return True
    return (
        isinstance(metadata, dict)
        and str(metadata.get("memory_principal_key") or "") == key
    )


def _memory_query_where(
    tenant_id: str,
    workspace_id: str,
    memory_principal_key: Optional[str],
    filters: Optional[MemorySearchFilters] = None,
) -> Optional[Dict[str, Any]]:
    principal_where = _memory_namespace_where(memory_principal_key) or _scope_where(
        tenant_id, workspace_id
    )
    return compile_chroma_where(principal_where, filters)


def _memory_governance_store() -> MemoryGovernanceStore:
    return MemoryGovernanceStore()


def parse_memory_search_filters(value: Any) -> Optional[MemorySearchFilters]:
    if value is None:
        return None
    if isinstance(value, MemorySearchFilters):
        return value
    if isinstance(value, BaseModel):
        raw = value.model_dump(exclude_none=True)
    elif isinstance(value, dict):
        raw = value
    else:
        raise MemoryFilterError("memory filters must be an object")
    return MemorySearchFilters.from_mapping(raw)


def prepare_governed_memory_write(
    *,
    principal_key: str,
    content: str,
    metadata: Dict[str, Any],
    operation_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Admit and normalize one write before any raw payload is persisted."""

    store = _memory_governance_store()
    replay_observed_at = (
        metadata.get("observed_at")
        or metadata.get("observedAt")
        or metadata.get("timestamp")
        or metadata.get("recorded_at")
        or datetime.now(timezone.utc)
    )
    deletion_epoch = store.deletion_epoch(principal_key)
    if deletion_epoch:
        if not store.replay_allowed(principal_key, replay_observed_at):
            raise MemoryDeletionError(
                "memory write predates the principal deletion fence"
            )
    admission_metadata = {
        key: value
        for key, value in metadata.items()
        if key not in _MEMORY_ADMISSION_INTERNAL_METADATA
    }
    decision = store.admit(
        principal_key,
        content,
        admission_metadata,
        allow_sensitive=str(os.getenv("CORTEX_MEMORY_ALLOW_SENSITIVE", "")).lower()
        in {"1", "true", "yes", "on"},
        baa_authorized=str(os.getenv("CORTEX_MEMORY_BAA_AUTHORIZED", "")).lower()
        in {"1", "true", "yes", "on"},
        encryption_at_rest=str(os.getenv("CORTEX_MEMORY_ENCRYPTED_AT_REST", "")).lower()
        in {"1", "true", "yes", "on"},
        observed_at=replay_observed_at,
    )
    if not decision.allowed:
        raise MemoryAdmissionRejected(decision)
    normalization_time = parse_timestamp(
        metadata.get("recorded_at")
        or metadata.get("known_at")
        or metadata.get("observed_at"),
        field_name="recorded_at",
    )
    normalized = normalize_filterable_metadata(metadata, now=normalization_time)
    normalized["privacy_classification"] = decision.classification
    normalized["source_classification"] = str(
        normalized.get("source_classification") or decision.classification
    )
    subject = str(normalized.get("subject") or "").strip()
    predicate = str(normalized.get("predicate") or "").strip()
    if subject and predicate:
        if not normalized.get("claim_key"):
            normalized["claim_key"] = "claim_" + sha256_text(
                "cortex.memory.claim.v1\0"
                + subject
                + "\0"
                + predicate
                + "\0"
                + canonical_json(
                    normalized.get("fact_scope") or normalized.get("scope") or ""
                )
            )[:48]
        if not normalized.get("fact_key"):
            normalized["fact_key"] = "fact_" + sha256_text(
                "cortex.memory.fact.v1\0"
                + str(normalized["claim_key"])
                + "\0"
                + canonical_value_hash(normalized.get("fact_value", content))
                + "\0"
                + str(normalized.get("source_id") or normalized.get("source") or "")
            )[:48]
    if deletion_epoch and not store.replay_allowed(
        principal_key, normalized.get("observed_at")
    ):
        raise MemoryGovernanceError("memory write predates the principal deletion fence")
    if operation_id:
        payload_hash = sha256_text(
            "cortex.memory.outbox.payload.v1\0"
            + sha256_text(content)
            + "\0"
            + canonical_json(normalized)
        )
        store.stage_outbox(
            principal_key=principal_key,
            operation_id=operation_id,
            payload_hash=payload_hash,
            observed_at=normalized["observed_at"],
        )
        normalized["governance_operation_id"] = operation_id
        normalized["governance_payload_hash"] = payload_hash
    return normalized


def finalize_governed_memory_write(
    *,
    principal_key: str,
    memory_id: str,
    content: str,
    metadata: Dict[str, Any],
    operation_id: Optional[str] = None,
    receipt_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Finalize fact edges, promotion state, and the durable outbox receipt."""

    store = _memory_governance_store()
    if not store.replay_allowed(principal_key, metadata.get("observed_at")):
        raise MemoryDeletionError("memory write predates the principal deletion fence")
    projection = store.record_fact(
        principal_key=principal_key,
        memory_id=memory_id,
        content=content,
        metadata=metadata,
    )
    promotion = store.enqueue_promotion(
        principal_key=principal_key,
        memory_id=memory_id,
        metadata=metadata,
        classification=str(metadata.get("privacy_classification") or "private"),
    )
    committed = None
    if operation_id:
        payload_hash = str(metadata.get("governance_payload_hash") or "")
        committed = store.commit_outbox(
            principal_key=principal_key,
            operation_id=operation_id,
            payload_hash=payload_hash,
            receipt_id=str(receipt_id or memory_id),
        )
    return {
        "fact": asdict(projection) if projection is not None else None,
        "promotion": promotion,
        "outbox": committed,
    }


def _apply_governed_result_policy(
    rows: List[Dict[str, Any]],
    *,
    filters: Optional[MemorySearchFilters],
    memory_principal_key: Optional[str],
) -> List[Dict[str, Any]]:
    filtered: List[Dict[str, Any]] = []
    for row in rows:
        metadata = dict(row.get("metadata") or {})
        if not row_matches_filters(metadata, filters, check_status=False):
            continue
        temporal = temporal_visibility(
            metadata,
            as_of=filters.as_of if filters else None,
            as_known_at=filters.as_known_at if filters else None,
            include_stale=filters.include_stale if filters else False,
            include_unknown_time=filters.include_unknown_time if filters else True,
        )
        if not temporal.visible:
            continue
        metadata.update(
            {
                "freshness_state": temporal.freshness_state,
                "valid_time_state": temporal.valid_time_state,
                "temporal_reason": temporal.reason,
            }
        )
        filtered.append({**row, "metadata": metadata})

    principal = str(memory_principal_key or "").strip()
    if principal and filtered:
        projections = _memory_governance_store().conflict_projection(
            principal_key=principal,
            memory_ids=[str(row.get("id") or "") for row in filtered],
        )
        include_conflicts = bool(
            filters
            and (filters.include_conflicts or "conflicted" in filters.statuses)
        )
        resolved: List[Dict[str, Any]] = []
        for row in filtered:
            projection = projections.get(str(row.get("id") or ""))
            effective_status = str(
                (projection or {}).get("fact_status")
                or (row.get("metadata") or {}).get("memory_status")
                or "active"
            )
            if filters and filters.statuses and effective_status not in filters.statuses:
                continue
            if projection:
                metadata = {**(row.get("metadata") or {}), "fact_conflict": projection}
                row = {**row, "metadata": metadata}
                if (
                    not include_conflicts
                    and projection.get("fact_status") == "conflicted"
                    and projection.get("active_winner_id") != row.get("id")
                ):
                    continue
            resolved.append(row)
        filtered = resolved
    elif filters and filters.statuses:
        filtered = [
            row
            for row in filtered
            if str((row.get("metadata") or {}).get("memory_status") or "active")
            in filters.statuses
        ]
    return filtered


def _metadata_in_requested_scope(
    metadata: object,
    tenant_id: str,
    workspace_id: str,
    memory_principal_key: Optional[str],
) -> bool:
    if memory_principal_key:
        return _metadata_in_memory_namespace(metadata, memory_principal_key)
    return _metadata_matches_scope(metadata, tenant_id, workspace_id)


def _collection_fact_rows(
    fact_key: str,
    tenant_id: str,
    workspace_id: str,
    memory_principal_key: Optional[str] = None,
) -> Dict[str, Any]:
    where = (
        {"fact_key": str(fact_key)}
        if _is_default_scope(tenant_id, workspace_id)
        else {
            "scoped_fact_key": sha256(
                f"{tenant_id}\0{workspace_id}\0{fact_key}".encode("utf-8")
            ).hexdigest()
        }
    )
    data = collection.get(
        where=where,
        include=["documents", "metadatas"],
    )
    ids = data.get("ids") or []
    documents = data.get("documents") or []
    metadatas = data.get("metadatas") or []
    selected = [
        index
        for index, metadata in enumerate(metadatas)
        if _metadata_in_requested_scope(
            metadata,
            tenant_id,
            workspace_id,
            memory_principal_key,
        )
    ]
    return {
        "ids": [ids[index] for index in selected if index < len(ids)],
        "documents": [documents[index] for index in selected if index < len(documents)],
        "metadatas": [metadatas[index] for index in selected],
    }


def supersede_memory_records(
    memory_ids: List[str],
    *,
    superseded_by: Optional[str] = None,
    reason: str = "explicit_correction",
    _skip_recovery: bool = False,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    quota_credential_id: Optional[str] = None,
    memory_principal_key: Optional[str] = None,
    transaction_id: Optional[str] = None,
    durable_tombstone: bool = False,
    operation_generation: Optional[int] = None,
    retired_at: Optional[str] = None,
    _lock_held: bool = False,
) -> Dict[str, Any]:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    if not _skip_recovery and not _lock_held:
        with _fact_supersession_transaction():
            _recover_fact_supersessions_locked()
            return supersede_memory_records(
                memory_ids,
                superseded_by=superseded_by,
                reason=reason,
                _skip_recovery=False,
                tenant_id=tenant,
                workspace_id=workspace,
                quota_credential_id=quota_credential_id,
                memory_principal_key=memory_principal_key,
                transaction_id=transaction_id,
                durable_tombstone=durable_tombstone,
                operation_generation=operation_generation,
                retired_at=retired_at,
                _lock_held=True,
            )
    if len(memory_ids) > MAX_SUPERSESSION_RECORDS:
        raise ValueError("supersession record count exceeds its immutable bound")
    ids: List[str] = []
    seen_ids = set()
    for raw_value in memory_ids:
        value = str(raw_value or "").strip()
        if not value:
            continue
        if len(value.encode("utf-8")) > MAX_SUPERSESSION_ID_BYTES:
            raise ValueError("memory ID exceeds its immutable byte bound")
        if value not in seen_ids:
            seen_ids.add(value)
            ids.append(value)
    normalized_superseded_by = (
        str(superseded_by).strip() if superseded_by is not None else None
    )
    if normalized_superseded_by is not None and (
        not normalized_superseded_by
        or len(normalized_superseded_by.encode("utf-8"))
        > MAX_SUPERSESSION_ID_BYTES
    ):
        raise ValueError("superseded_by exceeds its immutable byte bound")
    normalized_reason = str(reason or "explicit_correction").strip() or "explicit_correction"
    if len(normalized_reason.encode("utf-8")) > 240:
        raise ValueError("supersession reason exceeds its immutable byte bound")
    if not ids:
        return {
            "updated": 0,
            "ids": [],
            "missing": [],
            "primary_updated": 0,
            "fallback_updated": 0,
            "superseded_by": normalized_superseded_by,
        }
    try:
        get_kwargs: Dict[str, Any] = {"ids": ids, "include": ["metadatas"]}
        namespace_where = _memory_namespace_where(memory_principal_key)
        if namespace_where:
            get_kwargs["where"] = namespace_where
        data = collection.get(**get_kwargs)
    except Exception as exc:
        # A failed authoritative lookup is not evidence that the requested
        # records are missing. Applying a fallback-only marker while the
        # primary state is unknown could leave a current Chroma row visible.
        raise FactSupersessionError(
            "primary memory lookup failed during supersession"
        ) from exc
    found_ids = data.get("ids") or []
    metas = data.get("metadatas") or []
    updated = []
    scoped_ids = []
    for index, memory_id in enumerate(found_ids):
        prior_metadata = metas[index] if index < len(metas) else {}
        if not _metadata_in_requested_scope(
            prior_metadata,
            tenant,
            workspace,
            memory_principal_key,
        ):
            continue
        metadata = _normalize_memory_metadata(
            prior_metadata, tenant_id=tenant, workspace_id=workspace
        )
        metadata.update({
            "memory_status": "superseded",
            "superseded": True,
            "superseded_at": _utc_iso(),
            "supersession_reason": normalized_reason,
        })
        _close_temporal_validity(metadata, str(metadata["superseded_at"]))
        if normalized_superseded_by:
            metadata["superseded_by"] = normalized_superseded_by
        _validate_memory_metadata(metadata)
        updated.append(metadata)
        scoped_ids.append(memory_id)
    fallback_matched: List[str] = []
    if not _skip_recovery:
        requested = set(ids)
        fallback_matched = sorted(
            requested
            & {
                str(row.get("id") or "")
                for row in _read_fallback_rows(
                    limit=_FALLBACK_MAX_ROWS,
                    tenant_id=tenant,
                    workspace_id=workspace,
                    memory_principal_key=memory_principal_key,
                    _strict=True,
                )
                if _metadata_in_requested_scope(
                    row.get("metadata"),
                    tenant,
                    workspace,
                    memory_principal_key,
                )
            }
        )
    if scoped_ids or fallback_matched or durable_tombstone:
        resolved_transaction_id = str(transaction_id or uuid.uuid4().hex)
        if not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", resolved_transaction_id
        ):
            raise ValueError("supersession transaction_id is invalid")
        journal_entry: Dict[str, Any] = {
            "version": 3,
            "operation": "retire_ids",
            "transaction_id": resolved_transaction_id,
            "memory_ids": ids,
            "superseded_by": normalized_superseded_by,
            "reason": normalized_reason,
            "created_at": _utc_iso(),
            "tenant_id": tenant,
            "workspace_id": workspace,
            "memory_principal_key": str(memory_principal_key or ""),
        }
        if isinstance(operation_generation, int) and not isinstance(operation_generation, bool):
            if operation_generation < 0 or operation_generation >= 2**63:
                raise ValueError("operation_generation is outside its immutable bound")
            journal_entry["operation_generation"] = operation_generation
        if retired_at is not None:
            normalized_retired_at = str(retired_at).strip()
            if (
                not normalized_retired_at
                or len(normalized_retired_at.encode("utf-8")) > 80
            ):
                raise ValueError("retired_at is outside its immutable bound")
            journal_entry["created_at"] = normalized_retired_at

        projected_ids, projected_metadatas = _retirement_primary_projection(
            journal_entry, data
        )
        fallback_marker = _fallback_id_tombstone_marker(
            ids,
            superseded_by=normalized_superseded_by,
            reason=normalized_reason,
            tenant_id=tenant,
            workspace_id=workspace,
            memory_principal_key=memory_principal_key,
            transaction_id=resolved_transaction_id,
            operation_generation=journal_entry.get("operation_generation"),
            stored_at=journal_entry["created_at"],
        )
        update_bytes = sum(
            len(memory_id.encode("utf-8"))
            + len(
                json.dumps(
                    prepare_memory_metadata_for_storage(metadata),
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                    allow_nan=False,
                ).encode("utf-8")
            )
            for memory_id, metadata in zip(projected_ids, projected_metadatas)
        )
        fallback_bytes = len(
            json.dumps(
                fallback_marker,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8")
        )
        charge_bytes = 4096 + update_bytes + fallback_bytes
        payload_hash = sha256(
            json.dumps(
                {
                    "version": "cortex.memory-retirement.v2",
                    "ids": projected_ids,
                    "metadatas": projected_metadatas,
                    "fallback": fallback_marker,
                },
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8")
        ).hexdigest()
        quota_transaction_id = (
            "retirement-"
            + sha256(resolved_transaction_id.encode("utf-8")).hexdigest()
        )
        quota_credential_id = (
            str(quota_credential_id or "").strip()
            or next(
                (
                    str(metadata.get("scope_credential_id") or "").strip()
                    for metadata in updated
                    if str(metadata.get("scope_credential_id") or "").strip()
                ),
                "uncredentialed",
            )
        )[:128]
        journal_entry.update({
            "quota_transaction_id": quota_transaction_id,
            "quota_charge_bytes": charge_bytes,
            "quota_payload_hash": payload_hash,
            "quota_credential_id": quota_credential_id,
        })
        try:
            journal_path = _write_fact_supersession_journal(journal_entry)
        except Exception as exc:
            raise FactSupersessionError(
                "memory retirement journal could not be persisted; records were preserved"
            ) from exc

        try:
            _recover_retirement_journal_with_quota_locked(
                journal_entry,
                journal_path,
            )
        except _RetirementJournalCleanupPending:
            if not _skip_recovery:
                raise
            # Fact-revision callers still have the durable parent journal.
            # Once both child projections committed it is safe to activate the
            # pending replacement; either journal can clean up idempotently on
            # the next recovery pass.
            pass
    affected = set(scoped_ids) | set(fallback_matched)
    affected_ids = [memory_id for memory_id in ids if memory_id in affected]
    missing = [memory_id for memory_id in ids if memory_id not in affected]
    return {
        "updated": len(affected_ids),
        "ids": affected_ids,
        "missing": missing,
        "primary_updated": len(scoped_ids),
        "fallback_updated": len(fallback_matched),
        "superseded_by": normalized_superseded_by,
    }


def _supersede_prior_fact_versions(
    fact_key: str,
    *,
    superseded_by: str,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    memory_principal_key: Optional[str] = None,
) -> int:
    if not str(fact_key or "").strip():
        return 0
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    with _fact_supersession_transaction():
        _recover_fact_supersessions_locked()
        data = _collection_fact_rows(
            str(fact_key),
            tenant,
            workspace,
            memory_principal_key,
        )
        ids = [value for value in (data.get("ids") or []) if value != superseded_by]
        return int(supersede_memory_records(
            ids,
            superseded_by=superseded_by,
            reason="newer_fact_key_revision",
            _skip_recovery=True,
            tenant_id=tenant,
            workspace_id=workspace,
            memory_principal_key=memory_principal_key,
        ).get("updated", 0))


def _add_memory_with_supersession(
    memory_id: str,
    text: str,
    metadata: Dict[str, Any],
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> None:
    """Serialize same-fact writes and journal them for crash-safe recovery."""
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    metadata = _normalize_memory_metadata(
        metadata, tenant_id=tenant, workspace_id=workspace
    )
    fact_key = str(metadata.get("fact_key") or "").strip()
    memory_principal_key = str(metadata.get("memory_principal_key") or "").strip() or None
    with _fact_supersession_transaction():
        _recover_fact_supersessions_locked()
        if not fact_key:
            collection.add(ids=[memory_id], documents=[text], metadatas=[metadata])
            return
        prior = _collection_fact_rows(
            fact_key,
            tenant,
            workspace,
            memory_principal_key,
        )
        prior_ids = [value for value in (prior.get("ids") or []) if value != memory_id]
        revision_transaction_id = uuid.uuid4().hex
        revision_created_at = _utc_iso()
        try:
            journal_path = _write_fact_supersession_journal({
                "version": 1,
                "transaction_id": revision_transaction_id,
                "fact_key": fact_key,
                "memory_id": memory_id,
                "text": text,
                "metadata": metadata,
                "created_at": revision_created_at,
                "tenant_id": tenant,
                "workspace_id": workspace,
            })
        except Exception as exc:
            raise FactSupersessionError(
                "fact supersession journal could not be persisted; existing fact was preserved"
            ) from exc
        pending_metadata = _supersession_recovery_metadata(
            metadata, stage="pending"
        )
        chroma_committed = False
        try:
            collection.add(ids=[memory_id], documents=[text], metadatas=[pending_metadata])
            supersede_memory_records(
                prior_ids,
                superseded_by=memory_id,
                reason="newer_fact_key_revision",
                _skip_recovery=True,
                tenant_id=tenant,
                workspace_id=workspace,
                memory_principal_key=memory_principal_key,
                transaction_id=_fact_revision_retirement_transaction_id(
                    revision_transaction_id
                ),
                retired_at=revision_created_at,
            )
            active_metadata = _supersession_recovery_metadata(
                metadata, stage="active"
            )
            collection.update(ids=[memory_id], metadatas=[active_metadata])
            _append_fallback_fact_supersession(
                fact_key,
                superseded_by=memory_id,
                tenant_id=tenant,
                workspace_id=workspace,
                memory_principal_key=memory_principal_key,
            )
            chroma_committed = True
        except Exception as exc:
            # The parent journal is the single durable decision once published.
            # Primary-only compensation is unsafe: the child retirement may
            # already have committed a fallback tombstone, or may replay after
            # this process exits. Keep the pending candidate and roll forward
            # the same deterministic retirement on the next recovery pass.
            raise FactSupersessionError(
                "fact supersession is incomplete; durable recovery is required"
            ) from exc
        if chroma_committed:
            try:
                _remove_fact_supersession_journal(journal_path)
            except Exception as exc:
                logger.warning(
                    "fact supersession committed; recovery journal cleanup remains pending "
                    "(journal_sha256=%s error_type=%s)",
                    sha256(journal_path.name.encode("utf-8")).hexdigest(),
                    type(exc).__name__,
                )


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _close_temporal_validity(metadata: Dict[str, Any], ended_at: str) -> None:
    if metadata.get("valid_until"):
        return
    normalized = str(ended_at or "").strip()
    parsed = datetime.fromisoformat(
        normalized[:-1] + "+00:00" if normalized.endswith("Z") else normalized
    )
    if parsed.tzinfo is None:
        raise ValueError("temporal retirement timestamp must include a timezone")
    parsed = parsed.astimezone(timezone.utc)
    metadata["valid_until"] = parsed.isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )
    metadata["valid_until_epoch"] = int(parsed.timestamp())
    if metadata.get("valid_from"):
        metadata["valid_time_state"] = "bounded"
        metadata["valid_time_known"] = True
    else:
        metadata["valid_time_state"] = "unknown_start"
        metadata["valid_time_known"] = False


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _tokenize(text: str) -> List[str]:
    return [t for t in re.findall(r"[a-zA-Z0-9_]+", (text or "").lower()) if len(t) >= 3]


def _fingerprint(text: str) -> str:
    normalized = " ".join(_tokenize(text))
    return sha256(normalized.encode("utf-8")).hexdigest()[:16]


def _novelty_bucket(score: float) -> str:
    if score >= 0.85:
        return "high"
    if score >= 0.60:
        return "medium"
    return "low"


def _mark_embedding_error(exc: Exception) -> None:
    with _EMBEDDING_HEALTH_LOCK:
        _EMBEDDING_HEALTH["status"] = "degraded"
        _EMBEDDING_HEALTH["last_error"] = str(exc)[:320]
        _EMBEDDING_HEALTH["last_error_at"] = _utc_iso()


def _mark_fallback_write() -> None:
    with _EMBEDDING_HEALTH_LOCK:
        _EMBEDDING_HEALTH["fallback_writes"] = int(_EMBEDDING_HEALTH.get("fallback_writes", 0)) + 1


def _mark_fallback_search() -> None:
    with _EMBEDDING_HEALTH_LOCK:
        _EMBEDDING_HEALTH["fallback_searches"] = int(_EMBEDDING_HEALTH.get("fallback_searches", 0)) + 1


def _embedding_health_snapshot() -> Dict[str, Any]:
    with _EMBEDDING_HEALTH_LOCK:
        return dict(_EMBEDDING_HEALTH)


def _fallback_store_lock_path() -> Path:
    return _FALLBACK_LOG_PATH.with_name(f".{_FALLBACK_LOG_PATH.name}.lock")


@contextmanager
def _fallback_store_transaction():
    with _FALLBACK_STORE_LOCK:
        parent_existed = _FALLBACK_LOG_PATH.parent.exists()
        _FALLBACK_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        if not parent_existed:
            _sync_directory(_FALLBACK_LOG_PATH.parent.parent)
        lock_path = _fallback_store_lock_path()
        flags = os.O_WRONLY | os.O_CREAT
        if hasattr(os, "O_CLOEXEC"):
            flags |= os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(lock_path, flags, 0o600)
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise FallbackPersistenceError("fallback lock must be a regular file")
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)


def _fallback_tail_bytes(path: Path, max_bytes: int) -> bytes:
    if not path.exists() or max_bytes <= 0:
        return b""
    with path.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
        size = handle.tell()
        start = max(0, size - max_bytes)
        handle.seek(start)
        payload = handle.read(max_bytes)
    if start > 0:
        _, separator, payload = payload.partition(b"\n")
        if not separator:
            return b""
    return payload


def _bounded_fallback_payload(new_row: bytes) -> bytes:
    retain_bytes = max(0, _FALLBACK_MAX_BYTES - len(new_row))
    retained = _fallback_tail_bytes(_FALLBACK_LOG_PATH, retain_bytes)
    retained_lines = retained.splitlines(keepends=True)
    if len(retained_lines) >= _FALLBACK_MAX_ROWS:
        retained_lines = retained_lines[-max(0, _FALLBACK_MAX_ROWS - 1):]
    return b"".join(retained_lines) + new_row


def _atomic_replace_fallback(payload: bytes) -> None:
    temporary_path = _FALLBACK_LOG_PATH.with_name(
        f".{_FALLBACK_LOG_PATH.name}.{uuid.uuid4().hex}.tmp"
    )
    descriptor = -1
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_CLOEXEC"):
            flags |= os.O_CLOEXEC
        descriptor = os.open(temporary_path, flags, 0o600)
        view = memoryview(payload)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise OSError("fallback rewrite made no progress")
            view = view[written:]
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary_path, _FALLBACK_LOG_PATH)
        _sync_directory(_FALLBACK_LOG_PATH.parent)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass


def _append_fallback_row(row: Dict[str, Any]) -> None:
    try:
        encoded = (
            json.dumps(row, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            + "\n"
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise FallbackPersistenceError("fallback row is not finite JSON") from exc
    if len(encoded) > _FALLBACK_MAX_ROW_BYTES or len(encoded) > _FALLBACK_MAX_BYTES:
        raise FallbackPersistenceError("fallback row exceeds the configured byte quota")
    if _FALLBACK_MAX_ROWS <= 0 or _FALLBACK_MAX_BYTES <= 0:
        raise FallbackPersistenceError("fallback retention limits must be positive")

    try:
        with _fallback_store_transaction():
            if _FALLBACK_LOG_PATH.exists():
                info = _FALLBACK_LOG_PATH.lstat()
                if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                    raise FallbackPersistenceError("fallback store must be a regular file")
            file_existed = _FALLBACK_LOG_PATH.exists()
            current_size = _FALLBACK_LOG_PATH.stat().st_size if file_existed else 0
            should_rewrite = current_size + len(encoded) > _FALLBACK_MAX_BYTES
            if not should_rewrite and _FALLBACK_LOG_PATH.exists():
                recent = _fallback_tail_bytes(
                    _FALLBACK_LOG_PATH,
                    min(current_size, _FALLBACK_READ_MAX_BYTES),
                )
                should_rewrite = recent.count(b"\n") >= _FALLBACK_MAX_ROWS
            if should_rewrite:
                _atomic_replace_fallback(_bounded_fallback_payload(encoded))
                return

            flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT
            if hasattr(os, "O_CLOEXEC"):
                flags |= os.O_CLOEXEC
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            descriptor = os.open(_FALLBACK_LOG_PATH, flags, 0o600)
            try:
                if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                    raise FallbackPersistenceError("fallback store must be a regular file")
                view = memoryview(encoded)
                while view:
                    written = os.write(descriptor, view)
                    if written <= 0:
                        raise OSError("fallback append made no progress")
                    view = view[written:]
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            if not file_existed:
                _sync_directory(_FALLBACK_LOG_PATH.parent)
    except FallbackPersistenceError:
        raise
    except Exception as exc:
        raise FallbackPersistenceError("fallback store could not durably commit the row") from exc


def _raw_fallback_rows(limit: int, *, strict: bool = False) -> List[Dict[str, Any]]:
    if not _FALLBACK_LOG_PATH.exists():
        return []
    max_lines = max(32, min(_FALLBACK_MAX_ROWS, max(1, int(limit)) * 4))
    if strict:
        # Health and lifecycle mutation must validate the complete bounded log,
        # not merely the searchable tail.  Otherwise corruption outside the
        # read window can be reported as a healthy/readable fallback store.
        return _quota_fallback_rows()[-max_lines:]
    try:
        payload = _fallback_tail_bytes(
            _FALLBACK_LOG_PATH,
            min(_FALLBACK_MAX_BYTES, _FALLBACK_READ_MAX_BYTES),
        )
    except OSError as exc:
        if strict:
            raise FallbackPersistenceError("fallback lifecycle store is unreadable") from exc
        return []
    rows: List[Dict[str, Any]] = []
    for line in payload.splitlines()[-max_lines:]:
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        rows.append(obj)
    return rows


def _quota_fallback_rows() -> List[Dict[str, Any]]:
    """Return the complete bounded fallback lifecycle for quota reconciliation."""

    if not _FALLBACK_LOG_PATH.exists():
        return []
    try:
        with _fallback_store_transaction():
            if not _FALLBACK_LOG_PATH.exists():
                return []
            info = _FALLBACK_LOG_PATH.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                raise FallbackPersistenceError("fallback store must be a regular file")
            if int(info.st_size) > _FALLBACK_MAX_BYTES:
                raise FallbackPersistenceError("fallback store exceeds its configured byte quota")
            with _FALLBACK_LOG_PATH.open("rb") as handle:
                payload = handle.read(_FALLBACK_MAX_BYTES + 1)
            if len(payload) > _FALLBACK_MAX_BYTES:
                raise FallbackPersistenceError("fallback store exceeds its configured byte quota")
    except FallbackPersistenceError:
        raise
    except OSError as exc:
        raise FallbackPersistenceError("fallback lifecycle store is unreadable") from exc

    rows: List[Dict[str, Any]] = []
    for line in payload.splitlines():
        try:
            row = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise FallbackPersistenceError("fallback lifecycle store contains an invalid row") from exc
        if not isinstance(row, dict):
            raise FallbackPersistenceError("fallback lifecycle store contains an invalid row")
        rows.append(row)
    if len(rows) > _FALLBACK_MAX_ROWS:
        raise FallbackPersistenceError("fallback lifecycle store exceeds its configured row quota")
    return rows


def _read_fallback_rows(
    limit: int = 200,
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    memory_principal_key: Optional[str] = None,
    include_historical: bool = False,
    _strict: bool = False,
) -> List[Dict[str, Any]]:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    rows = [
        row
        for row in _raw_fallback_rows(limit, strict=_strict)
        if _metadata_matches_scope(
            row.get("metadata") or row,
            tenant,
            workspace,
        )
        and _metadata_in_memory_namespace(
            row.get("metadata") or row,
            memory_principal_key,
        )
    ]
    id_supersessions: Dict[str, Dict[str, Any]] = {}
    latest_fact_event: Dict[str, tuple[str, str, Dict[str, Any]]] = {}
    for row in rows:
        kind = str(row.get("kind") or "memory")
        if kind == "id_supersession":
            for value in row.get("memory_ids", []) or []:
                id_supersessions[str(value)] = row
            continue
        fact_key = str(row.get("fact_key") or (row.get("metadata") or {}).get("fact_key") or "").strip()
        if not fact_key:
            continue
        if kind == "fact_supersession":
            latest_fact_event[fact_key] = (
                "marker",
                str(row.get("superseded_by") or ""),
                row,
            )
        else:
            latest_fact_event[fact_key] = (
                "memory",
                str(row.get("id") or ""),
                row,
            )

    visible: List[Dict[str, Any]] = []
    for row in rows:
        if str(row.get("kind") or "memory") != "memory":
            continue
        memory_id = str(row.get("id") or "")
        metadata = dict(row.get("metadata") or {})
        fact_key = str(metadata.get("fact_key") or "").strip()
        fact_event = latest_fact_event.get(fact_key) if fact_key else None
        supersession = id_supersessions.get(memory_id)
        if supersession is None and fact_event is not None:
            event_kind, event_id, event = fact_event
            if event_kind != "memory" or event_id != memory_id:
                supersession = event

        already_inactive = (
            bool(metadata.get("supersession_pending"))
            or _memory_status(metadata) != "active"
        )
        if supersession is None and not already_inactive:
            visible.append(row)
            continue
        if not include_historical or bool(metadata.get("supersession_pending")):
            continue

        historical_metadata = dict(metadata)
        if supersession is not None:
            historical_metadata["memory_status"] = "superseded"
            historical_metadata["superseded"] = True
            superseded_by = str(supersession.get("superseded_by") or "").strip()
            if superseded_by:
                historical_metadata["superseded_by"] = superseded_by
            reason = str(supersession.get("reason") or "").strip()
            if reason:
                historical_metadata["supersession_reason"] = reason
            superseded_at = str(supersession.get("stored_at") or "").strip()
            if superseded_at:
                historical_metadata["superseded_at"] = superseded_at
                _close_temporal_validity(historical_metadata, superseded_at)
        else:
            historical_metadata["memory_status"] = _memory_status(metadata)
        visible.append({**row, "metadata": historical_metadata})
    return visible[-max(1, int(limit)):]


def delete_principal_memory_projections(principal) -> Dict[str, int]:
    """Delete one authenticated principal's semantic and fallback projections.

    A governance deletion fence must be created by the caller before invoking
    this function.  Source-of-record files are deliberately out of scope.
    """

    where = principal_memory_where(principal)
    with _fact_supersession_transaction():
        _recover_fact_supersessions_locked()
        data = collection.get(where=where, include=["metadatas"])
        ids = [str(item) for item in (data.get("ids") or [])]
        metadatas = data.get("metadatas") or []
        if len(ids) != len(metadatas) or any(
            not _metadata_in_requested_scope(
                metadata,
                principal.tenant_id,
                principal.storage_workspace_id,
                principal.memory_principal_key,
            )
            for metadata in metadatas
        ):
            raise MemoryGovernanceError(
                "semantic deletion scan violated the authenticated principal scope"
            )
        if ids:
            collection.delete(ids=ids)

    fallback_deleted = 0
    with _fallback_store_transaction():
        rows: List[Dict[str, Any]] = []
        if _FALLBACK_LOG_PATH.exists():
            info = _FALLBACK_LOG_PATH.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                raise MemoryGovernanceError("fallback store is not a regular file")
            if int(info.st_size) > _FALLBACK_MAX_BYTES:
                raise MemoryGovernanceError("fallback store exceeds its configured bound")
            raw_payload = _FALLBACK_LOG_PATH.read_bytes()
            for raw_line in raw_payload.splitlines():
                try:
                    row = json.loads(raw_line)
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise MemoryGovernanceError("fallback store contains an invalid row") from exc
                if not isinstance(row, dict):
                    raise MemoryGovernanceError("fallback store contains an invalid row")
                rows.append(row)
        retained: List[Dict[str, Any]] = []
        for row in rows:
            metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else row
            if _metadata_in_requested_scope(
                metadata,
                principal.tenant_id,
                principal.storage_workspace_id,
                principal.memory_principal_key,
            ):
                fallback_deleted += 1
            else:
                retained.append(row)
        payload = b"".join(
            (
                json.dumps(
                    row,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    allow_nan=False,
                )
                + "\n"
            ).encode("utf-8")
            for row in retained
        )
        if len(payload) > _FALLBACK_MAX_BYTES:
            raise MemoryGovernanceError(
                "retained fallback projection exceeds the configured bound"
            )
        if _FALLBACK_LOG_PATH.exists() or payload:
            _atomic_replace_fallback(payload)
    return {"semantic_records": len(ids), "fallback_rows": fallback_deleted}


def _append_fallback_fact_supersession(
    fact_key: str,
    *,
    superseded_by: str,
    tenant_id: str,
    workspace_id: str,
    memory_principal_key: Optional[str] = None,
) -> None:
    active = _read_fallback_rows(
        limit=_FALLBACK_MAX_ROWS,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        memory_principal_key=memory_principal_key,
        _strict=True,
    )
    if not any(str((row.get("metadata") or {}).get("fact_key") or "") == fact_key for row in active):
        return
    marker = {
        "kind": "fact_supersession",
        "fact_key": fact_key,
        "superseded_by": superseded_by,
        "tenant_id": tenant_id,
        "workspace_id": workspace_id,
        "stored_at": _utc_iso(),
    }
    if memory_principal_key:
        marker["memory_principal_key"] = memory_principal_key
    _append_fallback_row(marker)


def _append_fallback_id_supersession(
    memory_ids: List[str],
    *,
    superseded_by: Optional[str],
    reason: str,
    tenant_id: str,
    workspace_id: str,
    memory_principal_key: Optional[str] = None,
) -> None:
    requested = {str(value) for value in memory_ids}
    active_ids = {
        str(row.get("id") or "")
        for row in _read_fallback_rows(
            limit=_FALLBACK_MAX_ROWS,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            memory_principal_key=memory_principal_key,
            _strict=True,
        )
    }
    matched = sorted(requested & active_ids)
    if not matched:
        return
    _append_fallback_id_tombstone(
        matched,
        superseded_by=superseded_by,
        reason=reason,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        memory_principal_key=memory_principal_key,
        transaction_id="legacy-" + uuid.uuid4().hex,
    )


def _fallback_id_tombstone_marker(
    memory_ids: List[str],
    *,
    superseded_by: Optional[str],
    reason: str,
    tenant_id: str,
    workspace_id: str,
    memory_principal_key: Optional[str],
    transaction_id: str,
    operation_generation: Optional[int],
    stored_at: str,
) -> Dict[str, Any]:
    marker: Dict[str, Any] = {
        "kind": "id_supersession",
        "memory_ids": sorted({str(value) for value in memory_ids if str(value)}),
        "superseded_by": superseded_by,
        "reason": str(reason or "explicit_correction")[:240],
        "tenant_id": tenant_id,
        "workspace_id": workspace_id,
        "stored_at": stored_at,
        "transaction_id": transaction_id,
    }
    if memory_principal_key:
        marker["memory_principal_key"] = memory_principal_key
    if isinstance(operation_generation, int) and not isinstance(operation_generation, bool):
        marker["operation_generation"] = operation_generation
    return marker


def _append_fallback_id_tombstone(
    memory_ids: List[str],
    *,
    superseded_by: Optional[str],
    reason: str,
    tenant_id: str,
    workspace_id: str,
    memory_principal_key: Optional[str],
    transaction_id: str,
    operation_generation: Optional[int] = None,
    stored_at: Optional[str] = None,
) -> None:
    """Append one replay-idempotent ID tombstone, even before a row exists."""

    normalized_ids = sorted({str(value) for value in memory_ids if str(value)})
    if not normalized_ids:
        return
    marker = _fallback_id_tombstone_marker(
        normalized_ids,
        superseded_by=superseded_by,
        reason=reason,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        memory_principal_key=memory_principal_key,
        transaction_id=transaction_id,
        operation_generation=operation_generation,
        stored_at=str(stored_at or _utc_iso()),
    )
    for row in _raw_fallback_rows(_FALLBACK_MAX_ROWS, strict=True):
        if (
            str(row.get("kind") or "") == "id_supersession"
            and str(row.get("transaction_id") or "") == transaction_id
            and _metadata_matches_scope(row, tenant_id, workspace_id)
            and _metadata_in_memory_namespace(row, memory_principal_key)
        ):
            immutable_fields = (
                "memory_ids", "superseded_by", "reason", "tenant_id",
                "workspace_id", "stored_at", "transaction_id",
                "memory_principal_key", "operation_generation",
            )
            if any(row.get(field) != marker.get(field) for field in immutable_fields):
                raise FallbackPersistenceError(
                    "fallback lifecycle transaction conflicts with durable state"
                )
            return
    _append_fallback_row(marker)


def _fallback_store_appendable() -> bool:
    """Probe fallback appendability without creating or changing the store."""
    path = _FALLBACK_LOG_PATH
    try:
        path_info = path.lstat()
    except FileNotFoundError:
        # A missing file can be created only in an existing writable/searchable
        # directory. The writer creates missing parents, so walk to the nearest
        # existing ancestor and ensure every missing component is creatable.
        parent = path.parent
        while True:
            try:
                parent_info = parent.stat()
                break
            except FileNotFoundError:
                next_parent = parent.parent
                if next_parent == parent:
                    return False
                parent = next_parent
            except OSError:
                return False
        return (
            stat.S_ISDIR(parent_info.st_mode)
            and os.access(parent, os.W_OK | os.X_OK)
        )
    except OSError:
        return False

    # Fallback logs are ordinary files. Refuse symlinks and special files even
    # when opening them for append would technically succeed.
    if stat.S_ISLNK(path_info.st_mode) or not stat.S_ISREG(path_info.st_mode):
        return False

    flags = os.O_WRONLY | os.O_APPEND
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError:
        return False
    try:
        return stat.S_ISREG(os.fstat(descriptor).st_mode)
    finally:
        os.close(descriptor)


async def _collection_available() -> bool:
    """Probe persistent semantic storage without blocking the event loop."""
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    count_probe = collection.count

    def complete(value: Optional[int], error: Optional[BaseException]) -> None:
        if future.done():
            return
        if error is not None:
            future.set_exception(error)
        else:
            future.set_result(value)

    def run_probe() -> None:
        try:
            value = count_probe()
            outcome = (value, None)
        except BaseException as exc:
            outcome = (None, exc)
        try:
            loop.call_soon_threadsafe(complete, *outcome)
        except RuntimeError:
            # The request timed out and its event loop has already closed.
            pass

    threading.Thread(
        target=run_probe,
        name="librarian-health",
        daemon=True,
    ).start()
    try:
        count = await asyncio.wait_for(
            future,
            timeout=_COLLECTION_HEALTH_TIMEOUT_SECONDS,
        )
        return int(count) >= 0
    except Exception:
        return False


def probe_memory_backend_readiness() -> Dict[str, Any]:
    """Actively verify the durable path and authoritative Chroma collection."""

    probe_id = f"readiness-{uuid.uuid4().hex}"
    probe_collection = None
    try:
        _validate_chroma_storage(CHROMA_DIR)
        backend = (
            get_memory_backend()
            if isinstance(client, _LazyMemoryResource)
            else None
        )
        chroma_client = backend.client if backend is not None else client
        embedding_function = backend.embed_fn if backend is not None else embed_fn
        memory_collection = backend.collection if backend is not None else collection
        authoritative_collection = (
            _load_memory_collection(chroma_client, embedding_function)
            if _production_memory_mode()
            else memory_collection
        )
        count = int(authoritative_collection.count())
        if count < 0:
            raise RuntimeError("memory collection returned an invalid count")
        if _production_memory_mode():
            probe_collection = chroma_client.get_collection(
                name=READINESS_COLLECTION_NAME,
                embedding_function=None,
            )
        else:
            probe_collection = chroma_client.get_or_create_collection(
                name=READINESS_COLLECTION_NAME,
                embedding_function=None,
            )
        probe_collection.upsert(
            ids=[probe_id],
            embeddings=[[0.0]],
            documents=["Cortex memory durability readiness probe"],
            metadatas=[{"probe": True}],
        )
        written = probe_collection.get(ids=[probe_id])
        if probe_id not in list(written.get("ids") or []):
            raise RuntimeError("memory readiness probe was not readable after write")
        probe_collection.delete(ids=[probe_id])
        probe_collection = None
        return {
            "ok": True,
            "status": "healthy",
            "backend": "chroma_persistent",
            "count": count,
            "path": CHROMA_DIR,
        }
    except Exception as exc:
        return {
            "ok": False,
            "status": "degraded",
            "backend": "chroma_persistent",
            "error": f"{type(exc).__name__}: {exc}",
            "path": CHROMA_DIR,
        }
    finally:
        if probe_collection is not None:
            try:
                probe_collection.delete(ids=[probe_id])
            except Exception:
                pass


def _configured_local_file_memory_roots(
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> List[Path]:
    """Return durable local memory roots for lexical recall fallback.

    Chroma is the primary recall path, but operational hard memory in this
    workspace also lives as markdown ledgers under /root/clawd/memory and
    /root/clawd/clients.  Keep this fallback narrow: do not include MEMORY.md
    by default because it is main-session personal context and can be more
    sensitive than project/client ledgers.
    """
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    if _is_default_scope(tenant, workspace):
        raw = os.getenv(_LOCAL_FILE_MEMORY_ROOTS_ENV, "")
        values = [part.strip() for part in raw.split(os.pathsep) if part.strip()] if raw else list(_DEFAULT_LOCAL_FILE_MEMORY_ROOTS)
    else:
        raw_mapping = os.getenv(_SCOPED_LOCAL_FILE_MEMORY_ROOTS_ENV, "").strip()
        try:
            mapping = json.loads(raw_mapping) if raw_mapping else {}
        except json.JSONDecodeError:
            logger.warning("ignoring invalid %s JSON", _SCOPED_LOCAL_FILE_MEMORY_ROOTS_ENV)
            mapping = {}
        configured = mapping.get(_scope_key(tenant, workspace), []) if isinstance(mapping, dict) else []
        values = configured if isinstance(configured, list) else []
    roots: List[Path] = []
    for value in values:
        try:
            path = Path(value).expanduser().resolve()
            exists = path.exists()
        except Exception:
            continue
        if exists and path not in roots:
            roots.append(path)
    return roots


def _iter_local_file_memory_paths(
    scan_limit: int = _LOCAL_FILE_MEMORY_MAX_FILES,
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> List[Path]:
    files: List[Path] = []
    for root in _configured_local_file_memory_roots(
        tenant_id=tenant_id,
        workspace_id=workspace_id,
    ):
        try:
            if root.is_file():
                candidates = [root]
            else:
                candidates = [p for p in root.rglob("*") if p.is_file()]
        except Exception:
            continue
        for candidate in candidates:
            if candidate.name.startswith("."):
                continue
            if candidate.suffix.lower() not in _LOCAL_FILE_MEMORY_EXTENSIONS:
                continue
            if any(part in {".git", "node_modules", "__pycache__"} for part in candidate.parts):
                continue
            try:
                if candidate.stat().st_size > _LOCAL_FILE_MEMORY_MAX_BYTES:
                    continue
            except Exception:
                continue
            files.append(candidate)
    try:
        files = sorted(set(files), key=lambda p: p.stat().st_mtime, reverse=True)
    except Exception:
        files = sorted(set(files), key=lambda p: str(p))
    return files[: max(1, int(scan_limit))]


def _display_local_file_path(path: Path) -> str:
    try:
        return str(path.relative_to(Path("/root/clawd")))
    except Exception:
        return str(path)


def _has_specific_local_file_query_overlap(query: str, text: str) -> bool:
    query_tokens = {token for token in _tokenize(query) if token not in _LOW_SIGNAL_LOCAL_MEMORY_QUERY_TOKENS}
    if not query_tokens:
        return False
    text_tokens = set(_tokenize(text))
    return bool(query_tokens & text_tokens)


def _is_markdown_heading(line: str) -> bool:
    return bool(re.match(r"^\s{0,3}#{1,6}\s+", line or ""))


def _local_file_memory_chunk(lines: List[str], index: int, window: int = 2) -> str:
    """Return a compact chunk without crossing markdown section boundaries.

    The previous line-window fallback could blend an old negative section with a
    following correction heading (or vice versa), which made stale notes look
    fresh.  Prefer the nearest heading plus nearby lines from the same section.
    """
    if index < 0 or index >= len(lines):
        return ""

    start = index
    if _is_markdown_heading(lines[index]):
        start = index
    else:
        cursor = index - 1
        remaining = int(window)
        while cursor >= 0 and remaining > 0:
            start = cursor
            if _is_markdown_heading(lines[cursor]):
                break
            cursor -= 1
            remaining -= 1

    end = index + 1
    cursor = index + 1
    remaining = int(window)
    while cursor < len(lines) and remaining > 0:
        if _is_markdown_heading(lines[cursor]):
            break
        end = cursor + 1
        cursor += 1
        remaining -= 1

    return "\n".join(l.strip() for l in lines[start:end] if l.strip()).strip()


def _best_local_file_memory_chunks(query: str, path: Path, max_chunks: int = 2) -> List[Dict[str, Any]]:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []
    if not text.strip():
        return []

    lines = text.splitlines()
    scored: List[Dict[str, Any]] = []
    for index, line in enumerate(lines):
        if not line.strip():
            continue
        chunk = _local_file_memory_chunk(lines, index)
        if not chunk:
            continue
        score = _lexical_score(query, chunk)
        if score < _LOCAL_FILE_MEMORY_MIN_SCORE:
            continue
        if not _has_specific_local_file_query_overlap(query, chunk):
            continue
        scored.append({"line": index + 1, "text": chunk[:1200], "score": score})

    dedup: Dict[str, Dict[str, Any]] = {}
    for item in scored:
        fp = _fingerprint(item["text"])
        prev = dedup.get(fp)
        if prev is None or float(item["score"]) > float(prev["score"]):
            dedup[fp] = item

    return sorted(dedup.values(), key=lambda item: float(item["score"]), reverse=True)[: max(1, int(max_chunks))]


def _local_file_memory_search_rows(
    query: str,
    n_results: int = 5,
    scan_limit: int = _LOCAL_FILE_MEMORY_MAX_FILES,
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    rows: List[Dict[str, Any]] = []
    for path in _iter_local_file_memory_paths(
        scan_limit=scan_limit,
        tenant_id=tenant,
        workspace_id=workspace,
    ):
        for chunk in _best_local_file_memory_chunks(query, path, max_chunks=2):
            score = float(chunk["score"])
            rel_path = _display_local_file_path(path)
            rows.append(
                {
                    "id": f"local-file-{_fingerprint(str(path))}-{chunk['line']}",
                    "text": chunk["text"],
                    "distance": round(max(0.0, 1.0 - score), 4),
                    "metadata": {
                        "source": "local_file_memory",
                        "quality": "curated" if ("/memory/projects/" in str(path) or "/clients/" in str(path)) else "file_memory",
                        "recall_mode": "local_file_lexical_fallback",
                        "path": str(path),
                        "relPath": rel_path,
                        "line": int(chunk["line"]),
                        "lexical_score": round(score, 4),
                        "tags": ["local_file_memory", "durable_memory"],
                        "tenant_id": tenant,
                        "workspace_id": workspace,
                        "memory_scope_key": _scope_key(tenant, workspace),
                    },
                    "_score": score,
                }
            )

    dedup: Dict[str, Dict[str, Any]] = {}
    for item in rows:
        key = f"{(item.get('metadata') or {}).get('relPath')}:{(item.get('metadata') or {}).get('line')}:{_fingerprint(str(item.get('text') or ''))}"
        prev = dedup.get(key)
        if prev is None or float(item.get("_score", 0.0)) > float(prev.get("_score", 0.0)):
            dedup[key] = item

    ordered = sorted(dedup.values(), key=lambda x: float(x.get("_score", 0.0)), reverse=True)
    return ordered[: max(1, int(n_results))]


def _safe_recent_docs(
    limit: int = 25,
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    memory_principal_key: Optional[str] = None,
) -> List[Dict[str, Any]]:
    cap = max(1, min(int(limit), 200))
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    try:
        kwargs: Dict[str, Any] = {"limit": cap, "include": ["documents", "metadatas"]}
        where = _memory_query_where(tenant, workspace, memory_principal_key)
        if where:
            kwargs["where"] = where
        data = collection.get(**kwargs)
    except Exception:
        return []

    ids = data.get("ids") or []
    docs = data.get("documents") or []
    metas = data.get("metadatas") or []

    out: List[Dict[str, Any]] = []
    for i, _id in enumerate(ids):
        metadata = metas[i] if i < len(metas) else {}
        if not _metadata_in_requested_scope(
            metadata,
            tenant,
            workspace,
            memory_principal_key,
        ) or not _memory_visible_for_query("", metadata):
            continue
        out.append(
            {
                "id": _id,
                "document": docs[i] if i < len(docs) else "",
                "metadata": metadata,
            }
        )
    return out


def _fingerprint_exists(
    fp: str,
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    memory_principal_key: Optional[str] = None,
) -> bool:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    try:
        scoped_fp = sha256(f"{tenant}\0{workspace}\0{fp}".encode("utf-8")).hexdigest()
        where = (
            {"novelty_fingerprint": fp}
            if _is_default_scope(tenant, workspace)
            else {"scoped_novelty_fingerprint": scoped_fp}
        )
        probe = collection.get(
            where=_combine_memory_where(where, memory_principal_key),
            limit=10,
            include=["metadatas"],
        )
    except Exception:
        return False
    metas = probe.get("metadatas") or []
    return any(
        _metadata_in_requested_scope(
            meta,
            tenant,
            workspace,
            memory_principal_key,
        )
        and _memory_visible_for_query("", meta)
        for meta in metas
    )


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    union = len(a | b)
    if union <= 0:
        return 0.0
    return len(a & b) / float(union)


def _estimate_novelty(
    text: str,
    recent_rows: List[Dict[str, Any]],
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    memory_principal_key: Optional[str] = None,
) -> float:
    text_tokens = set(_tokenize(text))
    if not text_tokens:
        return 0.5

    text_fp = _fingerprint(text)
    if _fingerprint_exists(
        text_fp,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        memory_principal_key=memory_principal_key,
    ):
        return 0.0

    if not recent_rows:
        return 1.0
    max_overlap = 0.0
    max_jaccard = 0.0

    for row in recent_rows:
        row_doc = str(row.get("document") or "")
        if text_fp == _fingerprint(row_doc):
            return 0.0

        doc_tokens = set(_tokenize(row_doc))
        if not doc_tokens:
            continue

        overlap = len(text_tokens & doc_tokens) / float(max(1, len(text_tokens)))
        if overlap > max_overlap:
            max_overlap = overlap

        jac = _jaccard(text_tokens, doc_tokens)
        if jac > max_jaccard:
            max_jaccard = jac

    similarity = (0.65 * max_jaccard) + (0.35 * max_overlap)
    novelty = 1.0 - similarity

    # Short snippets are often deceptively unique; damp their score.
    if len(text_tokens) < 6:
        novelty = min(novelty, 0.75)

    return round(_clamp01(novelty), 4)


def _build_novel_metadata(
    text: str,
    metadata: Optional[Dict[str, Any]] = None,
    novelty_tags: Optional[List[str]] = None,
    source_scope: str = "l7",
    compare_window: int = 40,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    memory_principal_key: Optional[str] = None,
) -> Dict[str, Any]:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    existing = dict(metadata or {})
    recent = _safe_recent_docs(
        compare_window,
        tenant_id=tenant,
        workspace_id=workspace,
        memory_principal_key=memory_principal_key,
    )
    novelty_score = _estimate_novelty(
        text,
        recent,
        tenant_id=tenant,
        workspace_id=workspace,
        memory_principal_key=memory_principal_key,
    )
    fp = _fingerprint(text)

    tags = [str(t).strip() for t in (novelty_tags or []) if str(t).strip()]
    existing_tags = existing.get("novelty_tags")
    if isinstance(existing_tags, list):
        tags.extend(str(t).strip() for t in existing_tags if str(t).strip())
    tags = sorted(set(tags))

    existing.update(
        {
            "novelty_score": novelty_score,
            "novelty_bucket": _novelty_bucket(novelty_score),
            "novelty_fingerprint": fp,
            "scoped_novelty_fingerprint": sha256(
                f"{tenant}\0{workspace}\0{fp}".encode("utf-8")
            ).hexdigest(),
            "novelty_version": "l7l22.v1.2",
            "novelty_source_scope": source_scope,
            "novelty_indexed_at": _utc_iso(),
        }
    )
    if tags:
        existing["novelty_tags"] = tags

    return existing


def _persist_fallback_memory(
    memory_id: str,
    text: str,
    metadata: Optional[Dict[str, Any]] = None,
    *,
    reason: str,
    mode: str,
) -> None:
    supplied_metadata = dict(metadata or {})
    tenant, workspace = _memory_scope(
        supplied_metadata.get("tenant_id"),
        supplied_metadata.get("storage_workspace_id", supplied_metadata.get("workspace_id")),
    )
    normalized_metadata = _normalize_memory_metadata(
        supplied_metadata, tenant_id=tenant, workspace_id=workspace
    )
    row = {
        "id": memory_id,
        "text": text,
        "metadata": normalized_metadata,
        "stored_at": _utc_iso(),
        "source": "librarian_fallback_log",
        "reason": reason,
        "mode": mode,
    }
    _append_fallback_row(row)
    _mark_fallback_write()


def _persist_indexed_novelty_memory(
    memory_id: str,
    text: str,
    enriched_metadata: Dict[str, Any],
) -> Dict[str, Any]:
    try:
        _add_memory_with_supersession(
            memory_id,
            text,
            enriched_metadata,
            tenant_id=str(enriched_metadata["tenant_id"]),
            workspace_id=str(enriched_metadata["storage_workspace_id"]),
        )
        return {
            "id": memory_id,
            "status": "stored",
            "metadata": enriched_metadata,
        }
    except FactSupersessionError:
        raise
    except Exception as exc:
        _mark_embedding_error(exc)
        try:
            _persist_fallback_memory(
                memory_id,
                text,
                enriched_metadata,
                reason=str(exc),
                mode="novelty_embed",
            )
        except FallbackPersistenceError as fallback_exc:
            raise HTTPException(
                status_code=503,
                detail="semantic and fallback memory persistence are unavailable",
            ) from fallback_exc
        return {
            "id": memory_id,
            "status": "stored_fallback_lexical",
            "metadata": {
                **enriched_metadata,
                "recall_mode": "lexical_fallback",
                "fallback_reason": str(exc)[:220],
            },
        }


def _run_librarian_quota_controlled_write(
    *,
    memory_id: str,
    text: str,
    metadata: Dict[str, Any],
    tenant_id: str,
    workspace_id: str,
    publish,
):
    # L22 imports Librarian for its storage backend, so resolve the shared
    # admission API lazily after both router modules have initialized.
    from cortex_server.routers.l22 import run_l22_quota_controlled_write

    return run_l22_quota_controlled_write(
        memory_id=memory_id,
        content=text,
        metadata=metadata,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        publish=publish,
    )


def index_with_novelty(
    text: str,
    metadata: Optional[Dict[str, Any]] = None,
    novelty_tags: Optional[List[str]] = None,
    source_scope: str = "l7",
    compare_window: int = 40,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    memory_id: Optional[str] = None,
    memory_principal_key: Optional[str] = None,
) -> Dict[str, Any]:
    if not (text or "").strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    memory_id = str(memory_id or uuid.uuid4())
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    enriched_metadata = _normalize_memory_metadata(_build_novel_metadata(
        text=text,
        metadata=metadata,
        novelty_tags=novelty_tags,
        source_scope=source_scope,
        compare_window=compare_window,
        tenant_id=tenant,
        workspace_id=workspace,
        memory_principal_key=memory_principal_key,
    ), tenant_id=tenant, workspace_id=workspace)

    return _persist_indexed_novelty_memory(memory_id, text, enriched_metadata)


def _relevance_from_distance(distance: float) -> float:
    try:
        d = max(0.0, float(distance))
    except Exception:
        d = 1.0
    return round(1.0 / (1.0 + d), 4)


def _lexical_score(query: str, text: str) -> float:
    q_tokens = set(_tokenize(query))
    t_tokens = set(_tokenize(text))
    if not q_tokens:
        return 0.0
    overlap = len(q_tokens & t_tokens)
    prefix_hits = sum(1 for t in q_tokens if any(tok.startswith(t[:4]) for tok in t_tokens if len(t) >= 4))
    raw = (0.75 * (overlap / max(1, len(q_tokens)))) + (0.25 * (prefix_hits / max(1, len(q_tokens))))
    return round(_clamp01(raw), 4)


def _document_contains_exact_query(query: str, text: str) -> bool:
    """Return true only when a Chroma exact-contains row really contains query.

    Some tests and degraded collection implementations may ignore the
    where_document filter and return broad rows from collection.get(). The exact
    recall fast path must not treat those as exact hits, or it bypasses the
    semantic/lexical fallback logic and hides low-signal recall warnings.
    """
    q = " ".join(str(query or "").strip().casefold().split())
    t = " ".join(str(text or "").strip().casefold().split())
    return bool(q and q in t)


def _metadata_tags(metadata: Optional[Dict[str, Any]]) -> List[str]:
    if not isinstance(metadata, dict):
        return []
    tags = metadata.get("tags")
    if not isinstance(tags, list):
        return []
    return [str(tag).strip().lower() for tag in tags if str(tag).strip()]


def _is_curated_memory(metadata: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(metadata, dict):
        return False
    source = str(metadata.get("source") or "").strip().lower()
    quality = str(metadata.get("quality") or "").strip().lower()
    tags = _metadata_tags(metadata)
    return (
        quality == "curated"
        or "curated" in tags
        or source in {
            "curated-project-facts",
            "curated-preferences-priorities",
            "curated-anti-drift",
            "curated-noise-suppression",
        }
    )


def _is_awareness_noise_row(text: str, metadata: Optional[Dict[str, Any]]) -> bool:
    tags = _metadata_tags(metadata)
    source = str((metadata or {}).get("source") or "").strip().lower()
    tier = str((metadata or {}).get("tier") or "").strip().lower()
    normalized = str(text or "").strip().lower()
    if "semantic_prediction" in tags or "awareness" in tags or "l37" in tags:
        return True
    if source in {"awareness", "oracle", "oracle_prediction", "semantic_prediction"}:
        return True
    if tier == "l2-awareness":
        return True
    return normalized in {
        "asking oracle for a semantic prediction...",
        "asking oracle for a semantic prediction..",
        "asking oracle for a semantic prediction.",
    } or normalized.startswith("oracle predicts:")


def _is_codec_state_row(text: str, metadata: Optional[Dict[str, Any]]) -> bool:
    tags = _metadata_tags(metadata)
    source = str((metadata or {}).get("source") or "").strip().lower()
    memory_type = str((metadata or {}).get("type") or "").strip().lower()
    normalized = str(text or "").strip().lower()
    return (
        memory_type == "codec_state"
        or "codec_state" in tags
        or "cortex_codec" in tags
        or source == "codec_state"
        or normalized.startswith('{"compression":')
    )


def _query_wants_codec_state(query: str) -> bool:
    normalized = str(query or "").strip().lower()
    return any(token in normalized for token in [
        "codec",
        "codec state",
        "compressed behavioral context",
        "memory facts",
        "rollup",
        "session state",
        "durable memory blob",
    ])


def _query_wants_memory_system(query: str) -> bool:
    normalized = str(query or "").lower()
    return any(token in normalized for token in [
        "memory system",
        "memory search",
        "memory_search",
        "recall",
        "librarian",
        "cortex memory",
        "knowledge/search",
        "reranker",
        "ranking",
        "semantic search",
    ])


def _is_memory_system_meta_row(text: str, metadata: Optional[Dict[str, Any]]) -> bool:
    meta = metadata or {}
    tags = _metadata_tags(meta)
    source = str(meta.get("source") or "").lower()
    hay = f"{text}\n{source}\n{' '.join(tags)}".lower()
    return any(marker in hay for marker in [
        "memory_search(",
        "memory search",
        "local file-memory lexical fallback",
        "local file memory lexical fallback",
        "recall regression",
        "recall route",
        "librarian.py",
        "test_librarian_recall_fallback",
        "stale-negative",
        "correction/conclusion rows",
        "reranker",
        "cortex memory bridge",
        "cortex-memory-bridge",
        "knowledge/search",
    ])


_QUERY_WANTS_NEGATIVE_EVIDENCE_PATTERNS = [
    r"\bnot\s+found\b",
    r"\bno\s+(?:found|evidence|record|records|memory|correspondence|source|sources)\b",
    r"\babsence\b",
    r"\bmissing\b",
    r"\bremaining\b",
    r"\bopen\s+(?:gap|gaps|work|items|todos?)\b",
    r"\bgap\s+(?:inventory|list|queue|report)\b",
    r"\bblockers?\b",
    r"\bwhat\s+(?:is|was|were)?\s*(?:still\s+)?(?:missing|left|remaining)\b",
]

_FRESH_FACT_PATTERNS = [
    r"\bcorrection\s*:",
    r"\bcorrected\b",
    r"\btruth\s+corrected\b",
    r"\boperational\s+conclusion\b",
    r"\bdirectly\s+supports\b",
    r"\bsource\s+of\s+truth\b",
    r"\bcurrent\s+(?:canonical\s+)?(?:status|state|context|truth|fact|setup)\b",
    r"\blatest\s+(?:canonical\s+)?(?:status|state|context|truth|fact|setup)\b",
    r"\bfinal\s+(?:answer|decision|state|status|setup)\b",
    r"\bimplemented\b",
    r"\bimplemented\s+and\s+synced\b",
    r"\bfixed\b",
    r"\brepaired\b",
    r"\bverified\b",
    r"\blive\s+verification\b",
    r"\btests?\s+passed\b",
    r"\bnew\s+controller\s*:",
]

_STALE_NEGATIVE_PATTERNS = [
    r"\bno\s+found\b",
    r"\bno\s+(?:explicit\s+)?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b",
    r"\bfound\s+no\s+(?:explicit\s+)?(?:evidence|record|records|memory|correspondence|source|sources|artifact|artifacts)\b",
    r"\bcould\s+not\s+(?:find|locate|confirm|verify|surface|recover)\b",
    r"\b(?:cannot|can't|unable\s+to)\s+(?:find|locate|confirm|verify|surface|recover)\b",
    r"\bnot\s+(?:found|located|confirmed|verified|available|present|implemented|synced|documented)\b",
    r"\bnot\s+in\s+(?:memory|hard\s+memory|durable\s+memory|local\s+files|the\s+ledger|the\s+repo)\b",
    r"\bmissing\s+(?:from|in)\s+(?:memory|hard\s+memory|durable\s+memory|local\s+files|the\s+ledger|the\s+repo)\b",
]

_STALE_OPEN_WORK_PATTERNS = [
    r"\bneed(?:s|ed)?\s+to\s+(?:implement|build|add|fix|repair|wire|create)\b",
    r"\bshould\s+(?:implement|build|add|fix|repair|wire|create)\b",
    r"\bnext\s+action\s*:\s*(?:implement|build|add|fix|repair|wire|create)\b",
    r"\bremaining\s+(?:work|task|todo|gap|surface)s?\s*:\s*(?:implement|build|add|fix|repair|wire|create)\b",
    r"\bnot\s+(?:yet\s+)?implemented\b",
    r"\bunimplemented\b",
]


def _matches_any(patterns: List[str], text: str) -> bool:
    return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns)


def _query_wants_negative_evidence(query: str) -> bool:
    return _matches_any(_QUERY_WANTS_NEGATIVE_EVIDENCE_PATTERNS, str(query or ""))


def _is_fresh_fact_memory(text: str, metadata: Optional[Dict[str, Any]]) -> bool:
    meta = metadata or {}
    if bool(meta.get("correction_memory")):
        return True
    tags = _metadata_tags(meta)
    if "correction" in tags or "current_fact" in tags or "source_of_truth" in tags:
        return True
    explicit_fresh = _matches_any(
        [
            r"\bcorrection\s*:",
            r"\bcorrected\b",
            r"\btruth\s+corrected\b",
            r"\boperational\s+conclusion\b",
            r"\bdirectly\s+supports\b",
            r"\bsource\s+of\s+truth\b",
            r"\bcurrent\s+(?:canonical\s+)?(?:status|state|context|truth|fact|setup)\b",
            r"\blatest\s+(?:canonical\s+)?(?:status|state|context|truth|fact|setup)\b",
            r"\bfinal\s+(?:answer|decision|state|status|setup)\b",
            r"\bnew\s+controller\s*:",
        ],
        text,
    )
    if explicit_fresh:
        return True
    if _matches_any(_STALE_NEGATIVE_PATTERNS, text) or _matches_any(_STALE_OPEN_WORK_PATTERNS, text):
        return False
    return _matches_any(_FRESH_FACT_PATTERNS, text)


def _is_stale_negative_memory(query: str, text: str, metadata: Optional[Dict[str, Any]], *, fresh_fact: bool) -> bool:
    if fresh_fact or _query_wants_negative_evidence(query):
        return False
    meta = metadata or {}
    if bool(meta.get("stale_negative_memory")):
        return True
    return _matches_any(_STALE_NEGATIVE_PATTERNS, text) or _matches_any(_STALE_OPEN_WORK_PATTERNS, text)


def _codec_state_display_text(text: str) -> Optional[str]:
    normalized = str(text or "").strip()
    if not normalized.startswith("{"):
        return None
    try:
        payload = json.loads(normalized)
    except Exception:
        return None

    snippets: List[str] = []

    def _push(value: Any) -> None:
        if isinstance(value, str):
            cleaned = value.strip()
            if cleaned and cleaned not in snippets:
                snippets.append(cleaned)
        elif isinstance(value, dict):
            for key in ["text", "summary", "value", "label", "fact"]:
                if isinstance(value.get(key), str):
                    _push(value.get(key))
                    return

    for bucket in ["identity_state", "summary", "memory_facts", "project_state"]:
        value = payload.get(bucket)
        if isinstance(value, dict):
            for nested_key in ["preferences", "projects", "open_loops", "lessons", "facts", "summary"]:
                nested = value.get(nested_key)
                if isinstance(nested, list):
                    for item in nested[:4]:
                        _push(item)
                else:
                    _push(nested)
        elif isinstance(value, list):
            for item in value[:4]:
                _push(item)
        else:
            _push(value)

    if not snippets:
        return None
    return " ".join(snippets[:4])[:600]


def _rank_memory_row(
    query: str,
    row: Dict[str, Any],
    filters: Optional[MemorySearchFilters] = None,
) -> Dict[str, Any]:
    text = str(row.get("text") or "")
    metadata = dict(row.get("metadata") or {})
    codec_state_row = _is_codec_state_row(text, metadata)
    display_text = _codec_state_display_text(text) if codec_state_row and not _query_wants_codec_state(query) else None
    rank_text = display_text or text
    if display_text:
        row["text"] = display_text
        metadata = {
            **metadata,
            "source_document_type": str(metadata.get("type") or "codec_state"),
            "source_document_preview": text[:200],
        }
    lexical = _lexical_score(query, rank_text)
    relevance = _relevance_from_distance(row.get("distance", 1.0))
    curated = _is_curated_memory(metadata)
    awareness_noise = _is_awareness_noise_row(rank_text, metadata)
    codec_state_noise = codec_state_row and not _query_wants_codec_state(query)
    memory_system_meta_noise = _is_memory_system_meta_row(rank_text, metadata) and not _query_wants_memory_system(query)
    correction_memory = _is_fresh_fact_memory(rank_text, metadata)
    stale_negative_memory = _is_stale_negative_memory(query, rank_text, metadata, fresh_fact=correction_memory)
    memory_status = _memory_status(metadata)
    authority_rank = _authority_rank(metadata)

    score = (0.55 * lexical) + (0.35 * relevance)
    if curated:
        score += 0.18
    if awareness_noise:
        score -= 0.55
    if codec_state_noise:
        score -= 0.42
    if memory_system_meta_noise:
        score -= 0.36
    if stale_negative_memory:
        score -= 0.38
    if correction_memory:
        score += 0.12
    score += min(0.24, authority_rank / 420.0)
    if not _memory_visible_for_query(query, metadata, filters):
        score -= 0.75
    if lexical >= 0.75:
        score += 0.18
    elif lexical >= 0.45:
        score += 0.08

    row["metadata"] = {
        **metadata,
        "lexical_score": round(lexical, 4),
        "relevance_score": round(relevance, 4),
        "hybrid_score": round(_clamp01(score), 4),
        "awareness_noise": awareness_noise,
        "codec_state_noise": codec_state_noise,
        "memory_system_meta_noise": memory_system_meta_noise,
        "stale_negative_memory": stale_negative_memory,
        "correction_memory": correction_memory,
        "memory_status": memory_status,
        "authority_rank": authority_rank,
        "historical_only": memory_status != "active",
    }
    row["score"] = round(_clamp01(score), 4)
    row["_hybrid_score"] = round(_clamp01(score), 4)
    row["_lexical_score"] = round(lexical, 4)
    row["_awareness_noise"] = awareness_noise
    row["_codec_state_noise"] = codec_state_noise
    row["_memory_system_meta_noise"] = memory_system_meta_noise
    return row


def _merge_ranked_rows(
    query: str,
    semantic_rows: List[Dict[str, Any]],
    lexical_rows: List[Dict[str, Any]],
    n_results: int,
    filters: Optional[MemorySearchFilters] = None,
) -> List[Dict[str, Any]]:
    ranked: Dict[str, Dict[str, Any]] = {}
    for row in semantic_rows + lexical_rows:
        candidate = _rank_memory_row(query, dict(row), filters)
        key = str(candidate.get("id") or "") or _fingerprint(str(candidate.get("text") or ""))
        existing = ranked.get(key)
        if existing is None or float(candidate.get("_hybrid_score", 0.0)) > float(existing.get("_hybrid_score", 0.0)):
            ranked[key] = candidate

    ordered = sorted(
        ranked.values(),
        key=lambda item: (
            float(item.get("_hybrid_score", 0.0)),
            float(item.get("_lexical_score", 0.0)),
            -float(item.get("distance", 1.0)),
        ),
        reverse=True,
    )

    ordered = [
        row
        for row in ordered
        if _memory_visible_for_query(query, row.get("metadata"), filters)
    ]

    strong_non_noise = [
        row for row in ordered
        if not bool(row.get("_awareness_noise")) and not bool(row.get("_codec_state_noise")) and not bool(row.get("_memory_system_meta_noise")) and float(row.get("_hybrid_score", 0.0)) >= 0.22
    ]
    if strong_non_noise:
        ordered = [row for row in ordered if not bool(row.get("_awareness_noise")) and not bool(row.get("_codec_state_noise")) and not bool(row.get("_memory_system_meta_noise"))]

    has_correction_memory = any(bool((row.get("metadata") or {}).get("correction_memory")) for row in ordered)
    if has_correction_memory and not _query_wants_negative_evidence(query):
        ordered = [row for row in ordered if not bool((row.get("metadata") or {}).get("stale_negative_memory"))]

    if any(bool((row.get("metadata") or {}).get("canonical_project_memory")) for row in ordered) and not _query_wants_historical_memory(query):
        ordered.sort(
            key=lambda row: (
                int((row.get("metadata") or {}).get("authority_rank") or 0),
                float((row.get("metadata") or {}).get("canonical_priority_score") or 0.0),
                float(row.get("_hybrid_score", 0.0)),
                float(row.get("_lexical_score", 0.0)),
            ),
            reverse=True,
        )

    cleaned: List[Dict[str, Any]] = []
    for row in ordered[: max(1, int(n_results))]:
        row.pop("_hybrid_score", None)
        row.pop("_lexical_score", None)
        row.pop("_awareness_noise", None)
        row.pop("_codec_state_noise", None)
        row.pop("_memory_system_meta_noise", None)
        cleaned.append(row)
    return cleaned


def _semantic_rows_need_help(
    query: str,
    rows: List[Dict[str, Any]],
    filters: Optional[MemorySearchFilters] = None,
) -> bool:
    if not rows:
        return True
    ranked = [_rank_memory_row(query, dict(row), filters) for row in rows[:5]]
    best_score = max(float(row.get("_hybrid_score", 0.0)) for row in ranked)
    non_noise = [row for row in ranked if not bool(row.get("_awareness_noise")) and not bool(row.get("_codec_state_noise"))]
    if not non_noise:
        return True
    if best_score < 0.18:
        return True
    return all(float(row.get("_lexical_score", 0.0)) < 0.18 for row in ranked)


def _lexical_search_rows(
    query: str,
    n_results: int = 5,
    scan_limit: int = 300,
    availability: Optional[List[bool]] = None,
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    memory_principal_key: Optional[str] = None,
    filters: Optional[MemorySearchFilters] = None,
) -> List[Dict[str, Any]]:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    scoped_kwargs = _scoped_call_kwargs(tenant, workspace)
    rows: List[Dict[str, Any]] = []
    if not memory_principal_key:
        rows.extend(_canonical_project_search_rows(
            query,
            n_results=max(int(n_results) * 2, 8),
            **scoped_kwargs,
        ))
    fallback_query_succeeded = bool(rows)

    # Exact Chroma contains search first. Chroma's semantic query can miss
    # freshly-written unique identifiers, and bounded collection.get() scans can
    # be crowded out by older rows. Exact lexical recall must win for durable
    # memory proof markers, IDs, and quoted facts.
    try:
        exact_query = str(query or "").strip()
        if exact_query:
            exact_get_kwargs: Dict[str, Any] = {
                "where_document": {"$contains": exact_query},
                "limit": max(1, min(max(int(n_results) * 3, 12), 80)),
                "include": ["documents", "metadatas"],
            }
            where = _memory_query_where(
                tenant, workspace, memory_principal_key, filters
            )
            if where:
                exact_get_kwargs["where"] = where
            exact_data = collection.get(**exact_get_kwargs)
            fallback_query_succeeded = True
            exact_ids = exact_data.get("ids") or []
            exact_docs = exact_data.get("documents") or []
            exact_metas = exact_data.get("metadatas") or []
            for i, row_id in enumerate(exact_ids):
                text = exact_docs[i] if i < len(exact_docs) else ""
                if not _document_contains_exact_query(exact_query, text):
                    continue
                metadata = exact_metas[i] if i < len(exact_metas) else {}
                if not _metadata_in_requested_scope(
                    metadata,
                    tenant,
                    workspace,
                    memory_principal_key,
                ):
                    continue
                score = max(0.99, _lexical_score(query, text))
                rows.append(
                    {
                        "id": row_id,
                        "text": text,
                        "distance": 0.0,
                        "metadata": {
                            **(metadata or {}),
                            "recall_mode": "exact_chroma_contains",
                            "lexical_score": round(score, 4),
                            "source": (metadata or {}).get("source", "chroma_docs"),
                        },
                        "_score": score,
                    }
                )
    except Exception:
        pass

    # Chroma documents (works even when embedding provider is currently down).
    try:
        get_kwargs: Dict[str, Any] = {
            "limit": max(1, min(scan_limit, 500)),
            "include": ["documents", "metadatas"],
        }
        where = _memory_query_where(
            tenant, workspace, memory_principal_key, filters
        )
        if where:
            get_kwargs["where"] = where
        data = collection.get(**get_kwargs)
        fallback_query_succeeded = True
        ids = data.get("ids") or []
        docs = data.get("documents") or []
        metas = data.get("metadatas") or []
        for i, row_id in enumerate(ids):
            text = docs[i] if i < len(docs) else ""
            metadata = metas[i] if i < len(metas) else {}
            if not _metadata_in_requested_scope(
                metadata,
                tenant,
                workspace,
                memory_principal_key,
            ):
                continue
            score = _lexical_score(query, text)
            if score <= 0:
                continue
            rows.append(
                {
                    "id": row_id,
                    "text": text,
                    "distance": round(max(0.0, 1.0 - score), 4),
                    "metadata": {
                        **(metadata or {}),
                        "recall_mode": "lexical_fallback",
                        "lexical_score": score,
                        "source": (metadata or {}).get("source", "chroma_docs"),
                    },
                    "_score": score,
                }
            )
    except Exception:
        pass

    # Explicit fallback rows captured during embed failures.
    for row in _read_fallback_rows(
        limit=max(40, scan_limit),
        memory_principal_key=memory_principal_key,
        include_historical=_query_wants_historical_memory(query),
        **scoped_kwargs,
    ):
        if not _metadata_in_requested_scope(
            row.get("metadata"),
            tenant,
            workspace,
            memory_principal_key,
        ):
            continue
        text = str(row.get("text") or "")
        score = _lexical_score(query, text)
        if score <= 0:
            continue
        rows.append(
            {
                "id": str(row.get("id") or f"fallback-{_fingerprint(text)}"),
                "text": text,
                "distance": round(max(0.0, 1.0 - score), 4),
                "metadata": {
                    **(row.get("metadata") or {}),
                    "recall_mode": "fallback_log",
                    "lexical_score": score,
                    "source": row.get("source", "librarian_fallback_log"),
                    "stored_at": row.get("stored_at", ""),
                },
                "_score": score,
            }
        )

    # Durable workspace hard-memory files (project memories and client ledgers).
    # This catches facts that are intentionally written to local markdown memory
    # but have not yet been embedded into Chroma, or have been crowded out of a
    # bounded Chroma lexical scan.
    if not memory_principal_key:
        rows.extend(
            _local_file_memory_search_rows(
                query,
                n_results=max(int(n_results) * 4, 12),
                scan_limit=max(scan_limit, _LOCAL_FILE_MEMORY_MAX_FILES),
                **scoped_kwargs,
            )
        )
    fallback_query_succeeded = fallback_query_succeeded or bool(rows)

    dedup: Dict[str, Dict[str, Any]] = {}
    for item in rows:
        if not row_matches_filters(item.get("metadata"), filters, check_status=False):
            continue
        if not _memory_visible_for_query(query, item.get("metadata"), filters):
            continue
        key = str(item.get("id") or "") or _fingerprint(str(item.get("text") or ""))
        prev = dedup.get(key)
        if prev is None or float(item.get("_score", 0.0)) > float(prev.get("_score", 0.0)):
            dedup[key] = item

    ordered = sorted(dedup.values(), key=lambda x: float(x.get("_score", 0.0)), reverse=True)
    if availability is not None:
        availability.append(fallback_query_succeeded)
    return ordered[: max(1, int(n_results))]


def robust_search(
    query: str,
    n_results: int = 5,
    allow_fallback: bool = True,
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    memory_principal_key: Optional[str] = None,
    filters: Optional[MemorySearchFilters] = None,
) -> Dict[str, Any]:
    if not (query or "").strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    filters = filters or MemorySearchFilters()
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    scoped_kwargs = _scoped_call_kwargs(tenant, workspace)
    _recover_fact_supersessions()

    def governed(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return _apply_governed_result_policy(
            rows,
            filters=filters,
            memory_principal_key=memory_principal_key,
        )[: max(1, int(n_results))]

    exact_query_succeeded = False
    # Exact lexical contains must run before semantic search. Embedding ranking can
    # return plausible but wrong neighbors for unique markers/IDs and otherwise
    # prevent fallback from executing. Durable-memory recall needs exact facts to
    # win when the query literally appears in stored text.
    try:
        exact_query = str(query or "").strip()
        exact_get_kwargs: Dict[str, Any] = {
            "where_document": {"$contains": exact_query},
            "limit": max(1, min(max(int(n_results) * 3, 12), 80)),
            "include": ["documents", "metadatas"],
        }
        where = _memory_query_where(
            tenant, workspace, memory_principal_key, filters
        )
        if where:
            exact_get_kwargs["where"] = where
        exact_data = collection.get(**exact_get_kwargs)
        exact_query_succeeded = True
        exact_rows: List[Dict[str, Any]] = []
        exact_ids = exact_data.get("ids") or []
        exact_docs = exact_data.get("documents") or []
        exact_metas = exact_data.get("metadatas") or []
        for i, row_id in enumerate(exact_ids):
            text = exact_docs[i] if i < len(exact_docs) else ""
            if not _document_contains_exact_query(exact_query, text):
                continue
            metadata = exact_metas[i] if i < len(exact_metas) else {}
            if not _metadata_in_requested_scope(
                metadata,
                tenant,
                workspace,
                memory_principal_key,
            ):
                continue
            exact_rows.append(
                {
                    "id": row_id,
                    "text": text,
                    "distance": 0.0,
                    "metadata": {
                        **(metadata or {}),
                        "recall_mode": "exact_chroma_contains",
                        "lexical_score": max(0.99, _lexical_score(query, text)),
                        "source": (metadata or {}).get("source", "chroma_docs"),
                    },
                    "_score": 1.0,
                }
            )
        if exact_rows:
            canonical_rows = (
                _canonical_project_search_rows(
                    query,
                    n_results=max(6, int(n_results) * 2),
                    **scoped_kwargs,
                )
                if not memory_principal_key
                else []
            )
            ranked_exact_rows = _merge_ranked_rows(query, [], exact_rows + canonical_rows, n_results=max(len(exact_rows) + len(canonical_rows), max(1, int(n_results))), filters=filters)
            real_exact_rows = [
                row for row in ranked_exact_rows
                if not bool((row.get("metadata") or {}).get("codec_state_noise"))
                and float(row.get("score") or 0.0) >= 0.22
            ]
            exact_results = governed(real_exact_rows or ranked_exact_rows)
            for row in exact_results:
                metadata = dict(row.get("metadata") or {})
                if metadata.get("recall_mode") == "exact_chroma_contains" and not bool(metadata.get("codec_state_noise")):
                    metadata["memory_system_meta_noise"] = False
                    metadata["exact_recall_override"] = True
                    row["metadata"] = metadata
            if exact_results:
                return {
                    "query": query,
                    "results": exact_results,
                    "search_mode": "exact_lexical",
                    "degraded": False,
                    "warning": None,
                    "available": True,
                }
    except Exception:
        pass

    semantic_warning: Optional[str] = None
    semantic_rows: List[Dict[str, Any]] = []
    semantic_query_succeeded = False
    try:
        query_kwargs: Dict[str, Any] = {
            "query_texts": [query],
            # Governance can remove stale or losing contradiction candidates
            # after vector retrieval. Oversample within the API's hard bound so
            # those rows do not crowd a valid answer out of the final window.
            "n_results": max(1, min(max(int(n_results) * 6, 24), 100)),
        }
        where = _memory_query_where(
            tenant, workspace, memory_principal_key, filters
        )
        if where:
            query_kwargs["where"] = where
        results = collection.query(**query_kwargs)
        semantic_query_succeeded = True
        out_rows: List[Dict[str, Any]] = []
        ids = results.get("ids") or []
        docs = results.get("documents") or []
        dists = results.get("distances") or []
        metas = results.get("metadatas") or []

        if ids and ids[0]:
            for i, row_id in enumerate(ids[0]):
                metadata = metas[0][i] if metas and metas[0] and i < len(metas[0]) else None
                if not _metadata_in_requested_scope(
                    metadata,
                    tenant,
                    workspace,
                    memory_principal_key,
                ):
                    continue
                out_rows.append(
                    {
                        "id": row_id,
                        "text": docs[0][i] if docs and docs[0] and i < len(docs[0]) else "",
                        "distance": dists[0][i] if dists and dists[0] and i < len(dists[0]) else 0.0,
                        "metadata": metadata,
                    }
                )

        semantic_rows = governed([
            row
            for row in out_rows
            if _memory_visible_for_query(query, row.get("metadata"), filters)
        ])
        if semantic_rows and not _semantic_rows_need_help(query, semantic_rows, filters):
            local_rows = [] if memory_principal_key else _local_file_memory_search_rows(
                query,
                n_results=max(int(n_results) * 3, 8),
                scan_limit=max(int(n_results) * 40, 240),
                **scoped_kwargs,
            )
            canonical_rows = (
                _canonical_project_search_rows(
                    query,
                    n_results=max(int(n_results) * 2, 8),
                    **scoped_kwargs,
                )
                if not memory_principal_key
                else []
            )
            strong_local_rows = [row for row in local_rows if float(row.get("_score", 0.0)) >= max(_LOCAL_FILE_MEMORY_MIN_SCORE, 0.34)] + canonical_rows
            if strong_local_rows:
                governed_rows = governed(
                    _merge_ranked_rows(
                        query,
                        semantic_rows,
                        strong_local_rows,
                        n_results=max(1, int(n_results)),
                        filters=filters,
                    )
                )
                return {
                    "query": query,
                    "results": governed_rows,
                    "search_mode": "semantic_hybrid",
                    "degraded": False,
                    "warning": None,
                    "available": True,
                }
            governed_rows = governed(
                _merge_ranked_rows(
                    query, semantic_rows, [], n_results=max(1, int(n_results)), filters=filters
                )
            )
            return {
                "query": query,
                "results": governed_rows,
                "search_mode": "semantic",
                "degraded": False,
                "warning": None,
                "available": True,
            }

        semantic_warning = (
            "semantic_low_signal"
            if semantic_rows
            else ("semantic_inactive_only" if out_rows else "semantic_empty")
        )
    except Exception as exc:
        _mark_embedding_error(exc)
        semantic_warning = f"semantic_failed: {str(exc)[:220]}"

    if not allow_fallback:
        return {
            "query": query,
            "results": [],
            "search_mode": "semantic",
            "degraded": bool(semantic_warning),
            "warning": semantic_warning,
            "available": exact_query_succeeded or semantic_query_succeeded,
        }

    _mark_fallback_search()
    fallback_availability: List[bool] = []
    lexical_rows = _lexical_search_rows(
        query,
        n_results=max(1, min(max(int(n_results) * 4, 16), 100)),
        availability=fallback_availability,
        memory_principal_key=memory_principal_key,
        filters=filters,
        **scoped_kwargs,
    )
    memory_available = exact_query_succeeded or semantic_query_succeeded or any(fallback_availability)
    merged_rows = governed(
        _merge_ranked_rows(
            query, semantic_rows, lexical_rows, n_results=max(1, int(n_results)), filters=filters
        )
    )
    if merged_rows:
        return {
            "query": query,
            "results": merged_rows,
            "search_mode": "semantic_hybrid" if semantic_rows else "lexical_fallback",
            "degraded": bool(semantic_warning),
            "warning": semantic_warning or ("fallback_requested" if not semantic_rows else None),
            "available": memory_available,
        }

    for row in lexical_rows:
        row.pop("_score", None)

    return {
        "query": query,
        "results": governed(lexical_rows),
        "search_mode": "lexical_fallback",
        "degraded": True,
        "warning": semantic_warning or "fallback_requested",
        "available": memory_available,
    }


def search_with_novelty(
    query: str,
    n_results: int = 5,
    novelty_weight: float = 0.28,
    semantic_weight: float = 0.72,
    min_novelty: float = 0.0,
    allow_fallback: bool = True,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    memory_principal_key: Optional[str] = None,
    filters: Optional[MemorySearchFilters] = None,
) -> Dict[str, Any]:
    if not (query or "").strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    filters = filters or MemorySearchFilters()
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    scoped_kwargs = _scoped_call_kwargs(tenant, workspace)
    _recover_fact_supersessions()

    nw = _clamp01(novelty_weight)
    sw = _clamp01(semantic_weight)
    if nw == 0 and sw == 0:
        sw = 1.0
    total = nw + sw
    nw = nw / total
    sw = sw / total

    fetch_n = max(1, min(max(int(n_results) * 6, 24), 100))
    warning: Optional[str] = None
    degraded = False

    try:
        query_kwargs: Dict[str, Any] = {"query_texts": [query], "n_results": fetch_n}
        where = _memory_query_where(
            tenant, workspace, memory_principal_key, filters
        )
        if where:
            query_kwargs["where"] = where
        results = collection.query(**query_kwargs)

        rows: List[Dict[str, Any]] = []
        ids = results.get("ids") or []
        docs = results.get("documents") or []
        dists = results.get("distances") or []
        metas = results.get("metadatas") or []

        if ids and ids[0]:
            for i, row_id in enumerate(ids[0]):
                text = docs[0][i] if docs and docs[0] and i < len(docs[0]) else ""
                metadata = metas[0][i] if metas and metas[0] and i < len(metas[0]) else {}
                if not _metadata_in_requested_scope(
                    metadata,
                    tenant,
                    workspace,
                    memory_principal_key,
                ):
                    continue
                if not _memory_visible_for_query(query, metadata, filters):
                    continue
                dist = dists[0][i] if dists and dists[0] and i < len(dists[0]) else 0.0
                novelty_score = metadata.get("novelty_score")
                if novelty_score is None:
                    novelty_score = _estimate_novelty(
                        text,
                        _safe_recent_docs(
                            limit=15,
                            memory_principal_key=memory_principal_key,
                            **scoped_kwargs,
                        ),
                        memory_principal_key=memory_principal_key,
                        **scoped_kwargs,
                    )
                novelty_score = round(_clamp01(float(novelty_score)), 4)

                if novelty_score < float(min_novelty):
                    continue

                relevance = _relevance_from_distance(dist)
                combined = round((sw * relevance) + (nw * novelty_score), 4)
                rows.append(
                    {
                        "id": row_id,
                        "text": text,
                        "distance": float(dist),
                        "relevance_score": relevance,
                        "novelty_score": novelty_score,
                        "combined_score": combined,
                        "metadata": metadata,
                    }
                )

        if rows:
            rows = _apply_governed_result_policy(
                rows,
                filters=filters,
                memory_principal_key=memory_principal_key,
            )
            rows.sort(key=lambda r: r["combined_score"], reverse=True)
            return {
                "query": query,
                "novelty_weight": round(nw, 4),
                "semantic_weight": round(sw, 4),
                "results": rows[: max(1, int(n_results))],
                "search_mode": "semantic+novelty",
                "degraded": False,
                "warning": None,
            }

        warning = "semantic_empty"
    except Exception as exc:
        _mark_embedding_error(exc)
        degraded = True
        warning = f"semantic_failed: {str(exc)[:220]}"

    if not allow_fallback:
        return {
            "query": query,
            "novelty_weight": round(nw, 4),
            "semantic_weight": round(sw, 4),
            "results": [],
            "search_mode": "semantic+novelty",
            "degraded": bool(degraded or warning),
            "warning": warning,
        }

    _mark_fallback_search()
    fallback_rows = _lexical_search_rows(
        query,
        n_results=max(1, int(n_results)),
        scan_limit=320,
        memory_principal_key=memory_principal_key,
        filters=filters,
        **scoped_kwargs,
    )
    scored_rows: List[Dict[str, Any]] = []
    for row in fallback_rows:
        lex = float((row.get("metadata") or {}).get("lexical_score", 0.0))
        novelty_score = _estimate_novelty(
            str(row.get("text") or ""),
            _safe_recent_docs(
                limit=15,
                memory_principal_key=memory_principal_key,
                **scoped_kwargs,
            ),
            memory_principal_key=memory_principal_key,
            **scoped_kwargs,
        )
        if novelty_score < float(min_novelty):
            continue
        combined = round((sw * lex) + (nw * novelty_score), 4)
        scored_rows.append(
            {
                "id": row.get("id"),
                "text": row.get("text"),
                "distance": float(row.get("distance", 1.0)),
                "relevance_score": round(lex, 4),
                "novelty_score": round(float(novelty_score), 4),
                "combined_score": combined,
                "metadata": row.get("metadata"),
            }
        )

    scored_rows = _apply_governed_result_policy(
        scored_rows,
        filters=filters,
        memory_principal_key=memory_principal_key,
    )
    scored_rows.sort(key=lambda r: r["combined_score"], reverse=True)
    return {
        "query": query,
        "novelty_weight": round(nw, 4),
        "semantic_weight": round(sw, 4),
        "results": scored_rows[: max(1, int(n_results))],
        "search_mode": "lexical+novelty_fallback",
        "degraded": True,
        "warning": warning or "fallback_requested",
    }


@router.get("/status")
async def librarian_status(http_request: Request = None):
    """L7 Librarian status."""
    if http_request is not None:
        memory_principal_for_request(http_request)
    embedding = _embedding_health_snapshot()
    collection_available = await _collection_available()
    fallback_available = _fallback_store_appendable()
    scope_auth_ready = _memory_scope_auth_ready()
    semantic_available = collection_available and scope_auth_ready
    fallback_degraded = fallback_available and scope_auth_ready and not collection_available
    status = (
        "active"
        if semantic_available
        else ("degraded" if fallback_degraded else "unavailable")
    )
    explicitly_configured = bool(os.getenv("CORTEX_CHROMA_DIR", "").strip())
    payload = {
        # An appendable fallback is a useful durability escape hatch, but it
        # does not prove semantic indexing or query. Never advertise it as an
        # active semantic-memory service.
        "success": semantic_available,
        "level": 7,
        "name": "Librarian",
        "status": status,
        "degraded": fallback_degraded,
        "semantic_store_available": collection_available,
        "fallback_persistence_available": fallback_available,
        "capabilities": [
            "embed",
            "search",
            "semantic_indexing",
            "embed_novel",
            "search_novel",
            "novelty_reranking",
            "robust_recall_fallback",
            "supersession_tombstones",
            "temporal_truth",
            "privacy_admission",
            "typed_pre_retrieval_filters",
            "fact_conflict_projection",
        ],
        "novelty_version": "l7l22.v1.2",
    }
    if http_request is not None:
        return {
            **payload,
            "principal_scoped": True,
            "aggregate_operational_details": "withheld",
        }
    return {
        **payload,
        "embedding_health": embedding,
        "embedding_runtime": runtime_pressure.pressure_snapshot(),
        "fallback_store": str(_FALLBACK_LOG_PATH),
        "scope_auth_ready": scope_auth_ready,
        "durability": {
            "explicitly_configured": explicitly_configured,
            "production_required": _production_memory_mode(),
            "mount_identity_verified": bool(
                _production_memory_mode()
                and os.getenv("CORTEX_CHROMA_MOUNT_ID", "").strip()
            ),
            "path": CHROMA_DIR,
            "mode": "configured_durable" if explicitly_configured else "development_default",
        },
    }


@router.post("/embed", response_model=EmbedResponse)
async def embed_memory(
    request: EmbedRequest,
    http_request: Request = None,
):
    """Store text in vector memory with semantic embedding.

    If embedding providers fail, persist to fallback log so recall remains possible.
    """
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    principal = _route_memory_principal(request, http_request)
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    memory_id = str(uuid.uuid4())
    operation_id = "librarian:" + memory_id
    try:
        metadata = prepare_governed_memory_write(
            principal_key=principal.memory_principal_key,
            content=request.text,
            metadata=_normalize_memory_metadata(
                scoped_memory_metadata(principal, request.metadata),
                tenant_id=tenant,
                workspace_id=workspace,
            ),
            operation_id=operation_id,
        )
    except MemoryAdmissionRejected as exc:
        raise HTTPException(status_code=422, detail=exc.decision.public_dict()) from exc
    except MemoryGovernanceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    def publish(scoped_metadata: Dict[str, Any]) -> str:
        try:
            _add_memory_with_supersession(
                memory_id,
                request.text,
                scoped_metadata,
                tenant_id=tenant,
                workspace_id=workspace,
            )
            return "stored"
        except FactSupersessionError:
            raise
        except Exception as exc:
            _mark_embedding_error(exc)
            try:
                _persist_fallback_memory(
                    memory_id,
                    request.text,
                    scoped_metadata,
                    reason=str(exc),
                    mode="embed",
                )
            except FallbackPersistenceError as fallback_exc:
                raise HTTPException(
                    status_code=503,
                    detail="semantic and fallback memory persistence are unavailable",
                ) from fallback_exc
            return "stored_fallback_lexical"

    try:
        status = _run_librarian_quota_controlled_write(
            memory_id=memory_id,
            text=request.text,
            metadata=metadata,
            tenant_id=tenant,
            workspace_id=workspace,
            publish=publish,
        )
    except FactSupersessionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        finalize_governed_memory_write(
            principal_key=principal.memory_principal_key,
            memory_id=memory_id,
            content=request.text,
            metadata=metadata,
            operation_id=operation_id,
            receipt_id=memory_id,
        )
    except MemoryGovernanceError as exc:
        raise HTTPException(
            status_code=503,
            detail="memory stored but governance finalization remains replay-pending",
        ) from exc
    return EmbedResponse(id=memory_id, status=status)


@router.post("/embed_novel", response_model=NovelEmbedResponse)
async def embed_memory_novel(
    request: NovelEmbedRequest,
    http_request: Request = None,
):
    """Store text with novelty metadata for L7/L22 orchestration."""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    principal = _route_memory_principal(request, http_request)
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    memory_id = str(uuid.uuid4())
    operation_id = "librarian-novel:" + memory_id
    try:
        enriched_metadata = prepare_governed_memory_write(
            principal_key=principal.memory_principal_key,
            content=request.text,
            metadata=_normalize_memory_metadata(_build_novel_metadata(
                text=request.text,
                metadata=scoped_memory_metadata(principal, request.metadata),
                novelty_tags=request.novelty_tags,
                source_scope="l7",
                compare_window=request.compare_window,
                tenant_id=tenant,
                workspace_id=workspace,
                memory_principal_key=principal.memory_principal_key,
            ), tenant_id=tenant, workspace_id=workspace),
            operation_id=operation_id,
        )
    except MemoryAdmissionRejected as exc:
        raise HTTPException(status_code=422, detail=exc.decision.public_dict()) from exc
    except MemoryGovernanceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    result = _run_librarian_quota_controlled_write(
        memory_id=memory_id,
        text=request.text,
        metadata=enriched_metadata,
        tenant_id=tenant,
        workspace_id=workspace,
        publish=lambda scoped_metadata: _persist_indexed_novelty_memory(
            memory_id,
            request.text,
            scoped_metadata,
        ),
    )
    try:
        finalize_governed_memory_write(
            principal_key=principal.memory_principal_key,
            memory_id=memory_id,
            content=request.text,
            metadata=enriched_metadata,
            operation_id=operation_id,
            receipt_id=memory_id,
        )
    except MemoryGovernanceError as exc:
        raise HTTPException(
            status_code=503,
            detail="memory stored but governance finalization remains replay-pending",
        ) from exc

    novelty_score = float(result["metadata"].get("novelty_score", 0.0))
    if novelty_score < float(request.min_novelty):
        return NovelEmbedResponse(
            id=result["id"],
            status="stored_below_threshold",
            novelty_score=novelty_score,
            novelty_bucket=str(result["metadata"].get("novelty_bucket", "low")),
            novelty_fingerprint=str(result["metadata"].get("novelty_fingerprint", "")),
        )

    return NovelEmbedResponse(
        id=result["id"],
        status=result["status"],
        novelty_score=novelty_score,
        novelty_bucket=str(result["metadata"].get("novelty_bucket", "low")),
        novelty_fingerprint=str(result["metadata"].get("novelty_fingerprint", "")),
    )


@contextmanager
def _fact_supersession_record_read():
    """Do not wait behind a writer: a busy read is unavailable, never empty."""
    if not _FACT_SUPERSESSION_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=503, detail="Memory record temporarily busy")
    try:
        lock_path = _fact_supersession_lock_path()
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+b") as lock_file:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise HTTPException(status_code=503, detail="Memory record temporarily busy") from exc
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    finally:
        _FACT_SUPERSESSION_LOCK.release()


@router.post("/record")
async def read_memory_record(request: RecordReadRequest, http_request: Request = None):
    """Exact scoped record read; never interpret a record ID as a filesystem path."""
    principal = _route_memory_principal(request, http_request)
    if not principal.memory_principal_key:
        raise HTTPException(status_code=403, detail="Authenticated memory namespace required")
    # Keep the same transaction lock as supersession: pending revisions cannot
    # become visible between the metadata check and the document read.
    with _fact_supersession_record_read():
        _recover_fact_supersessions_locked()
        result = collection.get(
            ids=[request.id], where=principal_memory_where(principal),
            include=["documents", "metadatas"],
        )
        ids = result.get("ids") or []
        documents = result.get("documents") or []
        metadatas = result.get("metadatas") or []
        if len(ids) != 1 or ids[0] != request.id or len(documents) != 1 or len(metadatas) != 1:
            raise HTTPException(status_code=404, detail="Memory record unavailable")
        metadata = metadatas[0]
        if (not _metadata_in_requested_scope(metadata, principal.tenant_id,
                                             principal.storage_workspace_id, principal.memory_principal_key)
                or not isinstance(metadata, dict)
                or bool(metadata.get("supersession_pending"))
                or _memory_status(metadata) != "active"
                or not _memory_visible_for_query("", metadata)
                or not isinstance(documents[0], str)):
            raise HTTPException(status_code=404, detail="Memory record unavailable")
        all_lines = documents[0].splitlines()
        start = request.from_line - 1
        selected = "\n".join(all_lines[start:start + request.lines])
        # Bound long single lines as well as the number of requested lines.
        truncated = len(selected) > 65536 or start + request.lines < len(all_lines)
        return {"id": request.id, "path": "cortex:" + request.id,
                "text": selected[:65536], "from": request.from_line,
                "totalLines": len(all_lines), "truncated": truncated}


@router.post("/search", response_model=SearchResponse)
async def search_memory(
    request: SearchRequest,
    http_request: Request = None,
):
    """Search vector memory for semantically similar content.

    Falls back to lexical recall when semantic embedding/query is unavailable.
    """
    principal = _route_memory_principal(request, http_request)
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    try:
        filters = parse_memory_search_filters(request.filters)
        result = robust_search(
            request.query,
            n_results=request.n_results,
            allow_fallback=request.allow_fallback,
            tenant_id=tenant,
            workspace_id=workspace,
            memory_principal_key=principal.memory_principal_key,
            filters=filters,
        )
    except MemoryFilterError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MemoryGovernanceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    memories = [MemoryResult(**row) for row in result.get("results", [])]
    return SearchResponse(
        query=request.query,
        results=memories,
        search_mode=str(result.get("search_mode", "semantic")),
        degraded=bool(result.get("degraded", False)),
        warning=result.get("warning"),
    )


@router.post("/search_novel", response_model=NovelSearchResponse)
async def search_memory_novel(
    request: NovelSearchRequest,
    http_request: Request = None,
):
    """Search memory and rerank by semantic relevance + novelty."""
    principal = _route_memory_principal(request, http_request)
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    try:
        filters = parse_memory_search_filters(request.filters)
        ranked = search_with_novelty(
            query=request.query,
            n_results=request.n_results,
            novelty_weight=request.novelty_weight,
            semantic_weight=request.semantic_weight,
            min_novelty=request.min_novelty,
            allow_fallback=request.allow_fallback,
            tenant_id=tenant,
            workspace_id=workspace,
            memory_principal_key=principal.memory_principal_key,
            filters=filters,
        )
    except MemoryFilterError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MemoryGovernanceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    results = [NovelSearchResult(**row) for row in ranked.get("results", [])]
    return NovelSearchResponse(
        query=request.query,
        novelty_weight=float(ranked.get("novelty_weight", request.novelty_weight)),
        semantic_weight=float(ranked.get("semantic_weight", request.semantic_weight)),
        results=results,
        search_mode=str(ranked.get("search_mode", "semantic+novelty")),
        degraded=bool(ranked.get("degraded", False)),
        warning=ranked.get("warning"),
    )


@router.post("/recall", response_model=RecallResponse)
async def recall_memory(
    request: RecallRequest,
    http_request: Request = None,
):
    """Trustable recall path: semantic first, lexical fallback guaranteed."""
    principal = _route_memory_principal(request, http_request)
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    try:
        filters = parse_memory_search_filters(request.filters)
        result = robust_search(
            request.query,
            n_results=request.n_results,
            allow_fallback=True,
            tenant_id=tenant,
            workspace_id=workspace,
            memory_principal_key=principal.memory_principal_key,
            filters=filters,
        )
    except MemoryFilterError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MemoryGovernanceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    memories = [MemoryResult(**row) for row in result.get("results", [])]
    return RecallResponse(
        query=request.query,
        mode=str(result.get("search_mode", "semantic")),
        results=memories,
        degraded=bool(result.get("degraded", False)),
        warning=result.get("warning"),
    )


@router.post("/supersede")
async def supersede_memory(
    request: SupersedeRequest,
    http_request: Request = None,
):
    """Mark semantic records as historical without deleting their audit trail."""
    principal = _route_memory_principal(request, http_request)
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    if request.superseded_by:
        try:
            target = collection.get(
                ids=[request.superseded_by],
                where=principal_memory_where(principal),
                include=["metadatas"],
            )
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail="supersession target lookup is unavailable",
            ) from exc
        target_ids = target.get("ids") or []
        target_metadatas = target.get("metadatas") or []
        if not any(
            str(memory_id) == request.superseded_by
            and _metadata_in_memory_namespace(
                target_metadatas[index] if index < len(target_metadatas) else {},
                principal.memory_principal_key,
            )
            for index, memory_id in enumerate(target_ids)
        ):
            raise HTTPException(
                status_code=403,
                detail="superseded_by must belong to the authenticated principal",
            )
    try:
        result = supersede_memory_records(
            request.memory_ids,
            superseded_by=request.superseded_by,
            reason=request.reason,
            tenant_id=tenant,
            workspace_id=workspace,
            quota_credential_id=principal.credential_id,
            memory_principal_key=principal.memory_principal_key,
        )
    except (FactSupersessionError, FallbackPersistenceError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"success": True, **result}


@router.get("/stats")
async def memory_stats(http_request: Request):
    """Get statistics about the memory collection."""
    principal = memory_principal_for_request(http_request)
    count: Optional[int] = None
    lifecycle: Dict[str, int] = {
        "active": 0,
        "superseded": 0,
        "tombstoned": 0,
        "historical": 0,
        "pending": 0,
    }
    semantic_store_available = False
    try:
        scoped = collection.get(
            where=principal_memory_where(principal),
            include=["metadatas"],
        )
        if not isinstance(scoped, dict):
            raise RuntimeError("semantic collection returned an invalid stats response")
        scoped_ids = scoped.get("ids")
        scoped_metadatas = scoped.get("metadatas")
        if (
            not isinstance(scoped_ids, list)
            or not isinstance(scoped_metadatas, list)
            or len(scoped_ids) != len(scoped_metadatas)
        ):
            raise RuntimeError("semantic collection returned incomplete stats data")
        if any(
            not isinstance(memory_id, str)
            or not isinstance(metadata, dict)
            or not _metadata_in_requested_scope(
                metadata,
                principal.tenant_id,
                principal.storage_workspace_id,
                principal.memory_principal_key,
            )
            for memory_id, metadata in zip(scoped_ids, scoped_metadatas)
        ):
            raise RuntimeError("semantic collection violated the principal stats filter")
        count = len(scoped_ids)
        for metadata in scoped_metadatas:
            if bool((metadata or {}).get("supersession_pending")):
                lifecycle["pending"] += 1
            else:
                status = _memory_status(metadata)
                lifecycle[status] = lifecycle.get(status, 0) + 1
        semantic_store_available = True
    except Exception:
        pass

    fallback_count: Optional[int] = None
    fallback_store_readable = False
    try:
        fallback_rows = _read_fallback_rows(
            limit=10000,
            tenant_id=principal.tenant_id,
            workspace_id=principal.storage_workspace_id,
            memory_principal_key=principal.memory_principal_key,
            _strict=True,
        )
        fallback_count = len(fallback_rows)
        fallback_store_readable = True
    except FallbackPersistenceError:
        pass
    fallback_persistence_available = (
        fallback_store_readable and _fallback_store_appendable()
    )
    status = (
        "active"
        if semantic_store_available
        else ("degraded" if fallback_persistence_available else "unavailable")
    )

    return {
        "success": semantic_store_available,
        "status": status,
        "total_memories": count,
        "active_memories": (
            lifecycle["active"] if semantic_store_available else None
        ),
        "lifecycle": lifecycle if semantic_store_available else None,
        "fallback_memories": fallback_count,
        "semantic_store_available": semantic_store_available,
        "fallback_persistence_available": fallback_persistence_available,
        "collection": COLLECTION_NAME,
        "novelty_version": "l7l22.v1.2",
        "embedding_health": _embedding_health_snapshot(),
    }
