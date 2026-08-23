import asyncio
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from pydantic import ValidationError

from cortex_server.routers import queue


class _Control:
    def __init__(self, *, active=None, inspect_error=None):
        self._active = active
        self._inspect_error = inspect_error
        self.revocations = []

    def inspect(self, timeout=1.0):
        if self._inspect_error is not None:
            raise self._inspect_error
        return SimpleNamespace(active=lambda: self._active)

    def revoke(self, task_id, *, terminate=False):
        self.revocations.append((task_id, terminate))


class _Backend:
    def __init__(self, metadata=None):
        self.metadata = dict(metadata or {})

    def get_task_meta(self, task_id):
        return dict(self.metadata)


def _fake_celery(*, send_task=None, active=None, inspect_error=None, metadata=None):
    return SimpleNamespace(
        tasks={"cortex_tasks.allowed": object()},
        send_task=send_task or (lambda *_args, **_kwargs: SimpleNamespace(id="task-1")),
        control=_Control(active=active, inspect_error=inspect_error),
        backend=_Backend(metadata=metadata),
    )


@pytest.fixture(autouse=True)
def _isolated_queue_admission(monkeypatch):
    queue._reset_admissions_for_tests()
    monkeypatch.setenv("CORTEX_QUEUE_MAX_PENDING", "8")
    monkeypatch.setenv("CORTEX_QUEUE_CALL_TIMEOUT_SECONDS", "1")
    yield
    queue._reset_admissions_for_tests()


@pytest.mark.parametrize(
    "celery",
    [
        _fake_celery(inspect_error=RuntimeError("broker unavailable")),
        _fake_celery(active=None),
        _fake_celery(active={}),
    ],
)
def test_queue_inspection_failure_returns_typed_unavailable(monkeypatch, celery):
    monkeypatch.setattr(queue, "celery_app", celery)
    response = Response()

    status = asyncio.run(queue.get_queue_status(response))

    assert response.status_code == 503
    assert status.success is False
    assert status.status == "unavailable"
    assert status.active_jobs is None
    assert status.error_code


def test_queue_inspection_success_counts_active_tasks(monkeypatch):
    monkeypatch.setattr(
        queue,
        "celery_app",
        _fake_celery(active={"worker-a": [{}, {}], "worker-b": [{}]}),
    )
    response = Response()

    status = asyncio.run(queue.get_queue_status(response))

    assert response.status_code == 200
    assert status.success is True
    assert status.status == "online"
    assert status.active_jobs == 3


@pytest.mark.parametrize(
    "args",
    [
        list(range(queue.MAX_QUEUE_ARGUMENTS + 1)),
        ["x" * (queue.MAX_QUEUE_ARGUMENT_BYTES + 1)],
        [[[[[[[[[["too-deep"]]]]]]]]]],
        [float("inf")],
    ],
)
def test_schedule_arguments_are_bounded(args):
    with pytest.raises(ValidationError):
        queue.ScheduleRequest(
            task="cortex_tasks.allowed",
            args=args,
            idempotency_key="bounded-args",
        )


def test_schedule_requires_key_deduplicates_and_rejects_capacity(monkeypatch):
    calls = []

    def send_task(task_name, *, args):
        calls.append((task_name, list(args)))
        return SimpleNamespace(id=f"task-{len(calls)}")

    monkeypatch.setattr(queue, "celery_app", _fake_celery(send_task=send_task))

    with pytest.raises(HTTPException) as missing:
        asyncio.run(
            queue.schedule_task(
                queue.ScheduleRequest(task="cortex_tasks.allowed", args=[1])
            )
        )
    assert missing.value.status_code == 422

    request = queue.ScheduleRequest(
        task="cortex_tasks.allowed",
        args=[1],
        idempotency_key="request-1",
    )
    first = asyncio.run(queue.schedule_task(request))
    replay = asyncio.run(queue.schedule_task(request))

    assert first.task_id == "task-1"
    assert replay.task_id == first.task_id
    assert replay.idempotent_replay is True
    assert calls == [("cortex_tasks.allowed", [1])]

    with pytest.raises(HTTPException) as conflict:
        asyncio.run(
            queue.schedule_task(
                queue.ScheduleRequest(
                    task="cortex_tasks.allowed",
                    args=[2],
                    idempotency_key="request-1",
                )
            )
        )
    assert conflict.value.status_code == 409

    monkeypatch.setenv("CORTEX_QUEUE_MAX_PENDING", "1")
    with pytest.raises(HTTPException) as exhausted:
        asyncio.run(
            queue.schedule_task(
                queue.ScheduleRequest(
                    task="cortex_tasks.allowed",
                    args=[3],
                    idempotency_key="request-2",
                )
            )
        )
    assert exhausted.value.status_code == 429
    assert exhausted.value.headers["Retry-After"] == "5"


def test_slow_broker_publish_does_not_block_the_event_loop(monkeypatch):
    def slow_send_task(_task_name, *, args):
        time.sleep(0.2)
        return SimpleNamespace(id="slow-task")

    monkeypatch.setattr(
        queue,
        "celery_app",
        _fake_celery(send_task=slow_send_task),
    )

    async def exercise():
        started = time.monotonic()
        scheduled = asyncio.create_task(
            queue.schedule_task(
                queue.ScheduleRequest(
                    task="cortex_tasks.allowed",
                    args=[1],
                    idempotency_key="slow-publish",
                )
            )
        )
        await asyncio.sleep(0.03)
        heartbeat_elapsed = time.monotonic() - started
        result = await scheduled
        return heartbeat_elapsed, result

    heartbeat_elapsed, result = asyncio.run(exercise())

    assert heartbeat_elapsed < 0.12
    assert result.task_id == "slow-task"


def test_unknown_publish_outcome_retains_capacity_and_blocks_duplicate(monkeypatch):
    calls = []

    def timed_out_send(_task_name, *, args):
        calls.append(list(args))
        time.sleep(0.25)
        return SimpleNamespace(id="late-task")

    monkeypatch.setenv("CORTEX_QUEUE_CALL_TIMEOUT_SECONDS", "0.1")
    monkeypatch.setattr(
        queue,
        "celery_app",
        _fake_celery(send_task=timed_out_send),
    )
    request = queue.ScheduleRequest(
        task="cortex_tasks.allowed",
        args=[1],
        idempotency_key="unknown-publish",
    )

    with pytest.raises(HTTPException) as first:
        asyncio.run(queue.schedule_task(request))
    assert first.value.status_code == 503
    assert first.value.detail["code"] == "queue_dispatch_timeout"

    with pytest.raises(HTTPException) as replay:
        asyncio.run(queue.schedule_task(request))
    assert replay.value.status_code == 503
    assert replay.value.detail["code"] == "queue_dispatch_outcome_unknown"
    assert calls == [[1]]


def test_cancellation_is_cooperative_idempotent_and_releases_capacity(monkeypatch):
    published = []

    def send_task(_task_name, *, args):
        published.append(list(args))
        return SimpleNamespace(id=f"task-{len(published)}")

    celery = _fake_celery(
        send_task=send_task,
        metadata={"status": "REVOKED", "result": None},
    )
    monkeypatch.setattr(queue, "celery_app", celery)
    monkeypatch.setenv("CORTEX_QUEUE_MAX_PENDING", "1")

    scheduled = asyncio.run(
        queue.schedule_task(
            queue.ScheduleRequest(
                task="cortex_tasks.allowed",
                args=[],
                idempotency_key="cancel-me",
            )
        )
    )
    cancelled = asyncio.run(
        queue.cancel_task(scheduled.task_id, queue.CancelRequest(reason="operator"))
    )
    replay = asyncio.run(
        queue.cancel_task(scheduled.task_id, queue.CancelRequest(reason="operator"))
    )

    assert cancelled.status == "cancellation_requested"
    assert cancelled.terminate is False
    assert replay.idempotent_replay is True
    assert celery.control.revocations == [(scheduled.task_id, False)]

    status = asyncio.run(queue.get_status(scheduled.task_id))
    assert status.status == "cancelled"

    replacement = asyncio.run(
        queue.schedule_task(
            queue.ScheduleRequest(
                task="cortex_tasks.allowed",
                args=[],
                idempotency_key="replacement",
            )
        )
    )
    assert replacement.status == "scheduled"
