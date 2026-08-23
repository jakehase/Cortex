import asyncio
from pathlib import Path
import time

import pytest
from fastapi.testclient import TestClient

from cortex_server import internal_addressing
from cortex_server import main as main_module
from cortex_server.modules import reasoning_runtime_service
from cortex_server.routers import sentinel


class _RunningSentinelTask:
    @staticmethod
    def cancelled():
        return False

    @staticmethod
    def done():
        return False


class _FailedSentinelTask(_RunningSentinelTask):
    @staticmethod
    def done():
        return True

    @staticmethod
    def exception():
        return RuntimeError("scheduler crashed")


def _configure_sentinel_health(monkeypatch, **overrides):
    defaults = {
        "_scheduler_running": True,
        "_scheduler_task": _RunningSentinelTask(),
        "_scan_interval": 10,
        "_scheduler_started_at": time.time() - 10,
        "_last_scan_attempt_at": time.time() - 1,
        "_last_scan_success_at": time.time() - 1,
        "_last_scan_error": None,
        "_last_scan_issues": 0,
        "_startup_error": None,
        "_last_load_error": None,
        "_last_save_error": None,
        "_last_task_error": None,
    }
    defaults.update(overrides)
    for name, value in defaults.items():
        monkeypatch.setattr(sentinel, name, value)


def _run_preflight(payload):
    async def preflight():
        return payload

    return asyncio.run(
        reasoning_runtime_service.maybe_sentinel_gate(
            metadata={"requires_preflight": True},
            workflow_id="wf_critical_preflight",
            sentinel_preflight_fn=preflight,
        )
    )


def test_agg_f002_internal_origin_defaults_to_deployed_port_and_derives_bind_settings():
    assert internal_addressing.resolve_internal_base_url({}) == "http://127.0.0.1:8000"
    assert internal_addressing.resolve_internal_base_url(
        {"CORTEX_HOST": "127.0.0.9", "CORTEX_PORT": "8017"}
    ) == "http://127.0.0.9:8017"
    assert internal_addressing.resolve_internal_base_url(
        {"CORTEX_HOST": "0.0.0.0", "CORTEX_PORT": "8000"}
    ) == "http://127.0.0.1:8000"
    assert internal_addressing.resolve_internal_base_url(
        {"CORTEX_INTERNAL_BASE_URL": "http://cortex.internal:9000"}
    ) == "http://cortex.internal:9000"


@pytest.mark.parametrize(
    "configured",
    [
        "ftp://127.0.0.1:8000",
        "http://user:pass@127.0.0.1:8000",
        "http://127.0.0.1:8000/not-an-origin",
        "http://127.0.0.1:8000?query=1",
    ],
)
def test_agg_f002_internal_origin_rejects_malformed_or_credentialed_values(configured):
    with pytest.raises(ValueError):
        internal_addressing.resolve_internal_base_url({"CORTEX_INTERNAL_BASE_URL": configured})


def test_agg_f002_readiness_fails_when_configured_self_origin_is_unreachable(monkeypatch):
    async def unreachable_probe(**_kwargs):
        return {
            "ok": False,
            "status": "unreachable",
            "target": "http://127.0.0.1:8000/_internal/reachability",
            "error": "ConnectError:connection refused",
        }

    monkeypatch.setattr(main_module, "probe_internal_reachability", unreachable_probe)
    client = TestClient(main_module.create_app())
    response = client.get("/ready")

    assert response.status_code == 503
    payload = response.json()
    assert payload["ready"] is False
    assert payload["checks"]["internalSelfReachability"]["status"] == "unreachable"


def test_agg_f002_self_probe_rejects_a_reachable_wrong_service(monkeypatch):
    class WrongServiceResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"service": "not-cortex", "status": "reachable"}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _target):
            return WrongServiceResponse()

    monkeypatch.setattr(internal_addressing.httpx, "AsyncClient", lambda **_kwargs: FakeClient())
    result = asyncio.run(internal_addressing.probe_internal_reachability())

    assert result["ok"] is False
    assert result["status"] == "identity_mismatch"


def test_agg_f002_runtime_self_calls_have_no_legacy_8888_origin():
    package_root = Path(main_module.__file__).resolve().parent
    legacy_lines = []
    for source_path in sorted(package_root.rglob("*.py")):
        for line_number, line in enumerate(source_path.read_text(encoding="utf-8").splitlines(), start=1):
            if "8888" in line:
                legacy_lines.append((source_path.relative_to(package_root).as_posix(), line_number, line.strip()))

    assert legacy_lines == []


def test_agg_f057_stopped_sentinel_with_no_scan_fails_closed(monkeypatch):
    _configure_sentinel_health(
        monkeypatch,
        _scheduler_running=False,
        _scheduler_task=None,
        _scheduler_started_at=None,
        _last_scan_attempt_at=None,
        _last_scan_success_at=None,
        _last_scan_issues=None,
    )

    payload = asyncio.run(sentinel.sentinel_status())

    assert payload["success"] is False
    assert payload["status"] == "stopped"
    assert payload["severity"] == "unavailable"
    assert payload["scheduler_running"] is False
    assert payload["last_scan_attempt_at"] is None
    assert payload["last_scan_success_at"] is None
    assert payload["last_scan_age_seconds"] is None


def test_agg_f057_completed_scan_with_down_watcher_is_degraded(monkeypatch):
    _configure_sentinel_health(
        monkeypatch,
        _scheduler_started_at=time.time() - 1,
        _last_scan_attempt_at=None,
        _last_scan_success_at=None,
        _last_scan_issues=None,
    )
    monkeypatch.setattr(
        sentinel,
        "_watchers",
        {
            "watch_down": {
                "name": "down dependency",
                "type": "endpoint",
                "target": "http://127.0.0.1:1/status",
                "timeout_s": 0.01,
            }
        },
    )
    monkeypatch.setattr(sentinel, "_scan_history", [])

    async def endpoint_down(_url, timeout_s):
        assert timeout_s == 0.01
        return {"ok": False, "error": "connection refused", "latency_ms": 1}

    monkeypatch.setattr(sentinel, "_check_endpoint", endpoint_down)
    scan = asyncio.run(sentinel._run_scan())
    payload = asyncio.run(sentinel.sentinel_status())

    assert scan["issues_found"] == 1
    assert payload["success"] is False
    assert payload["status"] == "degraded"
    assert payload["severity"] == "degraded"
    assert payload["health_reason"] == "latest_scan_found_issues"
    assert payload["last_scan_attempt_at"] is not None
    assert payload["last_scan_success_at"] is not None
    assert payload["last_scan_age_seconds"] is not None


def test_agg_f057_scoped_manual_scan_cannot_clear_full_scan_failure(monkeypatch):
    _configure_sentinel_health(
        monkeypatch,
        _last_scan_issues=1,
        _last_scan_success_at=time.time() - 1,
    )
    monkeypatch.setattr(
        sentinel,
        "_watchers",
        {
            "healthy": {
                "name": "healthy dependency",
                "type": "endpoint",
                "target": "http://127.0.0.1/healthy",
                "timeout_s": 0.01,
            },
            "down": {
                "name": "down dependency",
                "type": "endpoint",
                "target": "http://127.0.0.1/down",
                "timeout_s": 0.01,
            },
        },
    )

    async def endpoint_healthy(_url, timeout_s):
        assert timeout_s == 0.01
        return {"ok": True, "status_code": 200, "latency_ms": 1}

    monkeypatch.setattr(sentinel, "_check_endpoint", endpoint_healthy)
    scoped = asyncio.run(sentinel._run_scan(only_watch_id="healthy"))
    payload = asyncio.run(sentinel.sentinel_status())

    assert scoped["issues_found"] == 0
    assert payload["success"] is False
    assert payload["status"] == "degraded"
    assert payload["latest_scan_issues"] == 1


def test_agg_f057_stale_scan_and_failed_scheduler_task_fail_closed(monkeypatch):
    now = time.time()
    _configure_sentinel_health(
        monkeypatch,
        _scheduler_started_at=now - 120,
        _last_scan_attempt_at=now - 60,
        _last_scan_success_at=now - 60,
    )

    stale = sentinel._sentinel_health_snapshot(now=now)
    assert stale["success"] is False
    assert stale["status"] == "stale"
    assert stale["last_scan_age_seconds"] == 60.0
    assert stale["scan_stale_after_seconds"] == 30.0

    monkeypatch.setattr(sentinel, "_scheduler_task", _FailedSentinelTask())
    failed = sentinel._sentinel_health_snapshot(now=now)
    assert failed["success"] is False
    assert failed["status"] == "error"
    assert "scheduler_task_failed:RuntimeError" in failed["task_error"]


def test_agg_f057_scan_exception_is_retained_for_status(monkeypatch):
    _configure_sentinel_health(
        monkeypatch,
        _last_scan_attempt_at=None,
        _last_scan_success_at=None,
        _last_scan_issues=None,
    )

    async def fail_scan(**_kwargs):
        raise RuntimeError("scan backend unavailable")

    monkeypatch.setattr(sentinel, "_execute_scan", fail_scan)
    with pytest.raises(RuntimeError, match="scan backend unavailable"):
        asyncio.run(sentinel._run_scan())

    payload = asyncio.run(sentinel.sentinel_status())
    assert payload["success"] is False
    assert payload["status"] == "error"
    assert payload["last_scan_attempt_at"] is not None
    assert payload["last_scan_success_at"] is None
    assert "scan_failed:RuntimeError" in payload["scan_error"]


def test_agg_f057_load_and_save_failures_are_observable(monkeypatch, tmp_path):
    _configure_sentinel_health(monkeypatch)
    invalid_state_target = tmp_path / "sentinel-state-directory"
    invalid_state_target.mkdir()
    monkeypatch.setattr(sentinel, "STATE_FILE", invalid_state_target)

    with pytest.raises(IsADirectoryError):
        sentinel._load_watchers()
    load_failed = asyncio.run(sentinel.sentinel_status())
    assert load_failed["success"] is False
    assert load_failed["status"] == "error"
    assert "watcher_load_failed:IsADirectoryError" in load_failed["load_error"]

    monkeypatch.setattr(sentinel, "_last_load_error", None)
    with pytest.raises(IsADirectoryError):
        sentinel._save_watchers()
    save_failed = asyncio.run(sentinel.sentinel_status())
    assert save_failed["success"] is False
    assert save_failed["status"] == "error"
    assert "watcher_save_failed:IsADirectoryError" in save_failed["save_error"]


def test_agg_f057_lifespan_retains_startup_failure(monkeypatch):
    _configure_sentinel_health(monkeypatch)

    def fail_load():
        raise ValueError("invalid watcher state")

    async def no_op():
        return {"success": True}

    monkeypatch.setattr(sentinel, "_load_watchers", fail_load)
    monkeypatch.setattr(sentinel, "start_scheduler", no_op)
    monkeypatch.setattr(sentinel, "stop_scheduler", no_op)

    async def observe_lifespan():
        async with sentinel._sentinel_lifespan(None):
            return await sentinel.sentinel_status()

    payload = asyncio.run(observe_lifespan())
    assert payload["success"] is False
    assert payload["status"] == "error"
    assert "watcher_load_failed:ValueError" in payload["startup_error"]


@pytest.mark.parametrize(
    "payload,expected_error",
    [
        (None, "sentinel_preflight_malformed"),
        (False, "sentinel_preflight_malformed"),
        ({}, "sentinel_preflight_unavailable"),
        ({"success": False}, "sentinel_preflight_unavailable"),
        ({"success": True}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": None}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": {}}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": {"issues_found": "0"}}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": {"issues_found": False}}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": {"issues_found": -1}}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": {"issues_found": 0}}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": {"issues_found": 0, "watchers_checked": 1, "results": []}}, "sentinel_preflight_malformed"),
    ],
)
def test_agg_f052_required_sentinel_preflight_blocks_false_missing_and_malformed(payload, expected_error):
    blocked = _run_preflight(payload)

    assert blocked["success"] is False
    assert blocked["error"] == expected_error
    assert blocked["workflow_id"] == "wf_critical_preflight"


@pytest.mark.parametrize("failure", [TimeoutError("timed out"), ConnectionError("connection refused")])
def test_agg_f052_required_sentinel_preflight_blocks_timeout_and_unreachable(failure):
    async def failed_preflight():
        raise failure

    blocked = asyncio.run(
        reasoning_runtime_service.maybe_sentinel_gate(
            metadata={"requires_preflight": True},
            workflow_id="wf_dependency_down",
            sentinel_preflight_fn=failed_preflight,
        )
    )

    assert blocked["success"] is False
    assert blocked["error"] == "sentinel_preflight_unavailable"
    assert blocked["workflow_id"] == "wf_dependency_down"


def test_agg_f052_required_sentinel_preflight_allows_only_valid_issue_free_scan():
    allowed = _run_preflight(
        {
            "success": True,
            "scan": {
                "issues_found": 0,
                "watchers_checked": 1,
                "results": [{"ok": True, "status_code": 200}],
            },
        }
    )
    blocked = _run_preflight(
        {
            "success": True,
            "scan": {
                "issues_found": 1,
                "watchers_checked": 1,
                "results": [{"ok": False, "status_code": 503}],
            },
        }
    )

    assert allowed is None
    assert blocked["error"] == "sentinel_gate_failed"


def test_agg_f052_malformed_preflight_never_reaches_async_workflow_executor():
    executed = []
    persisted = []
    applied = []

    async def malformed_preflight():
        return {"success": True, "scan": {"issues_found": 0}}

    async def unexpected_execution(_workflow):
        executed.append(True)
        raise AssertionError("workflow executor must not run after a malformed required preflight")

    workflow = {"workflow_id": "wf_fail_closed", "executions": []}
    asyncio.run(
        reasoning_runtime_service.finalize_async_workflow(
            workflow,
            metadata={"requires_preflight": True},
            sentinel_preflight_fn=malformed_preflight,
            execute_workflow_fn=unexpected_execution,
            apply_execution_result_fn=lambda target, execution, **_kwargs: applied.append((target, execution)),
            build_blocked_execution_fn=lambda **kwargs: {"success": False, "blocked": kwargs},
            build_error_execution_fn=lambda error: {"success": False, "error": str(error)},
            persist_workflow_fn=lambda target: persisted.append(target),
            max_executions=3,
        )
    )

    assert executed == []
    assert len(applied) == 1
    assert persisted == [workflow]
