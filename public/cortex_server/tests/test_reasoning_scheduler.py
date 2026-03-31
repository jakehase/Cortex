import json
from datetime import datetime, timedelta, timezone

import cortex_server.modules.reasoning_scheduler as scheduler
from cortex_server.modules.reasoning_planner import ReasoningPlanGraph, compile_plan_to_workflow



def _future_iso(minutes: int = 5) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()



def _graph() -> ReasoningPlanGraph:
    return ReasoningPlanGraph(
        name="runtime_plan",
        metadata={"owner": "cortex", "session_key": "session:scheduler", "archetype": "coding"},
        nodes=[
            {
                "node_id": "fetch",
                "title": "Fetch",
                "endpoint": "/users/get",
                "method": "POST",
                "payload": {"id": 1},
            },
            {
                "node_id": "summarize",
                "title": "Summarize",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "depends_on": ["fetch"],
                "payload": {"prompt": "Summarize {{fetch.response.name}}"},
            },
        ],
    )



def test_scheduler_create_tick_and_promote_dependency(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    workflow = compile_plan_to_workflow(_graph())
    process = scheduler.create_process_from_workflow(workflow)

    assert process["status"] == "ready"
    assert process["nodes"]["fetch"]["status"] == "ready"
    assert process["nodes"]["summarize"]["status"] == "blocked"

    tick = scheduler.scheduler_tick(limit=10)
    assert tick["runnable_count"] == 1
    assert tick["runnable"][0]["node_id"] == "fetch"

    scheduler.mark_node_running(process["process_id"], "fetch")
    scheduler.record_node_result(
        process["process_id"],
        "fetch",
        {
            "success": True,
            "status_code": 200,
            "response": {"name": "Jake"},
            "elapsed_ms": 12.0,
        },
    )

    refreshed = scheduler.get_process(process["process_id"])
    assert refreshed is not None
    assert refreshed["nodes"]["fetch"]["status"] == "completed"
    assert refreshed["nodes"]["summarize"]["status"] == "ready"
    assert refreshed["results_by_node"]["fetch"]["response"]["name"] == "Jake"



def test_scheduler_failure_blocks_dependents(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    workflow = compile_plan_to_workflow(_graph())
    process = scheduler.create_process_from_workflow(workflow)
    scheduler.mark_node_running(process["process_id"], "fetch")
    scheduler.record_node_result(
        process["process_id"],
        "fetch",
        {
            "success": False,
            "status_code": 500,
            "error": "boom",
            "response": {"error": "boom"},
        },
    )

    refreshed = scheduler.get_process(process["process_id"])
    assert refreshed is not None
    assert refreshed["status"] == "failed"
    assert refreshed["nodes"]["fetch"]["status"] == "failed"
    assert refreshed["nodes"]["summarize"]["status"] == "blocked"
    assert refreshed["nodes"]["summarize"]["blocked_by"] == ["fetch"]



def test_scheduler_wait_and_manual_wake(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    workflow = compile_plan_to_workflow(_graph())
    process = scheduler.create_process_from_workflow(workflow, start_at=_future_iso(10))

    assert process["status"] == "waiting"
    assert process["nodes"]["fetch"]["status"] == "waiting"

    tick = scheduler.scheduler_tick(limit=10)
    assert tick["runnable_count"] == 0

    woken = scheduler.wake_process(process["process_id"])
    assert woken["status"] == "ready"
    assert woken["nodes"]["fetch"]["status"] == "ready"

    tick2 = scheduler.scheduler_tick(limit=10)
    assert tick2["runnable_count"] == 1
    assert tick2["runnable"][0]["node_id"] == "fetch"


def test_scheduler_reloads_process_and_events_from_sqlite_store(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)

    workflow = compile_plan_to_workflow(_graph())
    process = scheduler.create_process_from_workflow(workflow)
    scheduler.mark_node_running(process["process_id"], "fetch")
    scheduler.record_node_result(
        process["process_id"],
        "fetch",
        {
            "success": True,
            "status_code": 200,
            "response": {"name": "Jake"},
            "elapsed_ms": 3.0,
        },
    )

    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "missing_scheduler.json")

    reloaded = scheduler.get_process(process["process_id"])
    events = scheduler.process_events(process["process_id"], limit=10)

    assert reloaded is not None
    assert reloaded["results_by_node"]["fetch"]["response"]["name"] == "Jake"
    assert any(row["kind"] == "node_running" for row in events)
    assert any(row["kind"] == "node_completed" for row in events)


def test_scheduler_legacy_json_fallback_is_opt_in(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    scheduler_json = tmp_path / "reasoning_scheduler.json"
    scheduler_json.write_text(json.dumps({
        "processes": {
            "proc_legacy": {
                "process_id": "proc_legacy",
                "workflow": {"name": "legacy", "steps": [], "metadata": {}},
                "nodes": {},
                "results_by_node": {},
                "status": "completed"
            }
        },
        "events": []
    }), encoding="utf-8")

    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", scheduler_json)
    monkeypatch.setattr(scheduler, "ENABLE_LEGACY_JSON_FALLBACK", False)
    assert scheduler.get_process("proc_legacy") is None

    monkeypatch.setattr(scheduler, "ENABLE_LEGACY_JSON_FALLBACK", True)
    loaded = scheduler.get_process("proc_legacy")
    assert loaded is not None
    assert loaded["process_id"] == "proc_legacy"

    monkeypatch.setattr(scheduler, "ENABLE_LEGACY_JSON_FALLBACK", False)
    reloaded = scheduler.get_process("proc_legacy")
    assert reloaded is not None
    assert reloaded["process_id"] == "proc_legacy"


def test_scheduler_retry_mode_waits_then_requeues(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    graph = ReasoningPlanGraph(
        name="retry_plan",
        metadata={"owner": "cortex", "session_key": "session:retry", "archetype": "coding"},
        nodes=[
            {
                "node_id": "fetch",
                "title": "Fetch",
                "endpoint": "/users/get",
                "method": "POST",
                "payload": {"id": 1},
                "failure_mode": "retry",
                "metadata": {"max_attempts": 2, "retry_backoff_seconds": 60},
            },
        ],
    )

    workflow = compile_plan_to_workflow(graph)
    process = scheduler.create_process_from_workflow(workflow)
    scheduler.mark_node_running(process["process_id"], "fetch")
    scheduler.record_node_result(
        process["process_id"],
        "fetch",
        {"success": False, "status_code": 500, "error": "boom", "response": {"error": "boom"}},
    )

    refreshed = scheduler.get_process(process["process_id"])
    assert refreshed is not None
    assert refreshed["nodes"]["fetch"]["status"] == "waiting"
    assert refreshed["nodes"]["fetch"]["retry_at"] is not None
    assert "fetch" not in refreshed["results_by_node"]

    future_tick = scheduler.scheduler_tick(now_iso=_future_iso(2), limit=10)
    assert future_tick["runnable_count"] == 1
    assert future_tick["runnable"][0]["node_id"] == "fetch"


def test_scheduler_deadline_cancels_process(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    graph = ReasoningPlanGraph(
        name="deadline_plan",
        metadata={"owner": "cortex", "session_key": "session:deadline", "archetype": "coding", "workflow_deadline_seconds": 1},
        nodes=[
            {"node_id": "fetch", "title": "Fetch", "endpoint": "/users/get", "method": "POST", "payload": {"id": 1}},
        ],
    )

    workflow = compile_plan_to_workflow(graph)
    process = scheduler.create_process_from_workflow(workflow)
    refreshed = scheduler.scheduler_tick(now_iso=_future_iso(2), limit=10)
    loaded = scheduler.get_process(process["process_id"])

    assert refreshed["runnable_count"] == 0
    assert loaded is not None
    assert loaded["status"] == "cancelled"
    assert loaded["nodes"]["fetch"]["status"] == "cancelled"


def test_scheduler_cancel_process_marks_open_nodes_cancelled(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    workflow = compile_plan_to_workflow(_graph())
    process = scheduler.create_process_from_workflow(workflow)
    cancelled = scheduler.cancel_process(process["process_id"], reason="operator_stop")

    assert cancelled["status"] == "cancelled"
    assert cancelled["nodes"]["fetch"]["status"] == "cancelled"
    assert cancelled["nodes"]["summarize"]["status"] == "cancelled"



def test_scheduler_sync_process_progress_rewinds_completed_process(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    workflow = compile_plan_to_workflow(_graph())
    process = scheduler.create_process_from_workflow(workflow)
    scheduler.mark_node_running(process["process_id"], "fetch")
    scheduler.record_node_result(
        process["process_id"],
        "fetch",
        {
            "success": True,
            "status_code": 200,
            "response": {"name": "Jake"},
            "elapsed_ms": 1.0,
        },
    )
    scheduler.mark_node_running(process["process_id"], "summarize")
    scheduler.record_node_result(
        process["process_id"],
        "summarize",
        {
            "success": True,
            "status_code": 200,
            "response": {"text": "done"},
            "elapsed_ms": 1.0,
        },
    )

    completed = scheduler.get_process(process["process_id"])
    assert completed is not None
    assert completed["status"] == "completed"

    rewound = scheduler.sync_process_progress(
        process["process_id"],
        lifecycle_state="running",
        active_nodes=["fetch"],
        waiting_nodes=["summarize"],
        enabled=True,
        event_payload={"source": "test"},
    )
    events = scheduler.process_events(process["process_id"], limit=10)

    assert rewound["status"] == "running"
    assert rewound["completed_at"] is None
    assert rewound["nodes"]["fetch"]["status"] == "running"
    assert rewound["nodes"]["summarize"]["status"] == "blocked"
    assert rewound["nodes"]["summarize"]["blocked_by"] == ["fetch"]
    assert "fetch" not in rewound["results_by_node"]
    assert "summarize" not in rewound["results_by_node"]
    assert events[-1]["kind"] == "process_progress_synced"
    assert events[-1]["payload"]["source"] == "test"


def test_scheduler_retry_filters_by_status_code(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    graph = ReasoningPlanGraph(
        name="retry_status_filter_plan",
        metadata={"owner": "cortex", "session_key": "session:retry-status", "archetype": "coding"},
        nodes=[
            {
                "node_id": "fetch",
                "title": "Fetch",
                "endpoint": "/users/get",
                "method": "POST",
                "payload": {"id": 1},
                "failure_mode": "retry",
                "metadata": {"max_attempts": 3, "retry_backoff_seconds": 60, "retry_on_status_codes": [503]},
            },
        ],
    )

    workflow = compile_plan_to_workflow(graph)
    process = scheduler.create_process_from_workflow(workflow)
    scheduler.mark_node_running(process["process_id"], "fetch")
    scheduler.record_node_result(
        process["process_id"],
        "fetch",
        {"success": False, "status_code": 500, "error": "boom", "response": {"error": "boom"}},
    )

    refreshed = scheduler.get_process(process["process_id"])
    assert refreshed is not None
    assert refreshed["nodes"]["fetch"]["status"] == "failed"
