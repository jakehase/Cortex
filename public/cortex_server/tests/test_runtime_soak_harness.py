from __future__ import annotations

from cortex_server.runtime import RuntimeSoakHarness, detect_stale_revision



def test_detect_stale_revision_accepts_matching_revision():
    guard = detect_stale_revision("rev_2", "rev_2", source="mailbox")

    assert guard["accepted"] is True
    assert guard["stale_revision"] is False
    assert "accepted" in guard["operator_summary"]



def test_runtime_soak_harness_pause_resume_preserves_state(tmp_path):
    waits = []
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: waits.append(seconds))

    report = harness.run_pause_resume_scenario(process_id="proc_pause", wait_seconds=0.25)

    assert waits == [0.25]
    assert report["resumed_without_loss"] is True
    assert report["resume_state_before"]["lifecycle_state"] == "waiting"
    assert report["resume_state_after"]["lifecycle_state"] == "running"
    assert report["replayed_state"]["lifecycle_state"] == "running"



def test_runtime_soak_harness_restart_recovery_replays_snapshot_tail(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")

    report = harness.run_restart_recovery_scenario(process_id="proc_restart")

    assert report["recovered_from_tail"] is True
    assert report["replayed_state"]["world_state"]["restart_recovered"] is True
    assert "claim-restart-safe" in report["replayed_state"]["belief_refs"]



def test_runtime_soak_harness_reclaims_stale_agent_leases(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")

    report = harness.run_stale_agent_scenario(process_id="proc_stale_agent", lease_seconds=1, reclaim_after_seconds=10)

    assert report["stale_detected"] is True
    assert report["reclaimed_count"] >= 1



def test_runtime_soak_harness_detects_stale_revision_messages(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")

    report = harness.run_stale_revision_scenario(process_id="proc_stale_rev", current_revision_id="rev_9", stale_revision_id="rev_8")

    assert report["accepted"] is False
    assert report["stale_revision"] is True
    assert report["expected_revision_id"] == "rev_9"
    assert report["observed_revision_id"] == "rev_8"



def test_runtime_soak_harness_suite_runs_all_core_scenarios(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)

    report = harness.run_suite(process_prefix="durable")

    assert report["success"] is True
    assert report["scenario_count"] == 4
    assert len(report["scenarios"]) == 4
