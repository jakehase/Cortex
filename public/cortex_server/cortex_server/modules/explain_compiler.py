from __future__ import annotations

from typing import Any, Dict, List, Optional

from cortex_server.modules import reasoning_explain as explain
from cortex_server.modules import reasoning_observability as observability
from cortex_server.modules.governance_arbitration import RUNTIME_CONSTRAINT_PRECEDENCE
from cortex_server.modules.reasoning_contracts import ExplainAtom, model_dump_compat
from cortex_server.modules.runtime_constraint_compiler import compile_runtime_constraint_settings


JsonDict = Dict[str, Any]


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


__all__ = [
    "compile_control_plane_summary",
    "compile_epistemic_summary_sections",
    "compile_explain_atoms",
    "compile_policy_surface_sections",
    "compile_policy_surface_summaries",
    "compile_runtime_policy_response_sections",
    "compile_runtime_postmortem_response_sections",
    "compile_runtime_shared_response_sections",
    "default_belief_evidence_summary",
    "default_contradiction_graph_summary",
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
