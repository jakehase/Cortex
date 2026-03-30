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


def _load_world_state_bundle(*, metadata: Dict[str, Any]) -> Dict[str, Any]:
    snapshot = metadata.get("world_state_snapshot") if isinstance(metadata.get("world_state_snapshot"), dict) else None
    events = [dict(row) for row in (metadata.get("world_state_events") or []) if isinstance(row, dict)]
    if snapshot is None and not events:
        return {"enabled": False, "reason": "no_world_state_input"}

    had_snapshot = snapshot is not None
    source = "snapshot"
    if events:
        try:
            from services.world_state.update_pipeline import apply_events
        except Exception as exc:  # pragma: no cover - defensive import guard
            return {"enabled": False, "reason": f"import_failed:{exc.__class__.__name__}"}
        try:
            snapshot = apply_events(events, initial_state=snapshot)
            source = "events+snapshot" if had_snapshot else "events"
        except Exception as exc:  # pragma: no cover - defensive runtime guard
            return {"enabled": False, "reason": f"world_state_failed:{exc.__class__.__name__}"}

    snapshot = dict(snapshot or {})
    entities = snapshot.get("entities") if isinstance(snapshot.get("entities"), dict) else {}
    confidences: List[float] = []
    low_confidence_entities: List[str] = []
    kinds: List[str] = []
    for entity_id, row in entities.items():
        if not isinstance(row, dict):
            continue
        try:
            conf = float(row.get("confidence", 0.0) or 0.0)
        except Exception:
            conf = 0.0
        confidences.append(conf)
        if conf < 0.65:
            low_confidence_entities.append(str(entity_id))
        kind = str(row.get("kind") or "").strip()
        if kind:
            kinds.append(kind)
    return {
        "enabled": True,
        "source": source,
        "snapshot": snapshot,
        "entity_count": len(entities),
        "entity_ids": sorted(str(x) for x in entities.keys())[:10],
        "kind_set": sorted(set(kinds)),
        "avg_confidence": round(sum(confidences) / len(confidences), 4) if confidences else 0.0,
        "max_confidence": round(max(confidences), 4) if confidences else 0.0,
        "low_confidence_entities": sorted(low_confidence_entities),
        "durable_context_recommended": bool(entities),
    }


def _default_modulation_observations(*, query: str, metadata: Dict[str, Any], has_contracts: bool, dependency_density: float, long_running: bool) -> Dict[str, Any]:
    q = str(query or "").lower()
    salience = 0.35
    novelty = 0.25
    uncertainty = 0.2
    urgency = 0.15
    if has_contracts:
        uncertainty += 0.2
    if dependency_density >= 0.5:
        salience += 0.2
    if long_running:
        urgency += 0.15
    if bool(metadata.get("requires_preflight")):
        urgency += 0.15
        uncertainty += 0.1
    if any(word in q for word in ["investigate", "research", "debug", "trace", "risky", "failure", "incident"]):
        salience += 0.15
        novelty += 0.15
        uncertainty += 0.15
    return {
        "salience": min(1.0, salience),
        "novelty": min(1.0, novelty),
        "uncertainty": min(1.0, uncertainty),
        "urgency": min(1.0, urgency),
    }


def _load_modulation_bundle(*, query: str, metadata: Dict[str, Any], has_contracts: bool, dependency_density: float, long_running: bool) -> Dict[str, Any]:
    observations = metadata.get("modulation_observations") if isinstance(metadata.get("modulation_observations"), dict) else None
    source = "metadata" if observations is not None else "derived"
    observations = dict(observations or _default_modulation_observations(query=query, metadata=metadata, has_contracts=has_contracts, dependency_density=dependency_density, long_running=long_running))
    try:
        from services.modulation.policy_runtime import modulation_state_from_observations
        from services.modulation.adaptive_depth_controller import choose_reasoning_profile
    except Exception as exc:  # pragma: no cover - defensive import guard
        return {"enabled": False, "reason": f"import_failed:{exc.__class__.__name__}"}
    try:
        state = modulation_state_from_observations(
            salience=float(observations.get("salience", 0.0) or 0.0),
            novelty=float(observations.get("novelty", 0.0) or 0.0),
            uncertainty=float(observations.get("uncertainty", 0.0) or 0.0),
            urgency=float(observations.get("urgency", 0.0) or 0.0),
        )
        profile = choose_reasoning_profile(state)
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return {"enabled": False, "reason": f"modulation_failed:{exc.__class__.__name__}"}
    return {
        "enabled": True,
        "source": source,
        "observations": observations,
        "state": dict(state or {}),
        "profile": dict(profile or {}),
        "runtime_enforce": bool(metadata.get("modulation_enforce_runtime", False)),
    }


def _default_workspace_candidates(*, archetype: str, metadata: Dict[str, Any], steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    needs_retrieval = any("search" in str((step.get("title") or "")).lower() or "research" in str((step.get("title") or "")).lower() for step in steps if isinstance(step, dict))
    needs_operator = bool(metadata.get("requires_preflight")) or any(bool((step.get("metadata") or {}).get("delay_seconds")) for step in steps if isinstance(step, dict))
    return [
        {"name": "planner", "priority": 0.88 if archetype in {"planning", "coding"} else 0.7, "confidence": 0.76},
        {"name": "retriever", "priority": 0.84 if needs_retrieval or archetype == "ops_triage" else 0.58, "confidence": 0.8},
        {"name": "operator", "priority": 0.82 if needs_operator else 0.46, "confidence": 0.71},
    ]


def _default_workspace_topics(*, steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    topics: List[Dict[str, Any]] = []
    for idx, step in enumerate([dict(row) for row in steps if isinstance(row, dict)][:6], start=1):
        title = str(step.get("title") or step.get("node_id") or f"step_{idx}")
        topics.append({
            "topic": title,
            "salience": 0.9 if idx == 1 else (0.65 if idx <= 3 else 0.3),
            "confidential": bool(((step.get("metadata") or {}).get("confidential"))),
        })
    return topics


def _load_workspace_bundle(*, archetype: str, metadata: Dict[str, Any], steps: List[Dict[str, Any]]) -> Dict[str, Any]:
    raw_candidates = metadata.get("workspace_candidates") if isinstance(metadata.get("workspace_candidates"), list) else None
    raw_topics = metadata.get("workspace_topics") if isinstance(metadata.get("workspace_topics"), list) else None
    candidates = [dict(row) for row in (raw_candidates if raw_candidates is not None else _default_workspace_candidates(archetype=archetype, metadata=metadata, steps=steps)) if isinstance(row, dict)]
    topics = [dict(row) for row in (raw_topics if raw_topics is not None else _default_workspace_topics(steps=steps)) if isinstance(row, dict)]
    try:
        from services.workspace.arbitration_engine import choose_specialist
        from services.workspace.broadcast_policy import select_broadcast_payload
    except Exception as exc:  # pragma: no cover - defensive import guard
        return {"enabled": False, "reason": f"import_failed:{exc.__class__.__name__}"}
    try:
        arbitration = choose_specialist(candidates)
        broadcast = select_broadcast_payload(topics)
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return {"enabled": False, "reason": f"workspace_failed:{exc.__class__.__name__}"}
    return {
        "enabled": True,
        "source": "metadata" if raw_candidates is not None or raw_topics is not None else "derived",
        "selected": arbitration.get("selected"),
        "trace": list(arbitration.get("trace") or []),
        "broadcast_payload": [dict(row) for row in (broadcast or []) if isinstance(row, dict)],
        "broadcast_count": len(broadcast or []),
        "runtime_enforce": bool(metadata.get("workspace_enforce_runtime", False)),
    }


def _load_truth_engine_bundle(*, metadata: Dict[str, Any], belief_ids: List[str]) -> Dict[str, Any]:
    raw_claims = metadata.get("truth_claims") if isinstance(metadata.get("truth_claims"), list) else None
    raw_confidence = metadata.get("truth_raw_confidence")
    contradiction_count = int(metadata.get("truth_contradiction_count", 0) or 0)
    evidence_count = int(metadata.get("truth_evidence_count", len(belief_ids)) or len(belief_ids))
    if raw_claims is None and raw_confidence is None and contradiction_count <= 0 and evidence_count <= 0:
        return {"enabled": False, "reason": "no_truth_input"}
    claims = [dict(row) for row in (raw_claims or []) if isinstance(row, dict)]
    if not claims:
        claims = [{"claim_id": "workflow_claim", "evidence": list(belief_ids[:3]), "contradiction_count": contradiction_count}]
    try:
        from services.truth_engine.calibration_model import calibrate_confidence
        from services.truth_engine.pre_send_guard import guard_output
    except Exception as exc:  # pragma: no cover - defensive import guard
        return {"enabled": False, "reason": f"import_failed:{exc.__class__.__name__}"}
    try:
        calibrated_confidence = calibrate_confidence(float(raw_confidence if raw_confidence is not None else 0.68), evidence_count=evidence_count, contradiction_count=contradiction_count)
        guard = guard_output(claims=claims)
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return {"enabled": False, "reason": f"truth_engine_failed:{exc.__class__.__name__}"}
    return {
        "enabled": True,
        "source": "metadata",
        "guard_action": guard.get("action"),
        "issues": [dict(row) for row in (guard.get("issues") or []) if isinstance(row, dict)],
        "fallback_text": guard.get("fallback_text"),
        "calibrated_confidence": calibrated_confidence,
        "contradiction_count": contradiction_count,
        "evidence_count": evidence_count,
        "runtime_enforce": bool(metadata.get("truth_engine_enforce_runtime", True)),
    }


def _load_plasticity_bundle(*, metadata: Dict[str, Any]) -> Dict[str, Any]:
    metrics_input = metadata.get("plasticity_metrics") if isinstance(metadata.get("plasticity_metrics"), dict) else None
    if metrics_input is None:
        return {"enabled": False, "reason": "no_plasticity_input"}
    retention_floor = float(metadata.get("plasticity_retention_floor", 0.95) or 0.95)
    anchor_violation_count = int(metadata.get("plasticity_anchor_violation_count", 0) or 0)
    try:
        from services.plasticity.continual_eval import continual_eval_matrix
        from services.plasticity.forgetting_alerts import forgetting_alert
    except Exception as exc:  # pragma: no cover - defensive import guard
        return {"enabled": False, "reason": f"import_failed:{exc.__class__.__name__}"}
    try:
        metrics = continual_eval_matrix(
            retain=float(metrics_input.get("retain", 1.0) or 1.0),
            transfer=float(metrics_input.get("transfer", 1.0) or 1.0),
            forget=float(metrics_input.get("forget", 0.0) or 0.0),
        )
        alert = forgetting_alert(metrics, retention_floor=retention_floor, anchor_violation_count=anchor_violation_count)
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return {"enabled": False, "reason": f"plasticity_failed:{exc.__class__.__name__}"}
    return {
        "enabled": True,
        "source": "metadata",
        "metrics": dict(metrics or {}),
        "alert": bool(alert.get("alert")),
        "rollback_recommended": bool(alert.get("rollback_recommended")),
        "reasons": [str(x) for x in (alert.get("reasons") or []) if str(x).strip()],
        "runtime_enforce": bool(metadata.get("plasticity_enforce_runtime", True)),
    }


def _load_embodiment_bundle(*, metadata: Dict[str, Any]) -> Dict[str, Any]:
    episode = metadata.get("embodiment_episode") if isinstance(metadata.get("embodiment_episode"), dict) else None
    if episode is None:
        return {"enabled": False, "reason": "no_embodiment_input"}
    try:
        from services.embodiment.integration_hooks import AdaptiveRegulator, ArbitrationEngine, BroadcastPolicy, WorldStateModel
    except Exception as exc:  # pragma: no cover - defensive import guard
        return {"enabled": False, "reason": f"import_failed:{exc.__class__.__name__}"}
    try:
        world = WorldStateModel()
        arbitration = ArbitrationEngine()
        broadcaster = BroadcastPolicy()
        regulator = AdaptiveRegulator()
        world_state = world.merge_embodiment_episode(episode)
        decision = arbitration.arbitrate_embodiment_episode(episode)
        signal = broadcaster.select_from_embodiment_episode(episode, decision)
        regulation = regulator.regulate_with_embodiment_hooks(episode)
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return {"enabled": False, "reason": f"embodiment_failed:{exc.__class__.__name__}"}
    return {
        "enabled": True,
        "source": "metadata",
        "world_state": dict(world_state or {}),
        "arbitration": dict(decision or {}),
        "broadcast": dict(signal or {}),
        "regulation": dict(regulation or {}),
        "risk": decision.get("risk"),
        "pause_noncritical_work": bool(decision.get("pause_noncritical_work")),
        "runtime_enforce": bool(metadata.get("embodiment_enforce_runtime", True)),
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
    same_tick_drain = bool(metadata.get("same_tick_drain", True))
    step_timeout_seconds = metadata.get("step_timeout_seconds")

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
    world_state = _load_world_state_bundle(metadata=metadata)
    modulation = _load_modulation_bundle(
        query=query,
        metadata=metadata,
        has_contracts=has_contracts,
        dependency_density=dependency_density,
        long_running=long_running,
    )
    workspace = _load_workspace_bundle(archetype=archetype, metadata=metadata, steps=steps)
    truth_engine = _load_truth_engine_bundle(metadata=metadata, belief_ids=belief_ids)
    plasticity = _load_plasticity_bundle(metadata=metadata)
    embodiment = _load_embodiment_bundle(metadata=metadata)

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
        "belief_influences": belief_influences,
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
        "settings": settings,
        "decisions": [model_dump_compat(d) if not isinstance(d, dict) else dict(d) for d in decisions],
    }


__all__ = ["build_workflow_policy"]
