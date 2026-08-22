from __future__ import annotations

from pathlib import Path

import pytest

from cortex_server.runtime import OpenDecision, SharedProcessState, SharedProcessStateStore, SharedStateConflictError
from cortex_server.runtime.shared_process_state import ValidationError
import cortex_server.runtime.shared_process_state as shared_process_state



def test_shared_process_state_round_trip_and_store(tmp_path: Path):
    store = SharedProcessStateStore(tmp_path / "shared_state")
    state = SharedProcessState(
        process_id="proc_123",
        revision_id="rev_5",
        goals=["Stabilize the service", "Preserve evidence"],
        active_plan_node_ids=["step1", "step2"],
        open_decisions=[
            OpenDecision(
                decision_id="dec_1",
                title="Escalate to operator?",
                options=["yes", "no"],
                owner="coordinator",
            )
        ],
        runtime_constraints={"verification_mode": "strict", "execution_mode": "sequential"},
        world_state={"service": "degraded", "region": "us-central"},
        belief_refs=["claim-1", "claim-2"],
        open_questions=["Is the degradation isolated?"],
        agent_ownership={"step1": "planner", "step2": "researcher"},
        operator_overrides={"allow_intervening_revisions": True},
        metadata={"priority": "high"},
    )

    store.save(state)
    loaded = store.load("proc_123")

    assert loaded is not None
    assert loaded.process_id == "proc_123"
    assert loaded.revision_id == "rev_5"
    assert loaded.runtime_constraints["verification_mode"] == "strict"
    assert loaded.world_state["service"] == "degraded"
    assert loaded.open_decisions[0].title == "Escalate to operator?"
    assert loaded.agent_ownership["step1"] == "planner"



def test_shared_process_state_rejects_empty_required_values():
    with pytest.raises(ValidationError):
        SharedProcessState(process_id="", revision_id="rev_1")

    with pytest.raises(ValidationError):
        SharedProcessState(process_id="proc_123", revision_id="", goals=["ok"])

    with pytest.raises(ValidationError):
        SharedProcessState(process_id="proc_123", revision_id="rev_1", goals=["", "valid"])

    with pytest.raises(ValidationError):
        OpenDecision(decision_id="", title="Investigate")



def test_shared_process_state_store_detects_conflicts_and_records_history(tmp_path: Path):
    store = SharedProcessStateStore(tmp_path / "shared_state")
    first = store.save(
        SharedProcessState(process_id="proc_123", revision_id="rev_1", world_state={"status": "waiting"}),
        actor="planner",
        provenance={"source": "seed"},
    )
    second = store.save(
        SharedProcessState(process_id="proc_123", revision_id="rev_2", world_state={"status": "running"}),
        expected_revision_id="rev_1",
        actor="planner",
        provenance={"source": "update"},
    )

    history = store.history("proc_123")
    conflict = store.detect_conflict(process_id="proc_123", expected_revision_id="rev_1")

    assert first.revision_id == "rev_1"
    assert second.revision_id == "rev_2"
    assert len(history) == 2
    assert history[1].parent_revision_id == "rev_1"
    assert history[1].actor == "planner"
    assert history[1].change_set["world_state"]["count"] == 1
    assert conflict["conflict"] is True

    with pytest.raises(SharedStateConflictError, match="shared state conflict"):
        store.save(
            SharedProcessState(process_id="proc_123", revision_id="rev_3", world_state={"status": "conflicting"}),
            expected_revision_id="rev_1",
            actor="researcher",
        )



def test_shared_process_state_store_can_rollback_to_prior_revision(tmp_path: Path):
    store = SharedProcessStateStore(tmp_path / "shared_state")
    store.save(SharedProcessState(process_id="proc_123", revision_id="rev_1", world_state={"status": "waiting"}), actor="planner")
    store.save(
        SharedProcessState(process_id="proc_123", revision_id="rev_2", world_state={"status": "running", "bad_update": True}, belief_refs=["claim-bad"]),
        expected_revision_id="rev_1",
        actor="planner",
    )

    rolled = store.rollback(process_id="proc_123", to_revision_id="rev_1", new_revision_id="rev_3", actor="operator", reason="restore stable state")

    assert rolled.revision_id == "rev_3"
    assert rolled.world_state == {"status": "waiting"}
    assert rolled.belief_refs == []
    assert rolled.metadata["rollback_from_revision_id"] == "rev_2"
    assert rolled.metadata["rollback_to_revision_id"] == "rev_1"
    assert store.load_revision("proc_123", "rev_1").revision_id == "rev_1"


def test_shared_process_state_history_is_bounded_and_current_state_remains_authoritative(tmp_path, monkeypatch):
    monkeypatch.setattr(shared_process_state, "MAX_SHARED_STATE_HISTORY_RECORDS", 3)
    store = SharedProcessStateStore(tmp_path / "shared_state")
    current = None
    for revision in range(1, 7):
        current = store.save(
            SharedProcessState(
                process_id="proc_bounded_history",
                revision_id=f"rev_{revision}",
                world_state={"revision": revision},
            ),
            expected_revision_id=current.revision_id if current else None,
        )

    assert [row.revision_id for row in store.history("proc_bounded_history")] == ["rev_4", "rev_5", "rev_6"]
    assert store.load("proc_bounded_history").world_state == {"revision": 6}


def test_shared_state_recovers_crash_between_history_and_projection_publication(
    tmp_path, monkeypatch
):
    store = SharedProcessStateStore(tmp_path / "shared_state")
    store.save(
        SharedProcessState(
            process_id="proc_crash_atomic",
            revision_id="rev_a",
            world_state={"revision": "a"},
        )
    )
    real_publish = store._publish_stage
    state_target = store._target("proc_crash_atomic")
    injected = {"raised": False}

    def crash_before_projection(stage, target):
        if target == state_target and not injected["raised"]:
            injected["raised"] = True
            raise OSError("injected crash before authoritative projection")
        return real_publish(stage, target)

    monkeypatch.setattr(store, "_publish_stage", crash_before_projection)
    with pytest.raises(OSError, match="injected crash"):
        store.save(
            SharedProcessState(
                process_id="proc_crash_atomic",
                revision_id="rev_b",
                world_state={"revision": "b"},
            ),
            expected_revision_id="rev_a",
        )

    recovered_store = SharedProcessStateStore(tmp_path / "shared_state")
    recovered = recovered_store.load("proc_crash_atomic")
    assert recovered.revision_id == "rev_b"
    assert [row.revision_id for row in recovered_store.history("proc_crash_atomic")] == [
        "rev_a",
        "rev_b",
    ]
    recovered_store.save(
        SharedProcessState(
            process_id="proc_crash_atomic",
            revision_id="rev_c",
            world_state={"revision": "c"},
        ),
        expected_revision_id="rev_b",
    )
    assert recovered_store.load_revision("proc_crash_atomic", "rev_b").world_state == {
        "revision": "b"
    }
