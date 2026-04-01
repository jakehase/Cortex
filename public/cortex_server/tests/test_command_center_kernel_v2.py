import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.modules import cortex_kernel_v2
import cortex_server.routers.command_center as command_center
import cortex_server.routers.command_center_live as command_center_live


ROUTERS = [
    (command_center, "/command_center"),
    (command_center_live, "/command_center_live"),
]


def setup_function():
    cortex_kernel_v2.reset_state()


@pytest.mark.parametrize(("module", "prefix"), ROUTERS)
def test_command_center_surfaces_kernel_summary(module, prefix):
    oracle_trace = cortex_kernel_v2.prepare_request(
        "What is the capital of Texas?",
        runtime="oracle",
        surface="chat",
    )
    cortex_kernel_v2.finalize_request(
        oracle_trace["request_id"],
        response="Austin.",
        actual_lane="semantic_guardrail_factual",
        used_backend="oracle-fastlane",
        contract_ok=True,
    )
    meta_trace = cortex_kernel_v2.prepare_request(
        "Delegate the rollout plan through meta conductor.",
        runtime="meta_conductor",
        surface="orchestrate",
    )
    cortex_kernel_v2.finalize_request(
        meta_trace["request_id"],
        response="Delegated via nexus.",
        actual_lane="meta_conductor_orchestrated",
        used_backend="delegated_nexus",
        contract_ok=True,
    )

    app = FastAPI()
    app.include_router(module.router, prefix=prefix)
    client = TestClient(app)

    state = client.get(f"{prefix}/state", params={"seed": 7})
    assert state.status_code == 200
    state_body = state.json()
    assert state_body["kernel_v2"]["events"] == 2
    assert state_body["kernel_v2"]["runtimes"]["meta_conductor"]["events"] == 1
    assert state_body["latest_kernel_event"]["runtime"] == "meta_conductor"

    sweep = client.post(f"{prefix}/action", json={"action": "kernel_sweep", "params": {}})
    assert sweep.status_code == 200
    payload = sweep.json()
    assert payload["action"] == "kernel_sweep"
    assert payload["kernel_v2"]["surfaces"]["orchestrate"]["events"] == 1
