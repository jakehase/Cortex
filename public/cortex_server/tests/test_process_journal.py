from __future__ import annotations

from pathlib import Path

import pytest

from cortex_server.runtime import ProcessEvent, ProcessJournal
from cortex_server.runtime.process_event import ValidationError



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
