"""
Knowledge Graph Router - API endpoints for graph operations.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from typing import Annotated, Optional, List, Dict, Any
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import os
import sqlite3
import stat
import subprocess
import tempfile
from cortex_server.models.requests import (
    GraphQueryRequest, GraphNodeCreateRequest, GraphEdgeCreateRequest,
    GraphQueryResponse, GraphNodeResponse, GraphEdgeResponse
)
from cortex_server.services.knowledge_service import KnowledgeService
from cortex_server.services.codebase_snapshot import (
    SNAPSHOT_ALGORITHM,
    codebase_source_snapshot,
)
from cortex_server.routers.librarian import (
    DEFAULT_TENANT_ID,
    DEFAULT_WORKSPACE_ID,
    MemoryPrincipalScope,
    MemoryScopeId,
    _authenticated_memory_principal_scope,
    collection,
    robust_search,
)
from cortex_server.knowledge.graph import NodeType, EdgeType
from cortex_server.modules.prior_art_gate import build_prior_art_gate, extract_prior_art_terms
from cortex_server.modules.memory_scope import (
    AuthenticatedMemoryPrincipal,
    memory_principal_for_request,
    principal_memory_where,
    require_authenticated_memory_principal,
    scoped_memory_metadata,
)

router = APIRouter(dependencies=[Depends(require_authenticated_memory_principal)])
service = KnowledgeService()

_DEFAULT_DURABLE_MEMORY_ROOTS = [Path("/root/clawd/memory")]
_DEFAULT_CODEBASE_INDEX_ROOT = Path("/root/clawd/artifacts/cortex-codebase-memory")
_DEFAULT_CODEBASE_SOURCE_ROOT = Path("/root/clawd")
_DEFAULT_CODEBASE_INDEX_MAX_AGE_SECONDS = 24 * 60 * 60
_MAX_CODEBASE_INDEX_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
_CODEBASE_INDEX_SCHEMA_VERSION = "cortex.codebase-index-artifact.v3"
_CODEBASE_INDEXER_VERSION = "cortex-structural-indexer.v3"
_MAX_CANONICAL_MANIFEST_FILES = 512
_MAX_CANONICAL_MANIFEST_FILE_BYTES = 8 * 1024 * 1024
_MAX_DURABLE_MEMORY_INVENTORY_ENTRIES = 10_000
_LEGACY_MEMORY_STORE_PATHS = [
    Path("/app/cortex_server/knowledge/auto_memory.jsonl"),
    Path("/app/cortex_server/chroma_db/librarian_fallback.jsonl"),
    Path("/root/cortex_server/chroma_db"),
]

BoundedKnowledgeText = Annotated[str, Field(max_length=16_384)]

MAX_GRAPH_STRING_LENGTH = 16_384
MAX_GRAPH_TYPE_LENGTH = 256
MAX_GRAPH_LANGUAGE_LENGTH = 256
MAX_GRAPH_METADATA_BYTES = 65_536
MAX_GRAPH_METADATA_DEPTH = 8
MAX_GRAPH_METADATA_NODES = 1_000
MAX_GRAPH_METADATA_STRING = 16_384
MAX_GRAPH_METADATA_KEY = 256


def _validate_graph_metadata(value: Dict[str, Any]) -> Dict[str, Any]:
    nodes = 0
    pending = [(value, 0)]
    while pending:
        item, depth = pending.pop()
        nodes += 1
        if nodes > MAX_GRAPH_METADATA_NODES:
            raise ValueError("metadata has too many values")
        if depth > MAX_GRAPH_METADATA_DEPTH:
            raise ValueError("metadata is too deeply nested")
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str) or len(key) > MAX_GRAPH_METADATA_KEY:
                    raise ValueError("metadata keys must be bounded strings")
                pending.append((child, depth + 1))
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)
        elif isinstance(item, str):
            if len(item) > MAX_GRAPH_METADATA_STRING:
                raise ValueError("metadata string is too long")
        elif item is not None and not isinstance(item, (bool, int, float)):
            raise ValueError("metadata contains an unsupported value")

    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError("metadata must be finite JSON") from exc
    if len(encoded) > MAX_GRAPH_METADATA_BYTES:
        raise ValueError("metadata exceeds byte limit")
    return value


class BoundedGraphNodeCreateRequest(GraphNodeCreateRequest):
    id: Optional[str] = Field(default=None, max_length=MAX_GRAPH_STRING_LENGTH)
    type: str = Field(max_length=MAX_GRAPH_TYPE_LENGTH)
    name: str = Field(max_length=MAX_GRAPH_STRING_LENGTH)
    uri: Optional[str] = Field(default=None, max_length=MAX_GRAPH_STRING_LENGTH)
    language: Optional[str] = Field(default=None, max_length=MAX_GRAPH_LANGUAGE_LENGTH)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)

    _bounded_metadata = field_validator("metadata")(_validate_graph_metadata)


class BoundedGraphEdgeCreateRequest(GraphEdgeCreateRequest):
    id: Optional[str] = Field(default=None, max_length=MAX_GRAPH_STRING_LENGTH)
    type: str = Field(max_length=MAX_GRAPH_TYPE_LENGTH)
    source_id: str = Field(max_length=MAX_GRAPH_STRING_LENGTH)
    target_id: str = Field(max_length=MAX_GRAPH_STRING_LENGTH)
    context: Optional[str] = Field(default=None, max_length=MAX_GRAPH_STRING_LENGTH)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)

    _bounded_metadata = field_validator("metadata")(_validate_graph_metadata)


class KnowledgeSearchRequest(BaseModel):
    query: str = Field(..., max_length=16_384)
    n_results: int = Field(5, ge=1, le=100)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class BoundedGraphQueryRequest(GraphQueryRequest):
    query: str = Field(..., max_length=16_384)
    limit: int = Field(100, ge=1, le=100)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class StructuralSearchRequest(BaseModel):
    query: BoundedKnowledgeText = ""
    node_type: Optional[str] = None
    limit: int = Field(25, ge=1, le=100)
    include_neighbors: bool = False
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class PriorArtGateRequest(BaseModel):
    objective: str = Field(..., max_length=32_768)
    planned_capabilities: List[BoundedKnowledgeText] = Field(default_factory=list, max_items=100)
    planned_paths: List[BoundedKnowledgeText] = Field(default_factory=list, max_items=100)
    proposed_action: str = Field("unspecified", max_length=64)
    n_results: int = Field(5, ge=1, le=20)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


class ImpactRequest(BaseModel):
    query: Optional[BoundedKnowledgeText] = None
    node_id: Optional[BoundedKnowledgeText] = None
    edge_type: Optional[str] = None
    direction: str = "both"
    limit: int = Field(10, ge=1, le=50)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope: Optional[MemoryPrincipalScope] = None
    scope_credential_id: Optional[MemoryScopeId] = None
    scope_signature: Optional[str] = Field(None, max_length=256)


_IMPORT_DEFAULT_TENANT_ID = DEFAULT_TENANT_ID
_IMPORT_DEFAULT_WORKSPACE_ID = DEFAULT_WORKSPACE_ID


def _activate_runtime_configuration() -> None:
    """Refresh copied Librarian scope defaults without replacing this router."""

    global DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID
    from cortex_server.routers import librarian

    if DEFAULT_TENANT_ID == _IMPORT_DEFAULT_TENANT_ID:
        DEFAULT_TENANT_ID = librarian.DEFAULT_TENANT_ID
    if DEFAULT_WORKSPACE_ID == _IMPORT_DEFAULT_WORKSPACE_ID:
        DEFAULT_WORKSPACE_ID = librarian.DEFAULT_WORKSPACE_ID
    for model in (
        BoundedGraphNodeCreateRequest,
        BoundedGraphEdgeCreateRequest,
        KnowledgeSearchRequest,
        BoundedGraphQueryRequest,
        StructuralSearchRequest,
        PriorArtGateRequest,
        ImpactRequest,
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


def _graph_principal(request):
    return _authenticated_memory_principal_scope(
        request.tenant_id,
        request.workspace_id,
        request.scope_signature,
        scope=request.scope,
        scope_credential_id=request.scope_credential_id,
    )


def _route_principal(
    request: Any,
    http_request: Optional[Request],
) -> AuthenticatedMemoryPrincipal:
    """Use dependency-authenticated headers on HTTP routes, with direct-call compatibility."""

    if http_request is not None:
        return memory_principal_for_request(http_request)
    return _graph_principal(request)


def _node_to_dict(node) -> Optional[Dict[str, Any]]:
    if node is None:
        return None
    if hasattr(node, "dict"):
        return node.dict()
    return node


def _edge_to_dict(edge) -> Optional[Dict[str, Any]]:
    if edge is None:
        return None
    if hasattr(edge, "dict"):
        return edge.dict()
    return edge


def _neighbor_to_dict(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "direction": entry.get("direction"),
        "edge": _edge_to_dict(entry.get("edge")),
        "node": _node_to_dict(entry.get("node")),
    }


def _graph_principal_key(principal: AuthenticatedMemoryPrincipal) -> str:
    return principal.isolation_key("knowledge-graph")


def _graph_metadata_matches(value: object, principal: AuthenticatedMemoryPrincipal) -> bool:
    return isinstance(value, dict) and str(value.get("knowledge_principal_key") or "") == _graph_principal_key(principal)


def _scoped_graph_metadata(
    principal: AuthenticatedMemoryPrincipal,
    metadata: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    return {
        **scoped_memory_metadata(principal, metadata),
        "knowledge_principal_key": _graph_principal_key(principal),
    }


def _scoped_graph_id(
    principal: AuthenticatedMemoryPrincipal,
    kind: str,
    external_id: object,
) -> str:
    return principal.scoped_resource_id(f"knowledge-{kind}", external_id)


def _principal_graph_nodes(
    principal: AuthenticatedMemoryPrincipal,
    *,
    node_type: Optional[NodeType] = None,
    name_pattern: Optional[str] = None,
    limit: int = 100,
) -> List[Any]:
    requested = max(1, min(int(limit or 100), 1000))
    return service.graph.query(
        node_type=node_type,
        name_pattern=name_pattern,
        limit=requested,
        tenant_id=principal.tenant_id,
        storage_workspace_id=principal.storage_workspace_id,
    )


def _principal_graph_neighbors(
    principal: AuthenticatedMemoryPrincipal,
    node_id: str,
    *,
    edge_type: Optional[EdgeType] = None,
    direction: str = "out",
    limit: int = 100,
) -> List[Dict[str, Any]]:
    return service.graph.get_neighbors(
        node_id,
        edge_type=edge_type,
        direction=direction,
        limit=limit,
        tenant_id=principal.tenant_id,
        storage_workspace_id=principal.storage_workspace_id,
    )


def _principal_semantic_memory_count(
    principal: AuthenticatedMemoryPrincipal,
) -> Optional[int]:
    """Count only rows carrying this principal's server-issued namespace."""

    try:
        data = collection.get(
            where=principal_memory_where(principal),
            include=["metadatas"],
        )
    except Exception:
        return None
    metadatas = data.get("metadatas") or []
    return sum(
        1
        for metadata in metadatas
        if isinstance(metadata, dict)
        and str(metadata.get("memory_principal_key") or "") == principal.memory_principal_key
    )


def _principal_memory_health_payload(
    principal: AuthenticatedMemoryPrincipal,
) -> Dict[str, Any]:
    """Return bounded principal-local health without scanning shared stores."""

    semantic_count = _principal_semantic_memory_count(principal)
    semantic = {
        "ok": semantic_count is not None,
        "status": "available" if semantic_count is not None else "unavailable",
        "count": semantic_count,
        "principalScoped": True,
    }
    try:
        from cortex_server.modules.cortex_codec import get_codec_debug_view

        debug = get_codec_debug_view(
            principal.codec_session_key,
            query="memory health",
            max_chars=420,
            history_limit=3,
            tenant_id=principal.tenant_id,
            workspace_id=principal.storage_workspace_id,
        )
        codec = {
            "ok": bool(debug.get("enabled")) and bool(debug.get("durable_enabled")),
            "availableForSession": bool(debug.get("available")),
            "durableEnabled": bool(debug.get("durable_enabled")),
            "snapshotCount": int((debug.get("persisted_snapshots") or {}).get("count", 0) or 0),
            "sourceEventCount": int(debug.get("source_event_count", 0) or 0),
            "principalScoped": True,
        }
    except Exception:
        codec = {
            "ok": False,
            "availableForSession": False,
            "principalScoped": True,
            "status": "unavailable",
        }

    ok = bool(semantic["ok"] and codec["ok"])
    return {
        "success": ok,
        "ok": ok,
        "status": "principal_scoped" if ok else "principal_scoped_degraded",
        "generatedAt": _utc_now().isoformat(),
        "components": {"semanticMemory": semantic, "codec": codec},
        "aggregateDetails": "withheld",
        "truthBoundary": (
            "This authenticated compatibility view reports only the caller's semantic-memory "
            "namespace and server-derived Codec session. System-wide health requires a separate "
            "operator-authorized control-plane surface."
        ),
    }


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_from_mtime(path: Path) -> str:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
    except Exception:
        return ""


def _age_seconds(path: Path) -> Optional[float]:
    try:
        return round((_utc_now() - datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)).total_seconds(), 3)
    except Exception:
        return None


def _parse_utc_timestamp(value: Any) -> Optional[datetime]:
    try:
        normalized = str(value or "").strip()
        if not normalized:
            return None
        if normalized.endswith("Z"):
            normalized = normalized[:-1] + "+00:00"
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _sha256_file_snapshot(
    path: Path,
    *,
    max_bytes: Optional[int] = None,
    require_single_link: bool = False,
) -> Dict[str, Any]:
    """Hash one stable regular-file descriptor and return its bound metadata."""

    if path.is_symlink():
        raise ValueError("digest target must be a regular non-symlink file")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    digest = hashlib.sha256()
    total = 0
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("digest target must be a regular non-symlink file")
        if require_single_link and before.st_nlink != 1:
            raise ValueError("digest target must have exactly one filesystem link")
        if max_bytes is not None and before.st_size > max_bytes:
            raise ValueError(f"digest target exceeds {max_bytes} bytes")
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if max_bytes is not None and total > max_bytes:
                raise ValueError(f"digest target exceeds {max_bytes} bytes")
            digest.update(chunk)
        after = os.fstat(descriptor)
        identity = lambda value: (
            value.st_dev,
            value.st_ino,
            value.st_mode,
            value.st_nlink,
            value.st_size,
            value.st_mtime_ns,
            value.st_ctime_ns,
        )
        if identity(before) != identity(after) or total != before.st_size:
            raise RuntimeError("digest target changed while hashing")
        return {
            "sha256": digest.hexdigest(),
            "sizeBytes": int(before.st_size),
            "modifiedAt": datetime.fromtimestamp(
                before.st_mtime, timezone.utc
            ).isoformat(),
            "mode": oct(stat.S_IMODE(before.st_mode)),
        }
    finally:
        os.close(descriptor)


def _sha256_file(path: Path, *, max_bytes: Optional[int] = None) -> str:
    return str(_sha256_file_snapshot(path, max_bytes=max_bytes)["sha256"])


def _codebase_source_root() -> Path:
    configured = os.getenv("CORTEX_CODEBASE_SOURCE_REPO", "").strip()
    return Path(configured).expanduser().resolve() if configured else _DEFAULT_CODEBASE_SOURCE_ROOT.resolve()


def _codebase_index_max_age_seconds() -> int:
    configured = os.getenv("CORTEX_CODEBASE_INDEX_MAX_AGE_SECONDS", "").strip()
    if len(configured) > 12:
        return _DEFAULT_CODEBASE_INDEX_MAX_AGE_SECONDS
    try:
        value = int(configured) if configured else _DEFAULT_CODEBASE_INDEX_MAX_AGE_SECONDS
    except ValueError:
        return _DEFAULT_CODEBASE_INDEX_MAX_AGE_SECONDS
    if value <= 0:
        return _DEFAULT_CODEBASE_INDEX_MAX_AGE_SECONDS
    return min(value, _MAX_CODEBASE_INDEX_MAX_AGE_SECONDS)


def _git_source_identity(root: Path) -> Dict[str, Any]:
    identity: Dict[str, Any] = {
        "sourceRepo": str(root),
        "sourceCommit": None,
        "sourceTreeDigest": None,
        "sourceClean": False,
    }
    try:
        commit = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--verify", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=3,
        ).stdout.strip()
        tree = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--verify", "HEAD^{tree}"],
            check=True,
            capture_output=True,
            text=True,
            timeout=3,
        ).stdout.strip()
        status = subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "status",
                "--porcelain=v1",
                "--untracked-files=normal",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=3,
        ).stdout
        if len(commit) != 40 or len(tree) != 40:
            raise ValueError("git returned a non-SHA-1 identity")
        identity.update(
            sourceCommit=commit,
            sourceTreeDigest=tree,
            sourceClean=not bool(status.strip()),
        )
    except Exception as exc:
        identity["error"] = f"{type(exc).__name__}: {exc}"
    return identity


def _serving_graph_path() -> Optional[Path]:
    try:
        storage = getattr(service.graph, "storage", service.graph)
        configured = str(getattr(storage, "db_path", "") or "").strip()
        return Path(configured).expanduser().resolve() if configured else None
    except Exception:
        return None


def _serving_graph_database_counts(path: Path) -> Dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("serving graph must be a regular non-symlink file")
    connection = sqlite3.connect(
        f"{path.resolve().as_uri()}?mode=ro&immutable=1",
        uri=True,
    )
    try:
        schema = {
            str(name): str(kind)
            for name, kind in connection.execute(
                "SELECT name, type FROM sqlite_master "
                "WHERE name IN ('nodes', 'edges')"
            )
        }
        if schema != {"nodes": "table", "edges": "table"}:
            raise RuntimeError("serving graph is missing its required SQLite schema")
        return {
            "nodeCount": int(
                connection.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
            ),
            "edgeCount": int(
                connection.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
            ),
        }
    except sqlite3.Error as exc:
        raise RuntimeError("serving graph is not a readable SQLite graph") from exc
    finally:
        connection.close()


def _serving_graph_runtime_counts() -> Dict[str, int]:
    stats = service.graph.stats()
    return {
        "nodeCount": int(stats.get("nodeCount", 0) or 0),
        "edgeCount": int(stats.get("edgeCount", 0) or 0),
    }


def _latest_index_artifact(root: Path = _DEFAULT_CODEBASE_INDEX_ROOT) -> Optional[Path]:
    if not root.exists():
        return None
    candidates = []
    for candidate in root.glob("*.json"):
        if not candidate.is_file():
            continue
        if "_quarantine" in candidate.parts:
            continue
        candidates.append(candidate)
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def _semantic_memory_health() -> Dict[str, Any]:
    count = None
    search_mode = "unknown"
    degraded = None
    warning = None
    result_count = None
    try:
        count = int(collection.count())
    except Exception as exc:
        return {"ok": False, "count": None, "error": str(exc)}
    try:
        result = robust_search("Cortex memory health", n_results=1, allow_fallback=True)
        search_mode = result.get("search_mode", "semantic")
        degraded = bool(result.get("degraded", False))
        warning = result.get("warning")
        result_count = len(result.get("results", []) or [])
        search_ok = search_mode != "error"
    except Exception as exc:
        return {"ok": False, "count": count, "searchMode": "error", "error": str(exc)}
    lifecycle = {"active": 0, "superseded": 0, "tombstoned": 0, "historical": 0}
    try:
        data = collection.get(include=["metadatas"])
        from cortex_server.routers.librarian import _memory_status
        for metadata in data.get("metadatas") or []:
            status = _memory_status(metadata)
            lifecycle[status] = lifecycle.get(status, 0) + 1
    except Exception:
        lifecycle = {}
    return {
        "ok": count > 0 and search_ok,
        "count": count,
        "searchOk": search_ok,
        "searchMode": search_mode,
        "degraded": degraded,
        "warning": warning,
        "resultCount": result_count,
        "lifecycle": lifecycle,
    }


def _codec_health() -> Dict[str, Any]:
    try:
        from cortex_server.modules.codec_policy import get_codec_policy_status
        from cortex_server.modules.cortex_codec import get_codec_debug_view, _fetch_global_codec_rows_from_l22

        session_key = "memory_health_gate"
        policy = get_codec_policy_status(query="memory health", session_key=session_key)
        debug = get_codec_debug_view(session_key, query="memory health", max_chars=420, history_limit=3)
        global_rows = _fetch_global_codec_rows_from_l22(limit=200)
        valid_snapshots = 0
        global_source_events = 0
        latest_snapshot_at = ""
        for row in global_rows:
            try:
                import json
                state = json.loads(row.get("document") or "{}")
                if isinstance(state, dict) and state.get("schema_version"):
                    valid_snapshots += 1
                    global_source_events += int(state.get("source_event_count", 0) or 0)
                latest_snapshot_at = max(latest_snapshot_at, str(row.get("generated_at") or ""))
            except Exception:
                continue
        continuity_ready = bool(global_rows) and valid_snapshots > 0 and global_source_events > 0
        return {
            "ok": bool(policy.get("enabled")) and bool(debug.get("enabled")) and bool(debug.get("durable_enabled")) and continuity_ready,
            "policyEnabled": bool(policy.get("enabled")),
            "version": policy.get("version"),
            "durableEnabled": bool(debug.get("durable_enabled")),
            "availableForSession": continuity_ready,
            "persistedSnapshots": {
                "count": len(global_rows),
                "recent": [str(row.get("generated_at") or "") for row in global_rows[:3]],
            },
            "sourceEventCount": global_source_events,
            "stateFingerprint": debug.get("state_fingerprint"),
            "probeSession": {
                "sessionKey": session_key,
                "available": bool(debug.get("available")),
                "snapshotCount": int((debug.get("persisted_snapshots") or {}).get("count", 0) or 0),
                "sourceEventCount": int(debug.get("source_event_count", 0) or 0),
            },
            "continuityReady": continuity_ready,
            "globalPersistedSnapshotCount": len(global_rows),
            "validSnapshotCount": valid_snapshots,
            "globalSourceEventCount": global_source_events,
            "latestSnapshotAt": latest_snapshot_at or None,
            "note": "Top-level continuity fields validate the shared durable ledger; probeSession separately reports the isolated health probe key.",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _durable_file_memory_health() -> Dict[str, Any]:
    roots = []
    file_count = 0
    project_file_count = 0
    latest_path = None
    latest_mtime = 0.0
    scan_errors = []
    visited_entries = 0

    def record_error(path: Path, exc: object) -> None:
        if len(scan_errors) < 20:
            detail = (
                f"{type(exc).__name__}: {exc}"
                if isinstance(exc, BaseException)
                else str(exc)
            )
            scan_errors.append({"path": str(path), "error": detail})

    for root in _DEFAULT_DURABLE_MEMORY_ROOTS:
        try:
            root_metadata = root.lstat()
            exists = True
        except FileNotFoundError:
            root_metadata = None
            exists = False
        except Exception as exc:
            root_metadata = None
            exists = False
            record_error(root, exc)
        root_is_directory = bool(
            root_metadata
            and stat.S_ISDIR(root_metadata.st_mode)
            and not stat.S_ISLNK(root_metadata.st_mode)
        )
        root_row = {
            "path": str(root),
            "configured": True,
            "available": exists,
            "readable": bool(root_is_directory and os.access(root, os.R_OK)),
            "symlink": bool(root_metadata and stat.S_ISLNK(root_metadata.st_mode)),
        }
        roots.append(root_row)
        if not exists:
            continue
        if not root_is_directory:
            record_error(root, "durable memory root is not a regular non-symlink directory")
            continue
        directories = [root]
        while directories:
            current = directories.pop()
            try:
                with os.scandir(current) as scan:
                    entries = sorted(scan, key=lambda entry: entry.name)
            except Exception as exc:
                record_error(current, exc)
                continue
            children = []
            for entry in entries:
                visited_entries += 1
                candidate = current / entry.name
                if visited_entries > _MAX_DURABLE_MEMORY_INVENTORY_ENTRIES:
                    record_error(
                        candidate,
                        "durable memory inventory exceeds the visited-entry limit",
                    )
                    directories.clear()
                    break
                try:
                    metadata = entry.stat(follow_symlinks=False)
                except Exception as exc:
                    record_error(candidate, exc)
                    continue
                if stat.S_ISLNK(metadata.st_mode):
                    record_error(candidate, "durable memory inventory does not follow symlinks")
                    continue
                if stat.S_ISDIR(metadata.st_mode):
                    if entry.name not in {".git", "node_modules", "__pycache__"}:
                        children.append(candidate)
                    continue
                if candidate.suffix.lower() not in {".md", ".txt"}:
                    continue
                if not stat.S_ISREG(metadata.st_mode):
                    record_error(candidate, "durable memory entry is not a regular file")
                    continue
                try:
                    descriptor = os.open(
                        candidate,
                        os.O_RDONLY
                        | getattr(os, "O_CLOEXEC", 0)
                        | getattr(os, "O_NOFOLLOW", 0),
                    )
                    try:
                        opened = os.fstat(descriptor)
                        if (
                            not stat.S_ISREG(opened.st_mode)
                            or (opened.st_dev, opened.st_ino)
                            != (metadata.st_dev, metadata.st_ino)
                        ):
                            raise RuntimeError("durable memory entry changed while opening")
                    finally:
                        os.close(descriptor)
                except Exception as exc:
                    record_error(candidate, exc)
                    continue
                file_count += 1
                if "projects" in candidate.relative_to(root).parts:
                    project_file_count += 1
                if metadata.st_mtime > latest_mtime:
                    latest_mtime = metadata.st_mtime
                    latest_path = candidate
            directories.extend(reversed(children))
    configured = bool(_DEFAULT_DURABLE_MEMORY_ROOTS)
    available = any(bool(root.get("available")) for root in roots)
    inventory_verified = (
        available
        and all(
            bool(root.get("readable"))
            for root in roots
            if root.get("available")
        )
        and not scan_errors
        and file_count > 0
    )
    return {
        "ok": inventory_verified,
        "configured": configured,
        "available": available,
        "verified": inventory_verified,
        "verificationScope": "readable_file_inventory_only",
        "roots": roots,
        "fileCount": file_count,
        "projectFileCount": project_file_count,
        "visitedEntryCount": visited_entries,
        "maxVisitedEntries": _MAX_DURABLE_MEMORY_INVENTORY_ENTRIES,
        "latestPath": str(latest_path) if latest_path else None,
        "latestModifiedAt": _iso_from_mtime(latest_path) if latest_path else "",
        "scanErrors": scan_errors,
        "semanticFreshnessVerified": False,
        "retentionPolicyVerified": False,
        "permissionPolicyVerified": False,
        "truthBoundary": (
            "Verified means the configured roots were readable and yielded a complete file "
            "inventory. It does not certify semantic freshness, retention, or a permission policy."
        ),
    }


def _canonical_manifest_entry(
    *,
    path: Path,
    display_path: str,
    authority: str,
    containment_root: Path,
) -> Dict[str, Any]:
    entry: Dict[str, Any] = {
        "path": display_path,
        "authority": authority,
        "available": False,
        "verified": False,
        "sha256": None,
        "modifiedAt": None,
        "sizeBytes": None,
        "mode": None,
    }
    display = Path(display_path)
    if display.is_absolute() or ".." in display.parts:
        entry["error"] = "canonical manifest path is not workspace-relative"
        return entry
    try:
        lexical_root = containment_root.expanduser().absolute()
        lexical_path = path.expanduser().absolute()
        relative = lexical_path.relative_to(lexical_root)
        current = Path(lexical_root.anchor)
        for part in lexical_root.parts[1:]:
            current /= part
            if current.is_symlink():
                raise ValueError("canonical containment root has a symlink ancestor")
        current = lexical_root
        for part in relative.parts:
            current /= part
            if current.is_symlink():
                raise ValueError("canonical path has a symlink ancestor")
        resolved_root = lexical_root.resolve(strict=True)
        resolved_path = lexical_path.resolve(strict=True)
        resolved_path.relative_to(resolved_root)
        snapshot = _sha256_file_snapshot(
            path,
            max_bytes=_MAX_CANONICAL_MANIFEST_FILE_BYTES,
            require_single_link=True,
        )
        entry.update(
            available=True,
            sizeBytes=snapshot["sizeBytes"],
            modifiedAt=snapshot["modifiedAt"],
            mode=snapshot["mode"],
            sha256=snapshot["sha256"],
        )
        entry["verified"] = True
    except Exception as exc:
        entry["error"] = f"{type(exc).__name__}: {exc}"
    return entry


def _memory_governance_canary() -> Dict[str, Any]:
    """Replay precedence and recovery state transitions without durable writes."""

    try:
        from cortex_server.routers.librarian import (
            _merge_ranked_rows,
            _supersession_recovery_metadata,
        )

        rows = [
            {
                "id": "canary-live-source",
                "text": "current governance canary value",
                "distance": 0.3,
                "metadata": {
                    "source": "live_source_of_record",
                    "memory_status": "active",
                },
            },
            {
                "id": "canary-canonical-current",
                "text": "current governance canary value",
                "distance": 0.2,
                "metadata": {
                    "source": "canonical_project_file",
                    "canonical_project_memory": True,
                    "canonical_priority_score": 1.0,
                    "memory_status": "active",
                },
            },
            {
                "id": "canary-explicit-correction",
                "text": "current governance canary value",
                "distance": 0.05,
                "metadata": {
                    "source": "semantic_history",
                    "correction_memory": True,
                    "memory_status": "active",
                },
            },
            {
                "id": "canary-curated-conflict",
                "text": "current governance canary value",
                "distance": 0.01,
                "metadata": {
                    "source": "semantic_history",
                    "quality": "curated",
                    "memory_status": "active",
                },
            },
            {
                "id": "canary-superseded",
                "text": "current governance canary obsolete value",
                "distance": 0.0,
                "metadata": {
                    "source": "canonical_project_file",
                    "canonical_project_memory": True,
                    "memory_status": "superseded",
                },
            },
        ]
        current = _merge_ranked_rows(
            "current governance canary value", [], rows, n_results=10
        )
        historical = _merge_ranked_rows(
            "historical governance canary value", [], rows, n_results=10
        )
        current_ids = [str(row.get("id")) for row in current]
        historical_ids = [str(row.get("id")) for row in historical]
        precedence_verified = (
            current_ids[:4]
            == [
                "canary-live-source",
                "canary-canonical-current",
                "canary-explicit-correction",
                "canary-curated-conflict",
            ]
            and "canary-superseded" not in current_ids
            and "canary-superseded" in historical_ids
        )

        original = {"fact_key": "governance-canary", "memory_status": "active"}
        pending = _supersession_recovery_metadata(original, stage="pending")
        recovered = _supersession_recovery_metadata(pending, stage="active")
        invalid_stage_rejected = False
        try:
            _supersession_recovery_metadata(original, stage="invalid")
        except ValueError:
            invalid_stage_rejected = True
        recovery_verified = (
            original == {"fact_key": "governance-canary", "memory_status": "active"}
            and pending.get("memory_status") == "tombstoned"
            and pending.get("tombstoned") is True
            and pending.get("supersession_pending") is True
            and recovered.get("memory_status") == "active"
            and "tombstoned" not in recovered
            and "supersession_pending" not in recovered
            and invalid_stage_rejected
        )
        return {
            "ok": precedence_verified and recovery_verified,
            "precedenceConflictVerified": precedence_verified,
            "recoveryTransitionVerified": recovery_verified,
            "durableWritesPerformed": False,
        }
    except Exception as exc:
        return {
            "ok": False,
            "precedenceConflictVerified": False,
            "recoveryTransitionVerified": False,
            "durableWritesPerformed": False,
            "error": f"{type(exc).__name__}: {exc}",
        }


def _memory_governance_health() -> Dict[str, Any]:
    try:
        from cortex_server.routers.librarian import (
            _CANONICAL_PROJECT_INDEX,
            _canonical_project_registry_with_diagnostics,
        )

        registry, mapping_errors = _canonical_project_registry_with_diagnostics()
        truncated = len(registry) > _MAX_CANONICAL_MANIFEST_FILES
        bounded_registry = registry[:_MAX_CANONICAL_MANIFEST_FILES]
        index_root = (
            _CANONICAL_PROJECT_INDEX.parents[2]
            if len(_CANONICAL_PROJECT_INDEX.parents) >= 3
            else _CANONICAL_PROJECT_INDEX.parent
        )
        try:
            index_display = str(_CANONICAL_PROJECT_INDEX.relative_to(index_root))
        except ValueError:
            index_display = _CANONICAL_PROJECT_INDEX.name
        manifest = [
            _canonical_manifest_entry(
                path=_CANONICAL_PROJECT_INDEX,
                display_path=index_display,
                authority="canonical_registry",
                containment_root=index_root,
            )
        ]
        manifest.extend(
            _canonical_manifest_entry(
                path=Path(row.get("path")),
                display_path=str(row.get("rel_path") or ""),
                authority="canonical_project_file",
                containment_root=index_root,
            )
            for row in bounded_registry
        )
        missing = [entry["path"] for entry in manifest if not entry["available"]]
        configured = True
        available = configured and not missing and not truncated and not mapping_errors
        manifest_verified = available and all(
            bool(entry.get("verified")) for entry in manifest
        )
        canary = _memory_governance_canary()
        verified = manifest_verified and bool(canary.get("ok"))
        return {
            "ok": verified,
            "configured": configured,
            "available": available,
            "verified": verified,
            "schemaVersion": "cortex.memory.governance.v2",
            "precedence": [
                "live_source_of_record",
                "canonical_project_file",
                "explicit_correction",
                "curated_memory",
                "semantic_history",
            ],
            "canonicalIndex": str(_CANONICAL_PROJECT_INDEX),
            "canonicalMappingCount": len(registry),
            "canonicalMappingErrors": mapping_errors,
            "canonicalMappingParseVerified": not mapping_errors,
            "canonicalManifest": manifest,
            "canonicalManifestTruncated": truncated,
            "canonicalManifestVerified": manifest_verified,
            "missingCanonicalFiles": missing,
            "governanceCanary": canary,
            "supersessionFiltering": bool(canary.get("precedenceConflictVerified")),
            "historicalRecall": bool(canary.get("precedenceConflictVerified")),
            "recoveryTransition": bool(canary.get("recoveryTransitionVerified")),
            "truthBoundary": (
                "Verified binds the configured canonical registry to readable file hashes and "
                "replays production precedence and recovery-state logic in memory. It does not "
                "claim that every fact in those files is semantically current."
            ),
        }
    except Exception as exc:
        return {
            "ok": False,
            "configured": False,
            "available": False,
            "verified": False,
            "error": f"{type(exc).__name__}: {exc}",
        }


def _openclaw_memory_bridge_health() -> Dict[str, Any]:
    config_path = Path("/root/.openclaw/openclaw.json")
    builtin_db = Path("/root/.openclaw/memory/main.sqlite")
    try:
        import json
        import sqlite3
        config = json.loads(config_path.read_text(encoding="utf-8"))
        plugins = config.get("plugins") if isinstance(config.get("plugins"), dict) else {}
        slot = (plugins.get("slots") or {}).get("memory")
        enabled = bool(((plugins.get("entries") or {}).get("cortex-memory-bridge") or {}).get("enabled"))
        builtin_counts = {"files": 0, "chunks": 0}
        if builtin_db.exists():
            with sqlite3.connect(str(builtin_db)) as connection:
                for table in builtin_counts:
                    try:
                        builtin_counts[table] = int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
                    except Exception:
                        pass
        return {
            "ok": slot == "cortex-memory-bridge" and enabled,
            "activeSlot": slot,
            "bridgeEnabled": enabled,
            "builtinShadowIndex": {"path": str(builtin_db), **builtin_counts, "authoritative": False},
            "note": "The empty builtin SQLite index is expected while Cortex owns the memory slot; it is reported to prevent false assumptions.",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _structured_memory_health() -> Dict[str, Any]:
    try:
        import sqlite3
        from cortex_server.routers.l22 import _structured_memory_db_path
        path = _structured_memory_db_path()
        with sqlite3.connect(str(path)) as connection:
            counts = {str(row[0]): int(row[1]) for row in connection.execute("SELECT memory_type, COUNT(*) FROM structured_memory GROUP BY memory_type")}
            latest = connection.execute("SELECT created_at FROM structured_memory ORDER BY created_at DESC LIMIT 1").fetchone()
        return {"ok": path.exists(), "path": str(path), "count": sum(counts.values()), "countsByType": counts, "latestCreatedAt": latest[0] if latest else None}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _runtime_offloaded_memory_health() -> Dict[str, Any]:
    root = Path(os.getenv("ORCHESTRATOR_RUNTIME_DELIVERY_ROOT", "/opt/clawdbot/state/runtime_delivery")) / "memory"
    try:
        from cortex_server.runtime.offloaded_memory import RuntimeMemoryStore

        health = RuntimeMemoryStore(root, delivery_root=root.parent).retention_health()
        return {
            **health,
            "authority": "non_authoritative_runtime_notes",
            "authoritativeRuntimeState": "snapshots_shared_state_and_process_journal",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc), "path": str(root)}


def _legacy_memory_store_health() -> Dict[str, Any]:
    stores = []
    inventory_errors = []
    for path in _LEGACY_MEMORY_STORE_PATHS:
        try:
            try:
                metadata = path.lstat()
                present = True
            except FileNotFoundError:
                metadata = None
                present = False
            stores.append({
                "path": str(path),
                "exists": present,
                "symlink": bool(metadata and stat.S_ISLNK(metadata.st_mode)),
                "regularFile": bool(metadata and stat.S_ISREG(metadata.st_mode)),
                "sizeBytes": (
                    int(metadata.st_size)
                    if metadata and stat.S_ISREG(metadata.st_mode)
                    else None
                ),
                "authoritative": False,
            })
        except Exception as exc:
            inventory_errors.append({
                "path": str(path),
                "error": f"{type(exc).__name__}: {exc}",
            })
    existing = [store["path"] for store in stores if store.get("exists")]
    available = not inventory_errors
    verified = available and not existing
    return {
        "ok": verified,
        "configured": True,
        "available": available,
        "verified": verified,
        "authoritative": False,
        "stores": stores,
        "existingUnverifiedStores": existing,
        "inventoryErrors": inventory_errors,
        "note": (
            "This component verifies only that known orphan store paths are absent. Canonical "
            "L7/L22 availability and behavior are reported by their own components."
        ),
        "truthBoundary": (
            "A present legacy path is degraded until its ownership and migration state are "
            "independently verified; path presence is never treated as proof of delegation."
        ),
    }


def _structural_graph_health() -> Dict[str, Any]:
    try:
        stats = service.graph.stats()
        node_count = int(stats.get("nodeCount", 0) or 0)
        edge_count = int(stats.get("edgeCount", 0) or 0)
        node_types = stats.get("nodeTypes") if isinstance(stats.get("nodeTypes"), dict) else {}
        return {
            "ok": node_count > 0 and edge_count > 0,
            **stats,
            "routeCount": int(node_types.get("Route", 0) or 0),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _latest_index_artifact_health() -> Dict[str, Any]:
    path = _latest_index_artifact()
    if not path:
        return {
            "ok": False,
            "configured": True,
            "available": False,
            "verified": False,
            "artifactPath": None,
            "error": "no codebase index artifact found",
        }
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        error_count = len(data.get("errors", []) or [])
        graph = data.get("graph") if isinstance(data.get("graph"), dict) else {}
        node_count = int(graph.get("nodeCount", 0) or 0)
        edge_count = int(graph.get("edgeCount", 0) or 0)
        artifact_structural_ok = error_count == 0 and node_count > 0 and edge_count > 0

        completed_at = _parse_utc_timestamp(data.get("completedAt"))
        age_seconds = (
            round((_utc_now() - completed_at).total_seconds(), 3)
            if completed_at is not None
            else None
        )
        max_age_seconds = _codebase_index_max_age_seconds()
        freshness_ok = (
            age_seconds is not None
            and -300 <= age_seconds <= max_age_seconds
        )

        expected_source_root = _codebase_source_root()
        serving_source = _git_source_identity(expected_source_root)
        artifact_source_repo = str(data.get("sourceRepo") or "").strip()
        try:
            source_repo_matches = bool(artifact_source_repo) and (
                Path(artifact_source_repo).expanduser().resolve()
                == expected_source_root
            )
        except Exception:
            source_repo_matches = False
        source_commit_matches = bool(data.get("sourceCommit")) and (
            str(data.get("sourceCommit")) == str(serving_source.get("sourceCommit"))
        )
        source_tree_matches = bool(data.get("sourceTreeDigest")) and (
            str(data.get("sourceTreeDigest"))
            == str(serving_source.get("sourceTreeDigest"))
        )
        source_clean_matches = (
            data.get("sourceClean") is True
            and serving_source.get("sourceClean") is True
        )
        snapshot_patterns = data.get("sourceSnapshotExcludePatterns")
        snapshot_contract_valid = (
            isinstance(snapshot_patterns, list)
            and len(snapshot_patterns) <= 128
            and all(
                isinstance(value, str) and len(value.encode("utf-8")) <= 512
                for value in snapshot_patterns
            )
            and isinstance(data.get("sourceSnapshotRecursive"), bool)
        )
        serving_snapshot = None
        source_snapshot_error = None
        if snapshot_contract_valid:
            try:
                serving_snapshot = codebase_source_snapshot(
                    expected_source_root,
                    exclude_patterns=snapshot_patterns,
                    recursive=data["sourceSnapshotRecursive"],
                )
            except Exception as exc:
                source_snapshot_error = f"{type(exc).__name__}: {exc}"
        source_snapshot_matches = (
            snapshot_contract_valid
            and serving_snapshot is not None
            and data.get("sourceSnapshotAlgorithm") == SNAPSHOT_ALGORITHM
            and str(data.get("sourceSnapshotDigest") or "")
            == str(serving_snapshot.get("digest") or "")
            and int(data.get("sourceSnapshotFileCount", -1))
            == int(serving_snapshot.get("fileCount", -2))
            and int(data.get("sourceSnapshotBytes", -1))
            == int(serving_snapshot.get("totalBytes", -2))
        )

        serving_graph_path = _serving_graph_path()
        artifact_graph_path = str(data.get("dbPath") or "").strip()
        try:
            graph_path_matches = (
                serving_graph_path is not None
                and bool(artifact_graph_path)
                and Path(artifact_graph_path).expanduser().resolve()
                == serving_graph_path
            )
        except Exception:
            graph_path_matches = False
        live_graph_digest = None
        graph_digest_error = None
        live_graph_counts = None
        runtime_graph_counts = None
        if serving_graph_path is not None:
            try:
                live_graph_digest = _sha256_file(serving_graph_path)
                live_graph_counts = _serving_graph_database_counts(serving_graph_path)
                runtime_graph_counts = _serving_graph_runtime_counts()
            except Exception as exc:
                graph_digest_error = f"{type(exc).__name__}: {exc}"
        graph_digest_matches = bool(data.get("graphDigest")) and (
            str(data.get("graphDigest")) == str(live_graph_digest)
        )
        graph_digest_algorithm_matches = data.get("graphDigestAlgorithm") == "sha256"
        graph_reset_verified = data.get("graphReset") is True
        graph_counts_match = (
            live_graph_counts is not None
            and int(live_graph_counts.get("nodeCount", 0)) == node_count
            and int(live_graph_counts.get("edgeCount", 0)) == edge_count
            and runtime_graph_counts is not None
            and int(runtime_graph_counts.get("nodeCount", 0)) == node_count
            and int(runtime_graph_counts.get("edgeCount", 0)) == edge_count
            and node_count > 0
            and edge_count > 0
        )
        structural_ok = artifact_structural_ok and graph_counts_match

        schema_matches = data.get("schemaVersion") == _CODEBASE_INDEX_SCHEMA_VERSION
        indexer_matches = data.get("indexerVersion") == _CODEBASE_INDEXER_VERSION
        provenance_complete = all(
            bool(data.get(field))
            for field in (
                "sourceRepo",
                "sourceCommit",
                "sourceTreeDigest",
                "sourceClean",
                "sourceSnapshotAlgorithm",
                "sourceSnapshotDigest",
                "sourceSnapshotExcludePatterns",
                "dbPath",
                "graphDigest",
                "graphDigestAlgorithm",
                "indexerVersion",
                "completedAt",
            )
        )
        source_matches = (
            source_repo_matches
            and source_commit_matches
            and source_tree_matches
            and source_clean_matches
            and source_snapshot_matches
        )
        graph_matches = (
            graph_path_matches
            and graph_digest_algorithm_matches
            and graph_digest_matches
            and graph_counts_match
        )
        verified = all((
            structural_ok,
            freshness_ok,
            schema_matches,
            indexer_matches,
            provenance_complete,
            source_matches,
            graph_matches,
            graph_reset_verified,
        ))
        verification_failures = []
        for condition, reason in (
            (structural_ok, "structural_index_invalid"),
            (freshness_ok, "freshness_sla_failed"),
            (schema_matches, "artifact_schema_mismatch"),
            (indexer_matches, "indexer_version_mismatch"),
            (provenance_complete, "provenance_incomplete"),
            (source_matches, "serving_source_mismatch"),
            (source_snapshot_matches, "source_snapshot_mismatch"),
            (graph_matches, "serving_graph_mismatch"),
            (graph_reset_verified, "graph_reset_unverified"),
        ):
            if not condition:
                verification_failures.append(reason)
        return {
            "ok": verified,
            "configured": True,
            "available": True,
            "verified": verified,
            "status": "verified" if verified else "degraded",
            "artifactPath": str(path),
            "modifiedAt": _iso_from_mtime(path),
            "artifactMtimeAgeSeconds": _age_seconds(path),
            "completedAt": data.get("completedAt"),
            "ageSeconds": age_seconds,
            "maxAgeSeconds": max_age_seconds,
            "freshnessVerified": freshness_ok,
            "sourceRepo": artifact_source_repo or None,
            "sourceCommit": data.get("sourceCommit"),
            "sourceTreeDigest": data.get("sourceTreeDigest"),
            "sourceClean": data.get("sourceClean"),
            "sourceSnapshotDigest": data.get("sourceSnapshotDigest"),
            "sourceSnapshotFileCount": data.get("sourceSnapshotFileCount"),
            "sourceSnapshotBytes": data.get("sourceSnapshotBytes"),
            "indexerVersion": data.get("indexerVersion"),
            "schemaVersion": data.get("schemaVersion"),
            "filesParsed": data.get("files_parsed"),
            "filesSkipped": data.get("files_skipped"),
            "nodesAdded": data.get("nodes_added"),
            "edgesAdded": data.get("edges_added"),
            "elapsedSeconds": data.get("elapsedSeconds"),
            "errorCount": error_count,
            "graph": graph,
            "sourceProvenance": {
                "expectedRepo": str(expected_source_root),
                "servingCommit": serving_source.get("sourceCommit"),
                "servingTreeDigest": serving_source.get("sourceTreeDigest"),
                "repoMatches": source_repo_matches,
                "commitMatches": source_commit_matches,
                "treeDigestMatches": source_tree_matches,
                "cleanWorktreeMatches": source_clean_matches,
                "artifactSnapshotDigest": data.get("sourceSnapshotDigest"),
                "servingSnapshotDigest": (
                    serving_snapshot.get("digest") if serving_snapshot else None
                ),
                "snapshotDigestMatches": source_snapshot_matches,
                "snapshotAlgorithm": data.get("sourceSnapshotAlgorithm"),
                "snapshotFileCount": (
                    serving_snapshot.get("fileCount") if serving_snapshot else None
                ),
                "verified": source_matches,
                "error": serving_source.get("error") or source_snapshot_error,
            },
            "graphProvenance": {
                "artifactDbPath": artifact_graph_path or None,
                "servingDbPath": str(serving_graph_path) if serving_graph_path else None,
                "artifactGraphDigest": data.get("graphDigest"),
                "digestAlgorithm": data.get("graphDigestAlgorithm"),
                "servingGraphDigest": live_graph_digest,
                "pathMatches": graph_path_matches,
                "digestAlgorithmMatches": graph_digest_algorithm_matches,
                "digestMatches": graph_digest_matches,
                "artifactNodeCount": node_count,
                "artifactEdgeCount": edge_count,
                "servingNodeCount": (
                    live_graph_counts.get("nodeCount") if live_graph_counts else None
                ),
                "servingEdgeCount": (
                    live_graph_counts.get("edgeCount") if live_graph_counts else None
                ),
                "runtimeNodeCount": (
                    runtime_graph_counts.get("nodeCount")
                    if runtime_graph_counts else None
                ),
                "runtimeEdgeCount": (
                    runtime_graph_counts.get("edgeCount")
                    if runtime_graph_counts else None
                ),
                "countsMatch": graph_counts_match,
                "verified": graph_matches,
                "resetVerified": graph_reset_verified,
                "error": graph_digest_error,
            },
            "verificationFailures": verification_failures,
            "truthBoundary": (
                "The last-known-good graph remains readable when this component degrades. "
                "Verified requires artifact freshness plus exact Git, parser-candidate snapshot, "
                "and serving graph identity."
            ),
        }
    except Exception as exc:
        return {
            "ok": False,
            "configured": True,
            "available": True,
            "verified": False,
            "artifactPath": str(path),
            "error": f"{type(exc).__name__}: {exc}",
        }


def _parser_smoke_health() -> Dict[str, Any]:
    sample = """
import express from 'express';
export function registerHealthRoutes(router) {
  router.register('GET', '/health/smoke', async () => ({ ok: true }));
}
"""
    temp_path = ""
    try:
        from cortex_server.parsers.js_parser import JSParser

        with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as f:
            f.write(sample)
            temp_path = f.name
        result = JSParser().parse_file(temp_path)
        node_types = [node.get("type") for node in result.nodes]
        edge_types = [edge.get("type") for edge in result.edges]
        return {
            "ok": result.ok and "Module" in node_types and "Function" in node_types and "Route" in node_types,
            "resultOk": result.ok,
            "nodeCount": len(result.nodes),
            "edgeCount": len(result.edges),
            "nodeTypes": sorted(set(node_types)),
            "edgeTypes": sorted(set(edge_types)),
            "errors": [getattr(error, "message", str(error)) for error in result.errors[:5]],
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except Exception:
                pass


def _memory_health_payload() -> Dict[str, Any]:
    components = {
        "semanticMemory": _semantic_memory_health(),
        "codec": _codec_health(),
        "durableFileMemory": _durable_file_memory_health(),
        "memoryGovernance": _memory_governance_health(),
        "openClawMemoryBridge": _openclaw_memory_bridge_health(),
        "structuredL22Memory": _structured_memory_health(),
        "runtimeOffloadedMemory": _runtime_offloaded_memory_health(),
        "legacyMemoryStores": _legacy_memory_store_health(),
        "structuralCodeGraph": _structural_graph_health(),
        "latestCodebaseIndexArtifact": _latest_index_artifact_health(),
        "parserSmoke": _parser_smoke_health(),
    }
    ok = all(bool(component.get("ok")) for component in components.values())
    verified = all(
        bool(component.get("verified", component.get("ok")))
        for component in components.values()
    )
    return {
        "success": ok and verified,
        "ok": ok and verified,
        "verified": verified,
        "status": "verified" if ok and verified else "degraded",
        "generatedAt": _utc_now().isoformat(),
        "components": components,
        "sourceOfTruth": "control_plane_cortex",
        "mirrorPolicy": "Hetzner may mirror this graph/artifacts for execution-plane reads, but control-plane Cortex is authoritative.",
        "truthBoundary": (
            "Component ok/verified fields cover only their stated verification scopes. "
            "Configuration or path presence alone never certifies canonical authority."
        ),
    }


@router.get("/status")
async def knowledge_status(http_request: Request = None):
    """L22 Mnemosyne status endpoint (canonical)."""
    try:
        principal = (
            memory_principal_for_request(http_request)
            if http_request is not None
            else _authenticated_memory_principal_scope(
                DEFAULT_TENANT_ID,
                DEFAULT_WORKSPACE_ID,
                None,
            )
        )
        memory_count = _principal_semantic_memory_count(principal)

        available = memory_count is not None
        return {
            "success": available,
            "level": 22,
            "name": "Mnemosyne",
            "status": "active" if available else "unavailable",
            "capabilities": [
                "knowledge_graph",
                "semantic_search",
                "memory_persistence",
            ],
            "memory_count": memory_count,
            "principal_scoped": True,
            "aggregate_details": "withheld",
            "canonical_endpoint": "/knowledge/status",
        }
    except Exception as e:
        return {
            "success": False,
            "level": 22,
            "name": "Mnemosyne",
            "status": "degraded",
            "error": str(e),
        }


@router.get("/memory-health")
async def memory_health(http_request: Request = None):
    """Principal-local compatibility health; aggregate diagnostics are withheld."""
    principal = (
        memory_principal_for_request(http_request)
        if http_request is not None
        else _authenticated_memory_principal_scope(
            DEFAULT_TENANT_ID,
            DEFAULT_WORKSPACE_ID,
            None,
        )
    )
    return _principal_memory_health_payload(principal)


@router.post("/search")
async def search_knowledge(
    request: KnowledgeSearchRequest,
    http_request: Request = None,
):
    """Compatibility semantic search endpoint used by OpenClaw config.

    Uses Librarian's resilient recall path so memory_search remains available even
    when embedding providers are temporarily degraded.
    """
    try:
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")

        principal = _route_principal(request, http_request)
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
            "available": bool(result.get("available", True)),
            "warning": result.get("warning"),
        }
    except HTTPException:
        raise
    except Exception as e:
        return {
            "query": request.query,
            "results": [],
            "search_mode": "error",
            "degraded": True,
            "available": False,
            "error": str(e),
        }


@router.post(
    "/prior-art-gate",
    openapi_extra={
        "x-cortex-read-policy": "principal_semantic_read",
        "x-cortex-principal-scope-required": True,
    },
)
async def prior_art_gate(
    request: PriorArtGateRequest,
    http_request: Request = None,
):
    """Pre-implementation recall gate for existing capabilities.

    Use this before building a new product/control-plane primitive. It searches
    durable memory plus the structural code graph and requires a reuse/extend/
    adapter decision when high-confidence prior art exists.
    """
    principal = _route_principal(request, http_request)
    tenant, workspace = principal.tenant_id, principal.storage_workspace_id

    try:
        terms = extract_prior_art_terms(
            objective=request.objective,
            planned_capabilities=request.planned_capabilities,
            planned_paths=request.planned_paths,
        )
        memory_rows: List[Dict[str, Any]] = []
        memory_query_succeeded = False
        memory_query_failed = False
        for query in [*request.planned_capabilities, *terms[:6]]:
            if not str(query or "").strip():
                continue
            try:
                result = robust_search(
                    query=str(query),
                    n_results=max(1, min(int(request.n_results or 5), 10)),
                    allow_fallback=True,
                    tenant_id=tenant,
                    workspace_id=workspace,
                    memory_principal_key=principal.memory_principal_key,
                )
                if result.get("available") is not True:
                    memory_query_failed = True
                else:
                    memory_query_succeeded = True
                    memory_rows.extend(result.get("results", []) or [])
            except Exception:
                memory_query_failed = True
        memory_available = memory_query_succeeded and not memory_query_failed

        structural_rows: List[Dict[str, Any]] = []
        structural_query_succeeded = False
        structural_query_failed = False
        seen_nodes = set()
        for term in terms[:8]:
            try:
                for node in service.graph.query(
                    name_pattern=term,
                    limit=max(1, min(int(request.n_results or 5), 10)),
                    tenant_id=tenant,
                    storage_workspace_id=workspace,
                ):
                    node_dict = _node_to_dict(node)
                    node_id = node_dict.get("id") if isinstance(node_dict, dict) else None
                    if node_id and node_id in seen_nodes:
                        continue
                    if node_id:
                        seen_nodes.add(node_id)
                    structural_rows.append({"node": node_dict})
                structural_query_succeeded = True
            except Exception:
                structural_query_failed = True
        structural_available = structural_query_succeeded and not structural_query_failed

        gate = build_prior_art_gate(
            objective=request.objective,
            planned_capabilities=request.planned_capabilities,
            planned_paths=request.planned_paths,
            proposed_action=request.proposed_action,
            memory_results=memory_rows,
            structural_results=structural_rows,
            memory_available=memory_available,
            structural_available=structural_available,
        )
        return {"success": gate.get("ok", False), **gate}
    except Exception as e:
        return {
            "success": False,
            "schemaVersion": "cortex.memory.prior_art_gate.v1",
            "ok": False,
            "status": "error",
            "objective": request.objective,
            "error": str(e),
        }


@router.post("/query")
async def query_graph(
    request: BoundedGraphQueryRequest,
    http_request: Request = None,
):
    """Query the knowledge graph."""
    try:
        principal = _route_principal(request, http_request)
        result = await service.query(
            request,
            tenant_id=principal.tenant_id,
            storage_workspace_id=principal.storage_workspace_id,
        )
        return {"success": True, "data": result, "error": None}
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.get("/graph/stats")
async def graph_stats(http_request: Request):
    """Return structural graph cardinality and type breakdowns."""
    try:
        principal = memory_principal_for_request(http_request)
        nodes = _principal_graph_nodes(principal, limit=1000)
        edges = [
            edge for edge in service.graph.storage.query_edges(limit=1000)
            if str(getattr(edge, "tenant_id", "") or "") == principal.tenant_id
            and str(getattr(edge, "storage_workspace_id", "") or "")
            == principal.storage_workspace_id
        ]
        node_types: Dict[str, int] = {}
        edge_types: Dict[str, int] = {}
        for node in nodes:
            key = str(getattr(node.type, "value", node.type))
            node_types[key] = node_types.get(key, 0) + 1
        for edge in edges:
            key = str(getattr(edge.type, "value", edge.type))
            edge_types[key] = edge_types.get(key, 0) + 1
        return {"success": True, "data": {
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
            "nodeTypes": node_types,
            "edgeTypes": edge_types,
            "namespace": "authenticated_principal",
        }, "error": None}
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.post("/structural/search")
async def structural_search(
    request: StructuralSearchRequest,
    http_request: Request = None,
):
    """Search the Cortex structural code graph.

    This is deliberately separate from semantic memory search. Use it for
    codebase-memory style questions: symbols, files/modules, imports, classes,
    functions, routes, and nearby dependency edges.
    """
    try:
        principal = _route_principal(request, http_request)
        node_type = None
        if request.node_type:
            try:
                node_type = NodeType(request.node_type)
            except ValueError:
                raise HTTPException(status_code=422, detail="invalid node_type")
        nodes = service.graph.query(
            node_type=node_type,
            name_pattern=request.query or None,
            limit=request.limit,
            tenant_id=principal.tenant_id,
            storage_workspace_id=principal.storage_workspace_id,
        )
        results = []
        for node in nodes:
            item = {"node": _node_to_dict(node)}
            if request.include_neighbors:
                item["neighbors"] = [
                    _neighbor_to_dict(n)
                    for n in service.graph.get_neighbors(
                        node.id,
                        direction="both",
                        limit=25,
                        tenant_id=principal.tenant_id,
                        storage_workspace_id=principal.storage_workspace_id,
                    )
                ]
            results.append(item)
        return {"success": True, "query": request.query, "results": results, "count": len(results)}
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "query": request.query, "results": [], "count": 0, "error": str(e)}


@router.post("/structural/impact")
async def structural_impact(
    request: ImpactRequest,
    http_request: Request = None,
):
    """Return dependency/call/import neighborhood for a node or symbol query."""
    try:
        principal = _route_principal(request, http_request)
        nodes = []
        if request.node_id:
            node = service.graph.get_node(
                service._scoped_id(
                    request.node_id,
                    principal.tenant_id,
                    principal.storage_workspace_id,
                ),
                tenant_id=principal.tenant_id,
                storage_workspace_id=principal.storage_workspace_id,
            )
            if node:
                nodes = [node]
        elif request.query:
            nodes = service.graph.query(
                name_pattern=request.query,
                limit=request.limit,
                tenant_id=principal.tenant_id,
                storage_workspace_id=principal.storage_workspace_id,
            )
        else:
            raise HTTPException(status_code=400, detail="node_id or query is required")

        edge_type = None
        if request.edge_type:
            try:
                edge_type = EdgeType(request.edge_type)
            except ValueError:
                raise HTTPException(status_code=422, detail="invalid edge_type")

        impacts = []
        for node in nodes[: max(1, min(50, request.limit or 10))]:
            if request.direction not in {"out", "in", "both"}:
                raise HTTPException(status_code=422, detail="invalid direction")
            neighbors = service.graph.get_neighbors(
                node.id,
                edge_type=edge_type,
                direction=request.direction,
                limit=request.limit,
                tenant_id=principal.tenant_id,
                storage_workspace_id=principal.storage_workspace_id,
            )
            impacts.append({
                "node": _node_to_dict(node),
                "neighbors": [_neighbor_to_dict(n) for n in neighbors[:100]],
                "neighborCount": len(neighbors),
            })
        return {"success": True, "query": request.query, "node_id": request.node_id, "impacts": impacts, "count": len(impacts)}
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "query": request.query, "node_id": request.node_id, "impacts": [], "count": 0, "error": str(e)}


@router.post("/nodes")
async def create_node(
    request: BoundedGraphNodeCreateRequest,
    http_request: Request = None,
):
    """Create a new node in the graph."""
    try:
        principal = _route_principal(request, http_request)
        result = await service.create_node(
            request,
            tenant_id=principal.tenant_id,
            storage_workspace_id=principal.storage_workspace_id,
        )
        return {"success": True, "data": result, "error": None}
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.get("/nodes/{node_id}")
async def get_node(node_id: str, http_request: Request):
    """Get a node by ID."""
    try:
        principal = memory_principal_for_request(http_request)
        scoped_node_id = service._scoped_id(
            node_id,
            principal.tenant_id,
            principal.storage_workspace_id,
        )
        node = service.graph.get_node(
            scoped_node_id,
            tenant_id=principal.tenant_id,
            storage_workspace_id=principal.storage_workspace_id,
        )
        if node is not None:
            return {"success": True, "data": _node_to_dict(node), "error": None}
        raise HTTPException(status_code=404, detail="Node not found")
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.post("/edges")
async def create_edge(
    request: BoundedGraphEdgeCreateRequest,
    http_request: Request = None,
):
    """Create a new edge in the graph."""
    try:
        principal = _route_principal(request, http_request)
        result = await service.create_edge(
            request,
            tenant_id=principal.tenant_id,
            storage_workspace_id=principal.storage_workspace_id,
        )
        return {"success": True, "data": result, "error": None}
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.get("/nodes/{node_id}/neighbors")
async def get_neighbors(
    node_id: str,
    http_request: Request,
    edge_type: str = None,
    direction: str = "out",
    limit: int = Query(100, ge=1, le=100),
):
    """Get neighbors of a node."""
    try:
        principal = memory_principal_for_request(http_request)
        scoped_node_id = service._scoped_id(
            node_id,
            principal.tenant_id,
            principal.storage_workspace_id,
        )
        node = service.graph.get_node(
            scoped_node_id,
            tenant_id=principal.tenant_id,
            storage_workspace_id=principal.storage_workspace_id,
        )
        if node is None:
            raise HTTPException(status_code=404, detail="Node not found")
        resolved_edge_type = None
        if edge_type:
            try:
                resolved_edge_type = EdgeType(edge_type)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail="invalid edge_type") from exc
        rows = _principal_graph_neighbors(
            principal,
            scoped_node_id,
            edge_type=resolved_edge_type,
            direction=direction,
            limit=limit,
        )
        return {"success": True, "data": {
            "node_id": scoped_node_id,
            "neighbors": [_neighbor_to_dict(row) for row in rows],
            "count": len(rows),
        }}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        return {"success": False, "error": str(e)}
