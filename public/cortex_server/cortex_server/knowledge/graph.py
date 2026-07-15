"""
Knowledge Graph Core - Storage and query engine for The Cortex.
"""

import json
import os
import sqlite3
from enum import Enum
from typing import Dict, List, Optional, Any
from pathlib import Path
from datetime import datetime
from pydantic import BaseModel, Field
import threading
import time


class NodeType(str, Enum):
    FILE = "File"
    FUNCTION = "Function"
    CLASS = "Class"
    MODULE = "Module"
    ROUTE = "Route"
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
    HANDLES = "HANDLES"


class Node(BaseModel):
    id: str
    type: NodeType
    name: str
    uri: Optional[str] = None
    language: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    tenant_id: Optional[str] = None
    storage_workspace_id: Optional[str] = None


class Edge(BaseModel):
    id: str
    type: EdgeType
    source_id: str
    target_id: str
    weight: Optional[float] = None
    context: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    tenant_id: Optional[str] = None
    storage_workspace_id: Optional[str] = None


class SQLiteStorage:
    """SQLite-backed storage for the knowledge graph.

    IMPORTANT: Use a stable absolute DB path so API requests and offline tools
    read/write the same graph.
    """

    DEFAULT_DB_CANDIDATES = [
        "/root/clawd/public/cortex_server/cortex_graph.db",
        "/opt/clawdbot/cortex_server/cortex_graph.db",
        "/opt/clawdbot/cortex_graph.db",
        str(Path(__file__).resolve().parents[3] / "cortex_graph.db"),
    ]

    def __init__(self, db_path: Optional[str] = None):
        configured_db_path = db_path or os.getenv("CORTEX_DB_PATH")
        if configured_db_path:
            self.db_path = str(Path(configured_db_path).expanduser().resolve())
        else:
            chosen = None
            for c in self.DEFAULT_DB_CANDIDATES:
                try:
                    if Path(c).exists():
                        chosen = c
                        break
                except Exception:
                    continue
            self.db_path = str(Path(chosen or self.DEFAULT_DB_CANDIDATES[-1]).resolve())

        self._local = threading.local()
        self._transaction_lock = threading.Lock()
        self._active_transactions = set()
        self._active_transactions_lock = threading.Lock()
        self._init_db()

    def interrupt_transactions(self) -> None:
        """Interrupt every parser-owned transaction currently using this storage."""
        with self._active_transactions_lock:
            connections = tuple(self._active_transactions)
        for connection in connections:
            connection.interrupt()

    @staticmethod
    def _assert_scope_ownership(connection: sqlite3.Connection, table: str, rows) -> None:
        for row in rows:
            existing = connection.execute(
                f"SELECT tenant_id, storage_workspace_id FROM {table} WHERE id = ?",
                (row.id,),
            ).fetchone()
            if existing is not None and (existing[0], existing[1]) != (
                row.tenant_id,
                row.storage_workspace_id,
            ):
                raise PermissionError(f"graph {table[:-1]} id is already owned by another scope")

    @staticmethod
    def _assert_edge_endpoints(connection: sqlite3.Connection, edges) -> None:
        for edge in edges:
            for node_id in (edge.source_id, edge.target_id):
                owner = connection.execute(
                    "SELECT tenant_id, storage_workspace_id FROM nodes WHERE id = ?",
                    (node_id,),
                ).fetchone()
                if owner is None:
                    raise sqlite3.IntegrityError(f"graph edge endpoint does not exist: {node_id}")
                if (owner[0], owner[1]) != (edge.tenant_id, edge.storage_workspace_id):
                    raise PermissionError("graph edge endpoints must belong to the edge scope")

    def write_batch_atomic(self, nodes, edges, *, deadline: float, cancelled) -> None:
        """Write a complete bounded batch or make none of it visible."""
        def expired() -> bool:
            return cancelled.is_set() or time.monotonic() >= deadline

        if expired():
            raise TimeoutError("graph commit deadline exceeded")
        # A dedicated connection makes interrupt/rollback ownership unambiguous.
        connection = sqlite3.connect(self.db_path, check_same_thread=False)
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 100")
        connection.set_progress_handler(lambda: int(expired()), 100)
        with self._active_transactions_lock:
            self._active_transactions.add(connection)
        try:
            with self._transaction_lock:
                if expired():
                    raise TimeoutError("graph commit deadline exceeded")
                connection.execute("BEGIN IMMEDIATE")
                self._assert_scope_ownership(connection, "nodes", nodes)
                connection.executemany(
                    """
                    INSERT INTO nodes (id,type,name,uri,language,created_at,updated_at,metadata,tenant_id,storage_workspace_id)
                    VALUES (?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET
                        type = excluded.type,
                        name = excluded.name,
                        uri = excluded.uri,
                        language = excluded.language,
                        created_at = excluded.created_at,
                        updated_at = excluded.updated_at,
                        metadata = excluded.metadata
                    WHERE COALESCE(nodes.tenant_id, '') = COALESCE(excluded.tenant_id, '')
                      AND COALESCE(nodes.storage_workspace_id, '') = COALESCE(excluded.storage_workspace_id, '')
                    """,
                    [(n.id, n.type.value, n.name, n.uri, n.language, n.created_at.isoformat(),
                      n.updated_at.isoformat(), json.dumps(n.metadata), n.tenant_id, n.storage_workspace_id) for n in nodes],
                )
                hook = getattr(self, "_batch_transaction_hook", None)
                if hook is not None:
                    hook()
                if expired():
                    raise TimeoutError("graph commit deadline exceeded")
                self._assert_scope_ownership(connection, "edges", edges)
                self._assert_edge_endpoints(connection, edges)
                connection.executemany(
                    """INSERT INTO edges (id,type,source_id,target_id,weight,context,metadata,tenant_id,storage_workspace_id)
                       VALUES (?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET
                         type=excluded.type, source_id=excluded.source_id, target_id=excluded.target_id,
                         weight=excluded.weight, context=excluded.context, metadata=excluded.metadata
                       WHERE COALESCE(edges.tenant_id, '') = COALESCE(excluded.tenant_id, '')
                         AND COALESCE(edges.storage_workspace_id, '') = COALESCE(excluded.storage_workspace_id, '')""",
                    [(e.id, e.type.value, e.source_id, e.target_id, e.weight,
                      e.context, json.dumps(e.metadata), e.tenant_id, e.storage_workspace_id) for e in edges],
                )
                if expired():
                    raise TimeoutError("graph commit deadline exceeded")
                connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            with self._active_transactions_lock:
                self._active_transactions.discard(connection)
            connection.set_progress_handler(None, 0)
            connection.close()
    
    def _get_conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._local.conn.row_factory = sqlite3.Row
            self._local.conn.execute("PRAGMA foreign_keys = ON")
            self._local.conn.execute("PRAGMA busy_timeout = 10000")
            if not self._local.conn.execute("PRAGMA foreign_keys").fetchone()[0]:
                self._local.conn.close()
                self._local.conn = None
                raise RuntimeError("SQLite foreign-key enforcement is unavailable")
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
        node_columns = {str(row[1]) for row in cursor.execute("PRAGMA table_info(nodes)").fetchall()}
        if "tenant_id" not in node_columns:
            cursor.execute("ALTER TABLE nodes ADD COLUMN tenant_id TEXT")
        if "storage_workspace_id" not in node_columns:
            cursor.execute("ALTER TABLE nodes ADD COLUMN storage_workspace_id TEXT")
        
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
        edge_columns = {str(row[1]) for row in cursor.execute("PRAGMA table_info(edges)").fetchall()}
        if "tenant_id" not in edge_columns:
            cursor.execute("ALTER TABLE edges ADD COLUMN tenant_id TEXT")
        if "storage_workspace_id" not in edge_columns:
            cursor.execute("ALTER TABLE edges ADD COLUMN storage_workspace_id TEXT")
        
        # Indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_nodes_uri ON nodes(uri)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_nodes_scope ON nodes(tenant_id, storage_workspace_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_edges_scope ON edges(tenant_id, storage_workspace_id)")
        
        conn.commit()
    
    def insert_node(self, node: Node) -> None:
        """Insert or update a node."""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO nodes
            (id, type, name, uri, language, created_at, updated_at, metadata, tenant_id, storage_workspace_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                type = excluded.type,
                name = excluded.name,
                uri = excluded.uri,
                language = excluded.language,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                metadata = excluded.metadata
            WHERE COALESCE(nodes.tenant_id, '') = COALESCE(excluded.tenant_id, '')
              AND COALESCE(nodes.storage_workspace_id, '') = COALESCE(excluded.storage_workspace_id, '')
        """, (
            node.id, node.type.value, node.name, node.uri, node.language,
            node.created_at.isoformat(), node.updated_at.isoformat(),
            json.dumps(node.metadata), node.tenant_id, node.storage_workspace_id
        ))
        if cursor.rowcount == 0:
            conn.rollback()
            raise PermissionError("graph node id is already owned by another scope")
        conn.commit()
    
    def insert_edge(self, edge: Edge) -> None:
        """Insert or update an edge."""
        conn = self._get_conn()
        cursor = conn.cursor()
        try:
            self._assert_edge_endpoints(conn, [edge])
            cursor.execute("""
                INSERT INTO edges
                (id, type, source_id, target_id, weight, context, metadata, tenant_id, storage_workspace_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    type=excluded.type, source_id=excluded.source_id, target_id=excluded.target_id,
                    weight=excluded.weight, context=excluded.context, metadata=excluded.metadata
                WHERE COALESCE(edges.tenant_id, '') = COALESCE(excluded.tenant_id, '')
                  AND COALESCE(edges.storage_workspace_id, '') = COALESCE(excluded.storage_workspace_id, '')
            """, (edge.id, edge.type.value, edge.source_id, edge.target_id,
                  edge.weight, edge.context, json.dumps(edge.metadata), edge.tenant_id, edge.storage_workspace_id))
            if cursor.rowcount == 0:
                raise PermissionError("graph edge id is already owned by another scope")
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def insert_nodes(self, nodes: List[Node]) -> None:
        """Insert or update multiple nodes in one transaction."""
        if not nodes:
            return
        conn = self._get_conn()
        cursor = conn.cursor()
        try:
            self._assert_scope_ownership(conn, "nodes", nodes)
            cursor.executemany("""
                INSERT INTO nodes
                (id, type, name, uri, language, created_at, updated_at, metadata, tenant_id, storage_workspace_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    type = excluded.type,
                    name = excluded.name,
                    uri = excluded.uri,
                    language = excluded.language,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    metadata = excluded.metadata
                WHERE COALESCE(nodes.tenant_id, '') = COALESCE(excluded.tenant_id, '')
                  AND COALESCE(nodes.storage_workspace_id, '') = COALESCE(excluded.storage_workspace_id, '')
            """, [
                (
                    node.id, node.type.value, node.name, node.uri, node.language,
                    node.created_at.isoformat(), node.updated_at.isoformat(),
                    json.dumps(node.metadata), node.tenant_id, node.storage_workspace_id,
                )
                for node in nodes
            ])
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def insert_edges(self, edges: List[Edge]) -> None:
        """Insert or update multiple edges in one transaction."""
        if not edges:
            return
        conn = self._get_conn()
        cursor = conn.cursor()
        try:
            self._assert_scope_ownership(conn, "edges", edges)
            self._assert_edge_endpoints(conn, edges)
            cursor.executemany("""
                INSERT INTO edges
                (id, type, source_id, target_id, weight, context, metadata, tenant_id, storage_workspace_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    type=excluded.type, source_id=excluded.source_id, target_id=excluded.target_id,
                    weight=excluded.weight, context=excluded.context, metadata=excluded.metadata
                WHERE COALESCE(edges.tenant_id, '') = COALESCE(excluded.tenant_id, '')
                  AND COALESCE(edges.storage_workspace_id, '') = COALESCE(excluded.storage_workspace_id, '')
            """, [(edge.id, edge.type.value, edge.source_id, edge.target_id,
                    edge.weight, edge.context, json.dumps(edge.metadata), edge.tenant_id, edge.storage_workspace_id) for edge in edges])
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    
    def get_node(self, node_id: str, *, tenant_id: Optional[str] = None, storage_workspace_id: Optional[str] = None) -> Optional[Node]:
        """Get a node by ID."""
        conn = self._get_conn()
        cursor = conn.cursor()
        query = "SELECT * FROM nodes WHERE id = ?"
        params: List[Any] = [node_id]
        if tenant_id is not None or storage_workspace_id is not None:
            query += " AND tenant_id = ? AND storage_workspace_id = ?"
            params.extend([tenant_id, storage_workspace_id])
        cursor.execute(query, params)
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
        limit: int = 100,
        tenant_id: Optional[str] = None,
        storage_workspace_id: Optional[str] = None,
    ) -> List[Node]:
        """Query nodes with optional filters."""
        conn = self._get_conn()
        cursor = conn.cursor()
        
        query = "SELECT * FROM nodes WHERE 1=1"
        params = []
        if tenant_id is not None or storage_workspace_id is not None:
            query += " AND tenant_id = ? AND storage_workspace_id = ?"
            params.extend([tenant_id, storage_workspace_id])
        
        if node_type:
            query += " AND type = ?"
            params.append(node_type.value)
        
        if name_pattern:
            query += " AND name LIKE ?"
            params.append(f"%{name_pattern}%")
        
        limit = max(1, min(1000, int(limit or 100)))
        query += f" LIMIT {limit}"
        
        cursor.execute(query, params)
        return [self._row_to_node(row) for row in cursor.fetchall()]
    
    def get_neighbors(
        self, 
        node_id: str, 
        edge_type: Optional[EdgeType] = None,
        direction: str = "out",  # "out", "in", "both"
        limit: int = 100,
        tenant_id: Optional[str] = None,
        storage_workspace_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get neighboring nodes."""
        conn = self._get_conn()
        cursor = conn.cursor()
        if direction not in {"out", "in", "both"}:
            raise ValueError("direction must be one of: out, in, both")
        limit = max(1, min(1000, int(limit or 100)))
        clauses = []
        params: List[Any] = []
        scoped = tenant_id is not None or storage_workspace_id is not None
        scope_clause = " AND e.tenant_id=? AND e.storage_workspace_id=? AND n.tenant_id=? AND n.storage_workspace_id=?" if scoped else ""
        scope_params = [tenant_id, storage_workspace_id, tenant_id, storage_workspace_id] if scoped else []
        if direction in ("out", "both"):
            clauses.append("SELECT 'out' AS direction, e.id AS edge_id, n.id AS node_id "
                           "FROM edges e JOIN nodes n ON n.id=e.target_id WHERE e.source_id=?" +
                           (" AND e.type=?" if edge_type else "") + scope_clause)
            params.extend([node_id] + ([edge_type.value] if edge_type else []) + scope_params)
        if direction in ("in", "both"):
            clauses.append("SELECT 'in' AS direction, e.id AS edge_id, n.id AS node_id "
                           "FROM edges e JOIN nodes n ON n.id=e.source_id WHERE e.target_id=?" +
                           (" AND e.type=?" if edge_type else "") + scope_clause)
            params.extend([node_id] + ([edge_type.value] if edge_type else []) + scope_params)
        query = "SELECT direction, e.*, n.id AS n_id, n.type AS n_type, n.name AS n_name, " \
                "n.uri AS n_uri, n.language AS n_language, n.created_at AS n_created_at, " \
                "n.updated_at AS n_updated_at, n.metadata AS n_metadata, n.tenant_id AS n_tenant_id, " \
                "n.storage_workspace_id AS n_storage_workspace_id FROM (" + \
                " UNION ALL ".join(clauses) + ") bounded JOIN edges e ON e.id=bounded.edge_id " \
                "JOIN nodes n ON n.id=bounded.node_id LIMIT ?"
        cursor.execute(query, [*params, limit])
        results = []
        for row in cursor.fetchall():
            node = Node(id=row["n_id"], type=NodeType(row["n_type"]), name=row["n_name"],
                        uri=row["n_uri"], language=row["n_language"],
                        created_at=datetime.fromisoformat(row["n_created_at"]),
                        updated_at=datetime.fromisoformat(row["n_updated_at"]),
                        metadata=json.loads(row["n_metadata"] or "{}"),
                        tenant_id=row["n_tenant_id"],
                        storage_workspace_id=row["n_storage_workspace_id"])
            results.append({"edge": self._row_to_edge(row), "node": node, "direction": row["direction"]})
        return results

    def stats(self) -> Dict[str, Any]:
        """Return lightweight graph cardinality and type breakdowns."""
        conn = self._get_conn()
        cursor = conn.cursor()
        node_count = cursor.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
        edge_count = cursor.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
        node_types = {
            row[0]: row[1]
            for row in cursor.execute(
                "SELECT type, COUNT(*) FROM nodes GROUP BY type ORDER BY COUNT(*) DESC"
            ).fetchall()
        }
        edge_types = {
            row[0]: row[1]
            for row in cursor.execute(
                "SELECT type, COUNT(*) FROM edges GROUP BY type ORDER BY COUNT(*) DESC"
            ).fetchall()
        }
        return {
            "dbPath": str(self.db_path),
            "nodeCount": node_count,
            "edgeCount": edge_count,
            "nodeTypes": node_types,
            "edgeTypes": edge_types,
        }
    
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
            metadata=json.loads(row["metadata"] or "{}"),
            tenant_id=row["tenant_id"],
            storage_workspace_id=row["storage_workspace_id"],
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
            metadata=json.loads(row["metadata"] or "{}"),
            tenant_id=row["tenant_id"],
            storage_workspace_id=row["storage_workspace_id"],
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

    def add_nodes(self, nodes: List[Node]) -> None:
        """Add multiple nodes efficiently."""
        self.storage.insert_nodes(nodes)

    def add_edges(self, edges: List[Edge]) -> None:
        """Add multiple edges efficiently."""
        self.storage.insert_edges(edges)

    def write_batch_atomic(self, nodes, edges, *, deadline: float, cancelled) -> None:
        self.storage.write_batch_atomic(nodes, edges, deadline=deadline, cancelled=cancelled)

    def interrupt_transactions(self) -> None:
        self.storage.interrupt_transactions()
    
    def get_node(self, node_id: str, *, tenant_id: Optional[str] = None, storage_workspace_id: Optional[str] = None) -> Optional[Node]:
        """Get a node by ID."""
        return self.storage.get_node(node_id, tenant_id=tenant_id, storage_workspace_id=storage_workspace_id)
    
    def get_edge(self, edge_id: str) -> Optional[Edge]:
        """Get an edge by ID."""
        return self.storage.get_edge(edge_id)
    
    def query(
        self, 
        node_type: Optional[NodeType] = None,
        name_pattern: Optional[str] = None,
        limit: int = 100,
        tenant_id: Optional[str] = None,
        storage_workspace_id: Optional[str] = None,
    ) -> List[Node]:
        """Query nodes."""
        return self.storage.query_nodes(node_type, name_pattern, limit, tenant_id, storage_workspace_id)
    
    def get_neighbors(
        self, 
        node_id: str, 
        edge_type: Optional[EdgeType] = None,
        direction: str = "out",
        limit: int = 100,
        tenant_id: Optional[str] = None,
        storage_workspace_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get neighboring nodes."""
        return self.storage.get_neighbors(node_id, edge_type, direction, limit, tenant_id, storage_workspace_id)
    
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

    def stats(self) -> Dict[str, Any]:
        """Return graph cardinality and type breakdowns."""
        return self.storage.stats()
    
    def delete_node(self, node_id: str) -> bool:
        """Delete a node."""
        return self.storage.delete_node(node_id)
    
    def delete_edge(self, edge_id: str) -> bool:
        """Delete an edge."""
        return self.storage.delete_edge(edge_id)
