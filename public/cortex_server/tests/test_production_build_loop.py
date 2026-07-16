from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import multiprocessing

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import cortex_server.routers.orchestrator as orchestrator
from cortex_server.routers.orchestrator import RuntimeDeliveryReconcileRequest
from cortex_server.runtime import RuntimeSoakHarness
from cortex_server.runtime.dependability import load_dependability_report, unattended_profile_digest
import cortex_server.runtime.production_build_loop as production_build_loop
from cortex_server.runtime.production_build_loop import (
    BuildLoopControllerOwner,
    ProductionBuildContract,
    ProductionBuildLoopState,
    ProductionBuildLoopStore,
    ProductionBuildLoopReport,
    ProductionCheckpointPolicy,
    ProductionCompletionCriterion,
    ProductionPassBudget,
    ProductionStageGate,
    reconcile_production_build_loop,
    evaluate_production_completion,
)
from cortex_server.runtime.release_workflow import (
    ReleaseWorkflowState,
    capture_release_rollback_fencepost,
    record_release_fencepost,
    record_release_handoff,
    record_release_artifact_receipt,
    create_release_artifact_receipt,
    release_canary_policy,
)
from cortex_server.runtime.shared_process_state import OpenDecision, SharedProcessState


VERIFIER_ID = "independent-release-verifier"
VERIFIER_SECRET = "test-release-verifier-secret"


def _configure_production_credentials(monkeypatch):
    values = {
        "CORTEX_WRITE_TOKEN": "write-token-000000000000000000000001",
        "CORTEX_ADMIN_TOKEN": "admin-token-000000000000000000000001",
        "CORTEX_CODEC_ADMIN_TOKEN": "codec-token-000000000000000000000001",
        "NEXUS_ASSURANCE_SIGNING_KEY": "assurance-key-000000000000000000001",
        "NEXUS_OUTCOME_FEEDBACK_SIGNING_KEY": "outcome-key-00000000000000000000001",
        "NEXUS_OUTCOME_FEEDBACK_TOKEN": "outcome-token-0000000000000000000001",
    }
    monkeypatch.setenv("CORTEX_ENV", "production")
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps({"reader": {"secret": "principal-key-0000000000000000000001"}}),
    )
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({"independent-release-verifier": "verifier-key-0000000000000000000001"}),
    )
    monkeypatch.setenv(
        "CORTEX_AGENT_ACK_CREDENTIALS",
        json.dumps(
            {
                "release-verifier": "verifier-recipient-000000000000000001",
                "release-manager": "manager-recipient-0000000000000000001",
            }
        ),
    )
    return values


def test_production_credentials_are_strong_and_pairwise_independent(monkeypatch):
    values = _configure_production_credentials(monkeypatch)
    result = production_build_loop.validate_production_delivery_credentials()
    assert result["ok"] is True
    assert result["weakCredentials"] == []
    assert result["reusedCredentialGroups"] == []

    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "verifier-key-0000000000000000000001")
    with pytest.raises(RuntimeError, match="strong and pairwise distinct"):
        production_build_loop.validate_production_delivery_credentials()

    monkeypatch.setenv("CORTEX_WRITE_TOKEN", values["CORTEX_WRITE_TOKEN"])
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({"independent-release-verifier": "short"}),
    )
    with pytest.raises(RuntimeError, match="at least 32 bytes"):
        production_build_loop.validate_production_delivery_credentials()


def test_production_contract_identity_is_immutable_before_reconciliation_side_effects(tmp_path):
    store = ProductionBuildLoopStore(tmp_path / "production_build_loop")
    original = ProductionBuildContract(
        contract_id="contract-server-owned",
        process_id="proc_contract_identity",
        objective="Ship safely",
    )
    store.save_contract(original)

    with pytest.raises(RuntimeError, match="contract identity conflict"):
        store.save_contract(
            ProductionBuildContract(
                contract_id="contract-caller-override",
                process_id=original.process_id,
                objective="Mutate identity",
            )
        )
    assert store.load_contract(original.process_id).contract_id == original.contract_id

    process = {"process_id": original.process_id, "workflow": {"name": "Ship safely", "metadata": {}}}
    with pytest.raises(HTTPException) as rejected:
        orchestrator._resolve_runtime_delivery_contract(
            original.process_id,
            process=process,
            stores={"loop_store": store},
            request=RuntimeDeliveryReconcileRequest(
                contract={"contract_id": "contract-caller-override"}
            ),
        )
    assert getattr(rejected.value, "status_code", None) == 409
    assert store.load_contract(original.process_id).contract_id == original.contract_id


@pytest.mark.parametrize("restored_stage", ["build_verified", "canary_verified"])
def test_rollback_readiness_uses_fencepost_artifact_revision_only_while_restored(
    tmp_path,
    restored_stage,
):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    seeded = harness._seed_waiting_process(
        process_id="proc_rollback_evidence",
        revision_id="rev_deployed_artifacts",
        node_id="build",
        agent_id="builder",
    )
    fencepost = capture_release_rollback_fencepost(
        snapshot=seeded["snapshot"],
        shared_state=seeded["shared_state"],
        stage=restored_stage,
    )
    transaction_id = "rollback_transaction_test"
    restored = ReleaseWorkflowState(
        process_id="proc_rollback_evidence",
        candidate_ref="build:rollback-evidence",
        target_environment="production",
        revision_id="rollback_control_revision.rollback",
        current_stage=restored_stage,
        status="rolled_back",
        rollback_fenceposts=[fencepost],
        metadata={
            "rollback_transaction_id": transaction_id,
            "rollback_activation": {
                "version": "cortex.release.rollback-activation.v1",
                "transaction_id": transaction_id,
                "fencepost_id": fencepost.fencepost_id,
                "stage": restored_stage,
                "artifact_revision_id": "rev_deployed_artifacts",
                "control_revision_id": "rollback_control_revision.rollback",
            },
        },
    )

    revision, error = production_build_loop._active_release_evidence_revision(
        restored,
        rollback_transaction_id=transaction_id,
    )
    assert error is None
    assert revision == "rev_deployed_artifacts"

    forward = restored.model_copy(update={"status": "in_progress"})
    revision, error = production_build_loop._active_release_evidence_revision(
        forward,
        rollback_transaction_id=transaction_id,
    )
    assert error is None
    assert revision == "rollback_control_revision.rollback"


def test_production_readiness_requires_live_consumers_and_matching_reasoning_state(tmp_path, monkeypatch):
    _configure_production_credentials(monkeypatch)
    delivery_root = tmp_path / "runtime_delivery"
    delivery_root.mkdir()
    mount_id = "runtime-delivery-test-v1"
    (delivery_root / production_build_loop.RUNTIME_DELIVERY_MOUNT_MARKER).write_text(
        mount_id,
        encoding="utf-8",
    )
    reasoning_path = tmp_path / "state" / "reasoning_runtime.db"
    reasoning_path.parent.mkdir()
    monkeypatch.setenv("CORTEX_RUNTIME_DELIVERY_MOUNT_ID", mount_id)
    monkeypatch.setenv("REASONING_STORE_DB_PATH", str(reasoning_path))
    monkeypatch.setenv("CORTEX_RELEASE_VERIFIER_HEALTH_URL", "http://release-verifier:8091/health")
    monkeypatch.setenv("CORTEX_RELEASE_MANAGER_HEALTH_URL", "http://release-manager:8092/health")

    class HealthyResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(production_build_loop, "urlopen", lambda *_args, **_kwargs: HealthyResponse())

    healthy = production_build_loop.probe_runtime_delivery_readiness(delivery_root)
    assert healthy["ready"] is True
    assert healthy["checks"]["releaseConsumers"]["ok"] is True
    assert healthy["checks"]["durableReasoningStore"]["quickCheck"] == "ok"

    rotated_verifier = "independent-release-verifier-v2"
    rotated_secret = "verifier-key-v2-000000000000000000001"
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({rotated_verifier: rotated_secret}),
    )
    rotated = production_build_loop.probe_runtime_delivery_readiness(delivery_root)
    restarted = production_build_loop.probe_runtime_delivery_readiness(delivery_root)
    assert rotated["ready"] is True
    assert restarted["ready"] is True
    assert rotated["checks"]["releaseVerifierTrust"]["activeVerifierIds"] == [rotated_verifier]
    assert rotated["checks"]["releaseVerifierTrust"]["historicalVerifierIds"] == ["independent-release-verifier"]
    assert restarted["checks"]["releaseVerifierTrust"]["trustedVerifierCount"] == 2

    release_root = delivery_root / "release_workflow"
    release_root.mkdir()
    (release_root / ".proc_pending.json.rollback-intent.json").write_text(
        json.dumps(
            {
                "process_id": "proc_pending",
                "status": "recovery_required",
                "phase": "snapshot_committed",
            }
        ),
        encoding="utf-8",
    )
    pending = production_build_loop.probe_runtime_delivery_readiness(delivery_root)
    assert pending["ready"] is False
    assert pending["checks"]["runtimeDeliveryConsistency"]["pendingRollbackProcessIds"] == ["proc_pending"]
    (release_root / ".proc_pending.json.rollback-intent.json").unlink()

    orphan_contract = delivery_root / "production_build_loop" / "contracts" / "proc_orphaned_release.json"
    orphan_contract.parent.mkdir(parents=True)
    orphan_contract.write_text("{}", encoding="utf-8")
    orphaned = production_build_loop.probe_runtime_delivery_readiness(delivery_root)
    orphan_errors = orphaned["checks"]["runtimeDeliveryConsistency"]["inconsistencies"]
    assert any(
        row["process_id"] == "proc_orphaned_release"
        and "release workflow is missing" in row["error"]
        for row in orphan_errors
    )
    orphan_contract.unlink()

    (release_root / "proc_missing.json").write_text(
        json.dumps({"process_id": "proc_missing"}),
        encoding="utf-8",
    )
    inconsistent = production_build_loop.probe_runtime_delivery_readiness(delivery_root)
    assert inconsistent["ready"] is False
    assert inconsistent["checks"]["durableReasoningStore"]["missingProcessIds"] == ["proc_missing"]


def _with_artifact_receipts(state, release_store, *artifact_ids):
    artifact_store = release_store.artifact_store()
    for artifact_id in artifact_ids:
        artifact_kind = "smoke_report" if "smoke_report" in artifact_id else "release_bundle"
        receipt = create_release_artifact_receipt(
            state,
            artifact_store=artifact_store,
            artifact_id=artifact_id,
            payload={"artifact_id": artifact_id, "result": "passed"},
            artifact_kind=artifact_kind,
            producer="build-worker",
            verifier=VERIFIER_ID,
            verifier_secret=VERIFIER_SECRET,
        )
        state = record_release_artifact_receipt(
            state,
            receipt,
            artifact_store=artifact_store,
            verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
        )
    return state


def _approve_pending_release_handoff(harness, process_id, stage):
    state = harness.release_store.load(process_id)
    artifact_store = harness.release_store.artifact_store()
    artifact_hashes = [
        str(row.get("content_hash"))
        for row in state.metadata.get("release_artifacts") or []
        if isinstance(row, dict) and row.get("artifact_kind") != "canary_evidence"
    ]
    evidence_id = f"evidence:{stage}"
    policy = release_canary_policy(stage)
    claims = {
        "policy_id": policy["policy_id"],
        "deployment_id": f"deployment:{process_id}:{stage}",
        "cohort_id": "canary-10-percent",
        "traffic_volume": 1000,
        "observation_window_seconds": 900,
        "artifact_hashes": artifact_hashes,
        "metrics": {"availability": 0.999, "error_rate": 0.001},
        "thresholds": policy["thresholds"],
    }
    evidence_receipt = create_release_artifact_receipt(
        state,
        artifact_store=artifact_store,
        artifact_id=evidence_id,
        payload=claims,
        artifact_kind="canary_evidence",
        target_stage=stage,
        claims=claims,
        producer="canary-runner",
        verifier=VERIFIER_ID,
        verifier_secret=VERIFIER_SECRET,
    )
    state = record_release_artifact_receipt(
        state,
        evidence_receipt,
        artifact_store=artifact_store,
        verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
    )
    harness.release_store.save(state, actor=VERIFIER_ID)
    message = next(
        row for row in harness.mailbox.list(process_id=process_id)
        if row.delivery_status in {"queued", "inflight"}
        and str((row.metadata or {}).get("target_stage") or "") == stage
    )
    harness.mailbox.receive(
        to_agent=message.to_agent,
        process_id=process_id,
        include_inflight=True,
        expected_revision_id=state.revision_id,
        reject_stale_revision=True,
    )
    acknowledged = harness.mailbox.acknowledge(
        message.message_id,
        actor=message.to_agent,
        result_receipt={
            "candidate_ref": state.candidate_ref,
            "release_id": state.release_id,
            "revision_id": state.revision_id,
            "result": "approved",
            "evidence_receipts": [evidence_id],
        },
    )
    harness.release_store.save(
        record_release_handoff(state, acknowledged, stage=stage, notes="approved by recipient"),
        actor=message.to_agent,
    )


def test_empty_completion_contract_is_not_terminal_and_default_gates_require_evidence(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_empty_completion"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    contract = ProductionBuildContract(
        process_id=process_id,
        objective="Ship safely",
        completion_criteria=[],
        stage_gates=[],
        dependability_profile="24h",
    )

    completion = evaluate_production_completion(
        contract,
        snapshot=seeded["snapshot"],
        shared_state=seeded["shared_state"],
        dependability_report={"success": True},
        release_state=None,
    )
    canary_gate = production_build_loop._stage_gate_for(contract, "canary_verified")
    production_gate = production_build_loop._stage_gate_for(contract, "production")

    assert completion["all_required_satisfied"] is False
    assert completion["contract_valid"] is False
    assert canary_gate.required_fencepost_stages == ["build_verified"]
    assert canary_gate.required_handoff_count == 1
    assert f"artifact_release_bundle:{process_id}" in canary_gate.required_artifacts
    assert production_gate.required_handoff_count == 1
    assert f"artifact_smoke_report:{process_id}" in production_gate.required_artifacts


def test_production_contract_rejects_plans_that_omit_mandatory_canary_predecessor():
    with pytest.raises(ValidationError, match="must exactly match build_verified -> canary_verified -> production"):
        ProductionBuildContract(
            process_id="proc_missing_canary_stage",
            objective="Ship safely",
            promotion_stages=["build_verified", "production"],
        )
    with pytest.raises(ValidationError, match="draft is an initialization stage"):
        ProductionBuildContract(
            process_id="proc_reordered_from_draft",
            objective="Ship safely",
            promotion_stages=["build_verified", "draft", "canary_verified", "production"],
        )


def test_production_contract_rejects_weakened_or_unknown_dependability_policy():
    with pytest.raises(ValidationError, match="server-owned policy identifier"):
        ProductionBuildContract(
            process_id="proc_weakened_dependability",
            objective="Bypass production soak",
            dependability_profile={
                "profile": "caller-bypass",
                "intended_duration_hours": 0,
                "campaign_cycles": 0,
                "min_agent_count": 1,
                "max_dead_letters": 999999,
            },
        )
    with pytest.raises(ValidationError, match="unknown server-owned production dependability policy"):
        ProductionBuildContract(
            process_id="proc_unknown_dependability",
            objective="Select an unowned policy",
            dependability_profile="instant",
        )
    with pytest.raises(ValidationError, match="server-owned policy identifier"):
        RuntimeDeliveryReconcileRequest(dependability_profile={"profile": "caller-bypass"})
    with pytest.raises(ValidationError, match="server-owned policy identifier"):
        RuntimeDeliveryReconcileRequest(
            contract={"dependability_profile": {"profile": "nested-caller-bypass"}}
        )
    with pytest.raises(ValidationError, match="unknown server-owned production dependability policy"):
        RuntimeDeliveryReconcileRequest(dependability_profile="instant")
    with pytest.raises(ValidationError, match="unknown server-owned production dependability policy"):
        RuntimeDeliveryReconcileRequest(contract={"dependability_profile": "instant"})

    assert orchestrator._production_policy_does_not_weaken("24h", "24h") is True
    assert orchestrator._production_policy_does_not_weaken("72h", "24h") is True
    assert orchestrator._production_policy_does_not_weaken("168h", "72h") is True
    assert orchestrator._production_policy_does_not_weaken("24h", "72h") is False
    assert orchestrator._production_policy_does_not_weaken("72h", "168h") is False


def _contract(
    process_id: str,
    *,
    objective: str = "Build this app until production-ready",
    completion_criteria: list[ProductionCompletionCriterion] | None = None,
    promotion_stages: list[str] | None = None,
    stage_gates: list[ProductionStageGate] | None = None,
) -> ProductionBuildContract:
    return ProductionBuildContract(
        process_id=process_id,
        objective=objective,
        dependability_profile="24h",
        metadata={"default_worker_id": "builder"},
        promotion_stages=list(promotion_stages or ["build_verified", "canary_verified", "production"]),
        stage_gates=list(stage_gates or []),
        completion_criteria=list(
            completion_criteria
            or [
                ProductionCompletionCriterion(
                    criterion_id="release-stage",
                    summary="Release must reach production",
                    kind="release_stage",
                    stage="production",
                )
            ]
        ),
    )


def _prime_genuine_dependability_observations(harness, shared_state):
    """Create real revision and acknowledged-handoff history before the soak starts."""

    process_id = shared_state.process_id
    agents = ["builder", "reviewer", "operator"]
    current = shared_state
    for revision_number in range(len(harness.shared_state_store.history(process_id)) + 1, 7):
        actor = agents[(revision_number - 1) % len(agents)]
        current = harness.shared_state_store.save(
            SharedProcessState(
                process_id=process_id,
                revision_id=f"rev_{revision_number}",
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
                metadata={**dict(current.metadata), "observed_work_revision": revision_number},
            ),
            expected_revision_id=current.revision_id,
            actor=actor,
            provenance={"phase": "observed_dependability_work", "revision": revision_number},
        )
    for cycle in range(5):
        from_agent = agents[cycle % len(agents)]
        to_agent = agents[(cycle + 1) % len(agents)]
        message = harness.mailbox.send(
            process_id=process_id,
            from_agent=from_agent,
            to_agent=to_agent,
            kind="handoff",
            revision_id=current.revision_id,
            dedupe_key=f"dependability-observation:{process_id}:{cycle}",
            payload={"completed_observation": cycle + 1},
        )
        harness.mailbox.receive(
            to_agent=to_agent,
            process_id=process_id,
            expected_revision_id=current.revision_id,
            reject_stale_revision=True,
        )
        harness.mailbox.acknowledge(message.message_id, actor=to_agent)
    return current


def test_dependability_rejects_elapsed_claim_without_distinct_scheduled_cycle_receipts(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_temporal_evidence"
    seeded = harness._seed_waiting_process(
        process_id=process_id,
        revision_id="rev_1",
        node_id="build",
        agent_id="builder",
    )
    shared_state = _prime_genuine_dependability_observations(harness, seeded["shared_state"])
    harness._checkpoint_from_journal(process_id=process_id)
    contract = ProductionBuildContract(
        process_id=process_id,
        objective="Require a genuine 24 hour campaign",
        dependability_profile="24h",
    )
    now = datetime.now(timezone.utc)
    started_at = now - timedelta(hours=24)
    policy_digest = unattended_profile_digest("24h")
    snapshot_id = harness.snapshot_store.load(process_id).snapshot_id
    binding = {"contract_id": contract.contract_id, "revision_id": shared_state.revision_id}
    campaign_base = {
        "schema_version": "cortex.production-dependability-campaign.v1",
        "campaign_id": "depcamp_adversarial",
        "process_id": process_id,
        "policy_id": "24h",
        "policy_digest": policy_digest,
        **binding,
        "started_at": started_at.isoformat(),
        "observation_end_at": now.isoformat(),
        "observation_status": "healthy",
    }
    synthetic = {
        **campaign_base,
        "cycle_receipts": [
            {
                "receipt_id": f"synthetic_{cycle}",
                "cycle_number": cycle,
                "observed_at": now.isoformat(),
                "snapshot_id": snapshot_id,
                "process_id": process_id,
                "policy_id": "24h",
                "policy_digest": policy_digest,
                **binding,
            }
            for cycle in range(1, 7)
        ],
    }
    synthetic_report = load_dependability_report(
        process_id=process_id,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        profile="24h",
        campaign_evidence=synthetic,
        evidence_binding=binding,
        now=now,
    )
    assert synthetic_report["checks"]["elapsed_duration_ok"] is True
    assert synthetic_report["checks"]["campaign_timestamps_ok"] is False
    assert synthetic_report["checks"]["campaign_cycles_ok"] is False
    assert synthetic_report["success"] is False

    genuine = {
        **campaign_base,
        "cycle_receipts": [
            {
                "receipt_id": f"genuine_{cycle}",
                "cycle_number": cycle,
                "observed_at": (started_at + timedelta(hours=4 * cycle)).isoformat(),
                "snapshot_id": snapshot_id,
                "process_id": process_id,
                "policy_id": "24h",
                "policy_digest": policy_digest,
                **binding,
            }
            for cycle in range(1, 7)
        ],
    }
    genuine_report = load_dependability_report(
        process_id=process_id,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        profile="24h",
        campaign_evidence=genuine,
        evidence_binding=binding,
        now=now,
    )
    assert genuine_report["success"] is True, genuine_report["failing_checks"]
    assert genuine_report["campaign"]["completed_cycle_count"] == 6


def test_caller_supplied_reconciliation_time_cannot_advance_campaign_evidence(tmp_path, monkeypatch):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    seeded = harness._seed_waiting_process(
        process_id="proc_untrusted_now",
        revision_id="rev_1",
        node_id="build",
        agent_id="builder",
    )
    contract = ProductionBuildContract(
        process_id="proc_untrusted_now",
        objective="Ignore caller time for evidence",
        dependability_profile="24h",
    )
    server_now = datetime(2026, 7, 16, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(production_build_loop, "_dependability_server_now", lambda: server_now)
    binding = {"contract_id": contract.contract_id, "revision_id": "rev_1"}
    campaign, _ = production_build_loop._advance_production_dependability_campaign(
        contract,
        existing=None,
        binding=binding,
        preliminary_report={"checks": {"static_health": True}},
        snapshot=seeded["snapshot"],
        now=server_now,
    )
    attempted, _ = production_build_loop._advance_production_dependability_campaign(
        contract,
        existing=campaign,
        binding=binding,
        preliminary_report={"checks": {"static_health": True}},
        snapshot=seeded["snapshot"],
        now=server_now + timedelta(days=365),
    )
    assert attempted["started_at"] == server_now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    assert attempted["observation_end_at"] == attempted["started_at"]
    assert attempted["cycle_receipts"] == []


def test_dependability_revision_requirement_excludes_repair_generated_history(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    seeded = harness._seed_waiting_process(
        process_id="proc_no_synthetic_revision_progress",
        revision_id="rev_1",
        node_id="build",
        agent_id="builder",
    )
    current = seeded["shared_state"]
    harness.shared_state_store.save(
        SharedProcessState(
            process_id=current.process_id,
            revision_id="rev_synthetic_repair",
            goals=list(current.goals),
            active_plan_node_ids=list(current.active_plan_node_ids),
            runtime_constraints=dict(current.runtime_constraints),
            world_state=dict(current.world_state),
            belief_refs=list(current.belief_refs),
            open_questions=list(current.open_questions),
            agent_ownership=dict(current.agent_ownership),
            metadata={**dict(current.metadata), "production_dependability_repaired": True},
        ),
        expected_revision_id=current.revision_id,
        actor="repair-controller",
        provenance={
            "scenario": "production_build_loop",
            "action": "refresh_shared_state_revision",
        },
    )
    profile = production_build_loop.build_unattended_profile("24h")
    profile.update(
        {
            "profile": "revision-history-regression",
            "min_agent_count": 1,
            "min_handoff_count": 0,
            "required_revision_history": 2,
        }
    )
    report = load_dependability_report(
        process_id=current.process_id,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        profile=profile,
        now=datetime.now(timezone.utc),
    )

    assert report["checks"]["revision_history_ok"] is False
    assert report["revisions"]["history_count"] == 1
    assert report["revisions"]["total_history_count"] == 2
    assert report["revisions"]["excluded_synthetic_count"] == 1



def test_production_loop_persists_through_intermediate_milestones_until_completion(tmp_path, monkeypatch):
    monkeypatch.setenv("CORTEX_RELEASE_VERIFIER_CREDENTIALS", json.dumps({VERIFIER_ID: VERIFIER_SECRET}))
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_prod_loop"
    artifact_bundle = f"artifact_release_bundle:{process_id}"
    artifact_smoke = f"artifact_smoke_report:{process_id}"

    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    shared_state = harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_2",
            goals=list(seeded["shared_state"].goals),
            active_plan_node_ids=list(seeded["shared_state"].active_plan_node_ids),
            runtime_constraints=dict(seeded["shared_state"].runtime_constraints),
            world_state={**dict(seeded["shared_state"].world_state), "release_stage": "build_verified"},
            belief_refs=list(seeded["shared_state"].belief_refs),
            open_questions=[],
            agent_ownership=dict(seeded["shared_state"].agent_ownership),
            metadata=dict(seeded["shared_state"].metadata),
        ),
        expected_revision_id="rev_1",
        actor="builder",
        provenance={"phase": "release_seed"},
    )
    harness.journal.append(
        process_id=process_id,
        kind="artifact_written",
        revision_id=shared_state.revision_id,
        actor="builder",
        payload={"artifact_id": artifact_bundle},
    )
    snapshot = harness._checkpoint_from_journal(
        process_id=process_id,
        metadata={"release_stage": "build_verified"},
        world_state_overrides={"release_stage": "build_verified"},
    )
    shared_state = _prime_genuine_dependability_observations(harness, shared_state)

    release_state = ReleaseWorkflowState(
        process_id=process_id,
        candidate_ref="build:prod-loop",
        target_environment="production",
        revision_id=shared_state.revision_id,
        current_stage="build_verified",
        status="preparing",
    )
    release_state = record_release_fencepost(
        release_state,
        capture_release_rollback_fencepost(snapshot=snapshot, shared_state=shared_state, stage="build_verified"),
    )
    release_state = _with_artifact_receipts(release_state, harness.release_store, artifact_bundle)
    harness.release_store.save(release_state, actor="builder", provenance={"phase": "build_verified"})

    loop_store = ProductionBuildLoopStore(tmp_path / "loop_store")
    contract = _contract(
        process_id,
        completion_criteria=[
            ProductionCompletionCriterion(criterion_id="dependability", summary="Dependability must be green", kind="dependability"),
            ProductionCompletionCriterion(criterion_id="bundle", summary="Release bundle must exist", kind="artifact_present", artifact_id=artifact_bundle),
            ProductionCompletionCriterion(criterion_id="smoke", summary="Smoke report must exist", kind="artifact_present", artifact_id=artifact_smoke),
            ProductionCompletionCriterion(criterion_id="release", summary="Release must reach production", kind="release_stage", stage="production"),
            ProductionCompletionCriterion(criterion_id="questions", summary="Open questions must be cleared", kind="open_questions_clear"),
        ],
        stage_gates=[
            ProductionStageGate(stage="canary_verified", required_fencepost_stages=["build_verified"], required_artifacts=[artifact_bundle]),
            ProductionStageGate(
                stage="production",
                required_fencepost_stages=["build_verified", "canary_verified"],
                required_artifacts=[artifact_bundle, artifact_smoke],
            ),
        ],
    )

    campaign_start = datetime.now(timezone.utc) - timedelta(hours=24)
    campaign_clock = [campaign_start]
    monkeypatch.setattr(production_build_loop, "_dependability_server_now", lambda: campaign_clock[0])
    awaiting_canary = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-1",
        now=campaign_start,
    )
    assert awaiting_canary["state"]["current_stage"] == "build_verified"
    _approve_pending_release_handoff(harness, process_id, "canary_verified")
    for cycle in range(1, 6):
        campaign_clock[0] = campaign_start + timedelta(hours=4 * cycle)
        observed = reconcile_production_build_loop(
            contract,
            loop_store=loop_store,
            snapshot_store=harness.snapshot_store,
            shared_state_store=harness.shared_state_store,
            journal=harness.journal,
            mailbox=harness.mailbox,
            supervisor=harness.supervisor,
            release_store=harness.release_store,
            controller_id="controller",
            controller_session_id="sess-1",
            now=campaign_start + timedelta(hours=4 * cycle),
        )
        assert observed["state"]["current_stage"] == "build_verified"
    campaign_clock[0] = campaign_start + timedelta(hours=24)
    first = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-1",
        now=campaign_start + timedelta(hours=24),
    )

    assert first["state"]["status"] == "active"
    assert first["state"]["current_stage"] == "canary_verified"
    assert first["completion"]["all_required_satisfied"] is False
    assert harness.release_store.load(process_id).current_stage == "canary_verified"

    harness.journal.append(
        process_id=process_id,
        kind="artifact_written",
        revision_id=shared_state.revision_id,
        actor="verifier",
        payload={"artifact_id": artifact_smoke},
    )
    snapshot = harness._checkpoint_from_journal(
        process_id=process_id,
        metadata={"release_stage": "canary_verified"},
        world_state_overrides={"release_stage": "canary_verified", "verification": "passed"},
    )
    release_state = harness.release_store.load(process_id)
    release_state = record_release_fencepost(
        release_state,
        capture_release_rollback_fencepost(snapshot=snapshot, shared_state=shared_state, stage="canary_verified"),
    )
    release_state = _with_artifact_receipts(release_state, harness.release_store, artifact_smoke)
    harness.release_store.save(release_state, actor="verifier", provenance={"phase": "canary_verified"})

    awaiting_production = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-1",
    )
    assert awaiting_production["state"]["current_stage"] == "canary_verified"
    assert awaiting_production["dependability"]["after"]["campaign"]["completed_cycle_count"] == 6, {
        "before": awaiting_production["dependability"]["before"]["failing_checks"],
        "actions": awaiting_production["dependability"]["actions_taken"],
    }
    _approve_pending_release_handoff(harness, process_id, "production")
    second = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-1",
    )

    reports = loop_store.reports(process_id)

    assert second["state"]["status"] == "completed", second["dependability"]["after"]["failing_checks"]
    assert second["state"]["current_stage"] == "production"
    assert second["state"]["metadata"]["dependability_policy_id"] == "24h"
    assert second["state"]["metadata"]["dependability_policy_digest"] == unattended_profile_digest("24h")
    assert second["release"]["state"]["safe_push_criteria"]["dependability"]["policy_digest"] == unattended_profile_digest("24h")
    assert second["release"]["state"]["promotion_history"][-1]["metadata"]["dependability_policy_digest"] == unattended_profile_digest("24h")
    assert second["report"]["kind"] == "completed"
    assert any(report.stage == "canary_verified" for report in reports)
    assert reports[-1].kind == "completed"



def test_production_loop_never_auto_chains_past_independent_recipient_approval(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_prod_autochain"
    artifact_bundle = f"artifact_release_bundle:{process_id}"
    artifact_smoke = f"artifact_smoke_report:{process_id}"

    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    shared_state = harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_2",
            goals=list(seeded["shared_state"].goals),
            active_plan_node_ids=list(seeded["shared_state"].active_plan_node_ids),
            runtime_constraints=dict(seeded["shared_state"].runtime_constraints),
            world_state={**dict(seeded["shared_state"].world_state), "release_stage": "build_verified"},
            belief_refs=list(seeded["shared_state"].belief_refs),
            open_questions=[],
            agent_ownership=dict(seeded["shared_state"].agent_ownership),
            metadata=dict(seeded["shared_state"].metadata),
        ),
        expected_revision_id="rev_1",
        actor="builder",
        provenance={"phase": "release_seed"},
    )
    harness.journal.append(
        process_id=process_id,
        kind="artifact_written",
        revision_id=shared_state.revision_id,
        actor="builder",
        payload={"artifact_id": artifact_bundle},
    )
    harness.journal.append(
        process_id=process_id,
        kind="artifact_written",
        revision_id=shared_state.revision_id,
        actor="verifier",
        payload={"artifact_id": artifact_smoke},
    )
    snapshot = harness._checkpoint_from_journal(
        process_id=process_id,
        metadata={"release_stage": "build_verified"},
        world_state_overrides={"release_stage": "build_verified", "verification": "passed"},
    )

    release_state = ReleaseWorkflowState(
        process_id=process_id,
        candidate_ref="build:auto-chain-prod",
        target_environment="production",
        revision_id=shared_state.revision_id,
        current_stage="build_verified",
        status="preparing",
    )
    release_state = record_release_fencepost(
        release_state,
        capture_release_rollback_fencepost(snapshot=snapshot, shared_state=shared_state, stage="build_verified"),
    )
    release_state = _with_artifact_receipts(release_state, harness.release_store, artifact_bundle, artifact_smoke)
    harness.release_store.save(release_state, actor="builder", provenance={"phase": "build_verified"})

    loop_store = ProductionBuildLoopStore(tmp_path / "loop_store")
    contract = _contract(
        process_id,
        completion_criteria=[
            ProductionCompletionCriterion(criterion_id="bundle", summary="Release bundle must exist", kind="artifact_present", artifact_id=artifact_bundle),
            ProductionCompletionCriterion(criterion_id="smoke", summary="Smoke report must exist", kind="artifact_present", artifact_id=artifact_smoke),
            ProductionCompletionCriterion(criterion_id="release", summary="Release must reach production", kind="release_stage", stage="production"),
        ],
        stage_gates=[
            ProductionStageGate(stage="canary_verified", required_fencepost_stages=["build_verified"], required_artifacts=[artifact_bundle], require_dependability=False),
            ProductionStageGate(stage="production", required_fencepost_stages=["build_verified", "canary_verified"], required_artifacts=[artifact_bundle, artifact_smoke], require_dependability=False),
        ],
    ).model_copy(update={"execution_budget": ProductionPassBudget(max_auto_chain_passes=3, max_stage_advances_per_pass=1)})

    result = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-auto-chain",
    )

    persisted = loop_store.load_state(process_id)
    reports = loop_store.reports(process_id)

    assert result["state"]["status"] == "active"
    assert result["state"]["current_stage"] == "build_verified"
    assert result["chained_passes"] == 1
    assert result["continuation"]["mode"] == "await_external_progress"
    assert result["next_action"]["kind"] == "await_release_approval"
    assert persisted is not None
    assert persisted.last_pass["budget"]["max_stage_advances_per_pass"] == 1
    assert persisted.next_action["kind"] != "completed"
    assert any(row.delivery_status == "queued" and row.to_agent == "release-verifier" for row in harness.mailbox.list(process_id=process_id))
    assert reports
    assert all("validation=" in report.summary or report.kind != "checkpoint" for report in reports)
    assert reports[-1].metadata["execution_discipline"]["latest_decisions"]["status"] == "active"



def test_production_loop_persists_live_follow_up_and_emits_watchdog_review_reports(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_prod_watchdog_review"
    artifact_bundle = f"artifact_release_bundle:{process_id}"

    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    shared_state = harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_2",
            goals=list(seeded["shared_state"].goals),
            active_plan_node_ids=list(seeded["shared_state"].active_plan_node_ids),
            runtime_constraints=dict(seeded["shared_state"].runtime_constraints),
            world_state={**dict(seeded["shared_state"].world_state), "release_stage": "build_verified"},
            belief_refs=list(seeded["shared_state"].belief_refs),
            open_questions=[],
            agent_ownership=dict(seeded["shared_state"].agent_ownership),
            metadata=dict(seeded["shared_state"].metadata),
        ),
        expected_revision_id="rev_1",
        actor="builder",
        provenance={"phase": "release_seed"},
    )
    harness.journal.append(
        process_id=process_id,
        kind="artifact_written",
        revision_id=shared_state.revision_id,
        actor="builder",
        payload={"artifact_id": artifact_bundle},
    )
    snapshot = harness._checkpoint_from_journal(
        process_id=process_id,
        metadata={"release_stage": "build_verified"},
        world_state_overrides={"release_stage": "build_verified"},
    )
    release_state = ReleaseWorkflowState(
        process_id=process_id,
        candidate_ref="build:watchdog-prod",
        target_environment="production",
        revision_id=shared_state.revision_id,
        current_stage="build_verified",
        status="preparing",
    )
    release_state = record_release_fencepost(
        release_state,
        capture_release_rollback_fencepost(snapshot=snapshot, shared_state=shared_state, stage="build_verified"),
    )
    harness.release_store.save(release_state, actor="builder", provenance={"phase": "build_verified"})

    loop_store = ProductionBuildLoopStore(tmp_path / "loop_store")
    contract = _contract(
        process_id,
        completion_criteria=[
            ProductionCompletionCriterion(criterion_id="bundle", summary="Release bundle must exist", kind="artifact_present", artifact_id=artifact_bundle),
            ProductionCompletionCriterion(criterion_id="release", summary="Release must reach production", kind="release_stage", stage="production"),
        ],
        stage_gates=[
            ProductionStageGate(stage="canary_verified", required_fencepost_stages=["build_verified"], required_artifacts=[artifact_bundle], require_dependability=False),
            ProductionStageGate(stage="production", required_fencepost_stages=["build_verified", "canary_verified"], required_artifacts=[artifact_bundle, f"artifact_smoke_report:{process_id}"], require_dependability=False),
        ],
    ).model_copy(
        update={
            "checkpoint_policy": ProductionCheckpointPolicy(
                report_every_iterations=10,
                live_review_seconds=60,
                proactive_report_seconds=120,
                blocker_followup_seconds=60,
            )
        }
    )

    first_now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    first = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-watchdog-prod-1",
        now=first_now,
    )

    persisted = loop_store.load_state(process_id)
    assert first["state"]["status"] == "active"
    assert persisted is not None
    assert persisted.liveness == "live"
    assert persisted.terminal_state is None
    assert persisted.last_progress_at is not None
    assert persisted.next_review_at is not None
    assert persisted.owed_follow_up["owed"] is True
    assert persisted.reporting_cadence["review_interval_seconds"] in {0, 60}
    controller_lease = next(
        row
        for row in harness.supervisor.list(process_id=process_id, status="active")
        if row.scope == f"{contract.controller_scope}:{process_id}"
    )
    controller_lease_expires_at = datetime.fromisoformat(controller_lease.expires_at.replace("Z", "+00:00"))
    harness._reclaim_stale_at(process_id, controller_lease_expires_at + timedelta(seconds=1))

    second = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="runtime-watchdog",
        controller_session_id="sess-watchdog-prod-2",
        # A watchdog may take over only after the active controller lease has
        # expired; ownership hardening deliberately rejects an earlier pass.
        now=controller_lease_expires_at + timedelta(seconds=1),
        watchdog_context={"decision": "report_status", "classification": "expected_wait", "source": "test"},
    )

    reviewed = loop_store.load_state(process_id)
    reports = loop_store.reports(process_id)
    assert second["report"] is not None
    assert reviewed is not None
    assert reviewed.last_watchdog_decision["decision"] == "report_status"
    assert reviewed.last_report_at == second["report"]["recorded_at"]
    assert any(reason in second["report"]["metadata"]["reasons"] for reason in ["review_due", "status_followup_due", "stage_change", "idle_recovery"])
    assert "status_followup_due" in second["report"]["metadata"]["reasons"]
    assert reports[-1].metadata["reporting_cadence"]["review_interval_seconds"] in {0, 60}
    assert reports[-1].metadata["owed_follow_up"]["owed"] is True



def test_production_loop_recovers_stale_controller_and_resumes_worker(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_takeover"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")

    loop_store = ProductionBuildLoopStore(tmp_path / "loop_store")
    contract = _contract(
        process_id,
        completion_criteria=[
            ProductionCompletionCriterion(
                criterion_id="still-building",
                summary="Work should stay active until final artifact exists",
                kind="artifact_present",
                artifact_id="artifact_final_release",
            )
        ],
        promotion_stages=[],
    )

    old_lease = harness.supervisor.assign(
        process_id=process_id,
        scope=f"{contract.controller_scope}:{process_id}",
        agent_id="controller",
        lease_seconds=1,
        metadata={"session_id": "sess-old", "contract_id": contract.contract_id},
    )
    loop_store.save_state(
        ProductionBuildLoopState(
            contract_id=contract.contract_id,
            process_id=process_id,
            controller=BuildLoopControllerOwner(
                controller_id="controller",
                session_id="sess-old",
                lease_id=old_lease.lease_id,
                claimed_at=old_lease.assigned_at,
                heartbeat_at=old_lease.heartbeat_at,
            ),
        )
    )
    harness._reclaim_stale_at(process_id, datetime.now(timezone.utc) + timedelta(seconds=5))

    result = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-new",
        now=datetime.now(timezone.utc) + timedelta(seconds=5),
    )

    snapshot = harness.snapshot_store.load(process_id)

    assert result["state"]["status"] == "active"
    assert result["state"]["recovery_count"] == 1
    assert result["state"]["controller"]["session_id"] == "sess-new"
    assert snapshot.lifecycle_state == "running"
    assert any(action["action"] == "resume_process" for action in result["actions_taken"])



def test_production_loop_stops_only_for_true_human_blockers(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_blocked"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_2",
            goals=list(seeded["shared_state"].goals),
            active_plan_node_ids=list(seeded["shared_state"].active_plan_node_ids),
            open_decisions=[
                OpenDecision(
                    decision_id="dec_prod_secret",
                    title="Approve production secret",
                    owner="human",
                    metadata={"blocking": True},
                )
            ],
            runtime_constraints=dict(seeded["shared_state"].runtime_constraints),
            world_state=dict(seeded["shared_state"].world_state),
            belief_refs=list(seeded["shared_state"].belief_refs),
            open_questions=[],
            agent_ownership=dict(seeded["shared_state"].agent_ownership),
            metadata=dict(seeded["shared_state"].metadata),
        ),
        expected_revision_id="rev_1",
        actor="builder",
        provenance={"phase": "human_blocker"},
    )

    loop_store = ProductionBuildLoopStore(tmp_path / "loop_store")
    contract = _contract(
        process_id,
        completion_criteria=[
            ProductionCompletionCriterion(
                criterion_id="final-release",
                summary="Final release artifact must exist",
                kind="artifact_present",
                artifact_id="artifact_final_release",
            )
        ],
        promotion_stages=[],
    )
    result = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-blocked",
    )

    reports = loop_store.reports(process_id)

    assert result["state"]["status"] == "blocked"
    assert any(blocker["source"] == "open_decision" for blocker in result["blockers"])
    assert reports[-1].kind == "blocked"
    assert reports[-1].metadata["execution_discipline"]["blocker_policy"]["true_blocker_count"] == 1



def test_production_loop_continues_through_non_human_questions_with_focused_validation(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_nonhuman_blocker"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_2",
            goals=list(seeded["shared_state"].goals),
            active_plan_node_ids=list(seeded["shared_state"].active_plan_node_ids),
            runtime_constraints=dict(seeded["shared_state"].runtime_constraints),
            world_state=dict(seeded["shared_state"].world_state),
            belief_refs=list(seeded["shared_state"].belief_refs),
            open_questions=["BLOCKER: transient cache mismatch on retryable CI lane"],
            agent_ownership=dict(seeded["shared_state"].agent_ownership),
            metadata=dict(seeded["shared_state"].metadata),
        ),
        expected_revision_id="rev_1",
        actor="builder",
        provenance={"phase": "retryable_blocker"},
    )

    loop_store = ProductionBuildLoopStore(tmp_path / "loop_store")
    contract = _contract(
        process_id,
        completion_criteria=[
            ProductionCompletionCriterion(
                criterion_id="final-release",
                summary="Final release artifact must exist",
                kind="artifact_present",
                artifact_id="artifact_final_release",
            )
        ],
        promotion_stages=[],
    )

    result = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-nonhuman",
    )

    reports = loop_store.reports(process_id)

    assert result["state"]["status"] == "active"
    assert result["blockers"] == []
    assert result["state"]["metadata"]["validation_policy"]["scope"] == "focused"
    assert "bounded_pass_focused_validation" in result["state"]["last_pass"]["validation_reasons"]
    assert reports[-1].kind in {"checkpoint", "recovery"}
    assert reports[-1].metadata["execution_discipline"]["latest_decisions"]["status"] == "active"
    assert "validation=focused" in reports[-1].summary



def test_production_loop_repairs_runtime_failures_without_declaring_blocked(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_repairable"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    revision_id = seeded["shared_state"].revision_id

    stale_message = harness.mailbox.send(
        process_id=process_id,
        from_agent="coordinator",
        to_agent="builder",
        kind="handoff",
        revision_id="rev_old",
        payload={"objective": "stale handoff"},
    )
    harness.mailbox.receive(
        to_agent="builder",
        process_id=process_id,
        expected_revision_id=revision_id,
        reject_stale_revision=True,
    )
    assert stale_message.message_id in {row.message_id for row in harness.mailbox.list(process_id=process_id, delivery_statuses=["dead_letter"]) }

    harness.supervisor.assign(process_id=process_id, scope="verify", agent_id="verifier", lease_seconds=1)
    snapshot = harness.snapshot_store.load(process_id)
    snapshot.event_count = 0
    harness.snapshot_store.save(snapshot)
    harness.journal.append(
        process_id=process_id,
        kind="world_state_updated",
        revision_id=revision_id,
        actor="fault-injector",
        payload={"world_state": {"status": "drifted"}},
    )

    loop_store = ProductionBuildLoopStore(tmp_path / "loop_store")
    revision_history_before_repair = len(harness.shared_state_store.history(process_id))
    contract = _contract(
        process_id,
        completion_criteria=[
            ProductionCompletionCriterion(
                criterion_id="final-release",
                summary="Final release artifact must exist",
                kind="artifact_present",
                artifact_id="artifact_final_release",
            )
        ],
        promotion_stages=[],
    )
    harness._reclaim_stale_at(process_id, datetime.now(timezone.utc) + timedelta(seconds=10))

    result = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-repair",
        now=datetime.now(timezone.utc) + timedelta(seconds=10),
    )

    assert result["state"]["status"] == "active"
    assert result["blockers"] == []
    assert result["dependability"]["before"]["success"] is False
    assert result["dependability"]["after"]["success"] is False
    assert any(
        action.get("action") == "recover_dead_letters" and action.get("recipient_ack_required") is True
        for action in result["dependability"]["actions_taken"]
    )
    assert any(action["action"] == "recover_dead_letters" for action in result["actions_taken"])
    assert any(action["action"] == "stale_leases_require_fenced_takeover" for action in result["actions_taken"])
    assert any(row.scope == "verify" for row in harness.supervisor.list(process_id=process_id, status="stale"))
    assert not any(row.scope == "verify" for row in harness.supervisor.list(process_id=process_id, status="active"))
    assert any(action["action"] == "checkpoint_from_journal" for action in result["actions_taken"])
    assert len(harness.shared_state_store.history(process_id)) == revision_history_before_repair
    assert not any(action.get("action") == "refresh_shared_state_revision" for action in result["actions_taken"])


def test_production_loop_waits_for_recipient_handoff_evidence_before_promotion(tmp_path, monkeypatch):
    monkeypatch.setenv("CORTEX_RELEASE_VERIFIER_CREDENTIALS", json.dumps({VERIFIER_ID: VERIFIER_SECRET}))
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_release_handoff_loop"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    snapshot = seeded["snapshot"]
    shared_state = seeded["shared_state"]
    shared_state = _prime_genuine_dependability_observations(harness, shared_state)

    release_state = ReleaseWorkflowState(
        process_id=process_id,
        candidate_ref="build:auto-handoff",
        target_environment="production",
        revision_id=shared_state.revision_id,
        current_stage="build_verified",
        status="preparing",
    )
    release_state = record_release_fencepost(
        release_state,
        capture_release_rollback_fencepost(snapshot=snapshot, shared_state=shared_state, stage="build_verified"),
    )
    release_state = _with_artifact_receipts(
        release_state,
        harness.release_store,
        f"artifact_release_bundle:{process_id}",
        f"artifact_smoke_report:{process_id}",
    )
    harness.release_store.save(release_state, actor="builder", provenance={"phase": "seed_release"})

    loop_store = ProductionBuildLoopStore(tmp_path / "loop_store")
    contract = _contract(
        process_id,
        completion_criteria=[
            ProductionCompletionCriterion(
                criterion_id="release",
                summary="Release must reach production",
                kind="release_stage",
                stage="production",
            )
        ],
        promotion_stages=["build_verified", "canary_verified", "production"],
        stage_gates=[
            ProductionStageGate(
                stage="production",
                required_fencepost_stages=["build_verified"],
                required_handoff_count=1,
                metadata={
                    "handoff": {
                        "from_agent": "controller",
                        "to_agent": "release-manager",
                        "dedupe_key": "configured-release-handoff",
                        "scope": "release:promote",
                        "objective": "Promote the verified release to production",
                        "expected_output": "Ack that production promotion is safe",
                    }
                },
            )
        ],
    )

    campaign_start = datetime.now(timezone.utc) - timedelta(hours=24)
    campaign_clock = [campaign_start]
    monkeypatch.setattr(production_build_loop, "_dependability_server_now", lambda: campaign_clock[0])
    result = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-release",
        now=campaign_start,
    )

    pending_release = harness.release_store.load(process_id)
    messages = harness.mailbox.list(process_id=process_id)
    leases = harness.supervisor.list(process_id=process_id)

    assert result["state"]["status"] == "active"
    assert pending_release.current_stage == "build_verified"
    assert any(action["action"] == "dispatch_release_handoff" for action in result["actions_taken"])
    assert not any(action["action"] == "ack_release_handoff" for action in result["actions_taken"])
    assert not any(fencepost.stage == "production" for fencepost in pending_release.rollback_fenceposts)
    assert any(message.to_agent == "release-verifier" and message.delivery_status == "queued" for message in messages)
    verifier_message = next(message for message in messages if message.to_agent == "release-verifier")
    assert verifier_message.dedupe_key != "configured-release-handoff"
    assert process_id in verifier_message.dedupe_key
    assert shared_state.revision_id in verifier_message.dedupe_key
    assert any(lease.scope == "release:canary_verified" and lease.agent_id == "release-verifier" for lease in leases)

    _approve_pending_release_handoff(harness, process_id, "canary_verified")

    for cycle in range(1, 6):
        campaign_clock[0] = campaign_start + timedelta(hours=4 * cycle)
        observed = reconcile_production_build_loop(
            contract,
            loop_store=loop_store,
            snapshot_store=harness.snapshot_store,
            shared_state_store=harness.shared_state_store,
            journal=harness.journal,
            mailbox=harness.mailbox,
            supervisor=harness.supervisor,
            release_store=harness.release_store,
            controller_id="controller",
            controller_session_id="sess-release",
            now=campaign_start + timedelta(hours=4 * cycle),
        )
        assert observed["state"]["current_stage"] == "build_verified"
    campaign_clock[0] = campaign_start + timedelta(hours=24)
    awaiting_production = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-release",
        now=campaign_start + timedelta(hours=24),
    )
    canary_release = harness.release_store.load(process_id)
    assert awaiting_production["state"]["status"] == "active"
    assert canary_release.current_stage == "canary_verified"
    assert any(
        message.to_agent == "release-manager" and message.delivery_status == "queued"
        for message in harness.mailbox.list(process_id=process_id)
    )
    manager_message = next(
        message
        for message in harness.mailbox.list(process_id=process_id)
        if message.to_agent == "release-manager" and message.delivery_status == "queued"
    )
    assert manager_message.dedupe_key != "configured-release-handoff"
    assert shared_state.revision_id in manager_message.dedupe_key

    _approve_pending_release_handoff(harness, process_id, "production")

    completed = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-release",
    )
    final_release = harness.release_store.load(process_id)

    assert completed["state"]["status"] == "completed"
    assert final_release.current_stage == "production"
    assert any(fencepost.stage == "production" for fencepost in final_release.rollback_fenceposts)


def test_production_loop_keeps_non_human_rule_blockers_live_when_recovery_is_still_possible(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_prod_nonhuman_live"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_2",
            goals=list(seeded["shared_state"].goals),
            active_plan_node_ids=list(seeded["shared_state"].active_plan_node_ids),
            runtime_constraints=dict(seeded["shared_state"].runtime_constraints),
            world_state=dict(seeded["shared_state"].world_state),
            belief_refs=list(seeded["shared_state"].belief_refs),
            open_questions=["RETRYABLE: wait for CI control plane to recover"],
            agent_ownership=dict(seeded["shared_state"].agent_ownership),
            metadata=dict(seeded["shared_state"].metadata),
        ),
        expected_revision_id="rev_1",
        actor="builder",
        provenance={"phase": "retryable_rule_blocker"},
    )

    loop_store = ProductionBuildLoopStore(tmp_path / "loop_store")
    contract = ProductionBuildContract(
        process_id=process_id,
        objective="Keep shipping until a human is truly needed",
        dependability_profile="24h",
        metadata={"owner": "cortex", "session_key": "session:delivery:followthrough", "channel": "whatsapp"},
        promotion_stages=[],
        completion_criteria=[
            ProductionCompletionCriterion(
                criterion_id="final-release",
                summary="Final release artifact must exist",
                kind="artifact_present",
                artifact_id="artifact_final_release",
            )
        ],
        blocker_rules=[
            {
                "blocker_id": "retryable-ci",
                "summary": "Retryable CI instability should stay owned by the runtime",
                "source": "open_question_prefix",
                "question_prefix": "RETRYABLE:",
                "requires_human": False,
                "terminal": False,
            }
        ],
    )

    result = reconcile_production_build_loop(
        contract,
        loop_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-prod-nonhuman-live",
    )

    assert result["state"]["status"] == "active"
    assert result["next_action"]["kind"] in {"await_worker_progress", "await_non_human_recovery"}
    assert result["continuation"]["mode"] in {"await_worker_progress", "await_external_progress"}
    assert result["blockers"] == []
    assert result["state"]["follow_through"]["resume_on_next_tick"] is True
    assert result["state"]["follow_through"]["pending_update_intent"]["kind"] == "status"
    assert result["state"]["conversation_ownership"]["owner"] == "cortex"
    assert result["state"]["conversation_ownership"]["session_key"] == "session:delivery:followthrough"


def test_production_reconciliation_rejects_non_owner_before_state_mutation(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_non_owner_reconcile"
    seeded = harness._seed_waiting_process(
        process_id=process_id,
        revision_id="rev_1",
        node_id="build",
        agent_id="builder",
    )
    release_state = harness.release_store.save(
        ReleaseWorkflowState(
            process_id=process_id,
            candidate_ref="build:owned",
            target_environment="production",
            revision_id=seeded["shared_state"].revision_id,
            current_stage="build_verified",
        ),
        actor="builder",
    )
    contract = _contract(
        process_id,
        promotion_stages=["build_verified", "canary_verified", "production"],
    )
    harness.supervisor.assign(
        process_id=process_id,
        scope=f"{contract.controller_scope}:{process_id}",
        agent_id="owner-controller",
        lease_seconds=contract.controller_lease_seconds,
        metadata={"session_id": "owner-session", "contract_id": contract.contract_id},
    )
    loop_store = ProductionBuildLoopStore(tmp_path / "loop_store")
    history_count = len(harness.release_store.history(process_id))

    with pytest.raises(PermissionError, match="already owned"):
        reconcile_production_build_loop(
            contract,
            loop_store=loop_store,
            snapshot_store=harness.snapshot_store,
            shared_state_store=harness.shared_state_store,
            journal=harness.journal,
            mailbox=harness.mailbox,
            supervisor=harness.supervisor,
            release_store=harness.release_store,
            controller_id="other-controller",
            controller_session_id="other-session",
        )

    persisted_release = harness.release_store.load(process_id)
    assert persisted_release.persistence_revision == release_state.persistence_revision
    assert len(harness.release_store.history(process_id)) == history_count
    assert loop_store.load_contract(process_id) is None
    assert loop_store.load_state(process_id) is None


@pytest.mark.parametrize("failure_at", [1, 2, 3, 4])
def test_loop_state_projection_survives_each_fsync_boundary(tmp_path, monkeypatch, failure_at):
    process_id = f"proc_loop_fsync_{failure_at}"
    store = ProductionBuildLoopStore(tmp_path / "loop_store")
    initial = ProductionBuildLoopState(
        contract_id="contract-fsync",
        process_id=process_id,
        iteration_count=1,
    )
    initial = store.save_state(initial)
    desired = ProductionBuildLoopState(
        loop_id=initial.loop_id,
        contract_id="contract-fsync",
        process_id=process_id,
        persistence_revision=initial.persistence_revision,
        iteration_count=2,
    )
    original_fsync = production_build_loop.os.fsync
    calls = {"count": 0}

    def fail_boundary(fd):
        calls["count"] += 1
        if calls["count"] == failure_at:
            raise OSError(f"simulated crash boundary {failure_at}")
        return original_fsync(fd)

    monkeypatch.setattr(production_build_loop.os, "fsync", fail_boundary)
    with pytest.raises(OSError, match="simulated crash boundary"):
        store.save_state(desired)

    recovered = ProductionBuildLoopStore(tmp_path / "loop_store").load_state(process_id)
    assert recovered is not None
    assert recovered.iteration_count in {1, 2}

    monkeypatch.setattr(production_build_loop.os, "fsync", original_fsync)
    if recovered.iteration_count == 1:
        desired.persistence_revision = recovered.persistence_revision
        store.save_state(desired)
    assert ProductionBuildLoopStore(tmp_path / "loop_store").load_state(process_id).iteration_count == 2


def test_loop_state_projection_preserves_previous_file_when_replace_does_not_commit(tmp_path, monkeypatch):
    process_id = "proc_loop_replace_crash"
    store = ProductionBuildLoopStore(tmp_path / "loop_store")
    initial = store.save_state(
        ProductionBuildLoopState(
            contract_id="contract-replace",
            process_id=process_id,
            iteration_count=1,
        )
    )

    def fail_replace(source, target):
        raise OSError("simulated crash before replace")

    monkeypatch.setattr(production_build_loop.os, "replace", fail_replace)
    with pytest.raises(OSError, match="before replace"):
        store.save_state(
            ProductionBuildLoopState(
                loop_id=initial.loop_id,
                contract_id="contract-replace",
                process_id=process_id,
                persistence_revision=initial.persistence_revision,
                iteration_count=2,
            )
        )

    assert ProductionBuildLoopStore(tmp_path / "loop_store").load_state(process_id).iteration_count == 1
    assert list(store._state_target(process_id).parent.glob(f".{process_id}.json.*.tmp")) == []


def test_loop_state_rejects_stale_whole_record_follow_up_write(tmp_path):
    store = ProductionBuildLoopStore(tmp_path / "loop_store")
    current = store.save_state(
        ProductionBuildLoopState(
            contract_id="contract-follow-up-cas",
            process_id="proc_follow_up_cas",
            status="active",
        )
    )
    stale_follow_up = current.model_copy(deep=True)
    rollback_projection = current.model_copy(
        update={"status": "blocked", "metadata": {"last_rollback_transaction_id": "rollback-1"}}
    )
    committed = store.save_state(rollback_projection)

    stale_follow_up.status = "completed"
    with pytest.raises(RuntimeError, match="persistence revision conflict"):
        store.save_state(stale_follow_up)
    reloaded = store.load_state("proc_follow_up_cas")
    assert reloaded.persistence_revision == committed.persistence_revision
    assert reloaded.status == "blocked"
    assert reloaded.metadata["last_rollback_transaction_id"] == "rollback-1"


@pytest.mark.parametrize(
    ("boundary", "fsync_failure_at"),
    [
        ("state_file_fsync", 1),
        ("state_replace", None),
        ("state_directory_fsync", 2),
        ("history_file_fsync", 3),
        ("history_directory_fsync", 4),
    ],
)
def test_loop_state_remains_recoverable_after_process_termination_at_write_boundaries(
    tmp_path,
    boundary,
    fsync_failure_at,
):
    process_id = f"proc_loop_termination_{boundary}"
    root = tmp_path / "loop_store"
    store = ProductionBuildLoopStore(root)
    initial = store.save_state(
        ProductionBuildLoopState(
            contract_id="contract-termination",
            process_id=process_id,
            iteration_count=1,
        )
    )

    def crash_during_save():
        child_store = ProductionBuildLoopStore(root)
        if fsync_failure_at is not None:
            original_fsync = production_build_loop.os.fsync
            calls = {"count": 0}

            def terminate_on_fsync(fd):
                calls["count"] += 1
                if calls["count"] == fsync_failure_at:
                    production_build_loop.os._exit(91)
                return original_fsync(fd)

            production_build_loop.os.fsync = terminate_on_fsync
        else:
            production_build_loop.os.replace = lambda source, target: production_build_loop.os._exit(91)
        child_store.save_state(
            ProductionBuildLoopState(
                loop_id=initial.loop_id,
                contract_id="contract-termination",
                process_id=process_id,
                persistence_revision=initial.persistence_revision,
                iteration_count=2,
            )
        )

    process = multiprocessing.get_context("fork").Process(target=crash_during_save)
    process.start()
    process.join(timeout=10)
    if process.is_alive():
        process.terminate()
        process.join(timeout=5)
        pytest.fail(f"child did not terminate at {boundary}")
    assert process.exitcode == 91

    recovered = ProductionBuildLoopStore(root).load_state(process_id)
    assert recovered is not None
    assert recovered.iteration_count in {1, 2}


@pytest.mark.parametrize("fsync_failure_at", [1, 2])
def test_loop_reports_remain_framed_after_process_termination_at_fsync_boundaries(
    tmp_path,
    fsync_failure_at,
):
    process_id = f"proc_report_termination_{fsync_failure_at}"
    root = tmp_path / "loop_store"
    store = ProductionBuildLoopStore(root)
    first = ProductionBuildLoopReport(
        report_id="report-initial",
        loop_id="loop-report-termination",
        contract_id="contract-report-termination",
        process_id=process_id,
        iteration=1,
        kind="checkpoint",
        status="active",
        summary="initial report",
    )
    store.append_report(first)

    def crash_during_append():
        original_fsync = production_build_loop.os.fsync
        calls = {"count": 0}

        def terminate_on_fsync(fd):
            calls["count"] += 1
            if calls["count"] == fsync_failure_at:
                production_build_loop.os._exit(92)
            return original_fsync(fd)

        production_build_loop.os.fsync = terminate_on_fsync
        ProductionBuildLoopStore(root).append_report(
            ProductionBuildLoopReport(
                report_id="report-interrupted",
                loop_id=first.loop_id,
                contract_id=first.contract_id,
                process_id=process_id,
                iteration=2,
                kind="rollback",
                status="active",
                summary="interrupted report",
            )
        )

    process = multiprocessing.get_context("fork").Process(target=crash_during_append)
    process.start()
    process.join(timeout=10)
    if process.is_alive():
        process.terminate()
        process.join(timeout=5)
        pytest.fail("child did not terminate during report append")
    assert process.exitcode == 92

    recovered = ProductionBuildLoopStore(root)
    report_ids = [row.report_id for row in recovered.reports(process_id)]
    assert report_ids in [["report-initial"], ["report-initial", "report-interrupted"]]
    recovered.append_report(
        ProductionBuildLoopReport(
            report_id="report-after-restart",
            loop_id=first.loop_id,
            contract_id=first.contract_id,
            process_id=process_id,
            iteration=3,
            kind="rollback",
            status="active",
            summary="report after restart",
        )
    )
    assert recovered.reports(process_id)[-1].report_id == "report-after-restart"


def test_loop_projection_recovers_torn_state_and_report_tail(tmp_path):
    process_id = "proc_loop_torn_projection"
    store = ProductionBuildLoopStore(tmp_path / "loop_store")
    state = store.save_state(
        ProductionBuildLoopState(
            contract_id="contract-torn",
            process_id=process_id,
            iteration_count=7,
        )
    )
    first_report = store.append_report(
        ProductionBuildLoopReport(
            report_id="report-before-crash",
            loop_id=state.loop_id,
            contract_id=state.contract_id,
            process_id=process_id,
            iteration=7,
            kind="checkpoint",
            status="active",
            summary="checkpoint before crash",
        )
    )

    store._state_target(process_id).write_bytes(b'{"iteration_count":')
    with store._history_target(process_id).open("ab") as handle:
        handle.write(b'{"state":')
    with store._report_target(process_id).open("ab") as handle:
        handle.write(b'{"report_id":"torn')

    reopened = ProductionBuildLoopStore(tmp_path / "loop_store")
    recovered_state = reopened.load_state(process_id)
    recovered_reports = reopened.reports(process_id)
    assert recovered_state.iteration_count == 7
    assert [row.report_id for row in recovered_reports] == [first_report.report_id]

    reopened.append_report(
        ProductionBuildLoopReport(
            report_id="report-after-recovery",
            loop_id=state.loop_id,
            contract_id=state.contract_id,
            process_id=process_id,
            iteration=8,
            kind="rollback",
            status="active",
            summary="rollback projection recovered",
        )
    )
    assert [row.report_id for row in reopened.reports(process_id)] == [
        "report-before-crash",
        "report-after-recovery",
    ]
