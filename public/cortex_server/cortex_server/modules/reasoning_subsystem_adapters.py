from __future__ import annotations

from typing import Any, Dict, List, Optional

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


from cortex_server.modules.reasoning_contracts import EvidenceRef, EpistemicContext, GovernanceSignal, SubsystemActivation


def collect_subsystem_bundles(*, archetype: str, query: str, metadata: Dict[str, Any], steps: List[Dict[str, Any]], belief_ids: List[str], dependency_density: float, has_contracts: bool, long_running: bool) -> Dict[str, Dict[str, Any]]:
    return {
        "homeostasis": _load_homeostasis_bundle(
            archetype=archetype,
            query=query,
            metadata=metadata,
            has_contracts=has_contracts,
            long_running=long_running,
        ),
        "routing_r9": _load_r9_routing_bundle(
            query=query,
            archetype=archetype,
            metadata=metadata,
            dependency_density=dependency_density,
            has_contracts=has_contracts,
            long_running=long_running,
        ),
        "world_state": _load_world_state_bundle(metadata=metadata),
        "modulation": _load_modulation_bundle(
            query=query,
            metadata=metadata,
            has_contracts=has_contracts,
            dependency_density=dependency_density,
            long_running=long_running,
        ),
        "workspace": _load_workspace_bundle(archetype=archetype, metadata=metadata, steps=steps),
        "truth_engine": _load_truth_engine_bundle(metadata=metadata, belief_ids=belief_ids),
        "plasticity": _load_plasticity_bundle(metadata=metadata),
        "embodiment": _load_embodiment_bundle(metadata=metadata),
    }



def _bundle_signal(subsystem: str, bundle: Dict[str, Any]) -> GovernanceSignal:
    recommendation = "allow"
    blocking = False
    severity = "low"
    rationale = f"{subsystem} observed"
    if subsystem == "truth_engine":
        action = str(bundle.get("guard_action") or "allow")
        recommendation = "block" if action == "block" else ("clarify" if action == "clarify" else "allow")
        blocking = action == "block"
        severity = "critical" if action == "block" else ("high" if action == "clarify" else "low")
        rationale = f"truth action={action}"
    elif subsystem == "embodiment":
        risk = str(bundle.get("risk") or "low")
        recommendation = "pause" if bool(bundle.get("pause_noncritical_work")) else "allow"
        blocking = bool(bundle.get("pause_noncritical_work"))
        severity = "critical" if risk == "high" else ("medium" if risk == "medium" else "low")
        rationale = f"embodiment risk={risk}"
    elif subsystem == "plasticity":
        recommendation = "rollback" if bool(bundle.get("rollback_recommended")) else "allow"
        severity = "high" if bool(bundle.get("alert")) else "low"
        rationale = f"plasticity alert={bool(bundle.get('alert'))}"
    elif subsystem == "homeostasis":
        mode = str(bundle.get("mode") or "normal")
        recommendation = "require" if mode == "protective" else ("prefer" if mode == "conserve" else "allow")
        severity = "high" if mode == "protective" else ("medium" if mode == "conserve" else "low")
        rationale = f"homeostasis mode={mode}"
    elif subsystem == "routing_r9":
        recommendation = "prefer"
        severity = "medium"
        rationale = f"routing chain={bundle.get('selected_chain')}"
    elif subsystem == "modulation":
        recommendation = "prefer"
        severity = "medium" if bool(((bundle.get('profile') or {}).get('deep_reasoning_required'))) else "low"
        rationale = f"modulation tempo={((bundle.get('profile') or {}).get('tempo'))}"
    return GovernanceSignal(
        source=subsystem,
        kind=f"{subsystem}_signal",
        severity=severity,
        blocking=blocking,
        recommendation=recommendation,
        rationale=rationale,
        confidence=float(bundle.get("calibrated_confidence", bundle.get("avg_confidence", 0.75)) or 0.75),
    )



def bundle_to_activation(subsystem: str, bundle: Dict[str, Any]) -> SubsystemActivation:
    bundle = dict(bundle or {})
    enabled = bool(bundle.get("enabled"))
    evidence_refs: List[EvidenceRef] = []
    epistemic_contexts: List[EpistemicContext] = []
    if subsystem == "world_state" and enabled:
        entity_ids = [str(x) for x in (bundle.get("entity_ids") or []) if str(x).strip()]
        evidence_refs.append(EvidenceRef(kind="world_state", source=str(bundle.get("source") or "world_state"), summary=f"{len(entity_ids)} entities tracked", confidence=bundle.get("avg_confidence")))
        epistemic_contexts.append(EpistemicContext(
            source="world_state",
            entity_ids=entity_ids,
            confidence=float(bundle.get("avg_confidence", 0.0) or 0.0),
            uncertainty=round(max(0.0, 1.0 - float(bundle.get("avg_confidence", 0.0) or 0.0)), 4),
            freshness=1.0,
            contradiction_count=0,
            provenance_strength=float(bundle.get("max_confidence", bundle.get("avg_confidence", 0.0)) or 0.0),
            summary=f"world_state entities={bundle.get('entity_count', 0)}",
            evidence_refs=list(evidence_refs),
            metadata={"kind_set": list(bundle.get("kind_set") or [])},
        ))
    elif subsystem == "truth_engine" and enabled:
        contradiction_count = int(bundle.get("contradiction_count", 0) or 0)
        evidence_refs.append(EvidenceRef(kind="truth_engine", source="truth_engine", summary=f"guard={bundle.get('guard_action')}", confidence=bundle.get("calibrated_confidence")))
        epistemic_contexts.append(EpistemicContext(
            source="truth_engine",
            confidence=float(bundle.get("calibrated_confidence", 0.0) or 0.0),
            uncertainty=round(max(0.0, 1.0 - float(bundle.get("calibrated_confidence", 0.0) or 0.0)), 4),
            freshness=1.0,
            contradiction_count=contradiction_count,
            provenance_strength=min(1.0, 0.2 * int(bundle.get("evidence_count", 0) or 0)),
            summary=f"truth_engine action={bundle.get('guard_action')}",
            evidence_refs=list(evidence_refs),
        ))
    signal = _bundle_signal(subsystem, bundle) if enabled else GovernanceSignal(source=subsystem, kind=f"{subsystem}_signal", recommendation="allow", rationale=str(bundle.get("reason") or "disabled"), confidence=0.0)
    summary = str(bundle.get("mode") or bundle.get("selected_chain") or bundle.get("guard_action") or bundle.get("risk") or bundle.get("selected") or bundle.get("reason") or ("enabled" if enabled else "disabled"))
    return SubsystemActivation(
        subsystem=subsystem,
        active=enabled,
        summary=summary,
        epistemic_contexts=epistemic_contexts,
        governance_signals=[signal],
        explain_atoms=[],
        metadata={"bundle": bundle},
    )



def collect_subsystem_activations(*, bundles: Dict[str, Dict[str, Any]]) -> List[SubsystemActivation]:
    return [bundle_to_activation(name, bundle) for name, bundle in bundles.items()]


__all__ = [
    "_default_modulation_observations",
    "_default_workspace_candidates",
    "_default_workspace_topics",
    "_infer_homeostasis_intent",
    "_infer_homeostasis_risk_tier",
    "_load_embodiment_bundle",
    "_load_homeostasis_bundle",
    "_load_modulation_bundle",
    "_load_plasticity_bundle",
    "_load_r9_routing_bundle",
    "_load_truth_engine_bundle",
    "_load_world_state_bundle",
    "_load_workspace_bundle",
    "_routing_choice_from_homeostasis",
    "bundle_to_activation",
    "collect_subsystem_activations",
    "collect_subsystem_bundles",
]
