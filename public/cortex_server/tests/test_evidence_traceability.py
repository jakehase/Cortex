import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.modules.cortex_codec as codec_module
import cortex_server.routers.nexus as nexus
import cortex_server.routers.orchestrator as orchestrator
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.modules.cortex_codec import update_codec_state_for_session
from cortex_server.modules.evidence_governance import normalize_runtime_event, validate_state_class_collection


def test_normalize_runtime_event_accepts_legacy_aliases_and_redacts_sensitive_fields():
    event = normalize_runtime_event(
        {
            "event_id": "ev_legacy_1",
            "kind": "command_stdout",
            "processId": "proc_legacy",
            "objectiveKey": "obj_legacy",
            "agentId": "cortex",
            "subsystem": "lab",
            "traceId": "trace_123",
            "parentEventId": "ev_parent",
            "sessionId": "session_123",
            "repoPath": "/tmp/repo",
            "payload": {
                "scope": "task:legacy",
                "command": "pytest -q",
                "token": "sk-secret-token-1234567890",
            },
        }
    )

    assert event["process_id"] == "proc_legacy"
    assert event["objective_key"] == "obj_legacy"
    assert event["agent_id"] == "cortex"
    assert event["source_subsystem"] == "lab"
    assert event["correlation_id"] == "trace_123"
    assert event["causal_parent_ids"] == ["ev_parent"]
    assert event["session_key"] == "session_123"
    assert event["repo_path"] == "/tmp/repo"
    assert event["payload"]["token"] == "[REDACTED]"
    assert event["lineage"]["redaction"]["redacted_field_count"] >= 1


def test_runtime_event_retains_closed_classification_and_progress_metadata():
    tool_event = normalize_runtime_event(
        process_id="proc_tool",
        kind="tool_call_started",
        payload={
            "agent_id": "cortex",
            "scope": "task:visible_work",
            "source": "runtime",
            "tool": "pytest",
            "command_kind": "test",
            "command_text": "pytest -q tests/test_runtime.py",
            "unclassified_detail": "must not cross the evidence boundary",
            "token": "sk-secret-token-1234567890",
        },
    )

    assert tool_event["agent_id"] == "cortex"
    assert tool_event["scope"] == "task:visible_work"
    assert tool_event["payload"]["source"] == "runtime"
    assert tool_event["payload"]["tool"] == "pytest"
    assert tool_event["payload"]["command_kind"] == "test"
    assert tool_event["payload"]["command_text"] == "[REDACTED]"
    assert tool_event["payload"]["unclassified_detail"] == "[REDACTED]"
    assert tool_event["payload"]["token"] == "[REDACTED]"

    progress_event = normalize_runtime_event(
        process_id="proc_rollback",
        kind="runtime_delivery_rollback_applied.progress",
        payload={
            "rollback_transaction_id": "rollback_tx_123",
            "snapshot_id": "snapshot_123",
            "shared_state_revision_id": "revision_123",
            "lifecycle_state": "running",
            "active_nodes": ["build"],
            "waiting_nodes": ["verify"],
            "completed_nodes": [],
            "failed_nodes": [],
        },
    )

    assert progress_event["payload"] == {
        "rollback_transaction_id": "rollback_tx_123",
        "snapshot_id": "snapshot_123",
        "shared_state_revision_id": "revision_123",
        "lifecycle_state": "running",
        "active_nodes": ["build"],
        "waiting_nodes": ["verify"],
        "completed_nodes": [],
        "failed_nodes": [],
    }


def test_policy_patch_event_retains_closed_rollback_schema_without_session_secrets():
    event = normalize_runtime_event(
        process_id="proc_policy",
        kind="policy_patch_applied",
        payload={
            "revision_id": "polrev_123",
            "settings": ["step_timeout_seconds"],
            "applied_settings": [
                {
                    "setting": "step_timeout_seconds",
                    "before": 15,
                    "after": 30,
                    "op": "replace",
                }
            ],
            "metadata_overrides": {"step_timeout_seconds": 30},
            "previous_values": {"step_timeout_seconds": 15},
            "operator_overrides": {"step_timeout_seconds": 30},
            "audit": {
                "control": "freeze_policy",
                "actor": {
                    "actor_id": "cortex",
                    "actor_session_key": "session-secret-value",
                },
                "authorization": {
                    "authorized": True,
                    "basis": "owner_match",
                    "process_session_key": "process-session-secret",
                },
            },
        },
    )

    assert event["payload"]["metadata_overrides"] == {
        "step_timeout_seconds": 30
    }
    assert event["payload"]["previous_values"] == {
        "step_timeout_seconds": 15
    }
    assert event["payload"]["audit"]["authorization"]["authorized"] is True
    assert event["payload"]["audit"]["actor"]["actor_session_key"] == "[REDACTED]"
    assert (
        event["payload"]["audit"]["authorization"]["process_session_key"]
        == "[REDACTED]"
    )


def test_validate_state_class_collection_rejects_cross_class_promotion():
    with pytest.raises(ValueError, match="state_class_mismatch"):
        validate_state_class_collection(
            [{"state_class": "raw_evidence", "event_id": "ev_1", "lineage": {}}],
            expected_state_class="inferred_state",
        )

    with pytest.raises(ValueError, match="missing_lineage"):
        validate_state_class_collection(
            [{"state_class": "raw_evidence", "event_id": "ev_2"}],
            expected_state_class="raw_evidence",
            require_lineage=True,
        )


def test_runtime_process_traceability_alias_returns_canonical_bundle(monkeypatch):
    monkeypatch.setattr(
        orchestrator,
        "get_runtime_process",
        lambda process_id: {
            "process_id": process_id,
            "status": "running",
            "session_key": "session:traceability",
            "task_id": "task_traceability",
            "workflow": {"name": "Traceability Workflow"},
        },
    )
    monkeypatch.setattr(
        orchestrator,
        "get_runtime_events",
        lambda process_id, limit=120: [
            {
                "event_id": "ev_trace_1",
                "kind": "command_stdout",
                "processId": process_id,
                "payload": {
                    "agentId": "cortex",
                    "objectiveKey": "obj_traceability",
                    "scope": "task:traceability",
                    "chunk": "tests passed",
                },
            }
        ],
    )
    monkeypatch.setattr(orchestrator, "get_codec_packet_for_session", lambda session_key, max_chars=800: {"state": {}})

    result = asyncio.run(orchestrator.get_runtime_process_traceability("proc_traceability", limit=10))

    assert result["success"] is True
    assert result["process"]["process_id"] == "proc_traceability"
    assert result["summary"]["observed_count"] == 1
    assert result["classes"]["observed_evidence"][0]["state_class"] == "raw_evidence"
    assert result["traceability_contract"]["raw_event_class"] == "observed_evidence"


def test_nexus_codec_memory_lineage_route_returns_single_memory_fact(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)

    session_key = "session:nexus-memory-lineage"
    auth = configured_memory_principal(session_key)
    codec_session_key = auth.principal.codec_session_key
    update_codec_state_for_session(
        codec_session_key,
        [
            {
                "text": "Call me Jake and start replies with [Cortex].",
                "metadata": {"project": "Codec Memory Lineage"},
            }
        ],
        tenant_id=auth.principal.tenant_id,
        workspace_id=auth.principal.storage_workspace_id,
    )
    packet = codec_module.get_codec_packet_for_session(
        codec_session_key,
        max_chars=400,
        tenant_id=auth.principal.tenant_id,
        workspace_id=auth.principal.storage_workspace_id,
    )
    memory_facts = ((packet.get("state") or {}).get("memory_facts") or []) if isinstance(packet, dict) else []
    assert memory_facts, "expected codec memory facts to exist"
    memory_id = memory_facts[0]["memory_id"]

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    client = TestClient(app, headers=auth.headers)

    response = client.get(f"/nexus/codec/memory/{memory_id}/lineage", headers={"x-session-id": session_key})

    assert response.status_code == 200
    body = response.json()
    assert body["memory_id"] == memory_id
    assert body["memory"]["state_class"] == "learned_preference"
    assert body["codec"]["summary"]
    assert body["capability_matrix"]["state_classes"] == [
        "raw_evidence",
        "inferred_state",
        "learned_preference",
        "operator_override",
    ]
