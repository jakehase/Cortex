from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.mission_control as mission_control
import cortex_server.routers.orchestrator as orchestrator
import cortex_server.services.mission_control_service as mission_control_service


MINIMAL_PROFILE = {
    "profile": "mission-control-test",
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

ROADMAP_REPORTING = {
    "report_every_iterations": 10,
    "live_review_seconds": 60,
    "proactive_report_seconds": 120,
    "blocker_followup_seconds": 60,
}

DELIVERY_REPORTING = {
    "report_every_iterations": 10,
    "live_review_seconds": 60,
    "proactive_report_seconds": 120,
    "blocker_followup_seconds": 60,
}



def _install_fake_diplomat(monkeypatch):
    sent = []

    class _FakeDiplomat:
        def send_briefing(self, message: str, title: str = "[Cortex] Runtime update") -> bool:
            sent.append({"title": title, "message": message})
            return True

    monkeypatch.setattr(orchestrator, "get_diplomat", lambda: _FakeDiplomat())
    return sent



def _dump(model):
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _mark_item_done(*, stores, detail):
    process_id = detail["objective"]["process_id"]
    queue_done_key = detail["queue_item"]["projection"]["done_world_state_key"]
    assert queue_done_key
    shared_state = stores["shared_state_store"].load(process_id)
    payload = _dump(shared_state)
    payload["revision_id"] = f"{payload['revision_id']}.done"
    payload["world_state"] = {**dict(payload.get("world_state") or {}), queue_done_key: True}
    stores["shared_state_store"].save(
        payload,
        expected_revision_id=shared_state.revision_id,
        actor="pytest",
        provenance={"source": "test_mission_control"},
    )



def test_mission_control_unifies_mixed_runtime_work_and_reports_live_state(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    sent = _install_fake_diplomat(monkeypatch)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    roadmap = asyncio.run(
        mission_control.mission_control_create_objective(
            mission_control.MissionControlCreateRequest(
                kind="roadmap",
                title="Mission roadmap",
                objective="Keep driving the runtime roadmap until build_done becomes true.",
                session_key="session:mission-roadmap",
                channel="whatsapp",
                conversation_id="chat:mission:roadmap",
                roadmap={
                    "dependability_profile": dict(MINIMAL_PROFILE),
                    "reporting_policy": dict(ROADMAP_REPORTING),
                    "phases": [{"phase_id": "runtime", "title": "Runtime"}],
                    "tasks": [
                        {
                            "task_id": "ship_build",
                            "phase_id": "runtime",
                            "title": "Ship the build when runtime state says it is done",
                            "work_type": "feature",
                            "quality_gates": [
                                {
                                    "criterion_id": "build-done",
                                    "summary": "build_done must become true",
                                    "kind": "world_state",
                                    "world_state_key": "build_done",
                                    "expected_value": True,
                                }
                            ],
                        }
                    ],
                    "success_criteria": [
                        {
                            "criterion_id": "build-done",
                            "summary": "build_done must become true",
                            "kind": "world_state",
                            "world_state_key": "build_done",
                            "expected_value": True,
                        }
                    ],
                },
            )
        )
    )
    delivery = asyncio.run(
        mission_control.mission_control_create_objective(
            mission_control.MissionControlCreateRequest(
                kind="delivery",
                title="Mission delivery",
                objective="Advance the release until production is safely available.",
                session_key="session:mission-delivery",
                channel="whatsapp",
                conversation_id="chat:mission:delivery",
                delivery={
                    "dependability_profile": dict(MINIMAL_PROFILE),
                    "checkpoint_policy": dict(DELIVERY_REPORTING),
                    "initial_release_stage": "draft",
                    "promotion_stages": ["build_verified", "canary_verified", "production"],
                    "completion_criteria": [
                        {
                            "criterion_id": "release-stage",
                            "summary": "Release must reach production",
                            "kind": "release_stage",
                            "stage": "production",
                        }
                    ],
                    "stage_gates": [
                        {
                            "stage": "production",
                            "required_fencepost_stages": ["build_verified"],
                            "required_artifacts": ["artifact:missing-canary-proof"],
                            "require_dependability": False,
                        }
                    ],
                },
            )
        )
    )
    maintenance = asyncio.run(
        mission_control.mission_control_create_objective(
            mission_control.MissionControlCreateRequest(
                kind="maintenance",
                title="Repair queue intake canary",
                objective="User reports the maintenance intake canary should stay queued, claimed, and followed through from Mission Control.",
                session_key="session:mission-maintenance",
                channel="whatsapp",
                conversation_id="chat:mission:maintenance",
                maintenance={
                    "item_kind": "fix",
                    "max_active_items": 1,
                    "dependability_profile": dict(MINIMAL_PROFILE),
                    "reporting_policy": dict(ROADMAP_REPORTING),
                },
            )
        )
    )

    first_now = datetime(2026, 4, 1, tzinfo=timezone.utc)
    asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=(first_now + timedelta(minutes=3)).isoformat().replace("+00:00", "Z"),
            )
        )
    )

    board = mission_control.mission_control_objectives()
    assert board["summary"]["objective_count"] == 3
    assert board["summary"]["by_status"]["active"] >= 2
    assert any(row["objective_key"] == roadmap["objective"]["objective_key"] for row in board["objectives"])
    assert any("maintenance" in (row.get("source_types") or []) for row in board["objectives"])
    reports = mission_control.mission_control_reports()
    assert any(report["runtime_kind"] == "roadmap" for report in reports["reports"])
    assert any(report["runtime_kind"] == "delivery" for report in reports["reports"])

    roadmap_detail = mission_control.mission_control_objective_detail(roadmap["objective"]["objective_key"])
    delivery_detail = mission_control.mission_control_objective_detail(delivery["objective"]["objective_key"])
    maintenance_detail = mission_control.mission_control_objective_detail(maintenance["objective"]["objective_key"])

    assert roadmap_detail["objective"]["conversation_ownership"]["conversation_id"] == "chat:mission:roadmap"
    assert "dispatch_count" in roadmap_detail["objective"]["follow_up"]
    assert roadmap_detail["objective"]["session_plane"]["status"] in {"running", "scheduled", "active"}
    assert delivery_detail["objective"]["delivery"]["release_stage"] == "draft"
    assert "dispatch_count" in delivery_detail["objective"]["follow_up"]
    assert maintenance_detail["objective"]["queue"]["status"] == "active"
    assert maintenance_detail["objective"]["queue"]["item_kind"] == "fix"
    assert maintenance_detail["objective"]["session_plane"]["watcher_count"] >= 1
    assert "dispatch_count" in maintenance_detail["objective"]["follow_up"]
    assert "by_session_status" in board["summary"]
    assert "session_counts" in board["summary"]["maintenance_queue"]
    assert isinstance(sent, list)



def test_mission_control_acknowledges_blockers_and_pauses_then_resumes_live_objectives(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    roadmap = asyncio.run(
        mission_control.mission_control_create_objective(
            mission_control.MissionControlCreateRequest(
                kind="roadmap",
                title="Blocked mission roadmap",
                objective="Create a roadmap objective that can surface a true human blocker.",
                roadmap={
                    "dependability_profile": dict(MINIMAL_PROFILE),
                    "reporting_policy": dict(ROADMAP_REPORTING),
                    "phases": [{"phase_id": "runtime", "title": "Runtime"}],
                    "tasks": [
                        {
                            "task_id": "blocked_step",
                            "phase_id": "runtime",
                            "title": "Wait for an operator decision",
                            "work_type": "feature",
                        }
                    ],
                },
            )
        )
    )
    process_id = roadmap["objective"]["process_id"]
    stores = orchestrator._runtime_delivery_stores()
    shared_state = stores["shared_state_store"].load(process_id)
    stores["shared_state_store"].save(
        {
            **_dump(shared_state),
            "revision_id": f"{shared_state.revision_id}.human",
            "open_questions": ["HUMAN: choose whether the roadmap should ship tonight"],
        },
        expected_revision_id=shared_state.revision_id,
        actor="pytest",
        provenance={"phase": "inject_human_blocker"},
    )
    asyncio.run(
        orchestrator.reconcile_runtime_roadmap(
            process_id,
            orchestrator.RuntimeRoadmapReconcileRequest(
                controller_id="pytest",
                controller_session_id="pytest:blocker",
                dependability_profile=dict(MINIMAL_PROFILE),
                reporting_policy=dict(ROADMAP_REPORTING),
            ),
        )
    )

    blocked = mission_control.mission_control_objective_detail(roadmap["objective"]["objective_key"])
    blocker = blocked["objective"]["blockers"][0]
    assert blocked["objective"]["status"] == "blocked"
    assert blocker["acknowledged"] is False

    acknowledged = mission_control.mission_control_objective_action(
        roadmap["objective"]["objective_key"],
        mission_control.MissionControlActionRequest(
            action="acknowledge_blocker",
            actor="operator",
            blocker_fingerprint=blocker["fingerprint"],
            note="Saw it, waiting on the human decision",
        ),
    )
    assert acknowledged["objective"]["blockers"][0]["acknowledged"] is True
    assert acknowledged["objective"]["shared_state"]["operator_overrides"]["mission_control"]["acknowledged_blockers"][blocker["fingerprint"]]["actor"] == "operator"

    delivery = asyncio.run(
        mission_control.mission_control_create_objective(
            mission_control.MissionControlCreateRequest(
                kind="delivery",
                title="Pauseable mission delivery",
                objective="Create a live delivery objective that Mission Control can pause and resume.",
                delivery={
                    "dependability_profile": dict(MINIMAL_PROFILE),
                    "checkpoint_policy": dict(DELIVERY_REPORTING),
                    "initial_release_stage": "draft",
                    "promotion_stages": ["build_verified", "canary_verified", "production"],
                    "completion_criteria": [
                        {
                            "criterion_id": "release-stage",
                            "summary": "Release must reach production",
                            "kind": "release_stage",
                            "stage": "production",
                        }
                    ],
                    "stage_gates": [
                        {
                            "stage": "production",
                            "required_fencepost_stages": ["build_verified"],
                            "required_artifacts": ["artifact:manual-approval-missing"],
                            "require_dependability": False,
                        }
                    ],
                },
            )
        )
    )
    paused = mission_control.mission_control_objective_action(
        delivery["objective"]["objective_key"],
        mission_control.MissionControlActionRequest(action="pause", actor="operator"),
    )
    resumed = mission_control.mission_control_objective_action(
        delivery["objective"]["objective_key"],
        mission_control.MissionControlActionRequest(action="resume", actor="operator"),
    )

    assert paused["objective"]["status"] == "paused"
    assert paused["objective"]["process"]["enabled"] is False
    assert resumed["objective"]["status"] == "active"
    assert resumed["objective"]["process"]["enabled"] is True



def test_mission_control_requeues_completed_maintenance_work_and_reclaims_capacity(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    maintenance = asyncio.run(
        mission_control.mission_control_create_objective(
            mission_control.MissionControlCreateRequest(
                kind="maintenance",
                title="Requeueable maintenance item",
                objective="This maintenance item should complete, requeue, then claim a fresh process.",
                maintenance={
                    "item_kind": "task",
                    "max_active_items": 1,
                    "dependability_profile": dict(MINIMAL_PROFILE),
                    "reporting_policy": dict(ROADMAP_REPORTING),
                },
            )
        )
    )

    first_now = datetime(2026, 4, 2, tzinfo=timezone.utc)
    asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=first_now.isoformat().replace("+00:00", "Z"),
            )
        )
    )
    detail = mission_control.mission_control_objective_detail(maintenance["objective"]["objective_key"])
    original_process_id = detail["objective"]["process_id"]
    assert detail["objective"]["queue"]["status"] == "active"

    stores = orchestrator._runtime_delivery_stores()
    _mark_item_done(stores=stores, detail=detail)
    asyncio.run(
        orchestrator.reconcile_runtime_roadmap(
            original_process_id,
            orchestrator.RuntimeRoadmapReconcileRequest(
                controller_id="pytest",
                controller_session_id="pytest:maintenance:complete",
                now_iso=(first_now + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
            ),
        )
    )

    completed = mission_control.mission_control_objective_detail(maintenance["objective"]["objective_key"])
    assert completed["objective"]["status"] == "completed"
    assert completed["objective"]["queue"]["status"] == "completed"

    requeued = mission_control.mission_control_objective_action(
        maintenance["objective"]["objective_key"],
        mission_control.MissionControlActionRequest(action="requeue", actor="operator", note="run it again"),
    )
    assert requeued["objective"]["queue"]["status"] == "pending"
    assert requeued["objective"]["process_id"].endswith("_rq1")

    asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=(first_now + timedelta(minutes=2)).isoformat().replace("+00:00", "Z"),
            )
        )
    )
    reclaimed = mission_control.mission_control_objective_detail(maintenance["objective"]["objective_key"])

    assert reclaimed["objective"]["queue"]["status"] == "active"
    assert reclaimed["objective"]["process_id"] is not None
    assert reclaimed["objective"]["process_id"] != original_process_id
    assert reclaimed["queue_item"]["metadata"]["mission_control_requeue_count"] == 1


def test_mission_control_activity_feed_surfaces_agent_evidence(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    roadmap = asyncio.run(
        mission_control.mission_control_create_objective(
            mission_control.MissionControlCreateRequest(
                kind="roadmap",
                title="Observable roadmap",
                objective="Give Mission Control enough evidence to render a live agent activity feed.",
                roadmap={
                    "dependability_profile": dict(MINIMAL_PROFILE),
                    "reporting_policy": dict(ROADMAP_REPORTING),
                    "phases": [{"phase_id": "runtime", "title": "Runtime"}],
                    "tasks": [
                        {
                            "task_id": "visible_work",
                            "phase_id": "runtime",
                            "title": "Emit live roadmap evidence",
                            "work_type": "feature",
                        }
                    ],
                },
            )
        )
    )

    process_id = roadmap["objective"]["process_id"]
    mission_control.mission_control_objective_action(
        roadmap["objective"]["objective_key"],
        mission_control.MissionControlActionRequest(action="pause", actor="operator"),
    )
    mission_control.mission_control_objective_action(
        roadmap["objective"]["objective_key"],
        mission_control.MissionControlActionRequest(action="resume", actor="operator"),
    )
    scheduler.record_process_event(process_id, "tool_call_started", {"agent_id": "cortex", "scope": "task:visible_work", "tool": "pytest", "command_text": "pytest -q tests/test_runtime.py", "command_kind": "test"})
    scheduler.record_process_event(process_id, "command_stdout", {"agent_id": "cortex", "scope": "task:visible_work", "chunk": "tests/test_runtime.py::test_visible_work PASSED"})
    scheduler.record_process_event(process_id, "file_written", {"agent_id": "cortex", "scope": "task:visible_work", "file_path": "/tmp/visible_work.py"})
    scheduler.record_process_event(process_id, "git_diff_snapshot", {"agent_id": "cortex", "scope": "task:visible_work", "repo_path": "/tmp/repo", "stat_preview": "visible_work.py | 12 ++++++++++++"})

    feed = mission_control.mission_control_objective_activity(roadmap["objective"]["objective_key"], limit=25)
    lineage = mission_control.mission_control_objective_lineage(roadmap["objective"]["objective_key"], limit=25)
    capabilities = mission_control.mission_control_capabilities()

    assert feed["stats"]["agent_count"] >= 1
    assert any(row["agent_id"] == "cortex" for row in feed["agents"])
    assert any(row["source"] == "runtime_event" for row in feed["timeline"])
    assert any("visible_work" in str(row.get("scope") or row.get("summary") or "") for row in feed["timeline"])
    assert feed["stats"]["command_count"] >= 1
    assert feed["stats"]["output_count"] >= 1
    assert feed["stats"]["file_count"] >= 1
    assert feed["stats"]["git_count"] >= 1
    assert feed["stats"]["test_count"] >= 1
    assert any("pytest" in str(row.get("summary") or "") for row in feed["streams"]["commands"])
    assert lineage["summary"]["observed_count"] >= 1
    assert lineage["summary"]["inferred_count"] >= 1
    assert any(row["memory_kind"] == "preference" for row in lineage["classes"]["learned_memory"]) is False
    assert any(row["event_kind"] == "command_stdout" for row in lineage["classes"]["observed_evidence"])
    assert any(row["fact_kind"] == "process_status" for row in lineage["classes"]["inferred_state"])
    assert capabilities["capability_matrix"]["version"] == "cortex.evidence.capability_matrix.v1"


def test_mission_control_surfaces_session_plane_blockers_and_summary(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(
        orchestrator,
        "resilient_delivery_attempt",
        lambda dependency, operation, **kwargs: {"success": True, "dependency": dependency, "queued": False, "result": operation()},
    )
    orchestrator.workflows.clear()

    maintenance = asyncio.run(
        mission_control.mission_control_create_objective(
            mission_control.MissionControlCreateRequest(
                kind="maintenance",
                title="Session plane blocker objective",
                objective="Mission Control should reflect live session blockers.",
                session_key="session:mission:blocker",
                channel="whatsapp",
                conversation_id="chat:mission:blocker",
                maintenance={
                    "item_kind": "fix",
                    "max_active_items": 1,
                    "dependability_profile": dict(MINIMAL_PROFILE),
                    "reporting_policy": dict(ROADMAP_REPORTING),
                },
            )
        )
    )

    now = datetime(2026, 4, 2, tzinfo=timezone.utc)
    asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=now.isoformat().replace("+00:00", "Z"),
            )
        )
    )

    detail = mission_control.mission_control_objective_detail(maintenance["objective"]["objective_key"])
    session_plane = detail["objective"]["session_plane"]
    process_id = detail["objective"]["process_id"]
    asyncio.run(
        orchestrator.record_runtime_session_event(
            orchestrator.RuntimeSessionEventRequest(
                process_id=process_id,
                event="session.blocked",
                session_id=session_plane["session_id"],
                session_name=session_plane["session_name"],
                tool="codex",
                summary="need mission control decision",
            )
        )
    )

    board = mission_control.mission_control_objectives()
    detail = mission_control.mission_control_objective_detail(maintenance["objective"]["objective_key"])
    activity = mission_control.mission_control_objective_activity(maintenance["objective"]["objective_key"], limit=20)

    assert detail["objective"]["status"] == "blocked"
    assert detail["objective"]["session_plane"]["status"] == "blocked"
    assert "need mission control decision" in detail["objective"]["session_plane"]["open_questions"]
    assert any(blocker["source"] == "session_plane" for blocker in detail["objective"]["blockers"])
    assert board["summary"]["by_session_status"]["blocked"] >= 1
    assert board["summary"]["session_open_question_count"] >= 1
    assert activity["objective"]["session_plane"]["status"] == "blocked"
