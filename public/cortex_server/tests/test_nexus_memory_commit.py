import json
import sys
import types

from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.modules.memory_scope import memory_scope_signature


_SCOPE = {
    "tenant_id": "cortex-local",
    "workspace_id": "default",
    "agent_id": "main",
    "user_id": "openclaw-owner",
    "channel_id": "whatsapp",
    "session_id": "openclaw-test-session",
}
_CREDENTIAL_ID = "openclaw-test-v1"
_SCOPE_SECRET = "scope-secret-that-is-distinct-from-every-server-only-key-20260801"
_SIGNING_KEY = "server-only-assurance-signing-key-that-is-long-and-distinct-20260801"


class _Recorder:
    def __init__(self):
        self.calls = []
        self.records = {}

    def store(self, **kwargs):
        self.calls.append(kwargs)
        key = kwargs["idempotency_key"]
        record = self.records.setdefault(
            key,
            {
                "id": f"mem-{key[:12]}",
                "status": "stored",
                "metadata": kwargs.get("metadata", {}),
                "idempotent_replay": False,
            },
        )
        return dict(record)

    def lookup(self, **kwargs):
        record = self.records.get(kwargs["idempotency_key"])
        return {**record, "idempotent_replay": True} if record else None


def _headers():
    signature = memory_scope_signature(
        **_SCOPE,
        credential_id=_CREDENTIAL_ID,
        secret=_SCOPE_SECRET,
    )
    return {
        "x-cortex-tenant-id": _SCOPE["tenant_id"],
        "x-cortex-workspace-id": _SCOPE["workspace_id"],
        "x-cortex-agent-id": _SCOPE["agent_id"],
        "x-cortex-user-id": _SCOPE["user_id"],
        "x-cortex-channel-id": _SCOPE["channel_id"],
        "x-cortex-session-id": _SCOPE["session_id"],
        "x-cortex-scope-credential-id": _CREDENTIAL_ID,
        "x-cortex-scope-signature": signature,
    }


def _client(monkeypatch, tmp_path, recorder):
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps(
            {
                _CREDENTIAL_ID: {
                    "secret": _SCOPE_SECRET,
                    "allowed_scopes": [{**_SCOPE}],
                }
            }
        ),
    )
    monkeypatch.setenv("NEXUS_ASSURANCE_SIGNING_KEY", _SIGNING_KEY)
    monkeypatch.setenv("NEXUS_ASSURANCE_SIGNING_KEY_ID", "test-key-v1")
    monkeypatch.setenv("NEXUS_COMMIT_WORLD_GROUNDING_ENABLED", "false")
    monkeypatch.setattr(
        nexus,
        "_ASSURANCE_RECEIPT_STATE_PATH",
        tmp_path / "assurance-receipts.sqlite3",
    )

    fake_l22 = types.ModuleType("cortex_server.routers.l22")
    fake_l22.store_memory_record = recorder.store
    fake_l22.lookup_idempotent_memory_record = recorder.lookup
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", fake_l22)
    monkeypatch.setattr(
        nexus.ROUTE_HEALTH,
        "snapshot",
        lambda dependency=None: {
            "state": "closed",
            "healthy": True,
            "successes": 1,
            "failures": 0,
        },
    )
    monkeypatch.setattr(
        nexus.ROUTE_HEALTH,
        "record_success",
        lambda *a, **k: {"state": "closed", "healthy": True},
    )
    monkeypatch.setattr(
        nexus.ROUTE_HEALTH,
        "record_failure",
        lambda *a, **k: {"state": "open", "healthy": False},
    )
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    return TestClient(app)


def _interaction():
    return {
        "query": "Remember this deployment decision",
        "response": (
            "Decision: Use the safe rollback path, preserve the backup branch, "
            "and verify the bounded canary before activation."
        ),
        "levels_used": [7, 22],
        "metadata": {"memory_kind": "decision", "source": "caller-cannot-override"},
    }


def _issue(client, interaction):
    response = client.post(
        "/nexus/assurance/receipt",
        headers=_headers(),
        json={key: interaction[key] for key in ("query", "response", "levels_used")},
    )
    assert response.status_code == 200, response.text
    return response.json()["receipt"]


def test_commit_requires_server_assurance_receipt(monkeypatch, tmp_path):
    recorder = _Recorder()
    client = _client(monkeypatch, tmp_path, recorder)
    response = client.post(
        "/nexus/commit",
        headers=_headers(),
        json=_interaction(),
    )
    assert response.status_code == 403
    assert response.json()["detail"]["error"] == "valid_server_assurance_receipt_required"
    assert recorder.calls == []


def test_receipt_commit_is_durable_and_replay_safe(monkeypatch, tmp_path):
    recorder = _Recorder()
    client = _client(monkeypatch, tmp_path, recorder)
    interaction = _interaction()
    interaction["assurance_receipt"] = _issue(client, interaction)

    first = client.post(
        "/nexus/commit",
        headers=_headers(),
        json=interaction,
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["success"] is True
    assert first_body["committed"] is True
    assert first_body["durable_write"]["status"] == "stored"
    assert first_body["assurance"]["memory_commit"]["eligible"] is True
    assert len(recorder.calls) == 1
    assert recorder.calls[0]["idempotency_key"] == first_body["assurance"]["receipt"]["id"]
    assert recorder.calls[0]["metadata"]["source"] == "nexus.commit"

    replay = client.post(
        "/nexus/commit",
        headers=_headers(),
        json=interaction,
    )
    assert replay.status_code == 200
    assert replay.json() == first_body
    assert len(recorder.calls) == 1


def test_receipt_is_bound_to_content_and_scope(monkeypatch, tmp_path):
    recorder = _Recorder()
    client = _client(monkeypatch, tmp_path, recorder)
    interaction = _interaction()
    interaction["assurance_receipt"] = _issue(client, interaction)
    interaction["response"] += " tampered"

    response = client.post(
        "/nexus/commit",
        headers=_headers(),
        json=interaction,
    )
    assert response.status_code == 403
    assert response.json()["detail"]["reason"] == "response_binding_mismatch"
    assert recorder.calls == []


def test_receipt_issuance_rejects_unqualified_content(monkeypatch, tmp_path):
    recorder = _Recorder()
    client = _client(monkeypatch, tmp_path, recorder)
    response = client.post(
        "/nexus/assurance/receipt",
        headers=_headers(),
        json={
            "query": "Remember this",
            "response": "Guaranteed zero-risk legal strategy.",
            "levels_used": [7, 22],
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "interaction_not_eligible_for_commit"
    assert recorder.calls == []


def test_orchestrate_accepts_route_gate_json_body(monkeypatch, tmp_path):
    recorder = _Recorder()
    client = _client(monkeypatch, tmp_path, recorder)
    response = client.post(
        "/nexus/orchestrate?codec_probe=true",
        headers=_headers(),
        json={
            "query": "Route this persistence status check",
            "private_retrieval_shadow_query": "persistence status",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["success"] is True
    assert response.json()["routing_method"] == "codec_recovery_probe"


def test_orchestrate_rejects_disagreeing_query_bindings(monkeypatch, tmp_path):
    recorder = _Recorder()
    client = _client(monkeypatch, tmp_path, recorder)
    response = client.post(
        "/nexus/orchestrate?query=one",
        headers=_headers(),
        json={"query": "two"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "query parameter and JSON body disagree"
