"""
Knowledge Graph Router - API endpoints for graph operations.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from typing import Annotated, Optional, List, Dict, Any
from datetime import datetime, timezone
from pathlib import Path
import json
import os
import tempfile
from cortex_server.models.requests import (
    GraphQueryRequest, GraphNodeCreateRequest, GraphEdgeCreateRequest,
    GraphQueryResponse, GraphNodeResponse, GraphEdgeResponse
)
from cortex_server.services.knowledge_service import KnowledgeService
from cortex_server.routers.librarian import (
    DEFAULT_TENANT_ID,
    DEFAULT_WORKSPACE_ID,
    MemoryScopeId,
    _authenticated_memory_scope,
    collection,
    robust_search,
)
from cortex_server.knowledge.graph import NodeType, EdgeType
from cortex_server.modules.prior_art_gate import build_prior_art_gate, extract_prior_art_terms

router = APIRouter()
service = KnowledgeService()

_DEFAULT_DURABLE_MEMORY_ROOTS = [Path("/root/clawd/memory")]
_DEFAULT_CODEBASE_INDEX_ROOT = Path("/root/clawd/artifacts/cortex-codebase-memory")

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

    _bounded_metadata = field_validator("metadata")(_validate_graph_metadata)


class BoundedGraphEdgeCreateRequest(GraphEdgeCreateRequest):
    id: Optional[str] = Field(default=None, max_length=MAX_GRAPH_STRING_LENGTH)
    type: str = Field(max_length=MAX_GRAPH_TYPE_LENGTH)
    source_id: str = Field(max_length=MAX_GRAPH_STRING_LENGTH)
    target_id: str = Field(max_length=MAX_GRAPH_STRING_LENGTH)
    context: Optional[str] = Field(default=None, max_length=MAX_GRAPH_STRING_LENGTH)

    _bounded_metadata = field_validator("metadata")(_validate_graph_metadata)


class KnowledgeSearchRequest(BaseModel):
    query: str = Field(..., max_length=16_384)
    n_results: int = Field(5, ge=1, le=100)
    tenant_id: MemoryScopeId = DEFAULT_TENANT_ID
    workspace_id: MemoryScopeId = DEFAULT_WORKSPACE_ID
    scope_signature: Optional[str] = Field(None, max_length=256)


class BoundedGraphQueryRequest(GraphQueryRequest):
    query: str = Field(..., max_length=16_384)
    limit: int = Field(100, ge=1, le=100)


class StructuralSearchRequest(BaseModel):
    query: BoundedKnowledgeText = ""
    node_type: Optional[str] = None
    limit: int = Field(25, ge=1, le=100)
    include_neighbors: bool = False


class PriorArtGateRequest(BaseModel):
    objective: str = Field(..., max_length=32_768)
    planned_capabilities: List[BoundedKnowledgeText] = Field(default_factory=list, max_items=100)
    planned_paths: List[BoundedKnowledgeText] = Field(default_factory=list, max_items=100)
    proposed_action: str = Field("unspecified", max_length=64)
    n_results: int = Field(5, ge=1, le=20)


class ImpactRequest(BaseModel):
    query: Optional[BoundedKnowledgeText] = None
    node_id: Optional[BoundedKnowledgeText] = None
    edge_type: Optional[str] = None
    direction: str = "both"
    limit: int = Field(10, ge=1, le=50)


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
    for root in _DEFAULT_DURABLE_MEMORY_ROOTS:
        exists = root.exists()
        roots.append({"path": str(root), "exists": exists})
        if not exists:
            continue
        try:
            for path in root.rglob("*"):
                if not path.is_file() or path.suffix.lower() not in {".md", ".txt"}:
                    continue
                if any(part in {".git", "node_modules", "__pycache__"} for part in path.parts):
                    continue
                file_count += 1
                if "projects" in path.parts:
                    project_file_count += 1
                try:
                    mtime = path.stat().st_mtime
                    if mtime > latest_mtime:
                        latest_mtime = mtime
                        latest_path = path
                except Exception:
                    pass
        except Exception:
            continue
    return {
        "ok": file_count > 0,
        "roots": roots,
        "fileCount": file_count,
        "projectFileCount": project_file_count,
        "latestPath": str(latest_path) if latest_path else None,
        "latestModifiedAt": _iso_from_mtime(latest_path) if latest_path else "",
    }


def _memory_governance_health() -> Dict[str, Any]:
    try:
        from cortex_server.routers.librarian import _canonical_project_registry
        registry = _canonical_project_registry()
        missing = [str(row.get("path")) for row in registry if not Path(row.get("path")).exists()]
        return {
            "ok": bool(registry) and not missing,
            "schemaVersion": "cortex.memory.governance.v1",
            "precedence": ["live_source_of_record", "canonical_project_file", "explicit_correction", "curated_memory", "semantic_history"],
            "canonicalIndex": "/root/clawd/memory/projects/INDEX.md",
            "canonicalMappingCount": len(registry),
            "missingCanonicalFiles": missing,
            "supersessionFiltering": True,
            "historicalRecall": True,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


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
        files = [path for path in root.rglob("*") if path.is_file()] if root.exists() else []
        return {
            "ok": root.exists(),
            "path": str(root),
            "fileCount": len(files),
            "authority": "non_authoritative_runtime_notes",
            "authoritativeRuntimeState": "snapshots_shared_state_and_process_journal",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc), "path": str(root)}


def _legacy_memory_store_health() -> Dict[str, Any]:
    paths = [Path("/app/cortex_server/knowledge/auto_memory.jsonl"), Path("/app/cortex_server/chroma_db/librarian_fallback.jsonl"), Path("/root/cortex_server/chroma_db")]
    stores = [{"path": str(path), "exists": path.exists(), "sizeBytes": path.stat().st_size if path.is_file() else None} for path in paths]
    return {
        "ok": True,
        "authoritative": False,
        "stores": stores,
        "note": "Legacy L7/Mnemosyne facades now delegate to canonical L7/L22 stores; absent orphan paths are expected.",
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
        return {"ok": False, "artifactPath": None, "error": "no codebase index artifact found"}
    try:
        import json

        data = json.loads(path.read_text(encoding="utf-8"))
        error_count = len(data.get("errors", []) or [])
        graph = data.get("graph") if isinstance(data.get("graph"), dict) else {}
        return {
            "ok": error_count == 0 and int(graph.get("nodeCount", 0) or 0) > 0,
            "artifactPath": str(path),
            "modifiedAt": _iso_from_mtime(path),
            "ageSeconds": _age_seconds(path),
            "sourceRepo": data.get("sourceRepo"),
            "filesParsed": data.get("files_parsed"),
            "filesSkipped": data.get("files_skipped"),
            "nodesAdded": data.get("nodes_added"),
            "edgesAdded": data.get("edges_added"),
            "elapsedSeconds": data.get("elapsedSeconds"),
            "errorCount": error_count,
            "graph": graph,
        }
    except Exception as exc:
        return {"ok": False, "artifactPath": str(path), "error": str(exc)}


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
    return {
        "success": ok,
        "ok": ok,
        "generatedAt": _utc_now().isoformat(),
        "components": components,
        "sourceOfTruth": "control_plane_cortex",
        "mirrorPolicy": "Hetzner may mirror this graph/artifacts for execution-plane reads, but control-plane Cortex is authoritative.",
    }


@router.get("/status")
async def knowledge_status():
    """L22 Mnemosyne status endpoint (canonical)."""
    try:
        memory_count = None
        try:
            memory_count = int(collection.count())
        except Exception:
            memory_count = None

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
async def memory_health():
    """Comprehensive memory health gate.

    This deliberately separates semantic memory, Codec, durable file memory,
    and structural codebase memory so a green generic "memory" status cannot
    hide an empty or stale code graph again.
    """
    return _memory_health_payload()


@router.post("/search")
async def search_knowledge(request: KnowledgeSearchRequest):
    """Compatibility semantic search endpoint used by OpenClaw config.

    Uses Librarian's resilient recall path so memory_search remains available even
    when embedding providers are temporarily degraded.
    """
    try:
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")

        tenant, workspace = _authenticated_memory_scope(
            request.tenant_id,
            request.workspace_id,
            request.scope_signature,
        )

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


@router.post("/prior-art-gate")
async def prior_art_gate(request: PriorArtGateRequest):
    """Pre-implementation recall gate for existing capabilities.

    Use this before building a new product/control-plane primitive. It searches
    durable memory plus the structural code graph and requires a reuse/extend/
    adapter decision when high-confidence prior art exists.
    """
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
                for node in service.graph.query(name_pattern=term, limit=max(1, min(int(request.n_results or 5), 10))):
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
async def query_graph(request: BoundedGraphQueryRequest):
    """Query the knowledge graph."""
    try:
        result = await service.query(request)
        return {"success": True, "data": result, "error": None}
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.get("/graph/stats")
async def graph_stats():
    """Return structural graph cardinality and type breakdowns."""
    try:
        return {"success": True, "data": service.graph.stats(), "error": None}
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.post("/structural/search")
async def structural_search(request: StructuralSearchRequest):
    """Search the Cortex structural code graph.

    This is deliberately separate from semantic memory search. Use it for
    codebase-memory style questions: symbols, files/modules, imports, classes,
    functions, routes, and nearby dependency edges.
    """
    try:
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
        )
        results = []
        for node in nodes:
            item = {"node": _node_to_dict(node)}
            if request.include_neighbors:
                item["neighbors"] = [
                    _neighbor_to_dict(n)
                    for n in service.graph.get_neighbors(node.id, direction="both", limit=25)
                ]
            results.append(item)
        return {"success": True, "query": request.query, "results": results, "count": len(results)}
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "query": request.query, "results": [], "count": 0, "error": str(e)}


@router.post("/structural/impact")
async def structural_impact(request: ImpactRequest):
    """Return dependency/call/import neighborhood for a node or symbol query."""
    try:
        nodes = []
        if request.node_id:
            node = service.graph.get_node(request.node_id)
            if node:
                nodes = [node]
        elif request.query:
            nodes = service.graph.query(name_pattern=request.query, limit=request.limit)
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
            neighbors = service.graph.get_neighbors(node.id, edge_type=edge_type, direction=request.direction, limit=request.limit)
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
async def create_node(request: BoundedGraphNodeCreateRequest):
    """Create a new node in the graph."""
    try:
        result = await service.create_node(request)
        return {"success": True, "data": result, "error": None}
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.get("/nodes/{node_id}")
async def get_node(node_id: str):
    """Get a node by ID."""
    try:
        result = await service.get_node(node_id)
        if result:
            return {"success": True, "data": result, "error": None}
        raise HTTPException(status_code=404, detail="Node not found")
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.post("/edges")
async def create_edge(request: BoundedGraphEdgeCreateRequest):
    """Create a new edge in the graph."""
    try:
        result = await service.create_edge(request)
        return {"success": True, "data": result, "error": None}
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.get("/nodes/{node_id}/neighbors")
async def get_neighbors(
    node_id: str,
    edge_type: str = None,
    direction: str = "out",
    limit: int = Query(100, ge=1, le=100),
):
    """Get neighbors of a node."""
    try:
        result = await service.get_neighbors(node_id, edge_type, direction, limit)
        return {"success": True, "data": result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        return {"success": False, "error": str(e)}
