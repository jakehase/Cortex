from __future__ import annotations

from cortex_server.modules.governance_arbitration import RUNTIME_CONSTRAINT_PRECEDENCE
from cortex_server.modules.runtime_constraint_compiler import compile_runtime_constraint_resolution


CONFLICT_METADATA = {
    "policy": {
        "settings": {
            "execution_mode": "parallel",
            "max_parallelism": 4,
            "verification_mode": "basic",
            "same_tick_drain": True,
            "retry_max_attempts": 1,
        },
        "modulation": {"enabled": True, "profile": {"reasoning_depth": 5, "deep_reasoning_required": True}},
        "truth_engine": {"enabled": True, "guard_action": "block"},
        "embodiment": {"enabled": True, "pause_noncritical_work": True},
        "settings": {
            "execution_mode": "parallel",
            "max_parallelism": 4,
            "verification_mode": "basic",
            "same_tick_drain": True,
            "retry_max_attempts": 1,
            "modulation_runtime_enforce": True,
            "modulation_deep_reasoning_required": True,
            "modulation_reasoning_depth": 5,
            "truth_engine_runtime_enforce": True,
            "truth_guard_action": "block",
            "embodiment_runtime_enforce": True,
            "embodiment_pause_noncritical_work": True,
        },
    }
}



def test_runtime_constraint_resolution_exposes_precedence_and_field_owners():
    resolution = compile_runtime_constraint_resolution(CONFLICT_METADATA)
    settings = resolution["settings"]

    assert settings["constraint_precedence"] == RUNTIME_CONSTRAINT_PRECEDENCE
    assert settings["constraint_field_owners"]["max_parallelism"] == "truth_engine"
    assert settings["constraint_field_owners"]["step_timeout_seconds"] == "embodiment"
    assert settings["constraint_field_owners"]["execution_mode"] == "embodiment"



def test_runtime_constraint_resolution_records_override_trace_for_conflicting_fields():
    resolution = compile_runtime_constraint_resolution(CONFLICT_METADATA)
    decisions = resolution["settings"]["constraint_decisions"]

    max_parallelism_decisions = [row for row in decisions if row["field"] == "max_parallelism"]
    timeout_decisions = [row for row in decisions if row["field"] == "step_timeout_seconds"]

    assert len(max_parallelism_decisions) >= 2
    assert max_parallelism_decisions[-1]["decided_by"] == "truth_engine"
    assert max_parallelism_decisions[-1]["overridden_signals"] == ["modulation"]
    assert timeout_decisions[-1]["decided_by"] == "embodiment"
    assert timeout_decisions[-1]["overridden_signals"] == ["modulation"]
