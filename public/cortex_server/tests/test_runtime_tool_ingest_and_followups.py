import asyncio
from pathlib import Path

import pytest

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


def test_tool_ingest_normalizes_events_without_follow_up_by_default(tmp_path, monkeypatch):
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
    assert result["snapshot"]["session_state"]["authority"] == "derived"
    assert result["follow_up_dispatch"] is None

    dlq = asyncio.run(orchestrator.get_runtime_delivery_dlq())
    assert dlq["entries"] == []

    sessions = asyncio.run(orchestrator.list_runtime_sessions(process_id=process["process_id"]))
    assert sessions["sessions"][0]["open_questions"] == ["need API key"]


def test_tool_ingest_enqueues_follow_up_when_explicit_policy_allows_it(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "runtime.db")
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")
    monkeypatch.setattr(
        orchestrator,
        "resilient_delivery_attempt",
        lambda dependency, operation, **kwargs: {"success": True, "dependency": dependency, "queued": False, "result": operation()},
    )

    workflow = _workflow()
    workflow["metadata"]["session_follow_up_policy"] = {
        "enabled": True,
        "allowed_update_kinds": ["blocker"],
        "auto_send_owned_whatsapp": False,
    }
    process = scheduler.create_process_from_workflow(workflow)
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

    assert result["follow_up_dispatch"]["runtime_kind"] == "session"
    assert result["follow_up_dispatch"]["summary"] == "need API key"
    assert result["follow_up_dispatch"]["metadata"]["policy_source"] == "session_follow_up_policy"


def test_tool_event_id_is_an_end_to_end_idempotency_boundary_and_dlq_is_replayable(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "runtime.db")
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")
    monkeypatch.setattr(
        orchestrator,
        "resilient_delivery_attempt",
        lambda dependency, operation, **kwargs: {"success": True, "dependency": dependency, "queued": False, "result": operation()},
    )
    workflow = _workflow()
    workflow["metadata"]["session_follow_up_policy"] = {
        "enabled": True,
        "allowed_update_kinds": ["retry"],
        "auto_send_owned_whatsapp": False,
    }
    process = scheduler.create_process_from_workflow(workflow)
    request = orchestrator.RuntimeToolIngestRequest(
        process_id=process["process_id"],
        tool="codex",
        event="task.retry",
        event_id="sessevt_retry_idempotent",
        session_id="sess-1",
        payload={"reason": "retry CI"},
    )

    asyncio.run(orchestrator.ingest_runtime_tool_event(request))
    asyncio.run(orchestrator.ingest_runtime_tool_event(request))
    stores = orchestrator._runtime_delivery_stores()
    session = stores["session_registry"].get(process_id=process["process_id"], session_id="sess-1")
    journal_events = [
        row
        for row in stores["journal"].load(process_id=process["process_id"])
        if (row.payload or {}).get("canonical_event_id") == request.event_id
    ]
    memory = stores["runtime_memory_store"]._session_path(process["process_id"], "sess-1").read_text(encoding="utf-8")

    assert session.retry_count == 1
    assert len(journal_events) == 1
    assert memory.count(request.event_id) == 1
    assert len(stores["follow_up_store"].list(process_id=process["process_id"], runtime_kind="session")) == 1

    conflicting_replay = orchestrator.normalize_session_event(
        process["process_id"],
        "blocked",
        tool="codex",
        session_id="sess-1",
        summary="different payload for a committed event id",
    )
    conflicting_replay.event_id = request.event_id
    with pytest.raises(ValueError, match="event_id reuse"):
        orchestrator._record_runtime_session_event(
            process_id=process["process_id"],
            event=conflicting_replay,
            stores=stores,
        )

    unrelated_event = orchestrator.normalize_session_event(
        process["process_id"],
        "heartbeat",
        tool="codex",
        session_id="sess-1",
        summary="later distinct event remains ingestible",
    )
    unrelated = orchestrator._record_runtime_session_event(
        process_id=process["process_id"],
        event=unrelated_event,
        stores=stores,
    )
    assert unrelated["success"] is True

    partial_event = orchestrator.normalize_session_event(
        process["process_id"],
        "retry-needed",
        tool="codex",
        session_id="sess-1",
        summary="resume partial event",
    )
    partial_event.event_id = "sessevt_partial_projection"
    original_snapshot_save = stores["snapshot_store"].save
    failures = {"remaining": 1}

    def fail_snapshot_once(snapshot):
        if failures["remaining"]:
            failures["remaining"] -= 1
            raise OSError("snapshot projection unavailable")
        return original_snapshot_save(snapshot)

    monkeypatch.setattr(stores["snapshot_store"], "save", fail_snapshot_once)
    with pytest.raises(OSError, match="snapshot projection unavailable"):
        orchestrator._record_runtime_session_event(process_id=process["process_id"], event=partial_event, stores=stores)

    later_event = orchestrator.normalize_session_event(process["process_id"], "heartbeat", session_id="sess-1")
    with pytest.raises(RuntimeError, match="must be recovered first"):
        orchestrator._record_runtime_session_event(process_id=process["process_id"], event=later_event, stores=stores)

    recovered_partial = orchestrator._record_runtime_session_event(
        process_id=process["process_id"],
        event=partial_event,
        stores=stores,
    )
    partial_journal_events = [
        row
        for row in stores["journal"].load(process_id=process["process_id"])
        if (row.payload or {}).get("canonical_event_id") == partial_event.event_id
    ]
    partial_memory = stores["runtime_memory_store"]._session_path(process["process_id"], "sess-1").read_text(encoding="utf-8")

    assert recovered_partial["idempotent"] is True
    assert recovered_partial["session"].retry_count == 2
    assert len(partial_journal_events) == 1
    assert partial_memory.count(partial_event.event_id) == 1

    replay_event = orchestrator.normalize_session_event(
        process["process_id"],
        "blocked",
        tool="codex",
        session_id="sess-1",
        summary="operator review needed",
    )
    replay_event.event_id = "sessevt_dlq_replay"
    entry = stores["delivery_dlq"].append(
        {
            "dependency": "runtime_tool_event_ingest",
            "process_id": process["process_id"],
            "event_kind": replay_event.kind,
            "error": "injected partial failure",
            "payload": orchestrator.model_dump_compat(replay_event),
        }
    )
    replayed = asyncio.run(
        orchestrator.replay_runtime_delivery_dlq(
            entry.entry_id,
            orchestrator.RuntimeDeliveryDlqActionRequest(actor="operator", reason="dependency recovered"),
        )
    )
    dlq = asyncio.run(orchestrator.get_runtime_delivery_dlq())

    assert replayed["success"] is True
    assert replayed["acknowledgement"]["replayed"] is True
    assert dlq["entries"] == []
    assert dlq["acknowledged"][0]["entry_id"] == entry.entry_id
