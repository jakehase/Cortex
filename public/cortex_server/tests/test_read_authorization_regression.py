from __future__ import annotations

import json

import httpx
import pytest

import cortex_server.main as main
from cortex_server.modules import cortex_kernel_v2
from cortex_server.modules.memory_scope import memory_scope_signature
import cortex_server.routers.orchestrator as orchestrator


SCOPE_SECRET = "read-scope-secret"
ADMIN_SECRET = "read-admin-secret"
ALICE_SCOPE = {
    "tenant_id": "tenant-a",
    "workspace_id": "workspace-a",
    "agent_id": "agent-alice",
    "user_id": "alice",
    "channel_id": "api",
    "session_id": "alice-session",
}
BOB_SCOPE = {
    "tenant_id": "tenant-b",
    "workspace_id": "workspace-b",
    "agent_id": "agent-bob",
    "user_id": "bob",
    "channel_id": "api",
    "session_id": "bob-session",
}


def _credential_registry() -> str:
    return json.dumps(
        {
            "readers": {
                "secret": SCOPE_SECRET,
                "allowed_scopes": [ALICE_SCOPE, BOB_SCOPE],
            }
        }
    )


def _principal_headers(scope: dict[str, str]) -> dict[str, str]:
    signature = memory_scope_signature(
        **scope,
        credential_id="readers",
        secret=SCOPE_SECRET,
    )
    return {
        **{f"x-cortex-{key.replace('_', '-')}": value for key, value in scope.items()},
        "x-cortex-scope-credential-id": "readers",
        "x-cortex-scope-signature": signature,
    }


def _configured_app(monkeypatch):
    monkeypatch.setenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", _credential_registry())
    monkeypatch.setenv("CORTEX_ADMIN_TOKEN", ADMIN_SECRET)
    monkeypatch.setenv("CORTEX_CODEC_ADMIN_TOKEN", "codec-admin-secret")
    monkeypatch.setenv("CORTEX_FAIL_CLOSED_MEMORY_ENDPOINTS", "false")
    return main.create_app()


@pytest.mark.asyncio
async def test_kernel_telemetry_requires_authentication_and_is_operationally_redacted(monkeypatch):
    app = _configured_app(monkeypatch)
    raw_payload = {
        "status": {
            "latest": {
                "prompt_preview": "private prompt preview",
                "session_key": "private-session-key",
                "runtime": "nexus",
            }
        },
        "events": [
            {
                "prompt": "full private prompt",
                "session_id": "private-session-id",
                "memory_facts": [{"value": "private durable fact"}],
                "classes": {"learned_memory": [{"value": "private preference"}]},
            }
        ],
    }
    monkeypatch.setattr(cortex_kernel_v2, "diagnostic_bundle", lambda **_kwargs: raw_payload)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        for path in (
            "/nexus/kernel/telemetry",
            "/oracle/kernel/telemetry",
            "/meta_conductor/kernel/telemetry",
        ):
            denied = await client.get(path)
            assert denied.status_code == 403

            forged_headers = _principal_headers(ALICE_SCOPE)
            forged_headers["x-cortex-scope-signature"] = "0" * 64
            forged = await client.get(path, headers=forged_headers)
            assert forged.status_code == 403

            principal_response = await client.get(path, headers=_principal_headers(ALICE_SCOPE))
            assert principal_response.status_code == 200
            serialized = json.dumps(principal_response.json(), sort_keys=True)
            assert "private prompt" not in serialized
            assert "private-session" not in serialized
            assert "private durable fact" not in serialized
            assert "private preference" not in serialized
            assert "[REDACTED]" in serialized

            admin_response = await client.get(
                path,
                headers={"x-cortex-admin-token": ADMIN_SECRET},
            )
            assert admin_response.status_code == 200
            assert "private prompt" not in json.dumps(admin_response.json(), sort_keys=True)

        monkeypatch.setattr(
            cortex_kernel_v2,
            "performance_snapshot",
            lambda **_kwargs: raw_payload["status"],
        )
        for path in ("/nexus/status", "/nexus/context"):
            public_status = await client.get(path)
            assert public_status.status_code == 200
            serialized = json.dumps(public_status.json(), sort_keys=True)
            assert "private prompt" not in serialized
            assert "private-session" not in serialized

    telemetry_operation = app.openapi()["paths"]["/nexus/kernel/telemetry"]["get"]
    assert telemetry_operation["x-cortex-read-authorization-mode"] == "signed_principal_or_admin"
    assert telemetry_operation["security"] == [
        {"CortexAdminToken": []},
        {"CortexCodecAdminToken": []},
        {"CortexPrincipalSignature": []},
    ]


@pytest.mark.asyncio
async def test_runtime_reads_filter_collections_and_enforce_resource_owner_or_tenant(monkeypatch):
    app = _configured_app(monkeypatch)
    processes = {
        "proc_alice": {
            "process_id": "proc_alice",
            "owner": "alice",
            "session_key": "alice-runtime-session",
            "status": "running",
            "workflow": {"name": "alice work", "metadata": {"tenant_id": "tenant-a"}},
        },
        "proc_bob": {
            "process_id": "proc_bob",
            "owner": "bob",
            "session_key": "bob-runtime-session",
            "status": "running",
            "workflow": {"name": "bob work", "metadata": {"tenant_id": "tenant-b"}},
        },
        "proc_tenant_a": {
            "process_id": "proc_tenant_a",
            "owner": "tenant-service",
            "session_key": "tenant-service-session",
            "status": "running",
            "workflow": {"name": "tenant work", "metadata": {"tenant_id": "tenant-a"}},
        },
    }

    class _EmptyStore:
        def list(self, **_kwargs):
            return []

    monkeypatch.setattr(main, "_runtime_process_for_read_authorization", processes.get)
    monkeypatch.setattr(orchestrator, "list_runtime_processes", lambda: list(processes.values()))
    monkeypatch.setattr(
        orchestrator,
        "_runtime_delivery_stores",
        lambda: {"session_registry": _EmptyStore(), "watcher_store": _EmptyStore()},
    )
    monkeypatch.setattr(orchestrator, "get_runtime_process", processes.get)
    monkeypatch.setattr(orchestrator, "get_runtime_events", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(orchestrator, "get_codec_packet_for_session", lambda *_args, **_kwargs: {"state": {}})
    monkeypatch.setattr(
        orchestrator,
        "build_lineage_bundle",
        lambda **_kwargs: {
            "success": True,
            "classes": {"learned_memory": [{"value": "owner-visible preference"}]},
        },
    )

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/orchestrator/runtime/processes")).status_code == 403

        alice_list = await client.get(
            "/orchestrator/runtime/processes",
            headers=_principal_headers(ALICE_SCOPE),
        )
        assert alice_list.status_code == 200
        assert [row["process_id"] for row in alice_list.json()["processes"]] == [
            "proc_alice",
            "proc_tenant_a",
        ]

        cross_owner = await client.get(
            "/orchestrator/runtime/lineage/proc_bob",
            headers=_principal_headers(ALICE_SCOPE),
        )
        assert cross_owner.status_code == 403

        owner_lineage = await client.get(
            "/orchestrator/runtime/lineage/proc_alice",
            headers=_principal_headers(ALICE_SCOPE),
        )
        assert owner_lineage.status_code == 200
        assert owner_lineage.json()["classes"]["learned_memory"][0]["value"] == "owner-visible preference"

        tenant_lineage = await client.get(
            "/orchestrator/runtime/lineage/proc_tenant_a",
            headers=_principal_headers(ALICE_SCOPE),
        )
        assert tenant_lineage.status_code == 200

        cross_policy_history = await client.get(
            "/orchestrator/runtime/policy-history/proc_bob",
            headers=_principal_headers(ALICE_SCOPE),
        )
        assert cross_policy_history.status_code == 403

        admin_lineage = await client.get(
            "/orchestrator/runtime/lineage/proc_bob",
            headers={"x-cortex-admin-token": ADMIN_SECRET},
        )
        assert admin_lineage.status_code == 200


@pytest.mark.asyncio
async def test_sensitive_reads_fail_closed_when_no_read_credentials_are_configured(monkeypatch):
    monkeypatch.delenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", raising=False)
    monkeypatch.delenv("CORTEX_ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("CORTEX_CODEC_ADMIN_TOKEN", raising=False)
    monkeypatch.setenv("CORTEX_FAIL_CLOSED_MEMORY_ENDPOINTS", "false")
    app = main.create_app()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/nexus/kernel/telemetry")

    assert response.status_code == 503
    assert response.json() == {
        "success": False,
        "error": "sensitive read authorization is not configured",
    }


@pytest.mark.asyncio
async def test_sensitive_reads_accept_fresh_sessions_from_bounded_dynamic_policy(monkeypatch):
    credential_id = "dynamic-readers"
    secret = "dynamic-read-secret"
    fixed_scope = {key: value for key, value in ALICE_SCOPE.items() if key != "session_id"}
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps(
            {
                credential_id: {
                    "secret": secret,
                    "allowed_scopes": [
                        {
                            **fixed_scope,
                            "session_id": {
                                "type": "signed_dynamic",
                                "prefix": "openclaw-",
                                "max_length": 80,
                            },
                        }
                    ],
                }
            }
        ),
    )
    monkeypatch.delenv("CORTEX_ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("CORTEX_CODEC_ADMIN_TOKEN", raising=False)
    monkeypatch.setenv("CORTEX_FAIL_CLOSED_MEMORY_ENDPOINTS", "false")
    app = main.create_app()
    monkeypatch.setattr(cortex_kernel_v2, "diagnostic_bundle", lambda **_kwargs: {"status": "ok"})

    assert app.state.read_authorization.configuration_error is None
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        for suffix in ("a" * 64, "b" * 64):
            scope = {**fixed_scope, "session_id": f"openclaw-{suffix}"}
            headers = {
                **{f"x-cortex-{key.replace('_', '-')}": value for key, value in scope.items()},
                "x-cortex-scope-credential-id": credential_id,
                "x-cortex-scope-signature": memory_scope_signature(
                    **scope,
                    credential_id=credential_id,
                    secret=secret,
                ),
            }
            response = await client.get("/nexus/kernel/telemetry", headers=headers)
            assert response.status_code == 200

        outside_scope = {**fixed_scope, "session_id": "other-session"}
        denied = await client.get(
            "/nexus/kernel/telemetry",
            headers={
                **{f"x-cortex-{key.replace('_', '-')}": value for key, value in outside_scope.items()},
                "x-cortex-scope-credential-id": credential_id,
                "x-cortex-scope-signature": memory_scope_signature(
                    **outside_scope,
                    credential_id=credential_id,
                    secret=secret,
                ),
            },
        )
        assert denied.status_code == 403
