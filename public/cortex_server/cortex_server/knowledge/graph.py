"""
Knowledge Graph Core - Storage and query engine for The Cortex.
"""

import json
import sqlite3
from enum import Enum
from typing import Dict, List, Optional, Any, Iterator
from datetime import datetime
from pydantic import BaseModel, Field
import threading


class NodeType(str, Enum):
    FILE = "File"
    FUNCTION = "Function"
    CLASS = "Class"
    MODULE = "Module"
    DOCUMENT = "Document"
    SECTION = "Section"
    ENTITY = "Entity"
    PAGE = "Page"
    PARAGRAPH = "Paragraph"
    VARIABLE = "Variable"
    CONSTANT = "Constant"


class EdgeType(str, Enum):
    IMPORTS = "IMPORTS"
    CALLS = "CALLS"
    CONTAINS = "CONTAINS"
    REFERENCES = "REFERENCES"
    DEPENDS_ON = "DEPENDS_ON"
    EXPORTS = "EXPORTS"


class Node(BaseModel):
    id: str
    type: NodeType
    name: str
    uri: Optional[str] = None
    language: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class Edge(BaseModel):
    id: str
    type: EdgeType
    source_id: str
    target_id: str
    weight: Optional[float] = None
    context: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SQLiteStorage:
    """SQLite-backed storage for the knowledge graph."""
    
    def __init__(self, db_path: str = "cortex_graph.db"):
        self.db_path = db_path
        self._local = threading.local()
        self._init_db()
    
    def _get_conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._local.conn.row_factory = sqlite3.Row
        return self._local.conn
    
    def _init_db(self):
        """Initialize the database schema."""
        conn = self._get_conn()
        cursor = conn.cursor()
        
        # Nodes table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                uri TEXT,
                language TEXT,
                created_at TEXT,
                updated_at TEXT,
                metadata TEXT
            )
        """)
        
        # Edges table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS edges (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                weight REAL,
                context TEXT,
                metadata TEXT,
                FOREIGN KEY(source_id) REFERENCES nodes(id),
                FOREIGN KEY(target_id) REFERENCES nodes(id)
            )
        """)
        
        # Indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_nodes_uri ON nodes(uri)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)")
        
        conn.commit()
    
    def insert_node(self, node: Node) -> None:
        """Insert or update a node."""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO nodes 
            (id, type, name, uri, language, created_at, updated_at, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            node.id, node.type.value, node.name, node.uri, node.language,
            node.created_at.isoformat(), node.updated_at.isoformat(),
            json.dumps(node.metadata)
        ))
        conn.commit()
    
    def insert_edge(self, edge: Edge) -> None:
        """Insert or update an edge."""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO edges 
            (id, type, source_id, target_id, weight, context, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            edge.id, edge.type.value, edge.source_id, edge.target_id,
            edge.weight, edge.context, json.dumps(edge.metadata)
        ))
        conn.commit()
    
    def get_node(self, node_id: str) -> Optional[Node]:
        """Get a node by ID."""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM nodes WHERE id = ?", (node_id,))
        row = cursor.fetchone()
        if row:
            return self._row_to_node(row)
        return None
    
    def get_edge(self, edge_id: str) -> Optional[Edge]:
        """Get an edge by ID."""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM edges WHERE id = ?", (edge_id,))
        row = cursor.fetchone()
        if row:
            return self._row_to_edge(row)
        return None
    
    def query_nodes(
        self, 
        node_type: Optional[NodeType] = None,
        name_pattern: Optional[str] = None,
        limit: int = 100
    ) -> List[Node]:
        """Query nodes with optional filters."""
        conn = self._get_conn()
        cursor = conn.cursor()
        
        query = "SELECT * FROM nodes WHERE 1=1"
        params = []
        
        if node_type:
            query += " AND type = ?"
            params.append(node_type.value)
        
        if name_pattern:
            query += " AND name LIKE ?"
            params.append(f"%{name_pattern}%")
        
        query += f" LIMIT {limit}"
        
        cursor.execute(query, params)
        return [self._row_to_node(row) for row in cursor.fetchall()]
    
    def get_neighbors(
        self, 
        node_id: str, 
        edge_type: Optional[EdgeType] = None,
        direction: str = "out"  # "out", "in", "both"
    ) -> List[Dict[str, Any]]:
        """Get neighboring nodes."""
        conn = self._get_conn()
        cursor = conn.cursor()
        results = []
        
        if direction in ("out", "both"):
            query = "SELECT e.*, n.* FROM edges e JOIN nodes n ON e.target_id = n.id WHERE e.source_id = ?"
            params = [node_id]
            if edge_type:
                query += " AND e.type = ?"
                params.append(edge_type.value)
            cursor.execute(query, params)
            for row in cursor.fetchall():
                edge = self._row_to_edge(row)
                node = self._row_to_node(row)
                results.append({"edge": edge, "node": node, "direction": "out"})
        
        if direction in ("in", "both"):
            query = "SELECT e.*, n.* FROM edges e JOIN nodes n ON e.source_id = n.id WHERE e.target_id = ?"
            params = [node_id]
            if edge_type:
                query += " AND e.type = ?"
                params.append(edge_type.value)
            cursor.execute(query, params)
            for row in cursor.fetchall():
                edge = self._row_to_edge(row)
                node = self._row_to_node(row)
                results.append({"edge": edge, "node": node, "direction": "in"})
        
        return results
    
    def query_edges(
        self,
        edge_type: Optional[EdgeType] = None,
        source_id: Optional[str] = None,
        target_id: Optional[str] = None,
        limit: int = 100
    ) -> List[Edge]:
        """Query edges with optional filters."""
        conn = self._get_conn()
        cursor = conn.cursor()
        
        query = "SELECT * FROM edges WHERE 1=1"
        params = []
        
        if edge_type:
            query += " AND type = ?"
            params.append(edge_type.value)
        
        if source_id:
            query += " AND source_id = ?"
            params.append(source_id)
        
        if target_id:
            query += " AND target_id = ?"
            params.append(target_id)
        
        query += f" LIMIT {limit}"
        
        cursor.execute(query, params)
        return [self._row_to_edge(row) for row in cursor.fetchall()]
    
    def delete_node(self, node_id: str) -> bool:
        """Delete a node and its associated edges."""
        conn = self._get_conn()
        cursor = conn.cursor()
        
        # Delete associated edges first
        cursor.execute("DELETE FROM edges WHERE source_id = ? OR target_id = ?", (node_id, node_id))
        
        # Delete the node
        cursor.execute("DELETE FROM nodes WHERE id = ?", (node_id,))
        conn.commit()
        return cursor.rowcount > 0
    
    def delete_edge(self, edge_id: str) -> bool:
        """Delete an edge."""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM edges WHERE id = ?", (edge_id,))
        conn.commit()
        return cursor.rowcount > 0
    
    def _row_to_node(self, row: sqlite3.Row) -> Node:
        """Convert a database row to a Node."""
        return Node(
            id=row["id"],
            type=NodeType(row["type"]),
            name=row["name"],
            uri=row["uri"],
            language=row["language"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
            metadata=json.loads(row["metadata"] or "{}")
        )
    
    def _row_to_edge(self, row: sqlite3.Row) -> Edge:
        """Convert a database row to an Edge."""
        return Edge(
            id=row["id"],
            type=EdgeType(row["type"]),
            source_id=row["source_id"],
            target_id=row["target_id"],
            weight=row["weight"],
            context=row["context"],
            metadata=json.loads(row["metadata"] or "{}")
        )


class Graph:
    """Main knowledge graph interface."""
    
    def __init__(self, storage: Optional[SQLiteStorage] = None):
        self.storage = storage or SQLiteStorage()
    
    def add_node(self, node: Node) -> None:
        """Add a node to the graph."""
        self.storage.insert_node(node)
    
    def add_edge(self, edge: Edge) -> None:
        """Add an edge to the graph."""
        self.storage.insert_edge(edge)
    
    def get_node(self, node_id: str) -> Optional[Node]:
        """Get a node by ID."""
        return self.storage.get_node(node_id)
    
    def get_edge(self, edge_id: str) -> Optional[Edge]:
        """Get an edge by ID."""
        return self.storage.get_edge(edge_id)
    
    def query(
        self, 
        node_type: Optional[NodeType] = None,
        name_pattern: Optional[str] = None,
        limit: int = 100
    ) -> List[Node]:
        """Query nodes."""
        return self.storage.query_nodes(node_type, name_pattern, limit)
    
    def get_neighbors(
        self, 
        node_id: str, 
        edge_type: Optional[EdgeType] = None,
        direction: str = "out"
    ) -> List[Dict[str, Any]]:
        """Get neighboring nodes."""
        return self.storage.get_neighbors(node_id, edge_type, direction)
    
    def find_by_type(self, node_type: NodeType, limit: int = 100) -> List[Node]:
        """Find nodes by type."""
        return self.storage.query_nodes(node_type=node_type, limit=limit)
    
    def find_by_relationship(
        self, 
        edge_type: EdgeType,
        source_id: Optional[str] = None,
        target_id: Optional[str] = None,
        limit: int = 100
    ) -> List[Edge]:
        """Find edges by relationship type."""
        return self.storage.query_edges(edge_type, source_id, target_id, limit)
    
    def delete_node(self, node_id: str) -> bool:
        """Delete a node."""
        return self.storage.delete_node(node_id)
    
    def delete_edge(self, edge_id: str) -> bool:
        """Delete an edge."""
        return self.storage.delete_edge(edge_id)