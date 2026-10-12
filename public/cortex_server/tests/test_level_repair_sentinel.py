"""L21 Sentinel repair: configured watchers, collision-safe ids, honest status."""

import asyncio

import pytest
from fastapi import HTTPException

from cortex_server.internal_addressing import internal_url
from cortex_server.modules.level_adapters import sentinel as sentinel_adapter
from cortex_server.modules.sentinel import Sentinel
from cortex_server.routers import sentinel


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(sentinel, "STATE_FILE", tmp_path / "watchers.json")
    monkeypatch.setattr(sentinel, "_watcher_store_instance", None)
    monkeypatch.setattr(sentinel, "_watcher_store_path", None)
    monkeypatch.setattr(sentinel, "assert_action_authorized", lambda *_a, **_k: None)
    for name in ("_last_scan_attempt_at", "_last_scan_success_at", "_last_scan_error", "_last_scan_issues"):
        monkeypatch.setattr(sentinel, name, None)
    monkeypatch.setattr(sentinel, "_scan_history", [])
    monkeypatch.setattr(sentinel, "_scheduler_running", False)
    monkeypatch.setattr(sentinel, "_scheduler_task", None)
    monkeypatch.setenv(
        "CORTEX_SENTINEL_PERSISTENT_TARGETS",
        "https://a.example/health,https://b.example/health,https://c.example/health",
    )

    async def allow_destination(*_args, **_kwargs):
        return None

    monkeypatch.setattr(sentinel, "validate_destination", allow_destination)
    sentinel._watchers.clear()
    sentinel._watcher_last_results.clear()
    yield
    sentinel._watchers.clear()
    sentinel._watcher_last_results.clear()


def _add(target):
    return asyncio.run(
        sentinel.add_watcher(sentinel.WatchRequest(name="w", watch_type="endpoint", target=target), object())
    )


def _remove(watch_id):
    return asyncio.run(sentinel.remove_watcher(sentinel.RemoveWatchRequest(watch_id=watch_id), object()))


def test_removal_then_add_never_overwrites_an_existing_watcher(isolated):
    first = _add("https://a.example/health")["watch_id"]
    second = _add("https://b.example/health")["watch_id"]
    assert first != second
    _remove(first)
    third = _add("https://c.example/health")["watch_id"]
    assert third not in {second}
    assert sentinel._watchers[second]["target"] == "https://b.example/health"
    assert sentinel._watchers[third]["target"] == "https://c.example/health"
    assert len(sentinel._watchers) == 2


def test_builtin_internal_public_targets_are_allowed_without_env(isolated, monkeypatch):
    monkeypatch.delenv("CORTEX_SENTINEL_PERSISTENT_TARGETS", raising=False)
    target = internal_url("/health")
    assert sentinel._authorized_persistent_target(target) == target
    with pytest.raises(HTTPException) as denied:
        sentinel._authorized_persistent_target(internal_url("/kernel/status"))
    assert denied.value.status_code == 403
    added = _add(target)
    assert added["success"] is True


def test_ignored_interval_is_reported_not_silently_dropped(isolated):
    response = asyncio.run(
        sentinel.add_watcher(
            sentinel.WatchRequest(name="w", watch_type="endpoint", target="https://a.example/health", interval_seconds=5),
            object(),
        )
    )
    assert response["interval_seconds_ignored"] is True


def test_status_reports_real_watcher_state_and_no_fake_security_claims(isolated, monkeypatch):
    watch_id = _add("https://a.example/health")["watch_id"]

    async def down(_url, timeout_s):
        return {"ok": True, "status_code": 503, "latency_ms": 4}

    monkeypatch.setattr(sentinel, "_check_endpoint", down)
    scan = asyncio.run(sentinel._run_scan(authorization=object()))
    assert scan["issues_found"] == 1

    status = asyncio.run(sentinel.sentinel_status())
    assert "self_heal" not in status["capabilities"]
    assert "security_scanning" in status["not_implemented"]
    assert status["watchers_with_failing_last_result"] == 1
    watchers = asyncio.run(sentinel.list_watchers())["watchers"]
    row = next(w for w in watchers if w["watch_id"] == watch_id)
    assert row["last_result"]["status_code"] == 503 and row["last_result"]["ok"] is False
    assert "a.example" not in str(watchers)  # targets are digests only


def test_self_heal_status_admits_no_remediation(isolated):
    body = asyncio.run(sentinel.self_heal_status())
    assert body["remediation_performed"] is False


def test_module_delegates_instead_of_placeholder(isolated):
    status = Sentinel().status()
    assert status.get("status") != "placeholder"
    assert status["level"] == 21
    assert "health_reason" in status


def test_unsupported_watch_type_rejected(isolated):
    with pytest.raises(HTTPException) as rejected:
        asyncio.run(sentinel.add_watcher(
            sentinel.WatchRequest(name="w", watch_type="port", target="https://a.example/health"), object()
        ))
    assert rejected.value.status_code == 400


def test_sentinel_adapter_contract(isolated):
    _add("https://a.example/health")
    out = asyncio.run(sentinel_adapter.run("is everything healthy?", {}))
    assert out["operation"] == "sentinel.health"
    assert out["origin"] == "deterministic"
    assert out["data"]["watchers"] == 1
    assert "does not perform security scanning" in out["summary"]
    assert len(out["summary"]) <= 1500
