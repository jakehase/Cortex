"""
Knowledge Graph Service - Business logic for graph operations.
"""

import hashlib
import threading
from typing import Dict, List, Optional, Any
from cortex_server.knowledge.graph import Graph, Node, Edge, NodeType, EdgeType
from cortex_server.models.requests import (
    GraphQueryRequest, GraphNodeCreateRequest, GraphEdgeCreateRequest
)


class KnowledgeService:
    """Service for knowledge graph operations."""
    
    def __init__(self):
        # Route/schema discovery constructs this service while importing the
        # knowledge router.  Opening the graph there creates and migrates the
        # SQLite database before the application has entered its lifespan.
        # Resolve the persistent dependency only when an operation needs it.
        self._graph = None
        self._graph_lock = threading.Lock()

    @property
    def graph(self) -> Graph:
        graph = getattr(self, "_graph", None)
        if graph is not None:
            return graph
        lock = getattr(self, "_graph_lock", None)
        if lock is None:
            lock = self._graph_lock = threading.Lock()
        with lock:
            if self._graph is None:
                self._graph = Graph()
            return self._graph

    @graph.setter
    def graph(self, value: Graph) -> None:
        # Retain the existing injection seam used by offline tools and tests.
        self._graph = value
    
    @staticmethod
    def _scoped_id(value: str, tenant_id: str, storage_workspace_id: str) -> str:
        prefix = "scope:" + hashlib.sha256(
            f"{tenant_id}\0{storage_workspace_id}".encode("utf-8")
        ).hexdigest()[:24] + ":"
        raw = str(value or "").strip()
        return raw if raw.startswith(prefix) else prefix + raw

    async def query(self, request: GraphQueryRequest, *, tenant_id: Optional[str] = None, storage_workspace_id: Optional[str] = None) -> Dict[str, Any]:
        """Query the knowledge graph."""
        node_type = None
        if request.node_type:
            try:
                node_type = NodeType(request.node_type)
            except ValueError as exc:
                raise ValueError(f"invalid node_type: {request.node_type}") from exc
        
        nodes = self.graph.query(
            node_type=node_type,
            name_pattern=request.query if request.query else None,
            limit=request.limit,
            tenant_id=tenant_id,
            storage_workspace_id=storage_workspace_id,
        )
        
        return {
            "nodes": [n.dict() for n in nodes],
            "count": len(nodes),
        }
    
    async def create_node(self, request: GraphNodeCreateRequest, *, tenant_id: str, storage_workspace_id: str) -> Dict[str, Any]:
        """Create a new node."""
        node = Node(
            id=self._scoped_id(request.id or f"{request.type}:{request.name}", tenant_id, storage_workspace_id),
            type=NodeType(request.type),
            name=request.name,
            uri=request.uri,
            language=request.language,
            metadata=request.metadata,
            tenant_id=tenant_id,
            storage_workspace_id=storage_workspace_id,
        )
        self.graph.add_node(node)
        return node.dict()
    
    async def get_node(self, node_id: str) -> Optional[Dict[str, Any]]:
        """Get a node by ID."""
        node = self.graph.get_node(node_id)
        if node:
            return node.dict()
        return None
    
    async def create_edge(self, request: GraphEdgeCreateRequest, *, tenant_id: str, storage_workspace_id: str) -> Dict[str, Any]:
        """Create a new edge."""
        edge = Edge(
            id=self._scoped_id(request.id or f"{request.type}:{request.source_id}:{request.target_id}", tenant_id, storage_workspace_id),
            type=EdgeType(request.type),
            source_id=self._scoped_id(request.source_id, tenant_id, storage_workspace_id),
            target_id=self._scoped_id(request.target_id, tenant_id, storage_workspace_id),
            weight=request.weight,
            context=request.context,
            metadata=request.metadata,
            tenant_id=tenant_id,
            storage_workspace_id=storage_workspace_id,
        )
        self.graph.add_edge(edge)
        return edge.dict()
    
    async def get_neighbors(
        self,
        node_id: str,
        edge_type: Optional[str] = None,
        direction: str = "out",
        limit: int = 100,
    ) -> Dict[str, Any]:
        """Get neighbors of a node."""
        etype = None
        if edge_type:
            try:
                etype = EdgeType(edge_type)
            except ValueError as exc:
                raise ValueError(f"invalid edge_type: {edge_type}") from exc
        if direction not in {"out", "in", "both"}:
            raise ValueError("direction must be one of: out, in, both")
        
        bounded_limit = max(1, min(100, int(limit)))
        neighbors = self.graph.get_neighbors(node_id, etype, direction, bounded_limit)
        return {
            "node_id": node_id,
            "neighbors": neighbors,
            "count": len(neighbors),
        }
