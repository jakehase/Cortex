import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator


def _workflow() -> dict:
    return {
        "name": "runtime_session_integration",
        "metadata": {"owner": "cortex", "session_key": "session:test"},
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


def test_orchestrator_runtime_session_endpoints_wire_registry_memory_and_watchers(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")
    monkeypatch.setattr(
        orchestrator,
        "resilient_delivery_attempt",
        lambda dependency, operation, **kwargs: {"success": True, "dependency": dependency, "queued": False, "result": operation()},
    )

    workflow = _workflow()
    workflow["metadata"]["workspace_path"] = str(tmp_path)
    process = scheduler.create_process_from_workflow(workflow)
    process_id = process["process_id"]

    registered = asyncio.run(
        orchestrator.register_runtime_session(
            orchestrator.RuntimeSessionRegisterRequest(
                process_id=process_id,
                session_id="sess_1",
                session_name="issue-99",
                tool="codex",
            )
        )
    )
    assert registered["session"]["session_id"] == "sess_1"

    blocked = asyncio.run(
        orchestrator.record_runtime_session_event(
            orchestrator.RuntimeSessionEventRequest(
                process_id=process_id,
                event="question.requested",
                session_id="sess_1",
                session_name="issue-99",
                tool="codex",
                summary="need API key",
                payload={"repo_name": "demo"},
            )
        )
    )
    assert blocked["event"]["kind"] == "session.blocked"
    assert blocked["session"]["status"] == "blocked"
    assert Path(blocked["memory_path"]).exists()
    assert blocked["shared_state"]["world_state"]["last_session_event"] == "session.blocked"

    workspace_file = tmp_path / "workspace.txt"
    workspace_file.write_text("a", encoding="utf-8")
    asyncio.run(
        orchestrator.register_runtime_watcher(
            orchestrator.RuntimeWatcherRegisterRequest(
                process_id=process_id,
                kind="workspace",
                target=str(workspace_file),
                session_id="sess_1",
                session_name="issue-99",
                tool="workspace",
                debounce_seconds=1.0,
            )
        )
    )
    asyncio.run(orchestrator.reconcile_runtime_watchers(orchestrator.RuntimeWatcherReconcileRequest(now_iso=datetime(2026, 4, 3, 20, 0, 0, tzinfo=timezone.utc).isoformat())))
    workspace_file.write_text("b", encoding="utf-8")
    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_watchers(
            orchestrator.RuntimeWatcherReconcileRequest(
                now_iso=(datetime(2026, 4, 3, 20, 0, 0, tzinfo=timezone.utc) + timedelta(seconds=2)).isoformat()
            )
        )
    )
    assert reconciled["emitted_count"] >= 1
    assert any(row["event"]["kind"] == "session.workspace-changed" for row in reconciled["emitted"])


def test_pending_rollback_fences_every_session_and_watcher_mutation(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")
    process = scheduler.create_process_from_workflow(_workflow(), process_id="proc_session_fence")
    stores = orchestrator._runtime_delivery_stores()
    stores["session_registry"].register(
        process_id=process["process_id"],
        session_id="existing-session",
        stale_after_seconds=1,
    )
    before = stores["session_registry"].get(
        process_id=process["process_id"],
        session_id="existing-session",
    )
    stores["release_store"].save_rollback_intent(
        process["process_id"],
        {
            "process_id": process["process_id"],
            "status": "recovery_required",
            "phase": "snapshot_committed",
        },
    )

    with pytest.raises(orchestrator.HTTPException) as registration_error:
        asyncio.run(
            orchestrator.register_runtime_session(
                orchestrator.RuntimeSessionRegisterRequest(
                    process_id=process["process_id"],
                    session_id="must-not-register",
                )
            )
        )
    assert registration_error.value.status_code == 409

    with pytest.raises(orchestrator.HTTPException) as heartbeat_error:
        asyncio.run(
            orchestrator.heartbeat_runtime_session(
                orchestrator.RuntimeSessionHeartbeatRequest(
                    process_id=process["process_id"],
                    session_id="existing-session",
                )
            )
        )
    assert heartbeat_error.value.status_code == 409

    with pytest.raises(orchestrator.HTTPException) as watcher_error:
        asyncio.run(
            orchestrator.register_runtime_watcher(
                orchestrator.RuntimeWatcherRegisterRequest(
                    process_id=process["process_id"],
                    kind="workspace",
                    target=str(tmp_path),
                    session_id="existing-session",
                )
            )
        )
    assert watcher_error.value.status_code == 409

    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_watchers(
            orchestrator.RuntimeWatcherReconcileRequest(
                now_iso=(datetime.now(timezone.utc) + timedelta(seconds=10)).isoformat(),
            )
        )
    )
    after = stores["session_registry"].get(
        process_id=process["process_id"],
        session_id="existing-session",
    )
    assert reconciled["emitted_count"] == 0
    assert after.heartbeat_at == before.heartbeat_at
    assert after.status == before.status
    assert stores["session_registry"].get(
        process_id=process["process_id"],
        session_id="must-not-register",
    ) is None
    assert stores["watcher_store"].list(process_id=process["process_id"]) == []
