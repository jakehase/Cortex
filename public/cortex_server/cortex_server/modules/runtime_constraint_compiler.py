from __future__ import annotations

from typing import Any, Dict, Optional

from cortex_server.modules.governance_arbitration import apply_overlay_precedence


JsonDict = Dict[str, Any]

_R9_DELIBERATE_CHAINS = {"deliberate_council", "research_grounded"}
_R9_FASTLANE_CHAINS = {"fastlane_memory", "safe_reminder"}



def _r9_runtime_overlay(policy: JsonDict, settings: JsonDict) -> JsonDict:
    policy = policy if isinstance(policy, dict) else {}
    settings = dict(settings or {})
    routing_r9 = policy.get("routing_r9") if isinstance(policy.get("routing_r9"), dict) else {}
    if not bool(routing_r9.get("enabled")):
        return settings

    selected_chain = str(settings.get("routing_selected_chain") or routing_r9.get("selected_chain") or "")
    explicit_timeout = settings.get("step_timeout_seconds") is not None
    if selected_chain in _R9_DELIBERATE_CHAINS:
        if selected_chain == "research_grounded":
            settings["execution_mode"] = "sequential"
            settings["same_tick_drain"] = False
            settings["retry_on_timeout"] = True
            settings["retry_max_attempts"] = max(2, int(settings.get("retry_max_attempts", 1) or 1))
            if not explicit_timeout:
                settings["step_timeout_seconds"] = 8.0
        elif not explicit_timeout:
            settings["step_timeout_seconds"] = 6.0
        settings["routing_runtime_enforced"] = True
    elif selected_chain in _R9_FASTLANE_CHAINS:
        if not explicit_timeout:
            settings["step_timeout_seconds"] = 5.0 if selected_chain == "safe_reminder" else 4.0
        settings["routing_runtime_enforced"] = True
    return settings



def _homeostasis_runtime_overlay(policy: JsonDict, settings: JsonDict) -> JsonDict:
    policy = policy if isinstance(policy, dict) else {}
    settings = dict(settings or {})
    homeostasis = policy.get("homeostasis") if isinstance(policy.get("homeostasis"), dict) else {}
    if not bool(homeostasis.get("enabled")):
        return settings

    effort = homeostasis.get("effort") if isinstance(homeostasis.get("effort"), dict) else {}
    guardrails = homeostasis.get("guardrails") if isinstance(homeostasis.get("guardrails"), dict) else {}
    mode = str(settings.get("homeostasis_mode") or homeostasis.get("mode") or "normal")
    reasoning_depth = int(settings.get("homeostasis_reasoning_depth") or effort.get("reasoning_depth") or 1)
    human_review_required = bool(settings.get("homeostasis_human_review_required", effort.get("human_review_required")))
    escalation_recommended = bool(settings.get("homeostasis_escalation_recommended", effort.get("escalation_recommended")))
    prefer_chain = str(settings.get("homeostasis_prefer_chain") or guardrails.get("prefer_chain") or "")
    explicit_timeout = settings.get("step_timeout_seconds") is not None

    if mode == "protective":
        settings["execution_mode"] = "sequential"
        settings["max_parallelism"] = 1
        settings["same_tick_drain"] = False
        settings["verification_mode"] = "strict"
        settings["retry_on_timeout"] = True
        settings["retry_max_attempts"] = max(2, int(settings.get("retry_max_attempts", 1) or 1))
        if not explicit_timeout:
            settings["step_timeout_seconds"] = max(8.0, min(18.0, 4.0 + float(reasoning_depth) * 2.0))
    elif mode == "conserve":
        settings["max_parallelism"] = min(2, max(1, int(settings.get("max_parallelism", 1) or 1)))
        if settings.get("execution_mode") == "parallel":
            settings["execution_mode"] = "parallel"
        if not explicit_timeout:
            settings["step_timeout_seconds"] = max(4.0, min(8.0, 3.0 + float(reasoning_depth)))
        if prefer_chain in {"fastlane_memory", "safe_reminder"}:
            settings["same_tick_drain"] = False
    elif human_review_required or escalation_recommended:
        settings["same_tick_drain"] = False

    settings["homeostasis_runtime_enforced"] = True
    return settings



def _world_state_runtime_overlay(policy: JsonDict, settings: JsonDict) -> JsonDict:
    settings = dict(settings or {})
    if bool(settings.get("world_state_runtime_enforce")) and list(settings.get("world_state_low_confidence_entities") or []):
        settings["verification_mode"] = "strict"
        settings["world_state_runtime_enforced"] = True
    return settings



def _modulation_runtime_overlay(policy: JsonDict, settings: JsonDict) -> JsonDict:
    settings = dict(settings or {})
    explicit_timeout = settings.get("step_timeout_seconds") is not None
    if bool(settings.get("modulation_runtime_enforce")) and bool(settings.get("modulation_deep_reasoning_required")):
        settings["max_parallelism"] = min(2, max(1, int(settings.get("max_parallelism", 1) or 1)))
        settings["same_tick_drain"] = False
        if not explicit_timeout:
            depth = int(settings.get("modulation_reasoning_depth", 1) or 1)
            settings["step_timeout_seconds"] = max(6.0, min(12.0, 3.0 + float(depth)))
        settings["modulation_runtime_enforced"] = True
    return settings



def _workspace_runtime_overlay(policy: JsonDict, settings: JsonDict) -> JsonDict:
    settings = dict(settings or {})
    if bool(settings.get("workspace_runtime_enforce")) and str(settings.get("workspace_selected_specialist") or "") == "planner":
        settings["same_tick_drain"] = False
        settings["workspace_runtime_enforced"] = True
    return settings



def _truth_engine_runtime_overlay(policy: JsonDict, settings: JsonDict) -> JsonDict:
    settings = dict(settings or {})
    if bool(settings.get("truth_engine_runtime_enforce")):
        action = str(settings.get("truth_guard_action") or "allow")
        if action in {"clarify", "block"}:
            settings["verification_mode"] = "strict"
            settings["same_tick_drain"] = False
            if action == "block":
                settings["max_parallelism"] = 1
            settings["truth_engine_runtime_enforced"] = True
    return settings



def _plasticity_runtime_overlay(policy: JsonDict, settings: JsonDict) -> JsonDict:
    settings = dict(settings or {})
    if bool(settings.get("plasticity_runtime_enforce")) and bool(settings.get("plasticity_alert")):
        settings["same_tick_drain"] = False
        settings["max_parallelism"] = min(2, max(1, int(settings.get("max_parallelism", 1) or 1)))
        settings["plasticity_runtime_enforced"] = True
    return settings



def _embodiment_runtime_overlay(policy: JsonDict, settings: JsonDict) -> JsonDict:
    settings = dict(settings or {})
    if bool(settings.get("embodiment_runtime_enforce")) and bool(settings.get("embodiment_pause_noncritical_work")):
        settings["execution_mode"] = "sequential"
        settings["max_parallelism"] = 1
        settings["same_tick_drain"] = False
        settings["verification_mode"] = "strict"
        settings["step_timeout_seconds"] = max(10.0, float(settings.get("step_timeout_seconds") or 0.0))
        settings["embodiment_runtime_enforced"] = True
    return settings



def compile_runtime_constraint_resolution(workflow_metadata: Optional[JsonDict]) -> JsonDict:
    metadata = dict(workflow_metadata or {})
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    settings = policy.get("settings") if isinstance(policy.get("settings"), dict) else {}
    return {
        "settings": apply_overlay_precedence(
            policy=policy,
            base_settings=dict(settings),
            overlays=[
                ("routing_r9", _r9_runtime_overlay),
                ("homeostasis", _homeostasis_runtime_overlay),
                ("world_state", _world_state_runtime_overlay),
                ("modulation", _modulation_runtime_overlay),
                ("workspace", _workspace_runtime_overlay),
                ("truth_engine", _truth_engine_runtime_overlay),
                ("plasticity", _plasticity_runtime_overlay),
                ("embodiment", _embodiment_runtime_overlay),
            ],
        )
    }



def compile_runtime_constraint_settings(workflow_metadata: Optional[JsonDict]) -> JsonDict:
    resolution = compile_runtime_constraint_resolution(workflow_metadata)
    settings = resolution.get("settings") if isinstance(resolution.get("settings"), dict) else {}
    return dict(settings)


__all__ = [
    "compile_runtime_constraint_resolution",
    "compile_runtime_constraint_settings",
]
