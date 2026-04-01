from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.modules import cortex_kernel_v2
import cortex_server.routers.meta_conductor as meta_conductor


async def _fake_orchestrate_query(query: str, request=None):
    return {
        "routing_method": "delegated_nexus",
        "recommended_levels": [{"level": 15, "name": "council"}],
        "semantic_analysis": {"confidence": 0.91, "method": "kernel_v2"},
        "contract": {"contract_version": "orchestrate_guard_v3"},
    }


async def _fake_probe_level(client, level: int, timeout_seconds: float):
    return {
        "level": level,
        "name": f"L{level}",
        "path": f"/levels/{level}",
        "success": True,
        "data": {"level": level, "status": "active"},
        "error": None,
        "latency_ms": 2.5,
        "reported_level": level,
        "identity_match": True,
    }


def setup_function():
    cortex_kernel_v2.reset_state()


def _client(monkeypatch):
    monkeypatch.setattr(meta_conductor, "orchestrate_query", _fake_orchestrate_query)
    monkeypatch.setattr(meta_conductor, "_probe_level", _fake_probe_level)
    app = FastAPI()
    app.include_router(meta_conductor.router, prefix="/meta_conductor")
    return TestClient(app)


def test_meta_conductor_orchestrate_records_kernel_runtime(monkeypatch):
    client = _client(monkeypatch)

    response = client.post(
        "/meta_conductor/orchestrate",
        json={"query": "Implement the runtime compiler refactor and validate the production rollout through meta conductor.", "target_levels": [33, 34]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["kernel_v2"]["runtime"] == "meta_conductor"
    assert body["kernel_v2"]["surface"] == "orchestrate"
    assert body["kernel_v2"]["plan"]["lane"] == "deep"
    assert body["contract"]["kernel_contract_version"] == "cortex.kernel.v2"
    assert body["contract"]["kernel_lane"] == "deep"

    kernel_status = client.get("/meta_conductor/kernel/status")
    assert kernel_status.status_code == 200
    snapshot = kernel_status.json()
    assert snapshot["telemetry"]["events"] == 1
    assert snapshot["latest"]["runtime"] == "meta_conductor"

    telemetry = client.get("/meta_conductor/kernel/telemetry")
    assert telemetry.status_code == 200
    payload = telemetry.json()
    assert len(payload["events"]) == 1
    assert payload["events"][0]["runtime"] == "meta_conductor"

    status = client.get("/meta_conductor/status")
    assert status.status_code == 200
    assert status.json()["kernel_v2"]["telemetry"]["events"] == 1
