"""
Knowledge Graph Service - Business logic for graph operations.
"""

from typing import Dict, List, Optional, Any
from cortex_server.knowledge.graph import Graph, Node, Edge, NodeType, EdgeType
from cortex_server.models.requests import (
    GraphQueryRequest, GraphNodeCreateRequest, GraphEdgeCreateRequest
)


class KnowledgeService:
    """Service for knowledge graph operations."""
    
    def __init__(self):
        self.graph = Graph()
    
    async def query(self, request: GraphQueryRequest) -> Dict[str, Any]:
        """Query the knowledge graph."""
        node_type = None
        if request.node_type:
            try:
                node_type = NodeType(request.node_type)
            except ValueError:
                pass
        
        nodes = self.graph.query(
            node_type=node_type,
            name_pattern=request.query if request.query else None,
            limit=request.limit
        )
        
        return {
            "nodes": [n.dict() for n in nodes],
            "count": len(nodes),
        }
    
    async def create_node(self, request: GraphNodeCreateRequest) -> Dict[str, Any]:
        """Create a new node."""
        node = Node(
            id=request.id or f"{request.type}:{request.name}",
            type=NodeType(request.type),
            name=request.name,
            uri=request.uri,
            language=request.language,
            metadata=request.metadata,
        )
        self.graph.add_node(node)
        return node.dict()
    
    async def get_node(self, node_id: str) -> Optional[Dict[str, Any]]:
        """Get a node by ID."""
        node = self.graph.get_node(node_id)
        if node:
            return node.dict()
        return None
    
    async def create_edge(self, request: GraphEdgeCreateRequest) -> Dict[str, Any]:
        """Create a new edge."""
        edge = Edge(
            id=request.id or f"{request.type}:{request.source_id}:{request.target_id}",
            type=EdgeType(request.type),
            source_id=request.source_id,
            target_id=request.target_id,
            weight=request.weight,
            context=request.context,
            metadata=request.metadata,
        )
        self.graph.add_edge(edge)
        return edge.dict()
    
    async def get_neighbors(
        self,
        node_id: str,
        edge_type: Optional[str] = None,
        direction: str = "out"
    ) -> Dict[str, Any]:
        """Get neighbors of a node."""
        etype = None
        if edge_type:
            try:
                etype = EdgeType(edge_type)
            except ValueError:
                pass
        
        neighbors = self.graph.get_neighbors(node_id, etype, direction)
        return {
            "node_id": node_id,
            "neighbors": neighbors,
            "count": len(neighbors),
        }