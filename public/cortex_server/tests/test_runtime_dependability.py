from __future__ import annotations

from datetime import datetime, timedelta, timezone

from cortex_server.runtime import (
    UNATTENDED_PROFILES,
    RuntimeSoakHarness,
    build_unattended_profile,
    compile_dependability_repair_plan,
    compile_dependability_report,
    load_dependability_report,
)
import cortex_server.runtime.dependability as dependability
import cortex_server.runtime.soak_harness as soak_harness



def test_runtime_package_exports_dependability_helpers():
    assert UNATTENDED_PROFILES is not None
    assert build_unattended_profile is not None
    assert compile_dependability_repair_plan is not None
    assert compile_dependability_report is not None
    assert load_dependability_report is not None



def test_runtime_soak_harness_unattended_campaign_reports_dependability(
    tmp_path, monkeypatch
):
    clock = [datetime(2026, 7, 1, tzinfo=timezone.utc)]
    monotonic_clock = [1000.0]

    def advance(seconds: float) -> None:
        clock[0] += timedelta(seconds=seconds)
        monotonic_clock[0] += seconds

    monkeypatch.setattr(
        soak_harness, "_soak_monotonic_now", lambda: monotonic_clock[0]
    )
    monkeypatch.setattr(
        dependability,
        "_dependability_monotonic_now",
        lambda: monotonic_clock[0],
    )

    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=advance, clock_fn=lambda: clock[0])

    report = harness.run_unattended_campaign("24h", process_prefix="campaign_24h")

    assert report["success"] is True
    assert report["dependability"]["success"] is True
    assert report["cycle_count"] == build_unattended_profile("24h")["campaign_cycles"]
    assert report["dependability"]["coverage"]["unique_agent_count"] >= 3
    assert report["dependability"]["mailbox"]["handoff_count"] >= 5
    assert report["dependability"]["revisions"]["history_count"] >= 6
    assert report["dependability"]["checks"]["replay_matches_snapshot"] is True
    assert len(report["timeline"]) == report["cycle_count"]



def test_dependability_repair_plan_maps_failing_checks_to_actions():
    plan = compile_dependability_repair_plan(
        {
            "failing_checks": [
                "checkpoint_freshness_ok",
                "dead_letter_budget_ok",
                "stale_lease_budget_ok",
                "revision_head_ok",
            ]
        }
    )

    actions = [row["action"] for row in plan["actions"]]
    assert "checkpoint_from_journal" in actions
    assert "recover_dead_letters" in actions
    assert "resolve_stale_leases" in actions
    assert "review_shared_state_parity" in actions
    assert "refresh_shared_state_revision" not in actions



def test_dependability_report_flags_dead_letters_and_checkpoint_drift(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")
    harness._seed_waiting_process(process_id="proc_unhealthy", revision_id="rev_1", node_id="plan", agent_id="planner")
    message = harness.mailbox.send(
        process_id="proc_unhealthy",
        from_agent="coordinator",
        to_agent="planner",
        kind="handoff",
        revision_id="rev_1",
        payload={"objective": "stale handoff"},
    )
    harness.mailbox.dead_letter(message.message_id)
    snapshot = harness.snapshot_store.load("proc_unhealthy")
    snapshot.event_count = 0
    harness.snapshot_store.save(snapshot)
    harness.journal.append(
        process_id="proc_unhealthy",
        kind="world_state_updated",
        revision_id="rev_1",
        actor="planner",
        payload={"world_state": {"status": "drifted"}},
    )

    report = load_dependability_report(
        process_id="proc_unhealthy",
        snapshot_store=harness.snapshot_store,
        shared_state_store=harness.shared_state_store,
        journal=harness.journal,
        mailbox=harness.mailbox,
        supervisor=harness.supervisor,
        profile="24h",
    )

    assert report["success"] is False
    assert "dead_letter_budget_ok" in report["failing_checks"]
    assert "snapshot_event_gap_ok" in report["failing_checks"]
    assert "multi_agent_coverage_ok" in report["failing_checks"]



def test_runtime_soak_harness_self_heals_injected_unattended_failures(
    tmp_path, monkeypatch
):
    clock = [datetime(2026, 7, 1, tzinfo=timezone.utc)]
    monotonic_clock = [2000.0]

    def advance(seconds: float) -> None:
        clock[0] += timedelta(seconds=seconds)
        monotonic_clock[0] += seconds

    monkeypatch.setattr(
        soak_harness, "_soak_monotonic_now", lambda: monotonic_clock[0]
    )
    monkeypatch.setattr(
        dependability,
        "_dependability_monotonic_now",
        lambda: monotonic_clock[0],
    )

    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=advance, clock_fn=lambda: clock[0])

    report = harness.run_self_healing_unattended_campaign("24h", process_prefix="campaign_self_heal")

    assert report["campaign"]["success"] is True
    assert report["injected"]["dependability_before_repair"]["success"] is False
    assert report["repaired"]["dependability_before"]["success"] is False
    assert report["repaired"]["dependability_after"]["success"] is True
    assert any(row["action"] == "recover_dead_letters" for row in report["repaired"]["actions_taken"])
    assert any(row["action"] == "checkpoint_from_journal" for row in report["repaired"]["actions_taken"])
