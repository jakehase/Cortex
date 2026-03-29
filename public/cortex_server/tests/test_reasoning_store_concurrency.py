import concurrent.futures
import threading

import cortex_server.modules.reasoning_approvals as approvals
import cortex_server.modules.reasoning_beliefs as beliefs
import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.modules.reasoning_store as store
from cortex_server.modules.reasoning_planner import ReasoningPlanGraph, compile_plan_to_workflow



def test_reasoning_store_handles_concurrent_document_writers(tmp_path):
    db_path = tmp_path / "reasoning_runtime.db"
    total = 24

    def write_doc(i: int):
        return store.upsert_doc(
            "concurrent_docs",
            f"doc_{i:02d}",
            {"doc_id": f"doc_{i:02d}", "value": i},
            db_path=db_path,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(write_doc, range(total)))

    docs = store.list_docs("concurrent_docs", db_path=db_path)
    values = {row["doc_id"]: row["value"] for row in docs}

    assert len(rows) == total
    assert len(docs) == total
    assert values["doc_00"] == 0
    assert values[f"doc_{total-1:02d}"] == total - 1



def test_belief_store_handles_concurrent_upserts(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")

    total = 20

    def write_claim(i: int):
        return beliefs.upsert_belief(
            subject=f"service:{i % 4}",
            predicate="observed_latency_ms",
            value=i,
            task_id=f"task_{i}",
            source_type="stress_test",
            metadata={"writer": i},
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        claims = list(pool.map(write_claim, range(total)))

    listed = beliefs.list_beliefs(limit=100)
    active = [row for row in listed if row.get("status") == "active"]

    assert len(claims) == total
    assert len(listed) >= 4
    assert len(active) == 4
    assert {row["subject"] for row in active} == {f"service:{i}" for i in range(4)}



def test_approval_store_handles_concurrent_grant_creation(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "reasoning_approvals.json")

    total = 18

    def create_grant(i: int):
        return approvals.create_approval_grant(
            granted_by="Jake",
            scope="workflow",
            workflow_id=f"wf_{i % 3}",
            endpoint_prefixes=[f"/endpoint/{i}"],
            methods=["POST"],
            risk_levels=["high"],
            note=f"grant-{i}",
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        grants = list(pool.map(create_grant, range(total)))

    listed = approvals.list_approval_grants()
    grant_ids = {row["grant_id"] for row in listed}

    assert len(grants) == total
    assert len(listed) == total
    assert all(grant["grant_id"] in grant_ids for grant in grants)



def test_scheduler_handles_concurrent_event_appends(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")

    graph = ReasoningPlanGraph(
        name="concurrent_scheduler",
        metadata={"owner": "cortex", "session_key": "session:concurrent", "archetype": "coding"},
        nodes=[
            {"node_id": "fetch", "title": "Fetch", "endpoint": "/users/get", "method": "POST", "payload": {"id": 1}},
        ],
    )
    workflow = compile_plan_to_workflow(graph)
    process = scheduler.create_process_from_workflow(workflow)
    process_id = process["process_id"]

    barrier = threading.Barrier(6)

    def worker(i: int):
        barrier.wait()
        if i % 2 == 0:
            scheduler.mark_node_running(process_id, "fetch")
        else:
            scheduler.get_process(process_id)
        return i

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(worker, range(6)))

    events = scheduler.process_events(process_id, limit=50)
    refreshed = scheduler.get_process(process_id)

    assert sorted(results) == list(range(6))
    assert refreshed is not None
    assert refreshed["process_id"] == process_id
    assert any(row["kind"] == "node_running" for row in events)


def test_reasoning_store_sustained_concurrent_write_load(tmp_path):
    db_path = tmp_path / "reasoning_runtime.db"
    total = 240

    def write_doc(i: int):
        return store.upsert_doc(
            "sustained_docs",
            f"doc_{i:03d}",
            {"doc_id": f"doc_{i:03d}", "value": i, "bucket": i % 12},
            db_path=db_path,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        rows = list(pool.map(write_doc, range(total)))

    docs = store.list_docs("sustained_docs", db_path=db_path)
    assert len(rows) == total
    assert len(docs) == total
    assert docs[-1]["doc_id"] == "doc_239"


def test_wrapper_state_sustained_concurrent_mutations(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "reasoning_approvals.json")

    total = 60

    def mutate(i: int):
        claim = beliefs.upsert_belief(
            subject=f"cluster:{i % 6}",
            predicate="health",
            value=f"v{i}",
            task_id=f"task_{i}",
            source_type="stress_test",
        )
        grant = approvals.create_approval_grant(
            granted_by="Jake",
            scope="workflow",
            workflow_id=f"wf_{i % 5}",
            endpoint_prefixes=[f"/op/{i}"],
            methods=["POST"],
            risk_levels=["high"],
        )
        return claim["claim_id"], grant["grant_id"]

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        pairs = list(pool.map(mutate, range(total)))

    active_beliefs = [row for row in beliefs.list_beliefs(limit=200) if row.get("status") == "active"]
    grants = approvals.list_approval_grants()

    assert len(pairs) == total
    assert len(active_beliefs) == 6
    assert len(grants) == total
