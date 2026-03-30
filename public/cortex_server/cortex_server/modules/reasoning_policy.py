from __future__ import annotations

from typing import Any, Dict, List, Optional

from cortex_server.modules.latency_budget_governor import classify_task_archetype
from cortex_server.modules.reasoning_beliefs import select_influential_beliefs
from cortex_server.modules.reasoning_kernel import build_policy_decision, model_dump_compat
from cortex_server.modules.routing_autotune import get_policy_snapshot


_R9_DELIBERATE_CHAINS = {"deliberate_council", "research_grounded"}
_R9_FASTLANE_CHAINS = {"fastlane_memory", "safe_reminder"}



def _infer_homeostasis_intent(*, archetype: str, query: str, metadata: Dict[str, Any]) -> str:
    explicit = str(metadata.get("homeostasis_intent") or metadata.get("intent") or "").strip().lower()
    if explicit in {"qa", "coding", "planning", "research", "creative", "reminder"}:
        return explicit
    q = str(query or "").lower()
    if "remind" in q or "reminder" in q:
        return "reminder"
    if "research" in q or "investigate" in q or "look up" in q:
        return "research"
    return {
        "coding": "coding",
        "planning": "planning",
        "ops_triage": "research",
    }.get(str(archetype or ""), "qa")



def _infer_homeostasis_risk_tier(*, archetype: str, metadata: Dict[str, Any], has_contracts: bool, long_running: bool) -> str:
    explicit = str(metadata.get("homeostasis_risk_tier") or metadata.get("risk_tier") or "").strip().lower()
    if explicit in {"low", "medium", "high", "critical"}:
        return explicit
    if bool(metadata.get("requires_preflight")):
        return "critical"
    if has_contracts or str(archetype or "") in {"coding", "ops_triage"}:
        return "high"
    if long_running:
        return "medium"
    return "low"



def _load_homeostasis_bundle(*, archetype: str, query: str, metadata: Dict[str, Any], has_contracts: bool, long_running: bool) -> Dict[str, Any]:
    if metadata.get("enable_homeostasis_policy") is False:
        return {"enabled": False, "reason": "disabled_by_metadata"}

    intent = _infer_homeostasis_intent(archetype=archetype, query=query, metadata=metadata)
    risk_tier = _infer_homeostasis_risk_tier(archetype=archetype, metadata=metadata, has_contracts=has_contracts, long_running=long_running)
    state_snapshot = metadata.get("homeostasis_state_snapshot") if isinstance(metadata.get("homeostasis_state_snapshot"), dict) else None
    observed_load = metadata.get("homeostasis_observed_load") if isinstance(metadata.get("homeostasis_observed_load"), dict) else {}
    profile_override = metadata.get("homeostasis_profile") if isinstance(metadata.get("homeostasis_profile"), dict) else None

    profile: Optional[Dict[str, Any]] = None
    source = "override"
    if profile_override is not None:
        profile = dict(profile_override)
    else:
        try:
            from services.homeostasis.adaptive_effort_controller import choose_effort_profile
        except Exception as exc:  # pragma: no cover - defensive import guard
            return {
                "enabled": False,
                "reason": f"import_failed:{exc.__class__.__name__}",
                "intent": intent,
                "risk_tier": risk_tier,
            }
        try:
            profile = choose_effort_profile(
                intent=intent,
                risk_tier=risk_tier,
                state_snapshot=state_snapshot,
                observed_load=observed_load,
            )
            source = "adaptive_effort_controller"
        except Exception as exc:  # pragma: no cover - defensive runtime guard
            return {
                "enabled": False,
                "reason": f"profile_failed:{exc.__class__.__name__}",
                "intent": intent,
                "risk_tier": risk_tier,
            }

    profile = dict(profile or {})
    effort = profile.get("effort") if isinstance(profile.get("effort"), dict) else {}
    guardrails = profile.get("guardrails") if isinstance(profile.get("guardrails"), dict) else {}
    state_vector = state_snapshot.get("smoothed_state_vector") if isinstance(state_snapshot, dict) and isinstance(state_snapshot.get("smoothed_state_vector"), dict) else {}
    return {
        "enabled": True,
        "source": source,
        "intent": intent,
        "risk_tier": risk_tier,
        "mode": str(profile.get("mode") or "normal"),
        "mode_reasons": [str(x) for x in (profile.get("mode_reasons") or []) if str(x).strip()],
        "effort": dict(effort),
        "guardrails": dict(guardrails),
        "budget_reference": dict(profile.get("budget_reference") or {}),
        "state_vector": dict(state_vector),
        "observed_load": dict(observed_load or {}),
        "profile": profile,
    }



def _load_r9_routing_bundle(*, query: str, archetype: str, metadata: Dict[str, Any], dependency_density: float, has_contracts: bool, long_running: bool) -> Dict[str, Any]:
    if metadata.get("enable_r9_routing") is False:
        return {"enabled": False, "reason": "disabled_by_metadata"}

    risk_flags = [str(x).strip() for x in (metadata.get("routing_risk_flags") or metadata.get("risk_flags") or []) if str(x).strip()]
    if has_contracts and "verification" not in risk_flags:
        risk_flags.append("verification")
    if dependency_density >= 0.5 and "dependency_dense" not in risk_flags:
        risk_flags.append("dependency_dense")
    if long_running and "long_running" not in risk_flags:
        risk_flags.append("long_running")
    if bool(metadata.get("requires_preflight")) and "requires_preflight" not in risk_flags:
        risk_flags.append("requires_preflight")
    historical_success = float(metadata.get("routing_historical_success", 0.5) or 0.5)

    try:
        from services.routing.route_feature_pipeline import build_route_features
        from services.routing.adaptive_router_policy import choose_route, explain_route_decision
    except Exception as exc:  # pragma: no cover - defensive import guard
        return {
            "enabled": False,
            "reason": f"import_failed:{exc.__class__.__name__}",
            "archetype": archetype,
            "risk_flags": risk_flags,
        }

    try:
        features = build_route_features(query, risk_flags=risk_flags, historical_success=historical_success)
        decision = choose_route(features)
        explanation = explain_route_decision(features)
        selected = decision.get("selected") if isinstance(decision.get("selected"), dict) else {}
        selected_chain = str(selected.get("chain_id") or features.get("default_chain") or "fastlane_memory")
        if selected_chain in _R9_DELIBERATE_CHAINS:
            coarse = "deliberate"
        elif selected_chain in _R9_FASTLANE_CHAINS:
            coarse = "fastlane"
        else:
            coarse = "deliberate" if selected_chain else "fastlane"
        return {
            "enabled": True,
            "source": "r9_adaptive_router_policy",
            "features": features,
            "decision": decision,
            "explanation": explanation,
            "selected_chain": selected_chain,
            "coarse_choice": coarse,
            "risk_flags": risk_flags,
            "historical_success": historical_success,
            "utility": selected.get("utility"),
            "estimated_quality": selected.get("estimated_quality"),
            "allowed_chain_ids": list(features.get("allowed_chain_ids") or []),
            "default_chain": features.get("default_chain"),
        }
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return {
            "enabled": False,
            "reason": f"route_failed:{exc.__class__.__name__}",
            "archetype": archetype,
            "risk_flags": risk_flags,
        }



def _routing_choice_from_homeostasis(bundle: Dict[str, Any], default_choice: str) -> str:
    if not bool(bundle.get("enabled")):
        return default_choice
    mode = str(bundle.get("mode") or "normal")
    guardrails = bundle.get("guardrails") if isinstance(bundle.get("guardrails"), dict) else {}
    prefer_chain = str(guardrails.get("prefer_chain") or "")
    if mode == "protective":
        return "deliberate"
    if bool(guardrails.get("block_fastlane")):
        return "deliberate"
    if prefer_chain in {"deliberate_council", "research_grounded"}:
        return "deliberate"
    return default_choice



def build_workflow_policy(*, name: str, goal: str = "", description: str = "", steps: List[Dict[str, Any]] | None = None, metadata: Dict[str, Any] | None = None) -> Dict[str, Any]:
    steps = list(steps or [])
    metadata = dict(metadata or {})
    query = " ".join(x for x in [name, goal, description] if x).strip()
    archetype = classify_task_archetype(query)
    route_policy = get_policy_snapshot()
    belief_subjects = [str(x) for x in (metadata.get("policy_belief_subjects") or []) if str(x).strip()]
    belief_predicates = [str(x) for x in (metadata.get("policy_belief_predicates") or []) if str(x).strip()]
    policy_task_id = str(metadata.get("task_id") or metadata.get("kernel_task_id") or "").strip() or None
    belief_query = None if (belief_subjects or belief_predicates) else query
    belief_influences = select_influential_beliefs(
        task_id=policy_task_id,
        subjects=belief_subjects or None,
        predicates=belief_predicates or None,
        query=belief_query,
        limit=6,
    )
    if not belief_influences:
        belief_influences = select_influential_beliefs(
            task_id=None,
            subjects=belief_subjects or None,
            predicates=belief_predicates or None,
            query=belief_query,
            limit=6,
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

    homeostasis = _load_homeostasis_bundle(
        archetype=archetype,
        query=query,
        metadata=metadata,
        has_contracts=has_contracts,
        long_running=long_running,
    )
    r9_routing = _load_r9_routing_bundle(
        query=query,
        archetype=archetype,
        metadata=metadata,
        dependency_density=dependency_density,
        has_contracts=has_contracts,
        long_running=long_running,
    )

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
            chosen="durable_process" if long_running else "task_scoped",
            rationale=f"cadence_seconds={cadence_seconds}",
            confidence=0.72,
            alternatives=["task_scoped", "durable_process"],
            inputs={"cadence_seconds": cadence_seconds, "belief_ids": belief_ids},
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

    settings = {
        "execution_mode": execution_mode,
        "max_parallelism": max_parallelism,
        "verification_mode": verification_mode,
        "same_tick_drain": bool(metadata.get("same_tick_drain", True)),
        "strict_requires_contracts": bool(metadata.get("strict_requires_contracts", False)),
        "enforce_policy": bool(metadata.get("enforce_policy", True)),
        "step_timeout_seconds": metadata.get("step_timeout_seconds"),
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
    }

    return {
        "archetype": archetype,
        "belief_influences": belief_influences,
        "belief_influence_ids": belief_ids,
        "dependency_density": round(dependency_density, 3),
        "root_count": root_count,
        "long_running": long_running,
        "risk_flags": risk_flags,
        "route_policy_snapshot": route_policy,
        "homeostasis": homeostasis,
        "routing_r9": r9_routing,
        "settings": settings,
        "decisions": [model_dump_compat(d) if not isinstance(d, dict) else dict(d) for d in decisions],
    }


__all__ = ["build_workflow_policy"]
