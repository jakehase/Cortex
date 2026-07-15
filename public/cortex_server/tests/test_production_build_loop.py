from __future__ import annotations

from datetime import datetime, timedelta, timezone

from cortex_server.runtime import RuntimeSoakHarness
import cortex_server.runtime.production_build_loop as production_build_loop
from cortex_server.runtime.production_build_loop import (
    BuildLoopControllerOwner,
    ProductionBuildContract,
    ProductionBuildLoopState,
    ProductionBuildLoopStore,
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
)
from cortex_server.runtime.shared_process_state import OpenDecision, SharedProcessState


MINIMAL_PROFILE = {
    "profile": "prod-loop-test",
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


def test_empty_completion_contract_is_not_terminal_and_default_gates_require_evidence(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_empty_completion"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    contract = ProductionBuildContract(
        process_id=process_id,
        objective="Ship safely",
        completion_criteria=[],
        stage_gates=[],
        dependability_profile=dict(MINIMAL_PROFILE),
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
        dependability_profile=dict(MINIMAL_PROFILE),
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



def test_production_loop_persists_through_intermediate_milestones_until_completion(tmp_path):
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
    harness.release_store.save(release_state, actor="verifier", provenance={"phase": "canary_verified"})

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

    assert second["state"]["status"] == "completed"
    assert second["state"]["current_stage"] == "production"
    assert second["report"]["kind"] == "completed"
    assert any(report.stage == "canary_verified" for report in reports)
    assert reports[-1].kind == "completed"



def test_production_loop_auto_chains_across_stage_promotions_with_bounded_pass_budget(tmp_path):
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

    assert result["state"]["status"] == "completed"
    assert result["state"]["current_stage"] == "production"
    assert result["chained_passes"] >= 2
    assert result["continuation"]["mode"] == "stop"
    assert persisted is not None
    assert persisted.last_pass["budget"]["max_stage_advances_per_pass"] == 1
    assert persisted.last_pass["validation_scope"] == "broad"
    assert any(reason in persisted.last_pass["validation_reasons"] for reason in ["stage_promotion_checkpoint", "completion_checkpoint", "checkpoint:production"])
    assert persisted.next_action["kind"] == "completed"
    assert len(reports) >= 2
    assert all("validation=" in report.summary or report.kind != "checkpoint" for report in reports)
    assert reports[-1].metadata["execution_discipline"]["latest_decisions"]["status"] == "completed"



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
        now=first_now + timedelta(minutes=3),
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
        controller_session_id="sess-repair",
        now=datetime.now(timezone.utc) + timedelta(seconds=10),
    )

    assert result["state"]["status"] == "active"
    assert result["blockers"] == []
    assert result["dependability"]["before"]["success"] is False
    assert result["dependability"]["after"]["success"] is True
    assert any(action["action"] == "recover_dead_letters" for action in result["actions_taken"])
    assert any(action["action"] == "resolve_stale_leases" for action in result["actions_taken"])
    assert any(action["action"] == "checkpoint_from_journal" for action in result["actions_taken"])


def test_production_loop_waits_for_recipient_handoff_evidence_before_promotion(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_release_handoff_loop"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    snapshot = seeded["snapshot"]
    shared_state = seeded["shared_state"]

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
        promotion_stages=["build_verified", "production"],
        stage_gates=[
            ProductionStageGate(
                stage="production",
                required_fencepost_stages=["build_verified"],
                required_handoff_count=1,
                metadata={
                    "handoff": {
                        "from_agent": "controller",
                        "to_agent": "release-manager",
                        "scope": "release:promote",
                        "objective": "Promote the verified release to production",
                        "expected_output": "Ack that production promotion is safe",
                    }
                },
            )
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
        controller_session_id="sess-release",
    )

    pending_release = harness.release_store.load(process_id)
    messages = harness.mailbox.list(process_id=process_id)
    leases = harness.supervisor.list(process_id=process_id)

    assert result["state"]["status"] == "active"
    assert pending_release.current_stage == "build_verified"
    assert any(action["action"] == "dispatch_release_handoff" for action in result["actions_taken"])
    assert not any(action["action"] == "ack_release_handoff" for action in result["actions_taken"])
    assert not any(fencepost.stage == "production" for fencepost in pending_release.rollback_fenceposts)
    assert any(message.to_agent == "release-manager" and message.delivery_status == "queued" for message in messages)
    assert any(lease.scope == "release:promote" and lease.agent_id == "release-manager" for lease in leases)

    received = harness.mailbox.receive(
        to_agent="release-manager",
        process_id=process_id,
        expected_revision_id=shared_state.revision_id,
        reject_stale_revision=True,
    )
    assert len(received) == 1
    acknowledged = harness.mailbox.acknowledge(received[0].message_id)
    harness.release_store.save(
        record_release_handoff(pending_release, acknowledged, stage="production", notes="verified by recipient"),
        actor="release-manager",
        provenance={"evidence": "recipient_verification"},
    )

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
        dependability_profile=dict(MINIMAL_PROFILE),
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
