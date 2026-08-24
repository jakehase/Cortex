"""
Knowledge Graph Router - API endpoints for graph operations.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from pathlib import Path
import os
import tempfile
from cortex_server.models.requests import (
    GraphQueryRequest, GraphNodeCreateRequest, GraphEdgeCreateRequest,
    GraphQueryResponse, GraphNodeResponse, GraphEdgeResponse
)
from cortex_server.services.knowledge_service import KnowledgeService
from cortex_server.routers.librarian import collection, robust_search
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


class KnowledgeSearchRequest(BaseModel):
    query: str
    n_results: int = 5


class StructuralSearchRequest(BaseModel):
    query: str = ""
    node_type: Optional[str] = None
    limit: int = 25
    include_neighbors: bool = False


class PriorArtGateRequest(BaseModel):
    objective: str
    planned_capabilities: List[str] = []
    planned_paths: List[str] = []
    proposed_action: str = "unspecified"
    n_results: int = 5


class ImpactRequest(BaseModel):
    query: Optional[str] = None
    node_id: Optional[str] = None
    edge_type: Optional[str] = None
    direction: str = "both"
    limit: int = 10


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
    candidates = service.graph.query(
        node_type=node_type,
        name_pattern=name_pattern,
        limit=1000,
    )
    return [
        node for node in candidates
        if _graph_metadata_matches(getattr(node, "metadata", None), principal)
    ][:requested]


def _principal_graph_neighbors(
    principal: AuthenticatedMemoryPrincipal,
    node_id: str,
    *,
    edge_type: Optional[EdgeType] = None,
    direction: str = "out",
) -> List[Dict[str, Any]]:
    rows = service.graph.get_neighbors(node_id, edge_type=edge_type, direction=direction)
    return [
        row for row in rows
        if _graph_metadata_matches(getattr(row.get("edge"), "metadata", None), principal)
        and _graph_metadata_matches(getattr(row.get("node"), "metadata", None), principal)
    ]


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


def _semantic_retention_canary_health() -> Dict[str, Any]:
    """Verify retrieval of a pre-written completion-survival canary.

    This probe is deliberately read-only. A canary writer must store a record
    with the contract fields below through the real capture/promotion path; this
    health endpoint must not manufacture evidence of its own health.
    """

    contract = {
        "memory_health_canary": True,
        "memory_health_canary_kind": "completion_survival",
        "requiredMetadata": ["memory_health_canary_query", "memory_health_canary_token"],
    }
    try:
        data = collection.get(
            where={"memory_health_canary": True},
            limit=8,
            include=["documents", "metadatas"],
        )
    except Exception as exc:
        return {
            "configured": False,
            "verified": False,
            "status": "probe_error",
            "contract": contract,
            "error": str(exc),
        }

    ids = data.get("ids") or []
    documents = data.get("documents") or []
    metadatas = data.get("metadatas") or []
    candidates = []
    for index, record_id in enumerate(ids):
        metadata = metadatas[index] if index < len(metadatas) and isinstance(metadatas[index], dict) else {}
        if str(metadata.get("memory_status") or "active").lower() != "active":
            continue
        if str(metadata.get("memory_health_canary_kind") or "") != "completion_survival":
            continue
        candidates.append({
            "id": str(record_id),
            "document": str(documents[index] if index < len(documents) else ""),
            "metadata": metadata,
        })
    if not candidates:
        return {
            "configured": False,
            "verified": False,
            "status": "not_configured",
            "contract": contract,
            "reason": "no active completion-survival canary is present",
        }

    candidates.sort(key=lambda row: str(row["metadata"].get("recorded_at") or ""), reverse=True)
    canary = candidates[0]
    metadata = canary["metadata"]
    query = str(metadata.get("memory_health_canary_query") or "").strip()
    token = str(metadata.get("memory_health_canary_token") or "").strip()
    canary_id = str(metadata.get("memory_health_canary_id") or canary["id"])
    if not query or not token or token not in canary["document"]:
        return {
            "configured": True,
            "verified": False,
            "status": "invalid_contract",
            "contract": contract,
            "canaryId": canary_id,
            "recordedAt": metadata.get("recorded_at"),
            "reason": "canary query/token metadata is missing or the token is absent from the stored document",
        }

    try:
        result = robust_search(query, n_results=5, allow_fallback=False)
    except Exception as exc:
        return {
            "configured": True,
            "verified": False,
            "status": "search_error",
            "contract": contract,
            "canaryId": canary_id,
            "recordedAt": metadata.get("recorded_at"),
            "error": str(exc),
        }

    search_mode = str(result.get("search_mode") or "unknown")
    degraded = bool(result.get("degraded", False))
    warning = result.get("warning")
    semantic_path = search_mode in {"semantic", "semantic_hybrid"} and not degraded and not warning
    matched_id = None
    for row in result.get("results", []) or []:
        row_metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        row_canary_id = str(row_metadata.get("memory_health_canary_id") or row.get("id") or "")
        if row_canary_id == canary_id and token in str(row.get("text") or ""):
            matched_id = str(row.get("id") or row_canary_id)
            break
    verified = bool(semantic_path and matched_id)
    return {
        "configured": True,
        "verified": verified,
        "status": "passed" if verified else "failed",
        "contract": contract,
        "canaryId": canary_id,
        "recordedAt": metadata.get("recorded_at"),
        "searchMode": search_mode,
        "semanticPath": semantic_path,
        "degraded": degraded,
        "warning": warning,
        "matchedId": matched_id,
        "resultCount": len(result.get("results", []) or []),
    }


def _semantic_memory_health() -> Dict[str, Any]:
    count = None
    search_mode = "unknown"
    degraded = None
    warning = None
    result_count = None
    try:
        count = int(collection.count())
    except Exception as exc:
        return {
            "ok": False,
            "status": "unavailable",
            "availabilityOk": False,
            "retentionVerified": False,
            "retentionStatus": "not_tested",
            "count": None,
            "error": str(exc),
        }
    try:
        result = robust_search("Cortex memory health", n_results=1, allow_fallback=True)
        search_mode = result.get("search_mode", "semantic")
        degraded = bool(result.get("degraded", False))
        warning = result.get("warning")
        result_count = len(result.get("results", []) or [])
        # This generic query is an availability probe, not a relevance canary.
        # Low-signal warnings remain visible below, while the dedicated
        # completion-survival probe is the fail-closed semantic quality gate.
        search_ok = search_mode != "error" and result_count > 0
    except Exception as exc:
        return {
            "ok": False,
            "availabilityOk": False,
            "retentionVerified": False,
            "retentionStatus": "not_tested",
            "count": count,
            "searchMode": "error",
            "error": str(exc),
        }
    lifecycle = {"active": 0, "superseded": 0, "tombstoned": 0, "historical": 0}
    try:
        data = collection.get(include=["metadatas"])
        from cortex_server.routers.librarian import _memory_status
        for metadata in data.get("metadatas") or []:
            status = _memory_status(metadata)
            lifecycle[status] = lifecycle.get(status, 0) + 1
    except Exception:
        lifecycle = {}
    retention_probe = _semantic_retention_canary_health()
    availability_ok = bool(count > 0 and search_ok)
    retention_verified = bool(retention_probe.get("verified"))
    ok = availability_ok and retention_verified
    return {
        "ok": ok,
        "status": "healthy" if ok else ("retention_unverified" if availability_ok else "degraded"),
        "availabilityOk": availability_ok,
        "retentionVerified": retention_verified,
        "retentionStatus": retention_probe.get("status"),
        "retentionProbe": retention_probe,
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
async def knowledge_status(http_request: Request):
    """L22 Mnemosyne status endpoint (canonical)."""
    try:
        principal = memory_principal_for_request(http_request)
        memory_count = _principal_semantic_memory_count(principal)

        return {
            "success": True,
            "level": 22,
            "name": "Mnemosyne",
            "status": "active",
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
async def memory_health(http_request: Request):
    """Principal-local compatibility health; aggregate diagnostics are withheld."""
    principal = memory_principal_for_request(http_request)
    return _principal_memory_health_payload(principal)


@router.post("/search")
async def search_knowledge(request: KnowledgeSearchRequest, http_request: Request):
    """Compatibility semantic search endpoint used by OpenClaw config.

    Uses Librarian's resilient recall path so memory_search remains available even
    when embedding providers are temporarily degraded.
    """
    try:
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")

        principal = memory_principal_for_request(http_request)
        result = robust_search(
            query=request.query,
            n_results=request.n_results,
            allow_fallback=True,
            memory_principal_key=principal.memory_principal_key,
        )
        return {
            "query": request.query,
            "results": result.get("results", []),
            "search_mode": result.get("search_mode", "semantic"),
            "degraded": bool(result.get("degraded", False)),
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
            "error": str(e),
        }


@router.post("/prior-art-gate")
async def prior_art_gate(request: PriorArtGateRequest, http_request: Request):
    """Pre-implementation recall gate for existing capabilities.

    Use this before building a new product/control-plane primitive. It searches
    durable memory plus the structural code graph and requires a reuse/extend/
    adapter decision when high-confidence prior art exists.
    """
    try:
        principal = memory_principal_for_request(http_request)
        terms = extract_prior_art_terms(
            objective=request.objective,
            planned_capabilities=request.planned_capabilities,
            planned_paths=request.planned_paths,
        )
        memory_rows: List[Dict[str, Any]] = []
        for query in [*request.planned_capabilities, *terms[:6]]:
            if not str(query or "").strip():
                continue
            try:
                result = robust_search(
                    query=str(query),
                    n_results=max(1, min(int(request.n_results or 5), 10)),
                    allow_fallback=True,
                    memory_principal_key=principal.memory_principal_key,
                )
                memory_rows.extend(result.get("results", []) or [])
            except Exception:
                continue

        structural_rows: List[Dict[str, Any]] = []
        seen_nodes = set()
        for term in terms[:8]:
            try:
                for node in _principal_graph_nodes(
                    principal,
                    name_pattern=term,
                    limit=max(1, min(int(request.n_results or 5), 10)),
                ):
                    node_dict = _node_to_dict(node)
                    node_id = node_dict.get("id") if isinstance(node_dict, dict) else None
                    if node_id and node_id in seen_nodes:
                        continue
                    if node_id:
                        seen_nodes.add(node_id)
                    structural_rows.append({"node": node_dict})
            except Exception:
                continue

        gate = build_prior_art_gate(
            objective=request.objective,
            planned_capabilities=request.planned_capabilities,
            planned_paths=request.planned_paths,
            proposed_action=request.proposed_action,
            memory_results=memory_rows,
            structural_results=structural_rows,
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
async def query_graph(request: GraphQueryRequest, http_request: Request):
    """Query the knowledge graph."""
    try:
        principal = memory_principal_for_request(http_request)
        node_type = None
        if request.node_type:
            try:
                node_type = NodeType(request.node_type)
            except ValueError:
                node_type = None
        nodes = _principal_graph_nodes(
            principal,
            node_type=node_type,
            name_pattern=request.query or None,
            limit=request.limit,
        )
        result = {"nodes": [_node_to_dict(node) for node in nodes], "count": len(nodes)}
        return {"success": True, "data": result, "error": None}
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
            if _graph_metadata_matches(getattr(edge, "metadata", None), principal)
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
async def structural_search(request: StructuralSearchRequest, http_request: Request):
    """Search the Cortex structural code graph.

    This is deliberately separate from semantic memory search. Use it for
    codebase-memory style questions: symbols, files/modules, imports, classes,
    functions, routes, and nearby dependency edges.
    """
    try:
        principal = memory_principal_for_request(http_request)
        node_type = None
        if request.node_type:
            try:
                node_type = NodeType(request.node_type)
            except ValueError:
                node_type = None
        nodes = _principal_graph_nodes(
            principal,
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
                    for n in _principal_graph_neighbors(principal, node.id, direction="both")[:25]
                ]
            results.append(item)
        return {"success": True, "query": request.query, "results": results, "count": len(results)}
    except Exception as e:
        return {"success": False, "query": request.query, "results": [], "count": 0, "error": str(e)}


@router.post("/structural/impact")
async def structural_impact(request: ImpactRequest, http_request: Request):
    """Return dependency/call/import neighborhood for a node or symbol query."""
    try:
        principal = memory_principal_for_request(http_request)
        nodes = []
        if request.node_id:
            scoped_node_id = _scoped_graph_id(principal, "node", request.node_id)
            node = service.graph.get_node(scoped_node_id)
            if node and _graph_metadata_matches(getattr(node, "metadata", None), principal):
                nodes = [node]
        elif request.query:
            nodes = _principal_graph_nodes(principal, name_pattern=request.query, limit=request.limit)
        else:
            raise HTTPException(status_code=400, detail="node_id or query is required")

        edge_type = None
        if request.edge_type:
            try:
                edge_type = EdgeType(request.edge_type)
            except ValueError:
                edge_type = None

        impacts = []
        for node in nodes[: max(1, min(50, request.limit or 10))]:
            neighbors = _principal_graph_neighbors(
                principal,
                node.id,
                edge_type=edge_type,
                direction=request.direction,
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
async def create_node(request: GraphNodeCreateRequest, http_request: Request):
    """Create a new node in the graph."""
    try:
        principal = memory_principal_for_request(http_request)
        external_id = request.id or f"{request.type}:{request.name}"
        scoped_request = request.copy(update={
            "id": _scoped_graph_id(principal, "node", external_id),
            "metadata": _scoped_graph_metadata(principal, request.metadata),
        })
        result = await service.create_node(scoped_request)
        return {"success": True, "data": result, "error": None}
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.get("/nodes/{node_id}")
async def get_node(node_id: str, http_request: Request):
    """Get a node by ID."""
    try:
        principal = memory_principal_for_request(http_request)
        result = await service.get_node(_scoped_graph_id(principal, "node", node_id))
        if result and _graph_metadata_matches(result.get("metadata"), principal):
            return {"success": True, "data": result, "error": None}
        raise HTTPException(status_code=404, detail="Node not found")
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.post("/edges")
async def create_edge(request: GraphEdgeCreateRequest, http_request: Request):
    """Create a new edge in the graph."""
    try:
        principal = memory_principal_for_request(http_request)
        source_id = _scoped_graph_id(principal, "node", request.source_id)
        target_id = _scoped_graph_id(principal, "node", request.target_id)
        for endpoint_id in (source_id, target_id):
            node = service.graph.get_node(endpoint_id)
            if node is None or not _graph_metadata_matches(getattr(node, "metadata", None), principal):
                raise HTTPException(status_code=404, detail="edge endpoint not found in authenticated principal namespace")
        external_id = request.id or f"{request.type}:{request.source_id}:{request.target_id}"
        scoped_request = request.copy(update={
            "id": _scoped_graph_id(principal, "edge", external_id),
            "source_id": source_id,
            "target_id": target_id,
            "metadata": _scoped_graph_metadata(principal, request.metadata),
        })
        result = await service.create_edge(scoped_request)
        return {"success": True, "data": result, "error": None}
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.get("/nodes/{node_id}/neighbors")
async def get_neighbors(node_id: str, http_request: Request, edge_type: str = None, direction: str = "out"):
    """Get neighbors of a node."""
    try:
        principal = memory_principal_for_request(http_request)
        scoped_node_id = _scoped_graph_id(principal, "node", node_id)
        node = service.graph.get_node(scoped_node_id)
        if node is None or not _graph_metadata_matches(getattr(node, "metadata", None), principal):
            raise HTTPException(status_code=404, detail="Node not found")
        resolved_edge_type = None
        if edge_type:
            try:
                resolved_edge_type = EdgeType(edge_type)
            except ValueError:
                resolved_edge_type = None
        rows = _principal_graph_neighbors(
            principal,
            scoped_node_id,
            edge_type=resolved_edge_type,
            direction=direction,
        )
        return {"success": True, "data": {
            "node_id": scoped_node_id,
            "neighbors": [_neighbor_to_dict(row) for row in rows],
            "count": len(rows),
        }}
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "error": str(e)}
