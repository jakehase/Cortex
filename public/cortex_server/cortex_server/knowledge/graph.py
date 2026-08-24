"""
Knowledge Graph Core - Storage and query engine for The Cortex.
"""

import json
import fcntl
import os
import sqlite3
import stat
from enum import Enum
from typing import Dict, List, Optional, Any
from pathlib import Path
from datetime import datetime
from pydantic import BaseModel, Field
import threading
import time
from uuid import uuid4

from cortex_server.runtime.durable_files import durable_mkdir


MAX_GRAPH_OBJECT_BYTES = 1024 * 1024
MAX_GRAPH_PRINCIPAL_ROWS = 100_000
MAX_GRAPH_PRINCIPAL_BYTES = 128 * 1024 * 1024
MAX_GRAPH_TENANT_ROWS = 500_000
MAX_GRAPH_TENANT_BYTES = 512 * 1024 * 1024
MAX_GRAPH_ROWS = 2_000_000
MAX_GRAPH_BYTES = 2 * 1024 * 1024 * 1024
GRAPH_RECOVERY_RESERVE_ROWS = 100_000
GRAPH_RECOVERY_RESERVE_BYTES = 128 * 1024 * 1024
GRAPH_QUOTA_LEDGER_VERSION = "v2-unscoped-global-only"


class GraphQuotaError(ValueError):
    """A graph mutation would cross an immutable durable storage boundary."""


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
        str(Path(__file__).resolve().parents[2] / "cortex_graph.db"),
    ]

    def __init__(self, db_path: Optional[str] = None):
        configured_db_path = db_path or os.getenv("CORTEX_DB_PATH")
        if configured_db_path:
            self.db_path = str(Path(configured_db_path).expanduser().resolve())
        else:
            production = os.getenv("CORTEX_ENV", os.getenv("CORTEX_ENVIRONMENT", "development")).strip().lower() in {"production", "prod", "staging"}
            if production:
                self.db_path = "/opt/clawdbot/knowledge/cortex_graph.db"
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

        self._initialize_from_seed()

        self._local = threading.local()
        self._transaction_lock = threading.Lock()
        self._active_transactions = set()
        self._active_transactions_lock = threading.Lock()
        self._lifecycle_lock_fd = None
        self._lifecycle_lock_identity = None
        self._lifecycle_lock_guard = threading.Lock()
        self._init_db()
        self._refresh_lifecycle_lock(os.lstat(self.db_path))

    def _open_lifecycle_lock(self) -> tuple[int, tuple[int, int]]:
        descriptor = os.open(
            self.db_path,
            os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                raise RuntimeError("Cortex graph database must be a regular file")
            try:
                fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise RuntimeError(
                    "Cortex graph database is undergoing offline publication"
                ) from exc
            return descriptor, (metadata.st_dev, metadata.st_ino)
        except BaseException:
            os.close(descriptor)
            raise

    def _refresh_lifecycle_lock(self, metadata: os.stat_result) -> None:
        identity = (metadata.st_dev, metadata.st_ino)
        if identity == self._lifecycle_lock_identity:
            return
        with self._lifecycle_lock_guard:
            if identity == self._lifecycle_lock_identity:
                return
            descriptor, locked_identity = self._open_lifecycle_lock()
            if locked_identity != identity:
                os.close(descriptor)
                raise RuntimeError("Cortex graph database changed while acquiring its lock")
            previous = self._lifecycle_lock_fd
            self._lifecycle_lock_fd = descriptor
            self._lifecycle_lock_identity = locked_identity
            if previous is not None:
                os.close(previous)

    def close(self) -> None:
        connection = getattr(self._local, "conn", None)
        if connection is not None:
            if connection.in_transaction:
                connection.rollback()
            connection.close()
            self._local.conn = None
        with self._lifecycle_lock_guard:
            descriptor = self._lifecycle_lock_fd
            self._lifecycle_lock_fd = None
            self._lifecycle_lock_identity = None
            if descriptor is not None:
                os.close(descriptor)

    def _initialize_from_seed(self) -> None:
        target = Path(self.db_path)
        if target.exists():
            return
        production = os.getenv(
            "CORTEX_ENV", os.getenv("CORTEX_ENVIRONMENT", "development")
        ).strip().lower() in {"production", "prod", "staging"}
        if production:
            raise RuntimeError(
                "production graph database is missing; run explicit volume bootstrap or restore it"
            )
        seed_value = os.getenv("CORTEX_DB_SEED_PATH", "").strip()
        if not seed_value:
            return
        seed = Path(seed_value).expanduser().resolve()
        if not seed.is_file() or seed.is_symlink():
            raise RuntimeError("configured Cortex graph seed is not a regular file")
        durable_mkdir(target.parent)
        if target.parent.is_symlink():
            raise RuntimeError("Cortex graph database directory cannot be a symbolic link")
        temporary = target.with_name(f".{target.name}.{os.getpid()}.{uuid4().hex}.tmp")
        try:
            with seed.open("rb") as source, temporary.open("xb") as destination:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    destination.write(chunk)
                destination.flush()
                os.fsync(destination.fileno())
            os.replace(temporary, target)
            directory_fd = os.open(target.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

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

    @staticmethod
    def _node_values(node: Node) -> tuple:
        return (
            node.id,
            node.type.value,
            node.name,
            node.uri,
            node.language,
            node.created_at.isoformat(),
            node.updated_at.isoformat(),
            json.dumps(node.metadata),
            node.tenant_id,
            node.storage_workspace_id,
        )

    @staticmethod
    def _edge_values(edge: Edge) -> tuple:
        return (
            edge.id,
            edge.type.value,
            edge.source_id,
            edge.target_id,
            edge.weight,
            edge.context,
            json.dumps(edge.metadata),
            edge.tenant_id,
            edge.storage_workspace_id,
        )

    @staticmethod
    def _quota_record(kind: str, values: tuple) -> tuple[str, str, str, str, int]:
        tenant_id = str(values[-2] or "")
        workspace_id = str(values[-1] or "")
        if bool(tenant_id) != bool(workspace_id):
            raise GraphQuotaError("graph quota scope must contain both tenant and principal workspace")
        encoded = json.dumps(
            [kind, *values],
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        if len(encoded) > MAX_GRAPH_OBJECT_BYTES:
            raise GraphQuotaError(
                f"graph object exceeds immutable quota of {MAX_GRAPH_OBJECT_BYTES} bytes"
            )
        return kind, str(values[0]), tenant_id, workspace_id, len(encoded)

    @staticmethod
    def _assert_quota_limits(
        *,
        global_rows: int,
        global_bytes: int,
        principal_usage: Dict[tuple[str, str], tuple[int, int]],
        tenant_usage: Dict[str, tuple[int, int]],
    ) -> None:
        operational_rows = MAX_GRAPH_ROWS - GRAPH_RECOVERY_RESERVE_ROWS
        operational_bytes = MAX_GRAPH_BYTES - GRAPH_RECOVERY_RESERVE_BYTES
        if operational_rows < 0 or operational_bytes < 0:
            raise RuntimeError("graph recovery reserve exceeds the immutable aggregate quota")
        if global_rows > operational_rows:
            raise GraphQuotaError("graph aggregate row quota exceeded; recovery reserve preserved")
        if global_bytes > operational_bytes:
            raise GraphQuotaError("graph aggregate byte quota exceeded; recovery reserve preserved")
        for rows, size in principal_usage.values():
            if rows > MAX_GRAPH_PRINCIPAL_ROWS:
                raise GraphQuotaError("graph principal workspace row quota exceeded")
            if size > MAX_GRAPH_PRINCIPAL_BYTES:
                raise GraphQuotaError("graph principal workspace byte quota exceeded")
        for rows, size in tenant_usage.values():
            if rows > MAX_GRAPH_TENANT_ROWS:
                raise GraphQuotaError("graph tenant row quota exceeded")
            if size > MAX_GRAPH_TENANT_BYTES:
                raise GraphQuotaError("graph tenant byte quota exceeded")

    @classmethod
    def _assert_quota_snapshot(cls, records) -> None:
        principal: Dict[tuple[str, str], tuple[int, int]] = {}
        tenants: Dict[str, tuple[int, int]] = {}
        total_bytes = 0
        total_rows = 0
        for _kind, _object_id, tenant_id, workspace_id, record_bytes in records:
            total_rows += 1
            total_bytes += int(record_bytes)
            # Legacy structural-code rows predate principal scoping. They are
            # durable global graph data, not one giant synthetic principal.
            # Keep charging them to aggregate quotas while preserving scoped
            # principal and tenant limits for every new authenticated write.
            if tenant_id and workspace_id:
                scope = (str(tenant_id), str(workspace_id))
                scope_rows, scope_bytes = principal.get(scope, (0, 0))
                principal[scope] = (scope_rows + 1, scope_bytes + int(record_bytes))
                tenant_rows, tenant_bytes = tenants.get(str(tenant_id), (0, 0))
                tenants[str(tenant_id)] = (
                    tenant_rows + 1,
                    tenant_bytes + int(record_bytes),
                )
        cls._assert_quota_limits(
            global_rows=total_rows,
            global_bytes=total_bytes,
            principal_usage=principal,
            tenant_usage=tenants,
        )

    @classmethod
    def _reconcile_quota_ledger(cls, connection: sqlite3.Connection) -> None:
        connection.execute("DELETE FROM graph_quota_ledger")
        principal: Dict[tuple[str, str], List[int]] = {}
        tenants: Dict[str, List[int]] = {}
        total_rows = 0
        total_bytes = 0
        pending = []

        def flush() -> None:
            if not pending:
                return
            connection.executemany(
                """
                INSERT INTO graph_quota_ledger
                    (object_kind, object_id, tenant_id, storage_workspace_id, record_bytes)
                VALUES (?, ?, ?, ?, ?)
                """,
                pending,
            )
            pending.clear()

        def backfill(record) -> None:
            nonlocal total_rows, total_bytes
            record_bytes = int(record[4])
            total_rows += 1
            total_bytes += record_bytes
            tenant_id = str(record[2])
            workspace_id = str(record[3])
            if tenant_id and workspace_id:
                scope = (tenant_id, workspace_id)
                scope_usage = principal.setdefault(scope, [0, 0])
                scope_usage[0] += 1
                scope_usage[1] += record_bytes
                tenant_usage = tenants.setdefault(tenant_id, [0, 0])
                tenant_usage[0] += 1
                tenant_usage[1] += record_bytes
                principal_snapshot = {scope: tuple(scope_usage)}
                tenant_snapshot = {tenant_id: tuple(tenant_usage)}
            else:
                principal_snapshot = {}
                tenant_snapshot = {}
            cls._assert_quota_limits(
                global_rows=total_rows,
                global_bytes=total_bytes,
                principal_usage=principal_snapshot,
                tenant_usage=tenant_snapshot,
            )
            pending.append(record)
            if len(pending) >= 1024:
                flush()

        for kind, query in (
            (
                "node",
                "SELECT id,type,name,uri,language,created_at,updated_at,metadata,tenant_id,storage_workspace_id FROM nodes",
            ),
            (
                "edge",
                "SELECT id,type,source_id,target_id,weight,context,metadata,tenant_id,storage_workspace_id FROM edges",
            ),
        ):
            for row in connection.execute(query):
                backfill(cls._quota_record(kind, tuple(row)))
        flush()
        connection.execute(
            """
            INSERT INTO graph_quota_metadata(key, value)
            VALUES ('ledger_version', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (GRAPH_QUOTA_LEDGER_VERSION,),
        )
        connection.execute(
            """
            INSERT INTO graph_quota_metadata(key, value)
            VALUES ('quota_policy', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (cls._quota_policy_identity(),),
        )

    @staticmethod
    def _quota_policy_identity() -> str:
        return json.dumps(
            {
                "principalRows": MAX_GRAPH_PRINCIPAL_ROWS,
                "principalBytes": MAX_GRAPH_PRINCIPAL_BYTES,
                "tenantRows": MAX_GRAPH_TENANT_ROWS,
                "tenantBytes": MAX_GRAPH_TENANT_BYTES,
                "globalRows": MAX_GRAPH_ROWS,
                "globalBytes": MAX_GRAPH_BYTES,
                "recoveryReserveRows": GRAPH_RECOVERY_RESERVE_ROWS,
                "recoveryReserveBytes": GRAPH_RECOVERY_RESERVE_BYTES,
            },
            separators=(",", ":"),
            sort_keys=True,
        )

    @classmethod
    def _quota_ledger_complete(cls, connection: sqlite3.Connection) -> bool:
        version = connection.execute(
            "SELECT value FROM graph_quota_metadata WHERE key = 'ledger_version'"
        ).fetchone()
        if version is None or str(version[0]) != GRAPH_QUOTA_LEDGER_VERSION:
            return False
        policy = connection.execute(
            "SELECT value FROM graph_quota_metadata WHERE key = 'quota_policy'"
        ).fetchone()
        if policy is None or str(policy[0]) != cls._quota_policy_identity():
            return False
        source_rows = int(connection.execute(
            "SELECT (SELECT COUNT(*) FROM nodes) + (SELECT COUNT(*) FROM edges)"
        ).fetchone()[0])
        ledger_rows = int(connection.execute(
            "SELECT COUNT(*) FROM graph_quota_ledger"
        ).fetchone()[0])
        if source_rows != ledger_rows:
            return False
        missing = connection.execute(
            """
            SELECT 1
            FROM (
                SELECT n.id
                FROM nodes AS n
                LEFT JOIN graph_quota_ledger AS q
                  ON q.object_kind = 'node' AND q.object_id = n.id
                WHERE q.object_id IS NULL
                UNION ALL
                SELECT e.id
                FROM edges AS e
                LEFT JOIN graph_quota_ledger AS q
                  ON q.object_kind = 'edge' AND q.object_id = e.id
                WHERE q.object_id IS NULL
            )
            LIMIT 1
            """
        ).fetchone()
        if missing is not None:
            return False
        orphan = connection.execute(
            """
            SELECT 1
            FROM graph_quota_ledger AS q
            LEFT JOIN nodes AS n
              ON q.object_kind = 'node' AND n.id = q.object_id
            LEFT JOIN edges AS e
              ON q.object_kind = 'edge' AND e.id = q.object_id
            WHERE (q.object_kind = 'node' AND n.id IS NULL)
               OR (q.object_kind = 'edge' AND e.id IS NULL)
            LIMIT 1
            """
        ).fetchone()
        return orphan is None

    @classmethod
    def _admit_quota_records(cls, connection: sqlite3.Connection, records) -> None:
        projected = {
            (record[0], record[1]): record
            for record in records
        }
        if not projected:
            return
        existing = {}
        for key in projected:
            row = connection.execute(
                """
                SELECT object_kind, object_id, tenant_id, storage_workspace_id, record_bytes
                FROM graph_quota_ledger
                WHERE object_kind = ? AND object_id = ?
                """,
                key,
            ).fetchone()
            if row is not None:
                existing[key] = tuple(row)

        global_row_delta = 0
        global_byte_delta = 0
        principal_deltas: Dict[tuple[str, str], List[int]] = {}
        tenant_deltas: Dict[str, List[int]] = {}

        def apply_delta(record, row_delta: int, byte_delta: int) -> None:
            tenant_id = str(record[2])
            workspace_id = str(record[3])
            if not tenant_id and not workspace_id:
                return
            scope = (tenant_id, workspace_id)
            principal_delta = principal_deltas.setdefault(scope, [0, 0])
            principal_delta[0] += row_delta
            principal_delta[1] += byte_delta
            tenant_delta = tenant_deltas.setdefault(tenant_id, [0, 0])
            tenant_delta[0] += row_delta
            tenant_delta[1] += byte_delta

        for key, record in projected.items():
            previous = existing.get(key)
            if previous is None:
                global_row_delta += 1
                global_byte_delta += int(record[4])
                apply_delta(record, 1, int(record[4]))
                continue
            global_byte_delta += int(record[4]) - int(previous[4])
            if (previous[2], previous[3]) == (record[2], record[3]):
                apply_delta(record, 0, int(record[4]) - int(previous[4]))
            else:
                apply_delta(previous, -1, -int(previous[4]))
                apply_delta(record, 1, int(record[4]))

        global_rows, global_bytes = connection.execute(
            "SELECT COUNT(*), COALESCE(SUM(record_bytes), 0) FROM graph_quota_ledger"
        ).fetchone()
        principal_usage: Dict[tuple[str, str], tuple[int, int]] = {}
        for scope, delta in principal_deltas.items():
            current = connection.execute(
                """
                SELECT COUNT(*), COALESCE(SUM(record_bytes), 0)
                FROM graph_quota_ledger
                WHERE tenant_id = ? AND storage_workspace_id = ?
                """,
                scope,
            ).fetchone()
            principal_usage[scope] = (
                int(current[0]) + delta[0],
                int(current[1]) + delta[1],
            )
        tenant_usage: Dict[str, tuple[int, int]] = {}
        for tenant_id, delta in tenant_deltas.items():
            current = connection.execute(
                """
                SELECT COUNT(*), COALESCE(SUM(record_bytes), 0)
                FROM graph_quota_ledger WHERE tenant_id = ?
                """,
                (tenant_id,),
            ).fetchone()
            tenant_usage[tenant_id] = (
                int(current[0]) + delta[0],
                int(current[1]) + delta[1],
            )
        cls._assert_quota_limits(
            global_rows=int(global_rows) + global_row_delta,
            global_bytes=int(global_bytes) + global_byte_delta,
            principal_usage=principal_usage,
            tenant_usage=tenant_usage,
        )
        connection.executemany(
            """
            INSERT INTO graph_quota_ledger
                (object_kind, object_id, tenant_id, storage_workspace_id, record_bytes)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(object_kind, object_id) DO UPDATE SET
                tenant_id=excluded.tenant_id,
                storage_workspace_id=excluded.storage_workspace_id,
                record_bytes=excluded.record_bytes
            """,
            projected.values(),
        )

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
                node_values = [self._node_values(node) for node in nodes]
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
                    node_values,
                )
                hook = getattr(self, "_batch_transaction_hook", None)
                if hook is not None:
                    hook()
                if expired():
                    raise TimeoutError("graph commit deadline exceeded")
                self._assert_scope_ownership(connection, "edges", edges)
                self._assert_edge_endpoints(connection, edges)
                edge_values = [self._edge_values(edge) for edge in edges]
                connection.executemany(
                    """INSERT INTO edges (id,type,source_id,target_id,weight,context,metadata,tenant_id,storage_workspace_id)
                       VALUES (?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET
                         type=excluded.type, source_id=excluded.source_id, target_id=excluded.target_id,
                         weight=excluded.weight, context=excluded.context, metadata=excluded.metadata
                       WHERE COALESCE(edges.tenant_id, '') = COALESCE(excluded.tenant_id, '')
                         AND COALESCE(edges.storage_workspace_id, '') = COALESCE(excluded.storage_workspace_id, '')""",
                    edge_values,
                )
                if expired():
                    raise TimeoutError("graph commit deadline exceeded")
                quota_records = []
                for kind, values_rows in (
                    ("node", node_values),
                    ("edge", edge_values),
                ):
                    for values in values_rows:
                        if expired():
                            raise TimeoutError("graph commit deadline exceeded")
                        quota_records.append(self._quota_record(kind, values))
                self._admit_quota_records(
                    connection,
                    quota_records,
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
        connection = getattr(self._local, "conn", None)
        if connection is not None:
            metadata = os.lstat(self.db_path)
            if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
                raise RuntimeError("Cortex graph database must be a regular non-symlink file")
            identity = (metadata.st_dev, metadata.st_ino)
            if self._lifecycle_lock_fd is not None:
                self._refresh_lifecycle_lock(metadata)
            if identity != getattr(self._local, "db_identity", None):
                if connection.in_transaction:
                    raise RuntimeError(
                        "Cortex graph database changed during an active transaction"
                    )
                connection.close()
                self._local.conn = None
                connection = None
        if connection is None:
            self._local.conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._local.conn.row_factory = sqlite3.Row
            self._local.conn.execute("PRAGMA foreign_keys = ON")
            self._local.conn.execute("PRAGMA busy_timeout = 10000")
            if not self._local.conn.execute("PRAGMA foreign_keys").fetchone()[0]:
                self._local.conn.close()
                self._local.conn = None
                raise RuntimeError("SQLite foreign-key enforcement is unavailable")
            metadata = os.lstat(self.db_path)
            if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
                self._local.conn.close()
                self._local.conn = None
                raise RuntimeError("Cortex graph database must be a regular non-symlink file")
            if self._lifecycle_lock_fd is not None:
                self._refresh_lifecycle_lock(metadata)
            self._local.db_identity = (metadata.st_dev, metadata.st_ino)
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

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS graph_quota_ledger (
                object_kind TEXT NOT NULL CHECK(object_kind IN ('node', 'edge')),
                object_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                storage_workspace_id TEXT NOT NULL,
                record_bytes INTEGER NOT NULL CHECK(record_bytes >= 0),
                PRIMARY KEY(object_kind, object_id)
            )
        """)
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_graph_quota_scope ON graph_quota_ledger(tenant_id, storage_workspace_id)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_graph_quota_tenant ON graph_quota_ledger(tenant_id)"
        )
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS graph_quota_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)

        conn.commit()
        if not self._quota_ledger_complete(conn):
            try:
                conn.execute("BEGIN IMMEDIATE")
                # Another process may have completed the one-time migration
                # while this instance waited for the write lock.
                if not self._quota_ledger_complete(conn):
                    self._reconcile_quota_ledger(conn)
                conn.commit()
            except Exception:
                conn.rollback()
                raise
    
    def insert_node(self, node: Node) -> None:
        """Insert or update a node."""
        conn = self._get_conn()
        cursor = conn.cursor()
        values = self._node_values(node)
        try:
            conn.execute("BEGIN IMMEDIATE")
            self._assert_scope_ownership(conn, "nodes", [node])
            self._admit_quota_records(conn, [self._quota_record("node", values)])
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
            """, values)
            if cursor.rowcount == 0:
                raise PermissionError("graph node id is already owned by another scope")
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    
    def insert_edge(self, edge: Edge) -> None:
        """Insert or update an edge."""
        conn = self._get_conn()
        cursor = conn.cursor()
        values = self._edge_values(edge)
        try:
            conn.execute("BEGIN IMMEDIATE")
            self._assert_scope_ownership(conn, "edges", [edge])
            self._assert_edge_endpoints(conn, [edge])
            self._admit_quota_records(conn, [self._quota_record("edge", values)])
            cursor.execute("""
                INSERT INTO edges
                (id, type, source_id, target_id, weight, context, metadata, tenant_id, storage_workspace_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    type=excluded.type, source_id=excluded.source_id, target_id=excluded.target_id,
                    weight=excluded.weight, context=excluded.context, metadata=excluded.metadata
                WHERE COALESCE(edges.tenant_id, '') = COALESCE(excluded.tenant_id, '')
                  AND COALESCE(edges.storage_workspace_id, '') = COALESCE(excluded.storage_workspace_id, '')
            """, values)
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
            conn.execute("BEGIN IMMEDIATE")
            self._assert_scope_ownership(conn, "nodes", nodes)
            values = [self._node_values(node) for node in nodes]
            self._admit_quota_records(
                conn,
                [self._quota_record("node", row) for row in values],
            )
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
            """, values)
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
            conn.execute("BEGIN IMMEDIATE")
            self._assert_scope_ownership(conn, "edges", edges)
            self._assert_edge_endpoints(conn, edges)
            values = [self._edge_values(edge) for edge in edges]
            self._admit_quota_records(
                conn,
                [self._quota_record("edge", row) for row in values],
            )
            cursor.executemany("""
                INSERT INTO edges
                (id, type, source_id, target_id, weight, context, metadata, tenant_id, storage_workspace_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    type=excluded.type, source_id=excluded.source_id, target_id=excluded.target_id,
                    weight=excluded.weight, context=excluded.context, metadata=excluded.metadata
                WHERE COALESCE(edges.tenant_id, '') = COALESCE(excluded.tenant_id, '')
                  AND COALESCE(edges.storage_workspace_id, '') = COALESCE(excluded.storage_workspace_id, '')
            """, values)
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

    def quota_status(self, *, top_scopes: int = 10) -> Dict[str, Any]:
        """Return bounded quota usage without exposing principal identifiers."""
        conn = self._get_conn()
        global_rows, global_bytes = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(record_bytes), 0) FROM graph_quota_ledger"
        ).fetchone()
        source_rows = int(conn.execute(
            "SELECT (SELECT COUNT(*) FROM nodes) + (SELECT COUNT(*) FROM edges)"
        ).fetchone()[0])
        unscoped_rows, unscoped_bytes = conn.execute(
            """
            SELECT COUNT(*), COALESCE(SUM(record_bytes), 0)
            FROM graph_quota_ledger
            WHERE tenant_id = '' AND storage_workspace_id = ''
            """
        ).fetchone()
        principal_rows = conn.execute(
            """
            SELECT COUNT(*), COALESCE(SUM(record_bytes), 0)
            FROM graph_quota_ledger
            WHERE tenant_id <> '' AND storage_workspace_id <> ''
            GROUP BY tenant_id, storage_workspace_id
            ORDER BY COUNT(*) DESC, SUM(record_bytes) DESC
            LIMIT ?
            """,
            (max(1, min(100, int(top_scopes))),),
        ).fetchall()
        tenant_rows = conn.execute(
            """
            SELECT COUNT(*), COALESCE(SUM(record_bytes), 0)
            FROM graph_quota_ledger
            WHERE tenant_id <> ''
            GROUP BY tenant_id
            ORDER BY COUNT(*) DESC, SUM(record_bytes) DESC
            LIMIT ?
            """,
            (max(1, min(100, int(top_scopes))),),
        ).fetchall()
        operational_rows = MAX_GRAPH_ROWS - GRAPH_RECOVERY_RESERVE_ROWS
        operational_bytes = MAX_GRAPH_BYTES - GRAPH_RECOVERY_RESERVE_BYTES

        def usage(rows: int, size: int, row_limit: int, byte_limit: int) -> Dict[str, Any]:
            return {
                "rows": int(rows),
                "bytes": int(size),
                "rowLimit": int(row_limit),
                "byteLimit": int(byte_limit),
                "rowHeadroom": max(0, int(row_limit) - int(rows)),
                "byteHeadroom": max(0, int(byte_limit) - int(size)),
                "rowUsagePercent": round((int(rows) / row_limit) * 100, 3) if row_limit else 100.0,
                "byteUsagePercent": round((int(size) / byte_limit) * 100, 3) if byte_limit else 100.0,
            }

        return {
            "status": "green" if self._quota_ledger_complete(conn) else "degraded",
            "ledgerVersion": GRAPH_QUOTA_LEDGER_VERSION,
            "ledgerComplete": self._quota_ledger_complete(conn),
            "sourceRows": source_rows,
            "global": usage(global_rows, global_bytes, operational_rows, operational_bytes),
            "legacyUnscoped": {
                "rows": int(unscoped_rows),
                "bytes": int(unscoped_bytes),
                "classification": "global_only",
            },
            "topPrincipalScopes": [
                usage(rows, size, MAX_GRAPH_PRINCIPAL_ROWS, MAX_GRAPH_PRINCIPAL_BYTES)
                for rows, size in principal_rows
            ],
            "topTenants": [
                usage(rows, size, MAX_GRAPH_TENANT_ROWS, MAX_GRAPH_TENANT_BYTES)
                for rows, size in tenant_rows
            ],
            "recoveryReserve": {
                "rows": GRAPH_RECOVERY_RESERVE_ROWS,
                "bytes": GRAPH_RECOVERY_RESERVE_BYTES,
            },
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
        
        try:
            conn.execute("BEGIN IMMEDIATE")
            edge_ids = [
                str(row[0])
                for row in cursor.execute(
                    "SELECT id FROM edges WHERE source_id = ? OR target_id = ?",
                    (node_id, node_id),
                ).fetchall()
            ]
            cursor.execute("DELETE FROM edges WHERE source_id = ? OR target_id = ?", (node_id, node_id))
            if edge_ids:
                cursor.executemany(
                    "DELETE FROM graph_quota_ledger WHERE object_kind = 'edge' AND object_id = ?",
                    [(edge_id,) for edge_id in edge_ids],
                )
            cursor.execute("DELETE FROM nodes WHERE id = ?", (node_id,))
            deleted = cursor.rowcount > 0
            if deleted:
                cursor.execute(
                    "DELETE FROM graph_quota_ledger WHERE object_kind = 'node' AND object_id = ?",
                    (node_id,),
                )
            conn.commit()
            return deleted
        except Exception:
            conn.rollback()
            raise
    
    def delete_edge(self, edge_id: str) -> bool:
        """Delete an edge."""
        conn = self._get_conn()
        cursor = conn.cursor()
        try:
            conn.execute("BEGIN IMMEDIATE")
            cursor.execute("DELETE FROM edges WHERE id = ?", (edge_id,))
            deleted = cursor.rowcount > 0
            if deleted:
                cursor.execute(
                    "DELETE FROM graph_quota_ledger WHERE object_kind = 'edge' AND object_id = ?",
                    (edge_id,),
                )
            conn.commit()
            return deleted
        except Exception:
            conn.rollback()
            raise
    
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
