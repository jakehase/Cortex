from __future__ import annotations

from pathlib import Path

import pytest

from cortex_server.runtime import ProcessEvent, ProcessJournal
from cortex_server.runtime.process_event import ValidationError
from cortex_server.runtime.process_replay import replay_from_journal
import cortex_server.runtime.process_journal as process_journal



def test_process_event_defaults_and_validation():
    event = ProcessEvent(process_id="proc_123", kind="process_created")

    assert event.event_id.startswith("evt_")
    assert event.process_id == "proc_123"
    assert event.kind == "process_created"
    assert event.causal_parent_ids == []
    assert event.payload == {}
    assert event.ts.endswith("Z")



def test_process_event_rejects_empty_required_fields():
    with pytest.raises(ValidationError):
        ProcessEvent(process_id="", kind="process_created")

    with pytest.raises(ValidationError):
        ProcessEvent(process_id="proc_123", kind="")

    with pytest.raises(ValidationError):
        ProcessEvent(process_id="proc_123", kind="step_started", ts="not-a-timestamp")



def test_process_journal_append_and_load_round_trip(tmp_path: Path):
    journal = ProcessJournal(tmp_path / "runtime" / "processes.jsonl")

    created = journal.append(process_id="proc_123", kind="process_created", payload={"goal": "test"})
    journal.append(
        process_id="proc_123",
        kind="step_started",
        causal_parent_ids=[created.event_id],
        actor="planner",
        revision_id="rev_1",
        payload={"node_id": "step1"},
    )
    journal.append(process_id="proc_999", kind="process_created")

    rows = journal.load(process_id="proc_123")

    assert len(rows) == 2
    assert rows[0].kind == "process_created"
    assert rows[1].causal_parent_ids == [created.event_id]
    assert rows[1].payload["node_id"] == "step1"
    assert journal.latest(process_id="proc_123").kind == "step_started"



def test_process_journal_append_many_and_kind_filter(tmp_path: Path):
    journal = ProcessJournal(tmp_path / "runtime" / "processes.jsonl")

    journal.append_many(
        [
            {"process_id": "proc_123", "kind": "process_created"},
            {"process_id": "proc_123", "kind": "process_started"},
            {"process_id": "proc_123", "kind": "step_started", "payload": {"node_id": "step1"}},
        ]
    )

    rows = journal.load(process_id="proc_123", kinds=["step_started"])

    assert len(rows) == 1
    assert rows[0].kind == "step_started"
    assert rows[0].payload["node_id"] == "step1"


def test_process_journal_ignores_and_repairs_an_unframed_torn_tail(tmp_path: Path):
    journal = ProcessJournal(tmp_path / "runtime" / "processes.jsonl")
    first = journal.append(process_id="proc_123", kind="process_created")
    with journal.path.open("ab") as handle:
        handle.write(b'{"event_id":"torn"')

    assert [row.event_id for row in journal.load()] == [first.event_id]
    second = journal.append(process_id="proc_123", kind="process_started")

    assert [row.event_id for row in journal.load()] == [first.event_id, second.event_id]
    assert journal.path.read_bytes().endswith(b"\n")


def test_process_journal_rejects_corrupt_committed_frames(tmp_path: Path):
    journal = ProcessJournal(tmp_path / "runtime" / "processes.jsonl")
    journal.path.parent.mkdir(parents=True)
    journal.path.write_bytes(b'{"committed":broken}\n')

    with pytest.raises(ValueError, match="corrupt committed process journal record"):
        journal.load()


def test_process_journal_compacts_to_a_sealed_replay_checkpoint(tmp_path, monkeypatch):
    monkeypatch.setattr(process_journal, "MAX_PROCESS_JOURNAL_RECORDS", 3)
    journal = ProcessJournal(tmp_path / "runtime" / "processes.jsonl")
    for sequence in range(6):
        journal.append(process_id="proc_bounded", kind="step_progress", payload={"sequence": sequence})

    replayed = replay_from_journal(journal, "proc_bounded")
    physical_rows = [row for row in journal.path.read_text(encoding="utf-8").splitlines() if row]

    assert replayed["event_count"] == 6
    assert replayed["last_event_id"] == journal.latest(process_id="proc_bounded").event_id
    assert len(physical_rows) <= 3
    assert any('"kind": "journal_checkpoint_anchor"' in row for row in physical_rows)
    assert len(list(journal._checkpoint_root.glob("*.json"))) == 1
    assert journal.path.read_bytes().endswith(b"\n")


def test_compacted_replay_matches_full_history_for_every_process(tmp_path, monkeypatch):
    events = [
        ProcessEvent(process_id="proc_alpha", kind="process_created", payload={"goal": "ship"}),
        ProcessEvent(process_id="proc_beta", kind="process_created", payload={"goal": "observe"}),
        ProcessEvent(process_id="proc_alpha", kind="agent_assigned", actor="planner", payload={"node_id": "build", "agent_id": "builder"}),
        ProcessEvent(process_id="proc_alpha", kind="step_started", payload={"node_id": "build"}),
        ProcessEvent(process_id="proc_beta", kind="process_started"),
        ProcessEvent(process_id="proc_beta", kind="world_state_updated", payload={"world_state": {"health": "green"}}),
        ProcessEvent(process_id="proc_alpha", kind="step_completed", payload={"node_id": "build"}),
        ProcessEvent(process_id="proc_alpha", kind="process_completed"),
        ProcessEvent(process_id="proc_beta", kind="process_waiting", payload={"node_id": "monitor"}),
    ]
    full = ProcessJournal(tmp_path / "full" / "processes.jsonl")
    full.append_many(events)
    expected = {
        process_id: replay_from_journal(full, process_id)
        for process_id in ("proc_alpha", "proc_beta")
    }

    monkeypatch.setattr(process_journal, "MAX_PROCESS_JOURNAL_RECORDS", 6)
    monkeypatch.setattr(process_journal, "MAX_PROCESS_JOURNAL_RECORDS_PER_PROCESS", 4)
    compacted = ProcessJournal(tmp_path / "compacted" / "processes.jsonl")
    for event in events:
        compacted.append(event)

    for process_id in expected:
        assert replay_from_journal(compacted, process_id) == expected[process_id]
    assert {
        row.process_id
        for row in compacted.load()
    } == {"proc_alpha", "proc_beta"}


def test_checkpoint_anchor_fails_closed_when_sealed_state_is_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(process_journal, "MAX_PROCESS_JOURNAL_RECORDS", 3)
    journal = ProcessJournal(tmp_path / "runtime" / "processes.jsonl")
    for sequence in range(4):
        journal.append(process_id="proc_missing_checkpoint", kind="step_progress", payload={"sequence": sequence})
    checkpoint = next(journal._checkpoint_root.glob("*.json"))
    checkpoint.unlink()

    with pytest.raises(ValueError, match="checkpoint anchor target is missing"):
        replay_from_journal(journal, "proc_missing_checkpoint")
