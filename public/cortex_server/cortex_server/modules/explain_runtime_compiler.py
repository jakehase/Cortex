from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from cortex_server.modules import reasoning_explain as explain
from cortex_server.modules import reasoning_observability as observability
from cortex_server.modules.explain_surface_compiler import compile_explain_atoms, compile_policy_surface_sections
from cortex_server.runtime.handoff_contract import HandoffContract
from cortex_server.runtime.process_resume import compile_runtime_resume_state
from cortex_server.runtime.process_snapshot import ProcessSnapshot
from cortex_server.runtime.shared_process_state import SharedProcessState


JsonDict = Dict[str, Any]
ExplainBeliefFn = Callable[[str], Optional[JsonDict]]
GetBeliefFn = Callable[[str], Optional[JsonDict]]
SelectInfluentialBeliefsFn = Callable[..., List[JsonDict]]
BeliefsForTaskFn = Callable[[str], List[JsonDict]]
SummarizeBeliefsFn = Callable[..., JsonDict]



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



def _model_dump_compat(model: Any) -> JsonDict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    if hasattr(model, "dict"):
        return model.dict()
    return dict(model or {})



def compile_runtime_resume_sections(
    *,
    snapshot: Optional[ProcessSnapshot] = None,
    shared_state: Optional[SharedProcessState] = None,
    recent_events: Optional[List[Any]] = None,
    mailbox_messages: Optional[List[Any]] = None,
    leases: Optional[List[Any]] = None,
    handoff: Optional[HandoffContract] = None,
) -> JsonDict:
    if snapshot is None or shared_state is None:
        return {
            "runtime_resume_state": None,
            "runtime_resume_available": False,
            "runtime_resume_operator_summary": "durable resume state unavailable",
            "session_plane_summary": {"status": "unavailable", "retry_count": 0, "watcher_count": 0, "open_question_count": 0, "operator_summary": "session plane unavailable"},
        }

    resume_state = compile_runtime_resume_state(
        snapshot=snapshot,
        shared_state=shared_state,
        recent_events=recent_events,
        mailbox_messages=mailbox_messages,
        leases=leases,
        handoff=handoff,
    )
    session_state = dict(resume_state.session_state or {})
    session_status = str(session_state.get("status") or "unknown").strip() or "unknown"
    session_questions = [str(row).strip() for row in (session_state.get("open_questions") or []) if str(row).strip()]
    session_plane_summary = {
        "status": session_status,
        "retry_count": int(session_state.get("retry_count", 0) or 0),
        "watcher_count": int(session_state.get("watcher_count", 0) or 0),
        "open_question_count": len(session_questions),
        "operator_summary": (
            f"session plane {session_status} with {int(session_state.get('watcher_count', 0) or 0)} watchers"
            + (f" and {len(session_questions)} open questions" if session_questions else "")
        ),
    }
    return {
        "runtime_resume_state": _model_dump_compat(resume_state),
        "runtime_resume_available": True,
        "runtime_resume_operator_summary": (
            f"resume ready from {resume_state.lifecycle_state} snapshot {resume_state.source_snapshot_id} "
            f"rev {resume_state.revision_id} with {resume_state.queued_messages} queued messages and "
            f"{len(resume_state.active_leases)} active leases"
        ),
        "session_plane_summary": session_plane_summary,
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
            incidents.append({
                "node_id": node_id,
                "status": row.get("status"),
                "blocked_by": row.get("blocked_by"),
                "last_error": row.get("last_error"),
                "error_code": row.get("last_error_code"),
            })
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



def compile_runtime_process_sections(
    *,
    process: JsonDict,
    beliefs_for_task_fn: BeliefsForTaskFn,
    summarize_beliefs_fn: SummarizeBeliefsFn,
    explain_belief_fn: ExplainBeliefFn,
    get_belief_fn: GetBeliefFn,
    select_influential_beliefs_fn: SelectInfluentialBeliefsFn,
    snapshot: Optional[ProcessSnapshot] = None,
    shared_state: Optional[SharedProcessState] = None,
    recent_events: Optional[List[Any]] = None,
    mailbox_messages: Optional[List[Any]] = None,
    leases: Optional[List[Any]] = None,
    handoff: Optional[HandoffContract] = None,
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
    policy_surface_sections = compile_policy_surface_sections(policy, policy_outcome_evaluation=policy_evaluation)
    observability_sections = compile_observability_sections(
        process=process,
        policy=policy,
        execution_trace_rows=execution_trace_rows,
        policy_outcome_evaluation=policy_evaluation,
        epistemic_drift_summary=drift_summary,
        step_influences=step_influences,
        belief_summary=summary,
    )
    resume_sections = compile_runtime_resume_sections(
        snapshot=snapshot,
        shared_state=shared_state,
        recent_events=recent_events,
        mailbox_messages=mailbox_messages,
        leases=leases,
        handoff=handoff,
    )
    return {
        "process": process,
        "policy": policy,
        **resume_sections,
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


__all__ = [
    "BeliefsForTaskFn",
    "ExplainBeliefFn",
    "GetBeliefFn",
    "SelectInfluentialBeliefsFn",
    "SummarizeBeliefsFn",
    "compile_epistemic_summary_sections",
    "compile_observability_sections",
    "compile_policy_patch_history",
    "compile_runtime_policy_response_sections",
    "compile_runtime_postmortem_response_sections",
    "compile_runtime_process_sections",
    "compile_runtime_resume_sections",
    "compile_runtime_shared_response_sections",
    "compile_step_belief_influences",
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
]
