from fastapi.testclient import TestClient

from cortex_server.main import create_app


def test_non_loopback_write_requires_configured_token(monkeypatch):
    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "token_required")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "test-write-token")
    app = create_app()

    @app.post("/__write_auth_probe")
    async def write_auth_probe():
        return {"ok": True}

    client = TestClient(app)
    assert client.post("/__write_auth_probe").status_code == 403
    assert client.post("/__write_auth_probe", headers={"x-cortex-write-token": "wrong"}).status_code == 403
    response = client.post("/__write_auth_probe", headers={"x-cortex-write-token": "test-write-token"})
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_openapi_declares_security_for_mutating_operations(monkeypatch):
    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "token_or_loopback")
    app = create_app()
    schema = app.openapi()
    assert schema["components"]["securitySchemes"]["CortexWriteToken"]["type"] == "apiKey"
    post_operations = [item["post"] for item in schema["paths"].values() if "post" in item]
    assert post_operations
    assert all(operation["security"] == [{"CortexWriteToken": []}] for operation in post_operations)


def test_readiness_and_capability_inventory_are_explicit(monkeypatch):
    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "token_or_loopback")
    app = create_app()
    client = TestClient(app)
    readiness = client.get("/ready")
    assert readiness.status_code == 200, readiness.text
    assert readiness.json()["checks"]["requiredPaths"]["ok"] is True
    capabilities = client.get("/capabilities").json()
    assert capabilities["schemaVersion"] == "cortex.capability_inventory.v1"
    assert capabilities["writeCapabilityCount"] > 0
    assert capabilities["security"]["writeAuthorizationMode"] == "token_or_loopback"
