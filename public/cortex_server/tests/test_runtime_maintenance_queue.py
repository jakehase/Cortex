from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier, Lock

import pytest

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator
from cortex_server.runtime import MaintenanceQueueItem, MaintenanceQueueStore


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


def test_maintenance_queue_claim_is_atomic_across_store_instances(tmp_path):
    path = tmp_path / "queue.json"
    MaintenanceQueueStore(path).enqueue(MaintenanceQueueItem(objective="one", source_text="one"))
    barrier = Barrier(2)

    def claim():
        barrier.wait()
        item, _ = MaintenanceQueueStore(path).claim_next(
            claimed_at="2026-03-01T00:00:00.000Z",
            process_id_for_item=lambda row: f"proc_{row.item_id}",
        )
        return item.item_id if item else None

    with ThreadPoolExecutor(max_workers=2) as pool:
        claimed = list(pool.map(lambda _: claim(), range(2)))

    assert sum(value is not None for value in claimed) == 1
    state = MaintenanceQueueStore(path).get_state()
    assert [row.status for row in state.items] == ["active"]


def test_maintenance_queue_requeue_is_atomic_across_store_instances(tmp_path):
    path = tmp_path / "queue.json"
    original = MaintenanceQueueItem(
        objective="one",
        source_text="one",
        status="completed",
        process_id="proc_one",
        completed_at="2026-03-01T00:00:00.000Z",
    )
    MaintenanceQueueStore(path).enqueue(original)
    barrier = Barrier(2)

    def requeue():
        barrier.wait()
        try:
            item, source_process_id = MaintenanceQueueStore(path).requeue(
                original.item_id,
                actor="operator",
                reason="retry",
                requeued_at="2026-03-01T00:01:00.000Z",
            )
            return item.process_id, source_process_id
        except RuntimeError:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: requeue(), range(2)))

    assert results.count(("proc_one_rq1", "proc_one")) == 1
    assert results.count(None) == 1
    item = MaintenanceQueueStore(path).get(original.item_id)
    assert item is not None
    assert item.status == "pending"
    assert item.process_id == "proc_one_rq1"
    assert item.metadata["mission_control_requeue_count"] == 1


def test_maintenance_queue_requeue_uses_locked_item_and_preserves_intervening_commit(tmp_path):
    """Order the old lookup/version race deterministically around another commit."""
    path = tmp_path / "queue.json"
    store = MaintenanceQueueStore(path)
    original = store.enqueue(
        MaintenanceQueueItem(objective="one", source_text="one", status="completed", process_id="proc_one")
    )

    stale_item = store.get(original.item_id)
    assert stale_item is not None
    # This commit lands where the old implementation separately read its CAS
    # version, after resolving the item snapshot. It must neither be lost nor
    # allow that stale snapshot to create the same generation again.
    unrelated = store.enqueue(MaintenanceQueueItem(objective="two", source_text="two"))
    winner, _ = MaintenanceQueueStore(path).requeue(original.item_id, actor="winner", reason="first")

    with pytest.raises(RuntimeError, match="not requeueable from status 'pending'"):
        store.requeue(stale_item.item_id, actor="loser", reason="stale")

    state = store.get_state()
    assert {row.item_id for row in state.items} == {original.item_id, unrelated.item_id}
    current = next(row for row in state.items if row.item_id == original.item_id)
    assert current.process_id == winner.process_id == "proc_one_rq1"
    assert current.metadata["mission_control_last_requeue_actor"] == "winner"
    assert next(row for row in state.items if row.item_id == unrelated.item_id).status == "pending"


def test_repeated_requeue_ids_use_stable_bounded_base_for_legacy_generations(tmp_path):
    path = tmp_path / "queue.json"
    legacy_base = "proc_" + ("legacy-source-" * 20)
    legacy_recursive = legacy_base + "_rq1_rq2_rq999"
    store = MaintenanceQueueStore(path)
    item = store.enqueue(MaintenanceQueueItem(
        objective="migrated", source_text="migrated", status="completed",
        process_id=legacy_recursive,
        metadata={"mission_control_requeue_count": 2499},
    ))

    generated = []
    for generation in range(2500, 4501):
        item, _ = store.requeue(item.item_id, actor="test", reason="repeat")
        generated.append(item.process_id)
        assert item.process_id.endswith(f"_rq{generation}")
        assert len(item.process_id) <= 128
        assert item.process_id.count("_rq") == 1
        if generation < 4500:
            item.status = "completed"
            store.save(item)

    assert len(generated) == len(set(generated))
    current = store.get(item.item_id)
    assert current.metadata["mission_control_process_id_base"] == legacy_base
    assert current.metadata["mission_control_requeue_count"] == 4500


@pytest.mark.parametrize("invalid", [0, -1, True, False, 1.5, "2"])
def test_maintenance_queue_rejects_invalid_capacity_without_persisting(tmp_path, invalid):
    path = tmp_path / "queue.json"
    store = MaintenanceQueueStore(path)
    store.configure(max_active_items=3)
    before = path.read_bytes()

    with pytest.raises(ValueError, match="positive integer"):
        store.configure(max_active_items=invalid)

    assert path.read_bytes() == before
    assert store.get_state().max_active_items == 3


@pytest.mark.parametrize("mutation", ["enqueue", "replace_items", "save"])
@pytest.mark.parametrize("invalid", [0, -1, True, 1.5, "2"])
def test_all_queue_capacity_mutations_reject_invalid_values(tmp_path, mutation, invalid):
    path = tmp_path / "queue.json"
    store = MaintenanceQueueStore(path)
    original = MaintenanceQueueItem(objective="original", source_text="original")
    store.enqueue(original, max_active_items=2)
    before = path.read_bytes()
    replacement = MaintenanceQueueItem(objective="replacement", source_text="replacement")

    with pytest.raises(ValueError, match="positive integer"):
        if mutation == "enqueue":
            store.enqueue(replacement, max_active_items=invalid)
        elif mutation == "replace_items":
            store.replace_items([replacement], max_active_items=invalid)
        else:
            store.save(replacement, max_active_items=invalid)

    assert path.read_bytes() == before


def test_maintenance_queue_sync_preserves_enqueue_during_claim_side_effects(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    stores = orchestrator._runtime_delivery_stores()
    first = stores["maintenance_queue_store"].enqueue(
        MaintenanceQueueItem(objective="first", source_text="first", roadmap_contract={"objective": "first"})
    )
    original_create = orchestrator.create_process_from_workflow
    injected = MaintenanceQueueItem(objective="concurrent", source_text="concurrent", roadmap_contract={"objective": "concurrent"})
    calls = 0
    calls_lock = Lock()

    def create_and_enqueue(*args, **kwargs):
        nonlocal calls
        with calls_lock:
            calls += 1
        stores["maintenance_queue_store"].enqueue(injected)
        return original_create(*args, **kwargs)

    monkeypatch.setattr(orchestrator, "create_process_from_workflow", create_and_enqueue)
    result = orchestrator._runtime_maintenance_queue_sync(
        stores=stores, now=datetime(2026, 3, 1, tzinfo=timezone.utc), allow_claim=True
    )

    state = stores["maintenance_queue_store"].get_state()
    assert calls == 1
    assert result["action_count"] == 1
    assert {row.item_id for row in state.items} == {first.item_id, injected.item_id}
    assert next(row for row in state.items if row.item_id == injected.item_id).status == "pending"


def test_maintenance_queue_sync_preserves_same_item_mutation_during_claim_side_effects(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    stores = orchestrator._runtime_delivery_stores()
    queued = stores["maintenance_queue_store"].enqueue(
        MaintenanceQueueItem(objective="first", source_text="first", roadmap_contract={"objective": "first"})
    )
    original_create = orchestrator.create_process_from_workflow

    def create_and_mutate(*args, **kwargs):
        current = stores["maintenance_queue_store"].get(queued.item_id)
        assert current is not None
        assert current.process_id == kwargs["process_id"]
        current.status = "blocked"
        current.blocked_at = "2026-03-01T00:00:01.000Z"
        current.last_transition_at = current.blocked_at
        current.metadata = {"concurrent": "preserve"}
        current.projection = {"concurrent": "preserve"}
        stores["maintenance_queue_store"].save(current)
        return original_create(*args, **kwargs)

    monkeypatch.setattr(orchestrator, "create_process_from_workflow", create_and_mutate)
    result = orchestrator._runtime_maintenance_queue_sync(
        stores=stores, now=datetime(2026, 3, 1, tzinfo=timezone.utc), allow_claim=True
    )

    current = stores["maintenance_queue_store"].get(queued.item_id)
    assert current is not None
    assert result["action_count"] == 1
    assert current.status == "blocked"
    assert current.blocked_at == "2026-03-01T00:00:01.000Z"
    assert current.metadata == {"concurrent": "preserve"}
    assert current.projection == {"concurrent": "preserve"}


def test_maintenance_dispatch_failure_releases_claim_and_retries_existing_process(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    stores = orchestrator._runtime_delivery_stores()
    queued = stores["maintenance_queue_store"].enqueue(
        MaintenanceQueueItem(objective="recover dispatch", source_text="recover dispatch", roadmap_contract={"objective": "recover dispatch"})
    )
    original_reconcile = orchestrator.reconcile_roadmap_execution

    def fail_after_process_creation(*args, **kwargs):
        raise OSError("injected roadmap persistence failure")

    monkeypatch.setattr(orchestrator, "reconcile_roadmap_execution", fail_after_process_creation)
    with pytest.raises(OSError, match="injected roadmap persistence failure"):
        orchestrator._runtime_maintenance_queue_sync(
            stores=stores, now=datetime(2026, 3, 1, tzinfo=timezone.utc), allow_claim=True
        )

    released = stores["maintenance_queue_store"].get(queued.item_id)
    assert released is not None
    assert released.status == "pending"
    assert released.claimed_at is None
    assert released.metadata["maintenance_dispatch_state"] == "pending"
    assert scheduler.get_process(released.process_id) is not None

    monkeypatch.setattr(orchestrator, "reconcile_roadmap_execution", original_reconcile)
    result = orchestrator._runtime_maintenance_queue_sync(
        stores=stores, now=datetime(2026, 3, 1, 0, 0, 1, tzinfo=timezone.utc), allow_claim=True
    )

    recovered = stores["maintenance_queue_store"].get(queued.item_id)
    assert result["action_count"] == 1
    assert recovered is not None
    assert recovered.status == "active"
    assert recovered.metadata["maintenance_dispatch_state"] == "confirmed"
    assert recovered.process_id == released.process_id
    assert stores["roadmap_store"].load_state(recovered.process_id) is not None


def test_maintenance_dispatch_cancellation_releases_capacity(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    stores = orchestrator._runtime_delivery_stores()
    queued = stores["maintenance_queue_store"].enqueue(
        MaintenanceQueueItem(objective="cancel dispatch", source_text="cancel dispatch", roadmap_contract={"objective": "cancel dispatch"})
    )

    def cancel_dispatch(*args, **kwargs):
        raise asyncio.CancelledError()

    monkeypatch.setattr(orchestrator, "create_process_from_workflow", cancel_dispatch)
    with pytest.raises(asyncio.CancelledError):
        orchestrator._runtime_maintenance_queue_sync(
            stores=stores, now=datetime(2026, 3, 1, tzinfo=timezone.utc), allow_claim=True
        )

    released = stores["maintenance_queue_store"].get(queued.item_id)
    assert released is not None
    assert released.status == "pending"
    assert released.claimed_at is None
    assert released.metadata["maintenance_dispatch_last_failure"] == "CancelledError:dispatch_failed"


def test_maintenance_expired_dispatch_lease_recovers_crash_without_stealing_live_claim(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    stores = orchestrator._runtime_delivery_stores()
    queued = stores["maintenance_queue_store"].enqueue(
        MaintenanceQueueItem(objective="crash recovery", source_text="crash recovery", roadmap_contract={"objective": "crash recovery"})
    )
    claimed, _ = stores["maintenance_queue_store"].begin_dispatch(
        claimed_at="2026-03-01T00:00:00.000Z",
        lease_expires_at="2026-03-01T00:05:00.000Z",
        owner="crashed-worker",
        process_id_for_item=orchestrator._maintenance_queue_process_id,
    )
    assert claimed is not None
    orchestrator.create_process_from_workflow(
        orchestrator._maintenance_queue_workflow(claimed), process_id=claimed.process_id, owner="cortex"
    )
    create_calls = 0
    original_create = orchestrator.create_process_from_workflow

    def count_create(*args, **kwargs):
        nonlocal create_calls
        create_calls += 1
        return original_create(*args, **kwargs)

    monkeypatch.setattr(orchestrator, "create_process_from_workflow", count_create)
    before_expiry = orchestrator._runtime_maintenance_queue_sync(
        stores=stores, now=datetime(2026, 3, 1, 0, 4, 59, tzinfo=timezone.utc), allow_claim=True
    )
    still_owned = stores["maintenance_queue_store"].get(queued.item_id)
    assert before_expiry["action_count"] == 0
    assert still_owned is not None
    assert still_owned.metadata["maintenance_dispatch_owner"] == "crashed-worker"
    assert stores["roadmap_store"].load_state(claimed.process_id) is None

    after_expiry = orchestrator._runtime_maintenance_queue_sync(
        stores=stores, now=datetime(2026, 3, 1, 0, 5, tzinfo=timezone.utc), allow_claim=True
    )
    recovered = stores["maintenance_queue_store"].get(queued.item_id)
    assert after_expiry["action_count"] == 1
    assert create_calls == 0
    assert recovered is not None
    assert recovered.process_id == claimed.process_id
    assert recovered.metadata["maintenance_dispatch_state"] == "confirmed"
    assert stores["roadmap_store"].load_state(claimed.process_id) is not None



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
