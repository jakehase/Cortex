from __future__ import annotations

from datetime import datetime, timedelta, timezone

from cortex_server.runtime import RuntimeSoakHarness
from cortex_server.runtime.release_workflow import ReleaseWorkflowState
from cortex_server.runtime.roadmap_executor import (
    RoadmapExecutionState,
    RoadmapExecutionStore,
    RoadmapObjectiveContract,
    RoadmapPassBudget,
    RoadmapPhaseDefinition,
    RoadmapSuccessCriterion,
    RoadmapTaskDefinition,
    RoadmapTaskState,
    reconcile_roadmap_execution,
)
from cortex_server.runtime.shared_process_state import OpenDecision, SharedProcessState


MINIMAL_PROFILE = {
    "profile": "roadmap-test",
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



def _contract(process_id: str) -> RoadmapObjectiveContract:
    return RoadmapObjectiveContract(
        process_id=process_id,
        objective="Ship a durable roadmap across mixed work types",
        dependability_profile=dict(MINIMAL_PROFILE),
        metadata={"default_worker_id": "builder"},
        success_criteria=[
            RoadmapSuccessCriterion(criterion_id="dependability", summary="Dependability must be green", kind="dependability"),
            RoadmapSuccessCriterion(criterion_id="release", summary="Release must reach production", kind="release_stage", stage="production"),
            RoadmapSuccessCriterion(criterion_id="polish", summary="Polish must land", kind="world_state", world_state_key="polish_done", expected_value=True),
        ],
        phases=[
            RoadmapPhaseDefinition(phase_id="foundation", title="Foundation"),
            RoadmapPhaseDefinition(phase_id="hardening", title="Hardening", depends_on=["foundation"]),
        ],
        tasks=[
            RoadmapTaskDefinition(
                task_id="feature_build",
                phase_id="foundation",
                title="Build the feature",
                work_type="feature",
                quality_gates=[
                    RoadmapSuccessCriterion(
                        criterion_id="feature-done",
                        summary="Feature build must land",
                        kind="world_state",
                        world_state_key="feature_done",
                        expected_value=True,
                    )
                ],
            ),
            RoadmapTaskDefinition(
                task_id="bug_fix",
                phase_id="foundation",
                title="Fix the critical bug",
                work_type="bug_fix",
                depends_on=["feature_build"],
                quality_gates=[
                    RoadmapSuccessCriterion(
                        criterion_id="bugfix-done",
                        summary="Bug fix must land",
                        kind="world_state",
                        world_state_key="bugfix_done",
                        expected_value=True,
                    )
                ],
            ),
            RoadmapTaskDefinition(
                task_id="refactor",
                phase_id="hardening",
                title="Refactor the subsystem",
                work_type="refactor",
                quality_gates=[
                    RoadmapSuccessCriterion(
                        criterion_id="refactor-done",
                        summary="Refactor must land",
                        kind="world_state",
                        world_state_key="refactor_done",
                        expected_value=True,
                    )
                ],
            ),
            RoadmapTaskDefinition(
                task_id="reliability",
                phase_id="hardening",
                title="Add reliability evidence",
                work_type="reliability",
                depends_on=["refactor"],
                quality_gates=[
                    RoadmapSuccessCriterion(
                        criterion_id="smoke-artifact",
                        summary="Smoke artifact must exist",
                        kind="artifact_present",
                        artifact_id=f"artifact_smoke:{process_id}",
                    )
                ],
            ),
            RoadmapTaskDefinition(
                task_id="release_prep",
                phase_id="hardening",
                title="Prepare the release",
                work_type="release_prep",
                depends_on=["reliability"],
                quality_gates=[
                    RoadmapSuccessCriterion(
                        criterion_id="release-prod",
                        summary="Release must be in production",
                        kind="release_stage",
                        stage="production",
                    )
                ],
            ),
            RoadmapTaskDefinition(
                task_id="polish",
                phase_id="hardening",
                title="Land the final polish",
                work_type="polish",
                depends_on=["release_prep"],
                quality_gates=[
                    RoadmapSuccessCriterion(
                        criterion_id="polish-done",
                        summary="Polish must land",
                        kind="world_state",
                        world_state_key="polish_done",
                        expected_value=True,
                    )
                ],
            ),
        ],
    )



def test_roadmap_executor_persists_through_mixed_phases_until_true_completion(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_roadmap"
    loop_store = RoadmapExecutionStore(tmp_path / "roadmap_store")
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="feature_build", agent_id="builder")

    shared_state = harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_2",
            goals=list(seeded["shared_state"].goals),
            active_plan_node_ids=["feature_build"],
            runtime_constraints=dict(seeded["shared_state"].runtime_constraints),
            world_state=dict(seeded["shared_state"].world_state),
            belief_refs=list(seeded["shared_state"].belief_refs),
            open_questions=[],
            agent_ownership=dict(seeded["shared_state"].agent_ownership),
            metadata=dict(seeded["shared_state"].metadata),
        ),
        expected_revision_id="rev_1",
        actor="builder",
        provenance={"phase": "seed_clean"},
    )
    harness.release_store.save(
        ReleaseWorkflowState(
            process_id=process_id,
            candidate_ref="build:roadmap",
            target_environment="production",
            revision_id=shared_state.revision_id,
            current_stage="build_verified",
            status="preparing",
        ),
        actor="builder",
        provenance={"phase": "seed_release"},
    )
    contract = _contract(process_id)

    first = reconcile_roadmap_execution(
        contract,
        roadmap_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-1",
        journal=harness.journal,
    )
    assert first["state"]["status"] == "active"
    assert first["state"]["active_phase_id"] == "foundation"
    assert "feature_build" in first["state"]["active_task_ids"]

    harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_3",
            goals=list(shared_state.goals),
            active_plan_node_ids=["bug_fix"],
            runtime_constraints=dict(shared_state.runtime_constraints),
            world_state={**dict(shared_state.world_state), "feature_done": True},
            belief_refs=list(shared_state.belief_refs),
            open_questions=[],
            agent_ownership=dict(shared_state.agent_ownership),
            metadata=dict(shared_state.metadata),
        ),
        expected_revision_id="rev_2",
        actor="builder",
        provenance={"phase": "feature_done"},
    )
    second = reconcile_roadmap_execution(
        contract,
        roadmap_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-1",
        journal=harness.journal,
    )
    assert second["state"]["status"] == "active"
    assert second["state"]["active_phase_id"] == "foundation"
    assert "bug_fix" in second["state"]["active_task_ids"]
    assert any(task["status"] == "completed" and task["task_id"] == "feature_build" for task in second["state"]["task_states"])

    current = harness.shared_state_store.load(process_id)
    harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_4",
            goals=list(current.goals),
            active_plan_node_ids=["refactor"],
            runtime_constraints=dict(current.runtime_constraints),
            world_state={**dict(current.world_state), "feature_done": True, "bugfix_done": True},
            belief_refs=list(current.belief_refs),
            open_questions=[],
            agent_ownership=dict(current.agent_ownership),
            metadata=dict(current.metadata),
        ),
        expected_revision_id=current.revision_id,
        actor="builder",
        provenance={"phase": "bugfix_done"},
    )
    third = reconcile_roadmap_execution(
        contract,
        roadmap_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-1",
        journal=harness.journal,
    )
    assert third["state"]["status"] == "active"
    assert third["state"]["active_phase_id"] == "hardening"
    assert "refactor" in third["state"]["active_task_ids"]
    assert any(phase["phase_id"] == "foundation" and phase["status"] == "completed" for phase in third["state"]["phase_states"])

    current = harness.shared_state_store.load(process_id)
    harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_5",
            goals=list(current.goals),
            active_plan_node_ids=["reliability"],
            runtime_constraints=dict(current.runtime_constraints),
            world_state={**dict(current.world_state), "refactor_done": True},
            belief_refs=list(current.belief_refs),
            open_questions=[],
            agent_ownership=dict(current.agent_ownership),
            metadata=dict(current.metadata),
        ),
        expected_revision_id=current.revision_id,
        actor="builder",
        provenance={"phase": "refactor_done"},
    )
    fourth = reconcile_roadmap_execution(
        contract,
        roadmap_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-1",
        journal=harness.journal,
    )
    assert fourth["state"]["status"] == "active"
    assert "reliability" in fourth["state"]["active_task_ids"]

    current = harness.shared_state_store.load(process_id)
    harness.journal.append(
        process_id=process_id,
        kind="artifact_written",
        revision_id=current.revision_id,
        actor="verifier",
        payload={"artifact_id": f"artifact_smoke:{process_id}"},
    )
    harness._checkpoint_from_journal(process_id=process_id, metadata={"phase": "smoke"})
    harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_6",
            goals=list(current.goals),
            active_plan_node_ids=["polish"],
            runtime_constraints=dict(current.runtime_constraints),
            world_state={**dict(current.world_state), "refactor_done": True, "polish_done": True},
            belief_refs=list(current.belief_refs),
            open_questions=[],
            agent_ownership=dict(current.agent_ownership),
            metadata=dict(current.metadata),
        ),
        expected_revision_id=current.revision_id,
        actor="builder",
        provenance={"phase": "final_polish"},
    )
    release_state = harness.release_store.load(process_id)
    harness.release_store.save(
        ReleaseWorkflowState(
            release_id=release_state.release_id,
            process_id=process_id,
            candidate_ref=release_state.candidate_ref,
            target_environment="production",
            revision_id="rev_6",
            current_stage="production",
            status="promoted",
            promotion_history=list(release_state.promotion_history),
            handoff_records=list(release_state.handoff_records),
            rollback_fenceposts=list(release_state.rollback_fenceposts),
            operator_holds=[],
            safe_push_criteria=dict(release_state.safe_push_criteria),
            metadata=dict(release_state.metadata),
        ),
        actor="release-manager",
        provenance={"phase": "production"},
    )

    final = reconcile_roadmap_execution(
        contract,
        roadmap_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-1",
        journal=harness.journal,
    )

    reports = loop_store.reports(process_id)
    assert final["state"]["status"] == "completed"
    assert final["completion"]["all_required_satisfied"] is True
    assert final["report"]["kind"] == "completed"
    assert reports[-1].kind == "completed"
    assert any(task["task_id"] == "release_prep" and task["status"] == "completed" for task in final["state"]["task_states"])
    assert any(task["task_id"] == "polish" and task["status"] == "completed" for task in final["state"]["task_states"])



def test_roadmap_executor_auto_chains_across_phase_completion_without_natural_pause(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_roadmap_autochain"
    loop_store = RoadmapExecutionStore(tmp_path / "roadmap_store")
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="feature_build", agent_id="builder")

    shared_state = harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_2",
            goals=list(seeded["shared_state"].goals),
            active_plan_node_ids=["refactor"],
            runtime_constraints=dict(seeded["shared_state"].runtime_constraints),
            world_state={**dict(seeded["shared_state"].world_state), "feature_done": True, "bugfix_done": True},
            belief_refs=list(seeded["shared_state"].belief_refs),
            open_questions=[],
            agent_ownership=dict(seeded["shared_state"].agent_ownership),
            metadata=dict(seeded["shared_state"].metadata),
        ),
        expected_revision_id="rev_1",
        actor="builder",
        provenance={"phase": "foundation_complete"},
    )
    harness.release_store.save(
        ReleaseWorkflowState(
            process_id=process_id,
            candidate_ref="build:auto-chain",
            target_environment="production",
            revision_id=shared_state.revision_id,
            current_stage="build_verified",
            status="preparing",
        ),
        actor="builder",
        provenance={"phase": "seed_release"},
    )

    contract = _contract(process_id).model_copy(
        update={
            "execution_budget": RoadmapPassBudget(
                max_auto_chain_passes=4,
                max_task_completions_per_pass=1,
                max_phase_transitions_per_pass=1,
                max_task_dispatches_per_pass=1,
            )
        }
    )

    result = reconcile_roadmap_execution(
        contract,
        roadmap_store=loop_store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-auto-chain",
        journal=harness.journal,
    )

    persisted = loop_store.load_state(process_id)
    reports = loop_store.reports(process_id)

    assert result["state"]["status"] == "active"
    assert result["state"]["active_phase_id"] == "hardening"
    assert "refactor" in result["state"]["active_task_ids"]
    assert result["chained_passes"] >= 2
    assert any(phase["phase_id"] == "foundation" and phase["status"] == "completed" for phase in result["state"]["phase_states"])
    assert result["continuation"]["mode"] == "await_external_progress"
    assert persisted is not None
    assert persisted.last_pass["budget"]["max_task_completions_per_pass"] == 1
    assert persisted.last_pass["validation_scope"] in {"focused", "broad"}
    assert persisted.next_action["kind"] == "await_worker_progress"
    assert "refactor" in persisted.next_action["task_ids"]
    assert len(reports) >= 2
    assert all("scope" in report.metadata["execution_discipline"]["validation_policy"] for report in reports)
    assert all("next=" in report.summary or report.kind != "checkpoint" for report in reports)
    assert reports[-1].metadata["execution_discipline"]["latest_decisions"]["status"] == "active"



def test_roadmap_executor_recovers_stale_controller_and_task_worker(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_roadmap_takeover"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="finalize", agent_id="builder")
    harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_2",
            goals=list(seeded["shared_state"].goals),
            active_plan_node_ids=["finalize"],
            runtime_constraints=dict(seeded["shared_state"].runtime_constraints),
            world_state=dict(seeded["shared_state"].world_state),
            belief_refs=list(seeded["shared_state"].belief_refs),
            open_questions=[],
            agent_ownership={"finalize": "builder"},
            metadata=dict(seeded["shared_state"].metadata),
        ),
        expected_revision_id="rev_1",
        actor="builder",
        provenance={"phase": "seed_clean"},
    )

    contract = RoadmapObjectiveContract(
        process_id=process_id,
        objective="Hold ownership until final artifact exists",
        dependability_profile=dict(MINIMAL_PROFILE),
        metadata={"default_worker_id": "builder"},
        phases=[RoadmapPhaseDefinition(phase_id="ship", title="Ship")],
        tasks=[
            RoadmapTaskDefinition(
                task_id="finalize",
                phase_id="ship",
                title="Finalize release",
                work_type="release_prep",
                quality_gates=[
                    RoadmapSuccessCriterion(
                        criterion_id="final-artifact",
                        summary="Final artifact must exist",
                        kind="artifact_present",
                        artifact_id="artifact_final_release",
                    )
                ],
            )
        ],
    )
    store = RoadmapExecutionStore(tmp_path / "roadmap_store")
    old_controller = harness.supervisor.assign(
        process_id=process_id,
        scope=f"{contract.controller_scope}:{process_id}",
        agent_id="controller",
        lease_seconds=1,
        metadata={"session_id": "sess-old", "objective_id": contract.objective_id},
    )
    old_task_lease = harness.supervisor.assign(
        process_id=process_id,
        scope="roadmap_task:finalize",
        agent_id="builder",
        lease_seconds=1,
        metadata={"task_id": "finalize"},
    )
    store.save_state(
        RoadmapExecutionState(
            objective_id=contract.objective_id,
            process_id=process_id,
            controller={
                "controller_id": "controller",
                "session_id": "sess-old",
                "lease_id": old_controller.lease_id,
                "claimed_at": old_controller.assigned_at,
                "heartbeat_at": old_controller.heartbeat_at,
            },
            phase_states=[{"phase_id": "ship", "status": "active"}],
            task_states=[
                RoadmapTaskState(
                    task_id="finalize",
                    phase_id="ship",
                    work_type="release_prep",
                    status="in_progress",
                    assigned_agent_id="builder",
                    lease_id=old_task_lease.lease_id,
                    started_at=old_task_lease.assigned_at,
                )
            ],
            active_phase_id="ship",
            active_task_ids=["finalize"],
        )
    )

    result = reconcile_roadmap_execution(
        contract,
        roadmap_store=store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-new",
        journal=harness.journal,
        now=datetime.now(timezone.utc) + timedelta(seconds=5),
    )

    assert result["state"]["status"] == "active"
    assert result["state"]["recovery_count"] == 1
    assert result["state"]["controller"]["session_id"] == "sess-new"
    assert any(action["action"] in {"release_stale_task_lease", "resolve_stale_leases"} for action in result["actions_taken"])
    assert any(action["action"] == "dispatch_task_handoff" and action["task_id"] == "finalize" for action in result["actions_taken"])
    assert any(task["task_id"] == "finalize" and task["status"] == "in_progress" for task in result["state"]["task_states"])



def test_roadmap_executor_blocks_only_for_true_human_blockers(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_roadmap_blocked"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_2",
            goals=list(seeded["shared_state"].goals),
            active_plan_node_ids=["build"],
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

    contract = RoadmapObjectiveContract(
        process_id=process_id,
        objective="Keep building until a human really needs to decide",
        dependability_profile=dict(MINIMAL_PROFILE),
        phases=[RoadmapPhaseDefinition(phase_id="build", title="Build")],
        tasks=[
            RoadmapTaskDefinition(
                task_id="build",
                phase_id="build",
                title="Build",
                work_type="feature",
                quality_gates=[
                    RoadmapSuccessCriterion(
                        criterion_id="final-artifact",
                        summary="Final artifact must exist",
                        kind="artifact_present",
                        artifact_id="artifact_final_release",
                    )
                ],
            )
        ],
    )
    store = RoadmapExecutionStore(tmp_path / "roadmap_store")

    result = reconcile_roadmap_execution(
        contract,
        roadmap_store=store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-blocked",
        journal=harness.journal,
    )

    reports = store.reports(process_id)
    assert result["state"]["status"] == "blocked"
    assert any(blocker["source"] == "open_decision" for blocker in result["blockers"])
    assert reports[-1].kind == "blocked"
    assert reports[-1].metadata["execution_discipline"]["blocker_policy"]["true_blocker_count"] == 1



def test_roadmap_executor_requeues_non_human_task_blockers_and_reports_policy(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_roadmap_requeue"
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_2",
            goals=list(seeded["shared_state"].goals),
            active_plan_node_ids=["build"],
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

    contract = RoadmapObjectiveContract(
        process_id=process_id,
        objective="Keep working through non-human blockers",
        dependability_profile=dict(MINIMAL_PROFILE),
        metadata={"default_worker_id": "builder"},
        phases=[RoadmapPhaseDefinition(phase_id="build", title="Build")],
        tasks=[
            RoadmapTaskDefinition(
                task_id="build",
                phase_id="build",
                title="Build",
                work_type="feature",
                quality_gates=[
                    RoadmapSuccessCriterion(
                        criterion_id="final-artifact",
                        summary="Final artifact must exist",
                        kind="artifact_present",
                        artifact_id="artifact_final_release",
                    )
                ],
            )
        ],
    )
    store = RoadmapExecutionStore(tmp_path / "roadmap_store")
    store.save_state(
        RoadmapExecutionState(
            objective_id=contract.objective_id,
            process_id=process_id,
            phase_states=[{"phase_id": "build", "status": "active"}],
            task_states=[
                RoadmapTaskState(
                    task_id="build",
                    phase_id="build",
                    work_type="feature",
                    status="blocked",
                    blockers=[{"source": "task_blocker", "summary": "Retry flaky CI lane after backoff", "requires_human": False}],
                )
            ],
            active_phase_id="build",
            active_task_ids=["build"],
        )
    )

    result = reconcile_roadmap_execution(
        contract,
        roadmap_store=store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-requeue",
        journal=harness.journal,
    )

    reports = store.reports(process_id)

    assert result["state"]["status"] == "active"
    assert result["blockers"] == []
    assert any(action["action"] == "requeue_task" for action in result["actions_taken"])
    assert result["state"]["metadata"]["execution_discipline"]["blocker_policy"]["requeued_task_ids"] == ["build"]
    assert result["state"]["metadata"]["validation_policy"]["scope"] == "focused"
    assert "bounded_pass_focused_validation" in result["state"]["last_pass"]["validation_reasons"]
    assert reports[-1].metadata["execution_discipline"]["latest_decisions"]["status"] == "active"
    assert "validation=focused" in reports[-1].summary
