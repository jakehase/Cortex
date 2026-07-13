import copy
import multiprocessing
import os
import sqlite3
import threading

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

# Router import constructs its persistence client, so keep collection-time state
# inside the writable test sandbox rather than touching an operator database.
os.environ["CORTEX_CHROMA_DIR"] = "/tmp/cortex-c05-hardening-chroma"
os.environ["LIBRARIAN_FALLBACK_LOG_PATH"] = "/tmp/cortex-c05-hardening-chroma/fallback.jsonl"

from cortex_server.knowledge.graph import Edge, EdgeType, Node, NodeType, SQLiteStorage
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
    """Process-shared Chroma fake whose individual calls are atomic."""

    def __init__(self, manager):
        self.rows = manager.dict()
        self.lock = manager.RLock()

    def add(self, ids, documents, metadatas):
        with self.lock:
            for row_id, document, metadata in zip(ids, documents, metadatas):
                self.rows[row_id] = {"document": document, "metadata": copy.deepcopy(metadata)}

    def get(self, ids=None, where=None, include=None, **_kwargs):
        with self.lock:
            selected = list(self.rows.keys())
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
            for row_id, metadata in zip(ids, metadatas):
                row = dict(self.rows[row_id])
                row["metadata"] = copy.deepcopy(metadata)
                self.rows[row_id] = row

    def delete(self, ids):
        with self.lock:
            for row_id in ids:
                self.rows.pop(row_id, None)


def _write_shared_fact(barrier, row_id):
    barrier.wait()
    librarian._add_memory_with_supersession(row_id, row_id, {"fact_key": "same"})


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


def test_every_sqlite_connection_enforces_foreign_keys_and_rejects_dangling_edge(tmp_path):
    storage = SQLiteStorage(str(tmp_path / "graph.db"))
    assert storage._get_conn().execute("PRAGMA foreign_keys").fetchone()[0] == 1
    storage._local.conn.close()
    storage._local.conn = None
    assert storage._get_conn().execute("PRAGMA foreign_keys").fetchone()[0] == 1
    with pytest.raises(sqlite3.IntegrityError):
        storage.insert_edge(_edge("dangling", "missing-a", "missing-b"))
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

    async def fake_query(request):
        observed.append(request)
        return {"nodes": [], "count": 0}

    monkeypatch.setattr(knowledge.service, "query", fake_query)
    request = knowledge.BoundedGraphQueryRequest(query="needle")
    response = await knowledge.query_graph(request)

    assert request.limit == 100
    assert observed == [request]
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
    with context.Manager() as manager:
        fake = SharedFakeCollection(manager)
        monkeypatch.setattr(librarian, "collection", fake)
        monkeypatch.setenv("CORTEX_FACT_SUPERSESSION_LOCK_PATH", str(tmp_path / "fact.lock"))
        barrier = context.Barrier(3)
        processes = [context.Process(target=_write_shared_fact, args=(barrier, row_id)) for row_id in ("one", "two")]
        for process in processes:
            process.start()
        barrier.wait()
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
