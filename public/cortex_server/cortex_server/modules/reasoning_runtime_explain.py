from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from cortex_server.modules import explain_compiler
from cortex_server.modules import reasoning_explain as explain
from cortex_server.modules import reasoning_observability as observability

BeliefsForTaskFn = Callable[[str], List[Dict[str, Any]]]
SummarizeBeliefsFn = Callable[..., Dict[str, Any]]
ExplainBeliefFn = Callable[[str], Optional[Dict[str, Any]]]
GetBeliefFn = Callable[[str], Optional[Dict[str, Any]]]
SelectInfluentialBeliefsFn = Callable[..., List[Dict[str, Any]]]
GetRuntimeEventsFn = Callable[..., List[Dict[str, Any]]]



def policy_patch_history(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
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



def _routing_r9_summary(policy: Dict[str, Any]) -> Dict[str, Any]:
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



def _homeostasis_summary(policy: Dict[str, Any]) -> Dict[str, Any]:
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



def _world_state_summary(policy: Dict[str, Any]) -> Dict[str, Any]:
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



def _modulation_summary(policy: Dict[str, Any]) -> Dict[str, Any]:
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



def _workspace_summary(policy: Dict[str, Any]) -> Dict[str, Any]:
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



def _truth_engine_summary(policy: Dict[str, Any]) -> Dict[str, Any]:
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



def _plasticity_summary(policy: Dict[str, Any]) -> Dict[str, Any]:
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



def _embodiment_summary(policy: Dict[str, Any]) -> Dict[str, Any]:
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



def assemble_runtime_process_explain(
    *,
    process_id: str,
    process: Dict[str, Any],
    beliefs_for_task_fn: BeliefsForTaskFn,
    summarize_beliefs_fn: SummarizeBeliefsFn,
    explain_belief_fn: ExplainBeliefFn,
    get_belief_fn: GetBeliefFn,
    select_influential_beliefs_fn: SelectInfluentialBeliefsFn,
) -> Dict[str, Any]:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    task_id = str(process.get("task_id") or metadata.get("task_id") or metadata.get("kernel_task_id") or "").strip() or None

    belief_rows = beliefs_for_task_fn(task_id, limit=200) if task_id else []
    summary = summarize_beliefs_fn(task_id=task_id) if task_id else summarize_beliefs_fn()
    belief_explanations: List[Dict[str, Any]] = []
    for row in belief_rows[:10]:
        claim_id = str(row.get("claim_id") or "")
        if not claim_id:
            continue
        explained_belief = explain_belief_fn(claim_id)
        if explained_belief:
            belief_explanations.append(explained_belief)

    results_by_node = process.get("results_by_node") if isinstance(process.get("results_by_node"), dict) else {}
    step_influences: List[Dict[str, Any]] = []
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
        step_influences.append(
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
    belief_evidence_summary = explain.belief_evidence_summary(belief_explanations)
    contradiction_graph_summary = explain.contradiction_graph_summary(belief_explanations)
    decision_causality_summary = explain.decision_causality_summary(policy_decision_explanations)
    epistemic_core_summary = explain.epistemic_core_summary(
        belief_explanations=belief_explanations,
        decision_explanations=policy_decision_explanations,
    )
    policy_surface_summaries = explain_compiler.compile_policy_surface_summaries(policy)
    control_plane_summary = explain_compiler.compile_control_plane_summary(
        policy,
        policy_outcome_evaluation=policy_evaluation,
    )
    incidents = []
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
        policy_outcome_evaluation=policy_evaluation,
    )
    postmortem = observability.workflow_postmortem(
        process=process,
        execution_trace=execution_trace_rows,
        incident_report=incident_report,
        policy_outcome_evaluation=policy_evaluation,
        epistemic_drift_summary=drift_summary,
    )
    rerun_recommendations = observability.rerun_recommendations(
        incident_report=incident_report,
        postmortem=postmortem,
        process=process,
    )
    policy_adaptation_hooks = observability.policy_adaptation_hooks(
        policy=policy,
        incident_report=incident_report,
        policy_outcome_evaluation=policy_evaluation,
    )
    policy_patch_preview = observability.policy_patch_preview(policy=policy, hooks=policy_adaptation_hooks)
    self_review = observability.workflow_self_review(
        process=process,
        policy=policy,
        execution_trace=execution_trace_rows,
        step_influences=step_influences,
        belief_summary=summary,
        incident_report=incident_report,
        postmortem=postmortem,
    )

    return {
        "success": True,
        "process_id": process_id,
        "process": process,
        "policy": policy,
        "routing_r9": policy.get("routing_r9") if isinstance(policy, dict) else {},
        "routing_r9_summary": policy_surface_summaries.get("routing_r9_summary"),
        "homeostasis": policy.get("homeostasis") if isinstance(policy, dict) else {},
        "homeostasis_summary": policy_surface_summaries.get("homeostasis_summary"),
        "world_state": policy.get("world_state") if isinstance(policy, dict) else {},
        "world_state_summary": policy_surface_summaries.get("world_state_summary"),
        "modulation": policy.get("modulation") if isinstance(policy, dict) else {},
        "modulation_summary": policy_surface_summaries.get("modulation_summary"),
        "workspace": policy.get("workspace") if isinstance(policy, dict) else {},
        "workspace_summary": policy_surface_summaries.get("workspace_summary"),
        "truth_engine": policy.get("truth_engine") if isinstance(policy, dict) else {},
        "truth_engine_summary": policy_surface_summaries.get("truth_engine_summary"),
        "plasticity": policy.get("plasticity") if isinstance(policy, dict) else {},
        "plasticity_summary": policy_surface_summaries.get("plasticity_summary"),
        "embodiment": policy.get("embodiment") if isinstance(policy, dict) else {},
        "embodiment_summary": policy_surface_summaries.get("embodiment_summary"),
        "policy_belief_influences": policy.get("belief_influences") if isinstance(policy, dict) else [],
        "policy_decision_explanations": policy_decision_explanations,
        "policy_outcome_evaluation": policy_evaluation,
        "policy_outcome_summary": policy_outcome_summary,
        "control_plane_summary": control_plane_summary,
        "beliefs": belief_rows,
        "belief_summary": summary,
        "belief_explanations": belief_explanations,
        "belief_evidence_summary": belief_evidence_summary,
        "contradiction_graph_summary": contradiction_graph_summary,
        "decision_causality_summary": decision_causality_summary,
        "epistemic_core_summary": epistemic_core_summary,
        "step_belief_influences": step_influences,
        "execution_trace": execution_trace_rows,
        "epistemic_timeline": epistemic_timeline,
        "epistemic_drift_summary": drift_summary,
        "incidents": incidents,
        "incident_report": incident_report,
        "postmortem": postmortem,
        "rerun_recommendations": rerun_recommendations,
        "policy_adaptation_hooks": policy_adaptation_hooks,
        "policy_patch_preview": policy_patch_preview,
        "self_review": self_review,
    }


def assemble_runtime_process_view(
    *,
    process_id: str,
    process: Dict[str, Any],
    events_limit: int,
    get_runtime_events_fn: GetRuntimeEventsFn,
    beliefs_for_task_fn: BeliefsForTaskFn,
    summarize_beliefs_fn: SummarizeBeliefsFn,
    explain_belief_fn: ExplainBeliefFn,
    get_belief_fn: GetBeliefFn,
    select_influential_beliefs_fn: SelectInfluentialBeliefsFn,
) -> Dict[str, Any]:
    explained = assemble_runtime_process_explain(
        process_id=process_id,
        process=process,
        beliefs_for_task_fn=beliefs_for_task_fn,
        summarize_beliefs_fn=summarize_beliefs_fn,
        explain_belief_fn=explain_belief_fn,
        get_belief_fn=get_belief_fn,
        select_influential_beliefs_fn=select_influential_beliefs_fn,
    )
    explained["events"] = get_runtime_events_fn(process_id, limit=events_limit)
    explained["policy_patch_history"] = policy_patch_history(explained.get("events") or [])
    return explained


def default_policy_patch_preview() -> Dict[str, Any]:
    return observability.policy_patch_preview(policy={}, hooks=[])



def default_policy_patch_history() -> Dict[str, Any]:
    return {"count": 0, "entries": []}



def default_self_review(*, fallback: bool = False) -> Dict[str, Any]:
    return {
        "score": 0.0,
        "strengths": [],
        "weaknesses": ["Fallback self-review"] if fallback else [],
        "root_cause": None,
        "summary": None,
        "next_actions": [],
    }


def default_postmortem(process_id: str, *, fallback: bool = False) -> Dict[str, Any]:
    return {
        "title": f"Process {process_id} postmortem",
        "summary": "Fallback postmortem" if fallback else None,
        "root_cause": None,
        "recommendations": [],
    }


def default_incident_report() -> Dict[str, Any]:
    return {
        "incidents": [],
        "incident_count": 0,
        "high_severity_count": 0,
        "root_cause": None,
        "policy_mismatches": [],
    }


def assemble_runtime_policy_response(
    *,
    process_id: str,
    process: Dict[str, Any],
    explained: Dict[str, Any],
    explain_belief_fn: ExplainBeliefFn,
    get_belief_fn: GetBeliefFn,
) -> Dict[str, Any]:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    policy_surface_summaries = explain_compiler.compile_policy_surface_summaries(policy)
    control_plane_summary = explain_compiler.compile_control_plane_summary(
        policy,
        policy_outcome_evaluation=explained.get("policy_outcome_evaluation") if isinstance(explained.get("policy_outcome_evaluation"), list) else None,
    )
    return {
        "success": True,
        "process_id": process_id,
        "policy": policy,
        "routing_r9": policy.get("routing_r9") if isinstance(policy, dict) else {},
        "routing_r9_summary": explained.get("routing_r9_summary") or policy_surface_summaries.get("routing_r9_summary"),
        "homeostasis": policy.get("homeostasis") if isinstance(policy, dict) else {},
        "homeostasis_summary": explained.get("homeostasis_summary") or policy_surface_summaries.get("homeostasis_summary"),
        "world_state": policy.get("world_state") if isinstance(policy, dict) else {},
        "world_state_summary": explained.get("world_state_summary") or policy_surface_summaries.get("world_state_summary"),
        "modulation": policy.get("modulation") if isinstance(policy, dict) else {},
        "modulation_summary": explained.get("modulation_summary") or policy_surface_summaries.get("modulation_summary"),
        "workspace": policy.get("workspace") if isinstance(policy, dict) else {},
        "workspace_summary": explained.get("workspace_summary") or policy_surface_summaries.get("workspace_summary"),
        "truth_engine": policy.get("truth_engine") if isinstance(policy, dict) else {},
        "truth_engine_summary": explained.get("truth_engine_summary") or policy_surface_summaries.get("truth_engine_summary"),
        "plasticity": policy.get("plasticity") if isinstance(policy, dict) else {},
        "plasticity_summary": explained.get("plasticity_summary") or policy_surface_summaries.get("plasticity_summary"),
        "embodiment": policy.get("embodiment") if isinstance(policy, dict) else {},
        "embodiment_summary": explained.get("embodiment_summary") or policy_surface_summaries.get("embodiment_summary"),
        "belief_influences": policy.get("belief_influences") if isinstance(policy, dict) else [],
        "decision_explanations": explained.get("policy_decision_explanations") or explain.policy_decision_explanations(policy, explain_belief_fn=explain_belief_fn, get_belief_fn=get_belief_fn),
        "policy_outcome_evaluation": explained.get("policy_outcome_evaluation"),
        "policy_outcome_summary": explained.get("policy_outcome_summary") or {"overall": "observed_only", "counts": {}, "domains_by_outcome": {}, "mismatch_domains": [], "unclear_domains": [], "operator_summary": "policy outcomes unavailable"},
        "control_plane_summary": explained.get("control_plane_summary") or control_plane_summary,
        "belief_evidence_summary": explained.get("belief_evidence_summary") or {"belief_count": 0, "evidence_count": 0, "source_types": {}, "avg_weighted_confidence": 0.0, "avg_weighted_freshness": 0.0, "top_belief_ids": [], "operator_summary": "no belief evidence"},
        "contradiction_graph_summary": explained.get("contradiction_graph_summary") or {"node_count": 0, "edge_count": 0, "cluster_count": 0, "contradiction_edge_count": 0, "supersession_edge_count": 0, "conflict_count": 0, "avg_ambiguity_score": 0.0, "operator_summary": "no contradiction graph"},
        "epistemic_risk_summary": explained.get("epistemic_risk_summary") or {"belief_count": 0, "avg_risk_score": 0.0, "levels": {}, "top_risky_belief_ids": [], "top_risky_links": [], "operator_summary": "no epistemic risk"},
        "decision_causality_summary": explained.get("decision_causality_summary") or {"decision_count": 0, "domains": {}, "top_belief_ids": [], "top_links": [], "avg_causal_score": 0.0, "operator_summary": "no decision causality"},
        "epistemic_core_summary": explained.get("epistemic_core_summary") or {"evidence": {}, "contradiction_graph": {}, "epistemic_risk": {}, "decision_causality": {}, "operator_summary": "epistemic core unavailable"},
        "epistemic_timeline": explained.get("epistemic_timeline"),
        "incident_report": explained.get("incident_report") or default_incident_report(),
        "postmortem": explained.get("postmortem") or default_postmortem(process_id),
        "rerun_recommendations": explained.get("rerun_recommendations") or [],
        "policy_adaptation_hooks": explained.get("policy_adaptation_hooks") or [],
        "policy_patch_preview": explained.get("policy_patch_preview") or default_policy_patch_preview(),
        "policy_patch_history": explained.get("policy_patch_history") or default_policy_patch_history(),
        "self_review": explained.get("self_review") or default_self_review(),
    }


def assemble_runtime_self_review_response(*, process_id: str, explained: Optional[Dict[str, Any]] = None, fallback: bool = False) -> Dict[str, Any]:
    explained = explained if isinstance(explained, dict) else {}
    return {
        "success": True,
        "process_id": process_id,
        "self_review": explained.get("self_review") or default_self_review(fallback=fallback),
        "postmortem": explained.get("postmortem") or default_postmortem(process_id, fallback=fallback),
        "policy_outcome_summary": explained.get("policy_outcome_summary") or {"overall": "observed_only", "counts": {}, "domains_by_outcome": {}, "mismatch_domains": [], "unclear_domains": [], "operator_summary": "policy outcomes unavailable"},
        "epistemic_risk_summary": explained.get("epistemic_risk_summary") or {"belief_count": 0, "avg_risk_score": 0.0, "levels": {}, "top_risky_belief_ids": [], "top_risky_links": [], "operator_summary": "no epistemic risk"},
        "epistemic_core_summary": explained.get("epistemic_core_summary") or {"evidence": {}, "contradiction_graph": {}, "epistemic_risk": {}, "decision_causality": {}, "operator_summary": "epistemic core unavailable"},
        "policy_patch_preview": explained.get("policy_patch_preview") or default_policy_patch_preview(),
        "policy_patch_history": explained.get("policy_patch_history") or default_policy_patch_history(),
    }


def assemble_runtime_postmortem_response(*, process_id: str, explained: Optional[Dict[str, Any]] = None, fallback: bool = False) -> Dict[str, Any]:
    explained = explained if isinstance(explained, dict) else {}
    return {
        "success": True,
        "process_id": process_id,
        "incident_report": explained.get("incident_report") or default_incident_report(),
        "postmortem": explained.get("postmortem") or default_postmortem(process_id, fallback=fallback),
        "execution_trace": explained.get("execution_trace") or [],
        "epistemic_timeline": explained.get("epistemic_timeline") or [],
        "epistemic_risk_summary": explained.get("epistemic_risk_summary") or {"belief_count": 0, "avg_risk_score": 0.0, "levels": {}, "top_risky_belief_ids": [], "top_risky_links": [], "operator_summary": "no epistemic risk"},
        "epistemic_core_summary": explained.get("epistemic_core_summary") or {"evidence": {}, "contradiction_graph": {}, "epistemic_risk": {}, "decision_causality": {}, "operator_summary": "epistemic core unavailable"},
        "rerun_recommendations": explained.get("rerun_recommendations") or [],
        "policy_adaptation_hooks": explained.get("policy_adaptation_hooks") or [],
        "policy_patch_preview": explained.get("policy_patch_preview") or default_policy_patch_preview(),
        "policy_patch_history": explained.get("policy_patch_history") or default_policy_patch_history(),
        "self_review": explained.get("self_review") or default_self_review(fallback=fallback),
    }


__all__ = [
    "assemble_runtime_policy_response",
    "assemble_runtime_postmortem_response",
    "assemble_runtime_process_explain",
    "assemble_runtime_process_view",
    "assemble_runtime_self_review_response",
    "default_incident_report",
    "default_policy_patch_history",
    "default_policy_patch_preview",
    "default_postmortem",
    "default_self_review",
    "policy_patch_history",
]
