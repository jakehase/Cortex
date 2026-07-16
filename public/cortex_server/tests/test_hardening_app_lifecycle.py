import asyncio
import json
import logging
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import APIRouter

import cortex_server.main as main
from cortex_server.routers import websockets


def _install_minimal_routers(monkeypatch, *, failed=()):
    def load(app, *, safe_mode=True):
        async def store():
            return {"success": True}

        async def search():
            return {"results": []}

        async def orchestrate():
            return {"success": True}

        async def runtime_delivery_readiness():
            return {"ready": True}

        routes = {
            "l22": ("/l22/store", store, ["POST"]),
            "knowledge": ("/knowledge/search", search, ["GET"]),
            "nexus": ("/nexus/orchestrate", orchestrate, ["POST"]),
            "orchestrator": (
                "/orchestrator/runtime-delivery/readiness",
                runtime_delivery_readiness,
                ["GET"],
            ),
        }
        for name, (path, endpoint, methods) in routes.items():
            if name not in failed:
                app.add_api_route(path, endpoint, methods=methods)

        report = {
            "loaded": [name for name in routes if name not in failed],
            "safeModeSkipped": [],
            "failed": [
                {"router": name, "error": "ImportError: required dependency missing"}
                for name in failed
            ],
            "missingRouter": [],
        }
        app.state.router_load_report = report
        return report

    monkeypatch.setattr(main, "load_dynamic_routers", load)


def _install_included_routers(monkeypatch):
    def load(app, *, safe_mode=True):
        router = APIRouter()

        @router.post("/l22/store")
        async def store():
            return {"success": True}

        @router.get("/knowledge/search")
        async def search():
            return {"results": []}

        app.include_router(router)
        report = {
            "loaded": ["l22", "knowledge"],
            "safeModeSkipped": [],
            "failed": [],
            "missingRouter": [],
        }
        app.state.router_load_report = report
        return report

    monkeypatch.setattr(main, "load_dynamic_routers", load)


def _route(app, path):
    return next(route for route in app.routes if getattr(route, "path", None) == path).endpoint


def _import_scheduler(monkeypatch):
    real_mkdir = Path.mkdir
    monkeypatch.delenv("CORTEX_SCHEDULER_STATE_DIR", raising=False)

    def isolated_mkdir(path, *args, **kwargs):
        if str(path).startswith("/app/config"):
            return None
        return real_mkdir(path, *args, **kwargs)

    with monkeypatch.context() as import_patch:
        import_patch.setattr(Path, "mkdir", isolated_mkdir)
        import cortex_server.scheduler as scheduler
    return scheduler


class LifecycleFakes:
    def __init__(self):
        self.started = []
        self.stopped = []
        self.cancelled = []

    async def worker(self, name):
        self.started.append(name)
        try:
            await asyncio.Event().wait()
        finally:
            self.cancelled.append(name)


def test_shared_service_ownership_is_isolated_between_thread_event_loops():
    owners = main._SharedServiceOwners()
    both_started = threading.Barrier(3)
    release = [threading.Event(), threading.Event()]
    results = [{}, {}]

    def run(index):
        async def scenario():
            app = SimpleNamespace(
                state=SimpleNamespace(background_tasks=set(), lifecycle_checks={})
            )
            stopped = []

            async def worker():
                try:
                    await asyncio.Event().wait()
                finally:
                    results[index]["cancelled"] = True

            async def start():
                return asyncio.create_task(worker(), name=f"loop-{index}-service")

            await owners.acquire("chronos", app, start)
            task = next(iter(app.state.background_tasks))
            results[index].update(task=task, loop=asyncio.get_running_loop())
            both_started.wait(timeout=2)
            while not release[index].is_set():
                await asyncio.sleep(0.001)
            await owners.release("chronos", app, lambda: _record_stop(stopped))
            results[index]["stopped"] = stopped

        async def _record_stop(stopped):
            stopped.append(True)

        asyncio.run(scenario())

    threads = [threading.Thread(target=run, args=(index,)) for index in range(2)]
    for thread in threads:
        thread.start()
    both_started.wait(timeout=2)

    assert results[0]["task"] is not results[1]["task"]
    assert results[0]["task"].get_loop() is results[0]["loop"]
    assert results[1]["task"].get_loop() is results[1]["loop"]

    release[0].set()
    threads[0].join(timeout=2)
    assert not threads[0].is_alive()
    assert results[0]["task"].done()
    assert not results[1]["task"].done()

    release[1].set()
    threads[1].join(timeout=2)
    assert not threads[1].is_alive()
    assert results[1]["task"].done()
    assert results[0]["stopped"] == [True]
    assert results[1]["stopped"] == [True]
    assert owners.registry_size() == 0


def test_shared_service_registry_does_not_survive_sequential_asyncio_runs():
    owners = main._SharedServiceOwners()
    seen = []

    async def run_once():
        app = SimpleNamespace(
            state=SimpleNamespace(background_tasks=set(), lifecycle_checks={})
        )

        async def start():
            return asyncio.create_task(asyncio.Event().wait())

        await owners.acquire("awareness", app, start)
        task = next(iter(app.state.background_tasks))
        seen.append((asyncio.get_running_loop(), task))
        await owners.release("awareness", app, lambda: asyncio.sleep(0))
        assert task.done()
        assert owners.registry_size() == 0

    asyncio.run(run_once())
    asyncio.run(run_once())

    assert seen[0][0] is not seen[1][0]
    assert seen[0][1] is not seen[1][1]
    assert all(task.get_loop() is loop for loop, task in seen)


@pytest.mark.asyncio
async def test_cancelled_new_service_acquisition_rolls_back_spawned_task(monkeypatch):
    owners = main._SharedServiceOwners()
    app = SimpleNamespace(
        state=SimpleNamespace(background_tasks=set(), lifecycle_checks={})
    )
    worker_started = asyncio.Event()
    worker_cancelled = asyncio.Event()
    ownership_window = asyncio.Event()
    hold_ownership_window = asyncio.Event()
    stopped = []
    spawned = None

    async def worker():
        worker_started.set()
        try:
            await asyncio.Event().wait()
        finally:
            worker_cancelled.set()

    async def start():
        nonlocal spawned
        spawned = asyncio.create_task(worker())
        return spawned

    async def stop():
        stopped.append("awareness")

    async def pause_before_ownership(delay):
        assert delay == 0
        ownership_window.set()
        await hold_ownership_window.wait()

    monkeypatch.setattr(main.asyncio, "sleep", pause_before_ownership)

    acquisition = asyncio.create_task(
        owners.acquire("awareness", app, start, stop)
    )
    await ownership_window.wait()
    await worker_started.wait()
    acquisition.cancel()

    with pytest.raises(asyncio.CancelledError):
        await acquisition

    assert spawned.done()
    assert worker_cancelled.is_set()
    assert stopped == ["awareness"]
    assert app.state.background_tasks == set()
    assert owners.registry_size() == 0


@pytest.fixture
def lifecycle_fakes(monkeypatch, tmp_path):
    _install_minimal_routers(monkeypatch)
    monkeypatch.setenv("CORTEX_FAIL_CLOSED_MEMORY_ENDPOINTS", "false")
    monkeypatch.setenv("CORTEX_CHROMA_DIR", str(tmp_path / "chroma"))
    fakes = LifecycleFakes()
    monkeypatch.setattr(main.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0))

    import cortex_server.worker as worker
    import cortex_server.middleware.event_ledger_middleware as event_ledger
    import cortex_server.routers.librarian as librarian
    scheduler = _import_scheduler(monkeypatch)
    import cortex_server.modules.chronos as chronos
    import cortex_server.routers.awareness as awareness

    monkeypatch.setattr(worker, "check_redis_connection", lambda: True)
    monkeypatch.setattr(
        event_ledger,
        "probe_event_ledger_durability",
        lambda: {"ok": True, "status": "healthy"},
    )
    monkeypatch.setattr(
        librarian,
        "probe_memory_backend_readiness",
        lambda: {"ok": True, "status": "healthy"},
    )
    scheduler_runtime = SimpleNamespace(running=False)
    fakes.scheduler_runtime = scheduler_runtime
    monkeypatch.setattr(scheduler, "scheduler", scheduler_runtime)

    def start_scheduler():
        scheduler_runtime.running = True
        fakes.started.append("scheduler")

    async def stop_scheduler():
        scheduler_runtime.running = False
        fakes.stopped.append("scheduler")

    monkeypatch.setattr(scheduler, "start_scheduler", start_scheduler)
    monkeypatch.setattr(scheduler, "stop_scheduler", stop_scheduler)

    class Chronos:
        async def start_scheduler(self):
            await fakes.worker("chronos")

        def stop(self):
            fakes.stopped.append("chronos")

    instance = Chronos()
    monkeypatch.setattr(chronos, "get_chronos", lambda: instance)

    async def start_awareness():
        return asyncio.create_task(fakes.worker("awareness"), name="test-awareness")

    async def stop_awareness():
        fakes.stopped.append("awareness")

    monkeypatch.setattr(awareness, "start_awareness", start_awareness)
    monkeypatch.setattr(awareness, "stop_awareness", stop_awareness)
    return fakes


@pytest.mark.asyncio
async def test_repeated_lifespans_cancel_and_await_every_task(lifecycle_fakes):
    app = main.create_app()

    for _ in range(2):
        async with app.router.lifespan_context(app):
            assert len(app.state.background_tasks) == 2
            assert all(not task.done() for task in app.state.background_tasks)

        assert all(task.done() for task in app.state.background_tasks)

    assert lifecycle_fakes.cancelled.count("chronos") == 2
    assert lifecycle_fakes.cancelled.count("awareness") == 2
    assert lifecycle_fakes.stopped == [
        "awareness", "chronos", "scheduler",
        "awareness", "chronos", "scheduler",
    ]


@pytest.mark.asyncio
async def test_readiness_is_false_before_startup_and_after_shutdown(lifecycle_fakes):
    app = main.create_app()
    expected = {
        name: {"ok": False, "error": "not started"}
        for name in ("redis", "scheduler", "chronos", "awareness")
    }

    before = await _route(app, "/ready")()
    assert before.status_code == 503
    before_checks = json.loads(before.body)["checks"]
    assert {name: before_checks[name] for name in expected} == expected

    async with app.router.lifespan_context(app):
        running = await _route(app, "/ready")()
        running_payload = json.loads(running.body)
        failing_checks = {
            name: check for name, check in running_payload["checks"].items()
            if check.get("required", True) and not check.get("ok")
        }
        assert running.status_code == 200, failing_checks

    after = await _route(app, "/ready")()
    assert after.status_code == 503
    payload = json.loads(after.body)
    assert {name: payload["checks"][name] for name in expected} == expected


@pytest.mark.asyncio
async def test_one_app_shutdown_does_not_change_an_overlapping_owner_readiness(
    lifecycle_fakes,
):
    first = main.create_app()
    second = main.create_app()
    first_context = first.router.lifespan_context(first)
    second_context = second.router.lifespan_context(second)

    await first_context.__aenter__()
    await second_context.__aenter__()
    await first_context.__aexit__(None, None, None)

    assert (await _route(first, "/ready")()).status_code == 503
    assert (await _route(second, "/ready")()).status_code == 200

    await second_context.__aexit__(None, None, None)


@pytest.mark.asyncio
async def test_scheduler_unexpected_stop_degrades_every_owner_readiness(
    lifecycle_fakes,
):
    first = main.create_app()
    second = main.create_app()

    async with first.router.lifespan_context(first):
        async with second.router.lifespan_context(second):
            assert (await _route(first, "/ready")()).status_code == 200
            assert second.state.lifecycle_checks["scheduler"]["ok"] is True

            lifecycle_fakes.scheduler_runtime.running = False

            first_response, second_response = await asyncio.gather(
                _route(first, "/ready")(),
                _route(second, "/ready")(),
            )
            for response in (first_response, second_response):
                payload = json.loads(response.body)
                assert response.status_code == 503
                assert payload["checks"]["scheduler"] == {
                    "ok": False,
                    "error": "RuntimeError: scheduler is not running",
                }


def test_parser_workspace_roots_are_immutable_and_app_scoped(monkeypatch, tmp_path):
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"
    later_root = tmp_path / "later"
    for root in (first_root, second_root, later_root):
        root.mkdir()

    monkeypatch.setenv("CORTEX_WORKSPACE_ROOTS", str(first_root))
    first = main.create_app()
    monkeypatch.setenv("CORTEX_WORKSPACE_ROOTS", str(second_root))
    second = main.create_app()
    monkeypatch.setenv("CORTEX_WORKSPACE_ROOTS", str(later_root))

    assert first.state.parser_service is not second.state.parser_service
    assert first.state.parser_service.workspace_roots == (first_root.resolve(),)
    assert second.state.parser_service.workspace_roots == (second_root.resolve(),)


@pytest.mark.asyncio
async def test_overlapping_lifespans_release_only_the_final_shared_owner(
    lifecycle_fakes,
):
    first = main.create_app()
    second = main.create_app()
    first_context = first.router.lifespan_context(first)
    second_context = second.router.lifespan_context(second)

    await first_context.__aenter__()
    await second_context.__aenter__()
    shared_tasks = set(first.state.background_tasks)
    assert shared_tasks == set(second.state.background_tasks)
    assert lifecycle_fakes.started.count("scheduler") == 1
    assert lifecycle_fakes.started.count("chronos") == 1
    assert lifecycle_fakes.started.count("awareness") == 1

    await first_context.__aexit__(None, None, None)
    assert lifecycle_fakes.stopped == []
    assert all(not task.done() for task in shared_tasks)
    assert (await _route(second, "/ready")()).status_code == 200

    await second_context.__aexit__(None, None, None)
    assert lifecycle_fakes.stopped == ["awareness", "chronos", "scheduler"]
    assert all(task.done() for task in shared_tasks)


@pytest.mark.asyncio
async def test_dead_shared_service_rejects_second_owner_without_reference_corruption(
    lifecycle_fakes,
):
    first = main.create_app()
    first_context = first.router.lifespan_context(first)
    await first_context.__aenter__()

    awareness_task = next(
        task for task in first.state.background_tasks if task.get_name() == "test-awareness"
    )
    awareness_task.cancel()
    await asyncio.gather(awareness_task, return_exceptions=True)
    assert first.state.lifecycle_checks["awareness"]["ok"] is False

    second = main.create_app()
    started = time.monotonic()
    async with second.router.lifespan_context(second):
        assert time.monotonic() - started < 0.5
        assert second.state.lifecycle_checks["awareness"] == {
            "ok": False,
            "error": "SharedServiceStartupError: shared awareness service is unavailable",
        }
        assert first.state.lifecycle_checks["awareness"]["ok"] is False

    # The failed acquisition never became an owner and did not stop or restart
    # the service still owned by the first lifespan.
    assert lifecycle_fakes.started.count("awareness") == 1
    assert "awareness" not in lifecycle_fakes.stopped

    await first_context.__aexit__(None, None, None)
    assert lifecycle_fakes.stopped.count("awareness") == 1


@pytest.mark.asyncio
async def test_cancelled_second_acquisition_keeps_first_owner(
    monkeypatch, lifecycle_fakes
):
    async def run_inline(function, *args, **kwargs):
        return function(*args, **kwargs)

    # Redis startup is incidental to this ownership test. Run the fake inline
    # so cancellation timing covers only shared-service acquisition.
    monkeypatch.setattr(main.asyncio, "to_thread", run_inline)
    first = main.create_app()
    first_context = first.router.lifespan_context(first)
    await first_context.__aenter__()

    original_acquire = main._shared_service_owners.acquire

    async def cancel_at_awareness(name, app, start, rollback=None):
        if app is second and name == "awareness":
            raise asyncio.CancelledError("cancelled during second acquisition")
        return await original_acquire(name, app, start, rollback)

    monkeypatch.setattr(main._shared_service_owners, "acquire", cancel_at_awareness)
    second = main.create_app()
    with pytest.raises(asyncio.CancelledError, match="second acquisition"):
        async with second.router.lifespan_context(second):
            pytest.fail("cancelled lifespan must not yield")

    assert lifecycle_fakes.stopped == []
    assert (await _route(first, "/ready")()).status_code == 200
    assert all(not task.done() for task in first.state.background_tasks)

    await first_context.__aexit__(None, None, None)
    assert lifecycle_fakes.stopped == ["awareness", "chronos", "scheduler"]


@pytest.mark.asyncio
async def test_cancellation_during_chronos_startup_runs_full_cleanup(
    monkeypatch, lifecycle_fakes
):
    import cortex_server.modules.chronos as chronos

    class CancelledChronos:
        async def start_scheduler(self):
            raise asyncio.CancelledError("cancelled during chronos startup")

        def stop(self):
            lifecycle_fakes.stopped.append("chronos")

    monkeypatch.setattr(chronos, "get_chronos", lambda: CancelledChronos())
    app = main.create_app()

    with pytest.raises(asyncio.CancelledError, match="chronos startup"):
        async with app.router.lifespan_context(app):
            pytest.fail("lifespan must not yield")

    assert all(task.done() for task in app.state.background_tasks)
    assert lifecycle_fakes.stopped == ["chronos", "scheduler"]


@pytest.mark.asyncio
async def test_cancellation_during_awareness_startup_runs_full_cleanup(
    monkeypatch, lifecycle_fakes
):
    import cortex_server.routers.awareness as awareness

    async def cancelled_start():
        raise asyncio.CancelledError("cancelled during awareness startup")

    monkeypatch.setattr(awareness, "start_awareness", cancelled_start)
    app = main.create_app()

    with pytest.raises(asyncio.CancelledError, match="awareness startup"):
        async with app.router.lifespan_context(app):
            pytest.fail("lifespan must not yield")

    assert all(task.done() for task in app.state.background_tasks)
    assert lifecycle_fakes.cancelled == ["chronos"]
    assert lifecycle_fakes.stopped == ["chronos", "scheduler"]


@pytest.mark.asyncio
async def test_fail_closed_startup_handles_routes_added_by_included_routers(
    monkeypatch, lifecycle_fakes
):
    _install_included_routers(monkeypatch)
    monkeypatch.setenv("CORTEX_FAIL_CLOSED_MEMORY_ENDPOINTS", "true")
    app = main.create_app()

    async with app.router.lifespan_context(app):
        assert app.state.lifecycle_checks["redis"]["ok"] is True


@pytest.mark.asyncio
async def test_failed_redis_connectivity_is_not_ready_and_never_logs_success(
    monkeypatch, lifecycle_fakes, caplog
):
    import cortex_server.worker as worker

    monkeypatch.setattr(worker, "check_redis_connection", lambda: False)
    app = main.create_app()
    caplog.set_level(logging.INFO, logger="cortex_server.main")

    async with app.router.lifespan_context(app):
        response = await _route(app, "/ready")()
        body = response.body.decode()
        assert response.status_code == 503
        assert '"status":"not_ready"' in body
        assert app.state.lifecycle_checks["redis"]["ok"] is False
        assert "connectivity check did not confirm readiness" in app.state.lifecycle_checks["redis"]["error"]

    assert "Redis is reachable for background task processing" not in caplog.text
    assert "Redis is not ready" in caplog.text


@pytest.mark.asyncio
async def test_redis_monitor_degrades_and_recovers_readiness(
    monkeypatch, lifecycle_fakes
):
    import cortex_server.worker as worker

    reachable = True
    checked = threading.Event()

    def check():
        checked_loop = reachable
        if not checked_loop:
            checked.set()
        return checked_loop

    monkeypatch.setattr(worker, "check_redis_connection", check)
    monkeypatch.setenv("CORTEX_REDIS_MONITOR_INTERVAL_SECONDS", "0.1")
    app = main.create_app()

    async with app.router.lifespan_context(app):
        assert (await _route(app, "/ready")()).status_code == 200
        reachable = False
        deadline = time.monotonic() + 1
        while not checked.is_set() and time.monotonic() < deadline:
            await asyncio.sleep(0.01)
        assert checked.is_set()
        while (
            app.state.lifecycle_checks["redis"]["ok"]
            and time.monotonic() < deadline
        ):
            await asyncio.sleep(0.01)
        assert app.state.lifecycle_checks["redis"]["ok"] is False
        assert (await _route(app, "/ready")()).status_code == 503
        assert "did not confirm readiness" in app.state.lifecycle_checks["redis"]["error"]

        checked.clear()
        reachable = True
        deadline = time.monotonic() + 1
        while (
            not app.state.lifecycle_checks["redis"]["ok"]
            and time.monotonic() < deadline
        ):
            await asyncio.sleep(0.01)
        assert app.state.lifecycle_checks["redis"]["ok"] is True
        assert (await _route(app, "/ready")()).status_code == 200


@pytest.mark.asyncio
async def test_redis_monitor_is_cancelled_and_awaited_on_shutdown(
    monkeypatch, lifecycle_fakes
):
    monkeypatch.setenv("CORTEX_REDIS_MONITOR_INTERVAL_SECONDS", "0.1")
    app = main.create_app()

    async with app.router.lifespan_context(app):
        monitor = next(
            task for task in asyncio.all_tasks()
            if task.get_name() == "cortex-redis-monitor"
        )
        assert not monitor.done()

    assert monitor.done()
    assert monitor.cancelled()


@pytest.mark.asyncio
async def test_redis_monitor_shutdown_waits_for_inflight_connectivity_check(
    monkeypatch, lifecycle_fakes
):
    import cortex_server.worker as worker

    entered = threading.Event()
    release = threading.Event()
    exited = threading.Event()
    checks = 0

    def check_redis():
        nonlocal checks
        checks += 1
        if checks == 1:
            return True
        entered.set()
        release.wait(1)
        exited.set()
        return True

    monkeypatch.setattr(worker, "check_redis_connection", check_redis)
    monkeypatch.setenv("CORTEX_REDIS_MONITOR_INTERVAL_SECONDS", "0.1")
    app = main.create_app()
    context = app.router.lifespan_context(app)
    await context.__aenter__()

    deadline = time.monotonic() + 1
    while not entered.is_set() and time.monotonic() < deadline:
        await asyncio.sleep(0.01)
    assert entered.is_set()

    shutdown = asyncio.create_task(context.__aexit__(None, None, None))
    await asyncio.sleep(0.05)
    assert not shutdown.done()
    assert not exited.is_set()
    assert any(
        task.get_name() == "cortex-redis-connectivity-check"
        for task in asyncio.all_tasks()
    )

    release.set()
    await asyncio.wait_for(shutdown, timeout=1)
    assert exited.is_set()


@pytest.mark.asyncio
async def test_redis_startup_timeout_does_not_block_loop_or_cleanup(
    monkeypatch, lifecycle_fakes
):
    entered = threading.Event()
    release = threading.Event()

    def blocked_redis(*args, **kwargs):
        entered.set()
        release.wait(1)
        return SimpleNamespace(returncode=0)

    monkeypatch.setenv("CORTEX_REDIS_STARTUP_TIMEOUT_SECONDS", "0.1")
    monkeypatch.setattr(main.subprocess, "run", blocked_redis)
    app = main.create_app()
    ticks = 0

    async def ticker():
        nonlocal ticks
        while not entered.is_set():
            await asyncio.sleep(0)
        deadline = time.monotonic() + 0.05
        while time.monotonic() < deadline:
            ticks += 1
            await asyncio.sleep(0)

    ticker_task = asyncio.create_task(ticker())
    try:
        async with app.router.lifespan_context(app):
            assert app.state.lifecycle_checks["redis"] == {
                "ok": False,
                "error": "Redis startup timed out after 0.1 seconds",
            }
            assert ticks > 0
    finally:
        release.set()
        await ticker_task

    assert lifecycle_fakes.stopped == ["awareness", "chronos", "scheduler"]


@pytest.mark.asyncio
async def test_redis_timeout_worker_is_retained_and_observed_during_cleanup(
    monkeypatch, lifecycle_fakes
):
    entered = threading.Event()
    release = threading.Event()
    exited = threading.Event()

    def blocked_redis(*args, **kwargs):
        entered.set()
        release.wait(1)
        exited.set()
        return SimpleNamespace(returncode=0)

    monkeypatch.setenv("CORTEX_REDIS_STARTUP_TIMEOUT_SECONDS", "0.1")
    monkeypatch.setattr(main.subprocess, "run", blocked_redis)
    app = main.create_app()

    async def release_worker():
        while not entered.is_set():
            await asyncio.sleep(0)
        await asyncio.sleep(0.15)
        release.set()

    releaser = asyncio.create_task(release_worker())
    async with app.router.lifespan_context(app):
        assert app.state.lifecycle_checks["redis"]["ok"] is False
    await releaser
    assert exited.is_set()


@pytest.mark.asyncio
async def test_redis_timeout_recovers_and_installs_connectivity_monitor(
    monkeypatch, lifecycle_fakes
):
    import cortex_server.worker as worker

    entered = threading.Event()
    release = threading.Event()
    reachable = True

    def blocked_redis(*args, **kwargs):
        entered.set()
        release.wait(1)
        return SimpleNamespace(returncode=0)

    def check_redis():
        return reachable

    monkeypatch.setenv("CORTEX_REDIS_STARTUP_TIMEOUT_SECONDS", "0.1")
    monkeypatch.setenv("CORTEX_REDIS_MONITOR_INTERVAL_SECONDS", "0.1")
    monkeypatch.setattr(main.subprocess, "run", blocked_redis)
    monkeypatch.setattr(worker, "check_redis_connection", check_redis)
    app = main.create_app()

    async with app.router.lifespan_context(app):
        assert entered.is_set()
        assert app.state.lifecycle_checks["redis"]["ok"] is False
        monitor = next(
            task for task in asyncio.all_tasks()
            if task.get_name() == "cortex-redis-monitor"
        )
        assert not monitor.done()

        release.set()
        deadline = time.monotonic() + 1
        while (
            not app.state.lifecycle_checks["redis"]["ok"]
            and time.monotonic() < deadline
        ):
            await asyncio.sleep(0.01)
        assert app.state.lifecycle_checks["redis"] == {"ok": True, "error": None}

        reachable = False
        deadline = time.monotonic() + 1
        while (
            app.state.lifecycle_checks["redis"]["ok"]
            and time.monotonic() < deadline
        ):
            await asyncio.sleep(0.01)
        assert app.state.lifecycle_checks["redis"]["ok"] is False
        assert "connectivity check did not confirm readiness" in (
            app.state.lifecycle_checks["redis"]["error"]
        )

    assert monitor.cancelled()


@pytest.mark.asyncio
async def test_partial_startup_failure_still_cleans_up_started_components(
    monkeypatch, lifecycle_fakes
):
    import cortex_server.modules.chronos as chronos

    class BrokenChronos:
        async def start_scheduler(self):
            raise RuntimeError("chronos boot failed")

        def stop(self):
            lifecycle_fakes.stopped.append("chronos")

    monkeypatch.setattr(chronos, "get_chronos", lambda: BrokenChronos())
    app = main.create_app()

    async with app.router.lifespan_context(app):
        assert app.state.lifecycle_checks["chronos"] == {
            "ok": False,
            "error": "RuntimeError: chronos boot failed",
        }
        assert app.state.lifecycle_checks["awareness"]["ok"] is True

    assert lifecycle_fakes.cancelled == ["awareness"]
    assert lifecycle_fakes.stopped == ["chronos", "awareness", "scheduler"]


@pytest.mark.asyncio
async def test_late_background_task_crash_immediately_degrades_readiness(
    monkeypatch, lifecycle_fakes
):
    import cortex_server.modules.chronos as chronos

    crash = asyncio.Event()

    class LateCrashChronos:
        async def start_scheduler(self):
            lifecycle_fakes.started.append("chronos")
            await crash.wait()
            raise RuntimeError("chronos late crash")

        def stop(self):
            lifecycle_fakes.stopped.append("chronos")

    monkeypatch.setattr(chronos, "get_chronos", lambda: LateCrashChronos())
    app = main.create_app()

    async with app.router.lifespan_context(app):
        assert (await _route(app, "/ready")()).status_code == 200
        crash.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)

        response = await _route(app, "/ready")()
        payload = json.loads(response.body)
        assert response.status_code == 503
        assert payload["checks"]["chronos"] == {
            "ok": False,
            "error": "RuntimeError: chronos late crash",
        }


@pytest.mark.asyncio
async def test_required_router_import_failure_degrades_readiness(monkeypatch, lifecycle_fakes):
    _install_minimal_routers(monkeypatch, failed=("knowledge",))
    app = main.create_app()

    async with app.router.lifespan_context(app):
        response = await _route(app, "/ready")()
        assert response.status_code == 503
        payload = json.loads(response.body)
        assert payload["ready"] is False
        assert payload["checks"]["requiredRouters"] == {"ok": False, "missing": ["knowledge"]}
        assert payload["checks"]["routerImports"]["ok"] is False
        assert payload["checks"]["routerImports"]["failed"][0]["router"] == "knowledge"


@pytest.mark.asyncio
async def test_production_nexus_baseline_cannot_be_removed_by_configuration(
    monkeypatch, lifecycle_fakes
):
    import cortex_server.runtime.production_build_loop as production_build_loop

    monkeypatch.setattr(main, "_production_environment", lambda: True)
    monkeypatch.setattr(
        production_build_loop,
        "validate_production_delivery_credentials",
        lambda: {"ok": True},
    )
    monkeypatch.setenv("CORTEX_REQUIRED_PATHS", "")
    monkeypatch.setenv("CORTEX_REQUIRED_ROUTERS", "")
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps(
            {
                "reader": {
                    "secret": "principal-secret-00000000000000000001",
                    "allowed_scopes": [
                        {
                            "tenant_id": "tenant-a",
                            "workspace_id": "workspace-a",
                            "agent_id": "agent-a",
                            "user_id": "user-a",
                            "channel_id": "channel-a",
                            "session_id": "session-a",
                        }
                    ],
                }
            }
        ),
    )
    _install_minimal_routers(monkeypatch, failed=("nexus",))
    app = main.create_app()

    assert "/nexus/orchestrate" in app.state.readiness_config.required_paths
    assert (
        "/orchestrator/runtime-delivery/readiness"
        in app.state.readiness_config.required_paths
    )
    assert {"nexus", "orchestrator"}.issubset(
        app.state.readiness_config.required_routers
    )

    async with app.router.lifespan_context(app):
        response = await _route(app, "/ready")()
        payload = json.loads(response.body)

    assert response.status_code == 503
    assert payload["checks"]["requiredPaths"] == {
        "ok": False,
        "missing": ["/nexus/orchestrate"],
    }
    assert payload["checks"]["requiredRouters"] == {
        "ok": False,
        "missing": ["nexus"],
    }
    assert payload["checks"]["routerImports"] == {
        "ok": False,
        "failed": [
            {
                "router": "nexus",
                "error": "ImportError: required dependency missing",
            }
        ],
    }


@pytest.mark.asyncio
async def test_canonical_readiness_requires_runtime_delivery_probe_in_production(monkeypatch, lifecycle_fakes):
    import cortex_server.runtime.production_build_loop as production_build_loop

    monkeypatch.setattr(main, "_production_environment", lambda: True)
    monkeypatch.setattr(production_build_loop, "validate_production_delivery_credentials", lambda: {"ok": True})
    monkeypatch.setattr(
        production_build_loop,
        "probe_runtime_delivery_readiness",
        lambda _root: {"ready": False, "status": "not_ready", "checks": {"durableMount": {"ok": False}}},
    )
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps({
            "reader": {
                "secret": "principal-secret-00000000000000000001",
                "allowed_scopes": [{
                    "tenant_id": "tenant-a",
                    "workspace_id": "workspace-a",
                    "agent_id": "agent-a",
                    "user_id": "user-a",
                    "channel_id": "channel-a",
                    "session_id": "session-a",
                }],
            }
        }),
    )
    app = main.create_app()

    async with app.router.lifespan_context(app):
        response = await _route(app, "/ready")()
        payload = json.loads(response.body)
        assert response.status_code == 503
        assert payload["checks"]["runtimeDelivery"]["required"] is True
        assert payload["checks"]["runtimeDelivery"]["ok"] is False
        assert payload["checks"]["runtimeDelivery"]["checks"]["durableMount"]["ok"] is False


@pytest.mark.asyncio
async def test_public_readiness_probe_never_blocks_the_event_loop(monkeypatch, lifecycle_fakes):
    import cortex_server.runtime.production_build_loop as production_build_loop

    entered = threading.Event()
    release = threading.Event()
    probe_calls = []

    def blocking_probe(_root):
        probe_calls.append(True)
        entered.set()
        assert release.wait(1)
        return {"ready": True, "status": "ready", "checks": {}}

    monkeypatch.setattr(production_build_loop, "probe_runtime_delivery_readiness", blocking_probe)
    app = main.create_app()
    readiness = asyncio.create_task(_route(app, "/ready")())
    assert await asyncio.to_thread(entered.wait, 0.5)

    ticks = 0
    for _ in range(5):
        await asyncio.sleep(0)
        ticks += 1
    assert ticks == 5
    assert readiness.done() is False

    release.set()
    response = await asyncio.wait_for(readiness, timeout=1)
    assert response.status_code in {200, 503}
    cached = await asyncio.wait_for(_route(app, "/ready")(), timeout=0.2)
    assert cached.status_code == response.status_code
    assert len(probe_calls) == 1


@pytest.mark.asyncio
async def test_readiness_policy_is_immutable_per_factory(monkeypatch, lifecycle_fakes):
    _install_minimal_routers(monkeypatch)
    monkeypatch.setenv("CORTEX_REQUIRED_PATHS", "/l22/store")
    monkeypatch.setenv("CORTEX_REQUIRED_ROUTERS", "l22")
    first = main.create_app()

    monkeypatch.setenv("CORTEX_REQUIRED_PATHS", "/absent")
    monkeypatch.setenv("CORTEX_REQUIRED_ROUTERS", "absent")
    second = main.create_app()

    async with first.router.lifespan_context(first), second.router.lifespan_context(second):
        first_payload = json.loads((await _route(first, "/ready")()).body)
        second_payload = json.loads((await _route(second, "/ready")()).body)

    assert first_payload["checks"]["requiredPaths"] == {"ok": True, "missing": []}
    assert first_payload["checks"]["requiredRouters"] == {"ok": True, "missing": []}
    assert second_payload["checks"]["requiredPaths"] == {"ok": False, "missing": ["/absent"]}
    assert second_payload["checks"]["requiredRouters"] == {"ok": False, "missing": ["absent"]}
    assert isinstance(first.state.readiness_config.required_paths, frozenset)


@pytest.mark.asyncio
async def test_each_factory_captures_current_security_and_cors_environment(monkeypatch):
    _install_minimal_routers(monkeypatch)
    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "token_required")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "first-secret")
    monkeypatch.setenv("CORTEX_ALLOW_ORIGINS", "https://first.example")
    first = main.create_app()

    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "second-secret")
    monkeypatch.setenv("CORTEX_ALLOW_ORIGINS", "https://second.example")
    second = main.create_app()

    first_capabilities = await _route(first, "/capabilities")()
    second_capabilities = await _route(second, "/capabilities")()
    assert first_capabilities["security"]["writeTokenConfigured"] is True
    assert second_capabilities["security"]["writeTokenConfigured"] is True
    first_cors = next(m for m in first.user_middleware if m.cls.__name__ == "CORSMiddleware")
    second_cors = next(m for m in second.user_middleware if m.cls.__name__ == "CORSMiddleware")
    assert first_cors.kwargs["allow_origins"] == ["https://first.example"]
    assert second_cors.kwargs["allow_origins"] == ["https://second.example"]
    assert first.openapi()["components"]["securitySchemes"]["CortexWriteToken"]["name"] == "x-cortex-write-token"
    assert first is not second


def test_websocket_authorization_ignores_post_construction_environment_mutation(
    monkeypatch
):
    _install_minimal_routers(monkeypatch)
    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "token_required")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "captured-secret")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN_HEADER", "x-captured-token")
    monkeypatch.setenv("CORTEX_ADMIN_TOKEN", "captured-admin-secret")
    monkeypatch.setenv("CORTEX_ALLOW_ORIGINS", "https://captured.example")
    app = main.create_app()

    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "disabled")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "mutated-secret")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN_HEADER", "x-mutated-token")
    monkeypatch.setenv("CORTEX_ADMIN_TOKEN", "mutated-admin-secret")
    monkeypatch.setenv("CORTEX_ALLOW_ORIGINS", "https://mutated.example")

    def socket(*, origin, token):
        return SimpleNamespace(
            app=app,
            headers={"origin": origin, "x-cortex-admin-token": token},
            client=SimpleNamespace(host="203.0.113.10"),
        )

    authorized = socket(
        origin="https://captured.example", token="captured-admin-secret"
    )
    assert websockets._allowed_websocket_origin(authorized) is True
    assert websockets._log_websocket_authorized(authorized) is True

    mutated = socket(origin="https://mutated.example", token="mutated-admin-secret")
    assert websockets._allowed_websocket_origin(mutated) is False
    assert websockets._log_websocket_authorized(mutated) is False


@pytest.mark.asyncio
async def test_awareness_shutdown_resets_all_per_lifespan_globals(monkeypatch):
    import cortex_server.routers.awareness as awareness

    cancelled = asyncio.Event()

    async def running_loop():
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    awareness._started = True
    awareness._loop_running = True
    awareness._loop_task = asyncio.create_task(running_loop())
    awareness._memory = object()
    awareness._pending_insights = [{"secret": "stale"}]
    awareness._tools_last_queried = {"oracle": 123}
    stale_wonder_chain = ["oracle"]
    stale_wonder_findings = ["stale finding"]
    awareness._wonder_state = {
        "active_wonder": "stale question",
        "wonder_ticks": 7,
        "wonder_max_ticks": 10,
        "wonder_chain": stale_wonder_chain,
        "wonder_findings": stale_wonder_findings,
    }
    awareness._last_index_at = time.time()
    await asyncio.sleep(0)

    await awareness.stop_awareness()

    assert cancelled.is_set()
    assert awareness._started is False
    assert awareness._loop_running is False
    assert awareness._loop_task is None
    assert awareness._memory is None
    assert awareness._pending_insights == []
    assert awareness._tools_last_queried == {}
    assert awareness._wonder_state == {
        "active_wonder": None,
        "wonder_ticks": 0,
        "wonder_max_ticks": 10,
        "wonder_chain": [],
        "wonder_findings": [],
    }
    assert awareness._wonder_state["wonder_chain"] is not stale_wonder_chain
    assert awareness._wonder_state["wonder_findings"] is not stale_wonder_findings
    assert awareness._is_wondering() is False
    assert awareness._last_index_at == 0.0
    assert awareness._should_auto_index() is True


@pytest.mark.asyncio
async def test_awareness_restart_has_exactly_one_bus_subscription(monkeypatch):
    import cortex_server.routers.awareness as awareness
    from cortex_server.modules.unified_messaging import ConsciousnessBus

    bus = ConsciousnessBus()
    monkeypatch.setattr(awareness, "get_bus", lambda: bus)
    monkeypatch.setattr(awareness, "_bootstrap_autonomous_cognition", lambda wm: asyncio.sleep(0))

    async def running_loop():
        await asyncio.Event().wait()

    monkeypatch.setattr(awareness, "awareness_loop", running_loop)
    awareness._started = False
    awareness._loop_task = None
    awareness._subscribed_bus = None

    await awareness.start_awareness()
    await awareness.start_awareness()
    assert len(bus._subscribers) == 1
    await awareness.stop_awareness()
    assert bus._subscribers == []

    await awareness.start_awareness()
    assert len(bus._subscribers) == 1
    await awareness.stop_awareness()
    assert bus._subscribers == []


@pytest.mark.asyncio
async def test_scheduler_shutdown_waits_and_next_start_uses_fresh_scheduler(monkeypatch):
    scheduler = _import_scheduler(monkeypatch)

    calls = []

    class FakeScheduler:
        def __init__(self, **kwargs):
            self.running = False
            self.listeners = []

        def add_listener(self, callback, mask):
            self.listeners.append(callback)

        def remove_listener(self, callback):
            self.listeners.remove(callback)

        def start(self):
            self.running = True
            calls.append("start")

        def shutdown(self, *, wait):
            calls.append(("shutdown", wait))
            asyncio.get_running_loop().call_soon(self._finish_shutdown)

        def _finish_shutdown(self):
            calls.append("shutdown complete")
            self.running = False
            for listener in list(self.listeners):
                listener(None)

    original = FakeScheduler()
    monkeypatch.setattr(scheduler, "scheduler", original)
    monkeypatch.setattr(scheduler, "_scheduler_was_shutdown", False)
    monkeypatch.setattr(scheduler, "_scheduler_shutdown_pending", False)
    monkeypatch.setattr(scheduler, "AsyncIOScheduler", FakeScheduler)

    scheduler.start_scheduler()
    await scheduler.stop_scheduler()
    scheduler.start_scheduler()

    assert calls == ["start", ("shutdown", True), "shutdown complete", "start"]
    assert scheduler.scheduler is not original
    assert scheduler.scheduler.running is True


@pytest.mark.asyncio
async def test_scheduler_cannot_restart_while_shutdown_callback_is_pending(monkeypatch):
    scheduler = _import_scheduler(monkeypatch)
    restart_errors = []

    class FakeScheduler:
        def __init__(self, **kwargs):
            self.running = False
            self.listeners = []

        def add_listener(self, callback, mask):
            self.listeners.append(callback)

        def remove_listener(self, callback):
            self.listeners.remove(callback)

        def start(self):
            self.running = True

        def shutdown(self, *, wait):
            loop = asyncio.get_running_loop()
            loop.call_soon(attempt_restart)
            loop.call_soon(self._finish_shutdown)

        def _finish_shutdown(self):
            self.running = False
            for listener in list(self.listeners):
                listener(None)

    def attempt_restart():
        try:
            scheduler.start_scheduler()
        except RuntimeError as exc:
            restart_errors.append(str(exc))

    original = FakeScheduler()
    monkeypatch.setattr(scheduler, "scheduler", original)
    monkeypatch.setattr(scheduler, "_scheduler_was_shutdown", False)
    monkeypatch.setattr(scheduler, "_scheduler_shutdown_pending", False)
    monkeypatch.setattr(scheduler, "AsyncIOScheduler", FakeScheduler)

    scheduler.start_scheduler()
    await scheduler.stop_scheduler()
    scheduler.start_scheduler()

    assert restart_errors == ["scheduler shutdown is still in progress"]
    assert scheduler.scheduler is not original
    assert scheduler.scheduler.running is True
