from fastapi.testclient import TestClient
import pytest

from cortex_server.main import _public_readiness_view, create_app


def test_production_rejects_disabled_or_unprovisioned_write_authorization(monkeypatch):
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "disabled")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "x" * 64)
    with pytest.raises(RuntimeError, match="cannot disable"):
        create_app()

    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "token_required")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "short")
    with pytest.raises(RuntimeError, match="at least 32 bytes"):
        create_app()


def test_public_readiness_view_is_metadata_only():
    opaque = "opaque-ready-error-secret-1234567890"
    view = _public_readiness_view(
        {
            "ready": False,
            "checks": {
                "structuralGraph": {
                    "ok": False,
                    "required": True,
                    "status": "degraded",
                    "path": f"/private/{opaque}/graph.db",
                    "error": opaque,
                    "checks": {"raw": opaque},
                }
            },
            "routerLoad": {
                "loadedCount": 3,
                "failed": [{"error": opaque}],
                "missingRouter": [opaque],
                "safeModeSkipped": [opaque],
            },
        }
    )

    assert opaque not in str(view)
    assert view["checks"] == {
        "structuralGraph": {
            "ok": False,
            "required": True,
            "status": "degraded",
        }
    }
    assert view["routerLoad"] == {
        "loadedCount": 3,
        "failedCount": 1,
        "missingRouterCount": 1,
        "safeModeSkippedCount": 1,
    }

def test_non_loopback_write_requires_configured_token(monkeypatch):
    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "token_required")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "test-write-token")
    monkeypatch.setenv("CORTEX_ADMIN_TOKEN", "test-admin-token")
    app = create_app()

    @app.post("/__write_auth_probe")
    async def write_auth_probe():
        return {"ok": True}

    client = TestClient(app)
    assert client.post("/__write_auth_probe").status_code == 403
    assert client.post("/__write_auth_probe", headers={"x-cortex-write-token": "wrong"}).status_code == 403
    response = client.post(
        "/__write_auth_probe",
        headers={
            "x-cortex-write-token": "test-write-token",
            "x-cortex-admin-token": "test-admin-token",
        },
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_openapi_declares_security_for_mutating_operations(monkeypatch):
    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "token_or_loopback")
    app = create_app()
    schema = app.openapi()
    assert schema["components"]["securitySchemes"]["CortexWriteToken"]["type"] == "apiKey"
    post_operations = [item["post"] for item in schema["paths"].values() if "post" in item]
    assert post_operations
    assert all(
        all("CortexWriteToken" in alternative for alternative in operation["security"])
        for operation in post_operations
    )
    for operation in post_operations:
        actor_schemes = {
            key
            for alternative in operation["security"]
            for key in alternative
            if key in {"CortexPrincipalSignature", "CortexAdminToken"}
        }
        if operation["x-cortex-global-admin-required"]:
            assert actor_schemes == {"CortexAdminToken"}
            assert len(operation["security"]) == 1
        else:
            assert actor_schemes == {"CortexPrincipalSignature", "CortexAdminToken"}
    action_headers = {
        "CortexActionCapability": "x-cortex-action-signature",
        "CortexActionNonce": "x-cortex-action-nonce",
        "CortexActionIssuedAt": "x-cortex-action-issued-at",
        "CortexActionExpiresAt": "x-cortex-action-expires-at",
    }
    for scheme_name, header_name in action_headers.items():
        assert schema["components"]["securitySchemes"][scheme_name]["name"] == header_name

    assert schema["paths"]["/homeassistant/policy"]["post"][
        "x-cortex-global-admin-required"
    ] is True
    assert schema["paths"]["/homeassistant/events/{event_type}"]["post"][
        "x-cortex-action-capability-required"
    ] is True
    assert all(
        set(action_headers).issubset(alternative)
        for alternative in schema["paths"]["/homeassistant/events/{event_type}"]["post"][
            "security"
        ]
    )
    assert schema["paths"]["/cron/schedule"]["post"][
        "x-cortex-action-capability-required"
    ] is True
    assert schema["paths"]["/cron/trigger"]["post"][
        "x-cortex-action-capability-required"
    ] is True
    assert schema["paths"]["/cron/cadence_twin"]["post"][
        "x-cortex-action-capability-required"
    ] is False
    assert schema["paths"]["/autonomy_governor/evaluate"]["post"][
        "x-cortex-action-capability-required"
    ] is False
    assert schema["paths"]["/autonomy_governor/evaluate"]["post"][
        "x-cortex-global-admin-required"
    ] is True
    assert schema["paths"]["/browser/twin/query"]["post"][
        "x-cortex-global-admin-required"
    ] is True
    assert schema["paths"]["/browser/browse"]["post"][
        "x-cortex-global-admin-required"
    ] is False
    assert schema["paths"]["/tools/docker/run"]["post"][
        "x-cortex-global-admin-required"
    ] is True


def test_readiness_and_capability_inventory_are_explicit(monkeypatch):
    async def reachable_probe(**_kwargs):
        return {"ok": True, "status": "reachable", "target": "http://127.0.0.1:8000/_internal/reachability"}

    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "token_or_loopback")
    monkeypatch.setattr("cortex_server.main.probe_internal_reachability", reachable_probe)
    app = create_app()
    client = TestClient(app)
    readiness = client.get("/ready")
    assert readiness.status_code == 503, readiness.text
    assert readiness.json()["checks"]["requiredPaths"]["ok"] is True
    assert readiness.json()["checks"]["redis"] == {"ok": False}
    capabilities = client.get("/capabilities").json()
    assert capabilities["schemaVersion"] == "cortex.capability_inventory.v1"
    assert capabilities["writeCapabilityCount"] > 0
    assert capabilities["actionCapabilityCount"] > 0
    assert capabilities["websocketCapabilityCount"] == 2
    assert capabilities["security"]["writeAuthorizationMode"] == "token_or_loopback"
    rows = {
        (row["path"], tuple(row["methods"])): row
        for row in capabilities["capabilities"]
    }
    event = rows[("/homeassistant/events/{event_type}", ("POST",))]
    assert event["actionCapabilityRequired"] is True
    assert event["principalScopeRequired"] is True
    assert event["globalAdminRequired"] is False
    assert event["sensitivity"] == "principal_scoped"
    policy = rows[("/homeassistant/policy", ("POST",))]
    assert policy["globalAdminRequired"] is True
    assert policy["sensitivity"] == "admin"
    progress = rows[("/ws/progress", ("WEBSOCKET",))]
    logs = rows[("/ws/logs/{container_id}", ("WEBSOCKET",))]
    assert progress["protocol"] == "websocket"
    assert progress["sensitivity"] == "transport_authenticated"
    assert logs["globalAdminRequired"] is True
    assert logs["sensitivity"] == "admin"
