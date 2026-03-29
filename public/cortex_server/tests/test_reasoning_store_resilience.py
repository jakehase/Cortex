import asyncio
import sqlite3
import threading
import time

import cortex_server.modules.reasoning_beliefs as beliefs
import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.modules.reasoning_store as store
import cortex_server.routers.orchestrator as orchestrator
from cortex_server.modules.reasoning_planner import ReasoningPlanGraph, compile_plan_to_workflow



def test_reasoning_store_skips_malformed_document_and_event_rows(tmp_path):
    db_path = tmp_path / "reasoning_runtime.db"

    store.upsert_doc("demo_docs", "good", {"doc_id": "good", "value": 1}, db_path=db_path)
    store.append_event("demo_events", "proc_1", "ev_good", {"event_id": "ev_good", "process_id": "proc_1", "kind": "ok"}, db_path=db_path)

    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO reasoning_documents(namespace, doc_id, created_at, updated_at, payload) VALUES (?, ?, ?, ?, ?)",
            ("demo_docs", "bad", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00", "{not json"),
        )
        conn.execute(
            "INSERT OR REPLACE INTO reasoning_events(namespace, parent_id, event_id, created_at, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)",
            ("demo_events", "proc_1", "ev_bad", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00", "{not json"),
        )

    docs = store.list_docs("demo_docs", db_path=db_path)
    events = store.list_events("demo_events", db_path=db_path)

    assert docs == [{"doc_id": "good", "value": 1, "created_at": docs[0]["created_at"], "updated_at": docs[0]["updated_at"]}] or len(docs) == 1
    assert docs[0]["doc_id"] == "good"
    assert store.get_doc("demo_docs", "bad", db_path=db_path) is None
    assert len(events) == 1
    assert events[0]["event_id"] == "ev_good"



def test_beliefs_and_scheduler_survive_corrupt_store_rows(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")

    belief = beliefs.upsert_belief(subject="repo", predicate="status", value="green", task_id="task_ok")

    graph = ReasoningPlanGraph(
        name="scheduler_resilience",
        metadata={"owner": "cortex", "session_key": "session:resilience", "archetype": "coding"},
        nodes=[
            {"node_id": "fetch", "title": "Fetch", "endpoint": "/users/get", "method": "POST", "payload": {"id": 1}},
        ],
    )
    workflow = compile_plan_to_workflow(graph)
    process = scheduler.create_process_from_workflow(workflow)

    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO reasoning_documents(namespace, doc_id, created_at, updated_at, payload) VALUES (?, ?, ?, ?, ?)",
            ("beliefs", "bad_claim", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00", "{not json"),
        )
        conn.execute(
            "INSERT OR REPLACE INTO reasoning_events(namespace, parent_id, event_id, created_at, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)",
            ("reasoning_process_events", process["process_id"], "bad_event", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00", "{not json"),
        )

    listed_beliefs = beliefs.list_beliefs(subject="repo", predicate="status", limit=10)
    reloaded_process = scheduler.get_process(process["process_id"])
    events = scheduler.process_events(process["process_id"], limit=10)

    assert any(row["claim_id"] == belief["claim_id"] for row in listed_beliefs)
    assert reloaded_process is not None
    assert reloaded_process["process_id"] == process["process_id"]
    assert all(isinstance(row, dict) for row in events)



def test_orchestrator_lists_good_workflows_even_with_corrupt_store_rows(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True},
            "elapsed_ms": 1.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="workflow_resilience",
        metadata={"owner": "cortex", "session_key": "session:workflow-resilience", "archetype": "coding"},
        nodes=[
            {"node_id": "step1", "title": "Step1", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "ok"}},
        ],
    )

    created = asyncio.run(orchestrator.create_and_run_plan(graph))
    workflow_id = created["workflow_id"]

    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO reasoning_documents(namespace, doc_id, created_at, updated_at, payload) VALUES (?, ?, ?, ?, ?)",
            ("workflows", "wf_bad", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00", "{not json"),
        )

    orchestrator.workflows.clear()
    listed = asyncio.run(orchestrator.list_workflows())
    fetched = asyncio.run(orchestrator.get_workflow(workflow_id))

    assert any(row["workflow_id"] == workflow_id for row in listed["workflows"])
    assert fetched["workflow"]["workflow_id"] == workflow_id


def test_reasoning_store_waits_out_short_exclusive_lock(tmp_path):
    db_path = tmp_path / "reasoning_runtime.db"
    store.upsert_doc("demo_docs", "seed", {"doc_id": "seed", "value": 0}, db_path=db_path)

    lock_conn = sqlite3.connect(str(db_path), timeout=0.1, check_same_thread=False)
    lock_conn.execute("BEGIN EXCLUSIVE")

    outcome = {"done": False, "error": None}

    def writer():
        try:
            store.upsert_doc("demo_docs", "after_lock", {"doc_id": "after_lock", "value": 2}, db_path=db_path)
            outcome["done"] = True
        except Exception as exc:  # noqa: BLE001
            outcome["error"] = exc

    thread = threading.Thread(target=writer)
    thread.start()
    time.sleep(0.35)
    lock_conn.commit()
    lock_conn.close()
    thread.join(timeout=3)

    assert outcome["error"] is None
    assert outcome["done"] is True
    assert store.get_doc("demo_docs", "after_lock", db_path=db_path)["value"] == 2


def test_reasoning_store_recovers_from_invalid_database_file(tmp_path):
    db_path = tmp_path / "reasoning_runtime.db"
    db_path.write_text("this is not sqlite", encoding="utf-8")

    row = store.upsert_doc("demo_docs", "recovered", {"doc_id": "recovered", "value": 7}, db_path=db_path)
    recovered = store.get_doc("demo_docs", "recovered", db_path=db_path)
    quarantine_files = list(tmp_path.glob("reasoning_runtime.db.*.corrupt"))

    assert row["doc_id"] == "recovered"
    assert recovered is not None
    assert recovered["value"] == 7
    assert quarantine_files


def test_reasoning_store_manual_backup_and_restore(tmp_path):
    db_path = tmp_path / "reasoning_runtime.db"
    store.upsert_doc("demo_docs", "state", {"doc_id": "state", "value": 1}, db_path=db_path)
    backup = store.create_backup(db_path, reason="manual")
    store.upsert_doc("demo_docs", "state", {"doc_id": "state", "value": 2}, db_path=db_path)

    restored_from = store.restore_latest_backup(db_path)
    restored = store.get_doc("demo_docs", "state", db_path=db_path)

    assert backup is not None
    assert restored_from == backup
    assert restored is not None
    assert restored["value"] == 1


def test_reasoning_store_auto_restores_latest_backup_after_corruption(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(store, "AUTO_BACKUP_ENABLED", False)
    store.upsert_doc("demo_docs", "state", {"doc_id": "state", "value": 11}, db_path=db_path)
    backup = store.create_backup(db_path, reason="manual")

    for sidecar in [db_path.with_name(db_path.name + "-wal"), db_path.with_name(db_path.name + "-shm")]:
        if sidecar.exists():
            sidecar.unlink()
    db_path.write_text("this is broken", encoding="utf-8")
    restored = store.get_doc("demo_docs", "state", db_path=db_path)
    quarantine_files = list(tmp_path.glob("reasoning_runtime.db.*.corrupt"))

    assert backup is not None
    assert restored is not None
    assert restored["value"] == 11
    assert quarantine_files
