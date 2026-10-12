"""Sentinel self-watch: always-on, read-only, in-process health checks."""

from __future__ import annotations

import asyncio
import inspect
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from cortex_server.modules import sentinel_selfwatch as sw
from cortex_server.modules.level_adapters import sentinel as sentinel_adapter
from cortex_server.routers import sentinel

_REAL_CHECK_CHRONOS = sw.check_chronos


@pytest.fixture(autouse=True)
def _reset():
    sw.reset_for_tests()
    yield
    sw.reset_for_tests()


def _now(minutes_ago: float = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


def test_module_has_no_network_model_or_subprocess_paths():
    source = inspect.getsource(sw)
    for forbidden in ("httpx", "outbound_egress", "subprocess", "level_model", "call_openclaw", "requests."):
        assert forbidden not in source


def test_oracle_check_flags_all_failing_consults():
    rows = [{"path": "/oracle/chat", "method": "POST", "status": 503, "ts": _now(1)} for _ in range(3)]
    bad = sw.check_oracle(rows)
    assert bad["ok"] is False and bad["severity"] == "high"
    rows.append({"path": "/oracle/chat", "method": "POST", "status": 200, "ts": _now(0)})
    mostly_bad = sw.check_oracle(rows)  # 3 failed, 1 ok: still a (lower) concern
    assert mostly_bad["ok"] is False and mostly_bad["severity"] == "medium"
    rows.extend({"path": "/oracle/chat", "method": "POST", "status": 200, "ts": _now(0)} for _ in range(2))
    assert sw.check_oracle(rows)["ok"] is True
    assert sw.check_oracle([])["ok"] is True


def test_lifecycle_check_reports_failed_components():
    app = SimpleNamespace(state=SimpleNamespace(lifecycle_checks={
        "redis": {"ok": True, "error": None}, "chronos": {"ok": False, "error": "RuntimeError"}}))
    row = sw.check_lifecycle(app)
    assert row["ok"] is False and row["value"] == ["chronos"] and row["severity"] == "high"
    app.state.lifecycle_checks["chronos"] = {"ok": True, "error": None}
    assert sw.check_lifecycle(app)["ok"] is True


def test_level_execution_check_detects_dead_model_lane(monkeypatch):
    from cortex_server.modules import execution_engine

    log = [{"startedAt": _now(2), "status": "blocked", "reason": "model_unavailable:503"} for _ in range(3)]
    monkeypatch.setattr(execution_engine, "get_execution_engine", lambda: SimpleNamespace(execution_log=log))
    assert sw.check_level_execution()["ok"] is False
    log.append({"startedAt": _now(1), "status": "succeeded"})
    assert sw.check_level_execution()["ok"] is True
    old = [{"startedAt": _now(90), "status": "blocked", "reason": "timeout"} for _ in range(5)]
    monkeypatch.setattr(execution_engine, "get_execution_engine", lambda: SimpleNamespace(execution_log=old))
    assert sw.check_level_execution()["value"]["runs"] == 0


def _patch_checks(monkeypatch, *, oracle_ok=True):
    async def levels(app):
        return sw._row("levels", True, "fine")

    monkeypatch.setattr(sw, "check_levels", levels)
    monkeypatch.setattr(sw, "check_host", lambda: sw._row("host", True, "fine"))
    monkeypatch.setattr(sw, "check_chronos", lambda chronos=None: sw._row("chronos", True, "fine"))
    monkeypatch.setattr(sw, "check_awareness", lambda: sw._row("awareness", True, "fine"))
    monkeypatch.setattr(sw, "check_sentinel_state", lambda: sw._row("sentinel_persistence", True, "fine"))
    monkeypatch.setattr(sw, "check_level_execution", lambda: sw._row("level_execution", True, "fine"))
    status = 200 if oracle_ok else 503
    monkeypatch.setattr(sw, "_recent_http", lambda window_s=sw.WINDOW_S: [
        {"path": "/oracle/chat", "method": "POST", "status": status, "ts": _now(1)} for _ in range(2)])


class _Bus:
    def __init__(self):
        self.events = []

    def broadcast(self, source, event_type, data=None):
        self.events.append((source, event_type, data))


@pytest.mark.asyncio
async def test_sweep_alerts_once_and_announces_resolution(monkeypatch):
    from cortex_server.modules import unified_messaging

    bus = _Bus()
    monkeypatch.setattr(unified_messaging, "get_bus", lambda: bus)
    app = SimpleNamespace(state=SimpleNamespace(lifecycle_checks={}))

    _patch_checks(monkeypatch, oracle_ok=False)
    first = await sw.run_once(app)
    assert first["status"] == "unhealthy" and first["issues"] == 1
    await sw.run_once(app)  # same issue: no second alert
    alerts = [e for e in bus.events if e[1] == "cortex_alert"]
    assert len(alerts) == 1 and alerts[0][2]["check"] == "oracle_consult" and alerts[0][2]["severity"] == "high"

    _patch_checks(monkeypatch, oracle_ok=True)
    healthy = await sw.run_once(app)
    assert healthy["status"] == "healthy"
    assert [e[1] for e in bus.events].count("cortex_alert_resolved") == 1

    summary = sw.summary()
    assert summary["fresh"] is True and summary["status"] == "healthy" and summary["runs"] == 3
    assert summary["mode"] == "read_only_in_process"


@pytest.mark.asyncio
async def test_failing_check_is_reported_not_raised(monkeypatch):
    _patch_checks(monkeypatch)

    def boom():
        raise RuntimeError("x")

    monkeypatch.setattr(sw, "check_host", boom)
    result = await sw.run_once(SimpleNamespace(state=SimpleNamespace(lifecycle_checks={})))
    host = [c for c in result["checks"] if c["check"] == "host"][0]
    assert host["ok"] is False and "RuntimeError" in host["detail"]


@pytest.mark.asyncio
async def test_sentinel_health_uses_fresh_self_watch(monkeypatch):
    _patch_checks(monkeypatch)
    monkeypatch.setattr(sentinel, "_scheduler_running", False)
    assert sentinel._sentinel_health_snapshot()["health_reason"] == "scheduler_not_running"  # no sweep yet
    await sw.run_once(SimpleNamespace(state=SimpleNamespace(lifecycle_checks={})))
    health = sentinel._sentinel_health_snapshot()
    assert health["status"] == "active" and health["health_reason"] == "self_watch_healthy"
    assert health["self_watch"]["fresh"] is True

    _patch_checks(monkeypatch, oracle_ok=False)
    await sw.run_once(SimpleNamespace(state=SimpleNamespace(lifecycle_checks={})))
    degraded = sentinel._sentinel_health_snapshot()
    assert degraded["status"] == "degraded" and degraded["health_reason"] == "self_watch_found_issues"

    out = await sentinel_adapter.run("is anything broken?", {})
    assert "Self-watch (read-only" in out["summary"] and "oracle_consult" in out["summary"]
    assert out["data"]["self_watch"]["issues"][0]["check"] == "oracle_consult"


@pytest.mark.asyncio
async def test_start_stop_and_disable(monkeypatch):
    runs = []

    async def fake_run_once(app):
        runs.append(app)
        return {}

    monkeypatch.setattr(sw, "run_once", fake_run_once)
    monkeypatch.setattr(sw, "FIRST_DELAY_S", 0.0)
    task = await sw.start("app")
    assert task is not None and sw.running()
    assert await sw.start("app") is task  # idempotent on the same loop
    for _ in range(20):
        if runs:
            break
        await asyncio.sleep(0.01)
    assert runs == ["app"]
    await sw.stop()
    assert not sw.running() and task.done()

    monkeypatch.setenv("CORTEX_SENTINEL_SELFWATCH", "0")
    assert await sw.start("app") is None and not sw.running()


def test_interval_bounds(monkeypatch):
    monkeypatch.setenv("CORTEX_SENTINEL_SELFWATCH_INTERVAL_S", "5")
    assert sw.interval_s() == 60.0
    monkeypatch.setenv("CORTEX_SENTINEL_SELFWATCH_INTERVAL_S", "nonsense")
    assert sw.interval_s() == 300.0


@pytest.mark.asyncio
async def test_chronos_is_resolved_on_the_event_loop_not_a_worker_thread(monkeypatch):
    from cortex_server.modules import chronos as chronos_mod

    loop_instance = SimpleNamespace(schedule_view=lambda: {
        "scheduler_running": True, "last_completed_run": {"started_at": _now(60)}, "next_fire": "x"})
    seen = []

    def fake_get_chronos():
        try:
            asyncio.get_running_loop()
            seen.append("loop")
            return loop_instance
        except RuntimeError:
            seen.append("thread")
            return SimpleNamespace(schedule_view=lambda: {"scheduler_running": False})

    monkeypatch.setattr(chronos_mod, "get_chronos", fake_get_chronos)
    _patch_checks(monkeypatch)
    monkeypatch.setattr(sw, "check_chronos", _REAL_CHECK_CHRONOS)
    result = await sw.run_once(SimpleNamespace(state=SimpleNamespace(lifecycle_checks={})))
    chronos_row = [c for c in result["checks"] if c["check"] == "chronos"][0]
    assert chronos_row["ok"] is True and seen == ["loop"]


@pytest.mark.asyncio
async def test_level_check_ignores_sentinel_itself_and_names_reasons(monkeypatch):
    from cortex_server.modules import kernel, level_probe

    async def no_refresh(app, max_age_s=60.0):
        return None

    monkeypatch.setattr(level_probe, "refresh_probe_snapshot", no_refresh)
    monkeypatch.setattr(kernel, "kernel_level_status", lambda app: {
        "measured": True, "online_levels": [1], "restricted_levels": [], "degraded_levels": [21, 5],
        "levels": [
            {"level": 21, "status": "degraded", "reason": "probe_self_reported_unhealthy",
             "probe": {"reported_status": "stopped"}},
            {"level": 5, "status": "degraded", "reason": "probe_self_reported_unhealthy"},
            {"level": 17, "status": "degraded", "probe": {"reported_status": "unavailable"}},
            {"level": 7, "status": "degraded", "reason": "recent_server_errors"},
            {"level": 1, "status": "online"},
        ]})
    row = await sw.check_levels(object())
    assert row["ok"] is False and row["value"]["degraded"] == [7]
    assert "L7 (recent_server_errors)" in row["detail"]
    for skipped in ("L21", "L5 ", "L17"):
        assert skipped not in row["detail"]
    assert 17 in row["value"]["by_design"] and row["value"]["covered_elsewhere"] == {5: "oracle_consult"}


def test_auth_refusal_is_not_an_unhealthy_probe():
    from cortex_server.modules import level_probe

    assert level_probe.classify_probe(401, {}) == "auth_required"
    assert level_probe.classify_probe(403, {}) == "auth_required"
    assert level_probe.classify_probe(500, {}) == "http_error"
    assert level_probe.classify_probe(200, {"reported_status": "degraded"}) == "self_reported_unhealthy"


@pytest.mark.asyncio
async def test_hive_status_checks_dependencies_in_process(monkeypatch):
    from cortex_server.routers import hive, librarian, oracle

    monkeypatch.setattr(oracle, "_probe_openclaw_status", lambda: {"ok": False, "ready": True})

    async def collection_ok():
        return True

    monkeypatch.setattr(librarian, "_collection_available", collection_ok)
    monkeypatch.setattr(librarian, "_memory_scope_auth_ready", lambda: True)
    monkeypatch.setattr(librarian, "_fallback_store_appendable", lambda: True)
    assert await hive._dependency_states() == {"oracle": "ready", "librarian": "online"}

    monkeypatch.setattr(oracle, "_probe_openclaw_status", lambda: {"ok": False, "ready": False})
    monkeypatch.setattr(librarian, "_memory_scope_auth_ready", lambda: False)
    assert await hive._dependency_states() == {"oracle": "offline", "librarian": "offline"}
