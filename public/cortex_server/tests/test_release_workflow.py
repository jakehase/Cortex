from __future__ import annotations

import asyncio
import os
import stat
from datetime import timedelta
from pathlib import Path

import pytest

import cortex_server.runtime.durable_files as durable_files
from cortex_server.runtime import (
    ReleaseWorkflowState,
    ReleaseWorkflowStore,
    RuntimeSoakHarness,
    advance_release_workflow,
    apply_release_rollback_restore,
    capture_release_rollback_fencepost,
    compile_release_handoff,
    evaluate_release_promotion_gate,
    record_release_fencepost,
    record_release_artifact_receipt,
    record_release_handoff,
    repair_release_workflow,
    rollback_release_workflow,
    normalize_session_event,
)
from cortex_server.runtime.session_registry import SessionRegistryStore
from cortex_server.runtime.release_workflow import (
    MAX_RELEASE_ARTIFACT_RECEIPTS,
    MAX_RELEASE_HISTORY_BYTES,
    create_release_artifact_receipt,
    release_canary_policy,
)
from cortex_server.runtime.production_build_loop import ingest_production_release_artifact
from cortex_server.runtime.shared_process_state import SharedProcessState


VERIFIER_ID = "independent-release-verifier"
VERIFIER_SECRET = "release-workflow-test-secret"


def _directory_for_fd(fd: int) -> tuple[int, int]:
    descriptor = os.fstat(fd)
    return descriptor.st_dev, descriptor.st_ino


def _directory_identity(path: Path) -> tuple[int, int]:
    descriptor = path.stat()
    return descriptor.st_dev, descriptor.st_ino


def test_first_release_write_fsyncs_each_new_ancestor_and_linked_store_entry(
    tmp_path, monkeypatch
):
    store = ReleaseWorkflowStore(
        tmp_path / "volume" / "runtime_delivery" / "release_workflow"
    )
    real_fsync = os.fsync
    synced_directories = []

    def recording_fsync(fd):
        if stat.S_ISDIR(os.fstat(fd).st_mode):
            synced_directories.append(_directory_for_fd(fd))
        return real_fsync(fd)

    monkeypatch.setattr(durable_files.os, "fsync", recording_fsync)
    state = ReleaseWorkflowState(
        process_id="proc_first_write_durability",
        candidate_ref="build:first-write",
        target_environment="production",
        revision_id="rev_1",
    )
    store.save(state, actor="release-coordinator")

    release_root = store.path.resolve()
    history_root = (store.path / "history").resolve()
    assert [
        _directory_identity(tmp_path),
        _directory_identity(tmp_path / "volume"),
        _directory_identity(tmp_path / "volume" / "runtime_delivery"),
    ] == synced_directories[:3]
    assert _directory_identity(release_root) in synced_directories
    assert _directory_identity(history_root) in synced_directories

    artifact_store = store.artifact_store()
    artifact_ref, _content_hash = artifact_store.put(b"first publication")
    artifact_target = artifact_store._target(artifact_ref)
    assert artifact_target.exists()
    assert _directory_identity(release_root) in synced_directories
    assert _directory_identity(artifact_store.path) in synced_directories
    assert _directory_identity(artifact_target.parent) in synced_directories


@pytest.mark.parametrize("failed_directory_sync", [1, 2, 3])
def test_first_release_write_never_descends_past_an_unsynced_ancestor(
    tmp_path, monkeypatch, failed_directory_sync
):
    store = ReleaseWorkflowStore(
        tmp_path / "volume" / "runtime_delivery" / "release_workflow"
    )
    real_fsync = os.fsync
    directory_sync_count = 0

    def fail_selected_directory_sync(fd):
        nonlocal directory_sync_count
        if stat.S_ISDIR(os.fstat(fd).st_mode):
            directory_sync_count += 1
            if directory_sync_count == failed_directory_sync:
                raise OSError("injected ancestor fsync failure")
        return real_fsync(fd)

    monkeypatch.setattr(durable_files.os, "fsync", fail_selected_directory_sync)
    state = ReleaseWorkflowState(
        process_id=f"proc_sync_failure_{failed_directory_sync}",
        candidate_ref="build:must-not-ack",
        target_environment="production",
        revision_id="rev_1",
    )

    with pytest.raises(OSError, match="injected ancestor fsync failure"):
        store.save(state, actor="release-coordinator")

    assert directory_sync_count == failed_directory_sync
    assert not store._target(state.process_id).exists()


@pytest.mark.parametrize("failed_directory_sync", [1, 2])
def test_first_artifact_publication_never_acks_unsynced_store_topology(
    tmp_path, monkeypatch, failed_directory_sync
):
    release_root = tmp_path / "release_workflow"
    durable_files.durable_mkdir(release_root)
    artifact_store = ReleaseWorkflowStore(release_root).artifact_store()
    real_fsync = os.fsync
    directory_sync_count = 0

    def fail_selected_directory_sync(fd):
        nonlocal directory_sync_count
        if stat.S_ISDIR(os.fstat(fd).st_mode):
            directory_sync_count += 1
            if directory_sync_count == failed_directory_sync:
                raise OSError("injected artifact topology fsync failure")
        return real_fsync(fd)

    monkeypatch.setattr(durable_files.os, "fsync", fail_selected_directory_sync)

    with pytest.raises(OSError, match="injected artifact topology fsync failure"):
        artifact_store.put(b"must not be acknowledged")

    assert directory_sync_count == failed_directory_sync
    assert not list(artifact_store.path.glob("*/*.artifact"))


def test_event_loop_release_lock_contention_fails_fast_without_deadlock(tmp_path):
    first_store = ReleaseWorkflowStore(tmp_path / "release")
    second_store = ReleaseWorkflowStore(tmp_path / "release")

    async def exercise() -> None:
        transaction = first_store.release_transaction("proc_async_lock")
        await asyncio.to_thread(transaction.__enter__)
        try:
            with pytest.raises(RuntimeError, match="release transaction busy"):
                with second_store.release_transaction("proc_async_lock"):
                    pass
            await asyncio.sleep(0)
        finally:
            await asyncio.to_thread(transaction.__exit__, None, None, None)

    asyncio.run(asyncio.wait_for(exercise(), timeout=1.0))


def _record_canary_evidence(harness, state, *, evidence_id: str, target_stage: str):
    policy = release_canary_policy(target_stage)
    claims = {
        "policy_id": policy["policy_id"],
        "deployment_id": f"deployment:{state.process_id}:{target_stage}",
        "cohort_id": "canary-cohort",
        "traffic_volume": 1000,
        "observation_window_seconds": 900,
        "artifact_hashes": [],
        "metrics": {"availability": 1.0, "error_rate": 0.0},
        "thresholds": policy["thresholds"],
    }
    artifact_store = harness.release_store.artifact_store()
    receipt = create_release_artifact_receipt(
        state,
        artifact_store=artifact_store,
        artifact_id=evidence_id,
        payload=claims,
        artifact_kind="canary_evidence",
        target_stage=target_stage,
        claims=claims,
        producer="canary-runner",
        verifier=VERIFIER_ID,
        verifier_secret=VERIFIER_SECRET,
    )
    return record_release_artifact_receipt(
        state,
        receipt,
        artifact_store=artifact_store,
        verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
    )


def test_release_artifact_ids_are_immutable_within_revision_and_reusable_after_rollback(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    artifact_store = harness.release_store.artifact_store()
    state = ReleaseWorkflowState(
        process_id="proc_revisioned_artifacts",
        candidate_ref="build:revisioned",
        target_environment="production",
        revision_id="rev_1",
    )
    first = create_release_artifact_receipt(
        state,
        artifact_store=artifact_store,
        artifact_id="artifact_release_bundle:proc_revisioned_artifacts",
        payload={"revision": 1},
        artifact_kind="release_bundle",
        producer="builder",
        verifier=VERIFIER_ID,
        verifier_secret=VERIFIER_SECRET,
    )
    state = record_release_artifact_receipt(
        state,
        first,
        artifact_store=artifact_store,
        verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
    )
    state = state.model_copy(update={"revision_id": "rollback_server_revision"})
    replacement = create_release_artifact_receipt(
        state,
        artifact_store=artifact_store,
        artifact_id="artifact_release_bundle:proc_revisioned_artifacts",
        payload={"revision": 2},
        artifact_kind="release_bundle",
        producer="builder",
        verifier=VERIFIER_ID,
        verifier_secret=VERIFIER_SECRET,
    )
    state = record_release_artifact_receipt(
        state,
        replacement,
        artifact_store=artifact_store,
        verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
    )

    receipts = state.metadata["release_artifacts"]
    assert [row["revision_id"] for row in receipts] == ["rev_1", "rollback_server_revision"]
    assert receipts[0]["content_hash"] != receipts[1]["content_hash"]


def test_signed_canary_evidence_cannot_define_or_evade_server_thresholds(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    state = ReleaseWorkflowState(
        process_id="proc_immutable_canary_policy",
        candidate_ref="build:unsafe",
        target_environment="production",
        revision_id="rev_1",
        current_stage="canary_verified",
    )
    artifact_store = harness.release_store.artifact_store()
    policy = release_canary_policy("production")
    weak_claims = {
        "policy_id": policy["policy_id"],
        "deployment_id": "deployment:unsafe",
        "cohort_id": "one-request",
        "traffic_volume": 1,
        "observation_window_seconds": 1,
        "artifact_hashes": [],
        "metrics": {"availability": 0.0, "error_rate": 0.99},
        "thresholds": {
            "minimum_traffic": 1,
            "minimum_observation_seconds": 1,
            "minimum_availability": 0.0,
            "maximum_error_rate": 0.99,
            "rollback_error_rate": 1.0,
        },
    }
    weak_receipt = create_release_artifact_receipt(
        state,
        artifact_store=artifact_store,
        artifact_id="evidence:caller-policy",
        payload=weak_claims,
        artifact_kind="canary_evidence",
        target_stage="production",
        claims=weak_claims,
        producer="canary-runner",
        verifier=VERIFIER_ID,
        verifier_secret=VERIFIER_SECRET,
    )

    with pytest.raises(ValueError, match="does not echo the immutable server release policy"):
        record_release_artifact_receipt(
            state,
            weak_receipt,
            artifact_store=artifact_store,
            verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
        )

    unhealthy_claims = {**weak_claims, "thresholds": policy["thresholds"]}
    unhealthy_receipt = create_release_artifact_receipt(
        state,
        artifact_store=artifact_store,
        artifact_id="evidence:unhealthy",
        payload=unhealthy_claims,
        artifact_kind="canary_evidence",
        target_stage="production",
        claims=unhealthy_claims,
        producer="canary-runner",
        verifier=VERIFIER_ID,
        verifier_secret=VERIFIER_SECRET,
    )
    with pytest.raises(ValueError, match="does not satisfy the immutable server release policy"):
        record_release_artifact_receipt(
            state,
            unhealthy_receipt,
            artifact_store=artifact_store,
            verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
        )

    for artifact_id, malformed in (
        ("evidence:boolean-metrics", {**unhealthy_claims, "traffic_volume": 1000, "observation_window_seconds": 900, "metrics": {"availability": True, "error_rate": False}}),
        ("evidence:boolean-traffic", {**unhealthy_claims, "traffic_volume": True, "observation_window_seconds": 900, "metrics": {"availability": 1.0, "error_rate": 0.0}}),
    ):
        malformed_receipt = create_release_artifact_receipt(
            state,
            artifact_store=artifact_store,
            artifact_id=artifact_id,
            payload=malformed,
            artifact_kind="canary_evidence",
            target_stage="production",
            claims=malformed,
            producer="canary-runner",
            verifier=VERIFIER_ID,
            verifier_secret=VERIFIER_SECRET,
        )
        with pytest.raises(ValueError, match="strict server evidence schema"):
            record_release_artifact_receipt(
                state,
                malformed_receipt,
                artifact_store=artifact_store,
                verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
            )


def test_release_workflow_store_tracks_history_and_promotion_gate(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    seeded = harness._seed_waiting_process(process_id="proc_release_history", revision_id="rev_1", node_id="build", agent_id="builder")
    snapshot = seeded["snapshot"]
    shared_state = seeded["shared_state"]

    state = ReleaseWorkflowState(
        process_id="proc_release_history",
        workflow_id="wf_release_history",
        candidate_ref="build:abc123",
        target_environment="production",
        revision_id="rev_1",
        current_stage="build_verified",
    )
    harness.release_store.save(state, actor="release-coordinator", provenance={"phase": "seed"})

    handoff = compile_release_handoff(
        state=state,
        shared_state=shared_state,
        snapshot=snapshot,
        from_agent="builder",
        to_agent="verifier",
        objective="Verify the release candidate",
        scope="release:verify",
        expected_output="Ack readiness for canary",
    )
    message = harness.mailbox.send(
        process_id="proc_release_history",
        from_agent=handoff.from_agent,
        to_agent=handoff.to_agent,
        kind="handoff",
        handoff_id=handoff.handoff_id,
        revision_id="rev_1",
        dedupe_key="release-history-handoff",
        payload={"objective": handoff.objective},
    )
    harness.mailbox.receive(to_agent="verifier", process_id="proc_release_history", expected_revision_id="rev_1", reject_stale_revision=True)
    acked = harness.mailbox.acknowledge(
        message.message_id,
        actor="verifier",
        result_receipt={
            "candidate_ref": state.candidate_ref,
            "release_id": state.release_id,
            "revision_id": state.revision_id,
            "result": "approved",
            "evidence_receipts": ["evidence:canary-verification"],
        },
    )
    state = record_release_handoff(state, acked, stage="canary_verified")
    fencepost = capture_release_rollback_fencepost(snapshot=snapshot, shared_state=shared_state, stage="build_verified")
    state = record_release_fencepost(state, fencepost)

    unresolved_gate = evaluate_release_promotion_gate(
        state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        target_stage="canary_verified",
        mailbox_messages=harness.mailbox.list(process_id="proc_release_history"),
        dependability_report={"success": True},
        required_fencepost_stages=["build_verified"],
        required_handoff_count=1,
        artifact_store=harness.release_store.artifact_store(),
        verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
    )
    assert unresolved_gate["checks"]["handoff_receipts_ok"] is False
    assert unresolved_gate["invalid_evidence_receipt_ids"] == ["evidence:canary-verification"]

    state = _record_canary_evidence(
        harness,
        state,
        evidence_id="evidence:canary-verification",
        target_stage="canary_verified",
    )

    gate = evaluate_release_promotion_gate(
        state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        target_stage="canary_verified",
        mailbox_messages=harness.mailbox.list(process_id="proc_release_history"),
        leases=harness.supervisor.list(process_id="proc_release_history"),
        dependability_report={"success": True},
        required_fencepost_stages=["build_verified"],
        required_handoff_count=1,
        artifact_store=harness.release_store.artifact_store(),
        verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
    )
    promoted = advance_release_workflow(state, gate=gate, next_stage="canary_verified", actor="release-manager")
    stored = harness.release_store.save(promoted["state"], actor="release-manager", provenance={"phase": "promote_canary"})
    history = harness.release_store.history("proc_release_history")

    assert gate["safe_push"] is True
    assert promoted["promoted"] is True
    assert stored.current_stage == "canary_verified"
    assert len(history) == 2
    assert history[0].change_set["created"] is True
    assert history[1].change_set["current_stage"] == "canary_verified"



def test_release_workflow_rollback_uses_fencepost_restore_bundle(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    seeded = harness._seed_waiting_process(process_id="proc_release_rollback", revision_id="rev_1", node_id="build", agent_id="builder")
    snapshot = seeded["snapshot"]
    shared_state = seeded["shared_state"]

    state = ReleaseWorkflowState(
        process_id="proc_release_rollback",
        candidate_ref="build:def456",
        target_environment="production",
        revision_id="rev_1",
        current_stage="build_verified",
    )
    fencepost = capture_release_rollback_fencepost(snapshot=snapshot, shared_state=shared_state, stage="build_verified")
    state = record_release_fencepost(state, fencepost)

    gate = evaluate_release_promotion_gate(
        state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        target_stage="canary_verified",
        dependability_report={"success": True},
        required_fencepost_stages=["build_verified"],
        require_dependability=True,
    )
    promoted = advance_release_workflow(state, gate=gate, next_stage="canary_verified", actor="release-manager")
    rolled = rollback_release_workflow(promoted["state"], stage="build_verified", reason="canary_regression")

    assert rolled["rolled_back"] is True
    assert rolled["state"].current_stage == "build_verified"
    assert rolled["state"].status == "rolled_back"
    assert rolled["restore_state"]["lifecycle_state"] == "waiting"
    assert rolled["restore_state"]["shared_state_revision_id"] == "rev_1"
    assert rolled["restore_state"]["waiting_steps"] == ["build"]


def test_same_digest_receipt_flood_is_bounded_before_state_or_history_amplification(tmp_path):
    store = ReleaseWorkflowStore(tmp_path / "runtime_delivery" / "release_workflow")
    artifact_store = store.artifact_store()
    state = ReleaseWorkflowState(
        process_id="proc_receipt_quota",
        candidate_ref="build:receipt-quota",
        target_environment="production",
        revision_id="rev_receipt_quota",
    )

    for index in range(MAX_RELEASE_ARTIFACT_RECEIPTS):
        receipt = create_release_artifact_receipt(
            state,
            artifact_store=artifact_store,
            artifact_id=f"artifact-{index}",
            payload=b"x",
            artifact_kind="release_bundle",
            producer="builder",
            verifier=VERIFIER_ID,
            verifier_secret=VERIFIER_SECRET,
            claims={"index": index},
        )
        state = record_release_artifact_receipt(
            state,
            receipt,
            artifact_store=artifact_store,
            verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
        )

    assert artifact_store.storage_usage_bytes() == 1
    overflow = create_release_artifact_receipt(
        state,
        artifact_store=artifact_store,
        artifact_id="artifact-overflow",
        payload=b"x",
        artifact_kind="release_bundle",
        producer="builder",
        verifier=VERIFIER_ID,
        verifier_secret=VERIFIER_SECRET,
    )
    with pytest.raises(ValueError, match="receipt count"):
        record_release_artifact_receipt(
            state,
            overflow,
            artifact_store=artifact_store,
            verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
        )


def test_same_digest_receipt_history_uses_bounded_hash_linked_deltas(tmp_path):
    store = ReleaseWorkflowStore(tmp_path / "runtime_delivery" / "release_workflow")
    artifact_store = store.artifact_store()
    state = store.save(
        ReleaseWorkflowState(
            process_id="proc_receipt_history_delta",
            candidate_ref="build:receipt-history-delta",
            target_environment="production",
            revision_id="rev_receipt_history_delta",
        ),
        actor="release-manager",
    )

    for index in range(40):
        receipt = create_release_artifact_receipt(
            state,
            artifact_store=artifact_store,
            artifact_id=f"artifact-{index}",
            payload=b"x",
            artifact_kind="release_bundle",
            producer="builder",
            verifier=VERIFIER_ID,
            verifier_secret=VERIFIER_SECRET,
            claims={"index": index},
        )
        state = record_release_artifact_receipt(
            state,
            receipt,
            artifact_store=artifact_store,
            verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
        )
        state = store.save(
            state,
            actor=VERIFIER_ID,
            provenance={
                "scenario": "production_artifact_ingestion",
                "artifact_id": receipt.artifact_id,
                "content_hash": receipt.content_hash,
            },
        )

    history = store.history(state.process_id)
    assert history[-1].state["history_format"] == "cortex.release-history-artifact-delta.v1"
    assert history[-1].state["artifact_receipt"]["artifact_id"] == "artifact-39"
    assert len(history[-1].state["state_sha256"]) == 64
    assert store._history_target(state.process_id).stat().st_size < 2 * 1024 * 1024


def test_release_save_rejects_history_growth_at_immutable_boundary(tmp_path):
    store = ReleaseWorkflowStore(tmp_path / "runtime_delivery" / "release_workflow")
    state = ReleaseWorkflowState(
        process_id="proc_history_quota",
        candidate_ref="build:history-quota",
        target_environment="production",
        revision_id="rev_history_quota",
    )
    history_target = store._history_target(state.process_id)
    history_target.parent.mkdir(parents=True)
    with history_target.open("wb") as handle:
        handle.truncate(MAX_RELEASE_HISTORY_BYTES)

    with pytest.raises(ValueError, match="history quota"):
        store.save(state, actor="release-manager")


def test_repeated_rollback_never_selects_a_retained_forward_fencepost(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    seeded = harness._seed_waiting_process(
        process_id="proc_strictly_prior_rollback",
        revision_id="rev_1",
        node_id="build",
        agent_id="builder",
    )
    state = ReleaseWorkflowState(
        process_id="proc_strictly_prior_rollback",
        candidate_ref="build:rollback-topology",
        target_environment="production",
        revision_id="rev_1",
        current_stage="production",
    )
    for stage in ("build_verified", "canary_verified", "production"):
        state = record_release_fencepost(
            state,
            capture_release_rollback_fencepost(
                snapshot=seeded["snapshot"],
                shared_state=seeded["shared_state"],
                stage=stage,
            ),
        )

    first = rollback_release_workflow(state)
    second = rollback_release_workflow(first["state"])

    assert first["state"].current_stage == "canary_verified"
    assert [row.stage for row in first["state"].rollback_fenceposts] == ["build_verified", "canary_verified"]
    assert second["state"].current_stage == "build_verified"
    assert [row.stage for row in second["state"].rollback_fenceposts] == ["build_verified"]
    with pytest.raises(KeyError, match="prior_stage"):
        rollback_release_workflow(second["state"])


def test_stale_promotion_save_cannot_overwrite_completed_rollback(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    process_id = "proc_release_stale_promotion_after_rollback"
    seeded = harness._seed_waiting_process(
        process_id=process_id,
        revision_id="rev_1",
        node_id="build",
        agent_id="builder",
    )
    state = ReleaseWorkflowState(
        process_id=process_id,
        candidate_ref="build:stale-promotion",
        target_environment="production",
        revision_id="rev_1",
        current_stage="canary_verified",
    )
    state = record_release_fencepost(
        state,
        capture_release_rollback_fencepost(
            snapshot=seeded["snapshot"],
            shared_state=seeded["shared_state"],
            stage="build_verified",
        ),
    )
    state = harness.release_store.save(state, actor="release-manager")

    # Model a promotion paused after computing its state but before save.
    stale_promotion = advance_release_workflow(
        state,
        gate={"safe_push": True, "current_revision_id": state.revision_id},
        next_stage="production",
        actor="release-manager",
    )["state"]

    restored = apply_release_rollback_restore(
        state,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        release_store=harness.release_store,
        journal=harness.journal,
        stage="build_verified",
        actor="operator",
        reason="canary regression",
    )

    with pytest.raises(RuntimeError, match="persistence conflict"):
        harness.release_store.save(stale_promotion, actor="release-manager")

    persisted = harness.release_store.load(process_id)
    assert restored["state"].current_stage == "build_verified"
    assert persisted.current_stage == "build_verified"
    assert persisted.status == "rolled_back"
    assert persisted.persistence_revision == state.persistence_revision + 1


def test_release_gate_rejects_ack_from_obsolete_candidate_even_on_current_revision(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    seeded = harness._seed_waiting_process(process_id="proc_stale_candidate", revision_id="rev_1", node_id="build", agent_id="builder")
    state = ReleaseWorkflowState(
        process_id="proc_stale_candidate",
        candidate_ref="build:new",
        target_environment="production",
        revision_id="rev_1",
        current_stage="canary_verified",
    )
    message = harness.mailbox.send(
        process_id=state.process_id,
        from_agent="verifier",
        to_agent="release-manager",
        kind="handoff",
        revision_id="rev_1",
        payload={"objective": "promote obsolete candidate"},
        metadata={"release_id": state.release_id, "candidate_ref": "build:old", "target_stage": "production"},
    )
    harness.mailbox.receive(to_agent="release-manager", process_id=state.process_id, expected_revision_id="rev_1")
    acknowledged = harness.mailbox.acknowledge(
        message.message_id,
        actor="release-manager",
        result_receipt={
            "candidate_ref": "build:old",
            "release_id": state.release_id,
            "revision_id": "rev_1",
            "result": "approved",
            "evidence_receipts": ["evidence:obsolete"],
        },
    )
    state = record_release_handoff(state, acknowledged, stage="production")

    gate = evaluate_release_promotion_gate(
        state=state,
        snapshot=seeded["snapshot"],
        shared_state=seeded["shared_state"],
        target_stage="production",
        mailbox_messages=harness.mailbox.list(process_id=state.process_id),
        dependability_report={"success": True},
        required_handoff_count=1,
    )

    assert gate["safe_push"] is False
    assert gate["checks"]["handoff_bindings_current"] is True
    assert gate["checks"]["handoff_receipts_ok"] is False
    assert gate["counts"]["stale_handoff_record_count"] == 1


def test_release_gate_ignores_stale_handoff_history_after_current_ack(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    seeded = harness._seed_waiting_process(
        process_id="proc_handoff_history",
        revision_id="rev_1",
        node_id="build",
        agent_id="builder",
    )
    state = ReleaseWorkflowState(
        process_id="proc_handoff_history",
        candidate_ref="build:new",
        target_environment="production",
        revision_id="rev_1",
        current_stage="canary_verified",
    )
    state = _record_canary_evidence(
        harness,
        state,
        evidence_id="evidence:build:new",
        target_stage="production",
    )
    for candidate in ("build:old", "build:new"):
        message = harness.mailbox.send(
            process_id=state.process_id,
            from_agent="verifier",
            to_agent="release-manager",
            kind="handoff",
            revision_id="rev_1",
            payload={"objective": "promote candidate"},
            metadata={"release_id": state.release_id, "candidate_ref": candidate, "target_stage": "production"},
        )
        harness.mailbox.receive(
            to_agent="release-manager",
            process_id=state.process_id,
            expected_revision_id="rev_1",
        )
        state = record_release_handoff(
            state,
            harness.mailbox.acknowledge(
                message.message_id,
                actor="release-manager",
                result_receipt={
                    "candidate_ref": candidate,
                    "release_id": state.release_id,
                    "revision_id": "rev_1",
                    "result": "approved",
                    "evidence_receipts": [f"evidence:{candidate}"],
                },
            ),
            stage="production",
        )

    gate = evaluate_release_promotion_gate(
        state=state,
        snapshot=seeded["snapshot"],
        shared_state=seeded["shared_state"],
        target_stage="production",
        mailbox_messages=harness.mailbox.list(process_id=state.process_id),
        dependability_report={"success": True},
        required_handoff_count=1,
        artifact_store=harness.release_store.artifact_store(),
        verifier_credentials={VERIFIER_ID: VERIFIER_SECRET},
    )

    assert gate["safe_push"] is True
    assert gate["checks"]["handoff_receipts_ok"] is True
    assert gate["checks"]["handoff_bindings_current"] is True
    assert gate["counts"]["stale_handoff_record_count"] == 1



def test_release_repair_requeues_handoff_but_never_fabricates_missing_fenceposts(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    seeded = harness._seed_waiting_process(process_id="proc_release_repair", revision_id="rev_1", node_id="build", agent_id="builder")
    snapshot = seeded["snapshot"]
    shared_state = seeded["shared_state"]

    state = ReleaseWorkflowState(
        process_id="proc_release_repair",
        candidate_ref="build:repair",
        target_environment="production",
        revision_id="rev_1",
        current_stage="canary_verified",
    )
    build_message = harness.mailbox.send(
        process_id="proc_release_repair",
        from_agent="builder",
        to_agent="verifier",
        kind="handoff",
        revision_id="rev_1",
        dedupe_key="release-repair-build",
        payload={"objective": "verify build"},
    )
    harness.mailbox.receive(to_agent="verifier", process_id="proc_release_repair", expected_revision_id="rev_1", reject_stale_revision=True)
    build_acked = harness.mailbox.acknowledge(build_message.message_id, actor="verifier")
    state = record_release_handoff(state, build_acked, stage="build_verified")
    state = record_release_fencepost(
        state,
        capture_release_rollback_fencepost(snapshot=snapshot, shared_state=shared_state, stage="build_verified"),
    )

    shared_state = harness.shared_state_store.save(
        SharedProcessState(
            process_id="proc_release_repair",
            revision_id="rev_2",
            goals=list(shared_state.goals),
            active_plan_node_ids=[],
            runtime_constraints=dict(shared_state.runtime_constraints),
            world_state={**dict(shared_state.world_state), "release_stage": "canary_verified"},
            belief_refs=list(shared_state.belief_refs),
            open_questions=[],
            agent_ownership={},
            metadata=dict(shared_state.metadata),
        ),
        expected_revision_id="rev_1",
        actor="release-manager",
        provenance={"phase": "canary_verified"},
    )
    harness.journal.append(
        process_id="proc_release_repair",
        kind="world_state_updated",
        revision_id="rev_2",
        actor="release-manager",
        payload={"world_state": {"release_stage": "canary_verified"}},
    )
    snapshot = harness._checkpoint_from_journal(process_id="proc_release_repair", world_state_overrides={"release_stage": "canary_verified"})

    stale_message = harness.mailbox.send(
        process_id="proc_release_repair",
        from_agent="verifier",
        to_agent="release-manager",
        kind="handoff",
        revision_id="rev_1",
        dedupe_key="release-repair-promote",
        payload={"objective": "promote canary"},
    )
    harness.mailbox.receive(
        to_agent="release-manager",
        process_id="proc_release_repair",
        expected_revision_id="rev_2",
        reject_stale_revision=True,
    )
    dead_letter = next(row for row in harness.mailbox.list(process_id="proc_release_repair") if row.message_id == stale_message.message_id)
    state = record_release_handoff(state, dead_letter, stage="production")

    stale_lease = harness.supervisor.assign(process_id="proc_release_repair", scope="release_promote", agent_id="release-manager", lease_seconds=1)
    harness._reclaim_stale_at("proc_release_repair", harness.clock_fn() + timedelta(seconds=10))

    gate_before = evaluate_release_promotion_gate(
        state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        target_stage="production",
        mailbox_messages=harness.mailbox.list(process_id="proc_release_repair"),
        leases=harness.supervisor.list(process_id="proc_release_repair"),
        dependability_report={"success": True},
        required_fencepost_stages=["build_verified", "canary_verified"],
        required_handoff_count=1,
    )
    repaired = repair_release_workflow(
        state,
        snapshot=snapshot,
        shared_state=shared_state,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        gate=gate_before,
        dependability_report={"success": True},
        required_fencepost_stages=["build_verified", "canary_verified"],
        required_handoff_count=1,
    )

    action_names = [row["action"] for row in repaired["actions_taken"]]
    final_messages = harness.mailbox.list(process_id="proc_release_repair")

    assert stale_lease.lease_id is not None
    assert gate_before["safe_push"] is False
    assert gate_before["checks"]["handoff_bindings_current"] is True
    assert repaired["success"] is False
    assert repaired["gate_after"]["safe_push"] is False
    assert repaired["gate_after"]["checks"]["handoff_bindings_current"] is True
    assert repaired["gate_after"]["checks"]["handoff_receipts_ok"] is False
    assert repaired["state"].revision_id == "rev_2"
    assert "refresh_release_revision" in action_names
    assert "recover_handoff_messages" in action_names
    assert "stale_leases_require_fenced_takeover" in action_names
    assert stale_lease.lease_id in {row.lease_id for row in harness.supervisor.list(process_id="proc_release_repair", status="stale")}
    assert "missing_historical_fenceposts" in action_names
    assert "capture_missing_fenceposts" not in action_names
    assert not any(row.stage == "canary_verified" for row in repaired["state"].rollback_fenceposts)
    assert any(row.delivery_status == "queued" for row in final_messages)



def test_compile_release_handoff_surfaces_gate_blockers_and_metadata(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    seeded = harness._seed_waiting_process(process_id="proc_release_handoff", revision_id="rev_1", node_id="build", agent_id="builder")
    snapshot = seeded["snapshot"]
    shared_state = seeded["shared_state"]

    state = ReleaseWorkflowState(
        process_id="proc_release_handoff",
        candidate_ref="build:handoff",
        target_environment="production",
        revision_id="rev_1",
        current_stage="canary_verified",
    )
    gate = {
        "safe_push": False,
        "blockers": [{"summary": "missing rollback fenceposts"}],
    }

    handoff = compile_release_handoff(
        state=state,
        shared_state=shared_state,
        snapshot=snapshot,
        from_agent="verifier",
        to_agent="release-manager",
        objective="Escalate the production promotion decision",
        scope="release:promote",
        expected_output="Resolve blockers and report whether production push is safe",
        gate=gate,
        open_questions=["Which fencepost is missing?"],
    )

    assert handoff.metadata["current_stage"] == "canary_verified"
    assert handoff.metadata["target_environment"] == "production"
    assert handoff.metadata["gate_safe_push"] is False
    assert any("release stage=canary_verified" == row for row in handoff.assumptions)
    assert "missing rollback fenceposts" in handoff.open_questions


def test_apply_release_rollback_restore_rehydrates_runtime_state_and_audit_trail(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    seeded = harness._seed_waiting_process(process_id="proc_release_apply_rollback", revision_id="rev_1", node_id="build", agent_id="builder")
    snapshot = seeded["snapshot"]
    shared_state = seeded["shared_state"]

    state = ReleaseWorkflowState(
        process_id="proc_release_apply_rollback",
        candidate_ref="build:apply-rollback",
        target_environment="production",
        revision_id="rev_1",
        current_stage="build_verified",
    )
    state = record_release_fencepost(
        state,
        capture_release_rollback_fencepost(snapshot=snapshot, shared_state=shared_state, stage="build_verified"),
    )

    gate = evaluate_release_promotion_gate(
        state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        target_stage="canary_verified",
        dependability_report={"success": True},
        required_fencepost_stages=["build_verified"],
        require_dependability=True,
    )
    promoted = advance_release_workflow(state, gate=gate, next_stage="canary_verified", actor="release-manager")

    shared_state = harness.shared_state_store.save(
        SharedProcessState(
            process_id="proc_release_apply_rollback",
            revision_id="rev_2",
            goals=list(shared_state.goals),
            active_plan_node_ids=[],
            runtime_constraints=dict(shared_state.runtime_constraints),
            world_state={**dict(shared_state.world_state), "release_stage": "canary_verified"},
            belief_refs=list(shared_state.belief_refs),
            open_questions=[],
            agent_ownership={},
            metadata=dict(shared_state.metadata),
        ),
        expected_revision_id="rev_1",
        actor="release-manager",
        provenance={"phase": "canary_verified"},
    )
    harness.journal.append(
        process_id="proc_release_apply_rollback",
        kind="world_state_updated",
        revision_id="rev_2",
        actor="release-manager",
        payload={"world_state": {"release_stage": "canary_verified"}},
    )
    harness._checkpoint_from_journal(process_id="proc_release_apply_rollback", world_state_overrides={"release_stage": "canary_verified"})
    stored = harness.release_store.save(promoted["state"], actor="release-manager", provenance={"phase": "promote_canary"})

    restored = apply_release_rollback_restore(
        stored,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        release_store=harness.release_store,
        journal=harness.journal,
        stage="build_verified",
        actor="release-manager",
        reason="canary_regression",
    )

    latest_snapshot = harness.snapshot_store.load("proc_release_apply_rollback")
    latest_shared = harness.shared_state_store.load("proc_release_apply_rollback")
    latest_release = harness.release_store.load("proc_release_apply_rollback")
    latest_event = harness.journal.latest(process_id="proc_release_apply_rollback")

    assert restored["applied"] is True
    assert restored["state"].current_stage == "build_verified"
    assert restored["state"].revision_id.startswith("rollback_")
    assert restored["state"].metadata["rollback_transaction_id"]
    activation = restored["state"].metadata["rollback_activation"]
    assert activation["artifact_revision_id"] == "rev_1"
    assert activation["control_revision_id"] == restored["state"].revision_id
    assert activation["fencepost_id"] == restored["fencepost"]["fencepost_id"]
    assert latest_release.metadata["rollback_applied"] is True
    assert latest_snapshot.lifecycle_state == "waiting"
    assert latest_snapshot.metadata["rollback_fencepost_id"] == restored["fencepost"]["fencepost_id"]
    assert latest_shared.revision_id == restored["state"].revision_id
    assert latest_event.kind == "release_rolled_back"

    # Dependability reconciliation checkpoints from journal replay. The
    # release rollback event must be a reset barrier so the forward canary
    # events cannot resurrect the state that was just restored.
    replayed_snapshot = harness._checkpoint_from_journal(process_id="proc_release_apply_rollback")
    restore_state = restored["restore_state"]
    for field in (
        "lifecycle_state",
        "active_steps",
        "waiting_steps",
        "completed_steps",
        "failed_steps",
        "assigned_agents",
        "runtime_policy",
        "session_state",
        "world_state",
        "artifact_refs",
    ):
        assert getattr(replayed_snapshot, field) == restore_state[field]


def test_release_rollback_restores_authoritative_session_state_and_registry(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    process_id = "proc_release_session_rollback"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    registry = SessionRegistryStore(tmp_path / "sessions.json")
    registry.register(process_id=process_id, session_id="sess-1", session_name="release worker", tool="codex")
    registry.apply_event(normalize_session_event(process_id, "blocked", session_id="sess-1", summary="awaiting canary"))
    captured_session = registry.apply_event(normalize_session_event(process_id, "retry-needed", session_id="sess-1", summary="retry canary"))
    seeded["snapshot"].session_state = {
        "authority": "derived",
        "status": captured_session.status,
        "retry_count": captured_session.retry_count,
        "open_questions": list(captured_session.open_questions),
        "sessions": [captured_session.model_dump()],
        "watchers": [],
    }
    harness.snapshot_store.save(seeded["snapshot"])

    state = ReleaseWorkflowState(
        process_id=process_id,
        candidate_ref="build:session-rollback",
        target_environment="production",
        revision_id="rev_1",
        current_stage="canary_verified",
    )
    state = record_release_fencepost(
        state,
        capture_release_rollback_fencepost(snapshot=seeded["snapshot"], shared_state=seeded["shared_state"], stage="build_verified"),
    )
    harness.release_store.save(state)

    registry.apply_event(normalize_session_event(process_id, "retry-needed", session_id="sess-1", summary="retry canary"))
    restored = apply_release_rollback_restore(
        state,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        release_store=harness.release_store,
        journal=harness.journal,
        session_registry=registry,
        stage="build_verified",
    )

    restored_session = registry.get(process_id=process_id, session_id="sess-1")
    assert restored["snapshot"].session_state == seeded["snapshot"].session_state
    assert restored_session.status == "retry-needed"
    assert restored_session.retry_count == 1
    assert restored_session.open_questions == ["awaiting canary"]


def test_release_rollback_recovers_from_partial_commit_without_duplicate_event(tmp_path, monkeypatch):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    process_id = "proc_release_transaction_recovery"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    state = ReleaseWorkflowState(
        process_id=process_id,
        candidate_ref="build:transaction-recovery",
        target_environment="production",
        revision_id="rev_1",
        current_stage="canary_verified",
    )
    state = record_release_fencepost(
        state,
        capture_release_rollback_fencepost(snapshot=seeded["snapshot"], shared_state=seeded["shared_state"], stage="build_verified"),
    )
    harness.release_store.save(state)

    original_save = harness.snapshot_store.save
    failures = {"remaining": 1}

    def fail_once(snapshot):
        if failures["remaining"]:
            failures["remaining"] -= 1
            raise OSError("snapshot disk unavailable")
        return original_save(snapshot)

    monkeypatch.setattr(harness.snapshot_store, "save", fail_once)
    with pytest.raises(OSError, match="snapshot disk unavailable"):
        apply_release_rollback_restore(
            state,
            snapshot_store=harness.snapshot_store,
            shared_state_store=harness.shared_state_store,
            release_store=harness.release_store,
            journal=harness.journal,
            stage="build_verified",
        )

    pending_intent = harness.release_store.load_rollback_intent(process_id)
    assert pending_intent["status"] == "recovery_required"
    assert harness.shared_state_store.load(process_id).revision_id == pending_intent["rollback_revision_id"]
    before_revision = harness.release_store.load(process_id).persistence_revision
    before_artifacts = sorted(harness.release_store.artifact_store().path.glob("**/*"))
    with pytest.raises(RuntimeError, match="rollback recovery is pending"):
        ingest_production_release_artifact(
            release_store=harness.release_store,
            process_id=process_id,
            artifact_id="artifact:must-wait-for-rollback",
            payload={"must": "not commit"},
            artifact_kind="release_bundle",
            producer="builder",
            verifier=VERIFIER_ID,
            attestation_signature="invalid-but-must-not-be-reached",
        )
    assert harness.release_store.load(process_id).persistence_revision == before_revision
    assert sorted(harness.release_store.artifact_store().path.glob("**/*")) == before_artifacts

    recovered = apply_release_rollback_restore(
        state,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        release_store=harness.release_store,
        journal=harness.journal,
        stage="build_verified",
    )
    rollback_events = harness.journal.load(process_id=process_id, kinds=["release_rolled_back"])

    assert recovered["applied"] is True
    assert recovered["rollback_transaction"]["status"] == "committed"
    assert len(rollback_events) == 1


def test_committed_rollback_retry_returns_durable_response_without_rolling_back_again(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    process_id = "proc_release_idempotent_retry"
    seeded = harness._seed_waiting_process(
        process_id=process_id,
        revision_id="rev_1",
        node_id="build",
        agent_id="builder",
    )
    state = ReleaseWorkflowState(
        process_id=process_id,
        candidate_ref="build:idempotent-retry",
        target_environment="production",
        revision_id="rev_1",
        current_stage="production",
    )
    for stage in ("build_verified", "canary_verified"):
        state = record_release_fencepost(
            state,
            capture_release_rollback_fencepost(
                snapshot=seeded["snapshot"],
                shared_state=seeded["shared_state"],
                stage=stage,
            ),
        )
    stored = harness.release_store.save(state)

    first = apply_release_rollback_restore(
        stored,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        release_store=harness.release_store,
        journal=harness.journal,
        reason="production_health_failure",
        actor="release-manager",
        idempotency_key="health-incident-001",
    )
    revision_after_first = harness.release_store.load(process_id).persistence_revision

    # Simulate loss of the HTTP response after the committed-intent fsync.
    retried = apply_release_rollback_restore(
        harness.release_store.load(process_id),
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        release_store=harness.release_store,
        journal=harness.journal,
        reason="production_health_failure",
        actor="release-manager",
        idempotency_key="health-incident-001",
    )

    assert first["state"].current_stage == "canary_verified"
    assert retried["state"].current_stage == "canary_verified"
    assert retried["rollback_transaction"]["transaction_id"] == first["rollback_transaction"]["transaction_id"]
    assert harness.release_store.load(process_id).persistence_revision == revision_after_first
    assert len(harness.journal.load(process_id=process_id, kinds=["release_rolled_back"])) == 1

    with pytest.raises(ValueError, match="different request"):
        apply_release_rollback_restore(
            harness.release_store.load(process_id),
            snapshot_store=harness.snapshot_store,
            shared_state_store=harness.shared_state_store,
            release_store=harness.release_store,
            journal=harness.journal,
            reason="different failure",
            actor="release-manager",
            idempotency_key="health-incident-001",
        )
    with pytest.raises(ValueError, match="explicit target"):
        apply_release_rollback_restore(
            harness.release_store.load(process_id),
            snapshot_store=harness.snapshot_store,
            shared_state_store=harness.shared_state_store,
            release_store=harness.release_store,
            journal=harness.journal,
            reason="second incident",
            actor="release-manager",
            idempotency_key="health-incident-002",
        )
