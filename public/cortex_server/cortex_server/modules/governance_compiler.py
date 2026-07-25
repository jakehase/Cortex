from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

from cortex_server.modules.latency_budget_governor import classify_task_archetype
from cortex_server.modules.reasoning_beliefs import select_influential_beliefs
from cortex_server.modules.reasoning_kernel import build_policy_decision, model_dump_compat
from cortex_server.modules.reasoning_subsystem_adapters import _routing_choice_from_homeostasis, collect_subsystem_activations, collect_subsystem_bundles
from cortex_server.modules.routing_autotune import get_policy_snapshot


def compile_workflow_policy(
    *,
    name: str,
    goal: str = "",
    description: str = "",
    steps: List[Dict[str, Any]] | None = None,
    metadata: Dict[str, Any] | None = None,
    belief_scope: Optional[Mapping[str, object]] = None,
) -> Dict[str, Any]:
    steps = list(steps or [])
    metadata = dict(metadata or {})
    query = " ".join(x for x in [name, goal, description] if x).strip()
    archetype = classify_task_archetype(query)
    route_policy = get_policy_snapshot()
    belief_subjects = [str(x) for x in (metadata.get("policy_belief_subjects") or []) if str(x).strip()]
    belief_predicates = [str(x) for x in (metadata.get("policy_belief_predicates") or []) if str(x).strip()]
    policy_task_id = str(metadata.get("task_id") or metadata.get("kernel_task_id") or "").strip() or None
    belief_query = None if (belief_subjects or belief_predicates) else query
    # A caller that has not supplied an authenticated scope must not consult a
    # compatibility/global belief namespace.  Unscoped internal compilations
    # remain deterministic and simply have no belief influences.
    belief_influences = [] if belief_scope is None else select_influential_beliefs(
        task_id=policy_task_id,
        subjects=belief_subjects or None,
        predicates=belief_predicates or None,
        query=belief_query,
        limit=6,
        scope=belief_scope,
    )
    if belief_scope is not None and not belief_influences:
        belief_influences = select_influential_beliefs(
            task_id=None,
            subjects=belief_subjects or None,
            predicates=belief_predicates or None,
            query=belief_query,
            limit=6,
            scope=belief_scope,
        )
    belief_ids = [str(row.get("claim_id") or "") for row in belief_influences if str(row.get("claim_id") or "").strip()]

    dep_total = sum(len((step.get("depends_on") or [])) for step in steps if isinstance(step, dict))
    node_count = max(1, len(steps))
    dependency_density = dep_total / node_count
    root_count = sum(1 for step in steps if isinstance(step, dict) and not (step.get("depends_on") or []))
    has_waits = any(bool(((step.get("metadata") or {}).get("wait_until")) or ((step.get("metadata") or {}).get("delay_seconds") is not None)) for step in steps if isinstance(step, dict))
    has_contracts = any(bool(step.get("contracts")) for step in steps if isinstance(step, dict))
    cadence_seconds = int(metadata.get("cadence_seconds", 0) or 0)
    long_running = cadence_seconds > 0 or has_waits
    requested_execution_mode = str(metadata.get("execution_mode") or "").strip().lower()
    if requested_execution_mode in {"parallel", "sequential"}:
        execution_mode = requested_execution_mode
    else:
        execution_mode = "parallel" if root_count > 1 and not long_running else "sequential"
    requested_parallelism = int(metadata.get("max_parallelism", 0) or 0)
    max_parallelism = max(1, min(8, requested_parallelism or (root_count if execution_mode == "parallel" else 1)))
    requested_verification_mode = str(metadata.get("verification_mode") or "").strip().lower()
    if requested_verification_mode in {"basic", "strict"}:
        verification_mode = requested_verification_mode
    else:
        verification_mode = "strict" if has_contracts or archetype in {"coding", "planning", "ops_triage"} else "basic"
    same_tick_drain = bool(metadata.get("same_tick_drain", True))
    step_timeout_seconds = metadata.get("step_timeout_seconds")

    subsystem_bundles = collect_subsystem_bundles(
        archetype=archetype,
        query=query,
        metadata=metadata,
        steps=steps,
        belief_ids=belief_ids,
        dependency_density=dependency_density,
        has_contracts=has_contracts,
        long_running=long_running,
    )
    homeostasis = dict(subsystem_bundles.get("homeostasis") or {})
    r9_routing = dict(subsystem_bundles.get("routing_r9") or {})
    world_state = dict(subsystem_bundles.get("world_state") or {})
    modulation = dict(subsystem_bundles.get("modulation") or {})
    workspace = dict(subsystem_bundles.get("workspace") or {})
    truth_engine = dict(subsystem_bundles.get("truth_engine") or {})
    plasticity = dict(subsystem_bundles.get("plasticity") or {})
    embodiment = dict(subsystem_bundles.get("embodiment") or {})
    subsystem_activations = [model_dump_compat(row) for row in collect_subsystem_activations(bundles=subsystem_bundles)]

    risk_flags: List[str] = []
    if has_contracts:
        risk_flags.append("verification")
    if dependency_density >= 0.5:
        risk_flags.append("dependency_dense")
    if long_running:
        risk_flags.append("long_running")
    if execution_mode == "parallel":
        risk_flags.append("parallelizable")

    routing_choice = str(r9_routing.get("coarse_choice") or "") if bool(r9_routing.get("enabled")) else ""
    if not routing_choice:
        routing_choice = "deliberate" if archetype in {"coding", "planning", "ops_triage"} or dependency_density >= 0.5 else "fastlane"
    routing_selected_chain = str(r9_routing.get("selected_chain") or "") if bool(r9_routing.get("enabled")) else None
    routing_override_reason = None
    if bool(homeostasis.get("enabled")):
        post_homeostasis_choice = _routing_choice_from_homeostasis(homeostasis, routing_choice)
        if post_homeostasis_choice != routing_choice:
            routing_override_reason = f"homeostasis_{homeostasis.get('mode')}"
            guardrails = homeostasis.get("guardrails") if isinstance(homeostasis.get("guardrails"), dict) else {}
            prefer_chain = str(guardrails.get("prefer_chain") or "").strip()
            if prefer_chain:
                routing_selected_chain = prefer_chain
        routing_choice = post_homeostasis_choice
        mode = str(homeostasis.get("mode") or "normal")
        if mode == "protective":
            execution_mode = "sequential"
            max_parallelism = 1
            verification_mode = "strict"
            risk_flags.append("homeostasis_protective")
        elif mode == "conserve":
            max_parallelism = min(max_parallelism, 2)
            risk_flags.append("homeostasis_conserve")
        else:
            risk_flags.append("homeostasis_normal")
        if bool(((homeostasis.get("effort") or {}).get("human_review_required"))):
            risk_flags.append("homeostasis_human_review")
        if bool(((homeostasis.get("effort") or {}).get("escalation_recommended"))):
            risk_flags.append("homeostasis_escalation")

    if bool(r9_routing.get("enabled")):
        risk_flags.append("r9_routing_active")

    modulation_profile = modulation.get("profile") if isinstance(modulation.get("profile"), dict) else {}
    if bool(modulation.get("enabled")):
        if bool(modulation_profile.get("deep_reasoning_required")):
            risk_flags.append("modulation_deep_reasoning")
            if bool(modulation.get("runtime_enforce")):
                max_parallelism = min(max_parallelism, 2)
                same_tick_drain = False
                if step_timeout_seconds is None:
                    step_timeout_seconds = float(4.0 + int(modulation_profile.get("reasoning_depth", 1) or 1))
        else:
            risk_flags.append("modulation_active")

    if bool(world_state.get("enabled")):
        risk_flags.append("world_state_context")
        if bool(world_state.get("low_confidence_entities")):
            risk_flags.append("world_state_low_confidence")
            if bool(metadata.get("world_state_enforce_runtime", True)):
                verification_mode = "strict"

    if bool(workspace.get("enabled")):
        risk_flags.append("workspace_active")
        if str(workspace.get("selected") or ""):
            risk_flags.append(f"workspace_{str(workspace.get('selected')).lower()}")
        if bool(workspace.get("runtime_enforce")) and str(workspace.get("selected") or "") == "planner":
            same_tick_drain = False

    if bool(truth_engine.get("enabled")):
        risk_flags.append("truth_engine_active")
        guard_action = str(truth_engine.get("guard_action") or "allow")
        if guard_action in {"block", "clarify"} and bool(truth_engine.get("runtime_enforce")):
            verification_mode = "strict"
            same_tick_drain = False
            if guard_action == "block":
                max_parallelism = 1
                risk_flags.append("truth_engine_block")
            else:
                risk_flags.append("truth_engine_clarify")

    if bool(plasticity.get("enabled")):
        risk_flags.append("plasticity_active")
        if bool(plasticity.get("alert")):
            risk_flags.append("plasticity_alert")
            if bool(plasticity.get("runtime_enforce")):
                same_tick_drain = False
                max_parallelism = min(max_parallelism, 2)

    if bool(embodiment.get("enabled")):
        risk_flags.append("embodiment_active")
        if bool(embodiment.get("pause_noncritical_work")):
            risk_flags.append("embodiment_safety_pause")
            if bool(embodiment.get("runtime_enforce")):
                execution_mode = "sequential"
                max_parallelism = 1
                same_tick_drain = False
                verification_mode = "strict"
                if step_timeout_seconds is None:
                    step_timeout_seconds = 10.0

    risk_flags = sorted(set(risk_flags))
    homeostasis_mode = str(homeostasis.get("mode") or "unavailable")
    homeostasis_guardrails = homeostasis.get("guardrails") if isinstance(homeostasis.get("guardrails"), dict) else {}
    homeostasis_effort = homeostasis.get("effort") if isinstance(homeostasis.get("effort"), dict) else {}
    routing_inputs = {
        "archetype": archetype,
        "dependency_density": round(dependency_density, 3),
        "route_policy": route_policy,
        "belief_ids": belief_ids,
        "homeostasis_mode": homeostasis_mode,
        "homeostasis_prefer_chain": homeostasis_guardrails.get("prefer_chain"),
        "homeostasis_block_fastlane": bool(homeostasis_guardrails.get("block_fastlane")),
        "r9_enabled": bool(r9_routing.get("enabled")),
        "r9_selected_chain": routing_selected_chain,
        "r9_default_chain": r9_routing.get("default_chain"),
        "r9_allowed_chain_ids": list(r9_routing.get("allowed_chain_ids") or []),
        "r9_utility": r9_routing.get("utility"),
        "r9_estimated_quality": r9_routing.get("estimated_quality"),
        "r9_risk_flags": list(r9_routing.get("risk_flags") or []),
        "routing_override_reason": routing_override_reason,
    }

    decisions = [
        build_policy_decision(
            domain="routing",
            chosen=routing_choice,
            rationale=(
                f"archetype={archetype}, dependency_density={dependency_density:.2f}, "
                f"r9_selected_chain={routing_selected_chain}, homeostasis_mode={homeostasis_mode}, "
                f"prefer_chain={homeostasis_guardrails.get('prefer_chain')}"
            ),
            confidence=0.78,
            alternatives=["fastlane", "deliberate"],
            inputs=routing_inputs,
        ),
        build_policy_decision(
            domain="scheduler",
            chosen="managed_runtime" if long_running or dependency_density > 0 else "immediate",
            rationale=f"long_running={long_running}, has_waits={has_waits}, homeostasis_mode={homeostasis_mode}",
            confidence=0.8,
            alternatives=["immediate", "managed_runtime"],
            inputs={
                "cadence_seconds": cadence_seconds,
                "has_waits": has_waits,
                "execution_mode": execution_mode,
                "belief_ids": belief_ids,
                "homeostasis_mode": homeostasis_mode,
            },
        ),
        build_policy_decision(
            domain="verification",
            chosen=verification_mode,
            rationale=f"contracts={has_contracts}, homeostasis_mode={homeostasis_mode}",
            confidence=0.76,
            alternatives=["basic", "strict"],
            inputs={
                "contracts_present": has_contracts,
                "belief_ids": belief_ids,
                "homeostasis_human_review_required": bool(homeostasis_effort.get("human_review_required")),
            },
        ),
        build_policy_decision(
            domain="memory",
            chosen="durable_process" if long_running or bool(world_state.get("durable_context_recommended")) else "task_scoped",
            rationale=f"cadence_seconds={cadence_seconds}, world_state={world_state.get('entity_count', 0)}",
            confidence=0.72,
            alternatives=["task_scoped", "durable_process"],
            inputs={"cadence_seconds": cadence_seconds, "belief_ids": belief_ids, "world_state_entity_count": world_state.get("entity_count", 0)},
        ),
    ]
    if bool(homeostasis.get("enabled")):
        decisions.append(
            {
                "domain": "homeostasis",
                "chosen": homeostasis_mode,
                "rationale": (
                    f"intent={homeostasis.get('intent')}, risk_tier={homeostasis.get('risk_tier')}, "
                    f"prefer_chain={homeostasis_guardrails.get('prefer_chain')}"
                ),
                "confidence": 0.81,
                "alternatives": ["normal", "conserve", "protective"],
                "inputs": {
                    "intent": homeostasis.get("intent"),
                    "risk_tier": homeostasis.get("risk_tier"),
                    "belief_ids": belief_ids,
                    "mode_reasons": list(homeostasis.get("mode_reasons") or []),
                    "state_vector": dict(homeostasis.get("state_vector") or {}),
                    "reasoning_depth": homeostasis_effort.get("reasoning_depth"),
                    "tempo": homeostasis_effort.get("tempo"),
                    "tool_budget_class": homeostasis_effort.get("tool_budget_class"),
                    "human_review_required": bool(homeostasis_effort.get("human_review_required")),
                    "escalation_recommended": bool(homeostasis_effort.get("escalation_recommended")),
                    "prefer_chain": homeostasis_guardrails.get("prefer_chain"),
                    "allowed_chains": list(homeostasis_guardrails.get("allowed_chains") or []),
                    "block_fastlane": bool(homeostasis_guardrails.get("block_fastlane")),
                    "source": homeostasis.get("source"),
                },
                "metrics": {},
            }
        )
    if bool(r9_routing.get("enabled")):
        decisions.append(
            {
                "domain": "routing_r9",
                "chosen": routing_selected_chain,
                "rationale": (
                    f"intent={((r9_routing.get('features') or {}).get('intent'))}, risk_tier={((r9_routing.get('features') or {}).get('risk_tier'))}, "
                    f"utility={r9_routing.get('utility')}"
                ),
                "confidence": 0.8,
                "alternatives": list((r9_routing.get("features") or {}).get("allowed_chain_ids") or []),
                "inputs": {
                    "belief_ids": belief_ids,
                    "coarse_choice": r9_routing.get("coarse_choice"),
                    "default_chain": r9_routing.get("default_chain"),
                    "allowed_chain_ids": list(r9_routing.get("allowed_chain_ids") or []),
                    "risk_flags": list(r9_routing.get("risk_flags") or []),
                    "utility": r9_routing.get("utility"),
                    "estimated_quality": r9_routing.get("estimated_quality"),
                    "intent": ((r9_routing.get("features") or {}).get("intent")),
                    "archetype": ((r9_routing.get("features") or {}).get("archetype")),
                    "route_taxonomy_version": ((r9_routing.get("features") or {}).get("route_taxonomy_version")),
                    "policy_spec": ((r9_routing.get("decision") or {}).get("policy_spec") if isinstance(r9_routing.get("decision"), dict) else {}),
                    "override_reason": routing_override_reason,
                },
                "metrics": {},
            }
        )
    if bool(world_state.get("enabled")):
        decisions.append(
            {
                "domain": "world_state",
                "chosen": "tracked" if int(world_state.get("entity_count", 0) or 0) > 0 else "empty",
                "rationale": f"entities={world_state.get('entity_count', 0)}, avg_confidence={world_state.get('avg_confidence', 0.0)}",
                "confidence": 0.77,
                "alternatives": ["empty", "tracked"],
                "inputs": {
                    "belief_ids": belief_ids,
                    "entity_count": world_state.get("entity_count"),
                    "avg_confidence": world_state.get("avg_confidence"),
                    "max_confidence": world_state.get("max_confidence"),
                    "kind_set": list(world_state.get("kind_set") or []),
                    "low_confidence_entities": list(world_state.get("low_confidence_entities") or []),
                    "durable_context_recommended": bool(world_state.get("durable_context_recommended")),
                },
                "metrics": {},
            }
        )
    if bool(modulation.get("enabled")):
        decisions.append(
            {
                "domain": "modulation",
                "chosen": modulation_profile.get("tempo"),
                "rationale": f"depth={modulation_profile.get('reasoning_depth')}, deep={modulation_profile.get('deep_reasoning_required')}",
                "confidence": 0.75,
                "alternatives": ["fast", "steady", "deliberate"],
                "inputs": {
                    "belief_ids": belief_ids,
                    "reasoning_depth": modulation_profile.get("reasoning_depth"),
                    "tempo": modulation_profile.get("tempo"),
                    "deep_reasoning_required": bool(modulation_profile.get("deep_reasoning_required")),
                    "focus_gain": ((modulation.get("state") or {}).get("focus_gain")),
                    "learning_gain": ((modulation.get("state") or {}).get("learning_gain")),
                    "runtime_enforce": bool(modulation.get("runtime_enforce")),
                },
                "metrics": {},
            }
        )
    if bool(workspace.get("enabled")):
        decisions.append(
            {
                "domain": "workspace",
                "chosen": workspace.get("selected"),
                "rationale": f"selected={workspace.get('selected')}, broadcast_count={workspace.get('broadcast_count', 0)}",
                "confidence": 0.73,
                "alternatives": [str(row.get("name")) for row in (workspace.get("trace") or []) if str(row.get("name") or "").strip()],
                "inputs": {
                    "belief_ids": belief_ids,
                    "broadcast_count": workspace.get("broadcast_count"),
                    "broadcast_topics": [str(row.get("topic") or "") for row in (workspace.get("broadcast_payload") or []) if str(row.get("topic") or "").strip()],
                    "runtime_enforce": bool(workspace.get("runtime_enforce")),
                },
                "metrics": {},
            }
        )
    if bool(truth_engine.get("enabled")):
        decisions.append(
            {
                "domain": "truth_engine",
                "chosen": truth_engine.get("guard_action"),
                "rationale": f"confidence={truth_engine.get('calibrated_confidence')}, contradictions={truth_engine.get('contradiction_count')}",
                "confidence": 0.8,
                "alternatives": ["allow", "clarify", "block"],
                "inputs": {
                    "belief_ids": belief_ids,
                    "calibrated_confidence": truth_engine.get("calibrated_confidence"),
                    "contradiction_count": truth_engine.get("contradiction_count"),
                    "evidence_count": truth_engine.get("evidence_count"),
                    "runtime_enforce": bool(truth_engine.get("runtime_enforce")),
                },
                "metrics": {},
            }
        )
    if bool(plasticity.get("enabled")):
        decisions.append(
            {
                "domain": "plasticity",
                "chosen": "alert" if bool(plasticity.get("alert")) else "stable",
                "rationale": f"reasons={plasticity.get('reasons')}, rollback={plasticity.get('rollback_recommended')}",
                "confidence": 0.74,
                "alternatives": ["stable", "alert"],
                "inputs": {
                    "belief_ids": belief_ids,
                    "retention_regression_after_update": ((plasticity.get("metrics") or {}).get("retention_regression_after_update")),
                    "forward_transfer_gain": ((plasticity.get("metrics") or {}).get("forward_transfer_gain")),
                    "rollback_recommended": bool(plasticity.get("rollback_recommended")),
                    "reasons": list(plasticity.get("reasons") or []),
                    "runtime_enforce": bool(plasticity.get("runtime_enforce")),
                },
                "metrics": {},
            }
        )
    if bool(embodiment.get("enabled")):
        decisions.append(
            {
                "domain": "embodiment",
                "chosen": embodiment.get("risk"),
                "rationale": f"pause_noncritical={embodiment.get('pause_noncritical_work')}, regulation={((embodiment.get('regulation') or {}).get('mode'))}",
                "confidence": 0.79,
                "alternatives": ["low", "medium", "high"],
                "inputs": {
                    "belief_ids": belief_ids,
                    "pause_noncritical_work": bool(embodiment.get("pause_noncritical_work")),
                    "regulation_mode": ((embodiment.get("regulation") or {}).get("mode")),
                    "broadcast_severity": ((embodiment.get("broadcast") or {}).get("severity")),
                    "runtime_enforce": bool(embodiment.get("runtime_enforce")),
                },
                "metrics": {},
            }
        )

    settings = {
        "execution_mode": execution_mode,
        "max_parallelism": max_parallelism,
        "verification_mode": verification_mode,
        "same_tick_drain": same_tick_drain,
        "strict_requires_contracts": bool(metadata.get("strict_requires_contracts", False)),
        "enforce_policy": bool(metadata.get("enforce_policy", True)),
        "step_timeout_seconds": step_timeout_seconds,
        "retry_max_attempts": int(metadata.get("retry_max_attempts", 2 if archetype in {"coding", "ops_triage"} else 1) or 1),
        "retry_backoff_seconds": float(metadata.get("retry_backoff_seconds", 0.0) or 0.0),
        "retry_on_timeout": bool(metadata.get("retry_on_timeout", True)),
        "retry_on_status_codes": [int(x) for x in (metadata.get("retry_on_status_codes") or []) if str(x).strip()],
        "retry_on_error_types": [str(x).lower() for x in (metadata.get("retry_on_error_types") or []) if str(x).strip()],
        "workflow_deadline_seconds": metadata.get("workflow_deadline_seconds"),
        "homeostasis_mode": homeostasis_mode,
        "homeostasis_intent": homeostasis.get("intent"),
        "homeostasis_risk_tier": homeostasis.get("risk_tier"),
        "homeostasis_reasoning_depth": homeostasis_effort.get("reasoning_depth"),
        "homeostasis_tool_budget_class": homeostasis_effort.get("tool_budget_class"),
        "homeostasis_prefer_chain": homeostasis_guardrails.get("prefer_chain"),
        "homeostasis_block_fastlane": bool(homeostasis_guardrails.get("block_fastlane")),
        "homeostasis_human_review_required": bool(homeostasis_effort.get("human_review_required")),
        "homeostasis_escalation_recommended": bool(homeostasis_effort.get("escalation_recommended")),
        "routing_selected_chain": routing_selected_chain,
        "routing_default_chain": r9_routing.get("default_chain"),
        "routing_allowed_chain_ids": list(r9_routing.get("allowed_chain_ids") or []),
        "routing_r9_enabled": bool(r9_routing.get("enabled")),
        "routing_r9_utility": r9_routing.get("utility"),
        "routing_override_reason": routing_override_reason,
        "world_state_enabled": bool(world_state.get("enabled")),
        "world_state_entity_count": world_state.get("entity_count"),
        "world_state_avg_confidence": world_state.get("avg_confidence"),
        "world_state_max_confidence": world_state.get("max_confidence"),
        "world_state_low_confidence_entities": list(world_state.get("low_confidence_entities") or []),
        "world_state_runtime_enforce": bool(world_state.get("enabled")) and bool(metadata.get("world_state_enforce_runtime", True)),
        "modulation_enabled": bool(modulation.get("enabled")),
        "modulation_reasoning_depth": modulation_profile.get("reasoning_depth"),
        "modulation_tempo": modulation_profile.get("tempo"),
        "modulation_deep_reasoning_required": bool(modulation_profile.get("deep_reasoning_required")),
        "modulation_runtime_enforce": bool(modulation.get("runtime_enforce")),
        "workspace_enabled": bool(workspace.get("enabled")),
        "workspace_selected_specialist": workspace.get("selected"),
        "workspace_broadcast_count": workspace.get("broadcast_count"),
        "workspace_runtime_enforce": bool(workspace.get("runtime_enforce")),
        "truth_engine_enabled": bool(truth_engine.get("enabled")),
        "truth_guard_action": truth_engine.get("guard_action"),
        "truth_calibrated_confidence": truth_engine.get("calibrated_confidence"),
        "truth_contradiction_count": truth_engine.get("contradiction_count"),
        "truth_engine_runtime_enforce": bool(truth_engine.get("runtime_enforce")),
        "plasticity_enabled": bool(plasticity.get("enabled")),
        "plasticity_alert": bool(plasticity.get("alert")),
        "plasticity_rollback_recommended": bool(plasticity.get("rollback_recommended")),
        "plasticity_reasons": list(plasticity.get("reasons") or []),
        "plasticity_runtime_enforce": bool(plasticity.get("runtime_enforce")),
        "embodiment_enabled": bool(embodiment.get("enabled")),
        "embodiment_risk": embodiment.get("risk"),
        "embodiment_pause_noncritical_work": bool(embodiment.get("pause_noncritical_work")),
        "embodiment_regulation_mode": ((embodiment.get("regulation") or {}).get("mode") if isinstance(embodiment.get("regulation"), dict) else None),
        "embodiment_runtime_enforce": bool(embodiment.get("runtime_enforce")),
    }

    return {
        "archetype": archetype,
        # Belief values, provenance, and error text are never copied into a
        # workflow policy response.  Opaque claim ids are sufficient for
        # traceability and can only be explained through a scoped endpoint.
        "belief_influences": [{"claim_id": claim_id} for claim_id in belief_ids],
        "belief_influence_ids": belief_ids,
        "dependency_density": round(dependency_density, 3),
        "root_count": root_count,
        "long_running": long_running,
        "risk_flags": risk_flags,
        "route_policy_snapshot": route_policy,
        "homeostasis": homeostasis,
        "routing_r9": r9_routing,
        "world_state": world_state,
        "modulation": modulation,
        "workspace": workspace,
        "truth_engine": truth_engine,
        "plasticity": plasticity,
        "embodiment": embodiment,
        "subsystem_activations": subsystem_activations,
        "settings": settings,
        "decisions": [model_dump_compat(d) if not isinstance(d, dict) else dict(d) for d in decisions],
    }


__all__ = ["compile_workflow_policy"]
