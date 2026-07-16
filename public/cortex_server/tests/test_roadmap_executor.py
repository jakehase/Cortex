from __future__ import annotations

from datetime import datetime, timedelta, timezone
import threading
import time

import pytest

from cortex_server.runtime import RuntimeSoakHarness
import cortex_server.runtime.production_build_loop as production_build_loop
import cortex_server.runtime.roadmap_executor as roadmap_executor
from cortex_server.runtime.release_workflow import ReleaseWorkflowState
from cortex_server.runtime.roadmap_executor import (
    RoadmapExecutionState,
    RoadmapExecutionReport,
    RoadmapExecutionStore,
    RoadmapObjectiveContract,
    RoadmapPassBudget,
    RoadmapPhaseDefinition,
    RoadmapReportingPolicy,
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



def _long_chain_contract(process_id: str) -> RoadmapObjectiveContract:
    return RoadmapObjectiveContract(
        process_id=process_id,
        objective="Drive a long mixed roadmap without natural pauses",
        dependability_profile=dict(MINIMAL_PROFILE),
        metadata={"default_worker_id": "builder"},
        phases=[
            RoadmapPhaseDefinition(phase_id="foundation", title="Foundation"),
            RoadmapPhaseDefinition(phase_id="hardening", title="Hardening", depends_on=["foundation"]),
        ],
        tasks=[
            RoadmapTaskDefinition(
                task_id="build",
                phase_id="foundation",
                title="Build",
                work_type="feature",
                quality_gates=[
                    RoadmapSuccessCriterion(
                        criterion_id="build-done",
                        summary="Build must land",
                        kind="world_state",
                        world_state_key="build_done",
                        expected_value=True,
                    )
                ],
            ),
            RoadmapTaskDefinition(
                task_id="fix",
                phase_id="foundation",
                title="Fix",
                work_type="bug_fix",
                depends_on=["build"],
                quality_gates=[
                    RoadmapSuccessCriterion(
                        criterion_id="fix-done",
                        summary="Fix must land",
                        kind="world_state",
                        world_state_key="fix_done",
                        expected_value=True,
                    )
                ],
            ),
            RoadmapTaskDefinition(
                task_id="refactor",
                phase_id="hardening",
                title="Refactor",
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
                title="Reliability",
                work_type="reliability",
                depends_on=["refactor"],
                quality_gates=[
                    RoadmapSuccessCriterion(
                        criterion_id="reliability-done",
                        summary="Reliability evidence must land",
                        kind="world_state",
                        world_state_key="reliability_done",
                        expected_value=True,
                    )
                ],
            ),
            RoadmapTaskDefinition(
                task_id="release",
                phase_id="hardening",
                title="Release",
                work_type="release_prep",
                depends_on=["reliability"],
                quality_gates=[
                    RoadmapSuccessCriterion(
                        criterion_id="release-done",
                        summary="Release prep must land",
                        kind="world_state",
                        world_state_key="release_done",
                        expected_value=True,
                    )
                ],
            ),
        ],
    )


def test_roadmap_reconciliation_uses_the_release_process_transaction(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda _seconds: None)
    process_id = "proc_roadmap_release_fence"
    harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    roadmap_store = RoadmapExecutionStore(tmp_path / "roadmap_store")
    lock_held = threading.Event()
    release_lock = threading.Event()
    completed = threading.Event()
    errors = []

    def hold_release_transaction():
        with harness.release_store.release_transaction(process_id):
            lock_held.set()
            release_lock.wait(timeout=10)

    def reconcile():
        try:
            reconcile_roadmap_execution(
                _long_chain_contract(process_id),
                roadmap_store=roadmap_store,
                snapshot_store=harness.snapshot_store,
                shared_state_store=harness.shared_state_store,
                mailbox=harness.mailbox,
                supervisor=harness.supervisor,
                release_store=harness.release_store,
                controller_id="roadmap-controller",
                controller_session_id="roadmap-session",
                journal=harness.journal,
            )
        except BaseException as exc:
            errors.append(exc)
        finally:
            completed.set()

    holder = threading.Thread(target=hold_release_transaction)
    worker = threading.Thread(target=reconcile)
    holder.start()
    assert lock_held.wait(timeout=5)
    worker.start()
    time.sleep(0.1)
    assert completed.is_set() is False
    assert roadmap_store.load_state(process_id) is None
    release_lock.set()
    holder.join(timeout=5)
    worker.join(timeout=10)
    assert errors == []
    assert completed.is_set() is True
    assert roadmap_store.load_state(process_id) is not None



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
            persistence_revision=release_state.persistence_revision,
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



def test_roadmap_executor_emits_budget_exhaustion_checkpoint_with_broad_progress(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_roadmap_budget_checkpoint"
    store = RoadmapExecutionStore(tmp_path / "roadmap_store")
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_2",
            goals=list(seeded["shared_state"].goals),
            active_plan_node_ids=["build"],
            runtime_constraints=dict(seeded["shared_state"].runtime_constraints),
            world_state={
                **dict(seeded["shared_state"].world_state),
                "build_done": True,
                "fix_done": True,
                "refactor_done": True,
                "reliability_done": True,
                "release_done": True,
            },
            belief_refs=list(seeded["shared_state"].belief_refs),
            open_questions=[],
            agent_ownership=dict(seeded["shared_state"].agent_ownership),
            metadata=dict(seeded["shared_state"].metadata),
        ),
        expected_revision_id="rev_1",
        actor="builder",
        provenance={"phase": "seed_long_chain"},
    )

    result = reconcile_roadmap_execution(
        _long_chain_contract(process_id).model_copy(
            update={
                "execution_budget": RoadmapPassBudget(
                    max_auto_chain_passes=3,
                    max_task_completions_per_pass=1,
                    max_phase_transitions_per_pass=1,
                    max_task_dispatches_per_pass=1,
                )
            }
        ),
        roadmap_store=store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-budget-checkpoint",
        journal=harness.journal,
    )

    reports = store.reports(process_id)
    persisted = store.load_state(process_id)

    assert result["state"]["status"] == "active"
    assert result["continuation"]["mode"] == "continue_now"
    assert result["continuation"]["reason"] == "auto_chain_budget_exhausted"
    assert result["report"] is not None
    assert "auto_pause=budget_exhausted" in result["report"]["summary"]
    assert "tasks=3/5" in result["report"]["summary"]
    assert "chained_passes=3" in result["report"]["summary"]
    assert "auto_chain_budget_exhausted" in result["report"]["metadata"]["reasons"]
    assert result["report"]["metadata"]["validation_scope"] == "broad"
    assert result["report"]["metadata"]["progress"]["task_completed"] == 3
    assert result["report"]["metadata"]["progress"]["next_action_kind"] == "complete_task"
    assert persisted is not None
    assert persisted.metadata["progress_snapshot"]["task_completed"] == 3
    assert persisted.metadata["execution_discipline"]["progress"]["task_completed"] == 3
    assert persisted.metadata["validation_policy"]["scope"] == "broad"
    assert reports[-1].metadata["execution_discipline"]["latest_decisions"]["budget_exhausted"] is True



def test_roadmap_executor_persists_live_follow_up_and_emits_watchdog_review_reports(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_roadmap_watchdog_review"
    store = RoadmapExecutionStore(tmp_path / "roadmap_store")
    harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="feature_build", agent_id="builder")

    contract = _contract(process_id).model_copy(
        update={
            "reporting_policy": RoadmapReportingPolicy(
                report_every_iterations=10,
                live_review_seconds=60,
                proactive_report_seconds=120,
                blocker_followup_seconds=60,
            )
        }
    )
    first_now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    first = reconcile_roadmap_execution(
        contract,
        roadmap_store=store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-watchdog-1",
        journal=harness.journal,
        now=first_now,
    )

    persisted = store.load_state(process_id)
    assert first["state"]["status"] == "active"
    assert persisted is not None
    assert persisted.liveness == "live"
    assert persisted.terminal_state is None
    assert persisted.last_progress_at is not None
    assert persisted.next_review_at is not None
    assert persisted.owed_follow_up["owed"] is True
    assert persisted.reporting_cadence["review_interval_seconds"] == 60

    second = reconcile_roadmap_execution(
        contract,
        roadmap_store=store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="runtime-watchdog",
        controller_session_id="sess-watchdog-2",
        journal=harness.journal,
        now=first_now + timedelta(minutes=3),
        watchdog_context={"decision": "report_status", "classification": "expected_wait", "source": "test"},
    )

    reviewed = store.load_state(process_id)
    reports = store.reports(process_id)
    assert second["report"] is not None
    assert reviewed is not None
    assert reviewed.last_watchdog_decision["decision"] == "report_status"
    assert reviewed.last_report_at == second["report"]["recorded_at"]
    assert reviewed.last_report["report_id"] == second["report"]["report_id"]
    assert any(reason in second["report"]["metadata"]["reasons"] for reason in ["review_due", "status_followup_due", "worker_dispatch", "idle_recovery"])
    assert "status_followup_due" in second["report"]["metadata"]["reasons"]
    assert reports[-1].metadata["reporting_cadence"]["review_interval_seconds"] == 60
    assert reports[-1].metadata["owed_follow_up"]["owed"] is True



def test_roadmap_executor_long_chain_reports_narrow_only_true_human_blockers(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_roadmap_long_chain_blocker"
    store = RoadmapExecutionStore(tmp_path / "roadmap_store")
    seeded = harness._seed_waiting_process(process_id=process_id, revision_id="rev_1", node_id="build", agent_id="builder")
    harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_2",
            goals=list(seeded["shared_state"].goals),
            active_plan_node_ids=["build"],
            runtime_constraints=dict(seeded["shared_state"].runtime_constraints),
            world_state={
                **dict(seeded["shared_state"].world_state),
                "build_done": True,
                "fix_done": True,
                "refactor_done": True,
                "reliability_done": True,
                "release_done": True,
            },
            belief_refs=list(seeded["shared_state"].belief_refs),
            open_questions=[],
            agent_ownership=dict(seeded["shared_state"].agent_ownership),
            metadata=dict(seeded["shared_state"].metadata),
        ),
        expected_revision_id="rev_1",
        actor="builder",
        provenance={"phase": "seed_long_chain"},
    )

    contract = _long_chain_contract(process_id).model_copy(
        update={
            "execution_budget": RoadmapPassBudget(
                max_auto_chain_passes=3,
                max_task_completions_per_pass=1,
                max_phase_transitions_per_pass=1,
                max_task_dispatches_per_pass=1,
            )
        }
    )
    first = reconcile_roadmap_execution(
        contract,
        roadmap_store=store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-long-chain-1",
        journal=harness.journal,
    )
    assert first["continuation"]["reason"] == "auto_chain_budget_exhausted"

    current_shared = harness.shared_state_store.load(process_id)
    harness.shared_state_store.save(
        SharedProcessState(
            process_id=process_id,
            revision_id="rev_3",
            goals=list(current_shared.goals),
            active_plan_node_ids=["reliability"],
            runtime_constraints=dict(current_shared.runtime_constraints),
            world_state=dict(current_shared.world_state),
            belief_refs=list(current_shared.belief_refs),
            open_questions=[],
            open_decisions=[
                OpenDecision(
                    decision_id="dec_release_window",
                    title="Approve release window",
                    owner="human",
                    metadata={"blocking": True},
                )
            ],
            agent_ownership=dict(current_shared.agent_ownership),
            metadata=dict(current_shared.metadata),
        ),
        expected_revision_id=current_shared.revision_id,
        actor="builder",
        provenance={"phase": "inject_true_human_blocker"},
    )
    current_state = store.load_state(process_id)
    reliability = next(task for task in current_state.task_states if task.task_id == "reliability")
    reliability.status = "blocked"
    reliability.blockers = [{"source": "task_blocker", "summary": "Retry flaky soak evidence collector", "requires_human": False}]
    store.save_state(current_state)

    result = reconcile_roadmap_execution(
        contract,
        roadmap_store=store,
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        release_store=harness.release_store,
        controller_id="controller",
        controller_session_id="sess-long-chain-2",
        journal=harness.journal,
    )

    reports = store.reports(process_id)

    assert result["state"]["status"] == "blocked"
    assert any(action["action"] == "requeue_task" and action["task_id"] == "reliability" for action in result["actions_taken"])
    assert len(result["blockers"]) == 1
    assert result["blockers"][0]["source"] == "open_decision"
    assert result["blockers"][0]["blocker_class"] == "human_decision"
    assert result["report"]["metadata"]["progress"]["task_completed"] >= 3
    assert result["report"]["metadata"]["progress"]["human_blocker_count"] == 1
    assert result["report"]["metadata"]["execution_discipline"]["blocker_policy"]["requeued_task_ids"] == ["reliability"]
    assert reports[-1].kind == "blocked"



def test_roadmap_executor_recovers_stale_controller_and_task_worker(tmp_path):
    trusted_now = [datetime.now(timezone.utc)]
    harness = RuntimeSoakHarness(
        tmp_path / "soak",
        sleep_fn=lambda seconds: None,
        clock_fn=lambda: trusted_now[0],
    )
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
    trusted_now[0] += timedelta(seconds=5)

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
    assert any(action["action"] == "stale_leases_require_fenced_takeover" for action in result["actions_taken"])
    assert any(action["action"] == "task_requires_fenced_takeover" for action in result["actions_taken"])
    assert not any(action["action"] == "dispatch_task_handoff" and action["task_id"] == "finalize" for action in result["actions_taken"])
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


def test_roadmap_executor_keeps_non_human_rule_blockers_live_when_no_worker_can_requeue(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)
    process_id = "proc_roadmap_nonhuman_live"
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
            open_questions=["RETRYABLE: wait for flaky CI lane to self-heal"],
            agent_ownership=dict(seeded["shared_state"].agent_ownership),
            metadata=dict(seeded["shared_state"].metadata),
        ),
        expected_revision_id="rev_1",
        actor="builder",
        provenance={"phase": "retryable_rule_blocker"},
    )

    contract = RoadmapObjectiveContract(
        process_id=process_id,
        objective="Stay live across non-human blockers until recovery is possible",
        dependability_profile=dict(MINIMAL_PROFILE),
        metadata={"owner": "cortex", "session_key": "session:roadmap:followthrough", "channel": "whatsapp"},
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
        controller_session_id="sess-nonhuman-live",
        journal=harness.journal,
    )

    assert result["state"]["status"] == "active"
    assert result["next_action"]["kind"] in {"await_worker_progress", "await_non_human_recovery"}
    assert result["continuation"]["mode"] in {"await_worker_progress", "await_external_progress"}
    assert result["blockers"] == []
    assert result["state"]["follow_through"]["resume_on_next_tick"] is True
    assert result["state"]["follow_through"]["pending_update_intent"]["kind"] == "status"
    assert result["state"]["conversation_ownership"]["owner"] == "cortex"
    assert result["state"]["conversation_ownership"]["session_key"] == "session:roadmap:followthrough"


def test_roadmap_store_recovers_torn_projection_with_revisioned_fsynced_history(tmp_path):
    store = RoadmapExecutionStore(tmp_path / "roadmap_store")
    contract = RoadmapObjectiveContract(
        objective_id="objective-durable-roadmap",
        process_id="proc_durable_roadmap",
        objective="Recover acknowledged roadmap state",
    )
    store.save_contract(contract)
    state = store.save_state(
        RoadmapExecutionState(
            objective_id=contract.objective_id,
            process_id=contract.process_id,
            iteration_count=1,
        )
    )
    state = store.save_state(state.model_copy(update={"iteration_count": 2}))
    report = store.append_report(
        RoadmapExecutionReport(
            execution_id=state.execution_id,
            objective_id=state.objective_id,
            process_id=state.process_id,
            iteration=2,
            kind="checkpoint",
            status="active",
            summary="durable roadmap checkpoint",
        )
    )
    store._state_target(state.process_id).write_bytes(b'{"iteration_count":')
    with store._history_target(state.process_id).open("ab") as handle:
        handle.write(b'{"state":')
    with store._report_target(state.process_id).open("ab") as handle:
        handle.write(b'{"report_id":')

    reopened = RoadmapExecutionStore(tmp_path / "roadmap_store")
    recovered = reopened.load_state(state.process_id)
    assert recovered.iteration_count == 2
    assert recovered.persistence_revision == 2
    assert [row.report_id for row in reopened.reports(state.process_id)] == [report.report_id]


def test_roadmap_store_preserves_previous_projection_when_atomic_replace_does_not_commit(tmp_path, monkeypatch):
    store = RoadmapExecutionStore(tmp_path / "roadmap_store")
    initial = store.save_state(
        RoadmapExecutionState(
            objective_id="objective-roadmap-replace",
            process_id="proc_roadmap_replace",
            iteration_count=1,
        )
    )
    original_replace = production_build_loop.os.replace
    failures = {"remaining": 1}

    def fail_first_replace(source, target):
        if failures["remaining"]:
            failures["remaining"] -= 1
            raise OSError("simulated roadmap crash before replace")
        return original_replace(source, target)

    monkeypatch.setattr(production_build_loop.os, "replace", fail_first_replace)
    with pytest.raises(OSError, match="before replace"):
        store.save_state(initial.model_copy(update={"iteration_count": 2}))

    recovered = RoadmapExecutionStore(tmp_path / "roadmap_store").load_state(initial.process_id)
    assert recovered.iteration_count == 1
    assert recovered.persistence_revision == initial.persistence_revision


def test_roadmap_store_bounds_history_and_readiness_indexes_corruption(tmp_path, monkeypatch):
    monkeypatch.setattr(roadmap_executor, "MAX_HISTORY_RECORDS", 2)
    store = RoadmapExecutionStore(tmp_path / "roadmap_executor")
    contract = RoadmapObjectiveContract(
        objective_id="objective-bounded-roadmap",
        process_id="proc_bounded_roadmap",
        objective="Bound roadmap history",
    )
    store.save_contract(contract)
    state = store.save_state(
        RoadmapExecutionState(objective_id=contract.objective_id, process_id=contract.process_id)
    )
    for iteration in range(1, 5):
        state = store.save_state(state.model_copy(update={"iteration_count": iteration}))
    rows = roadmap_executor.read_recoverable_jsonl(store._history_target(state.process_id))
    assert len(rows) == 2
    assert [row["persistence_revision"] for row in rows] == [4, 5]

    consistency = production_build_loop._probe_runtime_delivery_state_consistency(
        delivery_root=tmp_path,
        reasoning_processes={},
        verifier_credentials={},
    )
    assert consistency["ok"] is True
    store._contract_target(state.process_id).write_text("{", encoding="utf-8")
    corrupted = production_build_loop._probe_runtime_delivery_state_consistency(
        delivery_root=tmp_path,
        reasoning_processes={},
        verifier_credentials={},
    )
    assert corrupted["ok"] is False
    assert any(row["check"] == "roadmap_projection_integrity" for row in corrupted["inconsistencies"])
