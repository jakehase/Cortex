"""
Knowledge Graph Router - API endpoints for graph operations.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from cortex_server.models.requests import (
    GraphQueryRequest, GraphNodeCreateRequest, GraphEdgeCreateRequest,
    GraphQueryResponse, GraphNodeResponse, GraphEdgeResponse
)
from cortex_server.services.knowledge_service import KnowledgeService
from cortex_server.routers.librarian import collection, robust_search

router = APIRouter()
service = KnowledgeService()


class KnowledgeSearchRequest(BaseModel):
    query: str
    n_results: int = 5


@router.get("/status")
async def knowledge_status():
    """L22 Mnemosyne status endpoint (canonical)."""
    try:
        memory_count = None
        try:
            memory_count = int(collection.count())
        except Exception:
            memory_count = None

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


@router.post("/search")
async def search_knowledge(request: KnowledgeSearchRequest):
    """Compatibility semantic search endpoint used by OpenClaw config.

    Uses Librarian's resilient recall path so memory_search remains available even
    when embedding providers are temporarily degraded.
    """
    try:
        if not request.query.strip():
            raise HTTPException(status_code=400, detail="Query cannot be empty")

        result = robust_search(
            query=request.query,
            n_results=request.n_results,
            allow_fallback=True,
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


@router.post("/query")
async def query_graph(request: GraphQueryRequest):
    """Query the knowledge graph."""
    try:
        result = await service.query(request)
        return {"success": True, "data": result, "error": None}
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.post("/nodes")
async def create_node(request: GraphNodeCreateRequest):
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
async def create_edge(request: GraphEdgeCreateRequest):
    """Create a new edge in the graph."""
    try:
        result = await service.create_edge(request)
        return {"success": True, "data": result, "error": None}
    except Exception as e:
        return {"success": False, "data": None, "error": str(e)}


@router.get("/nodes/{node_id}/neighbors")
async def get_neighbors(node_id: str, edge_type: str = None, direction: str = "out"):
    """Get neighbors of a node."""
    try:
        result = await service.get_neighbors(node_id, edge_type, direction)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}