from __future__ import annotations

import asyncio

import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator


MINIMAL_PROFILE = {
    "profile": "runtime-delivery-test",
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



def test_runtime_delivery_routes_bootstrap_reconcile_and_rollback(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    process = scheduler.create_process_from_workflow(
        _workflow(),
        process_id="proc_runtime_delivery",
        owner="cortex",
        session_key="session:delivery",
    )

    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_delivery(
            process["process_id"],
            orchestrator.RuntimeDeliveryReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-runtime-delivery",
                initial_release_stage="build_verified",
                promotion_stages=["build_verified", "production"],
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
                dependability_profile=dict(MINIMAL_PROFILE),
            ),
        )
    )

    stores = orchestrator._runtime_delivery_stores()
    messages = stores["mailbox"].list(process_id=process["process_id"])

    assert reconciled["success"] is True
    assert reconciled["state"]["status"] == "completed"
    assert reconciled["delivery"]["release_state"]["current_stage"] == "production"
    assert reconciled["delivery"]["snapshot"]["process_id"] == process["process_id"]
    assert any(message.to_agent == "release-manager" and message.delivery_status == "acked" for message in messages)
    assert any(fencepost["stage"] == "production" for fencepost in reconciled["delivery"]["release_state"]["rollback_fenceposts"])

    rolled_back = asyncio.run(
        orchestrator.rollback_runtime_delivery(
            process["process_id"],
            orchestrator.RuntimeDeliveryRollbackRequest(stage="build_verified", actor="controller", reason="post-push regression"),
        )
    )

    assert rolled_back["success"] is True
    assert rolled_back["state"]["current_stage"] == "build_verified"
    assert rolled_back["state"]["metadata"]["rollback_applied"] is True
    assert rolled_back["delivery"]["shared_state"]["revision_id"].endswith(".rollback")
    assert rolled_back["rollback_event"]["kind"] == "release_rolled_back"
