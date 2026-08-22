from __future__ import annotations

from cortex_server.runtime import (
    HandoffArtifactRef,
    HandoffContract,
    HandoffEvidenceRef,
    OpenDecision,
    ProcessEvent,
    ProcessSnapshot,
    SharedProcessState,
    compile_handoff_context_view,
    compile_working_context_view,
)



def test_compile_working_context_view_merges_snapshot_shared_state_and_handoff():
    snapshot = ProcessSnapshot(
        process_id="proc_123",
        snapshot_id="snap_1",
        last_event_id="evt_2",
        lifecycle_state="waiting",
        active_steps=["step1"],
        waiting_steps=["step2"],
        runtime_policy={"verification_mode": "strict"},
        session_state={"status": "blocked", "open_questions": ["Need approval"]},
        world_state={"service": "degraded"},
        belief_refs=["claim-1"],
        artifact_refs=["artifact-1"],
    )
    state = SharedProcessState(
        process_id="proc_123",
        state_id="state_1",
        revision_id="rev_5",
        goals=["Stabilize service"],
        active_plan_node_ids=["step1", "step2"],
        open_decisions=[OpenDecision(decision_id="dec_1", title="Escalate?")],
        runtime_constraints={"execution_mode": "sequential"},
        world_state={"region": "us-central"},
        belief_refs=["claim-2"],
        open_questions=["Is it isolated?"],
        agent_ownership={"step1": "planner"},
    )
    handoff = HandoffContract(
        process_id="proc_123",
        from_agent="coordinator",
        to_agent="planner",
        source_revision="rev_4",
        objective="Investigate the degraded service",
        assumptions=["Use latest world-state"],
        relevant_evidence=[HandoffEvidenceRef(ref_id="claim-3")],
        relevant_artifacts=[HandoffArtifactRef(artifact_id="artifact-2")],
        open_questions=["What changed recently?"],
        expected_output="Return next actions",
    )
    events = [
        ProcessEvent(process_id="proc_123", event_id="evt_1", kind="process_created"),
        ProcessEvent(process_id="proc_123", event_id="evt_2", kind="process_waiting", payload={"node_id": "step2"}),
        ProcessEvent(process_id="proc_123", event_id="evt_3", kind="process_resumed", payload={"node_id": "step2"}),
    ]

    view = compile_working_context_view(
        snapshot=snapshot,
        shared_state=state,
        recent_events=events,
        agent_id="planner",
        handoff=handoff,
        max_recent_events=2,
        explicit_omissions=["full artifact body omitted"],
    )

    assert view.process_id == "proc_123"
    assert view.revision_id == "rev_5"
    assert view.source_snapshot_id == "snap_1"
    assert view.source_state_id == "state_1"
    assert view.source_handoff_id == handoff.handoff_id
    assert view.session_state["status"] == "blocked"
    assert view.ownership_scope == ["step1"]
    assert view.recent_event_ids == ["evt_2", "evt_3"]
    assert view.omitted_event_count == 1
    assert "Use latest world-state" in view.assumptions
    assert "claim-1" in view.belief_refs and "claim-2" in view.belief_refs
    assert "artifact-1" in view.artifact_refs and "artifact-2" in view.artifact_refs
    assert "Is it isolated?" in view.open_questions and "What changed recently?" in view.open_questions
    assert "full artifact body omitted" in view.explicit_omissions
    assert view.metadata["revision_guard"]["stale_revision"] is True
    assert view.metadata["stale_handoff_revision"] is True



def test_compile_handoff_context_view_surfaces_transfer_packet():
    snapshot = ProcessSnapshot(process_id="proc_123", snapshot_id="snap_1", lifecycle_state="running", active_steps=["step1"], session_state={"status": "running", "watcher_count": 2}, world_state={"service": "degraded"}, belief_refs=["claim-1"])
    state = SharedProcessState(
        process_id="proc_123",
        state_id="state_1",
        revision_id="rev_5",
        active_plan_node_ids=["step1"],
        runtime_constraints={"verification_mode": "strict"},
        world_state={"region": "us-central"},
        belief_refs=["claim-2"],
        open_questions=["Is it isolated?"],
    )
    handoff = HandoffContract(
        process_id="proc_123",
        from_agent="coordinator",
        to_agent="researcher",
        source_revision="rev_4",
        objective="Collect confirming evidence",
        assumptions=["Start from latest revision"],
        relevant_evidence=[HandoffEvidenceRef(ref_id="claim-3")],
        relevant_artifacts=[HandoffArtifactRef(artifact_id="artifact-2")],
        open_questions=["Did a deploy trigger this?"],
        expected_output="Return evidence and confidence notes",
        timeout_seconds=900,
        lease_seconds=600,
    )

    view = compile_handoff_context_view(handoff=handoff, shared_state=state, snapshot=snapshot)

    assert view.handoff_id == handoff.handoff_id
    assert view.process_id == "proc_123"
    assert view.from_agent == "coordinator"
    assert view.to_agent == "researcher"
    assert view.source_revision == "rev_4"
    assert view.current_revision == "rev_5"
    assert view.evidence_ref_ids == ["claim-3"]
    assert view.artifact_ref_ids == ["artifact-2"]
    assert view.lifecycle_state == "running"
    assert view.runtime_constraints["verification_mode"] == "strict"
    assert view.session_state["status"] == "running"
    assert view.world_state["service"] == "degraded"
    assert view.world_state["region"] == "us-central"
    assert "claim-1" in view.belief_refs and "claim-2" in view.belief_refs
    assert view.metadata["revision_guard"]["stale_revision"] is True
    assert view.metadata["stale_handoff_revision"] is True



def test_context_views_can_reject_stale_handoff_revision():
    snapshot = ProcessSnapshot(process_id="proc_123", snapshot_id="snap_1", lifecycle_state="running")
    state = SharedProcessState(process_id="proc_123", state_id="state_1", revision_id="rev_5")
    handoff = HandoffContract(
        process_id="proc_123",
        from_agent="coordinator",
        to_agent="researcher",
        source_revision="rev_4",
        objective="Collect confirming evidence",
        expected_output="Return evidence",
    )

    import pytest

    with pytest.raises(ValueError, match="stale revision detected"):
        compile_working_context_view(snapshot=snapshot, shared_state=state, handoff=handoff, reject_stale_revision=True)

    with pytest.raises(ValueError, match="stale revision detected"):
        compile_handoff_context_view(handoff=handoff, shared_state=state, snapshot=snapshot, reject_stale_revision=True)
