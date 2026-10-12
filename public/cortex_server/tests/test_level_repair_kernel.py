"""L1 Kernel repair: measured telemetry and measured (not hard-coded) level state."""

import asyncio

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from cortex_server.modules import kernel as kernel_module
from cortex_server.modules import level_probe
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import kernel as kernel_adapter
from cortex_server.routers import kernel as kernel_router
from cortex_server.routers import validator as validator_router


@pytest.fixture(autouse=True)
def _isolate_probe_state(monkeypatch):
    monkeypatch.setattr(level_probe, "_app_ref", None)
    level_probe.reset_probe_cache()
    monkeypatch.setattr(level_probe, "_recent_requests", lambda: [])
    yield
    level_probe.reset_probe_cache()


def _status_only_router(level_payload):
    router = APIRouter()

    @router.get("/status")
    async def status():
        return level_payload

    return router


def _app(report=None):
    app = FastAPI()
    app.include_router(kernel_router.router, prefix="/kernel")
    app.include_router(validator_router.router, prefix="/validator")
    # Council router "loaded" but without its canonical status route.
    council = APIRouter()

    @council.get("/other")
    async def other():
        return {"ok": True}

    app.include_router(council, prefix="/council")
    app.state.router_load_report = report or {
        "loaded": ["council", "kernel", "validator"],
        "safeModePartial": [],
        "safeModeSkipped": ["lab"],
        "disabled": [{"router": "lab", "reason": "safe_mode", "safetyClass": "unsafe_action"}],
        "failed": [{"router": "seer", "error": "ImportError"}],
        "missingRouter": [],
    }
    return app


def _by_level(rows):
    return {row["level"]: row for row in rows}


def test_kernel_levels_are_derived_from_the_mounted_app_not_hard_coded():
    app = _app()
    body = TestClient(app).get("/kernel/levels").json()

    rows = _by_level(body["levels"])
    assert len(rows) == 38
    assert rows[1]["status"] == "operational"
    assert rows[34]["status"] == "operational"
    assert rows[4]["status"] == "disabled_by_design" and rows[4]["mount"] == "skipped_safe_mode"
    assert rows[30]["status"] == "failed" and rows[30]["mount"] == "import_failed"
    assert rows[15]["status"] == "degraded" and rows[15]["reason"] == "canonical_status_route_missing"
    # A level whose router was never loaded must not be operational.
    assert rows[24]["status"] == "untested"
    assert len({row["status"] for row in body["levels"]}) > 1
    assert set(body["online_levels"]) == {1, 34}
    assert body["measured"] is True and body["success"] is True


def test_kernel_level_status_is_a_pure_in_process_function_for_nexus():
    app = _app()
    status = kernel_module.kernel_level_status(app)
    assert status["measured"] is True
    assert 4 in status["unavailable_levels"]
    assert kernel_module.kernel_online_levels(app) == {1, 34}


def test_kernel_level_status_reports_untested_without_a_running_app(monkeypatch):
    monkeypatch.setattr(level_probe, "resolve_app", lambda app=None: None)
    status = kernel_module.kernel_level_status()
    assert status["measured"] is False
    assert {row["status"] for row in status["levels"]} == {"untested"}
    assert kernel_module.kernel_online_levels() is None


def test_recent_server_errors_degrade_an_otherwise_mounted_level(monkeypatch):
    rows = [{"path": "/validator/validate", "status": 500, "ts": "2026-10-10T00:00:00+00:00"} for _ in range(3)]
    monkeypatch.setattr(level_probe, "_recent_requests", lambda: rows)
    status = kernel_module.kernel_level_status(_app())
    v = _by_level(status["levels"])[34]
    assert v["status"] == "degraded"
    assert v["reason"] == "recent_server_errors"


def test_probe_true_invokes_status_handlers_in_process():
    app = _app()
    body = TestClient(app).get("/kernel/levels?probe=true").json()
    rows = _by_level(body["levels"])
    assert rows[34]["probe"]["outcome"] == "healthy"
    assert rows[34]["probe"]["status_code"] == 200
    assert body["probe_snapshot_age_s"] is not None


def test_probe_marks_self_reported_unhealthy_level_degraded():
    app = FastAPI()
    app.include_router(_status_only_router({"level": 8, "status": "degraded", "success": False}), prefix="/cron")
    app.state.router_load_report = {"loaded": ["cron"], "safeModePartial": [], "safeModeSkipped": [],
                                    "disabled": [], "failed": [], "missingRouter": []}
    snapshot = asyncio.run(level_probe.probe_levels(app))
    cron = _by_level(snapshot["levels"])[8]
    assert cron["probe"]["outcome"] == "self_reported_unhealthy"
    assert cron["status"] == "degraded"


def test_metrics_contract_v2_is_measured_with_nulls_not_zero_defaults():
    metrics = kernel_module.get_kernel().metrics()
    assert metrics["schemaVersion"] == "cortex.kernel.metrics.v2"
    assert metrics["process"]["pid"] > 0
    assert "utilizationPercent" in metrics["cpu"]
    assert isinstance(metrics["disk"], list)
    assert metrics["control"]["available"] is False


def test_status_is_degraded_when_proc_sources_are_missing():
    def empty_collector():
        return {"schemaVersion": "cortex.kernel.metrics.v2", "memory": {"totalBytes": None},
                "sources": {"meminfo": False}, "process": {"alive": True}}

    status = kernel_module.Kernel(metrics_collector=empty_collector).status()
    assert status["status"] == "degraded"
    assert status["metricsAvailable"] is False


def test_kernel_control_is_still_denied():
    with pytest.raises(kernel_module.KernelControlDenied):
        kernel_module.get_kernel().control("reboot")


def test_kernel_adapter_contract_and_blocking(monkeypatch):
    app = _app()
    out = asyncio.run(kernel_adapter.run("how is the server doing?", {"app": app}))
    assert out["operation"] == "kernel.snapshot"
    assert out["origin"] == "deterministic"
    assert len(out["summary"]) <= 1500
    assert out["data"]["levels"]["measured"] is True
    assert kernel_adapter.NEEDS_MODEL is False and kernel_adapter.SAFE_AUTORUN is True

    class Broken:
        def metrics(self):
            raise RuntimeError("proc unreadable")

    monkeypatch.setattr(kernel_module, "get_kernel", lambda: Broken())
    with pytest.raises(ExecutionBlocked) as blocked:
        asyncio.run(kernel_adapter.run("cpu?", {"app": app}))
    assert blocked.value.reason == "kernel_metrics_unavailable"
