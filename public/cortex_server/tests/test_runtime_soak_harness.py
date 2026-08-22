from __future__ import annotations

from cortex_server.runtime import RuntimeSoakHarness, build_soak_profile, compile_audit_playback, detect_stale_revision



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
    assert report["accepted_count"] == 0
    assert report["delivery_status"] == "dead_letter"
    assert report["rejection_metadata"]["rejection_reason"] == "stale_revision"
    assert report["stale_revision"] is True
    assert report["expected_revision_id"] == "rev_9"
    assert report["observed_revision_id"] == "rev_8"



def test_runtime_soak_harness_suite_runs_all_core_scenarios(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)

    report = harness.run_suite(process_prefix="durable", elapsed_waits=[0.01, 0.02])

    assert report["success"] is True
    assert report["scenario_count"] == 12
    assert report["wait_matrix_seconds"] == [0.0, 0.01, 0.02]
    assert len(report["scenarios"]) == 12
    assert report["audit_playback"]["scenario_count"] == 12



def test_runtime_soak_harness_can_recover_dead_letters(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")

    report = harness.run_dead_letter_recovery_scenario(process_id="proc_dead_letter")

    assert report["first_receive_count"] == 0
    assert report["recovery_count"] == 1
    assert report["recovered_revision_id"] == "rev_2"
    assert report["second_receive_count"] == 1
    assert report["recovery_succeeded"] is True



def test_runtime_soak_harness_elapsed_wait_profile_runs_multiple_waits(tmp_path):
    waits = []
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: waits.append(seconds))

    reports = harness.run_elapsed_wait_profile(process_prefix="profile", elapsed_waits=[0.05, 0.1, 0.25])

    assert len(reports) == 4
    assert waits == [0.05, 0.1, 0.25]
    assert all(row["resumed_without_loss"] is True for row in reports)



def test_runtime_soak_harness_release_delivery_preserves_handoffs_and_safe_push(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")

    report = harness.run_release_delivery_scenario(process_id="proc_release_delivery")

    assert report["promotion_safe"] is True
    assert report["repair_success"] is True
    assert report["handoff_continuity_ok"] is True
    assert report["rollback_ready"] is True
    assert report["repair_blocker_count_before"] >= 1
    assert report["repair_blocker_count_after"] == 0
    assert report["final_stage"] == "production"
    assert report["history_count"] >= 4



def test_runtime_soak_harness_blocks_duplicate_claims_and_allows_replacement_after_stale(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")

    report = harness.run_duplicate_claim_block_scenario(process_id="proc_duplicate")

    assert report["duplicate_claim_blocked"] is True
    assert report["initial_lease_id"] == report["same_agent_lease_id"]
    assert report["replacement_agent_id"] == "researcher"



def test_runtime_soak_harness_rollback_recovery_restores_state(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")

    report = harness.run_rollback_recovery_scenario(process_id="proc_rollback")

    assert report["rollback_restored"] is True
    assert report["replayed_state"]["lifecycle_state"] == "waiting"
    assert report["replayed_state"]["waiting_steps"] == ["step1"]
    assert report["replayed_state"]["belief_refs"] == []



def test_runtime_soak_harness_detects_shared_state_conflicts(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")

    report = harness.run_shared_state_conflict_scenario(process_id="proc_conflict")

    assert report["conflict_detected"] is True
    assert report["conflict"] is True



def test_runtime_soak_harness_can_rollback_shared_state(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak")

    report = harness.run_shared_state_rollback_scenario(process_id="proc_state_rollback")

    assert report["rollback_restored"] is True
    assert report["rolled_revision_id"] == "rev_3"



def test_runtime_soak_profiles_and_audit_playback(tmp_path):
    harness = RuntimeSoakHarness(tmp_path / "soak", sleep_fn=lambda seconds: None)

    profile_2h = build_soak_profile("2h")
    profile_4h = build_soak_profile("4h")
    profile_8h = build_soak_profile("8h")
    report = harness.run_profile("2h", process_prefix="profile2h")
    playback = compile_audit_playback(report)

    assert profile_2h["intended_duration_hours"] == 2
    assert profile_4h["intended_duration_hours"] == 4
    assert profile_8h["intended_duration_hours"] == 8
    assert report["success"] is True
    assert report["profile"]["profile"] == "2h"
    assert playback["scenario_count"] == report["scenario_count"]
