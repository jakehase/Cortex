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
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["release_stage"] == "production"
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["loop_status"] == "completed"
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["continuation"]["mode"] == "stop"
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["next_action"]["kind"] == "completed"
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["execution_budget"]["max_auto_chain_passes"] == 4
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["reporting_policy"]["report_every_iterations"] == 1
    assert reconciled["process"]["workflow"]["metadata"]["runtime_delivery"]["execution_discipline"]["latest_decisions"]["status"] == "completed"
    assert reconciled["process"]["workflow"]["metadata"]["delivery_continuation_mode"] == "stop"
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
    assert rolled_back["process"]["status"] == "running"
    assert rolled_back["process"]["nodes"]["build"]["status"] == "running"
    assert rolled_back["delivery"]["shared_state"]["revision_id"].endswith(".rollback")
    assert rolled_back["delivery"]["loop_state"]["status"] == "active"
    assert rolled_back["delivery"]["loop_state"]["current_stage"] == "build_verified"
    assert rolled_back["delivery"]["latest_report"]["kind"] == "rollback"
    assert rolled_back["delivery"]["latest_report"]["metadata"]["rollback_reason"] == "post-push regression"
    assert rolled_back["process"]["workflow"]["metadata"]["runtime_delivery"]["release_stage"] == "build_verified"
    assert rolled_back["loop_checkpoint"]["report"]["kind"] == "rollback"
    assert rolled_back["rollback_event"]["kind"] == "release_rolled_back"


def test_runtime_tick_watchdog_reconciles_live_delivery_without_prompt_and_persists_ownership(tmp_path, monkeypatch):
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
        "conversation_id": "chat:delivery-watchdog",
    }
    process = scheduler.create_process_from_workflow(
        workflow,
        process_id="proc_runtime_delivery_watchdog",
        owner="cortex",
        session_key="session:delivery",
    )

    first_now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_delivery(
            process["process_id"],
            orchestrator.RuntimeDeliveryReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-runtime-delivery-watchdog",
                now_iso=first_now.isoformat().replace("+00:00", "Z"),
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
    status = asyncio.run(orchestrator.get_runtime_delivery_status(process["process_id"]))
    stores = orchestrator._runtime_delivery_stores()
    follow_ups = stores["follow_up_store"].list(process_id=process["process_id"], runtime_kind="delivery")

    assert tick["watchdog"]["action_count"] >= 1
    assert status["loop_state"]["liveness"] == "live"
    assert status["loop_state"]["last_watchdog_decision"]["decision"] in {"report_status", "auto_resume"}
    assert status["loop_state"]["conversation_ownership"]["owner"] == "cortex"
    assert status["loop_state"]["conversation_ownership"]["session_key"] == "session:delivery"
    assert status["loop_state"]["conversation_ownership"]["channel"] == "whatsapp"
    assert status["loop_state"]["follow_through"]["resume_on_next_tick"] is True
    assert status["loop_state"]["follow_through"]["pending_update_intent"]["kind"] == "status"
    assert status["loop_state"]["follow_through"]["outbound_update"]["delivery_status"] == "sent"
    assert status["process"]["workflow"]["metadata"]["runtime_delivery"]["conversation_ownership"]["conversation_id"] == "chat:delivery-watchdog"
    assert status["process"]["workflow"]["metadata"]["delivery_follow_up_due_at"] is not None
    assert len(sent) == 2
    assert len(follow_ups) == 2
    assert all(row.delivery_status == "sent" for row in follow_ups)
    assert any("runtime_delivery_route" in row["message"] for row in sent)

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
    assert len(sent) == 2
    assert len(stores["follow_up_store"].list(process_id=process["process_id"], runtime_kind="delivery")) == 2



def test_runtime_delivery_reconcile_proactively_dispatches_true_human_blocker(tmp_path, monkeypatch):
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
        "conversation_id": "chat:delivery-blocker",
    }
    process = scheduler.create_process_from_workflow(
        workflow,
        process_id="proc_runtime_delivery_blocker",
        owner="cortex",
        session_key="session:delivery",
    )

    stores = orchestrator._runtime_delivery_stores()
    orchestrator._bootstrap_runtime_delivery_state(process["process_id"], process=process, stores=stores)
    shared_state = stores["shared_state_store"].load(process["process_id"])
    stores["shared_state_store"].save(
        {
            **orchestrator.model_dump_compat(shared_state),
            "open_questions": ["HUMAN: choose whether this should ship tonight"],
        },
        expected_revision_id=shared_state.revision_id,
        actor="test",
        provenance={"phase": "inject_human_blocker"},
    )

    reconciled = asyncio.run(
        orchestrator.reconcile_runtime_delivery(
            process["process_id"],
            orchestrator.RuntimeDeliveryReconcileRequest(
                controller_id="controller",
                controller_session_id="sess-runtime-delivery-blocker",
                dependability_profile=dict(MINIMAL_PROFILE),
                completion_criteria=[
                    {
                        "criterion_id": "release-stage",
                        "summary": "Release must reach production",
                        "kind": "release_stage",
                        "stage": "production",
                    }
                ],
                checkpoint_policy={
                    "report_every_iterations": 10,
                    "live_review_seconds": 60,
                    "proactive_report_seconds": 120,
                    "blocker_followup_seconds": 60,
                },
            ),
        )
    )
    status = asyncio.run(orchestrator.get_runtime_delivery_status(process["process_id"]))
    follow_ups = stores["follow_up_store"].list(process_id=process["process_id"], runtime_kind="delivery")

    assert reconciled["state"]["status"] == "blocked"
    assert reconciled["follow_up_dispatch"]["delivery_status"] == "sent"
    assert status["loop_state"]["follow_through"]["outbound_update"]["delivery_status"] == "sent"
    assert len(sent) == 1
    assert len(follow_ups) == 1
    assert follow_ups[0].delivery_status == "sent"
    assert "Need from you" in sent[0]["message"]
