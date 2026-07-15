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
    "profile": "runtime-no-silent-idle-canary",
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



def _workflow(name: str, *, owner: str, session_key: str, channel: str, conversation_id: str) -> dict:
    return {
        "name": name,
        "metadata": {
            "owner": owner,
            "session_key": session_key,
            "channel": channel,
            "conversation_id": conversation_id,
        },
        "steps": [
            {
                "node_id": "build",
                "title": "Build",
                "endpoint": "/oracle/chat",
                "payload": {"message": "ship it"},
            }
        ],
    }



def test_runtime_tick_canary_keeps_mixed_objectives_owned_live_and_non_idle(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime.db"
    delivery_root = tmp_path / "delivery"

    sent = _install_fake_diplomat(monkeypatch)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", delivery_root)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    roadmap_process = scheduler.create_process_from_workflow(
        _workflow(
            "roadmap_canary",
            owner="cortex",
            session_key="session:canary:roadmap",
            channel="whatsapp",
            conversation_id="chat:canary:roadmap",
        ),
        process_id="proc_canary_roadmap",
        owner="cortex",
        session_key="session:canary:roadmap",
    )
    delivery_process = scheduler.create_process_from_workflow(
        _workflow(
            "delivery_canary",
            owner="cortex",
            session_key="session:canary:delivery",
            channel="whatsapp",
            conversation_id="chat:canary:delivery",
        ),
        process_id="proc_canary_delivery",
        owner="cortex",
        session_key="session:canary:delivery",
    )

    first_now = datetime(2026, 2, 1, tzinfo=timezone.utc)
    roadmap = asyncio.run(
        orchestrator.reconcile_runtime_roadmap(
            roadmap_process["process_id"],
            orchestrator.RuntimeRoadmapReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-canary-roadmap",
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
    delivery = asyncio.run(
        orchestrator.reconcile_runtime_delivery(
            delivery_process["process_id"],
            orchestrator.RuntimeDeliveryReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-canary-delivery",
                now_iso=first_now.isoformat().replace("+00:00", "Z"),
                initial_release_stage="draft",
                promotion_stages=["build_verified", "canary_verified", "production"],
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
                        "required_artifacts": ["artifact:missing-canary-proof"],
                        "require_dependability": False,
                    }
                ],
                checkpoint_policy={
                    "report_every_iterations": 10,
                    "live_review_seconds": 60,
                    "proactive_report_seconds": 120,
                    "blocker_followup_seconds": 60,
                },
                dependability_profile=dict(MINIMAL_PROFILE),
            ),
        )
    )

    assert roadmap["state"]["status"] == "active"
    assert delivery["state"]["status"] == "active"
    stores = orchestrator._runtime_delivery_stores()
    controller_lease_expiries = [
        datetime.fromisoformat(row.expires_at.replace("Z", "+00:00"))
        for row in stores["supervisor"].list(status="active")
        if row.scope in {
            f"roadmap_executor:{roadmap_process['process_id']}",
            f"production_build_loop:{delivery_process['process_id']}",
        }
    ]
    assert len(controller_lease_expiries) == 2
    watchdog_now = max(controller_lease_expiries) + timedelta(seconds=1)

    tick = asyncio.run(
        orchestrator.tick_runtime(
            orchestrator.RuntimeTickRequest(
                limit=10,
                execute=False,
                now_iso=watchdog_now.isoformat().replace("+00:00", "Z"),
            )
        )
    )
    roadmap_status = asyncio.run(orchestrator.get_runtime_roadmap_status(roadmap_process["process_id"]))
    delivery_status = asyncio.run(orchestrator.get_runtime_delivery_status(delivery_process["process_id"]))

    assert tick["watchdog"]["action_count"] >= 2
    assert roadmap_status["state"]["last_watchdog_decision"]["decision"] in {"report_status", "auto_resume"}
    assert delivery_status["loop_state"]["last_watchdog_decision"]["decision"] in {"report_status", "auto_resume"}
    assert roadmap_status["state"]["conversation_ownership"]["conversation_id"] == "chat:canary:roadmap"
    assert delivery_status["loop_state"]["conversation_ownership"]["conversation_id"] == "chat:canary:delivery"
    assert roadmap_status["state"]["follow_through"]["pending_update_intent"]["kind"] == "status"
    assert delivery_status["loop_state"]["follow_through"]["pending_update_intent"]["kind"] == "status"
    assert roadmap_status["state"]["follow_through"]["outbound_update"]["delivery_status"] == "sent"
    assert delivery_status["loop_state"]["follow_through"]["outbound_update"]["delivery_status"] == "sent"
    assert roadmap_status["process"]["workflow"]["metadata"]["roadmap_follow_up_due_at"] is not None
    assert delivery_status["process"]["workflow"]["metadata"]["delivery_follow_up_due_at"] is not None
    assert len(sent) == 3
