"""L36 Meta-conductor repair: working /orchestrate delegation and measured aggregate health."""

import asyncio

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from cortex_server.modules import cortex_kernel_v2, level_probe
from cortex_server.modules.level_adapters import meta_conductor as meta_adapter
from cortex_server.routers import meta_conductor
from cortex_server.routers import validator as validator_router


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    cortex_kernel_v2.reset_state()
    monkeypatch.setattr(level_probe, "_app_ref", None)
    level_probe.reset_probe_cache()
    yield
    level_probe.reset_probe_cache()


def _app():
    app = FastAPI()
    app.include_router(meta_conductor.router, prefix="/meta_conductor")
    app.include_router(validator_router.router, prefix="/validator")
    app.state.router_load_report = {
        "loaded": ["meta_conductor", "validator"], "safeModePartial": [], "safeModeSkipped": ["lab"],
        "disabled": [], "failed": [{"router": "ethicist", "error": "ImportError"}], "missingRouter": [],
    }
    return app


def test_orchestrate_propagates_nexus_auth_errors_instead_of_502(monkeypatch):
    async def unauthenticated(**_kwargs):
        raise HTTPException(status_code=403, detail="authenticated memory principal required")

    monkeypatch.setattr(meta_conductor, "orchestrate_query", unauthenticated)
    response = TestClient(_app()).post("/meta_conductor/orchestrate", json={"query": "check disk health"})
    assert response.status_code == 403


def test_orchestrate_unexpected_failure_is_502_without_leaking_detail(monkeypatch):
    async def broken(**_kwargs):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(meta_conductor, "orchestrate_query", broken)
    response = TestClient(_app()).post("/meta_conductor/orchestrate", json={"query": "x"})
    assert response.status_code == 502
    assert "secret internal detail" not in response.text


def test_orchestrate_returns_plan_and_in_process_target_probes(monkeypatch):
    seen = {}

    async def plan(query=None, request=None, codec_probe=False, payload=None):
        seen.update(query=query, request=request, payload=payload)
        return {"success": True, "routing_method": "semantic", "recommended_levels": [{"level": 34, "name": "validator"}]}

    monkeypatch.setattr(meta_conductor, "orchestrate_query", plan)
    body = TestClient(_app()).post(
        "/meta_conductor/orchestrate", json={"query": "validate this payload", "target_levels": [34, 33]}
    ).json()
    assert seen["query"] == "validate this payload" and seen["request"] is not None and seen["payload"] is None
    rows = {row["level"]: row for row in body["results"]}
    assert rows[34]["state"] == "operational" and rows[34]["http_status"] == 200
    assert rows[33]["state"] == "failed"
    assert body["recommended_levels"][0]["level"] == 34


@pytest.mark.parametrize(
    "payload",
    [{"query": ""}, {"query": "x", "target_levels": [99]}, {"query": "x", "target_levels": ["a"]},
     {"query": "x", "timeout_seconds": -5}],
)
def test_orchestrate_rejects_malformed_requests(payload, monkeypatch):
    async def never(**_kwargs):
        raise AssertionError("must not delegate malformed requests")

    monkeypatch.setattr(meta_conductor, "orchestrate_query", never)
    response = TestClient(_app()).post("/meta_conductor/orchestrate", json=payload)
    assert response.status_code == 422


def test_health_probes_every_level_in_process_and_flags_failures():
    body = TestClient(_app()).get("/meta_conductor/health?refresh=true").json()
    rows = {row["level"]: row for row in body["results"]}
    assert len(rows) == 38
    assert rows[34]["success"] is True and rows[34]["self_test"]["passed"] is True
    assert rows[33]["state"] == "failed"
    assert 33 in body["failed_levels"]
    assert 4 in body["unmounted_levels"]
    assert body["status"] == "failed"
    assert body["probe_mode"] == "in_process_route_handler"


def test_status_is_derived_from_cached_health_not_constant(monkeypatch):
    client = TestClient(_app())
    first = client.get("/meta_conductor/status").json()
    assert first["status"] == "untested"
    client.get("/meta_conductor/health?refresh=true")
    second = client.get("/meta_conductor/status").json()
    assert second["status"] == "failed"
    assert 33 in second["failed_levels"]
    assert second["health_snapshot_age_s"] is not None


def test_meta_conductor_adapter_contract():
    app = _app()
    out = asyncio.run(meta_adapter.run("is cortex healthy?", {"app": app}))
    assert out["operation"] == "meta_conductor.health"
    assert out["origin"] == "deterministic"
    assert "mount state only" in out["data"]["basis"]
    assert len(out["summary"]) <= 1500
