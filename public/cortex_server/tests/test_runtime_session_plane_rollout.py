import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator
from cortex_server.modules.reasoning_planner import ReasoningPlanGraph


def _graph() -> ReasoningPlanGraph:
    return ReasoningPlanGraph(
        name="runtime_rollout",
        metadata={
            "owner": "cortex",
            "session_key": "session:rollout",
            "archetype": "coding",
            "repo_root": "/tmp/demo-repo",
        },
        nodes=[
            {
                "node_id": "step1",
                "title": "Step 1",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "payload": {"prompt": "hello"},
            }
        ],
    )


def test_schedule_runtime_bootstraps_session_plane_and_status_surfaces(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"
    repo_root = tmp_path / "demo-repo"
    repo_root.mkdir()

    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    orchestrator.workflows.clear()

    graph = _graph()
    graph.metadata["repo_root"] = str(repo_root)

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    process_id = scheduled["process"]["process_id"]

    assert scheduled["session_plane"]["session"]["session_id"] == process_id
    assert scheduled["session_plane"]["event"]["kind"] == "session.started"
    assert len(scheduled["session_plane"]["watchers"]) >= 2

    status = asyncio.run(orchestrator.get_runtime_scheduler_status())
    assert status["runtime"]["session_plane"]["session_count"] >= 1
    assert status["runtime"]["session_plane"]["watcher_count"] >= 2

    processes = asyncio.run(orchestrator.get_runtime_processes())
    process_row = next(row for row in processes["processes"] if row["process_id"] == process_id)
    assert process_row["session_plane"]["watcher_count"] >= 2
    assert process_row["session_plane"]["sessions"][0]["status"] in {"running", "registered"}

    process_view = asyncio.run(orchestrator.get_runtime_process_view(process_id))
    assert process_view["session_plane"]["status"]["session_count"] >= 1
    assert len(process_view["session_plane"]["watchers"]) >= 2

    memory_root = Path(status["runtime"]["session_plane"]["memory_root"])
    assert (memory_root / "MEMORY.md").exists()


def test_session_plane_bootstrap_repairs_partial_state_idempotently(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"
    repo_root = tmp_path / "demo-repo"
    repo_root.mkdir()
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")

    workflow = {
        "name": "partial_session_bootstrap",
        "metadata": {"owner": "cortex", "repo_root": str(repo_root)},
        "steps": [{"node_id": "step1", "title": "Step 1", "endpoint": "/oracle/chat", "payload": {"prompt": "hello"}}],
    }
    process = scheduler.create_process_from_workflow(workflow, process_id="proc_partial_session")
    stores = orchestrator._runtime_delivery_stores()
    stores["session_registry"].register(
        process_id=process["process_id"],
        session_id=process["process_id"],
        session_name=workflow["name"],
        tool="cortex-runtime",
    )

    repaired = orchestrator._ensure_runtime_session_plane_bootstrap(process["process_id"], process=process, stores=stores)
    process_note_path = stores["runtime_memory_store"]._process_path(process["process_id"])
    process_note_path.unlink()
    disabled_watcher = stores["watcher_store"].list(process_id=process["process_id"])[0]
    disabled_watcher.enabled = False
    stores["watcher_store"].register(disabled_watcher)
    stores["session_registry"].detect_stale(now=datetime.now(timezone.utc) + timedelta(days=1))
    reconciled = orchestrator._ensure_runtime_session_plane_bootstrap(process["process_id"], process=process, stores=stores)

    sessions = stores["session_registry"].list(process_id=process["process_id"])
    watchers = stores["watcher_store"].list(process_id=process["process_id"])
    start_events = stores["journal"].load(process_id=process["process_id"], kinds=["session.started"])
    note = stores["runtime_memory_store"]._process_path(process["process_id"]).read_text(encoding="utf-8")

    assert repaired["event"]["kind"] == "session.started"
    assert reconciled["event"] is None
    assert sessions[0].status == "running"
    assert len(watchers) == 2
    assert all(row.enabled for row in watchers)
    assert set(sessions[0].watcher_ids) == {row.watch_id for row in watchers}
    assert len(start_events) == 1
    assert note.count(f"session-plane-bootstrap:{process['process_id']}") == 1
