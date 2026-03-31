from __future__ import annotations

import asyncio

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator


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
    assert reconciled["process"]["workflow"]["metadata"]["roadmap_status"] == "completed"
    assert reconciled["process"]["workflow"]["metadata"]["roadmap_executor"]["objective"] == "runtime_roadmap_route"
