from __future__ import annotations

from pathlib import Path

from cortex_server.modules.reasoning_runtime_explain import assemble_runtime_process_explain
from cortex_server.runtime import (
    AgentMailbox,
    AgentSupervisor,
    HandoffArtifactRef,
    HandoffContract,
    ProcessJournal,
    ProcessSnapshot,
    ProcessSnapshotStore,
    SharedProcessState,
    SharedProcessStateStore,
    compile_runtime_resume_state,
    load_runtime_resume_state,
)



def test_compile_runtime_resume_state_merges_durable_sources():
    snapshot = ProcessSnapshot(
        process_id="proc_123",
        snapshot_id="snap_1",
        last_event_id="evt_3",
        event_count=3,
        lifecycle_state="waiting",
        active_steps=["step1"],
        waiting_steps=["step2"],
        completed_steps=["step0"],
        assigned_agents={"step1": "planner"},
        runtime_policy={"verification_mode": "strict"},
        session_state={"status": "blocked", "retry_count": 2, "open_questions": ["Need API key"]},
        world_state={"service": "degraded"},
        belief_refs=["claim-1"],
        artifact_refs=["artifact-1"],
    )
    shared_state = SharedProcessState(
        process_id="proc_123",
        state_id="state_1",
        revision_id="rev_5",
        runtime_constraints={"execution_mode": "sequential"},
        world_state={"region": "us-central"},
        belief_refs=["claim-2"],
        open_questions=["Is it isolated?"],
        agent_ownership={"step2": "researcher"},
    )
    handoff = HandoffContract(
        process_id="proc_123",
        from_agent="coordinator",
        to_agent="researcher",
        source_revision="rev_4",
        objective="Investigate degraded service",
        relevant_artifacts=[HandoffArtifactRef(artifact_id="artifact-2")],
        open_questions=["Did a deploy trigger this?"],
        expected_output="Return evidence and next steps",
    )

    resume = compile_runtime_resume_state(snapshot=snapshot, shared_state=shared_state, handoff=handoff)

    assert resume.process_id == "proc_123"
    assert resume.revision_id == "rev_5"
    assert resume.lifecycle_state == "waiting"
    assert resume.source_snapshot_id == "snap_1"
    assert resume.source_state_id == "state_1"
    assert resume.source_handoff_id == handoff.handoff_id
    assert resume.assigned_agents["step1"] == "planner"
    assert resume.assigned_agents["step2"] == "researcher"
    assert resume.session_state["status"] == "blocked"
    assert resume.session_state["retry_count"] == 2
    assert resume.runtime_constraints["verification_mode"] == "strict"
    assert resume.runtime_constraints["execution_mode"] == "sequential"
    assert resume.world_state["service"] == "degraded"
    assert resume.world_state["region"] == "us-central"
    assert "claim-1" in resume.belief_refs and "claim-2" in resume.belief_refs
    assert "artifact-1" in resume.artifact_refs and "artifact-2" in resume.artifact_refs



def test_load_runtime_resume_state_from_stores(tmp_path: Path):
    snapshot_store = ProcessSnapshotStore(tmp_path / "snapshots")
    shared_state_store = SharedProcessStateStore(tmp_path / "shared_state")
    journal = ProcessJournal(tmp_path / "runtime" / "processes.jsonl")
    mailbox = AgentMailbox(tmp_path / "runtime" / "mailbox.json")
    supervisor = AgentSupervisor(tmp_path / "runtime" / "leases.json")

    snapshot_store.save(ProcessSnapshot(process_id="proc_123", snapshot_id="snap_1", last_event_id="evt_1", event_count=1, lifecycle_state="running"))
    shared_state_store.save(SharedProcessState(process_id="proc_123", state_id="state_1", revision_id="rev_2", runtime_constraints={"execution_mode": "sequential"}))
    journal.append(process_id="proc_123", kind="process_started")
    mailbox.send(process_id="proc_123", from_agent="coordinator", to_agent="researcher", payload={"objective": "Investigate"})
    supervisor.assign(process_id="proc_123", scope="step1", agent_id="planner", lease_seconds=60)

    resume = load_runtime_resume_state(
        process_id="proc_123",
        snapshot_store=snapshot_store,
        shared_state_store=shared_state_store,
        journal=journal,
        mailbox=mailbox,
        supervisor=supervisor,
    )

    assert resume.process_id == "proc_123"
    assert resume.revision_id == "rev_2"
    assert resume.queued_messages == 1
    assert len(resume.active_leases) == 1
    assert resume.runtime_constraints["execution_mode"] == "sequential"



def test_assemble_runtime_process_explain_surfaces_resume_state():
    snapshot = ProcessSnapshot(
        process_id="proc_123",
        snapshot_id="snap_1",
        last_event_id="evt_3",
        event_count=3,
        lifecycle_state="waiting",
        active_steps=["step1"],
        waiting_steps=["step2"],
        completed_steps=["step0"],
        assigned_agents={"step1": "planner"},
        runtime_policy={"verification_mode": "strict"},
        session_state={"status": "retry-needed", "retry_count": 1},
        world_state={"service": "degraded"},
        belief_refs=["claim-1"],
        artifact_refs=["artifact-1"],
    )
    shared_state = SharedProcessState(
        process_id="proc_123",
        state_id="state_1",
        revision_id="rev_5",
        runtime_constraints={"execution_mode": "sequential"},
        world_state={"region": "us-central"},
        belief_refs=["claim-2"],
        open_questions=["Is it isolated?"],
        agent_ownership={"step2": "researcher"},
    )
    handoff = HandoffContract(
        process_id="proc_123",
        from_agent="coordinator",
        to_agent="researcher",
        source_revision="rev_4",
        objective="Investigate degraded service",
        relevant_artifacts=[HandoffArtifactRef(artifact_id="artifact-2")],
        open_questions=["Did a deploy trigger this?"],
        expected_output="Return evidence and next steps",
    )
    process = {
        "process_id": "proc_123",
        "status": "paused",
        "workflow": {"metadata": {"policy": {}}, "steps": [{"node_id": "step1", "title": "Step 1"}]},
        "nodes": {},
        "results_by_node": {},
    }

    explained = assemble_runtime_process_explain(
        process_id="proc_123",
        process=process,
        beliefs_for_task_fn=lambda task_id, limit=200: [],
        summarize_beliefs_fn=lambda **kwargs: {"count": 0},
        explain_belief_fn=lambda claim_id: None,
        get_belief_fn=lambda claim_id: None,
        select_influential_beliefs_fn=lambda **kwargs: [],
        snapshot=snapshot,
        shared_state=shared_state,
        handoff=handoff,
    )

    assert explained["runtime_resume_available"] is True
    assert explained["runtime_resume_operator_summary"].startswith("resume ready")
    assert explained["runtime_resume_state"]["source_snapshot_id"] == "snap_1"
    assert explained["runtime_resume_state"]["source_state_id"] == "state_1"
    assert explained["runtime_resume_state"]["handoff_objective"] == "Investigate degraded service"
    assert explained["runtime_resume_state"]["runtime_constraints"]["execution_mode"] == "sequential"
    assert explained["runtime_resume_state"]["session_state"]["status"] == "retry-needed"
    assert explained["session_plane_summary"]["status"] == "retry-needed"
    assert explained["runtime_resume_state"]["world_state"]["service"] == "degraded"
    assert explained["runtime_resume_state"]["world_state"]["region"] == "us-central"
