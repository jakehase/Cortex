from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.modules import cortex_kernel_v2
import cortex_server.routers.oracle as oracle
import cortex_server.services.mission_control_service as mission_control_service


class _AliveDisabled:
    def enabled(self):
        return False



def setup_function():
    cortex_kernel_v2.reset_state()



def _client(headers):
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(oracle.router, prefix="/oracle")
    return TestClient(app, headers=headers)



def test_oracle_chat_surfaces_kernel_trace_and_status(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setenv("ORACLE_ROUTE_TO_AUGMENTER", "false")
    monkeypatch.setenv("ORACLE_EMERGENCY_BYPASS", "false")
    monkeypatch.setenv("ORACLE_KERNEL_V2_ENABLED", "true")
    monkeypatch.setenv("ORACLE_KERNEL_V2_MODE", "active")
    monkeypatch.setattr(oracle, "get_alive_mode", lambda loader: _AliveDisabled())
    monkeypatch.setattr(oracle, "_strict_micro_fast_answer", lambda *a, **k: None)
    monkeypatch.setattr(oracle, "_semantic_guardrail_response", lambda *a, **k: None)
    monkeypatch.setattr(oracle, "_best_effort_answer", lambda *a, **k: ("kernel answer", "fake-model", "fake_backend"))

    auth = configured_memory_principal("oracle-kernel-trace")
    client = _client(auth.headers)
    response = client.post(
        "/oracle/chat",
        json={"prompt": "Plan the architecture tradeoff for the runtime compiler rollout.", "priority": "normal"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["routing_trace"]["kernel_v2"]["plan"]["lane"] == "deep"
    assert body["routing_trace"]["kernel_v2"]["result"]["actual_lane"] == "best_effort"

    status = client.get("/oracle/kernel/status")
    assert status.status_code == 200
    snapshot = status.json()
    assert snapshot["success"] is True
    assert snapshot["telemetry"]["events"] == 1
    assert snapshot["latest"]["planned_lane"] == "deep"



def test_mission_control_summary_surfaces_kernel_performance(monkeypatch):
    monkeypatch.setenv("ORACLE_KERNEL_V2_ENABLED", "true")
    monkeypatch.setenv("ORACLE_KERNEL_V2_MODE", "active")

    trace = cortex_kernel_v2.prepare_request(
        "What is the capital of Texas?",
        session_key="session:mc-kernel",
    )
    cortex_kernel_v2.finalize_request(
        trace["request_id"],
        response="Austin",
        actual_lane="semantic_guardrail_factual",
        used_backend="deterministic-semantic-guardrail",
        contract_ok=True,
    )
    nexus_trace = cortex_kernel_v2.prepare_request(
        "Plan the runtime compiler rollout and benchmark strategy.",
        session_key="session:mc-kernel-nexus",
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

    payload = mission_control_service.board()

    assert payload["summary"]["kernel_v2"]["events"] >= 2
    assert payload["summary"]["kernel_v2"]["runtimes"]["oracle"]["events"] == 1
    assert payload["summary"]["kernel_v2"]["runtimes"]["nexus"]["events"] == 1
    assert "latency_p95_ms" in payload["summary"]["kernel_v2"]
