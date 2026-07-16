from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import json
import httpx
import pytest
from fastapi import FastAPI

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator
from cortex_server.middleware.write_authorization import WriteAuthorizationMiddleware
from cortex_server.runtime import AgentMessage, agent_acknowledgement_signature
from cortex_server.runtime.production_build_loop import (
    RUNTIME_DELIVERY_MOUNT_MARKER,
    runtime_delivery_handoff_claim_signature,
    runtime_delivery_handoff_discovery_signature,
)
from cortex_server.runtime.release_workflow import (
    ReleaseArtifactReceipt,
    release_artifact_attestation_signature,
    release_canary_policy,
)


class _ASGIClient:
    """Synchronous facade over HTTPX's supported ASGI transport."""

    def __init__(self, app):
        self.app = app
        self.headers = {}

    def request(self, method, path, **kwargs):
        headers = {**self.headers, **dict(kwargs.pop("headers", {}) or {})}

        async def send():
            transport = httpx.ASGITransport(app=self.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                return await client.request(method, path, headers=headers, **kwargs)

        return asyncio.run(send())

    def get(self, path, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path, **kwargs):
        return self.request("POST", path, **kwargs)


def TestClient(app):
    return _ASGIClient(app)


def _install_fake_diplomat(monkeypatch):
    sent = []

    class _FakeDiplomat:
        def send_briefing(self, message: str, title: str = "[Cortex] Runtime update") -> bool:
            sent.append({"title": title, "message": message})
            return True

    monkeypatch.setattr(orchestrator, "get_diplomat", lambda: _FakeDiplomat())
    return sent


MINIMAL_PROFILE = {
    "profile": "runtime-delivery-test",
    "intended_duration_hours": 1,
    "campaign_cycles": 1,
    "min_agent_count": 1,
    "min_handoff_count": 0,
    "max_checkpoint_age_seconds": 3600,
    "max_snapshot_event_gap": 3,
    "max_dead_letters": 0,
    "max_stale_leases": 0,
    "max_inflight_age_seconds": 120,
    "max_lease_heartbeat_lag_seconds": 3600,
    "required_revision_history": 1,
    "watchdog": {"lease_seconds": 60, "heartbeat_grace_seconds": 60},
    "checkpoint": {"snapshot_every_events": 4, "must_checkpoint_on_handoff": True},
}
VERIFIER_SECRET = "runtime-verifier-secret-0000000000000001"
VERIFIER_RECIPIENT_SECRET = "verifier-recipient-secret-000000000001"
MANAGER_RECIPIENT_SECRET = "manager-recipient-secret-0000000000001"


def _public_runtime_delivery_client() -> TestClient:
    app = FastAPI()
    app.include_router(orchestrator.router, prefix="/orchestrator")
    app.add_middleware(
        WriteAuthorizationMiddleware,
        mode="token_required",
        token="runtime-delivery-write-token",
        header_name="x-cortex-write-token",
        exempt_prefixes=("/orchestrator/runtime/delivery/handoffs",),
    )
    client = TestClient(app)
    client.headers["x-cortex-write-token"] = "runtime-delivery-write-token"
    return client


def _workflow() -> dict:
    return {
        "name": "runtime_delivery_route",
        "metadata": {"owner": "cortex", "session_key": "session:delivery"},
        "steps": [
            {
                "node_id": "build",
                "title": "Build",
                "endpoint": "/oracle/chat",
                "payload": {"message": "ship it"},
            }
        ],
    }


def _signed_artifact_request(
    state,
    *,
    artifact_id: str,
    payload: dict,
    artifact_kind: str,
    target_stage: str | None = None,
    claims: dict | None = None,
) -> orchestrator.RuntimeDeliveryArtifactIngestRequest:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    content_hash = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
    created_at = "2026-07-15T12:00:00.000Z"
    unsigned = {
        "artifact_id": artifact_id,
        "artifact_ref": content_hash,
        "content_hash": content_hash,
        "artifact_kind": artifact_kind,
        "target_stage": target_stage,
        "candidate_ref": state.candidate_ref,
        "release_id": state.release_id,
        "revision_id": state.revision_id,
        "producer": "runtime-build-worker" if artifact_kind != "canary_evidence" else "canary-runner",
        "verifier": "runtime-independent-verifier",
        "validation_outcome": "passed",
        "claims": dict(claims or {}),
        "created_at": created_at,
    }
    return orchestrator.RuntimeDeliveryArtifactIngestRequest(
        artifact_id=artifact_id,
        payload=payload,
        artifact_kind=artifact_kind,
        producer=unsigned["producer"],
        verifier=unsigned["verifier"],
        attestation_signature=release_artifact_attestation_signature(
            unsigned,
            secret=VERIFIER_SECRET,
        ),
        target_stage=target_stage,
        claims=dict(claims or {}),
        created_at=created_at,
    )


def test_runtime_delivery_ordinary_initialization_rejects_non_draft_stage():
    with pytest.raises(ValueError, match="ordinary runtime release initialization is restricted to draft"):
        orchestrator.RuntimeDeliveryReconcileRequest(initial_release_stage="production")


def test_runtime_delivery_readiness_requires_credentials_and_durable_mount(tmp_path, monkeypatch):
    delivery_root = tmp_path / "runtime-delivery"
    delivery_root.mkdir()
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setenv("CORTEX_RUNTIME_DELIVERY_MOUNT_ID", "runtime-delivery-test-v1")
    (delivery_root / RUNTIME_DELIVERY_MOUNT_MARKER).write_text(
        "runtime-delivery-test-v1\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("CORTEX_RELEASE_VERIFIER_CREDENTIALS", raising=False)
    monkeypatch.setenv(
        "CORTEX_AGENT_ACK_CREDENTIALS",
        json.dumps({"release-verifier": VERIFIER_RECIPIENT_SECRET}),
    )
    client = _public_runtime_delivery_client()

    not_ready = client.get("/orchestrator/runtime-delivery/readiness")

    assert not_ready.status_code == 503
    assert not_ready.json()["checks"]["releaseVerifierCredentials"]["ok"] is False
    assert not_ready.json()["checks"]["releaseRecipientCredentials"]["missingRecipients"] == [
        "release-manager"
    ]
    assert not_ready.json()["checks"]["durableRuntimeDeliveryRoot"]["ok"] is True

    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({"independent-release-verifier": VERIFIER_SECRET}),
    )
    monkeypatch.setenv(
        "CORTEX_AGENT_ACK_CREDENTIALS",
        json.dumps(
            {
                "release-verifier": VERIFIER_RECIPIENT_SECRET,
                "release-manager": MANAGER_RECIPIENT_SECRET,
            }
        ),
    )

    ready = client.get("/orchestrator/runtime-delivery/readiness")

    assert ready.status_code == 200
    assert ready.json()["ready"] is True
    assert ready.json()["checks"]["releaseVerifierCredentials"]["configuredVerifierCount"] == 1
    assert ready.json()["checks"]["releaseRecipientCredentials"]["missingRecipients"] == []
    assert not list(delivery_root.glob(".cortex-readiness-*"))


def test_public_runtime_delivery_handoffs_reach_production_and_survive_store_reopen(
    tmp_path,
    monkeypatch,
):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"
    verifier_recipient_secret = VERIFIER_RECIPIENT_SECRET
    manager_recipient_secret = MANAGER_RECIPIENT_SECRET

    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({"runtime-independent-verifier": VERIFIER_SECRET}),
    )
    monkeypatch.setenv(
        "CORTEX_AGENT_ACK_CREDENTIALS",
        json.dumps(
            {
                "release-verifier": verifier_recipient_secret,
                "release-manager": manager_recipient_secret,
            }
        ),
    )
    orchestrator.workflows.clear()
    client = _public_runtime_delivery_client()

    process = scheduler.create_process_from_workflow(
        _workflow(),
        process_id="proc_public_runtime_delivery",
        owner="cortex",
        session_key="session:delivery:public",
    )
    scheduler_state = scheduler.load_state()
    scheduler_state["processes"][process["process_id"]]["enabled"] = False
    scheduler_state["processes"][process["process_id"]]["status"] = "waiting"
    scheduler_state["processes"][process["process_id"]]["nodes"]["build"]["status"] = "waiting"
    scheduler.save_state(scheduler_state)

    unauthorized = client.post(
        f"/orchestrator/runtime/delivery/reconcile/{process['process_id']}",
        json={},
        headers={"x-cortex-write-token": ""},
    )
    assert unauthorized.status_code == 403

    initial = client.post(
        f"/orchestrator/runtime/delivery/reconcile/{process['process_id']}",
        json={
            "controller_id": "controller",
            "controller_session_id": "sess-runtime-delivery-public",
            "initial_release_stage": "draft",
            "promotion_stages": ["build_verified", "canary_verified", "production"],
            "completion_criteria": [
                {
                    "criterion_id": "caller-release-stage",
                    "summary": "Release must reach production",
                    "kind": "release_stage",
                    "stage": "production",
                }
            ],
            "dependability_profile": dict(MINIMAL_PROFILE),
        },
    )
    assert initial.status_code == 200, initial.text
    initial_body = initial.json()
    assert initial_body["delivery"]["release_state"]["current_stage"] == "draft"
    mandatory_ids = {
        row["criterion_id"]
        for row in initial_body["contract"]["completion_criteria"]
        if row.get("metadata", {}).get("server_mandated")
    }
    assert mandatory_ids == {
        "release-target-stage",
        "release-canary-stage",
        "release-bundle",
        "smoke-report",
    }

    release_state = orchestrator.ReleaseWorkflowState.model_validate(
        initial_body["delivery"]["release_state"]
    )
    artifact_hashes = []
    for artifact_id, artifact_kind in (
        (f"artifact_release_bundle:{process['process_id']}", "release_bundle"),
        (f"artifact_smoke_report:{process['process_id']}", "smoke_report"),
    ):
        artifact_request = _signed_artifact_request(
            release_state,
            artifact_id=artifact_id,
            payload={"artifact_id": artifact_id, "result": "passed"},
            artifact_kind=artifact_kind,
        )
        ingested = client.post(
            f"/orchestrator/runtime/delivery/artifacts/{process['process_id']}",
            json=artifact_request.model_dump(),
        )
        assert ingested.status_code == 200, ingested.text
        artifact_hashes.append(ingested.json()["receipt"]["content_hash"])

    evidence_ids = {
        "canary_verified": "evidence:public-runtime-canary",
        "production": "evidence:public-runtime-production",
    }
    for target_stage, evidence_id in evidence_ids.items():
        policy = release_canary_policy(target_stage)
        claims = {
            "policy_id": policy["policy_id"],
            "deployment_id": f"deployment:public-runtime:{target_stage}",
            "cohort_id": "canary-10-percent",
            "traffic_volume": 2500,
            "observation_window_seconds": 1200,
            "artifact_hashes": artifact_hashes,
            "metrics": {"availability": 0.9995, "error_rate": 0.0005},
            "thresholds": policy["thresholds"],
        }
        evidence_request = _signed_artifact_request(
            release_state,
            artifact_id=evidence_id,
            payload=claims,
            artifact_kind="canary_evidence",
            target_stage=target_stage,
            claims=claims,
        )
        ingested = client.post(
            f"/orchestrator/runtime/delivery/artifacts/{process['process_id']}",
            json=evidence_request.model_dump(),
        )
        assert ingested.status_code == 200, ingested.text

    build = client.post(
        f"/orchestrator/runtime/delivery/reconcile/{process['process_id']}",
        json={
            "controller_id": "controller",
            "controller_session_id": "sess-runtime-delivery-public",
        },
    )
    assert build.status_code == 200, build.text
    assert build.json()["delivery"]["release_state"]["current_stage"] == "build_verified"

    def claim_and_ack(
        *,
        recipient: str,
        secret: str,
        state_body: dict,
        evidence_id: str,
        request_id: str,
        check_replay: bool = False,
        discovery: bool = False,
    ) -> dict:
        expected_revision_id = state_body["delivery"]["release_state"]["revision_id"]
        requested_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
            "+00:00",
            "Z",
        )
        if discovery:
            claim_path = "/orchestrator/runtime/delivery/handoffs/claim-next"
            claim = {
                "recipient": recipient,
                "request_id": request_id,
                "requested_at": requested_at,
                "recipient_signature": runtime_delivery_handoff_discovery_signature(
                    recipient=recipient,
                    request_id=request_id,
                    requested_at=requested_at,
                    secret=secret,
                ),
            }
        else:
            claim_path = "/orchestrator/runtime/delivery/handoffs/claim"
            claim = {
                "recipient": recipient,
                "process_id": process["process_id"],
                "expected_revision_id": expected_revision_id,
                "request_id": request_id,
                "requested_at": requested_at,
                "recipient_signature": runtime_delivery_handoff_claim_signature(
                    recipient=recipient,
                    process_id=process["process_id"],
                    expected_revision_id=expected_revision_id,
                    request_id=request_id,
                    requested_at=requested_at,
                    secret=secret,
                ),
            }
        if check_replay:
            forged = client.post(
                claim_path,
                json={**claim, "recipient_signature": "forged"},
                headers={"x-cortex-write-token": ""},
            )
            assert forged.status_code == 403
        claimed = client.post(
            claim_path,
            json=claim,
            headers={"x-cortex-write-token": ""},
        )
        assert claimed.status_code == 200, claimed.text
        messages = [AgentMessage.model_validate(row) for row in claimed.json()["messages"]]
        assert len(messages) == 1
        assert messages[0].to_agent == recipient
        if check_replay:
            replayed = client.post(
                claim_path,
                json=claim,
                headers={"x-cortex-write-token": ""},
            )
            assert replayed.status_code == 409

        receipt = {
            "candidate_ref": release_state.candidate_ref,
            "release_id": release_state.release_id,
            "revision_id": expected_revision_id,
            "result": "approved",
            "evidence_receipts": [evidence_id],
        }
        signature = agent_acknowledgement_signature(
            messages[0],
            actor=recipient,
            result_receipt=receipt,
            secret=secret,
        )
        acknowledge_path = (
            f"/orchestrator/runtime/delivery/handoffs/{messages[0].message_id}/acknowledge"
        )
        if check_replay:
            forged_ack = client.post(
                acknowledge_path,
                json={
                    "recipient": recipient,
                    "result_receipt": receipt,
                    "recipient_signature": "forged",
                },
                headers={"x-cortex-write-token": ""},
            )
            assert forged_ack.status_code == 403
        acknowledged = client.post(
            acknowledge_path,
            json={
                "recipient": recipient,
                "result_receipt": receipt,
                "recipient_signature": signature,
            },
            headers={"x-cortex-write-token": ""},
        )
        assert acknowledged.status_code == 200, acknowledged.text
        return acknowledged.json()

    verifier_ack = claim_and_ack(
        recipient="release-verifier",
        secret=verifier_recipient_secret,
        state_body=build.json(),
        evidence_id=evidence_ids["canary_verified"],
        request_id="claim-public-runtime-canary",
        check_replay=True,
    )
    assert verifier_ack["release_progress"]["release_stage"] == "canary_verified"
    canary = client.get(f"/orchestrator/runtime/delivery/{process['process_id']}")
    assert canary.status_code == 200, canary.text
    assert canary.json()["delivery"]["release_state"]["current_stage"] == "canary_verified"

    manager_ack = claim_and_ack(
        recipient="release-manager",
        secret=manager_recipient_secret,
        state_body=canary.json(),
        evidence_id=evidence_ids["production"],
        request_id="claim-public-runtime-production",
        discovery=True,
    )
    assert manager_ack["release_progress"]["release_stage"] == "production"
    production = client.get(f"/orchestrator/runtime/delivery/{process['process_id']}")
    assert production.status_code == 200, production.text
    production_body = production.json()
    assert production_body["state"]["status"] == "completed"
    assert production_body["delivery"]["release_state"]["current_stage"] == "production"

    for index in range(50):
        requested_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        request_id = f"empty-idle-poll-{index}"
        empty_poll = client.post(
            "/orchestrator/runtime/delivery/handoffs/claim-next",
            json={
                "recipient": "release-manager",
                "request_id": request_id,
                "requested_at": requested_at,
                "recipient_signature": runtime_delivery_handoff_discovery_signature(
                    recipient="release-manager",
                    request_id=request_id,
                    requested_at=requested_at,
                    secret=manager_recipient_secret,
                ),
            },
            headers={"x-cortex-write-token": ""},
        )
        assert empty_poll.status_code == 200, empty_poll.text
        assert empty_poll.json()["messages"] == []

    reopened = orchestrator._runtime_delivery_stores()
    reopened_release = reopened["release_store"].load(process["process_id"])
    reopened_artifacts = reopened["release_store"].artifact_store()
    reopened_receipts = [
        ReleaseArtifactReceipt.model_validate(row)
        for row in reopened_release.metadata.get("release_artifacts", [])
    ]
    assert {receipt.artifact_id for receipt in reopened_receipts} == {
        f"artifact_release_bundle:{process['process_id']}",
        f"artifact_smoke_report:{process['process_id']}",
        *evidence_ids.values(),
    }
    assert all(reopened_artifacts.resolve(receipt.artifact_ref) for receipt in reopened_receipts)
    assert any(row.stage == "production" for row in reopened_release.rollback_fenceposts)
    assert len(list((delivery_root / "handoff_claim_receipts").glob("*.json"))) == 2
    assert all(
        message.ack_receipt.get("authentication") == "hmac-sha256"
        for message in reopened["mailbox"].list(process_id=process["process_id"])
        if message.delivery_status == "acked"
    )


def test_runtime_delivery_routes_bootstrap_reconcile_and_rollback(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({"runtime-independent-verifier": VERIFIER_SECRET}),
    )
    orchestrator.workflows.clear()

    process = scheduler.create_process_from_workflow(
        _workflow(),
        process_id="proc_runtime_delivery",
        owner="cortex",
        session_key="session:delivery",
    )
    scheduler_state = scheduler.load_state()
    scheduler_state["processes"][process["process_id"]]["enabled"] = False
    scheduler_state["processes"][process["process_id"]]["status"] = "waiting"
    scheduler_state["processes"][process["process_id"]]["nodes"]["build"]["status"] = "waiting"
    scheduler.save_state(scheduler_state)
    process = scheduler.get_process(process["process_id"])

    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_delivery(
            process["process_id"],
            orchestrator.RuntimeDeliveryReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-runtime-delivery",
                initial_release_stage="draft",
                promotion_stages=["build_verified", "canary_verified", "production"],
                completion_criteria=[
                    {
                        "criterion_id": "release-stage",
                        "summary": "Release must reach production",
                        "kind": "release_stage",
                        "stage": "production",
                    }
                ],
                stage_gates=[
                    {
                        "stage": "production",
                        "required_fencepost_stages": ["build_verified"],
                        "required_handoff_count": 1,
                        "require_dependability": False,
                        "metadata": {
                            "handoff": {
                                "from_agent": "controller",
                                "to_agent": "release-manager",
                                "scope": "release:promote",
                                "objective": "Promote the live runtime build to production",
                                "expected_output": "Ack readiness for production promotion",
                            }
                        },
                    }
                ],
                dependability_profile=dict(MINIMAL_PROFILE),
            ),
        )
    )

    stores = orchestrator._runtime_delivery_stores()
    assert reconciled["state"]["status"] == "active"
    assert stores["release_store"].load(process["process_id"]).current_stage == "draft"
    mandatory_criterion_ids = {
        row["criterion_id"] for row in reconciled["contract"]["completion_criteria"]
        if row.get("metadata", {}).get("server_mandated")
    }
    assert mandatory_criterion_ids == {
        "release-target-stage",
        "release-canary-stage",
        "release-bundle",
        "smoke-report",
    }
    release_state = stores["release_store"].load(process["process_id"])
    artifact_hashes = []
    for artifact_id, artifact_kind in (
        (f"artifact_release_bundle:{process['process_id']}", "release_bundle"),
        (f"artifact_smoke_report:{process['process_id']}", "smoke_report"),
    ):
        ingested = asyncio.run(
            orchestrator.ingest_runtime_delivery_artifact(
                process["process_id"],
                _signed_artifact_request(
                    release_state,
                    artifact_id=artifact_id,
                    payload={"artifact_id": artifact_id, "result": "passed"},
                    artifact_kind=artifact_kind,
                ),
            )
        )
        artifact_hashes.append(ingested["receipt"]["content_hash"])

    def approve_stage(stage: str, recipient: str, evidence_id: str) -> None:
        active_release = stores["release_store"].load(process["process_id"])
        policy = release_canary_policy(stage)
        evidence_claims = {
            "policy_id": policy["policy_id"],
            "deployment_id": f"deployment:runtime:{stage}",
            "cohort_id": "canary-10-percent",
            "traffic_volume": 2500,
            "observation_window_seconds": 1200,
            "artifact_hashes": artifact_hashes,
            "metrics": {"availability": 0.9995, "error_rate": 0.0005},
            "thresholds": policy["thresholds"],
        }
        asyncio.run(
            orchestrator.ingest_runtime_delivery_artifact(
                process["process_id"],
                _signed_artifact_request(
                    active_release,
                    artifact_id=evidence_id,
                    payload=evidence_claims,
                    artifact_kind="canary_evidence",
                    target_stage=stage,
                    claims=evidence_claims,
                ),
            )
        )
        received = stores["mailbox"].receive(
            to_agent=recipient,
            process_id=process["process_id"],
            expected_revision_id=stores["shared_state_store"].load(process["process_id"]).revision_id,
            reject_stale_revision=True,
        )
        assert len(received) == 1
        stores["mailbox"].acknowledge(
            received[0].message_id,
            actor=received[0].to_agent,
            result_receipt={
                "candidate_ref": active_release.candidate_ref,
                "release_id": active_release.release_id,
                "revision_id": active_release.revision_id,
                "result": "approved",
                "evidence_receipts": [evidence_id],
            },
        )

    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_delivery(
            process["process_id"],
            orchestrator.RuntimeDeliveryReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-runtime-delivery",
            ),
        )
    )
    assert reconciled["delivery"]["release_state"]["current_stage"] == "build_verified"
    approve_stage("canary_verified", "release-verifier", "evidence:runtime-canary-verification")

    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_delivery(
            process["process_id"],
            orchestrator.RuntimeDeliveryReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-runtime-delivery",
            ),
        )
    )
    assert reconciled["delivery"]["release_state"]["current_stage"] == "canary_verified"
    approve_stage("production", "release-manager", "evidence:runtime-production-verification")

    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_delivery(
            process["process_id"],
            orchestrator.RuntimeDeliveryReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-runtime-delivery",
            ),
        )
    )
    messages = stores["mailbox"].list(process_id=process["process_id"])

    assert reconciled["success"] is True
    assert reconciled["state"]["status"] == "completed"
    assert reconciled["delivery"]["release_state"]["current_stage"] == "production"
    assert reconciled["delivery"]["snapshot"]["process_id"] == process["process_id"]
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["release_stage"] == "production"
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["loop_status"] == "completed"
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["continuation"]["mode"] == "stop"
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["next_action"]["kind"] == "completed"
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["execution_budget"]["max_auto_chain_passes"] == 4
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["reporting_policy"]["report_every_iterations"] == 1
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["execution_discipline"]["latest_decisions"]["status"] == "completed"
    assert reconciled["process"]["workflow"]["metadata"]["delivery_continuation_mode"] == "stop"
    assert any(message.to_agent == "release-verifier" and message.delivery_status == "acked" for message in messages)
    assert any(message.to_agent == "release-manager" and message.delivery_status == "acked" for message in messages)
    assert any(fencepost["stage"] == "production" for fencepost in reconciled["delivery"]["release_state"]["rollback_fenceposts"])

    original_replace_workflow = orchestrator.replace_process_workflow
    failures = {"remaining": 1}

    def fail_runtime_projection_once(*args, **kwargs):
        if kwargs.get("event_kind") == "runtime_delivery_rollback_applied" and failures["remaining"]:
            failures["remaining"] -= 1
            raise OSError("runtime process projection unavailable")
        return original_replace_workflow(*args, **kwargs)

    monkeypatch.setattr(orchestrator, "replace_process_workflow", fail_runtime_projection_once)
    with pytest.raises(OSError, match="runtime process projection unavailable"):
        asyncio.run(
            orchestrator.rollback_runtime_delivery(
                process["process_id"],
                orchestrator.RuntimeDeliveryRollbackRequest(actor="controller", reason="post-push regression"),
            )
        )
    pending_intent = stores["release_store"].load_rollback_intent(process["process_id"])
    assert pending_intent["status"] == "recovery_required"
    assert pending_intent["phase"] == "loop_projection_committed"

    # Re-opening every store against the same mounted root simulates container
    # replacement while the named runtime-delivery volume remains attached.
    reopened_stores = orchestrator._runtime_delivery_stores()
    reopened_release = reopened_stores["release_store"].load(process["process_id"])
    reopened_intent = reopened_stores["release_store"].load_rollback_intent(process["process_id"])
    reopened_artifact_store = reopened_stores["release_store"].artifact_store()
    reopened_receipts = [
        ReleaseArtifactReceipt.model_validate(row)
        for row in reopened_release.metadata.get("release_artifacts", [])
    ]
    assert reopened_intent["transaction_id"] == pending_intent["transaction_id"]
    assert {receipt.artifact_id for receipt in reopened_receipts} == {
        f"artifact_release_bundle:{process['process_id']}",
        f"artifact_smoke_report:{process['process_id']}",
        "evidence:runtime-canary-verification",
        "evidence:runtime-production-verification",
    }
    assert reopened_release.current_stage == "canary_verified"
    assert any(fencepost.stage == "canary_verified" for fencepost in reopened_release.rollback_fenceposts)
    assert not any(fencepost.stage == "production" for fencepost in reopened_release.rollback_fenceposts)
    assert all(reopened_artifact_store.resolve(receipt.artifact_ref) for receipt in reopened_receipts)

    monkeypatch.setattr(orchestrator, "replace_process_workflow", original_replace_workflow)
    assert orchestrator._recover_runtime_delivery_rollbacks(stores=reopened_stores) == [process["process_id"]]
    rolled_back = asyncio.run(orchestrator.get_runtime_delivery_status(process["process_id"]))
    committed_intent = reopened_stores["release_store"].load_rollback_intent(process["process_id"])
    rollback_reports = [row for row in reopened_stores["loop_store"].reports(process["process_id"]) if row.kind == "rollback"]
    rollback_progress_events = [
        row for row in scheduler.process_events(process["process_id"], limit=1000)
        if row.get("kind") == "runtime_delivery_rollback_applied.progress"
        and (row.get("payload") or {}).get("rollback_transaction_id") == committed_intent["transaction_id"]
    ]

    assert committed_intent["status"] == "committed"
    assert committed_intent["completed_projections"] == ["production_loop", "runtime_process"]
    assert len(rollback_reports) == 1
    assert len(rollback_progress_events) == 1
    assert rolled_back["release_state"]["current_stage"] == "canary_verified"
    assert rolled_back["release_state"]["metadata"]["rollback_applied"] is True
    assert rolled_back["process"]["status"] == "ready"
    assert rolled_back["process"]["nodes"]["build"]["status"] == "ready"
    assert rolled_back["shared_state"]["revision_id"].endswith(".rollback")
    assert rolled_back["loop_state"]["status"] == "active"
    assert rolled_back["loop_state"]["current_stage"] == "canary_verified"
    assert rolled_back["latest_report"]["kind"] == "rollback"
    assert rolled_back["latest_report"]["metadata"]["rollback_reason"] == "post-push regression"
    assert rolled_back["process"]["workflow"]["metadata"]["runtime_delivery"]["release_stage"] == "canary_verified"
    assert rolled_back["process"]["workflow"]["metadata"]["last_runtime_delivery_rollback_transaction_id"] == committed_intent["transaction_id"]


def test_pending_rollback_fences_release_handoff_claim_mutation(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"
    recipient = "release-verifier"
    secret = "release-verifier-test-secret"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setenv(
        "CORTEX_AGENT_ACK_CREDENTIALS",
        json.dumps({recipient: secret, "release-manager": "release-manager-test-secret"}),
    )
    process = scheduler.create_process_from_workflow(
        _workflow(),
        process_id="proc_pending_rollback_handoff",
        owner="cortex",
        session_key="session:pending-rollback",
    )
    stores = orchestrator._runtime_delivery_stores()
    asyncio.run(
        orchestrator.reconcile_runtime_delivery(
            process["process_id"],
            orchestrator.RuntimeDeliveryReconcileRequest(
                controller_id="controller",
                controller_session_id="session:controller",
                dependability_profile=dict(MINIMAL_PROFILE),
            ),
        )
    )
    release_state = stores["release_store"].load(process["process_id"])
    message = stores["mailbox"].send(
        process_id=process["process_id"],
        from_agent="controller",
        to_agent=recipient,
        revision_id=release_state.revision_id,
        metadata={
            "target_stage": "canary_verified",
            "release_id": release_state.release_id,
            "candidate_ref": release_state.candidate_ref,
        },
    )
    stores["release_store"].save_rollback_intent(
        process["process_id"],
        {"status": "recovery_required", "phase": "snapshot_committed"},
    )
    requested_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    request_id = "pending-rollback-claim"
    request = orchestrator.RuntimeDeliveryHandoffClaimRequest(
        recipient=recipient,
        process_id=process["process_id"],
        expected_revision_id=release_state.revision_id,
        request_id=request_id,
        requested_at=requested_at,
        recipient_signature=runtime_delivery_handoff_claim_signature(
            recipient=recipient,
            process_id=process["process_id"],
            expected_revision_id=release_state.revision_id,
            request_id=request_id,
            requested_at=requested_at,
            secret=secret,
        ),
    )

    with pytest.raises(orchestrator.HTTPException) as exc_info:
        asyncio.run(orchestrator.claim_runtime_delivery_handoffs(request))

    assert exc_info.value.status_code == 409
    persisted = next(row for row in stores["mailbox"].list() if row.message_id == message.message_id)
    assert persisted.delivery_status == "queued"
    assert not list((delivery_root / "handoff_claim_receipts").glob("*.json"))


def test_runtime_tick_watchdog_reconciles_live_delivery_without_prompt_and_persists_ownership(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    sent = _install_fake_diplomat(monkeypatch)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    workflow = _workflow()
    workflow["metadata"] = {
        **dict(workflow.get("metadata") or {}),
        "channel": "whatsapp",
        "conversation_id": "chat:delivery-watchdog",
    }
    process = scheduler.create_process_from_workflow(
        workflow,
        process_id="proc_runtime_delivery_watchdog",
        owner="cortex",
        session_key="session:delivery",
    )

    first_now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_delivery(
            process["process_id"],
            orchestrator.RuntimeDeliveryReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-runtime-delivery-watchdog",
                now_iso=first_now.isoformat().replace("+00:00", "Z"),
                initial_release_stage="draft",
                promotion_stages=["build_verified", "canary_verified", "production"],
                completion_criteria=[
                    {
                        "criterion_id": "release-stage",
                        "summary": "Release must reach production",
                        "kind": "release_stage",
                        "stage": "production",
                    }
                ],
                stage_gates=[
                    {
                        "stage": "production",
                        "required_fencepost_stages": ["build_verified"],
                        "required_artifacts": ["artifact:missing-canary-proof"],
                        "require_dependability": False,
                    }
                ],
                contract={
                    "checkpoint_policy": {
                        "report_every_iterations": 10,
                        "live_review_seconds": 60,
                        "proactive_report_seconds": 120,
                        "blocker_followup_seconds": 60,
                    }
                },
                dependability_profile=dict(MINIMAL_PROFILE),
            ),
        )
    )
    assert reconciled["state"]["status"] == "active"
    sent_before_tick = len(sent)
    stores = orchestrator._runtime_delivery_stores()
    controller_lease = next(
        row
        for row in stores["supervisor"].list(process_id=process["process_id"], status="active")
        if row.scope == f"production_build_loop:{process['process_id']}"
    )
    watchdog_now = datetime.fromisoformat(controller_lease.expires_at.replace("Z", "+00:00")) + timedelta(seconds=1)

    tick = asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=watchdog_now.isoformat().replace("+00:00", "Z"),
            )
        )
    )
    status = asyncio.run(orchestrator.get_runtime_delivery_status(process["process_id"]))
    follow_ups = stores["follow_up_store"].list(process_id=process["process_id"], runtime_kind="delivery")

    assert tick["watchdog"]["action_count"] >= 1
    assert status["loop_state"]["liveness"] == "live"
    assert status["loop_state"]["last_watchdog_decision"]["decision"] in {"report_status", "auto_resume"}
    assert status["loop_state"]["conversation_ownership"]["owner"] == "cortex"
    assert status["loop_state"]["conversation_ownership"]["session_key"] == "session:delivery"
    assert status["loop_state"]["conversation_ownership"]["channel"] == "whatsapp"
    assert status["loop_state"]["follow_through"]["resume_on_next_tick"] is True
    assert status["loop_state"]["follow_through"]["pending_update_intent"]["kind"] == "status"
    assert status["loop_state"]["follow_through"]["outbound_update"]["delivery_status"] == "sent"
    assert status["process"]["workflow"]["metadata"]["runtime_delivery"]["conversation_ownership"]["conversation_id"] == "chat:delivery-watchdog"
    assert status["process"]["workflow"]["metadata"]["delivery_follow_up_due_at"] is not None
    assert len(sent) == sent_before_tick + 1
    assert len(follow_ups) == sent_before_tick + 1
    assert all(row.delivery_status == "sent" for row in follow_ups)
    assert any("runtime_delivery_route" in row["message"] for row in sent)

    second_tick = asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=(watchdog_now + timedelta(seconds=15)).isoformat().replace("+00:00", "Z"),
            )
        )
    )
    assert second_tick["success"] is True
    assert len(sent) == sent_before_tick + 1
    assert len(stores["follow_up_store"].list(process_id=process["process_id"], runtime_kind="delivery")) == sent_before_tick + 1



def test_runtime_delivery_reconcile_proactively_dispatches_true_human_blocker(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    sent = _install_fake_diplomat(monkeypatch)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    workflow = _workflow()
    workflow["metadata"] = {
        **dict(workflow.get("metadata") or {}),
        "channel": "whatsapp",
        "conversation_id": "chat:delivery-blocker",
    }
    process = scheduler.create_process_from_workflow(
        workflow,
        process_id="proc_runtime_delivery_blocker",
        owner="cortex",
        session_key="session:delivery",
    )

    stores = orchestrator._runtime_delivery_stores()
    orchestrator._bootstrap_runtime_delivery_state(process["process_id"], process=process, stores=stores)
    shared_state = stores["shared_state_store"].load(process["process_id"])
    stores["shared_state_store"].save(
        {
            **orchestrator.model_dump_compat(shared_state),
            "open_questions": ["HUMAN: choose whether this should ship tonight"],
        },
        expected_revision_id=shared_state.revision_id,
        actor="test",
        provenance={"phase": "inject_human_blocker"},
    )

    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_delivery(
            process["process_id"],
            orchestrator.RuntimeDeliveryReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-runtime-delivery-blocker",
                dependability_profile=dict(MINIMAL_PROFILE),
                completion_criteria=[
                    {
                        "criterion_id": "release-stage",
                        "summary": "Release must reach production",
                        "kind": "release_stage",
                        "stage": "production",
                    }
                ],
                checkpoint_policy={
                    "report_every_iterations": 10,
                    "live_review_seconds": 60,
                    "proactive_report_seconds": 120,
                    "blocker_followup_seconds": 60,
                },
            ),
        )
    )
    status = asyncio.run(orchestrator.get_runtime_delivery_status(process["process_id"]))
    follow_ups = stores["follow_up_store"].list(process_id=process["process_id"], runtime_kind="delivery")

    assert reconciled["state"]["status"] == "blocked"
    assert reconciled["follow_up_dispatch"]["delivery_status"] == "sent"
    assert status["loop_state"]["follow_through"]["outbound_update"]["delivery_status"] == "sent"
    assert len(sent) == 1
    assert len(follow_ups) == 1
    assert follow_ups[0].delivery_status == "sent"
    assert "Need from you" in sent[0]["message"]
