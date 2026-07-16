from __future__ import annotations

import json
import sqlite3

import httpx
import pytest

import cortex_server.main as main
from cortex_server.modules import cortex_kernel_v2
from cortex_server.modules.memory_scope import AuthenticatedMemoryPrincipal, memory_scope_signature
import cortex_server.routers.orchestrator as orchestrator


SCOPE_SECRET = "read-scope-secret-00000000000000001"
ADMIN_SECRET = "read-admin-secret-00000000000000001"
WRITE_SECRET = "read-write-secret-00000000000000001"
RELEASE_ARTIFACT_SECRET = "read-release-artifact-secret-0000000001"
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


def _storage_workspace(scope: dict[str, str]) -> str:
    return AuthenticatedMemoryPrincipal(
        credential_id="readers",
        **scope,
    ).storage_workspace_id


def _process_identity(scope: dict[str, str], *, owner: str) -> dict[str, str]:
    return {
        "tenant_id": scope["tenant_id"],
        "storage_workspace_id": _storage_workspace(scope),
        "owner": owner,
        "user_id": owner,
        "agent_id": scope["agent_id"],
    }


def _configured_app(monkeypatch):
    monkeypatch.setenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", _credential_registry())
    monkeypatch.setenv("CORTEX_ADMIN_TOKEN", ADMIN_SECRET)
    monkeypatch.setenv("CORTEX_CODEC_ADMIN_TOKEN", "codec-admin-secret-0000000000000001")
    monkeypatch.setenv("CORTEX_FAIL_CLOSED_MEMORY_ENDPOINTS", "false")
    return main.create_app()


def _configured_production_app(monkeypatch, tmp_path):
    from cortex_server.runtime import production_build_loop

    knowledge_root = tmp_path / "knowledge"
    knowledge_root.mkdir()
    database = knowledge_root / "cortex_graph.db"
    with sqlite3.connect(database):
        pass
    mount_id = "read-test-knowledge-volume-id"
    (knowledge_root / ".cortex-durable-knowledge").write_text(
        f"{mount_id}\n", encoding="utf-8"
    )

    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv("CORTEX_DB_PATH", str(database))
    monkeypatch.setenv("CORTEX_KNOWLEDGE_MOUNT_ID", mount_id)
    monkeypatch.setenv("CORTEX_WRITE_AUTH_MODE", "token_required")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", WRITE_SECRET)
    monkeypatch.setenv("CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN", RELEASE_ARTIFACT_SECRET)
    monkeypatch.setenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", _credential_registry())
    monkeypatch.setenv("CORTEX_ADMIN_TOKEN", ADMIN_SECRET)
    monkeypatch.setenv("CORTEX_CODEC_ADMIN_TOKEN", "codec-admin-secret-0000000000000001")
    monkeypatch.setenv("CORTEX_REQUIRED_PATHS", "")
    monkeypatch.setenv("CORTEX_REQUIRED_ROUTERS", "")
    monkeypatch.setenv("CORTEX_FAIL_CLOSED_MEMORY_ENDPOINTS", "false")
    monkeypatch.setattr(production_build_loop, "validate_production_delivery_credentials", lambda: None)

    def load_test_routes(app, *, safe_mode):
        del safe_mode
        app.state.artifact_ingest_calls = []

        @app.post("/orchestrator/runtime/cancel/{process_id}")
        async def cancel(process_id: str):
            return {"success": True, "process_id": process_id}

        @app.post("/orchestrator/runtime/maintenance/intake")
        async def global_maintenance():
            return {"success": True}

        async def artifact_ingest(process_id: str):
            app.state.artifact_ingest_calls.append(process_id)
            return {"success": True, "process_id": process_id}

        for prefix in ("orchestrator", "conductor"):
            app.add_api_route(
                f"/{prefix}/runtime/delivery/artifacts/{{process_id}}",
                artifact_ingest,
                methods=["POST"],
                name=f"{prefix}_artifact_ingest",
            )

        @app.post("/nexus/codec/corpus-replay")
        async def codec_control():
            return {"success": True}

        @app.post("/knowledge/nodes")
        async def scoped_node(_payload: dict):
            return {"success": True}

        return {"loaded": [], "missing": [], "failed": []}

    monkeypatch.setattr(main, "load_dynamic_routers", load_test_routes)
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
        {"CortexPrincipalSignature": []},
    ]


@pytest.mark.asyncio
async def test_codec_admin_read_credential_is_confined_to_codec_routes(monkeypatch):
    app = _configured_app(monkeypatch)
    codec_headers = {
        "x-cortex-codec-admin-token": "codec-admin-secret-0000000000000001",
    }

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        codec_status = await client.get("/nexus/codec/status", headers=codec_headers)
        assert codec_status.status_code == 200

        unrelated_admin_read = await client.get(
            "/nexus/kernel/telemetry",
            headers=codec_headers,
        )
        assert unrelated_admin_read.status_code == 403

    schema = app.openapi()
    assert {"CortexCodecAdminToken": []} in schema["paths"]["/nexus/codec/status"]["get"]["security"]
    assert {"CortexCodecAdminToken": []} not in schema["paths"]["/nexus/kernel/telemetry"]["get"]["security"]


@pytest.mark.asyncio
async def test_runtime_reads_require_exact_tenant_workspace_and_owner(monkeypatch):
    app = _configured_app(monkeypatch)
    processes = {
        "proc_alice": {
            "process_id": "proc_alice",
            "owner": "alice",
            "session_key": "alice-runtime-session",
            "status": "running",
            "workflow": {
                "name": "alice work",
                "metadata": _process_identity(ALICE_SCOPE, owner="alice"),
            },
        },
        "proc_bob": {
            "process_id": "proc_bob",
            "owner": "bob",
            "session_key": "bob-runtime-session",
            "status": "running",
            "workflow": {
                "name": "bob work",
                "metadata": _process_identity(BOB_SCOPE, owner="bob"),
            },
        },
        "proc_same_tenant_bob": {
            "process_id": "proc_same_tenant_bob",
            "owner": "bob",
            "session_key": "same-tenant-bob-session",
            "status": "running",
            "workflow": {
                "name": "same tenant, different owner",
                "metadata": _process_identity(ALICE_SCOPE, owner="bob"),
            },
        },
        "proc_cross_tenant_alice": {
            "process_id": "proc_cross_tenant_alice",
            "owner": "alice",
            "session_key": "cross-tenant-alice-session",
            "status": "running",
            "workflow": {
                "name": "different tenant, colliding owner",
                "metadata": _process_identity(BOB_SCOPE, owner="alice"),
            },
        },
        "proc_other_workspace_alice": {
            "process_id": "proc_other_workspace_alice",
            "owner": "alice",
            "session_key": "other-workspace-alice-session",
            "status": "running",
            "workflow": {
                "name": "same tenant and owner, different storage workspace",
                "metadata": {
                    **_process_identity(ALICE_SCOPE, owner="alice"),
                    "storage_workspace_id": "principal-other-workspace",
                },
            },
        },
        "proc_legacy_alice": {
            "process_id": "proc_legacy_alice",
            "owner": "alice",
            "session_key": "legacy-alice-session",
            "status": "running",
            "workflow": {
                "name": "legacy incomplete identity",
                "metadata": {"tenant_id": ALICE_SCOPE["tenant_id"], "owner": "alice"},
            },
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

        for process_id in (
            "proc_same_tenant_bob",
            "proc_cross_tenant_alice",
            "proc_other_workspace_alice",
            "proc_legacy_alice",
        ):
            collision = await client.get(
                f"/orchestrator/runtime/lineage/{process_id}",
                headers=_principal_headers(ALICE_SCOPE),
            )
            assert collision.status_code == 403

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
async def test_production_mutations_require_exact_principal_ownership_or_admin(monkeypatch, tmp_path):
    processes = {
        "proc_alice": {
            "process_id": "proc_alice",
            "owner": "alice",
            "workflow": {"metadata": _process_identity(ALICE_SCOPE, owner="alice")},
        },
        "proc_bob": {
            "process_id": "proc_bob",
            "owner": "bob",
            "workflow": {"metadata": _process_identity(BOB_SCOPE, owner="bob")},
        },
    }
    monkeypatch.setattr(main, "_runtime_process_for_read_authorization", processes.get)
    app = _configured_production_app(monkeypatch, tmp_path)
    alice_headers = {**_principal_headers(ALICE_SCOPE), "x-cortex-write-token": WRITE_SECRET}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        unauthenticated = await client.post(
            "/orchestrator/runtime/cancel/proc_alice",
            headers={"x-cortex-write-token": WRITE_SECRET},
        )
        assert unauthenticated.status_code == 403

        cross_principal = await client.post(
            "/orchestrator/runtime/cancel/proc_bob",
            headers=alice_headers,
        )
        assert cross_principal.status_code == 403

        # Release-artifact transport credentials remain independent of memory
        # principals, and neither compatibility alias may bypass that credential.
        for prefix in ("orchestrator", "conductor"):
            artifact_path = f"/{prefix}/runtime/delivery/artifacts/proc_alice"
            accepted_before = list(app.state.artifact_ingest_calls)
            missing_transport = await client.post(
                artifact_path,
                headers=_principal_headers(ALICE_SCOPE),
            )
            assert missing_transport.status_code == 403
            assert app.state.artifact_ingest_calls == accepted_before

            forged_transport = await client.post(
                artifact_path,
                headers={
                    **_principal_headers(ALICE_SCOPE),
                    "x-cortex-release-artifact-token": "forged-release-token-00000000000001",
                },
            )
            assert forged_transport.status_code == 403
            assert app.state.artifact_ingest_calls == accepted_before

            independently_authenticated_transport = await client.post(
                artifact_path,
                headers={"x-cortex-release-artifact-token": RELEASE_ARTIFACT_SECRET},
            )
            assert independently_authenticated_transport.status_code == 200

        assert app.state.artifact_ingest_calls == ["proc_alice", "proc_alice"]

        owned = await client.post(
            "/orchestrator/runtime/cancel/proc_alice",
            headers=alice_headers,
        )
        assert owned.status_code == 200

        conflicting_payload_scope = await client.post(
            "/knowledge/nodes",
            headers=alice_headers,
            json={"scope": BOB_SCOPE},
        )
        assert conflicting_payload_scope.status_code == 403

        global_as_principal = await client.post(
            "/orchestrator/runtime/maintenance/intake",
            headers=alice_headers,
        )
        assert global_as_principal.status_code == 403

        global_as_admin = await client.post(
            "/orchestrator/runtime/maintenance/intake",
            headers={
                "x-cortex-write-token": WRITE_SECRET,
                "x-cortex-admin-token": ADMIN_SECRET,
            },
        )
        assert global_as_admin.status_code == 200

        codec_admin_cannot_mutate_globally = await client.post(
            "/orchestrator/runtime/maintenance/intake",
            headers={
                "x-cortex-write-token": WRITE_SECRET,
                "x-cortex-codec-admin-token": "codec-admin-secret-0000000000000001",
            },
        )
        assert codec_admin_cannot_mutate_globally.status_code == 403

        codec_admin_control = await client.post(
            "/nexus/codec/corpus-replay",
            headers={
                "x-cortex-write-token": WRITE_SECRET,
                "x-cortex-codec-admin-token": "codec-admin-secret-0000000000000001",
            },
        )
        assert codec_admin_control.status_code == 200


@pytest.mark.asyncio
async def test_read_route_inventory_is_explicit_and_guards_aliases_and_state(monkeypatch):
    app = _configured_app(monkeypatch)
    declared = {}
    for route in main._effective_routes(app.routes):
        methods = set(getattr(route, "methods", None) or ())
        if not methods & {"GET", "HEAD"}:
            continue
        policy = getattr(route, "cortex_read_policy", None)
        assert policy in main._READ_POLICIES, getattr(route, "path", None)
        if hasattr(route, "openapi_extra"):
            assert route.openapi_extra[main._READ_POLICY_METADATA_KEY] == policy
        declared[getattr(route, "path")] = policy

    assert declared["/conductor/runtime/processes"] == "runtime_collection"
    assert declared["/conductor/runtime/process/{process_id}"] == "runtime_resource"
    assert declared["/orchestrator/runtime-delivery/readiness"] == "public_redacted"
    assert declared["/conductor/runtime-delivery/readiness"] == "public_redacted"
    for path in (
        "/nexus/autotune/status",
        "/awareness/memory",
        "/everyday_intel/decision/review",
        "/everyday_intel/profile/snapshot",
        "/homeassistant/states",
    ):
        assert declared[path] == "admin_redacted"

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        for path in (
            "/conductor/runtime/processes",
            "/conductor/runtime/process/unknown",
            "/nexus/autotune/status",
            "/awareness/memory",
            "/everyday_intel/decision/review",
            "/everyday_intel/profile/snapshot",
            "/homeassistant/states",
        ):
            response = await client.get(path)
            assert response.status_code == 403, path


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
