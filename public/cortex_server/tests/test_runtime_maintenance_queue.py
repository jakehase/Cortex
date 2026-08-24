from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator


MINIMAL_PROFILE = {
    "profile": "runtime-maintenance-queue-test",
    "intended_duration_hours": 1,
    "campaign_cycles": 1,
    "min_agent_count": 1,
    "min_handoff_count": 0,
    "max_checkpoint_age_seconds": 3600,
    "max_snapshot_event_gap": 3,
    "max_dead_letters": 0,
    "max_stale_leases": 0,
    "max_inflight_age_seconds": 120,
    "max_lease_heartbeat_lag_seconds": 3600,
    "required_revision_history": 1,
    "watchdog": {"lease_seconds": 60, "heartbeat_grace_seconds": 60},
    "checkpoint": {"snapshot_every_events": 4, "must_checkpoint_on_handoff": True},
}


REPORTING_POLICY = {
    "report_every_iterations": 10,
    "live_review_seconds": 60,
    "proactive_report_seconds": 120,
    "blocker_followup_seconds": 60,
}



def _install_fake_diplomat(monkeypatch):
    sent = []

    class _FakeDiplomat:
        def send_briefing(self, message: str, title: str = "[Cortex] Runtime update") -> bool:
            sent.append({"title": title, "message": message})
            return True

    monkeypatch.setattr(orchestrator, "get_diplomat", lambda: _FakeDiplomat())
    return sent



def _dump(model):
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _mark_item_done(*, stores, item):
    process_id = item["process_id"]
    done_key = item["projection"]["done_world_state_key"]
    shared_state = stores["shared_state_store"].load(process_id)
    payload = _dump(shared_state)
    payload["revision_id"] = f"{payload['revision_id']}_done"
    payload["world_state"] = {**dict(payload.get("world_state") or {}), done_key: True}
    stores["shared_state_store"].save(
        payload,
        expected_revision_id=shared_state.revision_id,
        actor="pytest",
        provenance={"source": "test_runtime_maintenance_queue"},
    )



def test_runtime_maintenance_intake_claim_and_follow_up(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    sent = _install_fake_diplomat(monkeypatch)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    intake = asyncio.run(
        orchestrator.intake_runtime_maintenance_item(
            orchestrator.RuntimeMaintenanceIntakeRequest(
                title="Fix WhatsApp intake bridge",
                text="User says roadmap intake from WhatsApp should create a queued maintenance item and keep following through.",
                item_kind="fix",
                max_active_items=1,
                dependability_profile=dict(MINIMAL_PROFILE),
                reporting_policy=dict(REPORTING_POLICY),
                message=orchestrator.RuntimeMaintenanceIntakeMessage(
                    text="Can you fix the intake bridge and keep me posted?",
                    channel="whatsapp",
                    conversation_id="chat:maintenance:intake",
                    session_key="session:maintenance:intake",
                    from_user="+17855550199",
                    message_id="wamid.maintenance-intake-1",
                ),
            )
        )
    )

    item = intake["item"]
    assert item["status"] == "pending"
    assert intake["maintenance_queue"]["queue"]["counts"]["pending"] == 1
    assert item["projection"]["done_world_state_key"] == f"maintenance_queue.{item['item_id']}.done"

    first_now = datetime(2026, 3, 1, tzinfo=timezone.utc)
    tick_one = asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=first_now.isoformat().replace("+00:00", "Z"),
            )
        )
    )
    queue_item = asyncio.run(orchestrator.get_runtime_maintenance_queue_item(item["item_id"]))["item"]

    assert tick_one["watchdog"]["maintenance_queue"]["action_count"] == 1
    assert queue_item["status"] == "active"
    assert queue_item["process_id"] is not None
    assert queue_item["projection"]["roadmap_status"] == "active"
    assert queue_item["projection"]["session_plane"]["status"] in {"running", "scheduled", "active"}
    assert queue_item["projection"]["session_plane"]["watcher_count"] >= 1
    assert queue_item["projection"]["conversation_ownership"]["conversation_id"] == "chat:maintenance:intake"

    tick_two = asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=(first_now + timedelta(minutes=3)).isoformat().replace("+00:00", "Z"),
            )
        )
    )
    queue_item = asyncio.run(orchestrator.get_runtime_maintenance_queue_item(item["item_id"]))["item"]
    follow_ups = orchestrator._runtime_delivery_stores()["follow_up_store"].list(process_id=queue_item["process_id"], runtime_kind="roadmap")
    queue_status = asyncio.run(orchestrator.get_runtime_maintenance_queue())["queue"]

    assert tick_two["watchdog"]["action_count"] >= 1
    assert queue_item["projection"]["follow_through"]["outbound_update"]["delivery_status"] == "sent"
    assert queue_status["session_counts"][queue_item["projection"]["session_plane"]["status"]] >= 1
    assert len(follow_ups) == 1
    assert len(sent) == 1
    assert "Fix WhatsApp intake bridge" in sent[0]["message"]



def test_runtime_maintenance_queue_autonomously_advances_next_item(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    first = asyncio.run(
        orchestrator.intake_runtime_maintenance_item(
            orchestrator.RuntimeMaintenanceIntakeRequest(
                title="Repair roadmap executor canary",
                text="First queued task should claim the only slot.",
                item_kind="fix",
                max_active_items=1,
                dependability_profile=dict(MINIMAL_PROFILE),
                reporting_policy=dict(REPORTING_POLICY),
                message=orchestrator.RuntimeMaintenanceIntakeMessage(
                    text="Repair the roadmap executor canary",
                    channel="whatsapp",
                    conversation_id="chat:maintenance:queue",
                    session_key="session:maintenance:queue",
                    message_id="wamid.queue.1",
                ),
            )
        )
    )["item"]
    second = asyncio.run(
        orchestrator.intake_runtime_maintenance_item(
            orchestrator.RuntimeMaintenanceIntakeRequest(
                title="Ship maintenance queue projection",
                text="Second queued task should stay pending until capacity frees up.",
                item_kind="task",
                dependability_profile=dict(MINIMAL_PROFILE),
                reporting_policy=dict(REPORTING_POLICY),
                message=orchestrator.RuntimeMaintenanceIntakeMessage(
                    text="Ship the maintenance queue projection",
                    channel="whatsapp",
                    conversation_id="chat:maintenance:queue",
                    session_key="session:maintenance:queue",
                    message_id="wamid.queue.2",
                ),
            )
        )
    )["item"]

    first_now = datetime(2026, 3, 2, tzinfo=timezone.utc)
    asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=first_now.isoformat().replace("+00:00", "Z"),
            )
        )
    )
    queue = asyncio.run(orchestrator.get_runtime_maintenance_queue())["queue"]
    first_item = next(row for row in queue["items"] if row["item_id"] == first["item_id"])
    second_item = next(row for row in queue["items"] if row["item_id"] == second["item_id"])

    assert queue["counts"]["active"] == 1
    assert first_item["status"] == "active"
    assert second_item["status"] == "pending"

    stores = orchestrator._runtime_delivery_stores()
    _mark_item_done(stores=stores, item=first_item)
    asyncio.run(
        orchestrator.reconcile_runtime_roadmap(
            first_item["process_id"],
            orchestrator.RuntimeRoadmapReconcileRequest(
                controller_id="pytest",
                controller_session_id="pytest:maintenance:complete",
                now_iso=(first_now + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
            ),
        )
    )

    tick_two = asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=(first_now + timedelta(minutes=2)).isoformat().replace("+00:00", "Z"),
            )
        )
    )
    queue = asyncio.run(orchestrator.get_runtime_maintenance_queue())["queue"]
    first_item = next(row for row in queue["items"] if row["item_id"] == first["item_id"])
    second_item = next(row for row in queue["items"] if row["item_id"] == second["item_id"])

    assert tick_two["watchdog"]["maintenance_queue"]["action_count"] == 1
    assert queue["counts"]["completed"] == 1
    assert queue["counts"]["active"] == 1
    assert queue["session_counts"][second_item["projection"]["session_plane"]["status"]] >= 1
    assert first_item["status"] == "completed"
    assert first_item["completed_at"] is not None
    assert second_item["status"] == "active"
    assert second_item["process_id"] is not None
    assert second_item["process_id"] != first_item["process_id"]


def test_runtime_maintenance_queue_reflects_session_blockers(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(
        orchestrator,
        "resilient_delivery_attempt",
        lambda dependency, operation, **kwargs: {"success": True, "dependency": dependency, "queued": False, "result": operation()},
    )
    orchestrator.workflows.clear()

    item = asyncio.run(
        orchestrator.intake_runtime_maintenance_item(
            orchestrator.RuntimeMaintenanceIntakeRequest(
                title="Unstick coding worker",
                text="Queue item should reflect live session blockers.",
                item_kind="fix",
                max_active_items=1,
                dependability_profile=dict(MINIMAL_PROFILE),
                reporting_policy=dict(REPORTING_POLICY),
                message=orchestrator.RuntimeMaintenanceIntakeMessage(
                    text="Please unstick the coding worker",
                    channel="whatsapp",
                    conversation_id="chat:maintenance:blocker",
                    session_key="session:maintenance:blocker",
                    message_id="wamid.queue.blocker.1",
                ),
            )
        )
    )["item"]

    now = datetime(2026, 3, 3, tzinfo=timezone.utc)
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=False, now_iso=now.isoformat().replace("+00:00", "Z"))))
    queue_item = asyncio.run(orchestrator.get_runtime_maintenance_queue_item(item["item_id"]))["item"]

    asyncio.run(
        orchestrator.record_runtime_session_event(
            orchestrator.RuntimeSessionEventRequest(
                process_id=queue_item["process_id"],
                event="session.blocked",
                session_id=queue_item["projection"]["session_plane"]["session_id"],
                session_name=queue_item["projection"]["session_plane"]["session_name"],
                tool="codex",
                summary="need human answer",
            )
        )
    )
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=False, now_iso=(now + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"))))
    queue_item = asyncio.run(orchestrator.get_runtime_maintenance_queue_item(item["item_id"]))["item"]

    assert queue_item["status"] == "blocked"
    assert queue_item["projection"]["session_plane"]["status"] == "blocked"
    assert "need human answer" in queue_item["projection"]["session_plane"]["open_questions"]


def test_runtime_maintenance_queue_does_not_block_on_single_retry_without_human_question(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(
        orchestrator,
        "resilient_delivery_attempt",
        lambda dependency, operation, **kwargs: {"success": True, "dependency": dependency, "queued": False, "result": operation()},
    )
    orchestrator.workflows.clear()

    item = asyncio.run(
        orchestrator.intake_runtime_maintenance_item(
            orchestrator.RuntimeMaintenanceIntakeRequest(
                title="Retry should stay active",
                text="A single retry-needed without a human blocker should not demote the queue item to blocked.",
                item_kind="fix",
                max_active_items=1,
                dependability_profile=dict(MINIMAL_PROFILE),
                reporting_policy=dict(REPORTING_POLICY),
                message=orchestrator.RuntimeMaintenanceIntakeMessage(
                    text="Retry should stay active",
                    channel="whatsapp",
                    conversation_id="chat:maintenance:retry",
                    session_key="session:maintenance:retry",
                    message_id="wamid.queue.retry.1",
                ),
            )
        )
    )["item"]

    now = datetime(2026, 3, 4, tzinfo=timezone.utc)
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=False, now_iso=now.isoformat().replace("+00:00", "Z"))))
    queue_item = asyncio.run(orchestrator.get_runtime_maintenance_queue_item(item["item_id"]))["item"]

    asyncio.run(
        orchestrator.record_runtime_session_event(
            orchestrator.RuntimeSessionEventRequest(
                process_id=queue_item["process_id"],
                event="session.retry-needed",
                session_id=queue_item["projection"]["session_plane"]["session_id"],
                session_name=queue_item["projection"]["session_plane"]["session_name"],
                tool="codex",
                summary="retry scheduled",
            )
        )
    )
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=False, now_iso=(now + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"))))
    queue_item = asyncio.run(orchestrator.get_runtime_maintenance_queue_item(item["item_id"]))["item"]

    assert queue_item["status"] == "active"
    assert queue_item["projection"]["session_plane"]["status"] == "retry-needed"
