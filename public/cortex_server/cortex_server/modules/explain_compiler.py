from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from cortex_server.modules import reasoning_explain as explain
from cortex_server.modules import reasoning_observability as observability
from cortex_server.modules.governance_arbitration import RUNTIME_CONSTRAINT_PRECEDENCE
from cortex_server.modules.reasoning_contracts import ExplainAtom, model_dump_compat
from cortex_server.modules.runtime_constraint_compiler import compile_runtime_constraint_settings


JsonDict = Dict[str, Any]
ExplainBeliefFn = Callable[[str], Optional[JsonDict]]
GetBeliefFn = Callable[[str], Optional[JsonDict]]
SelectInfluentialBeliefsFn = Callable[..., List[JsonDict]]


_RUNTIME_OWNER_HINTS = {
    "routing_r9": ["execution_mode", "same_tick_drain", "step_timeout_seconds", "retry_max_attempts", "retry_on_timeout"],
    "homeostasis": ["execution_mode", "max_parallelism", "same_tick_drain", "verification_mode", "step_timeout_seconds", "retry_max_attempts", "retry_on_timeout"],
    "world_state": ["verification_mode"],
    "modulation": ["max_parallelism", "same_tick_drain", "step_timeout_seconds"],
    "workspace": ["same_tick_drain"],
    "truth_engine": ["verification_mode", "same_tick_drain", "max_parallelism"],
    "plasticity": ["same_tick_drain", "max_parallelism"],
    "embodiment": ["execution_mode", "max_parallelism", "same_tick_drain", "verification_mode", "step_timeout_seconds"],
}



def routing_r9_summary(policy: JsonDict) -> JsonDict:
    policy = policy if isinstance(policy, dict) else {}
    routing_r9 = policy.get("routing_r9") if isinstance(policy.get("routing_r9"), dict) else {}
    if not routing_r9:
        return {
            "enabled": False,
            "selected_chain": None,
            "operator_summary": "r9 routing unavailable",
        }
    return {
        "enabled": bool(routing_r9.get("enabled")),
        "selected_chain": routing_r9.get("selected_chain"),
        "default_chain": routing_r9.get("default_chain"),
        "allowed_chain_ids": list(routing_r9.get("allowed_chain_ids") or []),
        "coarse_choice": routing_r9.get("coarse_choice"),
        "utility": routing_r9.get("utility"),
        "estimated_quality": routing_r9.get("estimated_quality"),
        "operator_summary": (
            f"r9 chain={routing_r9.get('selected_chain')} coarse={routing_r9.get('coarse_choice')} "
            f"utility={routing_r9.get('utility')}"
        ),
    }



def homeostasis_summary(policy: JsonDict) -> JsonDict:
    policy = policy if isinstance(policy, dict) else {}
    homeostasis = policy.get("homeostasis") if isinstance(policy.get("homeostasis"), dict) else {}
    effort = homeostasis.get("effort") if isinstance(homeostasis.get("effort"), dict) else {}
    guardrails = homeostasis.get("guardrails") if isinstance(homeostasis.get("guardrails"), dict) else {}
    if not homeostasis:
        return {
            "enabled": False,
            "mode": None,
            "intent": None,
            "risk_tier": None,
            "prefer_chain": None,
            "reasoning_depth": None,
            "operator_summary": "homeostasis unavailable",
        }
    return {
        "enabled": bool(homeostasis.get("enabled")),
        "mode": homeostasis.get("mode"),
        "intent": homeostasis.get("intent"),
        "risk_tier": homeostasis.get("risk_tier"),
        "prefer_chain": guardrails.get("prefer_chain"),
        "reasoning_depth": effort.get("reasoning_depth"),
        "human_review_required": bool(effort.get("human_review_required")),
        "escalation_recommended": bool(effort.get("escalation_recommended")),
        "mode_reasons": list(homeostasis.get("mode_reasons") or []),
        "operator_summary": (
            f"homeostasis mode={homeostasis.get('mode')} intent={homeostasis.get('intent')} "
            f"risk={homeostasis.get('risk_tier')} prefer_chain={guardrails.get('prefer_chain')} "
            f"depth={effort.get('reasoning_depth')}"
        ),
    }



def world_state_summary(policy: JsonDict) -> JsonDict:
    policy = policy if isinstance(policy, dict) else {}
    world_state = policy.get("world_state") if isinstance(policy.get("world_state"), dict) else {}
    if not world_state:
        return {
            "enabled": False,
            "entity_count": 0,
            "operator_summary": "world state unavailable",
        }
    return {
        "enabled": bool(world_state.get("enabled")),
        "entity_count": int(world_state.get("entity_count", 0) or 0),
        "kind_set": list(world_state.get("kind_set") or []),
        "avg_confidence": world_state.get("avg_confidence"),
        "max_confidence": world_state.get("max_confidence"),
        "low_confidence_entities": list(world_state.get("low_confidence_entities") or []),
        "operator_summary": (
            f"world_state entities={world_state.get('entity_count', 0)} "
            f"avg_conf={world_state.get('avg_confidence')} low_conf={len(world_state.get('low_confidence_entities') or [])}"
        ),
    }



def modulation_summary(policy: JsonDict) -> JsonDict:
    policy = policy if isinstance(policy, dict) else {}
    modulation = policy.get("modulation") if isinstance(policy.get("modulation"), dict) else {}
    profile = modulation.get("profile") if isinstance(modulation.get("profile"), dict) else {}
    state = modulation.get("state") if isinstance(modulation.get("state"), dict) else {}
    if not modulation:
        return {
            "enabled": False,
            "tempo": None,
            "reasoning_depth": None,
            "operator_summary": "modulation unavailable",
        }
    return {
        "enabled": bool(modulation.get("enabled")),
        "tempo": profile.get("tempo"),
        "reasoning_depth": profile.get("reasoning_depth"),
        "deep_reasoning_required": bool(profile.get("deep_reasoning_required")),
        "focus_gain": state.get("focus_gain"),
        "learning_gain": state.get("learning_gain"),
        "operator_summary": (
            f"modulation tempo={profile.get('tempo')} depth={profile.get('reasoning_depth')} "
            f"deep={profile.get('deep_reasoning_required')}"
        ),
    }



def workspace_summary(policy: JsonDict) -> JsonDict:
    policy = policy if isinstance(policy, dict) else {}
    workspace = policy.get("workspace") if isinstance(policy.get("workspace"), dict) else {}
    if not workspace:
        return {
            "enabled": False,
            "selected": None,
            "operator_summary": "workspace unavailable",
        }
    return {
        "enabled": bool(workspace.get("enabled")),
        "selected": workspace.get("selected"),
        "broadcast_count": int(workspace.get("broadcast_count", 0) or 0),
        "broadcast_topics": [str(row.get("topic") or "") for row in (workspace.get("broadcast_payload") or []) if isinstance(row, dict) and str(row.get("topic") or "").strip()],
        "operator_summary": f"workspace specialist={workspace.get('selected')} broadcasts={workspace.get('broadcast_count', 0)}",
    }



def truth_engine_summary(policy: JsonDict) -> JsonDict:
    policy = policy if isinstance(policy, dict) else {}
    truth_engine = policy.get("truth_engine") if isinstance(policy.get("truth_engine"), dict) else {}
    if not truth_engine:
        return {
            "enabled": False,
            "guard_action": None,
            "operator_summary": "truth engine unavailable",
        }
    return {
        "enabled": bool(truth_engine.get("enabled")),
        "guard_action": truth_engine.get("guard_action"),
        "calibrated_confidence": truth_engine.get("calibrated_confidence"),
        "contradiction_count": truth_engine.get("contradiction_count"),
        "operator_summary": (
            f"truth_engine action={truth_engine.get('guard_action')} conf={truth_engine.get('calibrated_confidence')} "
            f"contradictions={truth_engine.get('contradiction_count')}"
        ),
    }



def plasticity_summary(policy: JsonDict) -> JsonDict:
    policy = policy if isinstance(policy, dict) else {}
    plasticity = policy.get("plasticity") if isinstance(policy.get("plasticity"), dict) else {}
    metrics = plasticity.get("metrics") if isinstance(plasticity.get("metrics"), dict) else {}
    if not plasticity:
        return {
            "enabled": False,
            "alert": False,
            "operator_summary": "plasticity unavailable",
        }
    return {
        "enabled": bool(plasticity.get("enabled")),
        "alert": bool(plasticity.get("alert")),
        "rollback_recommended": bool(plasticity.get("rollback_recommended")),
        "reasons": list(plasticity.get("reasons") or []),
        "retention_regression_after_update": metrics.get("retention_regression_after_update"),
        "forward_transfer_gain": metrics.get("forward_transfer_gain"),
        "operator_summary": (
            f"plasticity alert={plasticity.get('alert')} rollback={plasticity.get('rollback_recommended')} "
            f"reasons={list(plasticity.get('reasons') or [])}"
        ),
    }



def embodiment_summary(policy: JsonDict) -> JsonDict:
    policy = policy if isinstance(policy, dict) else {}
    embodiment = policy.get("embodiment") if isinstance(policy.get("embodiment"), dict) else {}
    regulation = embodiment.get("regulation") if isinstance(embodiment.get("regulation"), dict) else {}
    if not embodiment:
        return {
            "enabled": False,
            "risk": None,
            "operator_summary": "embodiment unavailable",
        }
    return {
        "enabled": bool(embodiment.get("enabled")),
        "risk": embodiment.get("risk"),
        "pause_noncritical_work": bool(embodiment.get("pause_noncritical_work")),
        "regulation_mode": regulation.get("mode"),
        "operator_summary": (
            f"embodiment risk={embodiment.get('risk')} pause_noncritical={embodiment.get('pause_noncritical_work')} "
            f"regulation={regulation.get('mode')}"
        ),
    }



def compile_policy_surface_summaries(policy: JsonDict) -> JsonDict:
    policy = policy if isinstance(policy, dict) else {}
    return {
        "routing_r9_summary": routing_r9_summary(policy),
        "homeostasis_summary": homeostasis_summary(policy),
        "world_state_summary": world_state_summary(policy),
        "modulation_summary": modulation_summary(policy),
        "workspace_summary": workspace_summary(policy),
        "truth_engine_summary": truth_engine_summary(policy),
        "plasticity_summary": plasticity_summary(policy),
        "embodiment_summary": embodiment_summary(policy),
    }



def compile_policy_surface_sections(policy: JsonDict, *, policy_outcome_evaluation: Optional[List[JsonDict]] = None) -> JsonDict:
    policy = policy if isinstance(policy, dict) else {}
    summaries = compile_policy_surface_summaries(policy)
    return {
        "routing_r9": policy.get("routing_r9") if isinstance(policy.get("routing_r9"), dict) else {},
        "homeostasis": policy.get("homeostasis") if isinstance(policy.get("homeostasis"), dict) else {},
        "world_state": policy.get("world_state") if isinstance(policy.get("world_state"), dict) else {},
        "modulation": policy.get("modulation") if isinstance(policy.get("modulation"), dict) else {},
        "workspace": policy.get("workspace") if isinstance(policy.get("workspace"), dict) else {},
        "truth_engine": policy.get("truth_engine") if isinstance(policy.get("truth_engine"), dict) else {},
        "plasticity": policy.get("plasticity") if isinstance(policy.get("plasticity"), dict) else {},
        "embodiment": policy.get("embodiment") if isinstance(policy.get("embodiment"), dict) else {},
        **summaries,
        "belief_influences": policy.get("belief_influences") if isinstance(policy.get("belief_influences"), list) else [],
        "subsystem_activations": [dict(row) for row in (policy.get("subsystem_activations") or []) if isinstance(row, dict)],
        "control_plane_summary": compile_control_plane_summary(policy, policy_outcome_evaluation=policy_outcome_evaluation),
        "explain_atoms": compile_explain_atoms(policy, policy_outcome_evaluation=policy_outcome_evaluation),
    }



def _infer_constraint_field_owners(settings: JsonDict, field_owners: JsonDict, precedence: List[str]) -> JsonDict:
    owners = dict(field_owners or {})
    settings = settings if isinstance(settings, dict) else {}
    precedence = [str(x) for x in (precedence or []) if str(x).strip()] or list(RUNTIME_CONSTRAINT_PRECEDENCE)
    for subsystem in precedence:
        if not bool(settings.get(f"{subsystem}_runtime_enforced")):
            continue
        for field in _RUNTIME_OWNER_HINTS.get(subsystem, []):
            owners[field] = subsystem
    return owners



def compile_control_plane_summary(policy: JsonDict, *, policy_outcome_evaluation: Optional[List[JsonDict]] = None) -> JsonDict:
    policy = policy if isinstance(policy, dict) else {}
    settings = policy.get("settings") if isinstance(policy.get("settings"), dict) else {}
    compiled_settings = compile_runtime_constraint_settings({"policy": policy}) if policy else dict(settings)
    subsystem_activations = [dict(row) for row in (policy.get("subsystem_activations") or []) if isinstance(row, dict)]
    active_subsystems = [str(row.get("subsystem") or "") for row in subsystem_activations if bool(row.get("active")) and str(row.get("subsystem") or "").strip()]
    decisions = [dict(row) for row in (compiled_settings.get("constraint_decisions") or settings.get("constraint_decisions") or []) if isinstance(row, dict)]
    precedence = [str(x) for x in (compiled_settings.get("constraint_precedence") or settings.get("constraint_precedence") or []) if str(x).strip()] or list(RUNTIME_CONSTRAINT_PRECEDENCE)
    field_owners = _infer_constraint_field_owners(
        compiled_settings,
        dict(compiled_settings.get("constraint_field_owners") or settings.get("constraint_field_owners") or {}),
        precedence,
    )
    mismatches = [str(row.get("domain") or "") for row in (policy_outcome_evaluation or []) if isinstance(row, dict) and str(row.get("outcome") or "") == "mismatch"]
    return {
        "active_subsystems": active_subsystems,
        "constraint_precedence": precedence,
        "constraint_field_owners": field_owners,
        "constraint_decisions": decisions,
        "mismatch_domains": mismatches,
        "operator_summary": (
            f"active_subsystems={len(active_subsystems)} precedence={','.join(precedence[:4])} "
            f"constraint_decisions={len(decisions)} mismatches={len(mismatches)}"
        ),
    }



def compile_explain_atoms(policy: JsonDict, *, policy_outcome_evaluation: Optional[List[JsonDict]] = None) -> List[JsonDict]:
    policy = policy if isinstance(policy, dict) else {}
    rows = [dict(row) for row in (policy_outcome_evaluation or []) if isinstance(row, dict)]
    control_plane = compile_control_plane_summary(policy, policy_outcome_evaluation=rows)
    atoms: List[JsonDict] = []
    for row in rows:
        domain = str(row.get("domain") or "unknown")
        chosen = row.get("chosen")
        outcome = str(row.get("outcome") or "observed")
        expected = row.get("expected") if isinstance(row.get("expected"), dict) else {}
        observed = row.get("observed") if isinstance(row.get("observed"), dict) else {}
        comparison = row.get("comparison") if isinstance(row.get("comparison"), dict) else {}
        mismatch_reason = None
        if outcome == "mismatch":
            mismatch_reason = ", ".join(sorted([str(key) for key, value in comparison.items() if value is False])) or "comparison_mismatch"
        atoms.append(
            model_dump_compat(
                ExplainAtom(
                    explain_id=f"explain_atom:{domain}",
                    subsystem=domain,
                    title=f"{domain} outcome={outcome}",
                    expected_effect=f"chosen={chosen}; expected={expected}",
                    observed_effect=f"observed={observed}",
                    outcome=outcome if outcome in {"match", "mismatch", "observed", "unclear"} else "observed",
                    mismatch_reason=mismatch_reason,
                    metadata={
                        "chosen": chosen,
                        "comparison": comparison,
                        "operator_summary": row.get("operator_summary"),
                    },
                )
            )
        )
    atoms.append(
        model_dump_compat(
            ExplainAtom(
                explain_id="explain_atom:control_plane",
                subsystem="control_plane",
                title="control plane constraint summary",
                expected_effect=f"precedence={control_plane.get('constraint_precedence')}",
                observed_effect=f"owners={control_plane.get('constraint_field_owners')}",
                outcome="observed",
                metadata={
                    "constraint_decision_count": len(control_plane.get("constraint_decisions") or []),
                    "active_subsystems": list(control_plane.get("active_subsystems") or []),
                    "mismatch_domains": list(control_plane.get("mismatch_domains") or []),
                    "operator_summary": control_plane.get("operator_summary"),
                },
            )
        )
    )
    return atoms



def default_policy_outcome_summary() -> JsonDict:
    return {
        "overall": "observed_only",
        "counts": {},
        "domains_by_outcome": {},
        "mismatch_domains": [],
        "unclear_domains": [],
        "operator_summary": "policy outcomes unavailable",
    }



def default_belief_evidence_summary() -> JsonDict:
    return {
        "belief_count": 0,
        "evidence_count": 0,
        "source_types": {},
        "avg_weighted_confidence": 0.0,
        "avg_weighted_freshness": 0.0,
        "top_belief_ids": [],
        "operator_summary": "no belief evidence",
    }



def default_contradiction_graph_summary() -> JsonDict:
    return {
        "node_count": 0,
        "edge_count": 0,
        "cluster_count": 0,
        "contradiction_edge_count": 0,
        "supersession_edge_count": 0,
        "conflict_count": 0,
        "avg_ambiguity_score": 0.0,
        "operator_summary": "no contradiction graph",
    }



def default_epistemic_risk_summary() -> JsonDict:
    return {
        "belief_count": 0,
        "avg_risk_score": 0.0,
        "levels": {},
        "top_risky_belief_ids": [],
        "top_risky_links": [],
        "operator_summary": "no epistemic risk",
    }



def default_decision_causality_summary() -> JsonDict:
    return {
        "decision_count": 0,
        "domains": {},
        "top_belief_ids": [],
        "top_links": [],
        "avg_causal_score": 0.0,
        "operator_summary": "no decision causality",
    }



def default_epistemic_core_summary() -> JsonDict:
    return {
        "evidence": {},
        "contradiction_graph": {},
        "epistemic_risk": {},
        "decision_causality": {},
        "operator_summary": "epistemic core unavailable",
    }



def default_policy_patch_preview() -> JsonDict:
    return observability.policy_patch_preview(policy={}, hooks=[])



def default_policy_patch_history() -> JsonDict:
    return {"count": 0, "entries": []}



def compile_policy_patch_history(events: List[JsonDict]) -> JsonDict:
    rows: List[JsonDict] = []
    for event in events or []:
        kind = str((event or {}).get("kind") or "")
        if not isinstance(event, dict) or kind not in {"policy_patch_applied", "policy_patch_rolled_back"}:
            continue
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        applied_settings = [dict(row) for row in (payload.get("applied_settings") or []) if isinstance(row, dict)]
        metadata_overrides = dict(payload.get("metadata_overrides") or {})
        if not metadata_overrides:
            metadata_overrides = {str(row.get("setting") or ""): row.get("after") for row in applied_settings if str(row.get("setting") or "").strip()}
        rows.append(
            {
                "event_id": event.get("event_id"),
                "revision_id": payload.get("revision_id"),
                "recommendation_version": payload.get("recommendation_version"),
                "kind": kind,
                "ts": event.get("ts"),
                "applied_count": int(payload.get("applied_count", len(applied_settings)) or 0),
                "settings": [str(x) for x in (payload.get("settings") or []) if str(x).strip()],
                "requested_settings": [str(x) for x in (payload.get("requested_settings") or []) if str(x).strip()],
                "applied_settings": applied_settings,
                "metadata_overrides": metadata_overrides,
                "previous_values": dict(payload.get("previous_values") or {}),
                "operator_overrides": dict(payload.get("operator_overrides") or {}),
                "audit": dict(payload.get("audit") or {}),
                "allow_confirmation_required": bool(payload.get("allow_confirmation_required", False)),
                "allow_intervening_revisions": bool(payload.get("allow_intervening_revisions", False)),
                "intervening_revisions": [dict(row) for row in (payload.get("intervening_revisions") or []) if isinstance(row, dict)],
                "rolled_back_from_revision_id": payload.get("rolled_back_from_revision_id"),
            }
        )
    return {"count": len(rows), "entries": rows}



def compile_step_belief_influences(
    *,
    workflow: JsonDict,
    results_by_node: JsonDict,
    task_id: Optional[str],
    explain_belief_fn: ExplainBeliefFn,
    get_belief_fn: GetBeliefFn,
    select_influential_beliefs_fn: SelectInfluentialBeliefsFn,
) -> List[JsonDict]:
    workflow = workflow if isinstance(workflow, dict) else {}
    results_by_node = results_by_node if isinstance(results_by_node, dict) else {}
    rows: List[JsonDict] = []
    for idx, raw_step in enumerate(workflow.get("steps") or [], start=1):
        step = dict(raw_step or {})
        node_id = str(step.get("node_id") or f"step_{idx}")
        title = step.get("title") or node_id
        step_metadata = step.get("metadata") if isinstance(step.get("metadata"), dict) else {}
        filters = {
            "subjects": [str(x) for x in (step_metadata.get("belief_subjects") or []) if str(x).strip()],
            "predicates": [str(x) for x in (step_metadata.get("belief_predicates") or []) if str(x).strip()],
            "query": step_metadata.get("belief_query"),
        }
        result = results_by_node.get(node_id) if isinstance(results_by_node.get(node_id), dict) else {}
        captured_context = result.get("belief_context") if isinstance(result.get("belief_context"), dict) else None
        captured_ids = [str(x) for x in ((captured_context or {}).get("selected_ids") or []) if str(x).strip()]
        current_selected = select_influential_beliefs_fn(
            task_id=task_id,
            subjects=filters["subjects"] or None,
            predicates=filters["predicates"] or None,
            query=filters["query"],
            limit=8,
        )
        current_ids = [str(row.get("claim_id") or "") for row in current_selected if str(row.get("claim_id") or "").strip()]
        effective_ids = captured_ids if captured_context else current_ids
        belief_delta = explain.belief_id_delta(captured_ids if captured_context else current_ids, current_ids)
        produced_belief_ids = [str(x) for x in (result.get("produced_belief_ids") or []) if str(x).strip()]
        impact_attribution = explain.impact_attribution_from_beliefs(
            belief_ids=effective_ids,
            produced_belief_ids=produced_belief_ids,
            success=result.get("success"),
            error=result.get("error"),
            get_belief_fn=get_belief_fn,
        )
        belief_summary_texts = explain.summarize_belief_ids(effective_ids, get_belief_fn=get_belief_fn, limit=3)
        rows.append(
            {
                "order": idx,
                "node_id": node_id,
                "title": title,
                "filters": filters,
                "captured_at_execution": bool(captured_context),
                "captured_belief_ids": captured_ids,
                "current_belief_ids": current_ids,
                "belief_ids": effective_ids,
                "belief_count": len(effective_ids),
                "belief_summary_texts": belief_summary_texts,
                "belief_explanations": [explained_row for explained_row in (explain_belief_fn(belief_id) for belief_id in effective_ids[:5]) if explained_row],
                "belief_delta": belief_delta,
                "produced_belief_ids": produced_belief_ids,
                "impact_attribution": impact_attribution,
                "operator_summary": explain.step_operator_summary(
                    title=title,
                    belief_count=len(effective_ids),
                    changed=bool(belief_delta.get("changed")),
                    produced_belief_ids=produced_belief_ids,
                    impact=impact_attribution,
                ),
            }
        )
    return rows



def default_self_review(*, fallback: bool = False) -> JsonDict:
    return {
        "score": 0.0,
        "strengths": [],
        "weaknesses": ["Fallback self-review"] if fallback else [],
        "root_cause": None,
        "summary": None,
        "next_actions": [],
    }



def default_postmortem(process_id: str, *, fallback: bool = False) -> JsonDict:
    return {
        "title": f"Process {process_id} postmortem",
        "summary": "Fallback postmortem" if fallback else None,
        "root_cause": None,
        "recommendations": [],
    }



def default_incident_report() -> JsonDict:
    return {
        "incidents": [],
        "incident_count": 0,
        "high_severity_count": 0,
        "root_cause": None,
        "policy_mismatches": [],
    }



def compile_runtime_shared_response_sections(explained: Optional[JsonDict], *, process_id: str, fallback: bool = False) -> JsonDict:
    explained = explained if isinstance(explained, dict) else {}
    return {
        "self_review": explained.get("self_review") or default_self_review(fallback=fallback),
        "postmortem": explained.get("postmortem") or default_postmortem(process_id, fallback=fallback),
        "policy_outcome_summary": explained.get("policy_outcome_summary") or default_policy_outcome_summary(),
        "epistemic_risk_summary": explained.get("epistemic_risk_summary") or default_epistemic_risk_summary(),
        "epistemic_core_summary": explained.get("epistemic_core_summary") or default_epistemic_core_summary(),
        "policy_patch_preview": explained.get("policy_patch_preview") or default_policy_patch_preview(),
        "policy_patch_history": explained.get("policy_patch_history") or default_policy_patch_history(),
    }



def compile_epistemic_summary_sections(*, belief_explanations: Optional[List[JsonDict]] = None, decision_explanations: Optional[List[JsonDict]] = None) -> JsonDict:
    belief_explanations = [dict(row) for row in (belief_explanations or []) if isinstance(row, dict)]
    decision_explanations = [dict(row) for row in (decision_explanations or []) if isinstance(row, dict)]
    belief_evidence = explain.belief_evidence_summary(belief_explanations) if belief_explanations else default_belief_evidence_summary()
    contradiction_graph = explain.contradiction_graph_summary(belief_explanations) if belief_explanations else default_contradiction_graph_summary()
    decision_causality = explain.decision_causality_summary(decision_explanations) if decision_explanations else default_decision_causality_summary()
    epistemic_risk = explain.epistemic_risk_summary(belief_explanations) if belief_explanations else default_epistemic_risk_summary()
    epistemic_core = explain.epistemic_core_summary(
        belief_explanations=belief_explanations,
        decision_explanations=decision_explanations,
    ) if (belief_explanations or decision_explanations) else default_epistemic_core_summary()
    return {
        "belief_evidence_summary": belief_evidence,
        "contradiction_graph_summary": contradiction_graph,
        "decision_causality_summary": decision_causality,
        "epistemic_risk_summary": epistemic_risk,
        "epistemic_core_summary": epistemic_core,
    }



def compile_runtime_policy_response_sections(explained: Optional[JsonDict], *, process_id: str) -> JsonDict:
    explained = explained if isinstance(explained, dict) else {}
    sections = compile_runtime_shared_response_sections(explained, process_id=process_id)
    sections.update(
        {
            "belief_evidence_summary": explained.get("belief_evidence_summary") or default_belief_evidence_summary(),
            "contradiction_graph_summary": explained.get("contradiction_graph_summary") or default_contradiction_graph_summary(),
            "decision_causality_summary": explained.get("decision_causality_summary") or default_decision_causality_summary(),
            "incident_report": explained.get("incident_report") or default_incident_report(),
            "rerun_recommendations": explained.get("rerun_recommendations") or [],
            "policy_adaptation_hooks": explained.get("policy_adaptation_hooks") or [],
        }
    )
    return sections



def compile_runtime_postmortem_response_sections(explained: Optional[JsonDict], *, process_id: str, fallback: bool = False) -> JsonDict:
    explained = explained if isinstance(explained, dict) else {}
    sections = compile_runtime_shared_response_sections(explained, process_id=process_id, fallback=fallback)
    sections.update(
        {
            "incident_report": explained.get("incident_report") or default_incident_report(),
            "execution_trace": explained.get("execution_trace") or [],
            "epistemic_timeline": explained.get("epistemic_timeline") or [],
            "rerun_recommendations": explained.get("rerun_recommendations") or [],
            "policy_adaptation_hooks": explained.get("policy_adaptation_hooks") or [],
        }
    )
    return sections



BeliefsForTaskFn = Callable[[str], List[JsonDict]]
SummarizeBeliefsFn = Callable[..., JsonDict]



def compile_runtime_process_sections(
    *,
    process: JsonDict,
    beliefs_for_task_fn: BeliefsForTaskFn,
    summarize_beliefs_fn: SummarizeBeliefsFn,
    explain_belief_fn: ExplainBeliefFn,
    get_belief_fn: GetBeliefFn,
    select_influential_beliefs_fn: SelectInfluentialBeliefsFn,
) -> JsonDict:
    process = process if isinstance(process, dict) else {}
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    task_id = str(process.get("task_id") or metadata.get("task_id") or metadata.get("kernel_task_id") or "").strip() or None

    belief_rows = beliefs_for_task_fn(task_id, limit=200) if task_id else []
    summary = summarize_beliefs_fn(task_id=task_id) if task_id else summarize_beliefs_fn()
    belief_explanations: List[JsonDict] = []
    for row in belief_rows[:10]:
        claim_id = str(row.get("claim_id") or "")
        if not claim_id:
            continue
        explained_belief = explain_belief_fn(claim_id)
        if explained_belief:
            belief_explanations.append(explained_belief)

    results_by_node = process.get("results_by_node") if isinstance(process.get("results_by_node"), dict) else {}
    step_influences = compile_step_belief_influences(
        workflow=workflow,
        results_by_node=results_by_node,
        task_id=task_id,
        explain_belief_fn=explain_belief_fn,
        get_belief_fn=get_belief_fn,
        select_influential_beliefs_fn=select_influential_beliefs_fn,
    )
    execution_trace_rows = explain.execution_trace(process)
    epistemic_timeline = explain.epistemic_timeline(step_influences, execution_trace_rows)
    drift_summary = explain.epistemic_drift_summary(step_influences)
    policy_evaluation = explain.policy_outcome_evaluation(
        policy=policy,
        process=process,
        execution_trace_rows=execution_trace_rows,
        step_influences=step_influences,
        belief_summary=summary,
    )
    policy_outcome_summary = explain.policy_outcome_summary(policy_evaluation)
    policy_decision_explanations = explain.policy_decision_explanations(policy, explain_belief_fn=explain_belief_fn, get_belief_fn=get_belief_fn)
    epistemic_sections = compile_epistemic_summary_sections(
        belief_explanations=belief_explanations,
        decision_explanations=policy_decision_explanations,
    )
    policy_surface_sections = compile_policy_surface_sections(
        policy,
        policy_outcome_evaluation=policy_evaluation,
    )
    observability_sections = compile_observability_sections(
        process=process,
        policy=policy,
        execution_trace_rows=execution_trace_rows,
        policy_outcome_evaluation=policy_evaluation,
        epistemic_drift_summary=drift_summary,
        step_influences=step_influences,
        belief_summary=summary,
    )
    return {
        "process": process,
        "policy": policy,
        **policy_surface_sections,
        "policy_belief_influences": policy.get("belief_influences") if isinstance(policy, dict) else [],
        "policy_decision_explanations": policy_decision_explanations,
        "policy_outcome_evaluation": policy_evaluation,
        "policy_outcome_summary": policy_outcome_summary,
        "explain_atoms": policy_surface_sections.get("explain_atoms") or compile_explain_atoms(policy, policy_outcome_evaluation=policy_evaluation),
        "beliefs": belief_rows,
        "belief_summary": summary,
        "belief_explanations": belief_explanations,
        **epistemic_sections,
        "step_belief_influences": step_influences,
        "execution_trace": execution_trace_rows,
        "epistemic_timeline": epistemic_timeline,
        "epistemic_drift_summary": drift_summary,
        **observability_sections,
    }



def compile_observability_sections(
    *,
    process: JsonDict,
    policy: JsonDict,
    execution_trace_rows: List[JsonDict],
    policy_outcome_evaluation: List[JsonDict],
    epistemic_drift_summary: JsonDict,
    step_influences: List[JsonDict],
    belief_summary: JsonDict,
) -> JsonDict:
    process = process if isinstance(process, dict) else {}
    policy = policy if isinstance(policy, dict) else {}
    execution_trace_rows = [dict(row) for row in (execution_trace_rows or []) if isinstance(row, dict)]
    policy_outcome_evaluation = [dict(row) for row in (policy_outcome_evaluation or []) if isinstance(row, dict)]
    step_influences = [dict(row) for row in (step_influences or []) if isinstance(row, dict)]
    belief_summary = dict(belief_summary or {})
    incidents: List[JsonDict] = []
    for node_id, row in (process.get("nodes") or {}).items():
        if isinstance(row, dict) and str(row.get("status") or "") in {"failed", "blocked", "cancelled"}:
            incidents.append(
                {
                    "node_id": node_id,
                    "status": row.get("status"),
                    "blocked_by": row.get("blocked_by"),
                    "last_error": row.get("last_error"),
                    "error_code": row.get("last_error_code"),
                }
            )
    incident_report = observability.incident_report(
        process=process,
        execution_trace=execution_trace_rows,
        incidents=incidents,
        policy_outcome_evaluation=policy_outcome_evaluation,
    )
    postmortem = observability.workflow_postmortem(
        process=process,
        execution_trace=execution_trace_rows,
        incident_report=incident_report,
        policy_outcome_evaluation=policy_outcome_evaluation,
        epistemic_drift_summary=epistemic_drift_summary,
    )
    rerun_recommendations = observability.rerun_recommendations(
        incident_report=incident_report,
        postmortem=postmortem,
        process=process,
    )
    policy_adaptation_hooks = observability.policy_adaptation_hooks(
        policy=policy,
        incident_report=incident_report,
        policy_outcome_evaluation=policy_outcome_evaluation,
    )
    policy_patch_preview = observability.policy_patch_preview(policy=policy, hooks=policy_adaptation_hooks)
    self_review = observability.workflow_self_review(
        process=process,
        policy=policy,
        execution_trace=execution_trace_rows,
        step_influences=step_influences,
        belief_summary=belief_summary,
        incident_report=incident_report,
        postmortem=postmortem,
    )
    return {
        "incidents": incidents,
        "incident_report": incident_report,
        "postmortem": postmortem,
        "rerun_recommendations": rerun_recommendations,
        "policy_adaptation_hooks": policy_adaptation_hooks,
        "policy_patch_preview": policy_patch_preview,
        "self_review": self_review,
    }


__all__ = [
    "compile_control_plane_summary",
    "compile_epistemic_summary_sections",
    "compile_explain_atoms",
    "compile_observability_sections",
    "compile_runtime_process_sections",
    "compile_policy_surface_sections",
    "compile_policy_surface_summaries",
    "compile_runtime_policy_response_sections",
    "compile_runtime_postmortem_response_sections",
    "compile_runtime_shared_response_sections",
    "default_belief_evidence_summary",
    "default_contradiction_graph_summary",
    "compile_policy_patch_history",
    "compile_step_belief_influences",
    "default_decision_causality_summary",
    "default_epistemic_core_summary",
    "default_epistemic_risk_summary",
    "default_incident_report",
    "default_policy_outcome_summary",
    "default_policy_patch_history",
    "default_policy_patch_preview",
    "default_postmortem",
    "default_self_review",
    "embodiment_summary",
    "homeostasis_summary",
    "modulation_summary",
    "plasticity_summary",
    "routing_r9_summary",
    "truth_engine_summary",
    "workspace_summary",
    "world_state_summary",
]
