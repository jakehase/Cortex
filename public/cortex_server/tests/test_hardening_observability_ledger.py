import asyncio
import json
import logging
import multiprocessing
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi import Request
from fastapi.responses import JSONResponse

import cortex_server.middleware.event_ledger_middleware as ledger
import cortex_server.middleware.observability as observability
import cortex_server.modules.metrics_store as metrics


def _multiprocess_ledger_writer(path: str, worker: int, records: int) -> None:
    # Process-local module globals deliberately model independent server workers.
    ledger.EVENT_LEDGER_PATH = path
    ledger.EVENT_LEDGER_MAX_BYTES = 10_000_000
    ledger.EVENT_LEDGER_LOCK_TIMEOUT_SECONDS = 5.0
    for sequence in range(records):
        ledger._append_event({"worker": worker, "sequence": sequence})


@pytest.fixture
def clean_metrics(monkeypatch):
    with metrics._LOCK:
        metrics._REQUEST_TOTAL = 0
        metrics._EVENT_LEDGER_DURABLE_WRITE_DROPS = 0
        metrics._ROUTE_TOTAL.clear()
        metrics._METHOD_TOTAL.clear()
        metrics._STATUS_TOTAL.clear()
        metrics._ROUTE_LATENCY_SUM_MS.clear()
        metrics._ROUTE_LATENCY_MAX_MS.clear()
        metrics._RECENT.clear()
    monkeypatch.setattr(metrics, "_MAX_ROUTES", 5)
    yield
    with metrics._LOCK:
        metrics._EVENT_LEDGER_DURABLE_WRITE_DROPS = 0
        metrics._ROUTE_TOTAL.clear()
        metrics._METHOD_TOTAL.clear()
        metrics._STATUS_TOTAL.clear()
        metrics._ROUTE_LATENCY_SUM_MS.clear()
        metrics._ROUTE_LATENCY_MAX_MS.clear()
        metrics._RECENT.clear()


def _request(path: str, query: bytes = b"") -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
            "path": path,
            "query_string": query,
            "headers": [],
        }
    )


def _observe(path: str, route_template=None, status_code=200):
    middleware = observability.ObservabilityMiddleware(app=lambda scope, receive, send: None)
    request = _request(path)

    async def application(inner_request):
        if route_template is not None:
            inner_request.scope["route"] = SimpleNamespace(path=route_template)
        return JSONResponse({"path": path}, status_code=status_code)

    return asyncio.run(middleware.dispatch(request, application))


def test_parameterized_routes_use_template_and_preserve_metric_fields(clean_metrics):
    first = _observe("/widgets/alpha", "/widgets/{widget_id}")
    second = _observe("/widgets/beta", "/widgets/{widget_id}")

    assert first.status_code == second.status_code == 200
    assert "X-Process-Time-Ms" in first.headers
    snapshot = metrics.snapshot_metrics()
    assert snapshot["requests_total"] == 2
    assert snapshot["top_routes"] == [{"path": "/widgets/{widget_id}", "count": 2}]
    assert snapshot["methods"] == {"GET": 2}
    assert snapshot["status_codes"] == {"200": 2}
    assert snapshot["recent"][-1].keys() >= {
        "ts", "path", "method", "status", "latency_ms", "request_id"
    }


def test_unique_404_flood_collapses_to_one_fallback_metric(clean_metrics):
    for number in range(75):
        response = _observe(f"/attacker-controlled/{number}", status_code=404)
        assert response.status_code == 404

    snapshot = metrics.snapshot_metrics()
    assert snapshot["requests_total"] == 75
    assert snapshot["top_routes"] == [{"path": "<unmatched>", "count": 75}]
    assert {row["path"] for row in snapshot["recent"]} == {"<unmatched>"}


def test_direct_metric_cardinality_is_capped_and_queries_are_removed(clean_metrics):
    for number in range(100):
        metrics.record_http_request(
            f"/route-{number}?api_key=value-{number}", "get", 200, number, f"rid-{number}"
        )

    with metrics._LOCK:
        route_counts = dict(metrics._ROUTE_TOTAL)
    assert len(route_counts) <= metrics._MAX_ROUTES
    assert route_counts["<other>"] == 96
    assert all("?" not in route for route in route_counts)
    assert metrics.snapshot_metrics()["recent"][-1]["request_id"] == "rid-99"


def test_request_method_metric_cardinality_is_bounded(clean_metrics):
    for method in ("get", "POST", "PATCH", *(f"ATTACK-{number}" for number in range(100))):
        metrics.record_http_request("/method-test", method, 200, 1)

    snapshot = metrics.snapshot_metrics()
    assert snapshot["methods"] == {"GET": 1, "POST": 1, "PATCH": 1, "OTHER": 100}
    assert len(snapshot["methods"]) <= len(metrics._STANDARD_HTTP_METHODS) + 1
    assert snapshot["recent"][-1]["method"] == "OTHER"
    assert 'method="ATTACK-' not in metrics.render_prometheus()


def test_status_code_metric_cardinality_is_fixed_for_arbitrary_values(clean_metrics):
    metrics.record_http_request("/status-test", "GET", 200, 1)
    metrics.record_http_request("/status-test", "GET", 404, 1)
    for status in range(1000, 1100):
        metrics.record_http_request("/status-test", "GET", status, 1)

    snapshot = metrics.snapshot_metrics()
    assert snapshot["status_codes"] == {"200": 1, "404": 1, "OTHER": 100}
    assert len(snapshot["status_codes"]) == 3
    rendered = metrics.render_prometheus()
    assert 'status="OTHER"' in rendered
    assert 'status="1000"' not in rendered


def test_metrics_and_logging_failures_do_not_replace_success_response(monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("telemetry is unavailable")

    monkeypatch.setattr(observability, "record_http_request", fail)
    monkeypatch.setattr(observability.logger, "info", fail)

    response = _observe("/widgets/still-works", "/widgets/{widget_id}")

    assert response.status_code == 200
    assert json.loads(response.body) == {"path": "/widgets/still-works"}


def test_base_exception_from_metrics_does_not_replace_success_response(monkeypatch):
    def fail(*args, **kwargs):
        raise KeyboardInterrupt("telemetry interrupted")

    monkeypatch.setattr(observability, "record_http_request", fail)

    response = _observe("/widgets/still-works", "/widgets/{widget_id}")

    assert response.status_code == 200
    assert json.loads(response.body) == {"path": "/widgets/still-works"}


def test_observability_preserves_original_exception_when_handlers_fail(monkeypatch):
    original = LookupError("application failure")

    def fail(*args, **kwargs):
        raise RuntimeError("telemetry failure")

    monkeypatch.setattr(observability, "record_http_request", fail)
    monkeypatch.setattr(observability.logger, "info", fail)
    middleware = observability.ObservabilityMiddleware(app=lambda scope, receive, send: None)
    request = Request({"type": "http", "method": "GET", "path": "/boom", "headers": []})

    async def application(_request):
        raise original

    with pytest.raises(LookupError) as caught:
        asyncio.run(middleware.dispatch(request, application))
    assert caught.value is original


def test_base_exception_from_logging_handler_preserves_original_exception(monkeypatch):
    original = LookupError("application failure")

    class InterruptingHandler(logging.Handler):
        def emit(self, record):
            raise KeyboardInterrupt("logging interrupted")

    handler = InterruptingHandler()
    monkeypatch.setattr(observability.logger, "level", logging.INFO)
    observability.logger.addHandler(handler)
    middleware = observability.ObservabilityMiddleware(app=lambda scope, receive, send: None)
    request = Request({"type": "http", "method": "GET", "path": "/boom", "headers": []})

    async def application(_request):
        raise original

    try:
        with pytest.raises(LookupError) as caught:
            asyncio.run(middleware.dispatch(request, application))
    finally:
        observability.logger.removeHandler(handler)
    assert caught.value is original


def test_sensitive_and_signed_url_query_values_are_redacted_in_durable_ledger(
    monkeypatch, tmp_path
):
    path = tmp_path / "events.jsonl"
    monkeypatch.setattr(ledger, "EVENT_LEDGER_PATH", str(path))
    monkeypatch.setattr(ledger, "EVENT_LEDGER_MAX_BYTES", 100_000)

    query = (
        b"view=summary&token=top-secret&X-Amz-Signature=signed-value"
        b"&sig=short-signature&password=hunter2&empty="
    )
    request = _request("/ok", query)
    request.state.request_id = "request-123"
    request.state.lane = "safe-lane"
    middleware = ledger.EventLedgerMiddleware(app=lambda scope, receive, send: None)

    async def application(_request):
        return JSONResponse({"ok": True})

    response = asyncio.run(middleware.dispatch(request, application))

    assert response.status_code == 200
    assert response.headers["x-cortex-event-id"]
    event = json.loads(path.read_text(encoding="utf-8"))
    assert event["request_id"] == "request-123"
    assert event["lane"] == "safe-lane"
    assert event["path"] == "/ok"
    assert event["status_code"] == 200
    assert event["query"] == (
        "view=summary&token=%5BREDACTED%5D&X-Amz-Signature=%5BREDACTED%5D"
        "&sig=%5BREDACTED%5D&password=%5BREDACTED%5D&empty="
    )
    durable_text = path.read_text(encoding="utf-8")
    assert not {"top-secret", "signed-value", "short-signature", "hunter2"} & set(
        durable_text.split()
    )
    for secret in ("top-secret", "signed-value", "short-signature", "hunter2"):
        assert secret not in durable_text


def test_credentials_inside_url_valued_query_parameters_are_redacted(monkeypatch, tmp_path):
    path = tmp_path / "events.jsonl"
    monkeypatch.setattr(ledger, "EVENT_LEDGER_PATH", str(path))
    monkeypatch.setattr(ledger, "EVENT_LEDGER_MAX_BYTES", 100_000)
    query = (
        b"redirect=https%3A%2F%2Fexample.test%2Fcallback%3Fview%3Dsummary%26"
        b"X-Amz-Signature%3Dnested-secret%26empty%3D"
        b"&return_to=%2Fordinary%2Fpath%3Fsignature%3Dnot-a-url"
    )
    request = _request("/ok", query)
    middleware = ledger.EventLedgerMiddleware(app=lambda scope, receive, send: None)

    async def application(_request):
        return JSONResponse({"ok": True})

    assert asyncio.run(middleware.dispatch(request, application)).status_code == 200

    event = json.loads(path.read_text(encoding="utf-8"))
    assert event["query"] == (
        "redirect=https%3A%2F%2Fexample.test%2Fcallback%3Fview%3Dsummary%26"
        "X-Amz-Signature%3D%255BREDACTED%255D%26empty%3D"
        "&return_to=%2Fordinary%2Fpath%3Fsignature%3Dnot-a-url"
    )
    assert "nested-secret" not in path.read_text(encoding="utf-8")


def test_nested_url_credentials_are_redacted_recursively():
    query = (
        "redirect=https%3A%2F%2Fexample.test%2Fcontinue%3Fnext%3D"
        "https%253A%252F%252Fstorage.test%252Fobject%253FX-Amz-Credential%253Ddeep-secret"
    )

    sanitized = ledger._safe_query(query)

    assert "deep-secret" not in sanitized
    assert "%25255BREDACTED%25255D" in sanitized


@pytest.mark.parametrize(
    "url",
    (
        "HTTPS://example.test/path?token=case-secret",
        "//example.test/path?api-key=relative-secret",
    ),
)
def test_url_value_detection_cannot_bypass_redaction_with_url_spelling(url):
    sanitized = ledger._safe_query("next=" + url)

    assert "secret" not in sanitized
    assert "%255BREDACTED%255D" in sanitized


def test_append_failure_is_non_disruptive_and_event_stays_in_bounded_memory(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(ledger, "EVENT_LEDGER_PATH", str(tmp_path / "unwritable" / "events.jsonl"))
    monkeypatch.setattr(ledger.os, "makedirs", lambda *args, **kwargs: (_ for _ in ()).throw(OSError("disk full")))
    ledger._recent_events.clear()
    entry = {"event_id": "kept-in-memory", "ts_unix": time.time()}

    ledger._append_event(entry)

    assert list(ledger._recent_events)[-1] is entry


def test_concurrent_in_memory_reads_and_worker_appends_are_safe(monkeypatch, tmp_path):
    monkeypatch.setattr(ledger, "EVENT_LEDGER_PATH", str(tmp_path / "events.jsonl"))
    monkeypatch.setattr(ledger, "EVENT_LEDGER_MAX_BYTES", 10_000_000)
    with ledger._recent_events_lock:
        ledger._recent_events.clear()
    errors = []

    def writer(worker):
        try:
            for sequence in range(200):
                ledger._append_event({
                    "worker": worker,
                    "sequence": sequence,
                    "ts_unix": time.time(),
                    "status_code": 200,
                    "latency_ms": sequence,
                })
        except BaseException as exc:
            errors.append(exc)

    def reader():
        try:
            for _ in range(300):
                ledger.get_recent_events(seconds=60, limit=1000)
                ledger.get_event_health(seconds=60)
        except BaseException as exc:
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(worker,)) for worker in range(4)]
    threads += [threading.Thread(target=reader) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert not [thread for thread in threads if thread.is_alive()]
    assert errors == []
    assert ledger.get_event_health(seconds=60)["total"] >= 800


def test_disk_limit_skips_oversized_record_without_touching_existing_file(
    monkeypatch, tmp_path
):
    path = tmp_path / "events.jsonl"
    path.write_text('{"existing":true}\n', encoding="utf-8")
    monkeypatch.setattr(ledger, "EVENT_LEDGER_PATH", str(path))
    monkeypatch.setattr(ledger, "EVENT_LEDGER_MAX_BYTES", 48)
    before = path.read_bytes()

    ledger._append_event({"payload": "x" * 200})

    assert path.read_bytes() == before
    assert not list(tmp_path.glob("events.jsonl.*"))


@pytest.mark.parametrize("configured", ["0", "-9000"])
def test_event_ledger_non_positive_byte_limit_is_clamped(monkeypatch, configured):
    monkeypatch.setenv("CORTEX_TEST_LEDGER_BYTES", configured)

    assert ledger._positive_int_env(
        "CORTEX_TEST_LEDGER_BYTES", 10_000, ledger.EVENT_LEDGER_MIN_BYTES
    ) == ledger.EVENT_LEDGER_MIN_BYTES


def test_event_ledger_unparseable_byte_limit_is_rejected(monkeypatch):
    monkeypatch.setenv("CORTEX_TEST_LEDGER_BYTES", "unbounded")

    with pytest.raises(RuntimeError, match="CORTEX_TEST_LEDGER_BYTES must be an integer"):
        ledger._positive_int_env("CORTEX_TEST_LEDGER_BYTES", 10_000)


def test_event_ledger_rotates_before_actual_byte_limit_is_exceeded(monkeypatch, tmp_path):
    path = tmp_path / "events.jsonl"
    monkeypatch.setattr(ledger, "EVENT_LEDGER_PATH", str(path))
    monkeypatch.setattr(ledger, "EVENT_LEDGER_MAX_BYTES", ledger.EVENT_LEDGER_MIN_BYTES)
    monkeypatch.setattr(ledger, "EVENT_LEDGER_BACKUP_COUNT", 1)

    sequence = 0
    while not (tmp_path / "events.jsonl.1").exists():
        ledger._append_event({"sequence": sequence, "payload": "x" * 120})
        sequence += 1
        assert sequence < 20

    assert path.stat().st_size <= ledger.EVENT_LEDGER_MAX_BYTES
    assert (tmp_path / "events.jsonl.1").stat().st_size <= ledger.EVENT_LEDGER_MAX_BYTES


def test_process_lock_failure_is_fail_closed_and_observable(monkeypatch, tmp_path, caplog):
    path = tmp_path / "events.jsonl"
    path.write_text('{"existing":true}\n', encoding="utf-8")
    monkeypatch.setattr(ledger, "EVENT_LEDGER_PATH", str(path))

    def fail_lock():
        raise ledger._LedgerLockTimeout("contended ledger")

    monkeypatch.setattr(ledger, "_acquire_process_lock", fail_lock)
    before = path.read_bytes()

    with caplog.at_level("WARNING", logger=ledger.__name__):
        ledger._append_event({"must_not_be_written": True})

    assert path.read_bytes() == before
    assert "event_ledger_append_failed: contended ledger" in caplog.text


def test_concurrent_rotation_is_locked_atomic_and_has_bounded_generations(
    monkeypatch, tmp_path
):
    path = tmp_path / "events.jsonl"
    monkeypatch.setattr(ledger, "EVENT_LEDGER_PATH", str(path))
    monkeypatch.setattr(ledger, "EVENT_LEDGER_MAX_BYTES", 180)
    monkeypatch.setattr(ledger, "EVENT_LEDGER_BACKUP_COUNT", 2)
    errors = []

    def writer(worker: int):
        try:
            for sequence in range(30):
                ledger._append_event(
                    {"worker": worker, "sequence": sequence, "payload": "x" * 35}
                )
        except BaseException as exc:  # failures in threads must reach pytest
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(worker,)) for worker in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)

    assert not errors
    assert all(not thread.is_alive() for thread in threads)
    files = sorted(
        file for file in tmp_path.glob("events.jsonl*") if file.name != "events.jsonl.lock"
    )
    assert {file.name for file in files} <= {"events.jsonl", "events.jsonl.1", "events.jsonl.2"}
    assert all(file.stat().st_size <= ledger.EVENT_LEDGER_MAX_BYTES for file in files)
    rows = [json.loads(line) for file in files for line in file.read_text().splitlines()]
    assert rows
    assert all(row.keys() == {"worker", "sequence", "payload"} for row in rows)


def test_multiprocess_writers_do_not_lose_or_malform_records(tmp_path):
    path = tmp_path / "multiprocess-events.jsonl"
    worker_count = 6
    records_per_worker = 80
    context = multiprocessing.get_context("fork")
    processes = [
        context.Process(
            target=_multiprocess_ledger_writer,
            args=(str(path), worker, records_per_worker),
        )
        for worker in range(worker_count)
    ]

    for process in processes:
        process.start()
    for process in processes:
        process.join(timeout=15)

    assert all(not process.is_alive() for process in processes)
    assert [process.exitcode for process in processes] == [0] * worker_count
    lines = path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == worker_count * records_per_worker
    rows = [json.loads(line) for line in lines]
    assert {(row["worker"], row["sequence"]) for row in rows} == {
        (worker, sequence)
        for worker in range(worker_count)
        for sequence in range(records_per_worker)
    }


def test_ledger_disk_write_runs_off_event_loop_and_response_has_bounded_wait(monkeypatch):
    main_thread = threading.get_ident()
    observed_threads = []
    release_writer = threading.Event()
    writer_started = threading.Event()

    def slow_append(entry):
        observed_threads.append(threading.get_ident())
        writer_started.set()
        assert release_writer.wait(timeout=2)

    monkeypatch.setattr(ledger, "_append_event", slow_append)
    monkeypatch.setattr(ledger, "EVENT_LEDGER_TELEMETRY_DEADLINE_SECONDS", 0.01)
    middleware = ledger.EventLedgerMiddleware(app=lambda scope, receive, send: None)
    request = Request(
        {"type": "http", "method": "GET", "path": "/responsive", "query_string": b"", "headers": []}
    )

    async def application(_request):
        return JSONResponse({"ok": True})

    async def scenario():
        dispatch_task = asyncio.create_task(middleware.dispatch(request, application))
        deadline = asyncio.get_running_loop().time() + 0.5
        while not writer_started.is_set() and asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.001)
        assert writer_started.is_set()
        heartbeat_ran = False

        async def heartbeat():
            nonlocal heartbeat_ran
            await asyncio.sleep(0)
            heartbeat_ran = True

        heartbeat_task = asyncio.create_task(heartbeat())
        await asyncio.wait_for(heartbeat_task, timeout=0.5)
        assert heartbeat_ran
        response = await asyncio.wait_for(dispatch_task, timeout=0.25)
        assert response.status_code == 200
        release_writer.set()

    asyncio.run(scenario())
    assert observed_threads and observed_threads[0] != main_thread


def test_ledger_burst_has_exact_admission_cap_drops_and_recovers_without_leaks(
    monkeypatch, clean_metrics
):
    capacity = 3
    release_writer = threading.Event()
    writer_started = threading.Event()
    state_lock = threading.Lock()
    active = 0
    peak_active = 0
    completed = 0

    def blocked_append(entry):
        nonlocal active, peak_active, completed
        with state_lock:
            active += 1
            peak_active = max(peak_active, active)
            if active == capacity:
                writer_started.set()
        try:
            assert release_writer.wait(timeout=3)
        finally:
            with state_lock:
                active -= 1
                completed += 1

    admission = ledger._DurableWriteAdmission(capacity=capacity, workers=capacity)
    monkeypatch.setattr(ledger, "_durable_write_admission", admission)
    monkeypatch.setattr(ledger, "_append_event", blocked_append)
    monkeypatch.setattr(ledger, "EVENT_LEDGER_TELEMETRY_DEADLINE_SECONDS", 0.001)
    with ledger._recent_events_lock:
        ledger._recent_events.clear()

    middleware = ledger.EventLedgerMiddleware(app=lambda scope, receive, send: None)

    async def application(_request):
        return JSONResponse({"ok": True})

    async def scenario():
        first = [
            await middleware.dispatch(_request(f"/burst/{number}"), application)
            for number in range(capacity)
        ]
        assert writer_started.wait(timeout=1)

        started = time.perf_counter()
        overflow = [
            await middleware.dispatch(_request(f"/overflow/{number}"), application)
            for number in range(7)
        ]
        assert time.perf_counter() - started < 0.25
        assert all(response.status_code == 200 for response in overflow)
        assert all(response.status_code == 200 for response in first)

        assert metrics.snapshot_metrics()["event_ledger_durable_write_drops_total"] == 7
        with ledger._recent_events_lock:
            assert len(ledger._recent_events) == 7

        release_writer.set()
        for _ in range(100):
            with state_lock:
                if completed == capacity:
                    break
            await asyncio.sleep(0.01)
        assert completed == capacity

        recovery = await middleware.dispatch(_request("/recovered"), application)
        assert recovery.status_code == 200
        for _ in range(100):
            with state_lock:
                if completed == capacity + 1:
                    break
            await asyncio.sleep(0.01)

    try:
        asyncio.run(scenario())
        with state_lock:
            assert peak_active == capacity
            assert active == 0
            assert completed == capacity + 1
        assert metrics.snapshot_metrics()["event_ledger_durable_write_drops_total"] == 7
        assert admission._slots.acquire(blocking=False)
        admission._slots.release()
    finally:
        release_writer.set()
        admission._executor.shutdown(wait=True)


@pytest.mark.parametrize("failure", [asyncio.CancelledError(), KeyboardInterrupt()])
def test_ledger_preserves_base_exception_and_best_effort_records(monkeypatch, failure):
    recorded = []
    monkeypatch.setattr(ledger, "_append_event", recorded.append)
    middleware = ledger.EventLedgerMiddleware(app=lambda scope, receive, send: None)
    request = _request("/cancelled")

    async def application(_request):
        raise failure

    with pytest.raises(type(failure)) as caught:
        asyncio.run(middleware.dispatch(request, application))

    assert caught.value is failure
    assert len(recorded) == 1
    assert recorded[0]["status_code"] == 500
    assert recorded[0]["success"] is False
    assert recorded[0]["error"] == type(failure).__name__


@pytest.mark.parametrize("levels", [object(), iter([{"derived_from": "seed"}])])
def test_malformed_activation_levels_do_not_replace_success_or_emit_partial_event(
    monkeypatch, levels
):
    submitted = []
    monkeypatch.setattr(ledger._durable_write_admission, "submit", submitted.append)
    middleware = ledger.EventLedgerMiddleware(app=lambda scope, receive, send: None)
    request = _request("/malformed-levels")
    request.state.activated_levels = levels

    async def application(_request):
        return JSONResponse({"ok": True})

    response = asyncio.run(middleware.dispatch(request, application))

    assert response.status_code == 200
    assert json.loads(response.body) == {"ok": True}
    assert submitted == []


def test_malformed_activation_levels_do_not_mask_application_exception(monkeypatch):
    submitted = []
    monkeypatch.setattr(ledger._durable_write_admission, "submit", submitted.append)
    middleware = ledger.EventLedgerMiddleware(app=lambda scope, receive, send: None)
    request = _request("/malformed-levels-error")
    request.state.activated_levels = object()
    original = LookupError("application failure")

    async def application(_request):
        raise original

    with pytest.raises(LookupError) as caught:
        asyncio.run(middleware.dispatch(request, application))

    assert caught.value is original
    assert submitted == []


def test_query_sanitization_rejects_oversized_or_high_cardinality_input_before_parsing(monkeypatch):
    from cortex_server.middleware import event_ledger_middleware as ledger

    monkeypatch.setattr(ledger, "EVENT_LEDGER_MAX_QUERY_CHARS", 64)
    monkeypatch.setattr(ledger, "EVENT_LEDGER_MAX_QUERY_FIELDS", 2)
    assert ledger._safe_query("x=" + "a" * 100) == ledger._QUERY_LIMIT_MARKER
    assert ledger._safe_query("a=1&b=2&c=3") == ledger._QUERY_LIMIT_MARKER
    assert ledger._safe_query("token=secret&ok=1") == "token=%5BREDACTED%5D&ok=1"
