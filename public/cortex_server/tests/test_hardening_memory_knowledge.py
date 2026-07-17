import copy
import fcntl
import json
import multiprocessing
import os
import sqlite3
import threading
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

# Router import constructs its persistence client, so keep collection-time state
# inside the writable test sandbox rather than touching an operator database.
os.environ["CORTEX_CHROMA_DIR"] = "/tmp/cortex-c05-hardening-chroma"
os.environ["LIBRARIAN_FALLBACK_LOG_PATH"] = "/tmp/cortex-c05-hardening-chroma/fallback.jsonl"

from cortex_server.knowledge.graph import Edge, EdgeType, Node, NodeType, SQLiteStorage
from cortex_server.modules.memory_scope import AuthenticatedMemoryPrincipal, memory_scope_signature
from cortex_server.modules.prior_art_gate import build_prior_art_gate
from cortex_server.routers import knowledge, librarian
from cortex_server.services.knowledge_service import KnowledgeService


def _node(node_id):
    return Node(id=node_id, type=NodeType.FUNCTION, name=node_id)


def _edge(edge_id, source, target):
    return Edge(id=edge_id, type=EdgeType.CALLS, source_id=source, target_id=target)


class FakeCollection:
    """Small Chroma-shaped fake with atomic method calls and injectable failures."""

    def __init__(self):
        self.rows = {}
        self.lock = threading.RLock()
        self.fail_update = False
        self.fail_delete = False

    def add(self, ids, documents, metadatas):
        with self.lock:
            for row_id, document, metadata in zip(ids, documents, metadatas):
                self.rows[row_id] = {"document": document, "metadata": copy.deepcopy(metadata)}

    def get(self, ids=None, where=None, include=None, **_kwargs):
        with self.lock:
            selected = list(self.rows)
            if ids is not None:
                selected = [row_id for row_id in ids if row_id in self.rows]
            if where:
                selected = [
                    row_id for row_id in selected
                    if all(self.rows[row_id]["metadata"].get(key) == value for key, value in where.items())
                ]
            return {
                "ids": selected,
                "documents": [self.rows[row_id]["document"] for row_id in selected],
                "metadatas": [copy.deepcopy(self.rows[row_id]["metadata"]) for row_id in selected],
            }

    def update(self, ids, metadatas):
        with self.lock:
            if self.fail_update:
                raise RuntimeError("update unavailable")
            for row_id, metadata in zip(ids, metadatas):
                self.rows[row_id]["metadata"] = copy.deepcopy(metadata)

    def delete(self, ids):
        with self.lock:
            if self.fail_delete:
                raise RuntimeError("delete unavailable")
            for row_id in ids:
                self.rows.pop(row_id, None)


class SharedFakeCollection:
    """File-backed process-shared Chroma fake with atomic individual calls."""

    def __init__(self, path):
        self.path = path
        self.lock_path = path.with_suffix(".lock")
        self.path.write_text("{}", encoding="utf-8")

    def _locked_rows(self, mutate=None):
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        with self.lock_path.open("a+b") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            try:
                rows = json.loads(self.path.read_text(encoding="utf-8"))
                if mutate is not None:
                    mutate(rows)
                    self.path.write_text(json.dumps(rows, sort_keys=True), encoding="utf-8")
                return rows
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    @property
    def rows(self):
        return self._locked_rows()

    def add(self, ids, documents, metadatas):
        def mutate(rows):
            for row_id, document, metadata in zip(ids, documents, metadatas):
                rows[row_id] = {"document": document, "metadata": copy.deepcopy(metadata)}
        self._locked_rows(mutate)

    def get(self, ids=None, where=None, include=None, **_kwargs):
        rows = self._locked_rows()
        selected = list(rows)
        if ids is not None:
            selected = [row_id for row_id in ids if row_id in rows]
        if where:
            selected = [
                row_id for row_id in selected
                if all(rows[row_id]["metadata"].get(key) == value for key, value in where.items())
            ]
        return {
            "ids": selected,
            "documents": [rows[row_id]["document"] for row_id in selected],
            "metadatas": [copy.deepcopy(rows[row_id]["metadata"]) for row_id in selected],
        }

    def update(self, ids, metadatas):
        def mutate(rows):
            for row_id, metadata in zip(ids, metadatas):
                row = dict(rows[row_id])
                row["metadata"] = copy.deepcopy(metadata)
                rows[row_id] = row
        self._locked_rows(mutate)

    def delete(self, ids):
        def mutate(rows):
            for row_id in ids:
                rows.pop(row_id, None)
        self._locked_rows(mutate)


def _write_shared_fact(start_fd, row_id):
    os.read(start_fd, 1)
    try:
        librarian._add_memory_with_supersession(row_id, row_id, {"fact_key": "same"})
    finally:
        os.close(start_fd)


@pytest.fixture(autouse=True)
def isolated_fact_supersession_journal(tmp_path, monkeypatch):
    monkeypatch.setenv("CORTEX_FACT_SUPERSESSION_JOURNAL_DIR", str(tmp_path / "fact-journal"))


@pytest.mark.parametrize("memory_ok,structural_ok", [(False, True), (True, False), (False, False)])
def test_prior_art_gate_fails_closed_when_either_recall_plane_is_unavailable(memory_ok, structural_ok):
    gate = build_prior_art_gate(
        objective="Create a novel memory primitive",
        proposed_action="new_primitive",
        memory_available=memory_ok,
        structural_available=structural_ok,
    )
    assert gate["ok"] is False
    assert gate["status"] == "blocked"
    assert "required_recall_plane_unavailable" in gate["failures"]
    assert set(gate["blocker"]["unavailablePlanes"]) == {
        name for name, available in (("memory", memory_ok), ("structural", structural_ok)) if not available
    }


@pytest.mark.parametrize(
    ("objective", "capabilities", "paths"),
    [
        ("", [], []),
        ("   \t\n", [" ", "\t"], ["  "]),
    ],
)
def test_prior_art_gate_fails_closed_without_nonblank_search_terms(objective, capabilities, paths):
    gate = build_prior_art_gate(
        objective=objective,
        planned_capabilities=capabilities,
        planned_paths=paths,
        proposed_action="new_primitive",
    )
    assert gate["ok"] is False
    assert gate["terms"] == []
    assert gate["sourceCoverage"]["memoryAvailable"] is False
    assert gate["sourceCoverage"]["structuralAvailable"] is False
    assert set(gate["blocker"]["unavailablePlanes"]) == {"memory", "structural"}


@pytest.mark.asyncio
async def test_prior_art_gate_partial_query_success_keeps_unqueried_plane_unavailable(monkeypatch):
    monkeypatch.setattr(
        knowledge,
        "robust_search",
        lambda **_kwargs: {"search_mode": "semantic", "results": [], "available": True},
    )

    class FailingGraph:
        def query(self, **_kwargs):
            raise RuntimeError("structural recall unavailable")

    monkeypatch.setattr(knowledge.service, "graph", FailingGraph())
    response = await knowledge.prior_art_gate(knowledge.PriorArtGateRequest(objective="build capability ledger"))
    assert response["success"] is False
    assert response["sourceCoverage"]["memoryAvailable"] is True
    assert response["sourceCoverage"]["structuralAvailable"] is False
    assert response["blocker"]["unavailablePlanes"] == ["structural"]


@pytest.mark.asyncio
async def test_prior_art_gate_rejects_degraded_search_without_a_successful_memory_backend(monkeypatch):
    monkeypatch.setattr(
        knowledge,
        "robust_search",
        lambda **_kwargs: {
            "search_mode": "lexical_fallback",
            "degraded": True,
            "results": [],
            "available": False,
        },
    )

    class AvailableGraph:
        def query(self, **_kwargs):
            return []

    monkeypatch.setattr(knowledge.service, "graph", AvailableGraph())
    response = await knowledge.prior_art_gate(knowledge.PriorArtGateRequest(objective="build capability ledger"))
    assert response["success"] is False
    assert response["sourceCoverage"]["memoryAvailable"] is False
    assert response["sourceCoverage"]["structuralAvailable"] is True
    assert response["blocker"]["unavailablePlanes"] == ["memory"]


@pytest.mark.asyncio
async def test_prior_art_gate_scopes_semantic_recall_to_signed_principal(monkeypatch):
    scope = {
        "tenant_id": "tenant-prior-art",
        "workspace_id": "workspace-prior-art",
        "agent_id": "agent-prior-art",
        "user_id": "user-prior-art",
        "channel_id": "api",
        "session_id": "session-prior-art",
    }
    credential_id = "prior-art-reader"
    secret = "prior-art-secret"
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps(
            {
                credential_id: {
                    "secret": secret,
                    "allowed_scopes": [scope],
                }
            }
        ),
    )
    calls = []

    def scoped_search(**kwargs):
        calls.append(kwargs)
        return {"search_mode": "semantic", "results": [], "available": True}

    class AvailableGraph:
        def query(self, **_kwargs):
            return []

    monkeypatch.setattr(knowledge, "robust_search", scoped_search)
    monkeypatch.setattr(knowledge.service, "graph", AvailableGraph())
    response = await knowledge.prior_art_gate(
        knowledge.PriorArtGateRequest(
            objective="reuse an existing capability ledger",
            tenant_id=scope["tenant_id"],
            workspace_id=scope["workspace_id"],
            scope=scope,
            scope_credential_id=credential_id,
            scope_signature=memory_scope_signature(
                **scope,
                credential_id=credential_id,
                secret=secret,
            ),
        )
    )

    expected_workspace = AuthenticatedMemoryPrincipal(
        credential_id=credential_id,
        **scope,
    ).storage_workspace_id
    assert response["sourceCoverage"]["memoryAvailable"] is True
    assert calls
    assert {call["tenant_id"] for call in calls} == {scope["tenant_id"]}
    assert {call["workspace_id"] for call in calls} == {expected_workspace}


@pytest.mark.asyncio
async def test_prior_art_gate_rejects_trusted_caller_without_principal_scope(monkeypatch):
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps(
            {
                "reader": {
                    "secret": "secret",
                    "allowed_scopes": [
                        {
                            "tenant_id": "tenant",
                            "workspace_id": "workspace",
                            "agent_id": "agent",
                            "user_id": "user",
                            "channel_id": "api",
                            "session_id": "session",
                        }
                    ],
                }
            }
        ),
    )
    called = False

    def forbidden_search(**_kwargs):
        nonlocal called
        called = True
        raise AssertionError("semantic memory must not be queried before authentication")

    monkeypatch.setattr(knowledge, "robust_search", forbidden_search)
    with pytest.raises(HTTPException) as exc_info:
        await knowledge.prior_art_gate(
            knowledge.PriorArtGateRequest(objective="read legacy durable memory")
        )

    assert exc_info.value.status_code == 403
    assert called is False


def test_every_sqlite_connection_enforces_foreign_keys_and_rejects_dangling_edge(tmp_path):
    storage = SQLiteStorage(str(tmp_path / "graph.db"))
    assert storage._get_conn().execute("PRAGMA foreign_keys").fetchone()[0] == 1
    storage._local.conn.close()
    storage._local.conn = None
    assert storage._get_conn().execute("PRAGMA foreign_keys").fetchone()[0] == 1
    with pytest.raises(sqlite3.IntegrityError):
        storage.insert_edge(_edge("dangling", "missing-a", "missing-b"))


def test_structural_graph_scope_is_immutable_and_filters_legacy_rows(tmp_path):
    storage = SQLiteStorage(str(tmp_path / "graph.db"))
    tenant_a = _node("tenant-a")
    tenant_a.tenant_id = "tenant-a"
    tenant_a.storage_workspace_id = "workspace-a"
    legacy = _node("legacy")
    storage.insert_nodes([tenant_a, legacy])

    assert [row.id for row in storage.query_nodes(tenant_id="tenant-a", storage_workspace_id="workspace-a")] == ["tenant-a"]
    assert storage.query_nodes(tenant_id="tenant-b", storage_workspace_id="workspace-b") == []

    stolen = _node("tenant-a")
    stolen.tenant_id = "tenant-b"
    stolen.storage_workspace_id = "workspace-b"
    with pytest.raises(PermissionError, match="owned by another scope"):
        storage.insert_node(stolen)
    assert storage.get_edge("dangling") is None


def test_batch_edge_insert_is_atomic_and_preserves_unrelated_data(tmp_path):
    storage = SQLiteStorage(str(tmp_path / "graph.db"))
    storage.insert_nodes([_node("a"), _node("b")])
    storage.insert_edge(_edge("existing", "a", "b"))
    with pytest.raises(sqlite3.IntegrityError):
        storage.insert_edges([_edge("would-work", "a", "b"), _edge("bad", "a", "absent")])
    assert storage.get_edge("would-work") is None
    assert storage.get_edge("bad") is None
    assert storage.get_edge("existing").target_id == "b"


def test_node_update_preserves_referencing_edges(tmp_path):
    storage = SQLiteStorage(str(tmp_path / "graph.db"))
    storage.insert_nodes([_node("a"), _node("b")])
    storage.insert_edge(_edge("a-to-b", "a", "b"))

    updated = _node("a").model_copy(update={"name": "updated-a", "metadata": {"version": 2}})
    storage.insert_node(updated)

    assert storage.get_node("a").name == "updated-a"
    assert storage.get_edge("a-to-b").source_id == "a"


def test_batch_node_updates_preserve_referencing_edges(tmp_path):
    storage = SQLiteStorage(str(tmp_path / "graph.db"))
    storage.insert_nodes([_node("a"), _node("b"), _node("c")])
    storage.insert_edges([_edge("a-to-b", "a", "b"), _edge("b-to-c", "b", "c")])

    storage.insert_nodes([
        _node("a").model_copy(update={"name": "updated-a"}),
        _node("b").model_copy(update={"name": "updated-b"}),
    ])

    assert storage.get_node("a").name == "updated-a"
    assert storage.get_node("b").name == "updated-b"
    assert storage.get_edge("a-to-b").target_id == "b"
    assert storage.get_edge("b-to-c").source_id == "b"


def test_default_database_path_is_absolute_and_independent_of_working_directory(tmp_path, monkeypatch):
    monkeypatch.delenv("CORTEX_DB_PATH", raising=False)
    monkeypatch.setattr(SQLiteStorage, "DEFAULT_DB_CANDIDATES", [str(tmp_path / "stable.db")])
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    monkeypatch.chdir(first)
    path_one = SQLiteStorage().db_path
    monkeypatch.chdir(second)
    path_two = SQLiteStorage().db_path
    assert os.path.isabs(path_one)
    assert path_one == path_two == str(tmp_path / "stable.db")


def test_configured_graph_seed_is_copied_to_durable_database_once(tmp_path, monkeypatch):
    from cortex_server.knowledge import graph as graph_module

    seed = tmp_path / "seed.db"
    target = tmp_path / "durable" / "knowledge" / "cortex_graph.db"
    with sqlite3.connect(seed) as connection:
        connection.execute("CREATE TABLE seed_marker (value TEXT NOT NULL)")
        connection.execute("INSERT INTO seed_marker(value) VALUES ('packaged-seed')")
    monkeypatch.setenv("CORTEX_DB_PATH", str(target))
    monkeypatch.setenv("CORTEX_DB_SEED_PATH", str(seed))
    durable_directories = []
    real_durable_mkdir = graph_module.durable_mkdir

    def record_durable_mkdir(path):
        durable_directories.append(Path(path))
        return real_durable_mkdir(path)

    monkeypatch.setattr(graph_module, "durable_mkdir", record_durable_mkdir)

    storage = SQLiteStorage()
    assert Path(storage.db_path) == target.resolve()
    assert storage._get_conn().execute("SELECT value FROM seed_marker").fetchone()[0] == "packaged-seed"
    assert target.parent in durable_directories

    with sqlite3.connect(target) as connection:
        connection.execute("UPDATE seed_marker SET value = 'durable-write'")
    SQLiteStorage()
    with sqlite3.connect(target) as connection:
        assert connection.execute("SELECT value FROM seed_marker").fetchone()[0] == "durable-write"


def test_production_graph_never_seeds_a_blank_replacement_volume(tmp_path, monkeypatch):
    seed = tmp_path / "seed.db"
    target = tmp_path / "replacement" / "cortex_graph.db"
    with sqlite3.connect(seed) as connection:
        connection.execute("CREATE TABLE seed_marker (value TEXT NOT NULL)")
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv("CORTEX_DB_PATH", str(target))
    monkeypatch.setenv("CORTEX_DB_SEED_PATH", str(seed))

    with pytest.raises(RuntimeError, match="explicit volume bootstrap or restore"):
        SQLiteStorage()
    assert not target.exists()


def test_production_knowledge_identity_binds_marker_database_and_mount_id(
    tmp_path, monkeypatch
):
    from cortex_server import main as cortex_main

    knowledge_root = tmp_path / "knowledge"
    knowledge_root.mkdir()
    database = knowledge_root / "cortex_graph.db"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE durable (value TEXT NOT NULL)")
    marker = knowledge_root / ".cortex-durable-knowledge"
    marker.write_text("knowledge-volume-identity\n", encoding="utf-8")
    monkeypatch.setenv("CORTEX_DB_PATH", str(database))
    monkeypatch.setenv("CORTEX_KNOWLEDGE_MOUNT_ID", "knowledge-volume-identity")

    assert cortex_main._knowledge_volume_identity_check(production=True)["ok"] is True
    marker.write_text("replacement-volume\n", encoding="utf-8")
    mismatch = cortex_main._knowledge_volume_identity_check(production=True)
    assert mismatch["ok"] is False
    assert "identity mismatch" in mismatch["error"]


def test_high_degree_neighbors_are_limited_in_sql_without_per_neighbor_loading(tmp_path):
    storage = SQLiteStorage(str(tmp_path / "graph.db"))
    storage.insert_nodes([_node("root"), *[_node(f"n{i}") for i in range(80)]])
    storage.insert_edges([_edge(f"e{i}", "root", f"n{i}") for i in range(80)])
    statements = []
    storage._get_conn().set_trace_callback(statements.append)
    neighbors = storage.get_neighbors("root", direction="out", limit=7)
    selects = [sql for sql in statements if sql.lstrip().upper().startswith("SELECT")]
    assert len(neighbors) == 7
    assert len(selects) == 1
    assert "LIMIT 7" in selects[0].upper()
    assert all(set(row) == {"edge", "node", "direction"} for row in neighbors)


@pytest.mark.asyncio
async def test_invalid_enum_filters_and_directions_are_rejected_before_graph_access():
    service = KnowledgeService.__new__(KnowledgeService)
    service.graph = type("UntouchedGraph", (), {"query": lambda *_a, **_k: pytest.fail("graph queried")})()
    request = type("Request", (), {"node_type": "NotAType", "query": "x", "limit": 2})()
    with pytest.raises(ValueError, match="invalid node_type"):
        await service.query(request)
    with pytest.raises(ValueError, match="invalid edge_type"):
        await service.get_neighbors("x", "NOT_AN_EDGE", "out", 2)
    with pytest.raises(ValueError, match="direction"):
        await service.get_neighbors("x", None, "sideways", 2)


@pytest.mark.parametrize(
    "model,kwargs",
    [
        (knowledge.KnowledgeSearchRequest, {"query": "x" * 16_385}),
        (knowledge.BoundedGraphQueryRequest, {"query": "x" * 16_385}),
        (knowledge.BoundedGraphQueryRequest, {"query": "x", "limit": 101}),
        (knowledge.BoundedGraphQueryRequest, {"query": "x", "limit": 0}),
        (knowledge.PriorArtGateRequest, {"objective": "x", "planned_paths": ["p"] * 101}),
        (knowledge.PriorArtGateRequest, {"objective": "x", "planned_capabilities": ["x" * 16_385]}),
        (knowledge.PriorArtGateRequest, {"objective": "x", "planned_paths": ["x" * 16_385]}),
        (knowledge.StructuralSearchRequest, {"query": "x" * 16_385}),
        (knowledge.ImpactRequest, {"query": "x" * 16_385}),
        (knowledge.ImpactRequest, {"node_id": "x" * 16_385}),
        (knowledge.ImpactRequest, {"query": "x", "limit": 51}),
        (librarian.RecallRequest, {"query": "x", "n_results": 101}),
        (librarian.SupersedeRequest, {"memory_ids": [str(i) for i in range(501)]}),
    ],
)
def test_router_models_reject_oversized_payloads_and_work_factors(model, kwargs):
    with pytest.raises(ValidationError):
        model(**kwargs)


@pytest.mark.parametrize(
    "model,kwargs",
    [
        (knowledge.PriorArtGateRequest, {"objective": "x", "planned_capabilities": ["x" * 16_384]}),
        (knowledge.PriorArtGateRequest, {"objective": "x", "planned_paths": ["x" * 16_384]}),
        (knowledge.StructuralSearchRequest, {"query": "x" * 16_384}),
        (knowledge.ImpactRequest, {"query": "x" * 16_384}),
        (knowledge.ImpactRequest, {"node_id": "x" * 16_384}),
    ],
)
def test_router_models_accept_string_fields_at_size_limit(model, kwargs):
    assert model(**kwargs)


@pytest.mark.asyncio
async def test_legacy_query_preserves_bounded_defaults_and_forwards_valid_requests(monkeypatch):
    observed = []

    async def fake_query(request, *, tenant_id, storage_workspace_id):
        observed.append((request, tenant_id, storage_workspace_id))
        return {"nodes": [], "count": 0}

    monkeypatch.setattr(knowledge.service, "query", fake_query)
    request = knowledge.BoundedGraphQueryRequest(query="needle")
    response = await knowledge.query_graph(request)

    assert request.limit == 100
    assert observed == [(request, "cortex-local", "default")]
    assert response == {"success": True, "data": {"nodes": [], "count": 0}, "error": None}


@pytest.mark.asyncio
async def test_structural_search_invalid_node_type_preserves_http_422(monkeypatch):
    class UntouchedGraph:
        def query(self, **_kwargs):
            pytest.fail("graph queried")

    monkeypatch.setattr(knowledge.service, "graph", UntouchedGraph())
    request = knowledge.StructuralSearchRequest(query="needle", node_type="NotAType")

    with pytest.raises(HTTPException) as exc_info:
        await knowledge.structural_search(request)

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "invalid node_type"


def test_failed_fact_supersession_removes_pending_version_and_restores_prior(monkeypatch):
    fake = FakeCollection()
    fake.add(["old"], ["old fact"], [{"fact_key": "color", "memory_status": "active", "marker": "keep"}])
    monkeypatch.setattr(librarian, "collection", fake)
    original_update = fake.update
    calls = 0

    def fail_activation(ids, metadatas):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("activation failed")
        return original_update(ids, metadatas)

    monkeypatch.setattr(fake, "update", fail_activation)
    with pytest.raises(librarian.FactSupersessionError, match="new version was removed"):
        librarian._add_memory_with_supersession("new", "new fact", {"fact_key": "color"})
    assert set(fake.rows) == {"old"}
    assert fake.rows["old"]["metadata"] == {"fact_key": "color", "memory_status": "active", "marker": "keep"}


def test_compensation_failure_is_reported_without_exposing_new_active_version(monkeypatch):
    fake = FakeCollection()
    fake.add(["old"], ["old"], [{"fact_key": "key", "memory_status": "active"}])
    fake.fail_update = True
    fake.fail_delete = True
    monkeypatch.setattr(librarian, "collection", fake)
    with pytest.raises(librarian.FactSupersessionError, match="compensation failed"):
        librarian._add_memory_with_supersession("new", "new", {"fact_key": "key"})
    assert fake.rows["new"]["metadata"]["memory_status"] == "tombstoned"
    assert fake.rows["new"]["metadata"]["supersession_pending"] is True
    assert fake.rows["old"]["metadata"]["memory_status"] == "active"


def test_crash_after_prior_supersession_is_rolled_forward_before_recall(monkeypatch):
    class SimulatedProcessCrash(BaseException):
        pass

    fake = FakeCollection()
    fake.add(["old"], ["the color was blue"], [{"fact_key": "color", "memory_status": "active"}])
    monkeypatch.setattr(librarian, "collection", fake)
    original_update = fake.update
    calls = 0

    def crash_during_activation(ids, metadatas):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise SimulatedProcessCrash()
        return original_update(ids, metadatas)

    monkeypatch.setattr(fake, "update", crash_during_activation)
    with pytest.raises(SimulatedProcessCrash):
        librarian._add_memory_with_supersession(
            "new",
            "the color is durable green",
            {"fact_key": "color", "memory_status": "active"},
        )

    assert fake.rows["old"]["metadata"]["memory_status"] == "superseded"
    assert fake.rows["new"]["metadata"]["memory_status"] == "tombstoned"
    monkeypatch.setattr(fake, "update", original_update)

    recalled = librarian.robust_search("durable green", n_results=1)

    assert recalled["results"][0]["id"] == "new"
    assert fake.rows["new"]["metadata"]["memory_status"] == "active"
    assert fake.rows["old"]["metadata"]["superseded_by"] == "new"
    assert list(librarian._fact_supersession_journal_dir().glob("*.json")) == []


def test_journal_persistence_failure_leaves_existing_fact_untouched(monkeypatch):
    fake = FakeCollection()
    original = {"fact_key": "key", "memory_status": "active", "marker": "preserve"}
    fake.add(["old"], ["old"], [original])
    monkeypatch.setattr(librarian, "collection", fake)

    def fail_journal(_entry):
        raise OSError("journal disk unavailable")

    monkeypatch.setattr(librarian, "_write_fact_supersession_journal", fail_journal)
    with pytest.raises(librarian.FactSupersessionError, match="existing fact was preserved"):
        librarian._add_memory_with_supersession("new", "new", {"fact_key": "key"})

    assert set(fake.rows) == {"old"}
    assert fake.rows["old"]["metadata"] == original


@pytest.mark.asyncio
async def test_committed_embed_succeeds_when_journal_cleanup_fails_and_recovers(monkeypatch, caplog):
    fake = FakeCollection()
    fake.add(["old"], ["old"], [{"fact_key": "key", "memory_status": "active"}])
    monkeypatch.setattr(librarian, "collection", fake)
    remove_journal = librarian._remove_fact_supersession_journal

    def fail_cleanup(_journal_path):
        raise OSError("journal directory is temporarily read-only")

    monkeypatch.setattr(librarian, "_remove_fact_supersession_journal", fail_cleanup)
    with caplog.at_level("WARNING", logger=librarian.__name__):
        response = await librarian.embed_memory(
            librarian.EmbedRequest(text="new", metadata={"fact_key": "key"})
        )

    assert response.status == "stored"
    assert fake.rows[response.id]["metadata"]["memory_status"] == "active"
    assert fake.rows["old"]["metadata"]["memory_status"] == "superseded"
    journal_paths = list(librarian._fact_supersession_journal_dir().glob("*.json"))
    assert len(journal_paths) == 1
    assert "recovery journal cleanup remains pending" in caplog.text

    monkeypatch.setattr(librarian, "_remove_fact_supersession_journal", remove_journal)
    librarian._recover_fact_supersessions()

    assert fake.rows[response.id]["metadata"]["memory_status"] == "active"
    assert fake.rows["old"]["metadata"]["superseded_by"] == response.id
    assert list(librarian._fact_supersession_journal_dir().glob("*.json")) == []


def test_malformed_supersession_journal_fails_recall_closed(monkeypatch):
    journal_dir = librarian._fact_supersession_journal_dir()
    journal_dir.mkdir(parents=True)
    (journal_dir / "broken.json").write_text("{not-json", encoding="utf-8")

    class UntouchedCollection:
        def get(self, **_kwargs):
            pytest.fail("collection read before journal validation")

    monkeypatch.setattr(librarian, "collection", UntouchedCollection())
    with pytest.raises(librarian.FactSupersessionError, match="invalid fact supersession journal"):
        librarian.robust_search("current fact")


def test_concurrent_same_fact_writes_leave_exactly_one_active_version(monkeypatch):
    fake = FakeCollection()
    monkeypatch.setattr(librarian, "collection", fake)
    barrier = threading.Barrier(3)
    errors = []

    def write(row_id):
        try:
            barrier.wait()
            librarian._add_memory_with_supersession(row_id, row_id, {"fact_key": "same"})
        except Exception as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    threads = [threading.Thread(target=write, args=(row_id,)) for row_id in ("one", "two")]
    for thread in threads:
        thread.start()
    barrier.wait()
    for thread in threads:
        thread.join(timeout=2)
    assert not errors
    assert all(not thread.is_alive() for thread in threads)
    statuses = [row["metadata"]["memory_status"] for row in fake.rows.values()]
    assert statuses.count("active") == 1
    assert statuses.count("superseded") == 1
    active_id = next(row_id for row_id, row in fake.rows.items() if row["metadata"]["memory_status"] == "active")
    historical = next(row for row in fake.rows.values() if row["metadata"]["memory_status"] == "superseded")
    assert historical["metadata"]["superseded_by"] == active_id


def test_multiprocess_same_fact_writes_leave_exactly_one_active_version(tmp_path, monkeypatch):
    context = multiprocessing.get_context("fork")
    fake = SharedFakeCollection(tmp_path / "shared-collection.json")
    monkeypatch.setattr(librarian, "collection", fake)
    monkeypatch.setenv("CORTEX_FACT_SUPERSESSION_LOCK_PATH", str(tmp_path / "fact.lock"))
    start_fd, release_fd = os.pipe()
    processes = [context.Process(target=_write_shared_fact, args=(start_fd, row_id)) for row_id in ("one", "two")]
    for process in processes:
        process.start()
    os.close(start_fd)
    os.write(release_fd, b"xx")
    os.close(release_fd)
    for process in processes:
        process.join(timeout=5)
    assert all(not process.is_alive() for process in processes)
    assert [process.exitcode for process in processes] == [0, 0]
    rows = list(fake.rows.values())
    statuses = [row["metadata"]["memory_status"] for row in rows]
    assert statuses.count("active") == 1
    assert statuses.count("superseded") == 1


@pytest.mark.asyncio
async def test_memory_status_is_unavailable_when_persistence_backend_fails(monkeypatch):
    class DownCollection:
        def count(self):
            raise RuntimeError("backend down")

    monkeypatch.setattr(knowledge, "collection", DownCollection())
    result = await knowledge.knowledge_status()
    assert result["success"] is False
    assert result["status"] == "unavailable"
    assert result["memory_count"] is None
    assert result["canonical_endpoint"] == "/knowledge/status"


@pytest.mark.asyncio
async def test_knowledge_search_authenticates_and_forwards_memory_scope(monkeypatch):
    from cortex_server.modules.memory_scope import memory_scope_signature

    secret = "knowledge-scope-secret"
    scope = {
        "tenant_id": "tenant-a",
        "workspace_id": "workspace-a",
        "agent_id": "agent-a",
        "user_id": "user-a",
        "channel_id": "channel-a",
        "session_id": "session-a",
    }
    monkeypatch.setenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", json.dumps({
        "bridge-a": {"secret": secret, "allowed_scopes": [scope]},
    }))
    signature = memory_scope_signature(**scope, credential_id="bridge-a", secret=secret)
    calls = []

    def scoped_search(**kwargs):
        calls.append(kwargs)
        return {"results": [], "search_mode": "lexical_fallback", "degraded": True, "available": True}

    monkeypatch.setattr(knowledge, "robust_search", scoped_search)
    response = await knowledge.search_knowledge(knowledge.KnowledgeSearchRequest(
        query="scoped memory",
        tenant_id="tenant-a",
        workspace_id="workspace-a",
        scope=scope,
        scope_credential_id="bridge-a",
        scope_signature=signature,
    ))

    assert response["results"] == []
    assert calls[0]["tenant_id"] == "tenant-a"
    assert calls[0]["workspace_id"].startswith("principal-")

    with pytest.raises(HTTPException) as invalid:
        await knowledge.search_knowledge(knowledge.KnowledgeSearchRequest(
            query="wrong scope",
            tenant_id="tenant-b",
            workspace_id="workspace-a",
            scope=scope,
            scope_credential_id="bridge-a",
            scope_signature=signature,
        ))
    assert invalid.value.status_code == 403


def test_memory_write_models_bound_metadata_depth_bytes_and_tag_items():
    from pydantic import ValidationError
    from cortex_server.routers import librarian, l22

    too_deep = current = {}
    for _ in range(librarian.MAX_MEMORY_METADATA_DEPTH + 1):
        child = {}
        current["child"] = child
        current = child
    for model, kwargs in (
        (librarian.EmbedRequest, {"text": "x", "metadata": too_deep}),
        (librarian.NovelEmbedRequest, {"text": "x", "metadata": {"value": "x" * (librarian.MAX_MEMORY_METADATA_STRING + 1)}}),
        (l22.L22StoreRequest, {"content": "x", "metadata": too_deep}),
        (l22.L22NovelStoreRequest, {"content": "x", "novelty_tags": ["x" * 257]}),
    ):
        with pytest.raises(ValidationError):
            model(**kwargs)


def test_librarian_fact_supersession_and_recall_are_workspace_scoped(monkeypatch, tmp_path):
    class ScopeIgnoringCollection(FakeCollection):
        def query(self, **_kwargs):
            selected = list(self.rows)
            return {
                "ids": [selected],
                "documents": [[self.rows[row_id]["document"] for row_id in selected]],
                "distances": [[0.1 for _ in selected]],
                "metadatas": [[copy.deepcopy(self.rows[row_id]["metadata"]) for row_id in selected]],
            }

    fake = ScopeIgnoringCollection()
    monkeypatch.setattr(librarian, "collection", fake)
    monkeypatch.setattr(librarian, "_FALLBACK_LOG_PATH", tmp_path / "fallback.jsonl")
    scope_a = {"tenant_id": "tenant-a", "workspace_id": "workspace-a"}
    scope_b = {"tenant_id": "tenant-b", "workspace_id": "workspace-b"}

    librarian._add_memory_with_supersession(
        "a-old", "shared marker old A", {"fact_key": "shared-fact"}, **scope_a
    )
    librarian._add_memory_with_supersession(
        "b-current", "shared marker current B", {"fact_key": "shared-fact"}, **scope_b
    )
    librarian._add_memory_with_supersession(
        "a-current", "shared marker current A", {"fact_key": "shared-fact"}, **scope_a
    )

    assert fake.rows["a-old"]["metadata"]["memory_status"] == "superseded"
    assert fake.rows["a-current"]["metadata"]["memory_status"] == "active"
    assert fake.rows["b-current"]["metadata"]["memory_status"] == "active"
    recalled_a = librarian.robust_search("shared marker", n_results=5, **scope_a)
    recalled_b = librarian.robust_search("shared marker", n_results=5, **scope_b)
    assert {row["id"] for row in recalled_a["results"]} == {"a-current"}
    assert {row["id"] for row in recalled_b["results"]} == {"b-current"}


def test_fallback_rows_are_scoped_and_fact_corrections_hide_stale_versions(monkeypatch, tmp_path):
    monkeypatch.setattr(librarian, "_FALLBACK_LOG_PATH", tmp_path / "fallback.jsonl")
    scope_a = {"tenant_id": "tenant-a", "workspace_id": "workspace-a"}
    scope_b = {"tenant_id": "tenant-b", "workspace_id": "workspace-b"}
    meta_a = librarian._normalize_memory_metadata({"fact_key": "color"}, **scope_a)
    meta_b = librarian._normalize_memory_metadata({"fact_key": "color"}, **scope_b)

    librarian._persist_fallback_memory("a-old", "the color was blue", meta_a, reason="offline", mode="embed")
    librarian._persist_fallback_memory("b-current", "the color is red", meta_b, reason="offline", mode="embed")
    librarian._append_fallback_fact_supersession(
        "color", superseded_by="a-chroma", **scope_a
    )

    assert librarian._read_fallback_rows(limit=20, **scope_a) == []
    rows_b = librarian._read_fallback_rows(limit=20, **scope_b)
    assert [row["id"] for row in rows_b] == ["b-current"]


@pytest.mark.asyncio
async def test_embed_fails_when_primary_and_fallback_persistence_both_fail(monkeypatch):
    class DownCollection:
        def add(self, **_kwargs):
            raise RuntimeError("embedding unavailable")

    monkeypatch.setattr(librarian, "collection", DownCollection())
    monkeypatch.setattr(
        librarian,
        "_append_fallback_row",
        lambda _row: (_ for _ in ()).throw(librarian.FallbackPersistenceError("disk full")),
    )

    with pytest.raises(HTTPException) as exc_info:
        await librarian.embed_memory(librarian.EmbedRequest(text="must be durable"))
    assert exc_info.value.status_code == 503
    assert "persistence" in str(exc_info.value.detail)


def test_fallback_store_enforces_byte_and_record_retention(monkeypatch, tmp_path):
    fallback = tmp_path / "bounded.jsonl"
    monkeypatch.setattr(librarian, "_FALLBACK_LOG_PATH", fallback)
    monkeypatch.setattr(librarian, "_FALLBACK_MAX_BYTES", 1800)
    monkeypatch.setattr(librarian, "_FALLBACK_MAX_ROW_BYTES", 900)
    monkeypatch.setattr(librarian, "_FALLBACK_READ_MAX_BYTES", 1800)
    monkeypatch.setattr(librarian, "_FALLBACK_MAX_ROWS", 3)

    for index in range(8):
        librarian._persist_fallback_memory(
            f"row-{index}",
            f"bounded fallback row {index}",
            {},
            reason="offline",
            mode="embed",
        )

    rows = librarian._read_fallback_rows(limit=20)
    assert fallback.stat().st_size <= librarian._FALLBACK_MAX_BYTES
    assert len(rows) <= librarian._FALLBACK_MAX_ROWS
    assert rows[-1]["id"] == "row-7"


def test_nondefault_scope_does_not_scan_global_local_memory_roots(monkeypatch, tmp_path):
    global_root = tmp_path / "global-memory"
    global_root.mkdir()
    (global_root / "secret.md").write_text("tenant A secret", encoding="utf-8")
    monkeypatch.setenv(librarian._LOCAL_FILE_MEMORY_ROOTS_ENV, str(global_root))
    monkeypatch.delenv(librarian._SCOPED_LOCAL_FILE_MEMORY_ROOTS_ENV, raising=False)

    assert librarian._configured_local_file_memory_roots() == [global_root.resolve()]
    assert librarian._configured_local_file_memory_roots(
        tenant_id="tenant-b", workspace_id="workspace-b"
    ) == []


def test_external_memory_scope_requires_authenticated_signature(monkeypatch):
    from cortex_server.modules.memory_scope import memory_scope_signature

    monkeypatch.delenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", raising=False)
    monkeypatch.setenv("CORTEX_ENV", "production")
    with pytest.raises(HTTPException) as unconfigured:
        librarian._authenticated_memory_scope("tenant-a", "workspace-a", None)
    assert unconfigured.value.status_code == 503

    secret = "test-memory-scope-secret"
    scope = {
        "tenant_id": "tenant-a", "workspace_id": "workspace-a",
        "agent_id": "local-agent", "user_id": "local-user",
        "channel_id": "local-channel", "session_id": "local-session",
    }
    monkeypatch.setenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", json.dumps({
        "tenant-a-bridge": {"secret": secret, "allowed_scopes": [scope]},
    }))
    signature = memory_scope_signature(**scope, credential_id="tenant-a-bridge", secret=secret)
    principal = librarian._authenticated_memory_principal_scope(
        "tenant-a", "workspace-a", signature,
        scope=scope, scope_credential_id="tenant-a-bridge",
    )
    assert principal.tenant_id == "tenant-a"
    assert principal.storage_workspace_id.startswith("principal-")
    with pytest.raises(HTTPException) as invalid:
        librarian._authenticated_memory_principal_scope(
            "tenant-b", "workspace-a", signature,
            scope=scope, scope_credential_id="tenant-a-bridge",
        )
    assert invalid.value.status_code == 403


def test_production_memory_path_never_silently_falls_back_to_home(monkeypatch):
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.delenv("CORTEX_CHROMA_DIR", raising=False)
    with pytest.raises(RuntimeError, match="required"):
        librarian._default_chroma_dir()


def test_production_memory_path_verifies_durable_mount_identity(monkeypatch, tmp_path):
    durable = tmp_path / "durable-chroma"
    durable.mkdir()
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv("CORTEX_CHROMA_MOUNT_ID", "volume-123")

    with pytest.raises(RuntimeError, match="mount identity"):
        librarian._validate_chroma_storage(str(durable))
    (durable / ".cortex-durable-memory").write_text("volume-123\n", encoding="utf-8")
    with pytest.raises(RuntimeError, match="authority is missing"):
        librarian._validate_chroma_storage(str(durable))
    (durable / librarian.CHROMA_AUTHORITY_SENTINEL).write_text(
        librarian._chroma_authority_binding("volume-123") + "\n",
        encoding="utf-8",
    )
    with pytest.raises(RuntimeError, match="authority database is missing"):
        librarian._validate_chroma_storage(str(durable))
    (durable / librarian.CHROMA_DATABASE_NAME).write_bytes(b"published-chroma-authority")
    librarian._validate_chroma_storage(str(durable))


def test_production_memory_startup_never_creates_the_authoritative_collection(monkeypatch):
    calls = []

    class MissingAuthorityClient:
        def get_collection(self, **kwargs):
            calls.append(("get", kwargs["name"]))
            raise RuntimeError("collection does not exist")

        def get_or_create_collection(self, **kwargs):
            calls.append(("get_or_create", kwargs["name"]))
            raise AssertionError("production startup must not create memory authority")

    monkeypatch.setenv("CORTEX_ENV", "production")

    with pytest.raises(RuntimeError, match="does not exist"):
        librarian._load_memory_collection(MissingAuthorityClient(), object())

    assert calls == [("get", librarian.COLLECTION_NAME)]


def test_production_memory_readiness_fails_closed_after_authority_loss(monkeypatch, tmp_path):
    durable = tmp_path / "durable-chroma"
    durable.mkdir()
    mount_id = "volume-authority-readiness-123"
    (durable / ".cortex-durable-memory").write_text(mount_id + "\n", encoding="utf-8")
    (durable / librarian.CHROMA_AUTHORITY_SENTINEL).write_text(
        librarian._chroma_authority_binding(mount_id) + "\n",
        encoding="utf-8",
    )
    database = durable / librarian.CHROMA_DATABASE_NAME
    database.write_bytes(b"published-chroma-authority")
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv("CORTEX_CHROMA_MOUNT_ID", mount_id)
    monkeypatch.setattr(librarian, "CHROMA_DIR", str(durable))
    calls = []

    class AuthoritativeCollection:
        def count(self):
            return 0

    class ReadinessCollection:
        def __init__(self):
            self.probe_id = None

        def upsert(self, *, ids, **_kwargs):
            self.probe_id = ids[0]

        def get(self, *, ids):
            return {"ids": ids if ids == [self.probe_id] else []}

        def delete(self, *, ids):
            calls.append(("delete", ids[0]))

    readiness_collection = ReadinessCollection()

    class ExistingOnlyClient:
        def __init__(self):
            self.authority_available = True

        def get_collection(self, **kwargs):
            name = kwargs["name"]
            calls.append(("get", name))
            if name == librarian.COLLECTION_NAME:
                if not self.authority_available:
                    raise RuntimeError("authoritative collection does not exist")
                return AuthoritativeCollection()
            if name == librarian.READINESS_COLLECTION_NAME:
                return readiness_collection
            raise RuntimeError("unexpected collection")

        def get_or_create_collection(self, **kwargs):
            calls.append(("get_or_create", kwargs["name"]))
            raise AssertionError("production readiness must not create collections")

    existing_client = ExistingOnlyClient()
    monkeypatch.setattr(librarian, "client", existing_client)

    healthy = librarian.probe_memory_backend_readiness()

    assert healthy["ok"] is True
    assert healthy["count"] == 0
    assert [call for call in calls if call[0] == "get"] == [
        ("get", librarian.COLLECTION_NAME),
        ("get", librarian.READINESS_COLLECTION_NAME),
    ]
    assert not any(call[0] == "get_or_create" for call in calls)

    existing_client.authority_available = False
    missing_collection = librarian.probe_memory_backend_readiness()

    assert missing_collection["ok"] is False
    assert "authoritative collection does not exist" in missing_collection["error"]
    assert not any(call[0] == "get_or_create" for call in calls)

    database.unlink()
    lost = librarian.probe_memory_backend_readiness()

    assert lost["ok"] is False
    assert "authority database is missing" in lost["error"]
    assert not database.exists()
