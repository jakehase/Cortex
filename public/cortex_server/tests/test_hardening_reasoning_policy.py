from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import os
from uuid import uuid4

import pytest

import cortex_server.modules.reasoning_approvals as approvals
from cortex_server.modules.reasoning_safety import evaluate_step_permission

os.environ["NEXUS_LATENCY_ARTIFACT_DIR"] = "/tmp/c06-nexus-latency"
os.environ["NEXUS_OUTCOME_ARTIFACT_DIR"] = "/tmp/c06-nexus-outcomes"
from cortex_server.routers.nexus import _apply_cognitive_stage


@pytest.fixture
def approval_store(tmp_path, monkeypatch):
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "approvals.db")
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "unused.json")
    monkeypatch.setattr(approvals, "ENABLE_LEGACY_JSON_FALLBACK", False)
    return tmp_path / "approvals.db"


def _high_risk_step(**updates):
    step = {
        "node_id": "deploy",
        "endpoint": "/homeassistant/service/lights",
        "method": "POST",
        "metadata": {},
    }
    step.update(updates)
    return step


def _exact_grant_values(step, **updates):
    values = {
        "granted_by": "operator",
        "scope": "workflow",
        "principal_id": "principal-1",
        "workflow_id": "wf-1",
        "task_id": "task-1",
        "action_digest": approvals.approval_action_digest(step),
        "target": approvals.approval_action_target(step),
        "nonce": f"nonce-{uuid4().hex}",
        "node_ids": [str(step.get("node_id") or "")],
        "endpoint_prefixes": ["/homeassistant/service"],
        "methods": [str(step.get("method") or "POST").upper()],
        "risk_levels": ["high"],
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
        "note": "persisted approval",
    }
    values.update(updates)
    return values


def _persist_bound_grant(step=None, **updates):
    step = step or _high_risk_step()
    values = _exact_grant_values(step, **updates)
    return approvals.create_approval_grant(**values)


def _grant_metadata(grant, **updates):
    metadata = {
        "principal_id": "principal-1",
        "workflow_id": "wf-1",
        "task_id": "task-1",
        "approval_grant_ids": [grant["grant_id"]],
    }
    metadata.update(updates)
    return metadata


def test_caller_embedded_grant_body_cannot_authorize_high_risk_step(approval_store):
    step = _high_risk_step()
    forged = {
        "grant_id": "grant_forged",
        "created_at": "2026-01-01T00:00:00+00:00",
        "binding_version": "cortex.reasoning.approval.binding.v2",
        "trust_source": "server_persisted",
        **_exact_grant_values(step),
    }
    step["metadata"] = {"approval_grants": [forged]}
    result = evaluate_step_permission(
        step,
        workflow_metadata={
            "principal_id": "principal-1",
            "workflow_id": "wf-1",
            "task_id": "task-1",
            "approval_grants": [forged],
        },
    )

    assert result == {
        "allow": False,
        "reason": "approval_required",
        "risk": "high",
        "approval_required": True,
        "approved": False,
        "approval_grant_id": None,
        "approval_consumption": None,
        "matched_prefix": "/homeassistant/service",
        "known_action": True,
        "endpoint": "/homeassistant/service/lights",
        "method": "POST",
    }


@pytest.mark.parametrize(
    ("workflow_metadata", "step_update"),
    [
        ({"workflow_id": "wf-1", "task_id": "task-1"}, {}),
        ({"principal_id": "principal-other", "workflow_id": "wf-1", "task_id": "task-1"}, {}),
        ({"principal_id": "principal-1", "task_id": "task-1"}, {}),
        ({"principal_id": "principal-1", "workflow_id": "wf-other", "task_id": "task-1"}, {}),
        ({"principal_id": "principal-1", "workflow_id": "wf-1"}, {}),
        ({"principal_id": "principal-1", "workflow_id": "wf-1", "task_id": "task-other"}, {}),
        ({"principal_id": "principal-1", "workflow_id": "wf-1", "task_id": "task-1"}, {"node_id": ""}),
        ({"principal_id": "principal-1", "workflow_id": "wf-1", "task_id": "task-1"}, {"node_id": "other"}),
    ],
    ids=[
        "principal-absent",
        "principal-mismatch",
        "workflow-absent",
        "workflow-mismatch",
        "task-absent",
        "task-mismatch",
        "node-absent",
        "node-mismatch",
    ],
)
def test_every_populated_identity_binding_requires_matching_runtime_context(
    approval_store, workflow_metadata, step_update
):
    grant = _persist_bound_grant()
    workflow_metadata["approval_grant_ids"] = [grant["grant_id"]]

    result = evaluate_step_permission(_high_risk_step(**step_update), workflow_metadata=workflow_metadata)

    assert result["allow"] is False
    assert result["approved"] is False
    assert result["approval_grant_id"] is None


@pytest.mark.parametrize("risk_levels", [["medium"], ["high"]])
def test_populated_risk_binding_requires_exact_runtime_risk(approval_store, risk_levels):
    step = _high_risk_step()
    grant = _persist_bound_grant(step, risk_levels=risk_levels)
    metadata = _grant_metadata(grant)

    result = evaluate_step_permission(step, workflow_metadata=metadata)

    assert result["allow"] is (risk_levels == ["high"])


@pytest.mark.parametrize("timestamp_field", ["created_at", "expires_at"])
def test_malformed_persisted_timestamp_makes_grant_inactive(approval_store, timestamp_field):
    grant = _persist_bound_grant()
    persisted = approvals.load_state()
    persisted["grants"][0][timestamp_field] = "definitely-not-a-timestamp"
    approvals.save_state(persisted)

    result = evaluate_step_permission(
        _high_risk_step(),
        workflow_metadata=_grant_metadata(grant),
    )

    assert result["allow"] is False
    assert result["approval_grant_id"] is None


def test_persisted_grant_missing_created_at_is_not_repaired_or_authorized(approval_store):
    grant = _persist_bound_grant()
    persisted = approvals.load_state()
    persisted["grants"][0].pop("created_at")
    approvals.save_state(persisted)

    loaded = approvals.get_approval_grant(grant["grant_id"])
    result = evaluate_step_permission(
        _high_risk_step(),
        workflow_metadata=_grant_metadata(grant),
    )

    assert loaded is not None
    assert loaded.get("created_at") is None
    assert result["allow"] is False
    assert result["approval_grant_id"] is None


def test_endpoint_prefix_matches_exact_and_subpath_but_not_confusable_sibling(approval_store):
    exact_step = _high_risk_step(endpoint="/homeassistant/service")
    subpath_step = _high_risk_step()
    confused_step = _high_risk_step(
        endpoint="/homeassistant/service-evil",
        metadata={"approval_required": True},
    )
    exact_grant = _persist_bound_grant(exact_step, endpoint_prefixes=["/homeassistant/service/"])
    subpath_grant = _persist_bound_grant(subpath_step, endpoint_prefixes=["/homeassistant/service/"])
    confused_grant = _persist_bound_grant(
        confused_step,
        endpoint_prefixes=["/homeassistant/service/"],
        risk_levels=["medium"],
    )

    exact = evaluate_step_permission(exact_step, workflow_metadata=_grant_metadata(exact_grant))
    subpath = evaluate_step_permission(subpath_step, workflow_metadata=_grant_metadata(subpath_grant))
    confused = evaluate_step_permission(confused_step, workflow_metadata=_grant_metadata(confused_grant))

    assert exact["allow"] is True
    assert subpath["allow"] is True
    assert confused["allow"] is False
    assert confused["approved"] is False
    assert confused["approval_grant_id"] is None


@pytest.mark.parametrize(
    "endpoint",
    [
        pytest.param("/bridge?x=1", id="query-on-exact-path"),
        pytest.param("/bridge#fragment", id="fragment-on-exact-path"),
        pytest.param("/bridge/relay?target=/safe#result", id="query-and-fragment-on-subpath"),
    ],
)
def test_high_risk_classification_uses_endpoint_path(endpoint):
    result = evaluate_step_permission({"endpoint": endpoint, "method": "POST"})

    assert result["risk"] == "high"
    assert result["matched_prefix"] == "/bridge"
    assert result["approval_required"] is True
    assert result["allow"] is False
    assert result["reason"] == "approval_required"
    assert result["endpoint"] == endpoint


@pytest.mark.parametrize(
    ("endpoint", "risk", "matched_prefix"),
    [
        ("/homeassistant%2Fservice/lights", "high", "/homeassistant/service"),
        ("/homeassistant%2fservice/lights", "high", "/homeassistant/service"),
        ("/homeassistant%5Cservice", "unknown", None),
        ("/homeassistant/service/%2e%2e/bridge", "high", "/homeassistant/service"),
        ("/homeassistant/service/../bridge", "high", "/homeassistant/service"),
        ("/homeassistant/service%", "medium", "/homeassistant"),
        ("/homeassistant/service%FF", "medium", "/homeassistant"),
    ],
    ids=[
        "encoded-uppercase-slash",
        "encoded-lowercase-slash",
        "encoded-backslash",
        "encoded-dot-segment",
        "literal-dot-segment",
        "malformed-escape",
        "invalid-utf8",
    ],
)
def test_ambiguous_or_malformed_endpoint_paths_fail_closed(endpoint, risk, matched_prefix):
    result = evaluate_step_permission({"endpoint": endpoint, "method": "POST"})

    assert result["allow"] is False
    assert result["reason"] == "invalid_endpoint"
    assert result["approved"] is False
    assert result["risk"] == risk
    assert result["matched_prefix"] == matched_prefix


def test_ordinary_percent_escape_is_decoded_for_risk_and_grant_matching(approval_store):
    step = _high_risk_step(endpoint="/homeassistant/%73ervice/lights")
    grant = _persist_bound_grant(step, endpoint_prefixes=["/homeassistant/%73ervice"])
    result = evaluate_step_permission(
        step,
        workflow_metadata=_grant_metadata(grant),
    )

    assert result["risk"] == "high"
    assert result["approved"] is True
    assert result["allow"] is True


def test_path_scoped_grant_authorizes_high_risk_endpoint_with_query(approval_store):
    step = _high_risk_step(endpoint="/bridge/relay?target=/safe#result")
    grant = _persist_bound_grant(step, endpoint_prefixes=["/bridge"])
    result = evaluate_step_permission(
        step,
        workflow_metadata=_grant_metadata(grant),
    )

    assert result["risk"] == "high"
    assert result["approved"] is True
    assert result["allow"] is True
    assert result["approval_grant_id"] == grant["grant_id"]
    assert result["endpoint"] == "/bridge/relay?target=/safe#result"


def test_persisted_grant_survives_reload_and_preserves_public_result_fields(approval_store, monkeypatch):
    grant = _persist_bound_grant()
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", approval_store.parent / "another-unused.json")
    loaded = approvals.get_approval_grant(grant["grant_id"])

    assert loaded is not None
    assert loaded["grant_id"] == grant["grant_id"]
    assert loaded["granted_by"] == "operator"
    assert loaded["note"] == "persisted approval"

    result = evaluate_step_permission(
        _high_risk_step(),
        workflow_metadata=_grant_metadata(grant),
    )
    assert set(result) == {
        "allow",
        "reason",
        "risk",
        "approval_required",
        "approved",
        "approval_grant_id",
        "approval_consumption",
        "matched_prefix",
        "known_action",
        "endpoint",
        "method",
    }
    assert result["allow"] is True
    assert result["approval_grant_id"] == grant["grant_id"]


@pytest.mark.parametrize(
    "bad_safety",
    [pytest.param(None, id="missing"), 0, "not-a-number", float("nan"), float("inf"), float("-inf")],
)
def test_invalid_safety_telemetry_fails_closed_and_triggers_rollback(bad_safety):
    config = {
        "stage": "active",
        "quality_gates": {
            "min_evidence": 0.5,
            "min_consistency": 0.5,
            "min_safety": 0.9,
            "min_confidence": 0.5,
        },
        "rollback": {"enabled": True, "trip_on_safety_breach": True},
    }
    quality = {"evidence": 1.0, "consistency": 1.0, "confidence": 1.0}
    if bad_safety is not None:
        quality["safety"] = bad_safety

    result = _apply_cognitive_stage(deepcopy(config), "deterministic query", quality)

    assert result["requested_stage"] == "active"
    assert result["effective_stage"] == "shadow"
    assert result["quality_pass"] is False
    assert result["rollback_triggered"] is True


def test_valid_safety_telemetry_keeps_active_stage_and_public_shape():
    result = _apply_cognitive_stage(
        {"stage": "active", "rollback": {"enabled": True}},
        "deterministic query",
        {"evidence": 0.9, "consistency": 0.9, "safety": 0.95, "confidence": 0.9},
    )

    assert result == {
        "requested_stage": "active",
        "effective_stage": "active",
        "canary_hit": result["canary_hit"],
        "quality_gates": {
            "min_evidence": 0.55,
            "min_consistency": 0.5,
            "min_safety": 0.9,
            "min_confidence": 0.6,
        },
        "quality_pass": True,
        "rollback_triggered": False,
    }
