import asyncio
import json

import pytest
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from cortex_server.modules import cortex_codec
from cortex_server.modules.memory_scope import (
    MemoryScopeAuthError,
    authenticate_memory_headers,
    configured_internal_memory_headers,
    memory_scope_signature,
    require_authenticated_memory_principal,
    scoped_memory_metadata,
)
from cortex_server.routers import knowledge, l22, librarian, nexus


_SECRET_A = "principal-a-memory-secret-20260821"
_SECRET_B = "principal-b-memory-secret-20260821"
_SCOPE_A = {
    "tenant_id": "tenant-a",
    "workspace_id": "workspace-a",
    "agent_id": "agent-a",
    "user_id": "user-a",
    "channel_id": "channel-a",
    "session_id": "session-a",
}
_SCOPE_B = {
    "tenant_id": "tenant-b",
    "workspace_id": "workspace-b",
    "agent_id": "agent-b",
    "user_id": "user-b",
    "channel_id": "channel-b",
    "session_id": "session-b",
}


def _credentials():
    return {
        "credential-a": {"secret": _SECRET_A, "allowed_scopes": [_SCOPE_A]},
        "credential-b": {"secret": _SECRET_B, "allowed_scopes": [_SCOPE_B]},
    }


def _headers(scope, credential_id, secret):
    signature = memory_scope_signature(
        **scope,
        credential_id=credential_id,
        secret=secret,
    )
    return {
        "x-cortex-tenant-id": scope["tenant_id"],
        "x-cortex-workspace-id": scope["workspace_id"],
        "x-cortex-agent-id": scope["agent_id"],
        "x-cortex-user-id": scope["user_id"],
        "x-cortex-channel-id": scope["channel_id"],
        "x-cortex-session-id": scope["session_id"],
        "x-cortex-scope-credential-id": credential_id,
        "x-cortex-scope-signature": signature,
    }


@pytest.fixture(autouse=True)
def _configured_principals(monkeypatch):
    monkeypatch.setenv("CORTEX_ENV", "development")
    monkeypatch.setenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", json.dumps(_credentials()))
    monkeypatch.delenv("CORTEX_ALLOW_UNSIGNED_LOCAL_MEMORY_PRINCIPAL", raising=False)


def _nexus_client():
    app = FastAPI()
    app.include_router(nexus.router, prefix="/nexus")
    return TestClient(app)


def _dependency_calls(route):
    return {dependency.call for dependency in route.dependant.dependencies}


def _request_from(client_host):
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/memory",
            "raw_path": b"/memory",
            "query_string": b"",
            "headers": [],
            "client": (client_host, 41000),
            "server": ("cortex.test", 80),
        }
    )


def test_every_memory_compatibility_and_codec_route_uses_shared_principal_dependency():
    for router in (knowledge.router, l22.router, librarian.router):
        routes = [route for route in router.routes if hasattr(route, "dependant")]
        assert routes
        assert all(require_authenticated_memory_principal in _dependency_calls(route) for route in routes)

    codec_routes = [
        route for route in nexus.router.routes
        if hasattr(route, "dependant") and str(route.path).startswith("/codec")
    ]
    assert codec_routes
    assert all(require_authenticated_memory_principal in _dependency_calls(route) for route in codec_routes)


def test_wrong_signature_and_victim_session_selector_never_reach_codec_read(monkeypatch):
    calls = []
    monkeypatch.setattr(
        nexus,
        "get_codec_debug_view",
        lambda session_key, **kwargs: calls.append(session_key) or {"session_key": session_key},
    )
    client = _nexus_client()

    bad_headers = _headers(_SCOPE_A, "credential-a", _SECRET_A)
    bad_headers["x-cortex-scope-signature"] = "0" * 64
    bad_signature = client.get("/nexus/codec/status", headers=bad_headers)
    assert bad_signature.status_code == 403

    victim_selector = client.get(
        "/nexus/codec/status",
        headers=_headers(_SCOPE_A, "credential-a", _SECRET_A),
        params={"session_key": _SCOPE_B["session_id"]},
    )
    assert victim_selector.status_code == 403
    assert calls == []


def test_codec_read_and_write_keys_are_server_derived_and_distinct(monkeypatch):
    reads = []
    writes = []
    monkeypatch.setattr(
        nexus,
        "get_codec_debug_view",
        lambda session_key, **scope: reads.append((session_key, scope))
        or {"session_key": session_key},
    )
    monkeypatch.setattr(
        nexus,
        "update_codec_state_for_session",
        lambda session_key, events, **scope: writes.append(
            (session_key, events, scope)
        )
        or {"source_event_count": len(events)},
    )
    monkeypatch.setattr(
        nexus,
        "get_codec_packet_for_session",
        lambda session_key, **kwargs: {"available": False, "session_key": session_key},
    )
    client = _nexus_client()
    headers_a = _headers(_SCOPE_A, "credential-a", _SECRET_A)
    headers_b = _headers(_SCOPE_B, "credential-b", _SECRET_B)

    read_a = client.get("/nexus/codec/status", headers=headers_a)
    read_b = client.get("/nexus/codec/status", headers=headers_b)
    assert read_a.status_code == 200
    assert read_b.status_code == 200
    assert len(reads) == 2
    assert reads[0][0] != reads[1][0]
    assert all(value[0].startswith("principal:") for value in reads)
    assert reads[0][1]["tenant_id"] == _SCOPE_A["tenant_id"]
    assert reads[1][1]["tenant_id"] == _SCOPE_B["tenant_id"]
    assert reads[0][1]["workspace_id"] != reads[1][1]["workspace_id"]

    write_a = client.post(
        "/nexus/codec/events",
        headers=headers_a,
        json={
            "session_key": _SCOPE_A["session_id"],
            "events": [{"text": "remember only for A", "metadata": {"tenant_id": "tenant-a"}}],
            "acknowledgement_only": True,
        },
    )
    assert write_a.status_code == 200
    write_ack = write_a.json()["acknowledgement"]
    assert write_ack["version"] == "nexus.codec-write-ack.v1"
    assert write_ack["status"] == "accepted"
    assert write_ack["session_key"] == reads[0][0]
    assert write_ack["event_count"] == 1
    assert write_ack["state_fingerprint"]
    assert writes[0][0] == reads[0][0]
    assert writes[0][1][0]["metadata"]["memory_principal_key"].startswith("principal:")
    assert writes[0][2]["tenant_id"] == _SCOPE_A["tenant_id"]
    assert writes[0][2]["workspace_id"].startswith("principal-")

    cross_session = client.post(
        "/nexus/codec/events",
        headers=headers_a,
        json={"session_key": _SCOPE_B["session_id"], "events": [{"text": "poison victim"}]},
    )
    assert cross_session.status_code == 403
    assert len(writes) == 1


def test_side_effecting_codec_get_modes_fail_before_work(monkeypatch):
    calls = []
    monkeypatch.setattr(
        nexus,
        "_codec_evaluation_view",
        lambda *args, **kwargs: calls.append((args, kwargs)) or {},
    )
    client = _nexus_client()
    response = client.get(
        "/nexus/codec/evaluate",
        headers=_headers(_SCOPE_A, "credential-a", _SECRET_A),
        params={"run_oracle": "true"},
    )
    assert response.status_code == 405
    assert calls == []


def test_compatibility_store_rejects_body_principal_mismatch_and_binds_idempotency(monkeypatch):
    calls = []
    monkeypatch.setattr(l22, "store_memory_record", lambda **kwargs: calls.append(kwargs) or {"status": "stored"})

    app = FastAPI()

    @app.post("/l22/store", dependencies=[Depends(require_authenticated_memory_principal)])
    async def _store(payload: l22.L22StoreRequest, request: Request):
        return await l22.l22_store(payload, request)

    client = TestClient(app)
    headers = _headers(_SCOPE_A, "credential-a", _SECRET_A)

    mismatch = client.post(
        "/l22/store",
        headers=headers,
        json={"content": "victim write", "metadata": {"tenant_id": "tenant-b"}},
    )
    assert mismatch.status_code == 403
    assert calls == []

    accepted = client.post(
        "/l22/store",
        headers={**headers, "x-idempotency-key": "idem-a"},
        json={"content": "principal A write", "idempotency_key": "idem-a"},
    )
    assert accepted.status_code == 200
    assert calls[0]["tenant_id"] == "tenant-a"
    assert calls[0]["workspace_id"].startswith("principal-")
    assert calls[0]["idempotency_key"] == "idem-a"
    assert calls[0]["metadata"]["memory_principal_key"].startswith("principal:")


def test_scoped_search_drops_rows_even_if_storage_ignores_where(monkeypatch):
    principal = authenticate_memory_headers(_headers(_SCOPE_A, "credential-a", _SECRET_A))
    own_metadata = scoped_memory_metadata(principal, {"source": "test"})
    victim_metadata = {**own_metadata, "memory_principal_key": "principal:victim"}

    class IgnoringCollection:
        def get(self, **kwargs):
            return {
                "ids": ["victim", "own"],
                "documents": ["isolation marker", "isolation marker"],
                "metadatas": [victim_metadata, own_metadata],
            }

        def query(self, **kwargs):
            return {
                "ids": [["victim", "own"]],
                "documents": [["isolation marker", "isolation marker"]],
                "distances": [[0.0, 0.0]],
                "metadatas": [[victim_metadata, own_metadata]],
            }

    monkeypatch.setattr(librarian, "collection", IgnoringCollection())
    result = librarian.robust_search(
        "isolation marker",
        n_results=5,
        allow_fallback=False,
        memory_principal_key=principal.memory_principal_key,
    )
    assert [row["id"] for row in result["results"]] == ["own"]


def test_codec_rollup_hydration_never_uses_global_rows(monkeypatch):
    seen = []
    monkeypatch.setattr(cortex_codec, "CODEC_DURABLE_ENABLED", True)
    monkeypatch.setattr(
        cortex_codec,
        "_fetch_codec_rows_from_l22",
        lambda session_key, limit=200: seen.append(session_key) or [],
    )
    monkeypatch.setattr(
        cortex_codec,
        "_fetch_global_codec_rows_from_l22",
        lambda **kwargs: pytest.fail("global Codec rows must not feed a principal session"),
    )
    state = {
        "generated_at": "2026-08-21T00:00:00Z",
        "utility_state": {"bucket_scores": {}},
    }
    cortex_codec._enrich_codec_state_with_rollups("principal:session-a", state)
    assert seen == ["principal:session-a"]


def test_local_development_auth_cannot_forge_a_nondefault_session(monkeypatch):
    monkeypatch.delenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", raising=False)
    forged = {
        "x-cortex-tenant-id": "cortex-local",
        "x-cortex-workspace-id": "default",
        "x-cortex-agent-id": "local-agent",
        "x-cortex-user-id": "local-user",
        "x-cortex-channel-id": "local-channel",
        "x-cortex-session-id": "victim-session",
    }
    with pytest.raises(MemoryScopeAuthError):
        authenticate_memory_headers(forged)


def test_unsigned_local_principal_is_denied_by_default_even_on_loopback(monkeypatch):
    monkeypatch.delenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", raising=False)
    monkeypatch.delenv("CORTEX_ALLOW_UNSIGNED_LOCAL_MEMORY_PRINCIPAL", raising=False)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(require_authenticated_memory_principal(_request_from("127.0.0.1")))

    assert denied.value.status_code == 503


def test_unsigned_local_principal_opt_in_is_denied_off_loopback(monkeypatch):
    monkeypatch.delenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", raising=False)
    monkeypatch.setenv("CORTEX_ALLOW_UNSIGNED_LOCAL_MEMORY_PRINCIPAL", "true")

    with pytest.raises(HTTPException) as denied:
        asyncio.run(require_authenticated_memory_principal(_request_from("198.51.100.23")))

    assert denied.value.status_code == 403


def test_internal_memory_headers_never_invent_a_credential_or_scope(monkeypatch):
    monkeypatch.delenv("CORTEX_INTERNAL_MEMORY_CREDENTIAL_ID", raising=False)
    monkeypatch.delenv("CORTEX_INTERNAL_MEMORY_SCOPE", raising=False)
    assert configured_internal_memory_headers() is None

    monkeypatch.setenv("CORTEX_INTERNAL_MEMORY_CREDENTIAL_ID", "credential-a")
    with pytest.raises(MemoryScopeAuthError):
        configured_internal_memory_headers()

    monkeypatch.setenv("CORTEX_INTERNAL_MEMORY_SCOPE", json.dumps(_SCOPE_A))
    principal = authenticate_memory_headers(configured_internal_memory_headers())
    assert principal.scope == _SCOPE_A
