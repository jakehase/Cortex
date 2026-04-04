import asyncio
from pathlib import Path

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator


def _workflow() -> dict:
    return {
        "name": "tool_ingest_followup",
        "metadata": {
            "owner": "cortex",
            "session_key": "session:tool-ingest",
            "runtime_conversation": {"owned": False, "channel": "whatsapp", "conversation_id": "chat:test"},
        },
        "steps": [
            {
                "node_id": "step1",
                "title": "Step 1",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "payload": {"prompt": "hello"},
            }
        ],
    }


def test_tool_ingest_normalizes_events_and_enqueues_follow_up(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "runtime.db")
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")
    monkeypatch.setattr(
        orchestrator,
        "resilient_delivery_attempt",
        lambda dependency, operation, **kwargs: {"success": True, "dependency": dependency, "queued": False, "result": operation()},
    )

    process = scheduler.create_process_from_workflow(_workflow())
    result = asyncio.run(
        orchestrator.ingest_runtime_tool_event(
            orchestrator.RuntimeToolIngestRequest(
                process_id=process["process_id"],
                tool="codex",
                event="task.blocked",
                session_id="sess_1",
                session_name="issue-123",
                payload={"reason": "need API key"},
            )
        )
    )

    assert result["event"]["kind"] == "session.blocked"
    assert result["session"]["status"] == "blocked"
    assert result["snapshot"]["session_state"]["status"] == "blocked"
    assert result["follow_up_dispatch"]["runtime_kind"] == "session"
    assert result["follow_up_dispatch"]["summary"] == "need API key"

    dlq = asyncio.run(orchestrator.get_runtime_delivery_dlq())
    assert dlq["entries"] == []

    sessions = asyncio.run(orchestrator.list_runtime_sessions(process_id=process["process_id"]))
    assert sessions["sessions"][0]["open_questions"] == ["need API key"]
