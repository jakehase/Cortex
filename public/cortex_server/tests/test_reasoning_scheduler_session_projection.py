from datetime import datetime, timedelta, timezone

import cortex_server.modules.reasoning_scheduler as scheduler
from cortex_server.modules.reasoning_planner import ReasoningPlanGraph, compile_plan_to_workflow


def test_scheduler_session_projection_tracks_retry_and_terminal_events(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    graph = ReasoningPlanGraph(
        name="session_projection_retry",
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
            }
        ],
    )

    process = scheduler.create_process_from_workflow(compile_plan_to_workflow(graph))
    events = scheduler.process_events(process["process_id"], limit=10)
    assert any(row["kind"] == "session.started" for row in events)

    scheduler.mark_node_running(process["process_id"], "fetch")
    scheduler.record_node_result(
        process["process_id"],
        "fetch",
        {"success": False, "status_code": 500, "error": "boom", "response": {"error": "boom"}},
    )
    refreshed = scheduler.get_process(process["process_id"])
    assert refreshed is not None
    assert refreshed["session_projection"]["status"] == "retry-needed"
    assert refreshed["session_projection"]["retry_count"] == 1

    future_tick = scheduler.scheduler_tick(now_iso=(datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat(), limit=10)
    assert future_tick["session_projection"]["blocked_sessions"] >= 1


def test_scheduler_test_nodes_emit_test_events_and_projection(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    graph = ReasoningPlanGraph(
        name="session_projection_tests",
        metadata={"owner": "cortex", "session_key": "session:tests", "archetype": "coding"},
        nodes=[
            {
                "node_id": "tests",
                "title": "Run tests",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "payload": {"prompt": "run tests"},
                "metadata": {"step_kind": "test"},
            }
        ],
    )

    process = scheduler.create_process_from_workflow(compile_plan_to_workflow(graph))
    scheduler.mark_node_running(process["process_id"], "tests")
    scheduler.record_node_result(
        process["process_id"],
        "tests",
        {"success": True, "status_code": 200, "response": {"ok": True}, "elapsed_ms": 10.0},
    )

    refreshed = scheduler.get_process(process["process_id"])
    assert refreshed is not None
    assert refreshed["status"] == "completed"
    assert refreshed["session_projection"]["test_status"] == "test-finished"

    events = scheduler.process_events(process["process_id"], limit=20)
    kinds = [row["kind"] for row in events]
    assert "session.test-started" in kinds
    assert "session.test-finished" in kinds
    assert "session.finished" in kinds
