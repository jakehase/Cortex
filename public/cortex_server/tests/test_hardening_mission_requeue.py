from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi import HTTPException

import cortex_server.services.mission_control_service as mission_control_service
from cortex_server.runtime import MaintenanceQueueItem, MaintenanceQueueStore


def _dump(model):
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _completed_item(store: MaintenanceQueueStore, *, process_id: str = "proc_old"):
    return store.enqueue(
        MaintenanceQueueItem(
            objective="repeat safely",
            source_text="repeat safely",
            status="completed",
            process_id=process_id,
            completed_at="2026-07-13T00:00:00.000Z",
        )
    )


def _install_service_fakes(monkeypatch, store, processes):
    monkeypatch.setattr(
        mission_control_service,
        "_stores",
        lambda: {"maintenance_queue_store": store},
    )
    monkeypatch.setattr(
        mission_control_service,
        "_resolve_objective",
        lambda objective_key, *, stores: (_dump(store.get(objective_key)), None),
    )
    monkeypatch.setattr(
        mission_control_service,
        "get_process",
        lambda process_id: dict(processes[process_id]) if process_id in processes else None,
    )
    monkeypatch.setattr(mission_control_service, "record_process_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(mission_control_service, "_sync_queue", lambda stores: {})
    monkeypatch.setattr(
        mission_control_service,
        "objective_detail",
        lambda item_id: {"queue_item": _dump(store.get(item_id))},
    )


def test_requeue_keeps_generation_non_claimable_until_pause_is_confirmed(tmp_path):
    path = tmp_path / "queue.json"
    store = MaintenanceQueueStore(path)
    item = _completed_item(store)
    pause_entered = Event()
    finish_pause = Event()
    pause_confirmed = Event()
    claim_started = Event()

    def before_publish(old_process_id):
        assert old_process_id == "proc_old"
        pause_entered.set()
        assert finish_pause.wait(timeout=5)
        pause_confirmed.set()

    def requeue():
        return store.requeue(item.item_id, actor="operator", reason="retry", before_publish=before_publish)

    def claim():
        claim_started.set()

        def process_id_for_item(row):
            assert pause_confirmed.is_set()
            return row.process_id

        return MaintenanceQueueStore(path).claim_next(
            claimed_at="2026-07-13T00:01:00.000Z",
            process_id_for_item=process_id_for_item,
        )[0]

    with ThreadPoolExecutor(max_workers=2) as pool:
        requeue_future = pool.submit(requeue)
        assert pause_entered.wait(timeout=5)
        claim_future = pool.submit(claim)
        assert claim_started.wait(timeout=5)

        # The durable record remains terminal/non-claimable throughout the
        # external pause operation, even for another store instance.
        persisted = json.loads(path.read_text(encoding="utf-8"))
        assert persisted["items"][0]["status"] == "completed"
        finish_pause.set()

        requeued, old_process_id = requeue_future.result(timeout=5)
        claimed = claim_future.result(timeout=5)

    assert old_process_id == "proc_old"
    assert requeued.process_id == "proc_old_rq1"
    assert claimed is not None
    assert claimed.process_id == requeued.process_id


def test_requeue_crash_after_pause_leaves_terminal_item_retryable(tmp_path, monkeypatch):
    store = MaintenanceQueueStore(tmp_path / "queue.json")
    item = _completed_item(store)
    processes = {"proc_old": {"process_id": "proc_old", "status": "running", "enabled": True}}
    _install_service_fakes(monkeypatch, store, processes)

    class SimulatedCrash(BaseException):
        pass

    def crash_after_persisted_pause(process_id):
        processes[process_id].update(status="paused", enabled=False)
        raise SimulatedCrash()

    monkeypatch.setattr(mission_control_service, "pause_process", crash_after_persisted_pause)

    with pytest.raises(SimulatedCrash):
        mission_control_service.requeue_objective(item.item_id, actor="operator")

    unchanged = store.get(item.item_id)
    assert unchanged.status == "completed"
    assert unchanged.process_id == "proc_old"
    assert unchanged.metadata.get("mission_control_requeue_count") is None

    monkeypatch.setattr(
        mission_control_service,
        "pause_process",
        lambda process_id: pytest.fail("already-paused recovery must not pause twice"),
    )
    recovered = mission_control_service.requeue_objective(item.item_id, actor="operator")

    assert recovered["queue_item"]["status"] == "pending"
    assert recovered["queue_item"]["process_id"] == "proc_old_rq1"


def test_requeue_fails_closed_when_pause_cannot_be_confirmed(tmp_path, monkeypatch):
    store = MaintenanceQueueStore(tmp_path / "queue.json")
    item = _completed_item(store)
    processes = {"proc_old": {"process_id": "proc_old", "status": "running", "enabled": True}}
    _install_service_fakes(monkeypatch, store, processes)
    monkeypatch.setattr(
        mission_control_service,
        "pause_process",
        lambda process_id: {"process_id": process_id, "status": "paused", "enabled": False},
    )

    with pytest.raises(HTTPException) as exc_info:
        mission_control_service.requeue_objective(item.item_id, actor="operator")

    assert exc_info.value.status_code == 409
    assert "cannot confirm prior process 'proc_old' is paused" in str(exc_info.value.detail)
    unchanged = store.get(item.item_id)
    assert unchanged.status == "completed"
    assert unchanged.process_id == "proc_old"


def test_concurrent_requeue_only_quiesces_the_winning_request(tmp_path):
    path = tmp_path / "queue.json"
    item = _completed_item(MaintenanceQueueStore(path))
    first_inside = Event()
    release_first = Event()
    callbacks = []

    def attempt(label):
        def before_publish(old_process_id):
            callbacks.append((label, old_process_id))
            first_inside.set()
            assert release_first.wait(timeout=5)

        try:
            return MaintenanceQueueStore(path).requeue(
                item.item_id,
                actor=label,
                reason="retry",
                before_publish=before_publish,
            )
        except RuntimeError:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(attempt, "one")
        assert first_inside.wait(timeout=5)
        second = pool.submit(attempt, "two")
        release_first.set()
        results = [first.result(timeout=5), second.result(timeout=5)]

    assert sum(result is not None for result in results) == 1
    assert len(callbacks) == 1
    assert callbacks[0][1] == "proc_old"
    current = MaintenanceQueueStore(path).get(item.item_id)
    assert current.status == "pending"
    assert current.metadata["mission_control_requeue_count"] == 1
