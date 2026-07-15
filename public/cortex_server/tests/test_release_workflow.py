from __future__ import annotations

from datetime import timedelta

import pytest

from cortex_server.runtime import (
    ReleaseWorkflowState,
    RuntimeSoakHarness,
    advance_release_workflow,
    apply_release_rollback_restore,
    capture_release_rollback_fencepost,
    compile_release_handoff,
    evaluate_release_promotion_gate,
    record_release_fencepost,
    record_release_handoff,
    repair_release_workflow,
    rollback_release_workflow,
    normalize_session_event,
)
from cortex_server.runtime.session_registry import SessionRegistryStore
from cortex_server.runtime.shared_process_state import SharedProcessState



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
    acked = harness.mailbox.acknowledge(message.message_id)
    state = record_release_handoff(state, acked, stage="canary_verified")

    fencepost = capture_release_rollback_fencepost(snapshot=snapshot, shared_state=shared_state, stage="build_verified")
    state = record_release_fencepost(state, fencepost)

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
    acknowledged = harness.mailbox.acknowledge(message.message_id)
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
            harness.mailbox.acknowledge(message.message_id),
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
    build_acked = harness.mailbox.acknowledge(build_message.message_id)
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
    harness.supervisor.reclaim_stale(now=harness.clock_fn() + timedelta(seconds=10))

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
    assert "resolve_stale_leases" in action_names
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
    assert restored["state"].revision_id.endswith(".rollback")
    assert latest_release.metadata["rollback_applied"] is True
    assert latest_snapshot.lifecycle_state == "waiting"
    assert latest_snapshot.metadata["rollback_fencepost_id"] == restored["fencepost"]["fencepost_id"]
    assert latest_shared.revision_id == restored["state"].revision_id
    assert latest_event.kind == "release_rolled_back"


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
    assert harness.shared_state_store.load(process_id).revision_id == "rev_1.rollback"

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
