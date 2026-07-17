"""The Librarian - Vector Memory Plugin for The Cortex.

Provides semantic memory storage and retrieval using ChromaDB.
Includes novelty-aware indexing and retrieval helpers used by L7/L22.
Adds resilient fallback recall paths when embedding providers fail.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from typing import Annotated, List, Optional, Dict, Any
import asyncio
import chromadb
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

from cortex_server.modules.librarian_embedding import build_embedding_function
from cortex_server.modules import runtime_pressure
from cortex_server.modules.memory_scope import (
    AuthenticatedMemoryPrincipal,
    MemoryScopeAuthError,
    PRINCIPAL_FIELDS,
    authenticate_memory_principal,
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

router = APIRouter()
logger = logging.getLogger(__name__)

# Initialize ChromaDB client with persistent storage
# Use host-mounted /app path for durability across container rebuilds.
LEGACY_CHROMA_DIR = "/root/cortex_server/chroma_db"
CHROMA_DATABASE_NAME = "chroma.sqlite3"
CHROMA_AUTHORITY_SENTINEL = ".cortex-memory-authority"
CHROMA_AUTHORITY_SCHEMA = "cortex.memory-authority.v1"
COLLECTION_NAME = "cortex_memory"
READINESS_COLLECTION_NAME = "cortex-durability-readiness"


def _production_memory_mode() -> bool:
    environment = os.getenv("CORTEX_ENV", os.getenv("CORTEX_ENVIRONMENT", "development")).strip().lower()
    strict = os.getenv("CORTEX_REQUIRE_DURABLE_MEMORY", "").strip().lower()
    return environment in {"production", "prod", "staging"} or strict in {"1", "true", "yes", "on"}


def _default_chroma_dir() -> str:
    configured = os.getenv("CORTEX_CHROMA_DIR")
    if configured:
        path = Path(configured).expanduser()
        if not path.is_absolute():
            raise RuntimeError("CORTEX_CHROMA_DIR must be an absolute durable path")
        return str(path)
    if _production_memory_mode():
        raise RuntimeError("CORTEX_CHROMA_DIR is required for durable production memory")
    preferred = Path("/app/cortex_server/chroma_db")
    try:
        preferred.parent.mkdir(parents=True, exist_ok=True)
        if os.access(str(preferred.parent), os.W_OK):
            return str(preferred)
    except Exception:
        pass
    return str(Path.home() / ".cache" / "cortex_server" / "chroma_db")


def _chroma_authority_binding(mount_id: str) -> str:
    return f"{CHROMA_AUTHORITY_SCHEMA}:{mount_id}:{COLLECTION_NAME}"

CHROMA_DIR = _default_chroma_dir()
if os.path.exists(LEGACY_CHROMA_DIR) and not os.path.exists(CHROMA_DIR):
    try:
        shutil.copytree(LEGACY_CHROMA_DIR, CHROMA_DIR)
    except Exception:
        pass


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


_validate_chroma_storage(CHROMA_DIR)
client = chromadb.PersistentClient(path=CHROMA_DIR)

# Use a persistent embedding function by default so ONNX sessions are not recreated
# for every semantic lookup. The legacy Chroma default can still be forced via
# CORTEX_LIBRARIAN_EMBEDDING_MODE=default for reproduction experiments.
embed_fn = build_embedding_function()

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


collection = _load_memory_collection(client, embed_fn)

_FALLBACK_LOG_PATH = Path(os.getenv("LIBRARIAN_FALLBACK_LOG_PATH", f"{CHROMA_DIR}/librarian_fallback.jsonl"))
_FALLBACK_MAX_BYTES = int(os.getenv("LIBRARIAN_FALLBACK_MAX_BYTES", str(16 * 1024 * 1024)))
_FALLBACK_MAX_ROWS = int(os.getenv("LIBRARIAN_FALLBACK_MAX_ROWS", "5000"))
_FALLBACK_MAX_ROW_BYTES = int(os.getenv("LIBRARIAN_FALLBACK_MAX_ROW_BYTES", str(1100 * 1024)))
_FALLBACK_READ_MAX_BYTES = int(os.getenv("LIBRARIAN_FALLBACK_READ_MAX_BYTES", str(4 * 1024 * 1024)))
_LOCAL_FILE_MEMORY_ROOTS_ENV = "LIBRARIAN_LOCAL_FILE_MEMORY_ROOTS"
_SCOPED_LOCAL_FILE_MEMORY_ROOTS_ENV = "LIBRARIAN_SCOPED_LOCAL_FILE_MEMORY_ROOTS"
_DEFAULT_LOCAL_FILE_MEMORY_ROOTS = (
    "/root/clawd/memory",
    "/root/clawd/clients",
)
_LOCAL_FILE_MEMORY_EXTENSIONS = {".md", ".txt"}
_LOCAL_FILE_MEMORY_MAX_FILES = int(os.getenv("LIBRARIAN_LOCAL_FILE_MAX_FILES", "900"))
_LOCAL_FILE_MEMORY_MAX_BYTES = int(os.getenv("LIBRARIAN_LOCAL_FILE_MAX_BYTES", str(768 * 1024)))
_LOCAL_FILE_MEMORY_MIN_SCORE = float(os.getenv("LIBRARIAN_LOCAL_FILE_MIN_SCORE", "0.18"))
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
DEFAULT_TENANT_ID = os.getenv("CORTEX_DEFAULT_TENANT_ID", "cortex-local").strip() or "cortex-local"
DEFAULT_WORKSPACE_ID = os.getenv("CORTEX_DEFAULT_WORKSPACE_ID", "default").strip() or "default"
MemoryScopeId = Annotated[str, Field(min_length=1, max_length=MAX_MEMORY_SCOPE_ID_LENGTH, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:@/-]*$")]


class FactSupersessionError(RuntimeError):
    """A new fact was removed because prior versions could not be superseded."""


class FallbackPersistenceError(RuntimeError):
    """The bounded fallback store could not durably commit a memory row."""


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
        )
    except MemoryScopeAuthError as exc:
        status_code = 503 if "not configured" in str(exc) else 403
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


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
    if not isinstance(entry, dict) or entry.get("version") != 1:
        raise FactSupersessionError(f"invalid fact supersession journal: {journal_path.name}")
    required_strings = ("transaction_id", "fact_key", "memory_id", "text")
    if any(not isinstance(entry.get(key), str) or not entry[key] for key in required_strings):
        raise FactSupersessionError(f"invalid fact supersession journal: {journal_path.name}")
    if not isinstance(entry.get("metadata"), dict):
        raise FactSupersessionError(f"invalid fact supersession journal: {journal_path.name}")
    return entry


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
        entry = _read_fact_supersession_journal(journal_path)
        fact_key = entry["fact_key"]
        memory_id = entry["memory_id"]
        tenant_id, workspace_id = _memory_scope(entry.get("tenant_id"), entry.get("workspace_id"))
        metadata = _normalize_memory_metadata(
            entry["metadata"], tenant_id=tenant_id, workspace_id=workspace_id
        )
        try:
            current = _collection_fact_rows(fact_key, tenant_id, workspace_id)
            current_ids = list(current.get("ids") or [])
            if memory_id not in current_ids:
                pending_metadata = {
                    **metadata,
                    "memory_status": "tombstoned",
                    "tombstoned": True,
                    "supersession_pending": True,
                }
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
            )
            active_metadata = dict(metadata)
            active_metadata.pop("tombstoned", None)
            active_metadata.pop("supersession_pending", None)
            active_metadata["memory_status"] = "active"
            collection.update(ids=[memory_id], metadatas=[active_metadata])
            _append_fallback_fact_supersession(
                fact_key,
                superseded_by=memory_id,
                tenant_id=tenant_id,
                workspace_id=workspace_id,
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
MemoryTag = Annotated[str, Field(max_length=256)]


def _validate_memory_metadata(value: Optional[dict]) -> Optional[dict]:
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


class SearchRequest(BaseModel):
    query: str = Field(..., max_length=16_384)
    n_results: int = Field(3, ge=1, le=100)
    allow_fallback: bool = True
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
    memory_ids: List[str] = Field(..., min_items=1, max_items=500)
    superseded_by: Optional[str] = None
    reason: str = "explicit_correction"
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


_CANONICAL_PROJECT_INDEX = Path(os.getenv("CORTEX_CANONICAL_PROJECT_INDEX", "/root/clawd/memory/projects/INDEX.md"))
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


def _canonical_project_registry() -> List[Dict[str, Any]]:
    """Parse the user-maintained canonical registry instead of duplicating it in code."""
    try:
        text = _CANONICAL_PROJECT_INDEX.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []
    rows: List[Dict[str, Any]] = []
    for line in text.splitlines():
        if not line.lstrip().startswith("|") or "`memory/projects/" not in line:
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 2:
            continue
        aliases = [part.strip() for part in re.split(r",|/", cells[0]) if part.strip()]
        match = re.search(r"`([^`]+)`", cells[1])
        if not match:
            continue
        workspace_root = _CANONICAL_PROJECT_INDEX.parents[2] if len(_CANONICAL_PROJECT_INDEX.parents) >= 3 else Path("/root/clawd")
        path = workspace_root / match.group(1)
        rows.append({"aliases": aliases, "path": path, "rel_path": match.group(1)})
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


def _collection_fact_rows(fact_key: str, tenant_id: str, workspace_id: str) -> Dict[str, Any]:
    where = (
        {"fact_key": str(fact_key)}
        if _is_default_scope(tenant_id, workspace_id)
        else {
            "scoped_fact_key": sha256(
                f"{tenant_id}\0{workspace_id}\0{fact_key}".encode("utf-8")
            ).hexdigest()
        }
    )
    data = collection.get(where=where, include=["documents", "metadatas"])
    ids = data.get("ids") or []
    documents = data.get("documents") or []
    metadatas = data.get("metadatas") or []
    selected = [
        index
        for index, metadata in enumerate(metadatas)
        if _metadata_matches_scope(metadata, tenant_id, workspace_id)
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
) -> Dict[str, Any]:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    if not _skip_recovery:
        _recover_fact_supersessions()
    ids = [str(value).strip() for value in memory_ids if str(value or "").strip()]
    if not ids:
        return {"updated": 0, "missing": []}
    try:
        data = collection.get(ids=ids, include=["metadatas"])
    except Exception:
        if _skip_recovery:
            raise
        data = {"ids": [], "metadatas": []}
    found_ids = data.get("ids") or []
    metas = data.get("metadatas") or []
    updated = []
    scoped_ids = []
    for index, memory_id in enumerate(found_ids):
        prior_metadata = metas[index] if index < len(metas) else {}
        if not _metadata_matches_scope(prior_metadata, tenant, workspace):
            continue
        metadata = _normalize_memory_metadata(
            prior_metadata, tenant_id=tenant, workspace_id=workspace
        )
        metadata.update({
            "memory_status": "superseded",
            "superseded": True,
            "superseded_at": _utc_iso(),
            "supersession_reason": str(reason or "explicit_correction")[:240],
        })
        if superseded_by:
            metadata["superseded_by"] = str(superseded_by)
        updated.append(metadata)
        scoped_ids.append(memory_id)
    if scoped_ids:
        collection.update(ids=scoped_ids, metadatas=updated)
    if not _skip_recovery:
        _append_fallback_id_supersession(
            ids,
            superseded_by=superseded_by,
            reason=reason,
            tenant_id=tenant,
            workspace_id=workspace,
        )
    missing = [memory_id for memory_id in ids if memory_id not in set(scoped_ids)]
    return {"updated": len(scoped_ids), "ids": scoped_ids, "missing": missing, "superseded_by": superseded_by}


def _supersede_prior_fact_versions(
    fact_key: str,
    *,
    superseded_by: str,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> int:
    if not str(fact_key or "").strip():
        return 0
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    with _fact_supersession_transaction():
        _recover_fact_supersessions_locked()
        data = _collection_fact_rows(str(fact_key), tenant, workspace)
        ids = [value for value in (data.get("ids") or []) if value != superseded_by]
        return int(supersede_memory_records(
            ids,
            superseded_by=superseded_by,
            reason="newer_fact_key_revision",
            _skip_recovery=True,
            tenant_id=tenant,
            workspace_id=workspace,
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
    with _fact_supersession_transaction():
        _recover_fact_supersessions_locked()
        if not fact_key:
            collection.add(ids=[memory_id], documents=[text], metadatas=[metadata])
            return
        prior = _collection_fact_rows(fact_key, tenant, workspace)
        prior_ids = [value for value in (prior.get("ids") or []) if value != memory_id]
        prior_metas = list(prior.get("metadatas") or [])
        try:
            journal_path = _write_fact_supersession_journal({
                "version": 1,
                "transaction_id": uuid.uuid4().hex,
                "fact_key": fact_key,
                "memory_id": memory_id,
                "text": text,
                "metadata": metadata,
                "created_at": _utc_iso(),
                "tenant_id": tenant,
                "workspace_id": workspace,
            })
        except Exception as exc:
            raise FactSupersessionError(
                "fact supersession journal could not be persisted; existing fact was preserved"
            ) from exc
        pending_metadata = {**metadata, "memory_status": "tombstoned", "tombstoned": True,
                            "supersession_pending": True}
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
            )
            active_metadata = dict(metadata)
            active_metadata.pop("tombstoned", None)
            active_metadata.pop("supersession_pending", None)
            active_metadata["memory_status"] = "active"
            collection.update(ids=[memory_id], metadatas=[active_metadata])
            _append_fallback_fact_supersession(
                fact_key,
                superseded_by=memory_id,
                tenant_id=tenant,
                workspace_id=workspace,
            )
            chroma_committed = True
        except Exception as exc:
            compensation_errors = []
            try:
                collection.delete(ids=[memory_id])
            except Exception as compensation_exc:
                compensation_errors.append(str(compensation_exc))
            try:
                if prior_ids:
                    collection.update(ids=prior_ids, metadatas=prior_metas)
            except Exception as compensation_exc:
                compensation_errors.append(str(compensation_exc))
            if compensation_errors:
                raise FactSupersessionError("fact supersession and compensation failed: " + "; ".join(compensation_errors)) from exc
            try:
                _remove_fact_supersession_journal(journal_path)
            except Exception as compensation_exc:
                raise FactSupersessionError("fact supersession compensation could not clear its journal") from compensation_exc
            raise FactSupersessionError("fact supersession failed; new version was removed") from exc
        if chroma_committed:
            try:
                _remove_fact_supersession_journal(journal_path)
            except Exception as exc:
                logger.warning(
                    "fact supersession committed; recovery journal cleanup remains pending for %s: %s",
                    journal_path.name,
                    exc,
                )


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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
        if isinstance(obj, dict):
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
    _strict: bool = False,
) -> List[Dict[str, Any]]:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    rows = [
        row
        for row in _raw_fallback_rows(limit, strict=_strict)
        if _metadata_matches_scope(row.get("metadata") or row, tenant, workspace)
    ]
    tombstoned_ids: set[str] = set()
    latest_fact_event: Dict[str, tuple[str, str]] = {}
    for row in rows:
        kind = str(row.get("kind") or "memory")
        if kind == "id_supersession":
            tombstoned_ids.update(str(value) for value in row.get("memory_ids", []) or [])
            continue
        fact_key = str(row.get("fact_key") or (row.get("metadata") or {}).get("fact_key") or "").strip()
        if not fact_key:
            continue
        if kind == "fact_supersession":
            latest_fact_event[fact_key] = ("marker", str(row.get("superseded_by") or ""))
        else:
            latest_fact_event[fact_key] = ("memory", str(row.get("id") or ""))

    active: List[Dict[str, Any]] = []
    for row in rows:
        if str(row.get("kind") or "memory") != "memory":
            continue
        memory_id = str(row.get("id") or "")
        if memory_id in tombstoned_ids:
            continue
        fact_key = str((row.get("metadata") or {}).get("fact_key") or "").strip()
        if fact_key and latest_fact_event.get(fact_key) != ("memory", memory_id):
            continue
        active.append(row)
    return active[-max(1, int(limit)):]


def _append_fallback_fact_supersession(
    fact_key: str,
    *,
    superseded_by: str,
    tenant_id: str,
    workspace_id: str,
) -> None:
    active = _read_fallback_rows(
        limit=_FALLBACK_MAX_ROWS,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        _strict=True,
    )
    if not any(str((row.get("metadata") or {}).get("fact_key") or "") == fact_key for row in active):
        return
    _append_fallback_row({
        "kind": "fact_supersession",
        "fact_key": fact_key,
        "superseded_by": superseded_by,
        "tenant_id": tenant_id,
        "workspace_id": workspace_id,
        "stored_at": _utc_iso(),
    })


def _append_fallback_id_supersession(
    memory_ids: List[str],
    *,
    superseded_by: Optional[str],
    reason: str,
    tenant_id: str,
    workspace_id: str,
) -> None:
    requested = {str(value) for value in memory_ids}
    active_ids = {
        str(row.get("id") or "")
        for row in _read_fallback_rows(
            limit=_FALLBACK_MAX_ROWS,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            _strict=True,
        )
    }
    matched = sorted(requested & active_ids)
    if not matched:
        return
    _append_fallback_row({
        "kind": "id_supersession",
        "memory_ids": matched,
        "superseded_by": superseded_by,
        "reason": str(reason or "explicit_correction")[:240],
        "tenant_id": tenant_id,
        "workspace_id": workspace_id,
        "stored_at": _utc_iso(),
    })


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
        authoritative_collection = (
            _load_memory_collection(client, embed_fn)
            if _production_memory_mode()
            else collection
        )
        count = int(authoritative_collection.count())
        if count < 0:
            raise RuntimeError("memory collection returned an invalid count")
        if _production_memory_mode():
            probe_collection = client.get_collection(
                name=READINESS_COLLECTION_NAME,
                embedding_function=None,
            )
        else:
            probe_collection = client.get_or_create_collection(
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
        except Exception:
            continue
        if path.exists() and path not in roots:
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
) -> List[Dict[str, Any]]:
    cap = max(1, min(int(limit), 200))
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    try:
        kwargs: Dict[str, Any] = {"limit": cap, "include": ["documents", "metadatas"]}
        where = _scope_where(tenant, workspace)
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
        if not _metadata_matches_scope(metadata, tenant, workspace):
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
) -> bool:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    try:
        scoped_fp = sha256(f"{tenant}\0{workspace}\0{fp}".encode("utf-8")).hexdigest()
        where = (
            {"novelty_fingerprint": fp}
            if _is_default_scope(tenant, workspace)
            else {"scoped_novelty_fingerprint": scoped_fp}
        )
        probe = collection.get(where=where, limit=10, include=["metadatas"])
    except Exception:
        return False
    metas = probe.get("metadatas") or []
    return any(_metadata_matches_scope(meta, tenant, workspace) for meta in metas)


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
) -> float:
    text_tokens = set(_tokenize(text))
    if not text_tokens:
        return 0.5

    text_fp = _fingerprint(text)
    if _fingerprint_exists(text_fp, tenant_id=tenant_id, workspace_id=workspace_id):
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
) -> Dict[str, Any]:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    existing = dict(metadata or {})
    recent = _safe_recent_docs(
        compare_window, tenant_id=tenant, workspace_id=workspace
    )
    novelty_score = _estimate_novelty(
        text,
        recent,
        tenant_id=tenant,
        workspace_id=workspace,
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


def _rank_memory_row(query: str, row: Dict[str, Any]) -> Dict[str, Any]:
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
    if memory_status in {"superseded", "tombstoned"} and not _query_wants_historical_memory(query):
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
        "historical_only": memory_status in {"superseded", "tombstoned"},
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
) -> List[Dict[str, Any]]:
    ranked: Dict[str, Dict[str, Any]] = {}
    for row in semantic_rows + lexical_rows:
        candidate = _rank_memory_row(query, dict(row))
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

    if not _query_wants_historical_memory(query):
        ordered = [row for row in ordered if _memory_status(row.get("metadata")) not in {"superseded", "tombstoned"}]

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


def _semantic_rows_need_help(query: str, rows: List[Dict[str, Any]]) -> bool:
    if not rows:
        return True
    ranked = [_rank_memory_row(query, dict(row)) for row in rows[:5]]
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
) -> List[Dict[str, Any]]:
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    scoped_kwargs = _scoped_call_kwargs(tenant, workspace)
    rows: List[Dict[str, Any]] = []
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
            where = _scope_where(tenant, workspace)
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
                if not _metadata_matches_scope(metadata, tenant, workspace):
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
        where = _scope_where(tenant, workspace)
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
            if not _metadata_matches_scope(metadata, tenant, workspace):
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
    for row in _read_fallback_rows(limit=max(40, scan_limit), **scoped_kwargs):
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
) -> Dict[str, Any]:
    if not (query or "").strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    tenant, workspace = _memory_scope(tenant_id, workspace_id)
    scoped_kwargs = _scoped_call_kwargs(tenant, workspace)
    _recover_fact_supersessions()

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
        where = _scope_where(tenant, workspace)
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
            if not _metadata_matches_scope(metadata, tenant, workspace):
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
            canonical_rows = _canonical_project_search_rows(
                query,
                n_results=max(6, int(n_results) * 2),
                **scoped_kwargs,
            )
            ranked_exact_rows = _merge_ranked_rows(query, [], exact_rows + canonical_rows, n_results=max(len(exact_rows) + len(canonical_rows), max(1, int(n_results))))
            real_exact_rows = [
                row for row in ranked_exact_rows
                if not bool((row.get("metadata") or {}).get("codec_state_noise"))
                and float(row.get("score") or 0.0) >= 0.22
            ]
            exact_results = (real_exact_rows or ranked_exact_rows)[: max(1, int(n_results))]
            for row in exact_results:
                metadata = dict(row.get("metadata") or {})
                if metadata.get("recall_mode") == "exact_chroma_contains" and not bool(metadata.get("codec_state_noise")):
                    metadata["memory_system_meta_noise"] = False
                    metadata["exact_recall_override"] = True
                    row["metadata"] = metadata
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
            "n_results": max(1, int(n_results)),
        }
        where = _scope_where(tenant, workspace)
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
                if not _metadata_matches_scope(metadata, tenant, workspace):
                    continue
                out_rows.append(
                    {
                        "id": row_id,
                        "text": docs[0][i] if docs and docs[0] and i < len(docs[0]) else "",
                        "distance": dists[0][i] if dists and dists[0] and i < len(dists[0]) else 0.0,
                        "metadata": metadata,
                    }
                )

        semantic_rows = out_rows
        if out_rows and not _semantic_rows_need_help(query, out_rows):
            local_rows = _local_file_memory_search_rows(
                query,
                n_results=max(int(n_results) * 3, 8),
                scan_limit=max(int(n_results) * 40, 240),
                **scoped_kwargs,
            )
            canonical_rows = _canonical_project_search_rows(
                query,
                n_results=max(int(n_results) * 2, 8),
                **scoped_kwargs,
            )
            strong_local_rows = [row for row in local_rows if float(row.get("_score", 0.0)) >= max(_LOCAL_FILE_MEMORY_MIN_SCORE, 0.34)] + canonical_rows
            if strong_local_rows:
                return {
                    "query": query,
                    "results": _merge_ranked_rows(query, out_rows, strong_local_rows, n_results=max(1, int(n_results))),
                    "search_mode": "semantic_hybrid",
                    "degraded": False,
                    "warning": None,
                    "available": True,
                }
            return {
                "query": query,
                "results": _merge_ranked_rows(query, out_rows, [], n_results=max(1, int(n_results))),
                "search_mode": "semantic",
                "degraded": False,
                "warning": None,
                "available": True,
            }

        semantic_warning = "semantic_low_signal" if out_rows else "semantic_empty"
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
        n_results=max(1, int(n_results)),
        availability=fallback_availability,
        **scoped_kwargs,
    )
    memory_available = exact_query_succeeded or semantic_query_succeeded or any(fallback_availability)
    merged_rows = _merge_ranked_rows(query, semantic_rows, lexical_rows, n_results=max(1, int(n_results)))
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
        "results": lexical_rows,
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
) -> Dict[str, Any]:
    if not (query or "").strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
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

    fetch_n = max(1, min(int(n_results) * 3, 50))
    warning: Optional[str] = None
    degraded = False

    try:
        query_kwargs: Dict[str, Any] = {"query_texts": [query], "n_results": fetch_n}
        where = _scope_where(tenant, workspace)
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
                if not _metadata_matches_scope(metadata, tenant, workspace):
                    continue
                dist = dists[0][i] if dists and dists[0] and i < len(dists[0]) else 0.0
                novelty_score = metadata.get("novelty_score")
                if novelty_score is None:
                    novelty_score = _estimate_novelty(
                        text,
                        _safe_recent_docs(limit=15, **scoped_kwargs),
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
        **scoped_kwargs,
    )
    scored_rows: List[Dict[str, Any]] = []
    for row in fallback_rows:
        lex = float((row.get("metadata") or {}).get("lexical_score", 0.0))
        novelty_score = _estimate_novelty(
            str(row.get("text") or ""),
            _safe_recent_docs(limit=15, **scoped_kwargs),
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
async def librarian_status():
    """L7 Librarian status."""
    embedding = _embedding_health_snapshot()
    collection_available = await _collection_available()
    fallback_available = _fallback_store_appendable()
    scope_auth_ready = _memory_scope_auth_ready()
    available = (collection_available or fallback_available) and scope_auth_ready
    explicitly_configured = bool(os.getenv("CORTEX_CHROMA_DIR", "").strip())
    return {
        "success": available,
        "level": 7,
        "name": "Librarian",
        "status": "active" if available else "unavailable",
        "capabilities": [
            "embed",
            "search",
            "semantic_indexing",
            "embed_novel",
            "search_novel",
            "novelty_reranking",
            "robust_recall_fallback",
            "canonical_project_precedence",
            "supersession_tombstones",
        ],
        "novelty_version": "l7l22.v1.2",
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
async def embed_memory(request: EmbedRequest):
    """Store text in vector memory with semantic embedding.

    If embedding providers fail, persist to fallback log so recall remains possible.
    """
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    principal = _authenticated_memory_principal_scope(
        request.tenant_id,
        request.workspace_id,
        request.scope_signature,
        scope=request.scope,
        scope_credential_id=request.scope_credential_id,
    )
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    memory_id = str(uuid.uuid4())
    metadata = _normalize_memory_metadata(
        {**dict(request.metadata or {}), **principal.storage_metadata},
        tenant_id=tenant,
        workspace_id=workspace,
    )

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
    return EmbedResponse(id=memory_id, status=status)


@router.post("/embed_novel", response_model=NovelEmbedResponse)
async def embed_memory_novel(request: NovelEmbedRequest):
    """Store text with novelty metadata for L7/L22 orchestration."""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    principal = _authenticated_memory_principal_scope(
        request.tenant_id,
        request.workspace_id,
        request.scope_signature,
        scope=request.scope,
        scope_credential_id=request.scope_credential_id,
    )
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    memory_id = str(uuid.uuid4())
    enriched_metadata = _normalize_memory_metadata(_build_novel_metadata(
        text=request.text,
        metadata={**dict(request.metadata or {}), **principal.storage_metadata},
        novelty_tags=request.novelty_tags,
        source_scope="l7",
        compare_window=request.compare_window,
        tenant_id=tenant,
        workspace_id=workspace,
    ), tenant_id=tenant, workspace_id=workspace)
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


@router.post("/search", response_model=SearchResponse)
async def search_memory(request: SearchRequest):
    """Search vector memory for semantically similar content.

    Falls back to lexical recall when semantic embedding/query is unavailable.
    """
    principal = _authenticated_memory_principal_scope(
        request.tenant_id,
        request.workspace_id,
        request.scope_signature,
        scope=request.scope,
        scope_credential_id=request.scope_credential_id,
    )
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    result = robust_search(
        request.query,
        n_results=request.n_results,
        allow_fallback=request.allow_fallback,
        tenant_id=tenant,
        workspace_id=workspace,
    )
    memories = [MemoryResult(**row) for row in result.get("results", [])]
    return SearchResponse(
        query=request.query,
        results=memories,
        search_mode=str(result.get("search_mode", "semantic")),
        degraded=bool(result.get("degraded", False)),
        warning=result.get("warning"),
    )


@router.post("/search_novel", response_model=NovelSearchResponse)
async def search_memory_novel(request: NovelSearchRequest):
    """Search memory and rerank by semantic relevance + novelty."""
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
        allow_fallback=request.allow_fallback,
        tenant_id=tenant,
        workspace_id=workspace,
    )

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
async def recall_memory(request: RecallRequest):
    """Trustable recall path: semantic first, lexical fallback guaranteed."""
    principal = _authenticated_memory_principal_scope(
        request.tenant_id,
        request.workspace_id,
        request.scope_signature,
        scope=request.scope,
        scope_credential_id=request.scope_credential_id,
    )
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    result = robust_search(
        request.query,
        n_results=request.n_results,
        allow_fallback=True,
        tenant_id=tenant,
        workspace_id=workspace,
    )
    memories = [MemoryResult(**row) for row in result.get("results", [])]
    return RecallResponse(
        query=request.query,
        mode=str(result.get("search_mode", "semantic")),
        results=memories,
        degraded=bool(result.get("degraded", False)),
        warning=result.get("warning"),
    )


@router.post("/supersede")
async def supersede_memory(request: SupersedeRequest):
    """Mark semantic records as historical without deleting their audit trail."""
    principal = _authenticated_memory_principal_scope(
        request.tenant_id,
        request.workspace_id,
        request.scope_signature,
        scope=request.scope,
        scope_credential_id=request.scope_credential_id,
    )
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id
    return {"success": True, **supersede_memory_records(
        request.memory_ids,
        superseded_by=request.superseded_by,
        reason=request.reason,
        tenant_id=tenant,
        workspace_id=workspace,
    )}


@router.get("/stats")
async def memory_stats():
    """Get statistics about the memory collection."""
    count = 0
    try:
        count = int(collection.count())
    except Exception:
        count = 0

    fallback_count = len(_read_fallback_rows(limit=10000))

    return {
        "total_memories": count,
        "fallback_memories": fallback_count,
        "collection": COLLECTION_NAME,
        "novelty_version": "l7l22.v1.2",
        "embedding_health": _embedding_health_snapshot(),
    }
