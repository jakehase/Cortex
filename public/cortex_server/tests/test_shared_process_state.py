from __future__ import annotations

from pathlib import Path

import pytest

from cortex_server.runtime import OpenDecision, SharedProcessState, SharedProcessStateStore
from cortex_server.runtime.shared_process_state import ValidationError



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
