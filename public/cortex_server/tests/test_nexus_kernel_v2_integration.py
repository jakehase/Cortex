from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.modules import cortex_kernel_v2



def setup_function():
    cortex_kernel_v2.reset_state()



def _client(monkeypatch, *, headers=None):
    monkeypatch.setattr(nexus, "analyze_intent_with_oracle", lambda q, **_kwargs: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"})
    monkeypatch.setattr(nexus, "gather_live_evidence", lambda *a, **k: {"required": False, "mode": "not_required", "evidence_count": 0, "degraded": False})
    monkeypatch.setattr(nexus, "_architect_healthy", lambda *_args, **_kwargs: True)
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    return TestClient(app, headers=headers)



def test_nexus_orchestrate_surfaces_kernel_trace_and_runtime_scoped_status(
    monkeypatch,
    configured_memory_principal,
):
    auth = configured_memory_principal(session_id="nexus-kernel-trace")
    headers = {**auth.headers, "x-session-id": auth.scope["session_id"]}
    client = _client(monkeypatch, headers=headers)

    response = client.post(
        "/nexus/orchestrate",
        json={},
        params={"query": "Plan the runtime compiler rollout and benchmark strategy."},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["kernel_v2"]["runtime"] == "nexus"
    assert body["kernel_v2"]["surface"] == "orchestrate"
    assert body["kernel_v2"]["plan"]["lane"] == "deep"
    assert body["latency_budget"]["cheap_route"] == "deliberate"
    assert body["latency_budget"]["archetype"] in {"planning", "complex_general"}
    assert body["contract"]["kernel_contract_version"] == "cortex.kernel.v2"
    assert body["contract"]["kernel_lane"] == "deep"

    status = client.get("/nexus/kernel/status")
    assert status.status_code == 200
    snapshot = status.json()
    assert snapshot["telemetry"]["events"] == 1
    assert snapshot["latest"]["runtime"] == "nexus"
    assert snapshot["latest"]["surface"] == "orchestrate"



def test_nexus_kernel_telemetry_and_status_ignore_oracle_events(monkeypatch):
    oracle_trace = cortex_kernel_v2.prepare_request(
        "What is the capital of Texas?",
        session_key="session:oracle-side",
        runtime="oracle",
        surface="chat",
    )
    cortex_kernel_v2.finalize_request(
        oracle_trace["request_id"],
        response="Austin",
        actual_lane="semantic_guardrail_factual",
        used_backend="oracle-fastlane",
        contract_ok=True,
    )

    nexus_trace = cortex_kernel_v2.prepare_request(
        "Plan the runtime compiler rollout.",
        session_key="session:nexus-side",
        runtime="nexus",
        surface="orchestrate",
    )
    cortex_kernel_v2.finalize_request(
        nexus_trace["request_id"],
        response="Use the deep orchestration lane.",
        actual_lane="nexus_orchestrated",
        used_backend="nexus-orchestrate",
        contract_ok=True,
    )

    client = _client(monkeypatch)

    telemetry = client.get("/nexus/kernel/telemetry")
    assert telemetry.status_code == 200
    payload = telemetry.json()
    assert payload["status"]["telemetry"]["events"] == 1
    assert len(payload["events"]) == 1
    assert payload["events"][0]["runtime"] == "nexus"

    status = client.get("/nexus/status")
    assert status.status_code == 200
    status_body = status.json()
    assert status_body["kernel_v2"]["telemetry"]["events"] == 1
    assert status_body["kernel_v2"]["scope"]["runtime"] == "nexus"

    context = client.get("/nexus/context")
    assert context.status_code == 200
    assert context.json()["data"]["kernel_v2"]["telemetry"]["events"] == 1
