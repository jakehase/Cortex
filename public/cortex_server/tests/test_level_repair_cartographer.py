"""L23 Cartographer repair: in-process probes (no HTTP/403 artefacts) and real topology."""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from cortex_server.modules import cartographer, level_probe
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import cartographer as cartographer_adapter
from cortex_server.routers import mirror
from cortex_server.routers import validator as validator_router


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(level_probe, "_app_ref", None)
    level_probe.reset_probe_cache()
    yield
    level_probe.reset_probe_cache()


def _app():
    app = FastAPI()
    app.include_router(mirror.router, prefix="/mirror")
    app.include_router(validator_router.router, prefix="/validator")
    app.state.router_load_report = {
        "loaded": ["mirror", "validator"],
        "safeModePartial": [],
        "safeModeSkipped": ["parsers"],
        "disabled": [],
        "failed": [],
        "missingRouter": [],
    }

    @app.middleware("http")
    async def deny_validator_over_http(request, call_next):
        # Simulates the admin read guard: any HTTP self-call to /validator
        # would be rejected. In-process probes must not be affected.
        if request.url.path.startswith("/validator"):
            return JSONResponse({"detail": "administrator read authorization required"}, status_code=403)
        return await call_next(request)

    return app


def test_state_uses_in_process_probes_so_auth_is_not_reported_as_degradation():
    client = TestClient(_app())
    assert client.get("/validator/status").status_code == 403  # HTTP path is guarded
    body = client.get("/mirror/state").json()
    rows = {row["level"]: row for row in body["data"]["levels"]}
    assert rows[34]["status"] == "operational"
    assert rows[34]["probe"]["outcome"] == "healthy"
    assert rows[34]["probe"]["status_code"] == 200
    assert rows[3]["status"] == "disabled_by_design" and rows[3]["mount"] == "skipped_safe_mode"
    assert "HTTP 403" not in str(body)


def test_status_is_not_hard_coded_active_before_any_map():
    body = TestClient(_app()).get("/mirror/status").json()
    assert body["data"]["status"] == "untested"
    assert body["data"]["map_age_s"] is None


def test_status_reports_map_age_after_measurement():
    client = TestClient(_app())
    client.get("/mirror/state")
    body = client.get("/mirror/status").json()
    assert body["data"]["status"] == "operational"
    assert body["data"]["map_age_s"] is not None
    assert body["data"]["summary"]["total"] == 38


def test_deep_status_rejects_non_boolean():
    response = TestClient(_app()).get("/mirror/status?deep=notabool")
    assert response.status_code == 422


def test_topology_has_evidenced_edges_and_dependency_nodes():
    scan = cartographer.scan_topology(refresh=True)
    pairs = {(edge["from"], edge["to"]) for edge in scan["edges"]}
    assert (24, 5) in pairs  # Nexus -> Oracle
    assert (22, 7) in pairs  # Mnemosyne -> Librarian
    assert all(edge["evidence"] for edge in scan["edges"])
    body = TestClient(_app()).get("/mirror/topology").json()
    kinds = {node["kind"] for node in body["nodes"]}
    assert {"level", "external_dependency"} <= kinds
    assert sum(1 for node in body["nodes"] if node["kind"] == "level") == 38


def test_dashboard_escapes_and_renders_measured_states():
    response = TestClient(_app()).get("/mirror/")
    assert response.status_code == 200
    assert "DISABLED_BY_DESIGN" in response.text and "OPERATIONAL" in response.text


def test_cartographer_module_has_no_unconditional_operational_claim(monkeypatch):
    monkeypatch.setattr(cartographer.Cartographer, "check_pulse", lambda self: {})
    identity = cartographer.Cartographer().update_identity()
    assert "status" not in identity
    assert "level_availability" in identity


def test_cartographer_adapter_contract(monkeypatch):
    app = _app()
    out = asyncio.run(cartographer_adapter.run("which levels are available?", {"app": app}))
    assert out["operation"] == "cartographer.map"
    assert out["origin"] == "deterministic"
    assert 3 in out["data"]["unavailable"]
    assert len(out["summary"]) <= 1500

    monkeypatch.setattr(level_probe, "resolve_app", lambda app=None: None)
    with pytest.raises(ExecutionBlocked):
        asyncio.run(cartographer_adapter.run("map", {}))
