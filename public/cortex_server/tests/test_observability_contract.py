from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from cortex_server.middleware.error_handler import RequestIDMiddleware
from cortex_server.middleware.hud_middleware import HUDMiddleware, track_level
from cortex_server.middleware.observability import ObservabilityMiddleware
from cortex_server.modules.metrics_store import snapshot_metrics


def _client():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(ObservabilityMiddleware)
    app.add_middleware(HUDMiddleware)

    @app.get("/demo")
    async def demo(request: Request):
        track_level(request, 36, "Conductor", always_on=False)
        return {"response": "  hello world  "}

    return TestClient(app)


def test_contract_normalization_and_success_default():
    c = _client()
    r = c.get("/demo")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["response"] == "hello world"
    assert body["response_shape_version"] == "cortex.v1"
    assert body["contract"]["identity_phrase"]
    assert body["contract"]["activation_metadata_available"] is True
    assert body["contract"]["contract_version"] == "cortex.contract.v1"


def test_observability_metrics_populated():
    c = _client()
    c.get("/demo")
    m = snapshot_metrics()
    assert m["requests_total"] >= 1
    assert isinstance(m["status_codes"], dict)
