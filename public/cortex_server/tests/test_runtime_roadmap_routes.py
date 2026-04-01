from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator


def _install_fake_diplomat(monkeypatch):
    sent = []

    class _FakeDiplomat:
        def send_briefing(self, message: str, title: str = "[Cortex] Runtime update") -> bool:
            sent.append({"title": title, "message": message})
            return True

    monkeypatch.setattr(orchestrator, "get_diplomat", lambda: _FakeDiplomat())
    return sent


MINIMAL_PROFILE = {
    "profile": "runtime-roadmap-test",
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



def _workflow() -> dict:
    return {
        "name": "runtime_roadmap_route",
        "metadata": {"owner": "cortex", "session_key": "session:roadmap"},
        "steps": [
            {
                "node_id": "build",
                "title": "Build",
                "endpoint": "/oracle/chat",
                "payload": {"message": "ship it"},
            }
        ],
    }



def test_runtime_tick_watchdog_reconciles_live_roadmap_without_prompt(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    process = scheduler.create_process_from_workflow(
        _workflow(),
        process_id="proc_runtime_roadmap_watchdog",
        owner="cortex",
        session_key="session:roadmap",
    )

    first_now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_roadmap(
            process["process_id"],
            orchestrator.RuntimeRoadmapReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-runtime-roadmap-watchdog",
                now_iso=first_now.isoformat().replace("+00:00", "Z"),
                dependability_profile=dict(MINIMAL_PROFILE),
                reporting_policy={
                    "report_every_iterations": 10,
                    "live_review_seconds": 60,
                    "proactive_report_seconds": 120,
                    "blocker_followup_seconds": 60,
                },
                phases=[{"phase_id": "runtime", "title": "Runtime"}],
                tasks=[
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
                success_criteria=[
                    {
                        "criterion_id": "build-done",
                        "summary": "build_done must become true",
                        "kind": "world_state",
                        "world_state_key": "build_done",
                        "expected_value": True,
                    }
                ],
            ),
        )
    )
    assert reconciled["state"]["status"] == "active"

    tick = asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=(first_now + timedelta(minutes=3)).isoformat().replace("+00:00", "Z"),
            )
        )
    )
    status = asyncio.run(orchestrator.get_runtime_roadmap_status(process["process_id"]))

    assert tick["watchdog"]["action_count"] >= 1
    assert status["state"]["liveness"] == "live"
    assert status["state"]["last_watchdog_decision"]["decision"] in {"report_status", "auto_resume"}
    assert status["report_count"] >= 2
    assert any(reason in status["latest_report"]["metadata"]["reasons"] for reason in ["review_due", "status_followup_due", "idle_recovery"])
    assert status["process"]["workflow"]["metadata"]["runtime_roadmap"]["last_watchdog_decision"]["decision"] in {"report_status", "auto_resume"}
    assert status["process"]["workflow"]["metadata"]["runtime_roadmap"]["owed_follow_up"]["owed"] is True



def test_runtime_tick_watchdog_dispatches_roadmap_follow_up_once(tmp_path, monkeypatch):
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
        "conversation_id": "chat:roadmap-watchdog",
    }
    process = scheduler.create_process_from_workflow(
        workflow,
        process_id="proc_runtime_roadmap_followup",
        owner="cortex",
        session_key="session:roadmap",
    )

    first_now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_roadmap(
            process["process_id"],
            orchestrator.RuntimeRoadmapReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-runtime-roadmap-followup",
                now_iso=first_now.isoformat().replace("+00:00", "Z"),
                dependability_profile=dict(MINIMAL_PROFILE),
                reporting_policy={
                    "report_every_iterations": 10,
                    "live_review_seconds": 60,
                    "proactive_report_seconds": 120,
                    "blocker_followup_seconds": 60,
                },
                phases=[{"phase_id": "runtime", "title": "Runtime"}],
                tasks=[
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
                success_criteria=[
                    {
                        "criterion_id": "build-done",
                        "summary": "build_done must become true",
                        "kind": "world_state",
                        "world_state_key": "build_done",
                        "expected_value": True,
                    }
                ],
            ),
        )
    )
    assert reconciled["state"]["status"] == "active"

    tick = asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=(first_now + timedelta(minutes=3)).isoformat().replace("+00:00", "Z"),
            )
        )
    )
    status = asyncio.run(orchestrator.get_runtime_roadmap_status(process["process_id"]))
    stores = orchestrator._runtime_delivery_stores()
    follow_ups = stores["follow_up_store"].list(process_id=process["process_id"], runtime_kind="roadmap")

    assert tick["watchdog"]["action_count"] >= 1
    assert status["state"]["follow_through"]["outbound_update"]["delivery_status"] == "sent"
    assert len(sent) == 1
    assert len(follow_ups) == 1
    assert follow_ups[0].delivery_status == "sent"
    assert "runtime_roadmap_route" in sent[0]["message"]

    second_tick = asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=(first_now + timedelta(minutes=3, seconds=15)).isoformat().replace("+00:00", "Z"),
            )
        )
    )
    assert second_tick["success"] is True
    assert len(sent) == 1
    assert len(stores["follow_up_store"].list(process_id=process["process_id"], runtime_kind="roadmap")) == 1



def test_runtime_roadmap_routes_bootstrap_reconcile_and_sync_metadata(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    process = scheduler.create_process_from_workflow(
        _workflow(),
        process_id="proc_runtime_roadmap",
        owner="cortex",
        session_key="session:roadmap",
    )

    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_roadmap(
            process["process_id"],
            orchestrator.RuntimeRoadmapReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-runtime-roadmap",
                dependability_profile=dict(MINIMAL_PROFILE),
                phases=[{"phase_id": "runtime", "title": "Runtime"}],
                tasks=[
                    {
                        "task_id": "observe_bootstrap",
                        "phase_id": "runtime",
                        "title": "Observe the bootstrapped workflow name",
                        "work_type": "reliability",
                        "quality_gates": [
                            {
                                "criterion_id": "workflow-name",
                                "summary": "The bootstrapped workflow name should be present",
                                "kind": "world_state",
                                "world_state_key": "workflow_name",
                                "expected_value": "runtime_roadmap_route",
                            }
                        ],
                    }
                ],
                success_criteria=[
                    {
                        "criterion_id": "workflow-name",
                        "summary": "The workflow name should remain present",
                        "kind": "world_state",
                        "world_state_key": "workflow_name",
                        "expected_value": "runtime_roadmap_route",
                    }
                ],
            ),
        )
    )

    status = asyncio.run(orchestrator.get_runtime_roadmap_status(process["process_id"]))

    assert reconciled["success"] is True
    assert reconciled["state"]["status"] == "completed"
    assert reconciled["roadmap"]["state"]["active_phase_id"] is None
    assert status["state"]["status"] == "completed"
    assert status["latest_report"]["kind"] == "completed"
    assert reconciled["process"]["workflow"]["metadata"]["runtime_roadmap"]["status"] == "completed"
    assert reconciled["process"]["workflow"]["metadata"]["runtime_roadmap"]["continuation"]["mode"] == "stop"
    assert reconciled["process"]["workflow"]["metadata"]["runtime_roadmap"]["next_action"]["kind"] == "completed"
    assert reconciled["process"]["workflow"]["metadata"]["runtime_roadmap"]["execution_budget"]["max_auto_chain_passes"] == 4
    assert reconciled["process"]["workflow"]["metadata"]["runtime_roadmap"]["reporting_policy"]["report_every_iterations"] == 1
    assert reconciled["process"]["workflow"]["metadata"]["runtime_roadmap"]["execution_discipline"]["latest_decisions"]["status"] == "completed"
    assert reconciled["process"]["workflow"]["metadata"]["runtime_roadmap"]["progress_snapshot"]["task_completed"] == 1
    assert reconciled["process"]["workflow"]["metadata"]["runtime_roadmap"]["latest_report_progress"]["task_completed"] == 1
    assert reconciled["process"]["workflow"]["metadata"]["roadmap_status"] == "completed"
    assert reconciled["process"]["workflow"]["metadata"]["roadmap_continuation_mode"] == "stop"
    assert reconciled["process"]["workflow"]["metadata"]["roadmap_executor"]["objective"] == "runtime_roadmap_route"
