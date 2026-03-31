from __future__ import annotations

from pathlib import Path

from cortex_server.runtime import ProcessEvent, ProcessJournal
from cortex_server.runtime.process_replay import replay_events, replay_from_journal
from cortex_server.runtime.process_snapshot import ProcessSnapshot, ProcessSnapshotStore



def test_process_snapshot_store_round_trip(tmp_path: Path):
    store = ProcessSnapshotStore(tmp_path / "snapshots")
    snapshot = ProcessSnapshot(
        process_id="proc_123",
        last_event_id="evt_aaa",
        event_count=3,
        lifecycle_state="running",
        active_steps=["step1"],
        runtime_policy={"verification_mode": "strict"},
        world_state={"status": "degraded"},
        belief_refs=["claim-1"],
        artifact_refs=["artifact-1"],
    )

    store.save(snapshot)
    loaded = store.load("proc_123")

    assert loaded is not None
    assert loaded.process_id == "proc_123"
    assert loaded.last_event_id == "evt_aaa"
    assert loaded.runtime_policy["verification_mode"] == "strict"
    assert loaded.world_state["status"] == "degraded"



def test_replay_events_reconstructs_process_state():
    events = [
        ProcessEvent(process_id="proc_123", kind="process_created", payload={"goal": "test"}),
        ProcessEvent(process_id="proc_123", kind="process_started"),
        ProcessEvent(process_id="proc_123", kind="step_started", payload={"node_id": "step1"}),
        ProcessEvent(process_id="proc_123", kind="agent_assigned", payload={"node_id": "step1", "agent_id": "planner"}),
        ProcessEvent(process_id="proc_123", kind="world_state_updated", payload={"world_state": {"service": "degraded"}}),
        ProcessEvent(process_id="proc_123", kind="belief_written", payload={"claim_id": "claim-1"}),
        ProcessEvent(process_id="proc_123", kind="step_completed", payload={"node_id": "step1"}),
        ProcessEvent(process_id="proc_123", kind="process_completed"),
    ]

    state = replay_events("proc_123", events)

    assert state["lifecycle_state"] == "completed"
    assert state["completed_steps"] == ["step1"]
    assert state["active_steps"] == []
    assert state["assigned_agents"]["step1"] == "planner"
    assert state["world_state"]["service"] == "degraded"
    assert state["belief_refs"] == ["claim-1"]



def test_replay_from_journal_uses_snapshot_tail(tmp_path: Path):
    journal = ProcessJournal(tmp_path / "runtime" / "processes.jsonl")
    created = journal.append(process_id="proc_123", kind="process_created")
    journal.append(process_id="proc_123", kind="process_started")
    journal.append(process_id="proc_123", kind="step_started", payload={"node_id": "step1"})

    snapshot = ProcessSnapshot(
        process_id="proc_123",
        last_event_id=created.event_id,
        event_count=1,
        lifecycle_state="created",
    )

    journal.append(process_id="proc_123", kind="step_completed", payload={"node_id": "step1"})
    journal.append(process_id="proc_123", kind="process_completed")

    state = replay_from_journal(journal, "proc_123", snapshot=snapshot)

    assert state["lifecycle_state"] == "completed"
    assert "step1" in state["completed_steps"]
