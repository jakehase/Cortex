from __future__ import annotations

from cortex_server.modules.reasoning_runtime_execution import workflow_policy_settings
from cortex_server.modules.runtime_constraint_compiler import compile_runtime_constraint_settings
from tests.test_reasoning_restored_phase_integration import RESTORED_METADATA


PROTECTIVE_METADATA = {
    "policy": {
        "settings": {
            "execution_mode": "parallel",
            "max_parallelism": 4,
            "verification_mode": "basic",
            "retry_max_attempts": 1,
        },
        "homeostasis": {
            "enabled": True,
            "mode": "protective",
            "intent": "coding",
            "risk_tier": "high",
            "effort": {
                "reasoning_depth": 4,
                "human_review_required": True,
                "escalation_recommended": True,
            },
            "guardrails": {
                "prefer_chain": "deliberate_council",
                "allowed_chains": ["deliberate_council"],
                "block_fastlane": True,
            },
        },
    }
}


R9_METADATA = {
    "policy": {
        "settings": {
            "execution_mode": "parallel",
            "max_parallelism": 3,
            "same_tick_drain": True,
            "retry_max_attempts": 1,
            "retry_on_timeout": False,
        },
        "routing_r9": {
            "enabled": True,
            "selected_chain": "research_grounded",
            "default_chain": "fastlane_memory",
            "allowed_chain_ids": ["fastlane_memory", "research_grounded"],
            "coarse_choice": "deliberate",
            "utility": 0.93,
            "estimated_quality": 0.9,
        },
    }
}


RESTORED_PHASE_METADATA = {
    "policy": {
        "settings": {
            "execution_mode": "parallel",
            "max_parallelism": 4,
            "verification_mode": "basic",
            "same_tick_drain": True,
        },
        "world_state": {
            "enabled": True,
            "entity_count": 1,
            "low_confidence_entities": ["service:payments"],
        },
        "modulation": {
            "enabled": True,
            "profile": {"reasoning_depth": 5, "deep_reasoning_required": True, "tempo": "deliberate"},
        },
        "workspace": {
            "enabled": True,
            "selected": "planner",
        },
        "truth_engine": {
            "enabled": True,
            "guard_action": "block",
        },
        "plasticity": {
            "enabled": True,
            "alert": True,
        },
        "embodiment": {
            "enabled": True,
            "pause_noncritical_work": True,
        },
        "settings": {
            "execution_mode": "parallel",
            "max_parallelism": 4,
            "verification_mode": "basic",
            "same_tick_drain": True,
            "world_state_runtime_enforce": True,
            "world_state_low_confidence_entities": ["service:payments"],
            "modulation_runtime_enforce": True,
            "modulation_deep_reasoning_required": True,
            "modulation_reasoning_depth": 5,
            "workspace_runtime_enforce": True,
            "workspace_selected_specialist": "planner",
            "truth_engine_runtime_enforce": True,
            "truth_guard_action": "block",
            "plasticity_runtime_enforce": True,
            "plasticity_alert": True,
            "embodiment_runtime_enforce": True,
            "embodiment_pause_noncritical_work": True,
        },
    }
}



def test_runtime_constraint_compiler_matches_runtime_execution_wrapper_for_homeostasis():
    compiled = compile_runtime_constraint_settings(PROTECTIVE_METADATA)
    wrapped = workflow_policy_settings(PROTECTIVE_METADATA)

    assert compiled == wrapped
    assert compiled["execution_mode"] == "sequential"
    assert compiled["verification_mode"] == "strict"
    assert compiled["step_timeout_seconds"] == 12.0
    assert "constraint_precedence" in compiled
    assert "constraint_decisions" in compiled



def test_runtime_constraint_compiler_matches_runtime_execution_wrapper_for_r9():
    compiled = compile_runtime_constraint_settings(R9_METADATA)
    wrapped = workflow_policy_settings(R9_METADATA)

    assert compiled == wrapped
    assert compiled["execution_mode"] == "sequential"
    assert compiled["same_tick_drain"] is False
    assert compiled["step_timeout_seconds"] == 8.0



def test_runtime_constraint_compiler_applies_restored_phase_constraints():
    compiled = compile_runtime_constraint_settings(RESTORED_PHASE_METADATA)

    assert compiled["execution_mode"] == "sequential"
    assert compiled["verification_mode"] == "strict"
    assert compiled["same_tick_drain"] is False
    assert compiled["max_parallelism"] == 1
    assert compiled["step_timeout_seconds"] == 10.0
    assert compiled["world_state_runtime_enforced"] is True
    assert compiled["modulation_runtime_enforced"] is True
    assert compiled["workspace_runtime_enforced"] is True
    assert compiled["truth_engine_runtime_enforced"] is True
    assert compiled["plasticity_runtime_enforced"] is True
    assert compiled["embodiment_runtime_enforced"] is True
