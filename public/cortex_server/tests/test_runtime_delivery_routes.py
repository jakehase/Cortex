from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import json
import httpx
import pytest
import threading
from fastapi import FastAPI

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator
import cortex_server.runtime.dependability as dependability
import cortex_server.runtime.production_build_loop as production_build_loop
from cortex_server.middleware.write_authorization import WriteAuthorizationMiddleware
from cortex_server.runtime import (
    AgentMessage,
    AgentSupervisor,
    SharedProcessState,
    agent_acknowledgement_signature,
)
from cortex_server.runtime.production_build_loop import (
    RUNTIME_DELIVERY_MOUNT_MARKER,
    RUNTIME_DELIVERY_MANAGER_CAPABILITY_PROCESS_ID,
    RUNTIME_DELIVERY_MANAGER_CAPABILITY_REASON,
    runtime_delivery_handoff_claim_signature,
    runtime_delivery_handoff_discovery_signature,
    runtime_delivery_manager_rollback_signature,
    runtime_delivery_verifier_capability_signature,
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


VERIFIER_SECRET = "runtime-verifier-secret-0000000000000001"
IMAGE_DIGEST = "sha256:" + "d" * 64
IMAGE_REF = f"registry.example/cortex@{IMAGE_DIGEST}"
IMAGE_CLAIMS = {"image_ref": IMAGE_REF, "image_digest": IMAGE_DIGEST}
VERIFIER_RECIPIENT_SECRET = "verifier-recipient-secret-000000000001"
MANAGER_RECIPIENT_SECRET = "manager-recipient-secret-0000000000001"


def _public_runtime_delivery_client() -> TestClient:
    app = FastAPI()
    app.include_router(orchestrator.router, prefix="/orchestrator")
    app.include_router(orchestrator.router, prefix="/conductor")
    app.add_middleware(
        WriteAuthorizationMiddleware,
        mode="token_required",
        token="runtime-delivery-write-token",
        header_name="x-cortex-write-token",
        exempt_prefixes=(
            "/orchestrator/runtime/delivery/handoffs",
            "/conductor/runtime/delivery/handoffs",
        ),
    )
    client = TestClient(app)
    client.headers["x-cortex-write-token"] = "runtime-delivery-write-token"
    return client


@pytest.mark.asyncio
async def test_both_public_readiness_aliases_use_application_off_thread_probe(monkeypatch):
    app = FastAPI()
    app.include_router(orchestrator.router, prefix="/orchestrator")
    app.include_router(orchestrator.router, prefix="/conductor")
    calls = []

    async def shared_probe():
        calls.append(True)
        await asyncio.sleep(0)
        return {
            "ready": True,
            "checks": {
                "runtimeDelivery": {
                    "ok": True,
                    "status": "ready",
                    "checks": {"durableRuntimeDeliveryRoot": {"ok": True}},
                    "error": None,
                }
            },
        }

    app.state.async_readiness_payload = shared_probe
    monkeypatch.setattr(
        orchestrator,
        "probe_runtime_delivery_readiness",
        lambda _root: (_ for _ in ()).throw(AssertionError("synchronous fallback must not run")),
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        responses = await asyncio.gather(
            client.get("/orchestrator/runtime-delivery/readiness"),
            client.get("/conductor/runtime-delivery/readiness"),
        )
    assert [response.status_code for response in responses] == [200, 200]
    assert all(response.json()["service"] == "cortex-runtime-delivery" for response in responses)
    assert len(calls) == 2


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


def test_release_bootstrap_rejects_disabled_initialization_without_orphaning_contract(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "runtime.db")
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")
    process = scheduler.create_process_from_workflow(_workflow())
    stores = orchestrator._runtime_delivery_stores()

    with pytest.raises(orchestrator.HTTPException) as rejected:
        orchestrator._reconcile_runtime_delivery_sequence(
            process["process_id"],
            request=orchestrator.RuntimeDeliveryReconcileRequest(
                bootstrap_runtime_state=True,
                initialize_release=False,
            ),
            stores=stores,
        )

    assert rejected.value.status_code == 400
    assert stores["loop_store"].load_contract(process["process_id"]) is None
    assert stores["release_store"].load(process["process_id"]) is None
    assert not list((stores["root"] / "release_bootstrap_intents").glob("*.json"))


def test_release_bootstrap_intent_recovers_crash_between_contract_and_release(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "runtime.db")
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")
    process = scheduler.create_process_from_workflow(_workflow())
    stores = orchestrator._runtime_delivery_stores()
    original_ensure = orchestrator._ensure_runtime_release_state
    crashes = {"remaining": 1}

    def crash_before_release(*args, **kwargs):
        if crashes["remaining"]:
            crashes["remaining"] -= 1
            raise OSError("simulated crash before release initialization")
        return original_ensure(*args, **kwargs)

    monkeypatch.setattr(orchestrator, "_ensure_runtime_release_state", crash_before_release)
    request = orchestrator.RuntimeDeliveryReconcileRequest(bootstrap_runtime_state=True)
    with pytest.raises(OSError, match="simulated crash"):
        orchestrator._reconcile_runtime_delivery_sequence(
            process["process_id"],
            request=request,
            stores=stores,
        )
    intents = list((stores["root"] / "release_bootstrap_intents").glob("*.json"))
    assert len(intents) == 1
    assert stores["loop_store"].load_contract(process["process_id"]) is not None
    assert stores["release_store"].load(process["process_id"]) is None

    recovered = orchestrator._recover_runtime_delivery_bootstraps(stores=stores)
    assert recovered == [process["process_id"]]
    assert stores["release_store"].load(process["process_id"]) is not None
    assert stores["loop_store"].load_state(process["process_id"]) is not None
    assert not list((stores["root"] / "release_bootstrap_intents").glob("*.json"))


def test_release_bootstrap_intent_recovers_crash_before_contract_publication(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "runtime.db")
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")
    process = scheduler.create_process_from_workflow(_workflow())
    stores = orchestrator._runtime_delivery_stores()
    original_save_contract = stores["loop_store"].save_contract
    failures = {"remaining": 1}

    def crash_before_contract(contract):
        if failures["remaining"]:
            failures["remaining"] -= 1
            raise OSError("simulated crash before contract publication")
        return original_save_contract(contract)

    monkeypatch.setattr(stores["loop_store"], "save_contract", crash_before_contract)
    with pytest.raises(OSError, match="before contract publication"):
        orchestrator._reconcile_runtime_delivery_sequence(
            process["process_id"],
            request=orchestrator.RuntimeDeliveryReconcileRequest(bootstrap_runtime_state=True),
            stores=stores,
        )

    intents = list((stores["root"] / "release_bootstrap_intents").glob("*.json"))
    assert len(intents) == 1
    retained = json.loads(intents[0].read_text(encoding="utf-8"))
    retained_contract_id = retained["contract"]["contract_id"]
    assert stores["loop_store"].load_contract(process["process_id"]) is None

    recovered = orchestrator._recover_runtime_delivery_bootstraps(stores=stores)
    assert recovered == [process["process_id"]]
    assert stores["loop_store"].load_contract(process["process_id"]).contract_id == retained_contract_id
    assert stores["release_store"].load(process["process_id"]) is not None
    assert not list((stores["root"] / "release_bootstrap_intents").glob("*.json"))


def test_release_bootstrap_recovery_clears_intent_if_release_publish_already_committed(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "runtime.db")
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")
    process = scheduler.create_process_from_workflow(_workflow())
    stores = orchestrator._runtime_delivery_stores()
    request = orchestrator.RuntimeDeliveryReconcileRequest(bootstrap_runtime_state=True)
    orchestrator._bootstrap_runtime_delivery_state(
        process["process_id"],
        process=process,
        stores=stores,
    )
    contract = orchestrator._resolve_runtime_delivery_contract(
        process["process_id"],
        process=process,
        stores=stores,
        request=request,
    )
    orchestrator._save_release_bootstrap_intent(
        stores=stores,
        process_id=process["process_id"],
        request=request,
        contract=contract,
    )
    stores["loop_store"].save_contract(contract)
    orchestrator._ensure_runtime_release_state(
        process["process_id"],
        process=process,
        contract=contract,
        stores=stores,
        request=request,
    )

    assert orchestrator._recover_runtime_delivery_bootstraps(stores=stores) == [process["process_id"]]
    assert not list((stores["root"] / "release_bootstrap_intents").glob("*.json"))


def _prime_production_dependability_observations(process: dict, stores: dict) -> None:
    """Persist genuine work history before starting the server-owned 24h campaign."""

    process_id = process["process_id"]
    bootstrapped = orchestrator._bootstrap_runtime_delivery_state(
        process_id,
        process=process,
        stores=stores,
    )
    current = bootstrapped["shared_state"]
    agents = ["builder", "reviewer", "operator"]
    for revision_number in range(len(stores["shared_state_store"].history(process_id)) + 1, 7):
        actor = agents[(revision_number - 1) % len(agents)]
        current = stores["shared_state_store"].save(
            SharedProcessState(
                process_id=process_id,
                revision_id=f"{process_id}.observed.{revision_number}",
                goals=list(current.goals),
                active_plan_node_ids=list(current.active_plan_node_ids),
                runtime_constraints=dict(current.runtime_constraints),
                world_state=dict(current.world_state),
                belief_refs=list(current.belief_refs),
                open_questions=list(current.open_questions),
                agent_ownership={
                    **dict(current.agent_ownership),
                    "dependability-review": "reviewer",
                    "dependability-operations": "operator",
                },
                metadata={
                    **dict(current.metadata),
                    "observed_work_revision": revision_number,
                },
            ),
            expected_revision_id=current.revision_id,
            actor=actor,
            provenance={
                "phase": "observed_dependability_work",
                "revision": revision_number,
            },
        )
    for cycle in range(5):
        from_agent = agents[cycle % len(agents)]
        to_agent = agents[(cycle + 1) % len(agents)]
        message = stores["mailbox"].send(
            process_id=process_id,
            from_agent=from_agent,
            to_agent=to_agent,
            kind="handoff",
            revision_id=current.revision_id,
            dedupe_key=f"dependability-observation:{process_id}:{cycle}",
            payload={"completed_observation": cycle + 1},
        )
        stores["mailbox"].receive(
            to_agent=to_agent,
            process_id=process_id,
            expected_revision_id=current.revision_id,
            reject_stale_revision=True,
        )
        stores["mailbox"].acknowledge(message.message_id, actor=to_agent)


def _signed_artifact_request(
    state,
    *,
    artifact_id: str,
    payload: dict,
    artifact_kind: str,
    target_stage: str | None = None,
    claims: dict | None = None,
) -> orchestrator.RuntimeDeliveryArtifactIngestRequest:
    effective_claims = dict(claims or {})
    if artifact_kind == "release_bundle" and artifact_id.startswith(
        "artifact_release_bundle:"
    ):
        effective_claims = {**IMAGE_CLAIMS, **effective_claims}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    content_hash = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
    created_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
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
        "claims": effective_claims,
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
        claims=effective_claims,
        created_at=created_at,
    )


def test_runtime_delivery_ordinary_initialization_rejects_non_draft_stage():
    with pytest.raises(ValueError, match="ordinary runtime release initialization is restricted to draft"):
        orchestrator.RuntimeDeliveryReconcileRequest(initial_release_stage="production")


def test_runtime_delivery_ingest_and_handoff_models_enforce_strict_bounds(monkeypatch):
    monkeypatch.setenv("CORTEX_RELEASE_ARTIFACT_MAX_BYTES", "8")
    monkeypatch.setenv("CORTEX_RELEASE_ARTIFACT_RELEASE_QUOTA_BYTES", "16")
    monkeypatch.setenv("CORTEX_RELEASE_ARTIFACT_STORE_QUOTA_BYTES", "32")

    with pytest.raises(ValueError, match="maximum artifact size"):
        orchestrator.RuntimeDeliveryArtifactIngestRequest(
            artifact_id="artifact:oversized-model",
            payload="x" * 9,
            artifact_kind="release_bundle",
            producer="builder",
            verifier="verifier",
            attestation_signature="0" * 64,
            created_at="2026-07-16T05:00:00.000Z",
        )

    with pytest.raises(ValueError, match="256"):
        orchestrator.RuntimeDeliveryHandoffClaimRequest(
            recipient="r" * 257,
            process_id="proc_bounded_handoff",
            expected_revision_id="rev_1",
            request_id="request-bounded-handoff",
            requested_at="2026-07-16T05:00:00.000Z",
            recipient_signature="0" * 64,
        )


def test_invalid_artifact_signature_has_no_side_effect_for_compatibility_aliases(
    tmp_path,
    monkeypatch,
):
    process_id = "proc_invalid_alias_artifact"
    release_store = orchestrator.ReleaseWorkflowStore(tmp_path / "release")
    release_state = release_store.save(
        orchestrator.ReleaseWorkflowState(
            process_id=process_id,
            candidate_ref="build:invalid-alias-artifact",
            target_environment="production",
            revision_id="rev_1",
        )
    )
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({"runtime-independent-verifier": VERIFIER_SECRET}),
    )
    monkeypatch.setattr(
        orchestrator,
        "get_runtime_process",
        lambda requested: {"process_id": requested} if requested == process_id else None,
    )
    monkeypatch.setattr(
        orchestrator,
        "_runtime_delivery_stores",
        lambda: {"release_store": release_store},
    )
    client = _public_runtime_delivery_client()
    request = _signed_artifact_request(
        release_state,
        artifact_id="artifact:invalid-alias",
        payload={"result": "must-not-persist"},
        artifact_kind="release_bundle",
    ).model_copy(update={"attestation_signature": "0" * 64})
    before_state = release_store.load(process_id).model_dump()
    before_history = [row.model_dump() for row in release_store.history(process_id)]

    for prefix in ("orchestrator", "conductor"):
        rejected = client.post(
            f"/{prefix}/runtime/delivery/artifacts/{process_id}",
            json=request.model_dump(),
        )
        assert rejected.status_code == 403

    assert release_store.load(process_id).model_dump() == before_state
    assert [row.model_dump() for row in release_store.history(process_id)] == before_history
    assert not release_store.artifact_store().path.exists()


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
    process = scheduler.get_process(process["process_id"])
    stores = orchestrator._runtime_delivery_stores()
    _prime_production_dependability_observations(process, stores)
    campaign_start = datetime.now(timezone.utc) - timedelta(hours=24)
    campaign_clock = [campaign_start]
    campaign_monotonic = [1000.0]
    campaign_boot_id = "66666666-6666-4666-8666-666666666666"
    monkeypatch.setattr(
        production_build_loop,
        "_dependability_server_now",
        lambda: campaign_clock[0],
    )
    monkeypatch.setattr(
        production_build_loop,
        "_dependability_server_monotonic",
        lambda: campaign_monotonic[0],
    )
    monkeypatch.setattr(
        production_build_loop,
        "_dependability_server_boot_id",
        lambda: campaign_boot_id,
    )
    monkeypatch.setattr(
        dependability,
        "_dependability_monotonic_now",
        lambda: campaign_monotonic[0],
    )
    monkeypatch.setattr(
        dependability, "_dependability_boot_id", lambda: campaign_boot_id
    )

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
            "dependability_profile": "24h",
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
            **IMAGE_CLAIMS,
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

    build = None
    for cycle in range(1, 7):
        campaign_clock[0] = campaign_start + timedelta(hours=4 * cycle)
        campaign_monotonic[0] = 1000.0 + 4 * 3600 * cycle
        build = client.post(
            f"/orchestrator/runtime/delivery/reconcile/{process['process_id']}",
            json={
                "controller_id": "controller",
                "controller_session_id": "sess-runtime-delivery-public",
            },
        )
        assert build.status_code == 200, build.text
    assert build is not None
    assert build.status_code == 200, build.text
    assert build.json()["delivery"]["release_state"]["current_stage"] == "build_verified", build.json()

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
    assert len(list((delivery_root / "handoff_claim_receipts").glob("*.json"))) == 52
    assert all(
        message.ack_receipt.get("authentication") == "hmac-sha256"
        for message in reopened["mailbox"].list(process_id=process["process_id"])
        if message.delivery_status == "acked" and (message.metadata or {}).get("target_stage")
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
    stores = orchestrator._runtime_delivery_stores()
    _prime_production_dependability_observations(process, stores)
    campaign_start = datetime.now(timezone.utc) - timedelta(hours=24)
    campaign_clock = [campaign_start]
    campaign_monotonic = [2000.0]
    campaign_boot_id = "77777777-7777-4777-8777-777777777777"
    monkeypatch.setattr(
        production_build_loop,
        "_dependability_server_now",
        lambda: campaign_clock[0],
    )
    monkeypatch.setattr(
        production_build_loop,
        "_dependability_server_monotonic",
        lambda: campaign_monotonic[0],
    )
    monkeypatch.setattr(
        production_build_loop,
        "_dependability_server_boot_id",
        lambda: campaign_boot_id,
    )
    monkeypatch.setattr(
        dependability,
        "_dependability_monotonic_now",
        lambda: campaign_monotonic[0],
    )
    monkeypatch.setattr(
        dependability, "_dependability_boot_id", lambda: campaign_boot_id
    )

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
                dependability_profile="24h",
            ),
        )
    )

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
            **IMAGE_CLAIMS,
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

    for cycle in range(1, 7):
        campaign_clock[0] = campaign_start + timedelta(hours=4 * cycle)
        campaign_monotonic[0] = 2000.0 + 4 * 3600 * cycle
        reconciled = asyncio.run(
            orchestrator.reconcile_runtime_delivery(
                process["process_id"],
                orchestrator.RuntimeDeliveryReconcileRequest(
                    controller_id="controller",
                    controller_session_id="sess-runtime-delivery",
                ),
            )
        )
    assert reconciled["delivery"]["release_state"]["current_stage"] == "build_verified", reconciled[
        "dependability"
    ]["after"]["failing_checks"]
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
                orchestrator.RuntimeDeliveryRollbackRequest(idempotency_key="rollback-post-push-regression", actor="controller", reason="post-push regression"),
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
                dependability_profile="24h",
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


def test_verifier_capability_challenge_requires_dedicated_attestation_secret(monkeypatch):
    verifier = "compose-release-verifier"
    verifier_secret = "verifier-capability-secret-material-00000001"
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({verifier: verifier_secret}),
    )
    requested_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )
    request_id = "verifier-capability-proof"
    valid = orchestrator.RuntimeDeliveryVerifierCapabilityRequest(
        verifier=verifier,
        request_id=request_id,
        requested_at=requested_at,
        verifier_signature=runtime_delivery_verifier_capability_signature(
            verifier=verifier,
            request_id=request_id,
            requested_at=requested_at,
            secret=verifier_secret,
        ),
    )
    response = asyncio.run(orchestrator.verify_runtime_delivery_verifier_capability(valid))
    assert response["capability"] == "revision-bound-artifact-attestation"

    invalid = valid.model_copy(update={"verifier_signature": "0" * 64})
    with pytest.raises(orchestrator.HTTPException) as rejected:
        asyncio.run(orchestrator.verify_runtime_delivery_verifier_capability(invalid))
    assert rejected.value.status_code == 403


def test_manager_capability_challenge_is_signed_and_non_mutating(monkeypatch):
    secret = "release-manager-capability-secret-000000000001"
    monkeypatch.setenv(
        "CORTEX_AGENT_ACK_CREDENTIALS",
        json.dumps(
            {
                "release-verifier": "release-verifier-recipient-secret-000000001",
                "release-manager": secret,
            }
        ),
    )
    monkeypatch.setattr(
        orchestrator,
        "_runtime_delivery_stores",
        lambda: (_ for _ in ()).throw(
            AssertionError("capability challenge must not open or mutate release stores")
        ),
    )
    requested_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )
    request_id = "manager-capability-proof"
    unsigned = {
        "release_id": request_id,
        "revision_id": "non-mutating",
        "idempotency_key": f"capability:{request_id}",
        "reason": RUNTIME_DELIVERY_MANAGER_CAPABILITY_REASON,
        "request_id": request_id,
        "requested_at": requested_at,
    }
    valid = orchestrator.RuntimeDeliveryManagerRollbackRequest(
        **unsigned,
        manager_signature=runtime_delivery_manager_rollback_signature(
            process_id=RUNTIME_DELIVERY_MANAGER_CAPABILITY_PROCESS_ID,
            **unsigned,
            secret=secret,
        ),
    )

    response = asyncio.run(
        orchestrator.manager_rollback_runtime_delivery(
            RUNTIME_DELIVERY_MANAGER_CAPABILITY_PROCESS_ID,
            valid,
        )
    )
    assert response == {
        "success": True,
        "capability": "signed-non-mutating-manager-rollback",
        "request_id": request_id,
    }

    invalid = valid.model_copy(update={"manager_signature": "0" * 64})
    with pytest.raises(orchestrator.HTTPException) as rejected:
        asyncio.run(
            orchestrator.manager_rollback_runtime_delivery(
                RUNTIME_DELIVERY_MANAGER_CAPABILITY_PROCESS_ID,
                invalid,
            )
        )
    assert rejected.value.status_code == 403


def test_empty_handoff_discovery_consumes_authenticated_request_id(tmp_path, monkeypatch):
    delivery_root = tmp_path / "delivery"
    secret = "release-manager-recipient-secret-000000000001"
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setenv(
        "CORTEX_AGENT_ACK_CREDENTIALS",
        json.dumps(
            {
                "release-verifier": "release-verifier-recipient-secret-000000001",
                "release-manager": secret,
            }
        ),
    )
    requested_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    request = orchestrator.RuntimeDeliveryHandoffClaimNextRequest(
        recipient="release-manager",
        request_id="empty-request-must-be-consumed",
        requested_at=requested_at,
        recipient_signature=runtime_delivery_handoff_discovery_signature(
            recipient="release-manager",
            request_id="empty-request-must-be-consumed",
            requested_at=requested_at,
            secret=secret,
        ),
    )

    first = asyncio.run(orchestrator.claim_next_runtime_delivery_handoff(request))
    assert first["messages"] == []
    assert len(list((delivery_root / "handoff_claim_receipts").glob("*.json"))) == 1

    def must_not_prune_consumed_replay(**_kwargs):
        raise AssertionError("a consumed target must be rejected before expiry pruning")

    monkeypatch.setattr(orchestrator, "_prune_runtime_delivery_handoff_claim_receipts", must_not_prune_consumed_replay)

    with pytest.raises(orchestrator.HTTPException) as exc_info:
        asyncio.run(orchestrator.claim_next_runtime_delivery_handoff(request))
    assert exc_info.value.status_code == 409


def test_runtime_process_delivery_projection_holds_release_transaction(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    process = scheduler.create_process_from_workflow(
        _workflow(),
        process_id="proc_projection_transaction",
    )
    stores = orchestrator._runtime_delivery_stores()
    projection_entered = threading.Event()
    allow_projection = threading.Event()
    competing_transaction_entered = threading.Event()
    projection_errors = []
    original_reports = stores["loop_store"].reports

    def pause_after_authoritative_reads(*args, **kwargs):
        reports = original_reports(*args, **kwargs)
        projection_entered.set()
        assert allow_projection.wait(timeout=5)
        return reports

    monkeypatch.setattr(
        stores["loop_store"],
        "reports",
        pause_after_authoritative_reads,
    )

    def run_projection():
        try:
            orchestrator._sync_runtime_process_delivery_state(
                process["process_id"],
                process=process,
                stores=stores,
                event_kind="test_projection_transaction",
            )
        except BaseException as exc:
            projection_errors.append(exc)

    projection_thread = threading.Thread(target=run_projection)

    def competing_transaction():
        with stores["release_store"].release_transaction(process["process_id"]):
            competing_transaction_entered.set()

    projection_thread.start()
    assert projection_entered.wait(timeout=5)
    contender = threading.Thread(target=competing_transaction)
    contender.start()
    assert not competing_transaction_entered.wait(timeout=0.2)
    allow_projection.set()
    projection_thread.join(timeout=5)
    contender.join(timeout=5)

    assert not projection_thread.is_alive()
    assert not contender.is_alive()
    assert projection_errors == []
    assert competing_transaction_entered.is_set()


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
                dependability_profile="24h",
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
    AgentSupervisor(
        stores["supervisor"].path,
        clock_fn=lambda: watchdog_now,
    ).reclaim_stale(process_id=process["process_id"])

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
                dependability_profile="24h",
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
