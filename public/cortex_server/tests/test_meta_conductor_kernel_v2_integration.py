from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.modules import cortex_kernel_v2
import cortex_server.routers.meta_conductor as meta_conductor


_calls = []


async def _fake_orchestrate_query(query=None, request=None, codec_probe=False, payload=None):
    _calls.append({"query": query, "request": request, "codec_probe": codec_probe, "payload": payload})
    return {
        "success": True,
        "routing_method": "delegated_nexus",
        "recommended_levels": [{"level": 15, "name": "council"}],
        "semantic_analysis": {"confidence": 0.91, "method": "kernel_v2"},
        "contract": {"contract_version": "orchestrate_guard_v3"},
    }


async def _fake_probe_targets(app, levels, timeout_seconds):
    return [
        {"level": level, "name": f"L{level}", "state": "online", "success": True, "http_status": 200}
        for level in levels
    ]


def setup_function():
    cortex_kernel_v2.reset_state()
    _calls.clear()


def _client(monkeypatch):
    monkeypatch.setattr(meta_conductor, "orchestrate_query", _fake_orchestrate_query)
    monkeypatch.setattr(meta_conductor, "_probe_targets", _fake_probe_targets)
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
    assert [row["level"] for row in body["results"]] == [33, 34]
    # The Nexus handler receives the real request object (principal auth runs
    # on the caller's credentials) and an explicit payload, never request=None.
    assert _calls and _calls[0]["request"] is not None and _calls[0]["payload"] is None

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


def test_aggregate_identity_and_health_come_from_probe_rows():
    snapshot = {
        "available": True,
        "levels": [
            {"level": 33, "name": "Ethicist", "route_prefix": "/ethicist", "canonical_status": "/ethicist/status",
             "mount": "full", "status": "online", "probe": {"outcome": "healthy", "status_code": 200, "reported_level": 33}},
            {"level": 34, "name": "Validator", "route_prefix": "/validator", "canonical_status": "/validator/status",
             "mount": "full", "status": "online", "probe": {"outcome": "healthy", "status_code": 200, "reported_level": 99}},
        ],
    }
    aggregate = meta_conductor._aggregate(snapshot)
    rows = {row["level"]: row for row in aggregate["results"]}
    assert rows[33]["identity_match"] is True
    assert rows[34]["identity_match"] is False
    assert aggregate["identity_mismatch_levels"] == [34]
