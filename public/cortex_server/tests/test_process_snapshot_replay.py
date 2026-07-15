from __future__ import annotations

from pathlib import Path

import pytest

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
        session_state={"status": "running", "retry_count": 0},
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
    assert loaded.session_state["status"] == "running"
    assert loaded.world_state["status"] == "degraded"


def test_process_snapshot_store_rejects_stale_read_modify_write(tmp_path: Path):
    store = ProcessSnapshotStore(tmp_path / "snapshots")
    committed = store.save(ProcessSnapshot(process_id="proc_cas", world_state={"version": 1}))
    stale = committed.model_copy(deep=True)
    committed.world_state = {"version": 2}
    store.save(committed)
    stale.world_state = {"version": "stale"}

    with pytest.raises(RuntimeError, match="snapshot persistence conflict"):
        store.save(stale)

    assert store.load("proc_cas").world_state == {"version": 2}



def test_replay_events_reconstructs_process_state():
    events = [
        ProcessEvent(process_id="proc_123", kind="process_created", payload={"goal": "test"}),
        ProcessEvent(process_id="proc_123", kind="process_started"),
        ProcessEvent(process_id="proc_123", kind="session.started", payload={"session_id": "sess_1", "tool": "codex"}),
        ProcessEvent(process_id="proc_123", kind="step_started", payload={"node_id": "step1"}),
        ProcessEvent(process_id="proc_123", kind="agent_assigned", payload={"node_id": "step1", "agent_id": "planner"}),
        ProcessEvent(process_id="proc_123", kind="world_state_updated", payload={"world_state": {"service": "degraded"}}),
        ProcessEvent(process_id="proc_123", kind="belief_written", payload={"claim_id": "claim-1"}),
        ProcessEvent(process_id="proc_123", kind="session.blocked", payload={"summary": "Need approval"}),
        ProcessEvent(process_id="proc_123", kind="step_completed", payload={"node_id": "step1"}),
        ProcessEvent(process_id="proc_123", kind="process_completed"),
    ]

    state = replay_events("proc_123", events)

    assert state["lifecycle_state"] == "completed"
    assert state["completed_steps"] == ["step1"]
    assert state["active_steps"] == []
    assert state["assigned_agents"]["step1"] == "planner"
    assert state["session_state"]["status"] == "blocked"
    assert state["session_state"]["open_questions"] == ["Need approval"]
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



def test_replay_events_process_rollback_restores_prior_state():
    events = [
        ProcessEvent(process_id="proc_123", kind="process_created", payload={"goal": "test"}),
        ProcessEvent(process_id="proc_123", kind="process_started"),
        ProcessEvent(process_id="proc_123", kind="step_started", payload={"node_id": "step1"}),
        ProcessEvent(process_id="proc_123", kind="world_state_updated", payload={"world_state": {"service": "degraded", "bad_update": True}}),
        ProcessEvent(process_id="proc_123", kind="belief_written", payload={"claim_id": "claim-bad"}),
        ProcessEvent(
            process_id="proc_123",
            kind="process_rolled_back",
            payload={
                "reason": "restore previous waiting state",
                "rolled_back_to_event_id": "evt_wait",
                "restore_state": {
                    "lifecycle_state": "waiting",
                    "active_steps": [],
                    "waiting_steps": ["step1"],
                    "completed_steps": [],
                    "failed_steps": [],
                    "assigned_agents": {"step1": "planner"},
                    "runtime_policy": {"execution_mode": "sequential"},
                    "world_state": {"status": "waiting"},
                    "belief_refs": [],
                    "artifact_refs": [],
                    "metadata": {"rollback_target": "evt_wait"},
                },
            },
        ),
    ]

    state = replay_events("proc_123", events)

    assert state["lifecycle_state"] == "waiting"
    assert state["active_steps"] == []
    assert state["waiting_steps"] == ["step1"]
    assert state["world_state"] == {"status": "waiting"}
    assert state["belief_refs"] == []
    assert state["assigned_agents"]["step1"] == "planner"
    assert state["metadata"]["rolled_back_to_event_id"] == "evt_wait"
    assert state["metadata"]["rollback_reason"] == "restore previous waiting state"
